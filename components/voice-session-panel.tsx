'use client'

import React from 'react'
import type { VoiceSessionState } from '../lib/hooks/useVoiceRecorder'
import { formatDuration } from '../lib/hooks/useVoiceRecorder'

interface VoiceSessionPanelProps {
  session: VoiceSessionState
  onRetry: () => void
}

const VOICE_PROMPTS = [
  { label: 'Name the feeling', example: '"I am scared to..." / "I feel anxious about..."' },
  { label: 'Say why', example: '"...because I imagine..."' },
  { label: 'Question the story', example: '"But is that actually true?"' },
  { label: 'End with one action', example: '"The smallest next step is..."' },
]

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
      {/* Voice Note Prompt Card - shows when recording */}
      {isRecording && (
        <div className="bg-neutral-800/50 border border-accent-purple/30 rounded-xl p-3 mb-2">
          <p className="text-xs font-semibold text-accent-purple mb-2">Before you speak:</p>
          <ul className="space-y-1.5">
            {VOICE_PROMPTS.map((prompt, idx) => (
              <li key={idx} className="text-xs">
                <span className="text-white font-medium">{prompt.label}.</span>{' '}
                <span className="text-amoled-textMuted">{prompt.example}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex items-center justify-between">

        <div className="flex items-center gap-3">
          {isRecording ? (
            <div className="flex items-center gap-1 h-4 text-accent-red">
              <div className="audio-bar" style={{ animationDelay: '0ms' }} />
              <div className="audio-bar" style={{ animationDelay: '200ms' }} />
              <div className="audio-bar" style={{ animationDelay: '400ms' }} />
              <div className="audio-bar" style={{ animationDelay: '100ms' }} />
            </div>
          ) : (
            <span
              className={`inline-flex h-2.5 w-2.5 rounded-full ${isProcessing ? 'bg-accent-purple animate-pulse' : 'bg-accent-amber'
                }`}
            ></span>
          )}
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
