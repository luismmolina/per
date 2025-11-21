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
    <div className="card-solid rounded-2xl p-4 space-y-3 relative z-50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-2.5 w-2.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]' : isProcessing ? 'bg-purple-500 animate-pulse' : 'bg-amber-500'
              }`}
          ></span>
          <div>
            <p className="text-sm font-semibold text-white tracking-wide">Voice Capture</p>
            <p className="text-xs text-gray-400">{statusText}</p>
          </div>
        </div>
        <span className="font-mono text-lg text-white/90 tracking-wider">{formatDuration(session.elapsedMs)}</span>
      </div>

      {subText && <p className="text-sm text-gray-400">{subText}</p>}

      {isError && (
        <div className="flex items-center justify-between pt-2 border-t border-white/10">
          <span className="text-xs text-amber-400/80">Upload failed.</span>
          <button
            onClick={onRetry}
            className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs font-semibold hover:bg-white/20 transition-colors"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
