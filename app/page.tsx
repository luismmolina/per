'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { VoiceSessionPanel } from '../components/voice-session-panel'
import { useVoiceRecorder } from '../lib/hooks/useVoiceRecorder'
import { ChatInterface } from '../components/chat-interface'
import { DesktopWriter } from '../components/desktop-writer'
import { Download, ArrowLeft, Copy, Check, RefreshCw, Crosshair, Radio } from 'lucide-react'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { motion, AnimatePresence } from 'framer-motion'
import { useDesktopViewport } from '../lib/hooks/useDesktopViewport'

interface Message {
  id: string
  content: string
  type: 'note' | 'question' | 'ai-response'
  timestamp: Date
  // Latest "thinking" summary from the model while it reasons.
  currentThought?: string | null
  codeBlocks?: Array<{
    code: string
    language: string
    result?: string
  }>
  thoughts?: string[]
}

const SPECIALIST_CONTEXT_MAX_CHARS = 4000
const SAVE_DEBOUNCE_MS = 2000

function truncateSpecialistContext(text: string | null | undefined): string | null {
  if (!text?.trim()) return null
  if (text.length <= SPECIALIST_CONTEXT_MAX_CHARS) return text
  return `${text.slice(0, SPECIALIST_CONTEXT_MAX_CHARS)}\n\n[... truncated — full text stored locally]`
}

function serializeMessageForPersistence(message: Message) {
  const timestamp = message.timestamp instanceof Date
    ? message.timestamp.toISOString()
    : new Date(message.timestamp).toISOString()

  if (message.type === 'ai-response') {
    return {
      id: message.id,
      type: message.type,
      content: message.content,
      timestamp,
    }
  }

  return {
    id: message.id,
    type: message.type,
    content: message.content,
    timestamp,
  }
}

type PersistedMessage = ReturnType<typeof serializeMessageForPersistence>

function prepareMessagesForSave(messages: Message[]): PersistedMessage[] {
  return messages
    .filter((message) => {
      if (message.type !== 'ai-response') return true
      return typeof message.content === 'string' && message.content.trim().length > 0
    })
    .map(serializeMessageForPersistence)
}

function fingerprintMessages(messages: Message[]): string {
  return JSON.stringify(prepareMessagesForSave(messages))
}

