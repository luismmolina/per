'use client'

import React, { useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, Check, Keyboard, Save, Trash2 } from 'lucide-react'

interface DesktopWriterProps {
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onClear: () => void
  onExit: () => void
  lastSavedAt: Date | null
}

export const DesktopWriter = ({
  value,
  onChange,
  onSave,
  onClear,
  onExit,
  lastSavedAt,
}: DesktopWriterProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isEmpty = value.trim().length === 0

  const stats = useMemo(() => {
    const trimmed = value.trim()

    return {
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      chars: value.length,
    }
  }, [value])

  const resizeEditor = () => {
    if (typeof window === 'undefined' || !textareaRef.current) {
      return
    }

    const textarea = textareaRef.current
    textarea.style.height = 'auto'

    const minHeight = Math.max(560, window.innerHeight - 220)
    textarea.style.height = `${Math.max(minHeight, textarea.scrollHeight)}px`
  }

  useEffect(() => {
    resizeEditor()
  }, [value])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [])

  useEffect(() => {
    window.addEventListener('resize', resizeEditor)
    return () => window.removeEventListener('resize', resizeEditor)
  }, [])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (!isEmpty) {
        onSave()
      }
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()

      const textarea = textareaRef.current
      if (!textarea) {
        return
      }

      const { selectionStart, selectionEnd } = textarea
      const nextValue = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`

      onChange(nextValue)

      requestAnimationFrame(() => {
        if (!textareaRef.current) {
          return
        }

        textareaRef.current.selectionStart = selectionStart + 2
        textareaRef.current.selectionEnd = selectionStart + 2
      })
    }
  }

  const statusLabel = lastSavedAt
    ? `Saved ${lastSavedAt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })}`
    : isEmpty
      ? 'Idle'
      : 'Draft local'

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-black">
      <div className="sticky top-0 z-30 border-b border-line bg-black/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <button onClick={onExit} className="t-btn t-btn-ghost">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onClear}
              disabled={!value.length}
              className="t-btn t-btn-ghost"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
            <button
              onClick={onSave}
              disabled={isEmpty}
              className="t-btn t-btn-primary"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-4 md:px-6 lg:pt-6">
        <div className="mx-auto max-w-4xl">
          <div className="border border-line bg-background-secondary">
            <div className="px-4 pb-10 pt-5 md:px-8 md:pb-12 md:pt-8">
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write…"
                spellCheck={false}
                className="w-full resize-none overflow-hidden bg-transparent text-[16px] leading-[1.7] text-text-primary placeholder:text-text-muted focus:outline-none md:text-[17px]"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 font-mono text-[10px] tracking-[0.1em] uppercase text-text-muted">
            <div className="flex items-center gap-1.5">
              <Check className={`h-3 w-3 ${lastSavedAt ? 'text-accent-green' : 'text-text-muted'}`} />
              <span>{statusLabel}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Keyboard className="h-3 w-3" />
              <span>Ctrl+Enter</span>
            </div>
            <span className="sm:ml-auto tabular-nums">
              {stats.words}w / {stats.chars}c
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
