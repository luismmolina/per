'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type ChunkStatus = 'queued' | 'uploading' | 'success' | 'error'

export interface VoiceChunk {
  id: string
  index: number
  status: ChunkStatus
  isLast: boolean
  attempt: number
  error?: string
}

export interface VoiceSessionState {
  id: string
  startedAt: number
  elapsedMs: number
  previewText: string
  isRecording: boolean
  isProcessing: boolean
  status: 'idle' | 'recording' | 'processing' | 'complete' | 'error'
  chunks: VoiceChunk[]
  lastError?: string
}

interface ChunkJob {
  id: string
  blob: Blob
  chunkIndex: number
  sessionId: string
  isLast: boolean
  attempt: number
}

export interface UseVoiceRecorderOptions {
  onTranscriptionReady: (text: string) => void
  onError?: (message: string) => void
  maxDurationMs?: number
}

export interface UseVoiceRecorderResult {
  voiceSession: VoiceSessionState | null
  isRecording: boolean
  isTranscribing: boolean
  toggleRecording: () => Promise<void> | void
  retryFailedChunk: () => void
}

export const MAX_VOICE_DURATION_MS = 20 * 60 * 1000 // 20 minutes
// Single-chunk uploads avoid malformed container errors emitted by Groq once MediaRecorder slices blobs mid-session.
// Keep the constant for future reinstatement, but default to `null` so only the final stop event flushes audio.
const CHUNK_TIMESLICE_MS: number | null = null
const MAX_CHUNK_BYTES = 22 * 1024 * 1024 // stay safely under the 25 MB Groq free-tier cap

