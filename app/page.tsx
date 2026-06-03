'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { VoiceSessionPanel } from '../components/voice-session-panel'
import { useVoiceRecorder } from '../lib/hooks/useVoiceRecorder'
import { ChatInterface } from '../components/chat-interface'
import { DesktopWriter } from '../components/desktop-writer'
import { ExploreBoard } from '../components/explore-board'
import { Download, MessageSquare, Copy, Check, Sparkles, RefreshCw, Compass, Brain } from 'lucide-react'
import type { ExploreResult } from '../lib/explore'
import { formatExploreResultAsText } from '../lib/explore'
import { normalizeExploreResult } from '../lib/explore-response'

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

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout>()
  const hasLoadedConversationsRef = useRef(false)
  const [activeTab, setActiveTab] = useState<'chat' | 'write' | 'deepread' | 'consulting' | 'reframe' | 'explore'>('chat')
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

  // Consulting state
  const [consultingText, setConsultingText] = useState('')
  const [isGeneratingConsulting, setIsGeneratingConsulting] = useState(false)
  const [consultingError, setConsultingError] = useState<string | null>(null)
  const [consultingGeneratedAt, setConsultingGeneratedAt] = useState<Date | null>(null)
  const [consultingCopied, setConsultingCopied] = useState(false)
  const CONSULTING_STORAGE_KEY = 'ai-consulting-v1'

  // Reframe state
  const [reframeText, setReframeText] = useState('')
  const [isGeneratingReframe, setIsGeneratingReframe] = useState(false)
  const [reframeError, setReframeError] = useState<string | null>(null)
  const [reframeGeneratedAt, setReframeGeneratedAt] = useState<Date | null>(null)
  const [reframeCopied, setReframeCopied] = useState(false)
  const REFRAME_STORAGE_KEY = 'ai-reframe-v1'

  // Explore state
  const [exploreResult, setExploreResult] = useState<ExploreResult | null>(null)
  const [exploreObjective, setExploreObjective] = useState('Increase my profit')
  const [isGeneratingExplore, setIsGeneratingExplore] = useState(false)
  const [exploreError, setExploreError] = useState<string | null>(null)
  const [exploreGeneratedAt, setExploreGeneratedAt] = useState<Date | null>(null)
  const [exploreCopied, setExploreCopied] = useState(false)
  const EXPLORE_STORAGE_KEY = 'ai-explore-v1'
  const EXPLORE_OBJECTIVE_STORAGE_KEY = 'ai-explore-objective-v1'

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
            const parsedMessages = data.messages.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp)
            }))
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

  // Auto-save
  const debouncedSave = useCallback((messagesToSave: Message[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        if (!hasLoadedConversationsRef.current) return

        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: messagesToSave }),
        })

        if (response.ok) {
          const data = await response.json().catch(() => null)
          if (Array.isArray(data?.messages)) {
            const parsedMessages = data.messages.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp)
            }))
            setMessages(prev => mergeMessages(parsedMessages, prev))
          }
        }
      } catch (error) {
        console.error('Failed to save conversations:', error)
      }
    }, 1000)
  }, [mergeMessages])

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

  // Load/save reframe from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(REFRAME_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed?.text) setReframeText(parsed.text)
        if (parsed?.generatedAt) setReframeGeneratedAt(new Date(parsed.generatedAt))
      }
    } catch (error) {
      console.error('Failed to restore reframe from storage:', error)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(
        REFRAME_STORAGE_KEY,
        JSON.stringify({
          text: reframeText,
          generatedAt: reframeGeneratedAt ? reframeGeneratedAt.toISOString() : null
        })
      )
    } catch (error) {
      console.error('Failed to persist reframe to storage:', error)
    }
  }, [reframeText, reframeGeneratedAt])

  // Load/save explore output from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const savedObjective = localStorage.getItem(EXPLORE_OBJECTIVE_STORAGE_KEY)
      const fallbackObjective = savedObjective && savedObjective.trim().length > 0
        ? savedObjective
        : 'Increase my profit'
      if (savedObjective) {
        setExploreObjective(savedObjective)
      }

      const savedResult = localStorage.getItem(EXPLORE_STORAGE_KEY)
      if (savedResult) {
        const parsed = JSON.parse(savedResult)
        if (parsed?.result) {
          setExploreResult(normalizeExploreResult(parsed.result, fallbackObjective))
        }
        if (parsed?.generatedAt) {
          setExploreGeneratedAt(new Date(parsed.generatedAt))
        }
      }
    } catch (error) {
      console.error('Failed to restore explore output from storage:', error)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(EXPLORE_OBJECTIVE_STORAGE_KEY, exploreObjective)
      localStorage.setItem(
        EXPLORE_STORAGE_KEY,
        JSON.stringify({
          result: exploreResult,
          generatedAt: exploreGeneratedAt ? exploreGeneratedAt.toISOString() : null,
        })
      )
    } catch (error) {
      console.error('Failed to persist explore output to storage:', error)
    }
  }, [exploreGeneratedAt, exploreObjective, exploreResult])

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
          // Pass specialist AI outputs for cross-AI awareness
          specialistOutputs: {
            deepRead: longformText || null,
            consulting: consultingText || null,
            reframe: reframeText || null
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
            reframe: reframeText || null
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
            reframe: reframeText || null
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
      console.error('Consulting error:', error)
      setConsultingError(error instanceof Error ? error.message : 'Failed to generate consulting advice.')
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
    a.download = `ai-consulting-${new Date().toISOString().split('T')[0]}.txt`
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

  // Reframe handlers
  const handleGenerateReframe = async () => {
    setIsGeneratingReframe(true)
    setReframeError(null)

    try {
      const response = await fetch('/api/reframe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fetchAllNotes: true,
          currentDate: new Date().toISOString(),
          userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          peerOutputs: {
            deepRead: longformText || null,
            consulting: consultingText || null
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
      setReframeText('') // Clear previous text

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        setReframeText(prev => prev + chunk)
      }

      setReframeGeneratedAt(new Date())
    } catch (error) {
      console.error('Reframe error:', error)
      setReframeError(error instanceof Error ? error.message : 'Failed to generate reframe.')
    } finally {
      setIsGeneratingReframe(false)
    }
  }

  const handleDownloadReframe = () => {
    if (!reframeText.trim()) return
    const blob = new Blob([reframeText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reframe-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleCopyReframe = () => {
    if (!reframeText.trim()) return
    navigator.clipboard.writeText(reframeText)
    setReframeCopied(true)
    setTimeout(() => setReframeCopied(false), 2000)
  }

  const handleGenerateExplore = async () => {
    const trimmedObjective = exploreObjective.trim()
    if (!trimmedObjective) {
      setExploreError('Enter an objective first.')
      return
    }

    setIsGeneratingExplore(true)
    setExploreError(null)

    try {
      const response = await fetch('/api/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: trimmedObjective,
          fetchAllNotes: true,
          currentDate: new Date().toISOString(),
          userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          peerOutputs: {
            deepRead: longformText || null,
            consulting: consultingText || null,
            reframe: reframeText || null,
          },
        }),
      })

      let payload: any = null
      try {
        payload = await response.json()
      } catch (error) {
        payload = null
      }

      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to generate exploration ideas.')
      }

      setExploreResult(normalizeExploreResult(payload, trimmedObjective))
      setExploreGeneratedAt(new Date())
    } catch (error) {
      console.error('Explore error:', error)
      setExploreError(error instanceof Error ? error.message : 'Failed to generate exploration ideas.')
    } finally {
      setIsGeneratingExplore(false)
    }
  }

  const handleCopyExplore = () => {
    if (!exploreResult) return
    navigator.clipboard.writeText(formatExploreResultAsText(exploreResult))
    setExploreCopied(true)
    setTimeout(() => setExploreCopied(false), 2000)
  }

  const handleDownloadExplore = () => {
    if (!exploreResult) return
    const blob = new Blob([formatExploreResultAsText(exploreResult)], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `explore-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
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
  const exploreResultIsStale = exploreResult && exploreResult.objective.trim() !== exploreObjective.trim()

  return (
    <main
      className="relative flex min-h-screen w-full text-text-primary overflow-hidden"
      style={{ minHeight: '100dvh' }}
    >
      <div className="aurora-bg" />
      <div className="relative z-10 flex flex-1 flex-col">

        <AnimatePresence mode="wait">
          {activeTab === 'chat' && (
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
                onSwitchToConsulting={() => setActiveTab('consulting')}
                onSwitchToReframe={() => setActiveTab('reframe')}
                onSwitchToExplore={() => setActiveTab('explore')}
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
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
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

          {activeTab === 'deepread' && (
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

              <div className="flex-1 overflow-y-auto px-4 pb-32 pt-6 md:px-6">
                <div className="max-w-2xl mx-auto py-8 md:py-12 text-lg md:text-xl leading-relaxed text-[#e8dfc8] font-serif">
                  {longformError && (
                    <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-200 p-4">
                      {longformError}
                    </div>
                  )}

                  {!longformText && !isGeneratingLongform && !longformError && (
                    <div className="text-base text-text-muted space-y-4">
                      <p>Your deep read lives here. I&apos;ll craft a long-form piece from your notes that speaks directly to how you think.</p>
                      <p>Hit &quot;Regenerate&quot; once you have notes. I&apos;ll keep the last version locally until you overwrite it. You can download it anytime.</p>
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

          {activeTab === 'consulting' && (
            <motion.div
              key="consulting"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex flex-col"
            >
              {/* Compact Consulting Header */}
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
                    {isGeneratingConsulting ? (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                        <span className="text-xs text-teal-300/80 font-medium">Analyzing...</span>
                      </div>
                    ) : consultingGeneratedAt ? (
                      <span className="text-[11px] text-text-muted">
                        {consultingGeneratedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    ) : (
                      <span className="text-[11px] text-text-muted">Not generated yet</span>
                    )}
                  </div>

                  {/* Right: Action buttons */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleCopyConsulting}
                      disabled={!consultingText.trim()}
                      className="p-2 rounded-full border border-white/10 text-text-muted hover:text-white hover:border-white/20 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      title="Copy to clipboard"
                    >
                      {consultingCopied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={handleDownloadConsulting}
                      disabled={!consultingText.trim()}
                      className="p-2 rounded-full border border-white/10 text-text-muted hover:text-white hover:border-white/20 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleGenerateConsulting}
                      disabled={isGeneratingConsulting}
                      className="flex items-center gap-2 px-3 py-1.5 sm:px-4 rounded-full text-xs font-medium bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      {consultingText ? <RefreshCw className="w-3.5 h-3.5" /> : <Compass className="w-3.5 h-3.5" />}
                      <span className={consultingText ? "hidden sm:inline" : ""}>
                        {consultingText ? 'Regenerate' : 'Generate'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-32 pt-6 md:px-6">
                <div className="max-w-2xl mx-auto py-8 md:py-12 text-lg md:text-xl leading-relaxed text-[#d7e8e4] font-serif">
                  {consultingError && (
                    <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-200 p-4">
                      {consultingError}
                    </div>
                  )}

                  {!consultingText && !isGeneratingConsulting && !consultingError && (
                    <div className="text-base text-text-muted space-y-4">
                      <p>Your strategic advisor lives here. I&apos;ll analyze your notes and give you clear, first-principles advice to move you from A to B as fast as possible.</p>
                      <p>Hit &quot;Generate&quot; to get actionable recommendations based on your current data. No motivation, no fluff—just math and logic.</p>
                    </div>
                  )}

                  {isGeneratingConsulting && (
                    <div className="text-base text-text-muted animate-pulse">Analyzing your notes with first-principles logic…</div>
                  )}

                  {!isGeneratingConsulting && consultingText && (
                    <div className="text-[18px] md:text-[19px]">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ node, ...props }) => <p className="mb-8 text-[#d7f0e8] leading-8 tracking-wide text-[1.15rem] md:text-[1.25rem] font-serif" {...props} />,
                          h1: ({ node, ...props }) => <h1 className="text-3xl md:text-4xl font-serif font-bold mb-8 text-teal-50 mt-12 tracking-tight border-b border-white/10 pb-4" {...props} />,
                          h2: ({ node, ...props }) => <h2 className="text-2xl md:text-3xl font-serif font-semibold mb-6 text-teal-100 mt-10 tracking-tight" {...props} />,
                          h3: ({ node, ...props }) => <h3 className="text-xl md:text-2xl font-serif font-medium mb-4 text-teal-200 mt-8" {...props} />,
                          ul: ({ node, ...props }) => <ul className="list-disc pl-6 mb-8 space-y-3 text-[#d7f0e8] text-[1.1rem] leading-7 font-serif" {...props} />,
                          ol: ({ node, ...props }) => <ol className="list-decimal pl-6 mb-8 space-y-3 text-[#d7f0e8] text-[1.1rem] leading-7 font-serif" {...props} />,
                          li: ({ node, ...props }) => <li className="pl-2 marker:text-teal-400/50" {...props} />,
                          blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-teal-400/30 pl-6 italic my-10 py-2 text-xl text-teal-100/90 font-serif leading-relaxed" {...props} />,
                          code: ({ node, ...props }) => <code className="bg-white/5 rounded px-1.5 py-0.5 text-sm font-mono text-teal-100/90 border border-white/10" {...props} />,
                          pre: ({ node, ...props }) => <pre className="bg-[#1a1a1a] rounded-xl p-6 mb-8 overflow-x-auto border border-white/5 shadow-inner" {...props} />,
                          strong: ({ node, ...props }) => <strong className="font-bold text-teal-50" {...props} />,
                          em: ({ node, ...props }) => <em className="italic text-teal-100 self-text" {...props} />,
                        }}
                      >
                        {consultingText}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'reframe' && (
            <motion.div
              key="reframe"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex flex-col"
            >
              {/* Compact Reframe Header */}
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
                    {isGeneratingReframe ? (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                        <span className="text-xs text-violet-300/80 font-medium">Dissolving...</span>
                      </div>
                    ) : reframeGeneratedAt ? (
                      <span className="text-[11px] text-text-muted">
                        {reframeGeneratedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    ) : (
                      <span className="text-[11px] text-text-muted">Not generated yet</span>
                    )}
                  </div>

                  {/* Right: Action buttons */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleCopyReframe}
                      disabled={!reframeText.trim()}
                      className="p-2 rounded-full border border-white/10 text-text-muted hover:text-white hover:border-white/20 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      title="Copy to clipboard"
                    >
                      {reframeCopied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={handleDownloadReframe}
                      disabled={!reframeText.trim()}
                      className="p-2 rounded-full border border-white/10 text-text-muted hover:text-white hover:border-white/20 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleGenerateReframe}
                      disabled={isGeneratingReframe}
                      className="flex items-center gap-2 px-3 py-1.5 sm:px-4 rounded-full text-xs font-medium bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      {reframeText ? <RefreshCw className="w-3.5 h-3.5" /> : <Brain className="w-3.5 h-3.5" />}
                      <span className={reframeText ? "hidden sm:inline" : ""}>
                        {reframeText ? 'Regenerate' : 'Generate'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-32 pt-6 md:px-6">
                <div className="max-w-2xl mx-auto py-8 md:py-12 text-lg md:text-xl leading-relaxed text-[#e4d7f0] font-serif">
                  {reframeError && (
                    <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-200 p-4">
                      {reframeError}
                    </div>
                  )}

                  {!reframeText && !isGeneratingReframe && !reframeError && (
                    <div className="text-base text-text-muted space-y-4">
                      <p>Your mental relief lives here. I&apos;ll find one cognitive loop you&apos;re stuck in and dissolve it with a perspective shift.</p>
                      <p>Hit &quot;Generate&quot; when you&apos;re feeling stuck, guilty, or caught in a decision loop. I&apos;ll give you a short reframe that lets your mind rest.</p>
                    </div>
                  )}

                  {isGeneratingReframe && (
                    <div className="text-base text-text-muted animate-pulse">Finding the loop and dissolving it…</div>
                  )}

                  {!isGeneratingReframe && reframeText && (
                    <div className="text-[18px] md:text-[19px]">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ node, ...props }) => <p className="mb-8 text-[#f0e4f7] leading-8 tracking-wide text-[1.15rem] md:text-[1.25rem] font-serif" {...props} />,
                          h1: ({ node, ...props }) => <h1 className="text-3xl md:text-4xl font-serif font-bold mb-8 text-violet-50 mt-12 tracking-tight border-b border-white/10 pb-4" {...props} />,
                          h2: ({ node, ...props }) => <h2 className="text-2xl md:text-3xl font-serif font-semibold mb-6 text-violet-100 mt-10 tracking-tight" {...props} />,
                          h3: ({ node, ...props }) => <h3 className="text-xl md:text-2xl font-serif font-medium mb-4 text-violet-200 mt-8" {...props} />,
                          ul: ({ node, ...props }) => <ul className="list-disc pl-6 mb-8 space-y-3 text-[#f0e4f7] text-[1.1rem] leading-7 font-serif" {...props} />,
                          ol: ({ node, ...props }) => <ol className="list-decimal pl-6 mb-8 space-y-3 text-[#f0e4f7] text-[1.1rem] leading-7 font-serif" {...props} />,
                          li: ({ node, ...props }) => <li className="pl-2 marker:text-violet-400/50" {...props} />,
                          blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-violet-400/30 pl-6 italic my-10 py-2 text-xl text-violet-100/90 font-serif leading-relaxed" {...props} />,
                          code: ({ node, ...props }) => <code className="bg-white/5 rounded px-1.5 py-0.5 text-sm font-mono text-violet-100/90 border border-white/10" {...props} />,
                          pre: ({ node, ...props }) => <pre className="bg-[#1a1a1a] rounded-xl p-6 mb-8 overflow-x-auto border border-white/5 shadow-inner" {...props} />,
                          strong: ({ node, ...props }) => <strong className="font-bold text-violet-50" {...props} />,
                          em: ({ node, ...props }) => <em className="italic text-violet-100 self-text" {...props} />,
                        }}
                      >
                        {reframeText}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'explore' && (
            <motion.div
              key="explore"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex flex-col"
            >
              <div className="sticky top-0 z-30 px-4 py-3 md:px-6 backdrop-blur-xl bg-black/60 border-b border-white/5">
                <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setActiveTab('chat')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-text-muted hover:text-white hover:bg-white/10 border border-white/10 transition-all"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Chat</span>
                    </button>
                    <div className="w-px h-4 bg-white/10" />
                    {isGeneratingExplore ? (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                        <span className="text-xs text-sky-200/80 font-medium">Exploring...</span>
                      </div>
                    ) : exploreGeneratedAt ? (
                      <span className="text-[11px] text-text-muted">
                        {exploreGeneratedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    ) : (
                      <span className="text-[11px] text-text-muted">Not generated yet</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleCopyExplore}
                      disabled={!exploreResult}
                      className="p-2 rounded-full border border-white/10 text-text-muted hover:text-white hover:border-white/20 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      title="Copy to clipboard"
                    >
                      {exploreCopied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={handleDownloadExplore}
                      disabled={!exploreResult}
                      className="p-2 rounded-full border border-white/10 text-text-muted hover:text-white hover:border-white/20 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleGenerateExplore}
                      disabled={isGeneratingExplore}
                      className="flex items-center gap-2 px-3 py-1.5 sm:px-4 rounded-full text-xs font-medium bg-sky-500/20 text-sky-200 border border-sky-500/30 hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      {exploreResult ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                      <span className={exploreResult ? 'hidden sm:inline' : ''}>
                        {exploreResult ? 'Regenerate' : 'Generate'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-32 pt-6 md:px-6">
                <div className="max-w-5xl mx-auto py-8 md:py-12 space-y-8">
                  <section className="rounded-[2rem] border border-white/10 bg-white/5 p-5 md:p-6">
                    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                      <div className="space-y-3 max-w-3xl">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200/70">Explore Objective</p>
                        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white">Novel options, not echoes</h1>
                        <p className="text-sm leading-7 text-white/70">
                          Type the objective you want to improve. The system will separate ideas that are already yours from options that are actually new, then attach short tests.
                        </p>
                      </div>
                      <div className="rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-sky-100/80">
                        Novelty-first mode
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 md:flex-row">
                      <input
                        value={exploreObjective}
                        onChange={(event) => setExploreObjective(event.target.value)}
                        placeholder="Increase my profit"
                        className="flex-1 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-base text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                      />
                      <button
                        onClick={handleGenerateExplore}
                        disabled={isGeneratingExplore || !exploreObjective.trim()}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-sky-400/30 bg-sky-500/15 px-5 py-3 text-sm font-medium text-sky-100 transition-all hover:bg-sky-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Sparkles className="w-4 h-4" />
                        Explore objective
                      </button>
                    </div>

                    {exploreResultIsStale && (
                      <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/85">
                        The visible board was generated for <span className="font-medium">{exploreResult?.objective}</span>. Generate again to refresh it for your current objective.
                      </div>
                    )}
                  </section>

                  {exploreError && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-200 p-4">
                      {exploreError}
                    </div>
                  )}

                  {isGeneratingExplore && (
                    <div className="rounded-[2rem] border border-sky-400/20 bg-sky-500/10 p-6 text-base text-sky-100/80 animate-pulse">
                      Scanning your notes, separating your own ideas from adjacent ones, and forcing a wider search space for new options...
                    </div>
                  )}

                  {!isGeneratingExplore && !exploreResult && !exploreError && (
                    <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 text-base text-text-muted space-y-4">
                      <p>Start with a concrete objective such as <span className="text-white">Increase my profit</span>, <span className="text-white">Reduce waiter dependency</span>, or <span className="text-white">Find revenue outside the buffet</span>.</p>
                      <p>The board will show what is already in your notes, where the blind spots are, and which experiments are new enough to be worth testing.</p>
                    </div>
                  )}

                  {!isGeneratingExplore && exploreResult && (
                    <ExploreBoard result={exploreResult} />
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
