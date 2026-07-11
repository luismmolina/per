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

  const statusText = isRecording
    ? 'REC'
    : isProcessing
      ? 'XFER'
      : isError
        ? 'ERR'
        : 'IDLE'

  return (
    <div className="border border-line bg-background-secondary px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {isRecording ? (
            <div className="flex items-center gap-0.5 h-3 text-accent-red">
              <div className="audio-bar" style={{ animationDelay: '0ms' }} />
              <div className="audio-bar" style={{ animationDelay: '150ms' }} />
              <div className="audio-bar" style={{ animationDelay: '300ms' }} />
              <div className="audio-bar" style={{ animationDelay: '80ms' }} />
            </div>
          ) : (
            <span
              className={`inline-flex h-1.5 w-1.5 shrink-0 ${
                isProcessing
                  ? 'bg-accent-amber animate-pulse'
                  : isError
                    ? 'bg-accent-red'
                    : 'bg-text-muted'
              }`}
            />
          )}
          <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-text-secondary">
            {statusText}
          </span>
          {isError && session.lastError && (
            <span className="truncate font-mono text-[10px] text-accent-red/90">
              {session.lastError}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-[13px] tabular-nums text-text-primary">
            {formatDuration(session.elapsedMs)}
          </span>
          {isError && (
            <button
              onClick={onRetry}
              className="t-btn t-btn-ghost !min-h-0 !py-1 !px-2 !text-[10px]"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
