'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { VoiceSessionPanel } from '../components/voice-session-panel'
import { useVoiceRecorder } from '../lib/hooks/useVoiceRecorder'
import { ChatInterface } from '../components/chat-interface'

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

  // Handlers
  const buildConversationHistory = useCallback((history: Message[]) => {
    return history
      .filter((msg) => msg.type !== 'question')
      .map((msg) => ({
        role: msg.type === 'ai-response' ? 'model' : 'user',
        parts: [{ text: `[${msg.timestamp.toISOString()}] ${msg.content}` }]
      }))
  }, [])

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

    const historyPayload = buildConversationHistory([...messages, baseMessage])

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

  return (
    <main
      className="relative flex min-h-screen w-full text-text-primary overflow-hidden"
      style={{ minHeight: '100dvh' }}
    >
      <div className="aurora-bg" />
      <div className="relative z-10 flex flex-1 flex-col">
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
          inputChildren={
            voiceSession && voiceSession.status !== 'idle' && (
              <div className="mb-2">
                <VoiceSessionPanel session={voiceSession} onRetry={retryFailedChunk} />
              </div>
            )
          }
        />
      </div>
    </main>
  )
}
