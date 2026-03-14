'use client'

import React, { useEffect, useMemo, useRef } from 'react'
import { Check, FileText, Keyboard, MessageSquare, Save, Trash2 } from 'lucide-react'

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

    const minHeight = Math.max(520, window.innerHeight - 280)
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
    : 'Draft autosaves locally on this device'

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <div className="sticky top-0 z-30 border-b border-white/5 bg-black/50 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={onExit}
              className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-text-muted transition-all hover:bg-white/10 hover:text-white"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Chat</span>
            </button>
            <div className="h-4 w-px bg-white/10" />
            <div>
              <div className="text-sm font-medium text-[#f3ecdd]">Zen Writer</div>
              <div className="text-[11px] text-text-muted">Desktop-only long-form space with less noise.</div>
            </div>
          </div>

          <div className="hidden xl:flex items-center gap-4 text-xs text-text-muted">
            <div className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span>{stats.words} words</span>
            </div>
            <div>{stats.chars} chars</div>
          </div>

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
              <span>Save note</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-16 pt-6 md:px-6 lg:pt-10">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-[28px] border border-white/10 bg-black/35 shadow-[0_24px_140px_-56px_rgba(0,0,0,0.95)] backdrop-blur-xl">
            <div className="border-b border-white/5 px-6 py-4 md:px-10">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <p className="text-sm text-[#efe7d7]">Write without the chat stream, floating buttons, or AI in your face.</p>
                  <p className="text-xs text-text-muted">When you are ready, save the whole draft as one note.</p>
                </div>

                <div className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-text-muted">
                  <Keyboard className="h-3.5 w-3.5" />
                  <span>Cmd/Ctrl + Enter saves</span>
                </div>
              </div>
            </div>

            <div className="px-6 pb-12 pt-8 md:px-10">
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Write freely here...\n\nThis space stays quiet on purpose. The draft autosaves locally, and when you choose to save it, the full text becomes one note.`}
                spellCheck={true}
                className="w-full resize-none overflow-hidden bg-transparent font-serif text-[18px] leading-9 tracking-[0.01em] text-[#f5efe2] placeholder:text-[#a59c89]/60 focus:outline-none md:text-[21px] md:leading-10"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 px-2 text-xs text-text-muted">
            <div className="flex items-center gap-1.5">
              <Check className={`h-3.5 w-3.5 ${lastSavedAt ? 'text-green-400' : 'text-white/40'}`} />
              <span>{statusLabel}</span>
            </div>
            <span className="hidden sm:inline">{stats.words} words / {stats.chars} chars</span>
          </div>
        </div>
      </div>
    </div>
  )
}
