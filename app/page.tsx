'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { VoiceSessionPanel } from '../components/voice-session-panel'
import { useVoiceRecorder } from '../lib/hooks/useVoiceRecorder'
import { ChatInterface } from '../components/chat-interface'
import { Download, MessageSquare, BookOpen, Copy, Check, Sparkles, RefreshCw, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { motion, AnimatePresence } from 'framer-motion'

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
  const [longformCopied, setLongformCopied] = useState(false)
  const LONGFORM_STORAGE_KEY = 'deep-read-longform-v1'

  // Insights panel state
  interface Insight {
    emoji: string
    title: string
    summary: string
    evidence: string
  }
  const [insights, setInsights] = useState<Insight[]>([])
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false)
  const [insightsError, setInsightsError] = useState<string | null>(null)
  const [insightsExpanded, setInsightsExpanded] = useState(true)
  const [lastInsightsGeneratedAt, setLastInsightsGeneratedAt] = useState<Date | null>(null)
  const INSIGHTS_STORAGE_KEY = 'deep-read-insights-v1'

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

  // Load insights from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(INSIGHTS_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed?.insights) setInsights(parsed.insights)
        if (parsed?.generatedAt) setLastInsightsGeneratedAt(new Date(parsed.generatedAt))
      }
    } catch (error) {
      console.error('Failed to restore insights from storage:', error)
    }
  }, [])

  // Save insights to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(
        INSIGHTS_STORAGE_KEY,
        JSON.stringify({
          insights,
          generatedAt: lastInsightsGeneratedAt ? lastInsightsGeneratedAt.toISOString() : null
        })
      )
    } catch (error) {
      console.error('Failed to persist insights to storage:', error)
    }
  }, [insights, lastInsightsGeneratedAt])

  // Generate insights handler
  const handleGenerateInsights = async () => {
    setIsGeneratingInsights(true)
    setInsightsError(null)

    try {
      const response = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentDate: new Date().toISOString(),
          userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      })

      if (!response.ok) {
        let errorMsg = 'Failed to generate insights.'
        try {
          const payload = await response.json()
          errorMsg = payload.error || errorMsg
        } catch (e) {
          errorMsg = await response.text() || errorMsg
        }
        throw new Error(errorMsg)
      }

      const data = await response.json()
      if (data.insights && Array.isArray(data.insights)) {
        setInsights(data.insights)
        setLastInsightsGeneratedAt(new Date())
      } else {
        throw new Error('Invalid insights response format')
      }
    } catch (error) {
      console.error('Insights error:', error)
      setInsightsError(error instanceof Error ? error.message : 'Failed to generate insights.')
    } finally {
      setIsGeneratingInsights(false)
    }
  }

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
          fetchAllNotes: true, // Tell server to fetch from DB
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

  const handleCopyLongform = () => {
    if (!longformText.trim()) return
    navigator.clipboard.writeText(longformText)
    setLongformCopied(true)
    setTimeout(() => setLongformCopied(false), 2000)
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

        <AnimatePresence mode="wait">
          {activeTab === 'chat' ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex flex-col h-full"
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
                onSwitchToDeepRead={() => setActiveTab('deepread')}
                inputChildren={
                  voiceSession && voiceSession.status !== 'idle' && (
                    <div className="mb-2">
                      <VoiceSessionPanel session={voiceSession} onRetry={retryFailedChunk} />
                    </div>
                  )
                }
              />
            </motion.div>
          ) : (
            <motion.div
              key="deepread"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex flex-col"
            >
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
                      onClick={handleCopyLongform}
                      disabled={!longformText.trim()}
                      className="p-2 rounded-full border border-white/10 text-text-muted hover:text-white hover:border-white/20 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      title="Copy to clipboard"
                    >
                      {longformCopied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
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
                      className="flex items-center gap-2 px-3 py-1.5 sm:px-4 rounded-full text-xs font-medium bg-white/10 text-white border border-white/20 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      {longformText ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                      <span className={longformText ? "hidden sm:inline" : ""}>
                        {longformText ? 'Regenerate' : 'Generate'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Insights Panel */}
              <div className="px-4 md:px-6 pt-6">
                <div className="max-w-2xl mx-auto">
                  <div className="rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-900/20 to-amber-800/10 backdrop-blur-sm overflow-hidden">
                    {/* Insights Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-amber-400/10">
                      <button
                        onClick={() => setInsightsExpanded(!insightsExpanded)}
                        className="flex items-center gap-2 text-amber-200 hover:text-amber-100 transition-colors"
                      >
                        <Lightbulb className="w-4 h-4" />
                        <span className="text-sm font-medium">Your Core Insights</span>
                        {insightsExpanded ? (
                          <ChevronUp className="w-4 h-4 text-amber-400/60" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-amber-400/60" />
                        )}
                      </button>
                      <div className="flex items-center gap-2">
                        {lastInsightsGeneratedAt && (
                          <span className="text-[10px] text-amber-300/50">
                            {lastInsightsGeneratedAt.toLocaleString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                        <button
                          onClick={handleGenerateInsights}
                          disabled={isGeneratingInsights}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-400/10 text-amber-200 border border-amber-400/20 hover:bg-amber-400/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                          {isGeneratingInsights ? (
                            <>
                              <div className="w-3 h-3 border-2 border-amber-200/30 border-t-amber-200 rounded-full animate-spin" />
                              <span>Generating...</span>
                            </>
                          ) : (
                            <>
                              {insights.length > 0 ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                              <span>{insights.length > 0 ? 'Refresh' : 'Generate'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Insights Content */}
                    <AnimatePresence>
                      {insightsExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="p-4 space-y-3">
                            {insightsError && (
                              <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-200 p-3">
                                {insightsError}
                              </div>
                            )}

                            {insights.length === 0 && !isGeneratingInsights && !insightsError && (
                              <p className="text-sm text-amber-200/60 text-center py-4">
                                Generate insights from your notes to see recurring patterns and lessons learned.
                              </p>
                            )}

                            {isGeneratingInsights && insights.length === 0 && (
                              <div className="text-center py-6">
                                <div className="w-6 h-6 border-2 border-amber-200/30 border-t-amber-200 rounded-full animate-spin mx-auto mb-2" />
                                <p className="text-sm text-amber-200/60">Analyzing your notes...</p>
                              </div>
                            )}

                            {insights.map((insight, index) => (
                              <div
                                key={index}
                                className="group rounded-xl bg-black/20 border border-white/5 hover:border-amber-400/20 transition-colors p-3"
                              >
                                <div className="flex gap-3">
                                  <span className="text-xl flex-shrink-0">{insight.emoji}</span>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-semibold text-amber-100 mb-1">{insight.title}</h4>
                                    <p className="text-xs text-amber-200/70 leading-relaxed mb-2">{insight.summary}</p>
                                    <details className="group/details">
                                      <summary className="text-[10px] text-amber-300/40 cursor-pointer hover:text-amber-300/60 transition-colors">
                                        View evidence
                                      </summary>
                                      <p className="mt-2 text-[11px] text-amber-200/50 italic leading-relaxed border-l-2 border-amber-400/20 pl-2">
                                        &ldquo;{insight.evidence}&rdquo;
                                      </p>
                                    </details>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
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
                          p: ({ node, ...props }) => <p className="mb-8 text-[#f0e8d7] leading-8 tracking-wide text-[1.15rem] md:text-[1.25rem] font-serif" {...props} />,
                          h1: ({ node, ...props }) => <h1 className="text-3xl md:text-4xl font-serif font-bold mb-8 text-amber-50 mt-12 tracking-tight border-b border-white/10 pb-4" {...props} />,
                          h2: ({ node, ...props }) => <h2 className="text-2xl md:text-3xl font-serif font-semibold mb-6 text-amber-100 mt-10 tracking-tight" {...props} />,
                          h3: ({ node, ...props }) => <h3 className="text-xl md:text-2xl font-serif font-medium mb-4 text-amber-200 mt-8" {...props} />,
                          ul: ({ node, ...props }) => <ul className="list-disc pl-6 mb-8 space-y-3 text-[#f0e8d7] text-[1.1rem] leading-7 font-serif" {...props} />,
                          ol: ({ node, ...props }) => <ol className="list-decimal pl-6 mb-8 space-y-3 text-[#f0e8d7] text-[1.1rem] leading-7 font-serif" {...props} />,
                          li: ({ node, ...props }) => <li className="pl-2 marker:text-amber-400/50" {...props} />,
                          blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-amber-400/30 pl-6 italic my-10 py-2 text-xl text-amber-100/90 font-serif leading-relaxed" {...props} />,
                          code: ({ node, ...props }) => <code className="bg-white/5 rounded px-1.5 py-0.5 text-sm font-mono text-amber-100/90 border border-white/10" {...props} />,
                          pre: ({ node, ...props }) => <pre className="bg-[#1a1a1a] rounded-xl p-6 mb-8 overflow-x-auto border border-white/5 shadow-inner" {...props} />,
                          strong: ({ node, ...props }) => <strong className="font-bold text-amber-50" {...props} />,
                          em: ({ node, ...props }) => <em className="italic text-amber-100 self-text" {...props} />,
                        }}
                      >
                        {longformText}
                      </ReactMarkdown>
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