function getConversationSaveDelta(messages: Message[], savedMessageSnapshots: Map<string, string>) {
  const prepared = prepareMessagesForSave(messages)
  const newMessages: PersistedMessage[] = []
  const updatedMessages: PersistedMessage[] = []

  for (const message of prepared) {
    const snapshot = JSON.stringify(message)
    const previousSnapshot = savedMessageSnapshots.get(message.id)

    if (!previousSnapshot) {
      newMessages.push(message)
      continue
    }

    if (previousSnapshot !== snapshot) {
      updatedMessages.push(message)
    }
  }

  return { newMessages, updatedMessages }
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout>()
  const hasLoadedConversationsRef = useRef(false)
  const lastSavedFingerprintRef = useRef<string | null>(null)
  const pendingSaveFingerprintRef = useRef<string | null>(null)
  const savedMessageSnapshotsRef = useRef<Map<string, string>>(new Map())
  // Two specialist functions only:
  // Signal = insights + mental loops + real errors
  // Move   = A→B path + novel options
  const [activeTab, setActiveTab] = useState<'chat' | 'write' | 'signal' | 'move'>('chat')
  const [longformText, setLongformText] = useState('')
  const [isGeneratingLongform, setIsGeneratingLongform] = useState(false)
  const [longformError, setLongformError] = useState<string | null>(null)
  const [lastGeneratedAt, setLastGeneratedAt] = useState<Date | null>(null)
  const [longformCopied, setLongformCopied] = useState(false)
  const LONGFORM_STORAGE_KEY = 'deep-read-longform-v1'
  const [writerDraft, setWriterDraft] = useState('')
  const [writerLastSavedAt, setWriterLastSavedAt] = useState<Date | null>(null)
  const WRITER_DRAFT_STORAGE_KEY = 'desktop-writer-draft-v1'
  const { isDesktop } = useDesktopViewport()

  const getMessageTimestampMs = useCallback((message: Pick<Message, 'timestamp'>) => {
    const timestamp = message.timestamp instanceof Date
      ? message.timestamp.getTime()
      : new Date(message.timestamp).getTime()
    return Number.isNaN(timestamp) ? 0 : timestamp
  }, [])

  const getMessageKey = useCallback((message: Pick<Message, 'id' | 'type' | 'timestamp' | 'content'>) => {
    if (message.id) return `id:${message.id}`
    const timestampMs = getMessageTimestampMs(message)
    const timestamp = timestampMs > 0 ? new Date(timestampMs).toISOString() : ''
    return `${message.type}:${timestamp}:${message.content}`
  }, [getMessageTimestampMs])

  const mergeMessages = useCallback((baseMessages: Message[], nextMessages: Message[]) => {
    const merged = [...baseMessages]
    const seen = new Set(merged.map(getMessageKey))
    let addedMessage = false

    for (const message of nextMessages) {
      const key = getMessageKey(message)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(message)
      addedMessage = true
    }

    if (!addedMessage) return baseMessages

    return merged.sort((a, b) => getMessageTimestampMs(a) - getMessageTimestampMs(b))
  }, [getMessageKey, getMessageTimestampMs])

  // Move state (stored under consulting key for continuity)
  const [consultingText, setConsultingText] = useState('')
  const [isGeneratingConsulting, setIsGeneratingConsulting] = useState(false)
  const [consultingError, setConsultingError] = useState<string | null>(null)
  const [consultingGeneratedAt, setConsultingGeneratedAt] = useState<Date | null>(null)
  const [consultingCopied, setConsultingCopied] = useState(false)
  const CONSULTING_STORAGE_KEY = 'ai-consulting-v1'

  // Voice Recorder Hook
  const {
    isRecording,
    voiceSession,
    toggleRecording,
    retryFailedChunk
  } = useVoiceRecorder({
    onTranscriptionReady: (text) => {
      const newMessage: Message = {
        id: Date.now().toString(),
        content: text,
        type: 'note',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, newMessage])
    },
    onError: (error) => {
      console.error('Voice error:', error)
    }
  })

  // Load conversations
  useEffect(() => {
    const loadConversations = async () => {
      try {
        const response = await fetch('/api/conversations')
        if (response.ok) {
          const data = await response.json()
          if (Array.isArray(data.messages)) {
            const parsedMessages = data.messages
              .filter((msg: any) => {
                if (msg.type === 'ai-response') {
                  const hasContent = typeof msg.content === 'string' && msg.content.trim().length > 0
                  const hasThoughts = Array.isArray(msg.thoughts) && msg.thoughts.length > 0
                  const hasCodeBlocks = Array.isArray(msg.codeBlocks) && msg.codeBlocks.length > 0
                  return hasContent || hasThoughts || hasCodeBlocks
                }
                return true
              })
              .map((msg: any) => ({
                ...msg,
                timestamp: new Date(msg.timestamp)
              }))
            lastSavedFingerprintRef.current = fingerprintMessages(parsedMessages)
            savedMessageSnapshotsRef.current = new Map(
              prepareMessagesForSave(parsedMessages).map((message) => [
                message.id,
                JSON.stringify(message),
              ])
            )
            setMessages(prev => mergeMessages(parsedMessages, prev))
          }
        }
      } catch (error) {
        console.error('Failed to load conversations:', error)
      } finally {
        hasLoadedConversationsRef.current = true
      }
    }
    loadConversations()
  }, [mergeMessages])

  // Auto-save — only when data actually changed; skip during AI streaming
  const debouncedSave = useCallback((messagesToSave: Message[], fingerprint: string) => {
    pendingSaveFingerprintRef.current = fingerprint
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      const saveFingerprint = pendingSaveFingerprintRef.current
      if (!saveFingerprint || !hasLoadedConversationsRef.current) return
      if (saveFingerprint === lastSavedFingerprintRef.current) return

      const { newMessages, updatedMessages } = getConversationSaveDelta(
        messagesToSave,
        savedMessageSnapshotsRef.current,
      )

      let method: 'PATCH' | 'POST' = 'POST'
      let body: Record<string, unknown> = { messages: messagesToSave }

      if (newMessages.length > 0 && updatedMessages.length === 0) {
        method = 'PATCH'
        body = { messages: newMessages }
      } else if (newMessages.length > 0 || updatedMessages.length > 0) {
        method = 'PATCH'
        body = {
          mode: 'upsert',
          messages: [...newMessages, ...updatedMessages],
        }
      }

      try {
        const response = await fetch('/api/conversations', {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (response.ok) {
          lastSavedFingerprintRef.current = saveFingerprint
          for (const message of prepareMessagesForSave(messagesToSave)) {
            savedMessageSnapshotsRef.current.set(message.id, JSON.stringify(message))
          }
        }
      } catch (error) {
        console.error('Failed to save conversations:', error)
      }
    }, SAVE_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    if (!hasLoadedConversationsRef.current || messages.length === 0 || isLoading) return

    const fingerprint = fingerprintMessages(messages)
    if (fingerprint === lastSavedFingerprintRef.current) return

    debouncedSave(messages, fingerprint)
  }, [messages, debouncedSave, isLoading])

  // Load/save longform from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(LONGFORM_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed?.text) setLongformText(parsed.text)
        if (parsed?.generatedAt) setLastGeneratedAt(new Date(parsed.generatedAt))
      }
    } catch (error) {
      console.error('Failed to restore longform from storage:', error)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(
        LONGFORM_STORAGE_KEY,
        JSON.stringify({
          text: longformText,
          generatedAt: lastGeneratedAt ? lastGeneratedAt.toISOString() : null
        })
      )
    } catch (error) {
      console.error('Failed to persist longform to storage:', error)
    }
  }, [longformText, lastGeneratedAt])

  // Load/save consulting from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(CONSULTING_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed?.text) setConsultingText(parsed.text)
        if (parsed?.generatedAt) setConsultingGeneratedAt(new Date(parsed.generatedAt))
      }
    } catch (error) {
      console.error('Failed to restore consulting from storage:', error)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(
        CONSULTING_STORAGE_KEY,
        JSON.stringify({
          text: consultingText,
          generatedAt: consultingGeneratedAt ? consultingGeneratedAt.toISOString() : null
        })
      )
    } catch (error) {
      console.error('Failed to persist consulting to storage:', error)
    }
  }, [consultingText, consultingGeneratedAt])

  // Load/save desktop writer draft from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(WRITER_DRAFT_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed?.text === 'string') {
          setWriterDraft(parsed.text)
        }
      }
    } catch (error) {
      console.error('Failed to restore writer draft from storage:', error)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (writerDraft.length > 0) {
        localStorage.setItem(
          WRITER_DRAFT_STORAGE_KEY,
          JSON.stringify({
            text: writerDraft,
            updatedAt: new Date().toISOString()
          })
        )
      } else {
        localStorage.removeItem(WRITER_DRAFT_STORAGE_KEY)
      }
    } catch (error) {
      console.error('Failed to persist writer draft to storage:', error)
    }
  }, [writerDraft])

  useEffect(() => {
    if (!isDesktop && activeTab === 'write') {
      setActiveTab('chat')
    }
  }, [activeTab, isDesktop])

  // Handlers
  // Format timestamp with local time and timezone for AI context
  const formatTimestampForAI = useCallback((date: Date) => {
    const localTime = date.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    })
    return localTime
  }, [])

  const buildConversationHistory = useCallback((history: Message[]) => {
    // Only send recent Q&A exchanges — notes are handled by the
    // server-side retrieval system (embeddings + reranker).
    // This minimal history helps the retrieval build context-aware queries.
    return history
      .filter((msg) => msg.type === 'question' || msg.type === 'ai-response')
      .slice(-10)
      .map((msg) => ({
        role: msg.type === 'ai-response' ? 'model' : 'user',
        parts: [{ text: `[${formatTimestampForAI(msg.timestamp)}] ${msg.content}` }]
      }))
  }, [formatTimestampForAI])

  const handleSendMessage = async (text: string, type: 'note' | 'question') => {
    const trimmed = text.trim()
    if (!trimmed) return

    const baseMessage: Message = {
      id: Date.now().toString(),
      content: trimmed,
      type,
      timestamp: new Date()
    }

    const aiMessageId = type === 'question' ? `${Date.now()}-ai` : null

    setMessages(prev => {
      const updated = [...prev, baseMessage]
      if (type === 'question' && aiMessageId) {
        return [
          ...updated,
          {
            id: aiMessageId,
            content: '',
            type: 'ai-response',
            timestamp: new Date(),
            currentThought: null,
            thoughts: [],
            codeBlocks: []
          }
        ]
      }
      return updated
    })

    if (type !== 'question' || !aiMessageId) {
      return
    }

    setIsLoading(true)

    // Limit context to last 100 items to prevent timeouts with large history (90k+ tokens)
    const historyPayload = buildConversationHistory([...messages, baseMessage]).slice(-100)

    try {
      const response = await fetch('/api/chat-enhanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          conversationHistory: historyPayload,
          currentDate: new Date().toISOString(),
          userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          specialistOutputs: {
            deepRead: truncateSpecialistContext(longformText),
            consulting: truncateSpecialistContext(consultingText),
          }
        })
      })

      if (!response.ok || !response.body) {
        throw new Error('Failed to get AI response')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const event of events) {
          const line = event.trim()
          if (!line.startsWith('data:')) continue

          const payload = line.replace(/^data:\s*/, '')
          if (!payload || payload === '[DONE]') continue

          try {
            const data = JSON.parse(payload)
            setMessages(prev => prev.map(message => {
              if (message.id !== aiMessageId) return message

              if (data.type === 'text') {
                return {
                  ...message,
                  content: (message.content || '') + data.content,
                  currentThought: null
                }
              }

              if (data.type === 'thought') {
                const thoughts = [...(message.thoughts ?? []), data.content]
                return { ...message, thoughts, currentThought: data.content }
              }

              if (data.type === 'code') {
                const codeBlocks = [
                  ...(message.codeBlocks ?? []),
                  { code: data.content.code, language: data.content.language }
                ]
                return { ...message, codeBlocks }
              }

              if (data.type === 'code_result') {
                const codeBlocks = [...(message.codeBlocks ?? [])]
                if (codeBlocks.length > 0) {
                  const lastBlock = codeBlocks[codeBlocks.length - 1]
                  codeBlocks[codeBlocks.length - 1] = {
                    ...lastBlock,
                    result: data.content.error ? `Error: ${data.content.error}` : data.content.output
                  }
                }
                return { ...message, codeBlocks }
              }

              if (data.type === 'error') {
                return { ...message, content: data.content }
              }

              return message
            }))
          } catch (err) {
            console.error('Failed to parse stream chunk', err)
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev => prev.map(message =>
        message.id === aiMessageId
          ? { ...message, content: 'Sorry, I encountered an error processing your request.' }
          : message
      ))
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedMessageId(id)
    setTimeout(() => setCopiedMessageId(null), 2000)
  }

  const handleDeleteMessage = async (id: string) => {
    if (confirm('Delete this note?')) {
      // Optimistically remove from UI
      setMessages(prev => prev.filter(m => m.id !== id))

      // Persist deletion to server
      try {
        const response = await fetch('/api/conversations', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: id }),
        })

        if (!response.ok) {
          console.error('Failed to delete message from server')
        }
      } catch (error) {
        console.error('Failed to delete message:', error)
      }
    }
  }

  const handleDownloadNotes = () => {
    // Redirect to server-side download to ensure all notes (even not loaded ones) are included
    window.location.href = '/api/download-notes'
  }

  const handleDownloadSignal = () => {
    window.location.href = '/api/download-signal'
  }

  const handleGenerateLongform = async () => {
    // If we have no local messages, it's possible they just haven't loaded,
    // but the server logic (fetchAllNotes: true) handles the empty case too.
    // However, for good UX, we might want to check if we have ANY notes ever.
    // But since we rely on server now, we can just proceed.

    setIsGeneratingLongform(true)
    setLongformError(null)

    try {
      const response = await fetch('/api/longform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fetchAllNotes: true,
          currentDate: new Date().toISOString(),
          userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          peerOutputs: {
            consulting: consultingText || null,
          }
        })
      })

      if (!response.ok) {
        let errorMsg = 'Failed to generate.'
        try {
          const payload = await response.json()
          errorMsg = payload.error || errorMsg
        } catch (e) {
          errorMsg = await response.text() || errorMsg
        }
        throw new Error(errorMsg)
      }

      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      setLongformText('') // Clear previous text

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        setLongformText(prev => prev + chunk)
      }

      setLastGeneratedAt(new Date())
    } catch (error) {
      console.error('Signal error:', error)
      setLongformError(error instanceof Error ? error.message : 'Failed to extract signal from notes.')
    } finally {
      setIsGeneratingLongform(false)
    }
  }

  const handleDownloadLongform = () => {
    if (!longformText.trim()) return
    const blob = new Blob([longformText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `signal-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleCopyLongform = () => {
    if (!longformText.trim()) return
    navigator.clipboard.writeText(longformText)
    setLongformCopied(true)
    setTimeout(() => setLongformCopied(false), 2000)
  }

  // Consulting handlers
  const handleGenerateConsulting = async () => {
    setIsGeneratingConsulting(true)
    setConsultingError(null)

    try {
      const response = await fetch('/api/consulting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fetchAllNotes: true,
          currentDate: new Date().toISOString(),
          userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          peerOutputs: {
            deepRead: longformText || null,
          }
        })
      })

      if (!response.ok) {
        let errorMsg = 'Failed to generate.'
        try {
          const payload = await response.json()
          errorMsg = payload.error || errorMsg
        } catch (e) {
          errorMsg = await response.text() || errorMsg
        }
        throw new Error(errorMsg)
      }

      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      setConsultingText('') // Clear previous text

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        setConsultingText(prev => prev + chunk)
      }

      setConsultingGeneratedAt(new Date())
    } catch (error) {
      console.error('Move error:', error)
      setConsultingError(error instanceof Error ? error.message : 'Failed to generate move plan.')
    } finally {
      setIsGeneratingConsulting(false)
    }
  }

  const handleDownloadConsulting = () => {
    if (!consultingText.trim()) return
    const blob = new Blob([consultingText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `move-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleCopyConsulting = () => {
    if (!consultingText.trim()) return
    navigator.clipboard.writeText(consultingText)
    setConsultingCopied(true)
    setTimeout(() => setConsultingCopied(false), 2000)
  }

  const handleOpenWriter = () => {
    if (!isDesktop) return
    setActiveTab('write')
  }

  const handleWriterDraftChange = (nextDraft: string) => {
    setWriterDraft(nextDraft)

    if (writerLastSavedAt) {
      setWriterLastSavedAt(null)
    }
  }

  const handleSaveWriterDraft = () => {
    const trimmed = writerDraft.trim()
    if (!trimmed) return

    void handleSendMessage(trimmed, 'note')
    setWriterDraft('')
    setWriterLastSavedAt(new Date())
  }

  const handleClearWriterDraft = () => {
    if (!writerDraft.trim()) {
      setWriterDraft('')
      return
    }

    if (confirm('Clear this draft?')) {
      setWriterDraft('')
    }
  }
  return (
    <main className="relative flex h-[100dvh] max-h-[100dvh] w-full bg-black text-text-primary overflow-hidden">
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">

        <AnimatePresence mode="wait">
          {activeTab === 'chat' && (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <ChatInterface
                messages={messages}
                onSendMessage={handleSendMessage}
                onCopyMessage={handleCopyMessage}
                onDeleteMessage={handleDeleteMessage}
                copiedMessageId={copiedMessageId}
                isLoading={isLoading}
                isListening={isRecording}
                onVoiceStart={toggleRecording}
                onVoiceStop={toggleRecording}
                onDownloadNotes={handleDownloadNotes}
                onDownloadSignal={handleDownloadSignal}
                onSwitchToSignal={() => setActiveTab('signal')}
                onSwitchToMove={() => setActiveTab('move')}
                onSwitchToWrite={isDesktop ? handleOpenWriter : undefined}
                inputChildren={
                  voiceSession && voiceSession.status !== 'idle' && (
                    <div className="mb-2">
                      <VoiceSessionPanel session={voiceSession} onRetry={retryFailedChunk} />
                    </div>
                  )
                }
              />
            </motion.div>
          )}

          {activeTab === 'write' && isDesktop && (
            <motion.div
              key="write"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 flex flex-col h-full"
            >
              <DesktopWriter
                value={writerDraft}
                onChange={handleWriterDraftChange}
                onSave={handleSaveWriterDraft}
                onClear={handleClearWriterDraft}
                onExit={() => setActiveTab('chat')}
                lastSavedAt={writerLastSavedAt}
              />
            </motion.div>
          )}

          {activeTab === 'signal' && (
            <motion.div
              key="signal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 flex flex-col min-h-0 bg-black"
            >
              <header
                className="sticky top-0 z-30 border-b border-line bg-black/95 backdrop-blur-md"
                style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.55rem)' }}
              >
                <div className="max-w-2xl mx-auto flex items-center justify-between gap-2 px-3 pb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => setActiveTab('chat')}
                      className="t-btn t-btn-ghost !min-h-9 !px-2.5"
                      aria-label="Back to notes"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Radio className="w-3.5 h-3.5 text-accent-amber shrink-0" />
                      <span className="font-mono text-[11px] tracking-[0.14em] uppercase text-text-primary">
                        Signal
                      </span>
                    </div>
                    {isGeneratingLongform ? (
                      <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-accent-amber animate-pulse">
                        Run
                      </span>
                    ) : lastGeneratedAt ? (
                      <span className="font-mono text-[10px] tabular-nums text-text-muted hidden xs:inline sm:inline">
                        {lastGeneratedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={handleCopyLongform}
                      disabled={!longformText.trim()}
                      className="t-btn t-btn-ghost !min-h-9 !px-2.5"
                      title="Copy"
                    >
                      {longformCopied ? <Check className="w-3.5 h-3.5 text-accent-green" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={handleDownloadLongform}
                      disabled={!longformText.trim()}
                      className="t-btn t-btn-ghost !min-h-9 !px-2.5"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleGenerateLongform}
                      disabled={isGeneratingLongform}
                      className="t-btn t-btn-primary !min-h-9"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingLongform ? 'animate-spin' : ''}`} />
                      <span>{longformText ? 'Regen' : 'Run'}</span>
                    </button>
                  </div>
                </div>
              </header>

              <div
                className="flex-1 overflow-y-auto px-3 pt-5 md:px-6"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)' }}
              >
                <div className="max-w-2xl mx-auto">
                  {longformError && (
                    <div className="mb-4 border border-accent-red/40 bg-accent-redDim px-3 py-2 font-mono text-[12px] text-red-200">
                      {longformError}
                    </div>
                  )}

                  {!longformText && !isGeneratingLongform && !longformError && (
                    <p className="font-mono text-[12px] tracking-[0.08em] uppercase text-text-muted">
                      No signal · Run to extract
                    </p>
                  )}

                  {isGeneratingLongform && (
                    <p className="font-mono text-[12px] tracking-[0.1em] uppercase text-text-muted animate-pulse">
                      Extracting…
                    </p>
                  )}

                  {!isGeneratingLongform && longformText && (
                    <div className="t-prose">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{longformText}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'move' && (
            <motion.div
              key="move"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 flex flex-col min-h-0 bg-black"
            >
              <header
                className="sticky top-0 z-30 border-b border-line bg-black/95 backdrop-blur-md"
                style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.55rem)' }}
              >
                <div className="max-w-2xl mx-auto flex items-center justify-between gap-2 px-3 pb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => setActiveTab('chat')}
                      className="t-btn t-btn-ghost !min-h-9 !px-2.5"
                      aria-label="Back to notes"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Crosshair className="w-3.5 h-3.5 text-text-secondary shrink-0" />
                      <span className="font-mono text-[11px] tracking-[0.14em] uppercase text-text-primary">
                        Move
                      </span>
                    </div>
                    {isGeneratingConsulting ? (
                      <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-accent-amber animate-pulse">
                        Run
                      </span>
                    ) : consultingGeneratedAt ? (
                      <span className="font-mono text-[10px] tabular-nums text-text-muted hidden sm:inline">
                        {consultingGeneratedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={handleCopyConsulting}
                      disabled={!consultingText.trim()}
                      className="t-btn t-btn-ghost !min-h-9 !px-2.5"
                      title="Copy"
                    >
                      {consultingCopied ? <Check className="w-3.5 h-3.5 text-accent-green" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={handleDownloadConsulting}
                      disabled={!consultingText.trim()}
                      className="t-btn t-btn-ghost !min-h-9 !px-2.5"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleGenerateConsulting}
                      disabled={isGeneratingConsulting}
                      className="t-btn t-btn-primary !min-h-9"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingConsulting ? 'animate-spin' : ''}`} />
                      <span>{consultingText ? 'Regen' : 'Run'}</span>
                    </button>
                  </div>
                </div>
              </header>

              <div
                className="flex-1 overflow-y-auto px-3 pt-5 md:px-6"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)' }}
              >
                <div className="max-w-2xl mx-auto">
                  {consultingError && (
                    <div className="mb-4 border border-accent-red/40 bg-accent-redDim px-3 py-2 font-mono text-[12px] text-red-200">
                      {consultingError}
                    </div>
                  )}

                  {!consultingText && !isGeneratingConsulting && !consultingError && (
                    <p className="font-mono text-[12px] tracking-[0.08em] uppercase text-text-muted">
                      No plan · Run for A→B
                    </p>
                  )}

                  {isGeneratingConsulting && (
                    <p className="font-mono text-[12px] tracking-[0.1em] uppercase text-text-muted animate-pulse">
                      Compressing…
                    </p>
                  )}

                  {!isGeneratingConsulting && consultingText && (
                    <div className="t-prose">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{consultingText}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}


        </AnimatePresence>

      </div>
    </main>
  )
}
