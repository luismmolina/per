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
    ? `Saved to notes at ${lastSavedAt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })}`
    : isEmpty
      ? 'Ready for a new note'
      : 'Draft stored locally'

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <div className="sticky top-0 z-30 border-b border-white/5 bg-black/40 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-text-muted transition-all hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClear}
              disabled={!value.length}
              className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-medium text-text-muted transition-all hover:border-white/20 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
            <button
              onClick={onSave}
              disabled={isEmpty}
              className="flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save as note</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-4 md:px-6 lg:pt-6">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-[30px] border border-white/10 bg-black/30 shadow-[0_24px_140px_-56px_rgba(0,0,0,0.95)] backdrop-blur-xl">
            <div className="px-6 pb-12 pt-8 md:px-10 md:pb-14 md:pt-10">
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Start writing..."
                spellCheck={false}
                className="w-full resize-none overflow-hidden bg-transparent font-serif text-[19px] leading-[1.95] tracking-[0.01em] text-[#f5efe2] placeholder:text-[#a59c89]/50 focus:outline-none md:text-[22px] md:leading-[2.05]"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-2 text-xs text-text-muted">
            <div className="flex items-center gap-1.5">
              <Check className={`h-3.5 w-3.5 ${lastSavedAt ? 'text-green-400' : 'text-white/40'}`} />
              <span>{statusLabel}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Keyboard className="h-3.5 w-3.5" />
              <span>Cmd/Ctrl + Enter saves</span>
            </div>
            <span className="sm:ml-auto">{stats.words} words / {stats.chars} chars</span>
          </div>
        </div>
      </div>
    </div>
  )
}
