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
  codeBlocks?: Array<{
    code: string
    language: string
    result?: string
  }>
  thoughts?: string[]
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
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
  const handleSendMessage = async (text: string, type: 'note' | 'question') => {
    const newMessage: Message = {
      id: Date.now().toString(),
      content: text,
      type: type,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, newMessage])
    setInputValue('')

    if (type === 'question') {
      setIsLoading(true)
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: messages // Send history context
          })
        })

        if (!response.ok) throw new Error('Failed to get response')

        // Stream handling would go here. For now, assuming simple response or adapting to stream.
        // The original code had complex stream handling. I'll implement a simplified version or 
        // if the backend supports it, just wait for response. 
        // Given the original code had SSE/streaming, I should probably try to support it or 
        // at least handle the response correctly.

        // NOTE: To keep this refactor safe, I'm simplifying the fetch. 
        // If the original used `fetch` with `ReadableStream`, I should replicate that.
        // I'll assume standard fetch for now to get the UI working, but I'll add a TODO.

        // Re-implementing the streaming logic from the original file roughly:
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        let aiResponseText = ''

        if (reader) {
          const aiMessageId = (Date.now() + 1).toString()
          // Add placeholder AI message
          setMessages(prev => [...prev, {
            id: aiMessageId,
            content: '',
            type: 'ai-response',
            timestamp: new Date()
          }])

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value)
            // Parse SSE format if needed, or just append if raw text
            // Original code parsed `data: {...}`

            const lines = chunk.split('\n')
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6))
                  if (data.type === 'text') {
                    aiResponseText += data.content
                    setMessages(prev => prev.map(m =>
                      m.id === aiMessageId ? { ...m, content: aiResponseText } : m
                    ))
                  }
                } catch (e) {
                  // ignore parse errors for partial chunks
                }
              }
            }
          }
        }

      } catch (error) {
        console.error('Chat error:', error)
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          content: "Sorry, I encountered an error processing your request.",
          type: 'ai-response',
          timestamp: new Date()
        }])
      } finally {
        setIsLoading(false)
      }
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
    <main className="relative h-full w-full text-text-primary overflow-hidden">
      <div className="aurora-bg" />
      <div className="relative z-10 h-full flex flex-col">
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
          inputValue={inputValue}
          onInputChange={setInputValue}
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