const safeId = () => {
  const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined
  return cryptoObj && typeof cryptoObj.randomUUID === 'function'
    ? cryptoObj.randomUUID()
    : `voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const formatDuration = (ms: number) => {
  if (!ms || ms < 0) return '00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

const extractChunkText = (payload: any): string => {
  const direct = (typeof payload?.text === 'string' ? payload.text : '').trim()
  if (direct) return direct

  const rawText = (typeof payload?.raw?.text === 'string' ? payload.raw.text : '').trim()
  if (rawText) return rawText

  const segments = Array.isArray(payload?.raw?.segments) ? payload.raw.segments : undefined
  if (segments?.length) {
    const joined = segments
      .map((segment: any) => (typeof segment?.text === 'string' ? segment.text.trim() : ''))
      .filter(Boolean)
      .join(' ')
      .trim()
    if (joined) return joined
  }

  return ''
}

export function useVoiceRecorder({
  onTranscriptionReady,
  onError,
  maxDurationMs = MAX_VOICE_DURATION_MS,
}: UseVoiceRecorderOptions): UseVoiceRecorderResult {
  const [voiceSession, setVoiceSession] = useState<VoiceSessionState | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunkQueueRef = useRef<ChunkJob[]>([])
  const chunkCounterRef = useRef(0)
  const activeSessionIdRef = useRef<string | null>(null)
  const pendingStopRef = useRef(false)
  const isProcessingChunkRef = useRef(false)
  const failedChunkRef = useRef<ChunkJob | null>(null)
  const pendingFinalizationSessionIdRef = useRef<string | null>(null)
  const previewTextRef = useRef('')

  const captureSessionForFinalization = () => {
    if (activeSessionIdRef.current) {
      pendingFinalizationSessionIdRef.current = activeSessionIdRef.current
    }
  }

  const notifyError = useCallback(
    (message: string) => {
      if (onError) onError(message)
    },
    [onError]
  )

  const finalizeVoiceSession = useCallback(
    (sessionId: string, textContent: string) => {
      const cleaned = textContent?.trim()
      if (!cleaned) {
        notifyError('Transcription completed but returned no text. Please try again.')
        setVoiceSession((prev) =>
          prev && prev.id === sessionId ? { ...prev, status: 'error', lastError: 'Empty transcription' } : prev
        )
        return
      }

      onTranscriptionReady(cleaned)
      setVoiceSession((prev) =>
        prev && prev.id === sessionId ? { ...prev, status: 'complete', previewText: cleaned } : prev
      )
      if (activeSessionIdRef.current === sessionId) {
        activeSessionIdRef.current = null
      }
    },
    [notifyError, onTranscriptionReady]
  )

  const sendChunkForTranscription = useCallback(async (job: ChunkJob) => {
    const form = new FormData()
    const type = job.blob.type || mediaRecorderRef.current?.mimeType || 'audio/webm'
    form.append('audio', new File([job.blob], `voice_${job.sessionId}_${job.chunkIndex}.webm`, { type }))
    form.append('sessionId', job.sessionId)
    form.append('chunkIndex', job.chunkIndex.toString())
    form.append('isLast', job.isLast ? 'true' : 'false')
    form.append('response_format', 'verbose_json')
    form.append('timestampGranularities', 'word,segment')
    // Default to transcribe, but let the API decide based on its default or if we add a prop later
    // The user wants translation for Spanish -> English, so we should probably allow configuring this.
    // For now, the API defaults to 'transcribe' if not sent, but we want 'translate' for this user.
    // We'll hardcode 'translate' here as per user requirement, or ideally make it a prop.
    // Given the previous context, the user wants Spanish -> English.
    form.append('mode', 'translate')

    const res = await fetch('/api/transcribe', { method: 'POST', body: form })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(payload?.error || `Transcription failed (${res.status})`)
    }
    return payload
  }, [])

  const handleChunkSuccess = useCallback(
    (job: ChunkJob, payload: any) => {
      const shouldFinalizeByDrain =
        pendingFinalizationSessionIdRef.current === job.sessionId && chunkQueueRef.current.length === 0
      const shouldFinalize = job.isLast || shouldFinalizeByDrain

      const chunkText = extractChunkText(payload)
      if (chunkText) {
        previewTextRef.current = previewTextRef.current
          ? `${previewTextRef.current} ${chunkText}`
          : chunkText
      }

      const currentFullText = previewTextRef.current

      setVoiceSession((prev) => {
        if (!prev || prev.id !== job.sessionId) return prev

        const updatedChunks = prev.chunks.map<VoiceChunk>((chunk, index, array) => {
          const patched = chunk.id === job.id
            ? {
              ...chunk,
              status: 'success' as ChunkStatus,
              error: undefined,
              isLast: chunk.isLast || shouldFinalize,
            }
            : chunk

          if (shouldFinalize && index === array.length - 1) {
            return { ...patched, isLast: true }
          }

          return patched
        })

        return {
          ...prev,
          previewText: currentFullText,
          chunks: updatedChunks,
          isProcessing: shouldFinalize ? false : chunkQueueRef.current.length > 0,
          lastError: undefined,
          status: shouldFinalize ? 'complete' : 'processing',
          isRecording: shouldFinalize ? false : prev.isRecording,
        }
      })

      if (shouldFinalize) {
        pendingFinalizationSessionIdRef.current = null
        finalizeVoiceSession(job.sessionId, currentFullText)
        setIsTranscribing(false)
      }
    },
    [finalizeVoiceSession]
  )

  const handleChunkFailure = useCallback(
    (job: ChunkJob, error: Error) => {
      failedChunkRef.current = job
      setVoiceSession((prev) => {
        if (!prev || prev.id !== job.sessionId) return prev
        return {
          ...prev,
          status: 'error',
          isProcessing: false,
          chunks: prev.chunks.map((chunk) =>
            chunk.id === job.id ? { ...chunk, status: 'error', error: error.message } : chunk
          ),
          lastError: error.message,
          isRecording: false,
        }
      })
      setIsTranscribing(false)
      notifyError(`Chunk ${job.chunkIndex + 1} failed: ${error.message}`)
    },
    [notifyError]
  )

  const processChunkQueue = useCallback(() => {
    if (isProcessingChunkRef.current) return
    const job = chunkQueueRef.current.shift()

    if (!job) {
      setIsTranscribing(false)
      setVoiceSession((prev) => {
        if (!prev || prev.id !== activeSessionIdRef.current) return prev
        return { ...prev, isProcessing: false }
      })
      return
    }

    isProcessingChunkRef.current = true
    setIsTranscribing(true)
    setVoiceSession((prev) => {
      if (!prev || prev.id !== job.sessionId) return prev
      return {
        ...prev,
        chunks: prev.chunks.map((chunk) =>
          chunk.id === job.id ? { ...chunk, status: 'uploading', error: undefined } : chunk
        ),
        status: 'processing',
        isProcessing: true,
      }
    })

    sendChunkForTranscription(job)
      .then((payload) => handleChunkSuccess(job, payload))
      .catch((error) => handleChunkFailure(job, error instanceof Error ? error : new Error(String(error))))
      .finally(() => {
        isProcessingChunkRef.current = false
        processChunkQueue()
      })
  }, [handleChunkFailure, handleChunkSuccess, sendChunkForTranscription])

  const enqueueChunk = useCallback(
    (blob: Blob, isLast: boolean) => {
      const sessionId = activeSessionIdRef.current
      if (!sessionId) return

      const job: ChunkJob = {
        id: `${sessionId}-${chunkCounterRef.current}`,
        blob,
        chunkIndex: chunkCounterRef.current,
        sessionId,
        isLast,
        attempt: 1,
      }
      chunkCounterRef.current += 1
      chunkQueueRef.current.push(job)
      setVoiceSession((prev) => {
        if (!prev || prev.id !== sessionId) return prev
        return {
          ...prev,
          chunks: [
            ...prev.chunks,
            {
              id: job.id,
              index: job.chunkIndex,
              status: 'queued',
              isLast: job.isLast,
              attempt: job.attempt,
            },
          ],
          status: 'processing',
          isProcessing: true,
          lastError: undefined,
        }
      })
      processChunkQueue()
    },
    [processChunkQueue]
  )

  const retryFailedChunk = useCallback(() => {
    const failed = failedChunkRef.current
    if (!failed) return

    const retryJob: ChunkJob = { ...failed, attempt: failed.attempt + 1 }
    failedChunkRef.current = retryJob
    chunkQueueRef.current.unshift(retryJob)
    setVoiceSession((prev) => {
      if (!prev || prev.id !== retryJob.sessionId) return prev
      return {
        ...prev,
        status: 'processing',
        isProcessing: true,
        lastError: undefined,
        chunks: prev.chunks.map((chunk) =>
          chunk.id === retryJob.id ? { ...chunk, status: 'queued', attempt: retryJob.attempt, error: undefined } : chunk
        ),
      }
    })
    processChunkQueue()
  }, [processChunkQueue])

  const stopVoiceRecording = useCallback(() => {
    pendingStopRef.current = true
    captureSessionForFinalization()
    try {
      mediaRecorderRef.current?.stop()
    } catch (error) {
      console.warn('Failed to stop recorder', error)
    }
    setIsRecording(false)
  }, [])

  const startVoiceRecording = useCallback(async () => {
    if (
      typeof window === 'undefined' ||
      typeof MediaRecorder === 'undefined' ||
      !navigator?.mediaDevices?.getUserMedia
    ) {
      notifyError('Voice capture is not supported in this browser/environment.')
      return
    }

    const sessionId = safeId()
    activeSessionIdRef.current = sessionId
    chunkQueueRef.current = []
    chunkCounterRef.current = 0
    failedChunkRef.current = null
    pendingStopRef.current = false
    isProcessingChunkRef.current = false
    pendingFinalizationSessionIdRef.current = null
    previewTextRef.current = ''

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((candidate) =>
        MediaRecorder.isTypeSupported(candidate)
      )
      const mediaRecorder = new MediaRecorder(stream, preferredMime ? { mimeType: preferredMime } : undefined)
      mediaRecorderRef.current = mediaRecorder

      setVoiceSession({
        id: sessionId,
        startedAt: Date.now(),
        elapsedMs: 0,
        previewText: '',
        isRecording: true,
        isProcessing: false,
        status: 'recording',
        chunks: [],
        lastError: undefined,
      })

      mediaRecorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return
        if (event.data.size > MAX_CHUNK_BYTES) {
          notifyError('Captured audio chunk is too large; stopping recording to protect the session.')
          pendingStopRef.current = true
          captureSessionForFinalization()
          mediaRecorder.stop()
          return
        }
        const isLastChunk = pendingStopRef.current && mediaRecorder.state === 'inactive'
        enqueueChunk(event.data, isLastChunk)
      }

      mediaRecorder.onerror = (event) => {
        const errMessage =
          (event as unknown as { error?: { message?: string } }).error?.message || 'Unknown recorder issue'
        notifyError(`Recorder error: ${errMessage}`)
        pendingStopRef.current = true
        captureSessionForFinalization()
        try {
          mediaRecorder.stop()
        } catch (error) {
          console.warn('Failed to stop recorder after error', error)
        }
      }

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        setVoiceSession((prev) => {
          if (!prev || prev.id !== sessionId) return prev
          if (chunkCounterRef.current === 0) {
            return {
              ...prev,
              isRecording: false,
              status: 'error',
              lastError: 'No audio detected. Please try recording again.',
            }
          }
          return { ...prev, isRecording: false }
        })
        if (chunkCounterRef.current === 0) {
          notifyError('No audio captured. Please speak for a couple of seconds and try again.')
        }
        setIsRecording(false)
        pendingStopRef.current = false
      }

      if (CHUNK_TIMESLICE_MS && CHUNK_TIMESLICE_MS > 0) {
        mediaRecorder.start(CHUNK_TIMESLICE_MS)
      } else {
        mediaRecorder.start()
      }
      setIsRecording(true)
    } catch (error) {
      activeSessionIdRef.current = null
      const message = error instanceof Error ? error.message : String(error)
      notifyError(`Mic permission or recording failed: ${message}`)
      throw error
    }
  }, [enqueueChunk, notifyError])

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      stopVoiceRecording()
      return
    }
    await startVoiceRecording()
  }, [isRecording, startVoiceRecording, stopVoiceRecording])

  useEffect(() => {
    if (!voiceSession?.isRecording) return
    const interval = setInterval(() => {
      setVoiceSession((prev) => {
        if (!prev || !prev.isRecording) return prev
        return { ...prev, elapsedMs: Date.now() - prev.startedAt }
      })
    }, 500)
    return () => clearInterval(interval)
  }, [voiceSession?.isRecording])

  useEffect(() => {
    if (!voiceSession?.isRecording) return
    if (voiceSession.elapsedMs < maxDurationMs) return
    notifyError('Reached the 20 minute limit. Finishing your recording…')
    stopVoiceRecording()
  }, [maxDurationMs, notifyError, stopVoiceRecording, voiceSession?.elapsedMs, voiceSession?.isRecording])

  return useMemo(
    () => ({
      voiceSession,
      isRecording,
      isTranscribing,
      toggleRecording,
      retryFailedChunk,
    }),
    [voiceSession, isRecording, isTranscribing, toggleRecording, retryFailedChunk]
  )
}
