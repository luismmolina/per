'use client'

import React from 'react'
import type { VoiceSessionState } from '../lib/hooks/useVoiceRecorder'
import { formatDuration } from '../lib/hooks/useVoiceRecorder'

interface VoiceSessionPanelProps {
  session: VoiceSessionState
  onRetry: () => void
}

export function VoiceSessionPanel({ session, onRetry }: VoiceSessionPanelProps) {
  const isRecording = session.status === 'recording'
  const isProcessing = session.status === 'processing'
  const isError = session.status === 'error'
  const statusText = isRecording ? 'Recording' : isProcessing ? 'Transcribing' : isError ? 'Retry needed' : 'Idle'
  const subText = isRecording
    ? 'Mic is live. Speak naturally.'
    : isProcessing
      ? 'Sending audio for transcription...'
      : isError
        ? session.lastError || 'Upload failed.'
        : ''

  return (
    <div className="bg-neutral-900 border border-amoled-border rounded-2xl p-4 space-y-3 shadow-xl relative z-50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-2.5 w-2.5 rounded-full ${isRecording ? 'bg-accent-red animate-pulse' : isProcessing ? 'bg-accent-purple animate-pulse' : 'bg-accent-amber'
              }`}
          ></span>
          <div>
            <p className="text-sm font-semibold text-white">Voice capture</p>
            <p className="text-xs text-amoled-textMuted">{statusText}</p>
          </div>
        </div>
        <span className="font-mono text-lg text-accent-purple">{formatDuration(session.elapsedMs)}</span>
      </div>

      {subText && <p className="text-sm text-amoled-textMuted">{subText}</p>}

      {isError && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-accent-amber">Tap retry to upload the failed chunk.</span>
          <button
            onClick={onRetry}
            className="px-3 py-1 rounded-lg bg-accent-purple/20 text-white text-xs font-semibold hover:bg-accent-purple/30 transition-colors"
          >
            Retry upload
          </button>
        </div>
      )}
    </div>
  )
}
