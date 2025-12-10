'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { VoiceSessionPanel } from '../components/voice-session-panel'
import { useVoiceRecorder } from '../lib/hooks/useVoiceRecorder'
import { ChatInterface } from '../components/chat-interface'
import { Download, MessageSquare, BookOpen } from 'lucide-react'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout>()
  const [activeTab, setActiveTab] = useState<'chat' | 'deepread'>('chat')
  const [longformText, setLongformText] = useState('')
  const [isGeneratingLongform, setIsGeneratingLongform] = useState(false)
  const [longformError, setLongformError] = useState<string | null>(null)
  const [lastGeneratedAt, setLastGeneratedAt] = useState<Date | null>(null)
  const LONGFORM_STORAGE_KEY = 'deep-read-longform-v1'

  // Voice Recorder Hook
  const {
    isRecording,
    isTranscribing,
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
          if (data.messages && data.messages.length > 0) {
            const parsedMessages = data.messages.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp)
            }))
            setMessages(parsedMessages)
          }
        }
      } catch (error) {
        console.error('Failed to load conversations:', error)
      }
    }
    loadConversations()
  }, [])

  // Auto-save
  const debouncedSave = useCallback((messagesToSave: Message[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: messagesToSave }),
        })
      } catch (error) {
        console.error('Failed to save conversations:', error)
      }
    }, 1000)
  }, [])

  useEffect(() => {
    if (messages.length > 0) debouncedSave(messages)
  }, [messages, debouncedSave])

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
    return history
      .filter((msg) => msg.type !== 'question')
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
          userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
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

  const handleDeleteMessage = (id: string) => {
    if (confirm('Delete this note?')) {
      setMessages(prev => prev.filter(m => m.id !== id))
    }
  }

  const handleDownloadNotes = () => {
    const notes = messages
      .filter(m => m.type === 'note')
      .map(m => `[${m.timestamp.toLocaleString()}] ${m.content}`)
      .join('\n\n')

    const blob = new Blob([notes], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `notes-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleGenerateLongform = async () => {
    const noteLines = messages
      .filter(m => m.type === 'note')
      .map(m => `[${formatTimestampForAI(m.timestamp)}] (${m.type}) ${m.content}`)
      .join('\n')

    if (!noteLines) {
      setLongformError('Add some notes first so I have something to synthesize.')
      return
    }

    setIsGeneratingLongform(true)
    setLongformError(null)

    try {
      const response = await fetch('/api/longform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: noteLines,
          currentDate: new Date().toISOString(),
          userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
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
      let accumulatedText = ''
      setLongformText('') // Clear previous text

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        accumulatedText += chunk
        setLongformText(prev => prev + chunk)
      }

      setLastGeneratedAt(new Date())
    } catch (error) {
      console.error('Longform error:', error)
      setLongformError(error instanceof Error ? error.message : 'Failed to generate the deep read.')
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
    a.download = `deep-read-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const longformParagraphs = longformText
    ? longformText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    : []

  return (
    <main
      className="relative flex min-h-screen w-full text-text-primary overflow-hidden"
      style={{ minHeight: '100dvh' }}
    >
      <div className="aurora-bg" />
      <div className="relative z-10 flex flex-1 flex-col">

        {activeTab === 'chat' ? (
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
            onSwitchToDeepRead={() => setActiveTab('deepread')}
            inputChildren={
              voiceSession && voiceSession.status !== 'idle' && (
                <div className="mb-2">
                  <VoiceSessionPanel session={voiceSession} onRetry={retryFailedChunk} />
                </div>
              )
            }
          />
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Compact Deep Read Header */}
            <div className="sticky top-0 z-30 px-4 py-3 md:px-6 backdrop-blur-xl bg-black/60 border-b border-white/5">
              <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
                {/* Left: Back button + Status indicator */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setActiveTab('chat')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-text-muted hover:text-white hover:bg-white/10 border border-white/10 transition-all"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Chat</span>
                  </button>
                  <div className="w-px h-4 bg-white/10" />
                  {isGeneratingLongform ? (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-xs text-amber-300/80 font-medium">Synthesizing...</span>
                    </div>
                  ) : lastGeneratedAt ? (
                    <span className="text-[11px] text-text-muted">
                      {lastGeneratedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  ) : (
                    <span className="text-[11px] text-text-muted">Not generated yet</span>
                  )}
                </div>

                {/* Right: Action buttons */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleDownloadLongform}
                    disabled={!longformText.trim()}
                    className="p-2 rounded-full border border-white/10 text-text-muted hover:text-white hover:border-white/20 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleGenerateLongform}
                    disabled={isGeneratingLongform}
                    className="px-4 py-1.5 rounded-full text-xs font-medium bg-white/10 text-white border border-white/20 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {longformText ? 'Regenerate' : 'Generate'}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-32 pt-6 md:px-6">
              <div className="max-w-2xl mx-auto py-8 md:py-12 text-lg md:text-xl leading-relaxed text-[#e8dfc8] font-serif">
                {longformError && (
                  <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-200 p-4">
                    {longformError}
                  </div>
                )}

                {!longformText && !isGeneratingLongform && !longformError && (
                  <div className="text-base text-text-muted space-y-4">
                    <p>Your deep read lives here. I’ll craft a long-form piece from your notes that speaks directly to how you think.</p>
                    <p>Hit “Regenerate” once you have notes. I’ll keep the last version locally until you overwrite it. You can download it anytime.</p>
                  </div>
                )}

                {isGeneratingLongform && (
                  <div className="text-base text-text-muted animate-pulse">Synthesizing your notes into a focused read…</div>
                )}

                {!isGeneratingLongform && longformText && (
                  <div className="text-[18px] md:text-[19px]">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ node, ...props }) => <p className="mb-6 text-[#f0e8d7]" {...props} />,
                        h1: ({ node, ...props }) => <h1 className="text-2xl font-bold mb-4 text-white mt-8" {...props} />,
                        h2: ({ node, ...props }) => <h2 className="text-xl font-bold mb-3 text-white mt-6" {...props} />,
                        h3: ({ node, ...props }) => <h3 className="text-lg font-bold mb-2 text-white mt-4" {...props} />,
                        ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-6 space-y-2 text-[#f0e8d7]" {...props} />,
                        ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-6 space-y-2 text-[#f0e8d7]" {...props} />,
                        li: ({ node, ...props }) => <li className="pl-1" {...props} />,
                        blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-white/20 pl-4 italic my-6 text-white/80" {...props} />,
                        code: ({ node, ...props }) => <code className="bg-white/10 rounded px-1 py-0.5 text-sm font-mono text-white/90" {...props} />,
                        pre: ({ node, ...props }) => <pre className="bg-black/30 rounded-lg p-4 mb-6 overflow-x-auto" {...props} />,
                      }}
                    >
                      {longformText}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}


      </div>
    </main>
  )
}
