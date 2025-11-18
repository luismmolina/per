'use client'

import React, { useRef, useEffect, useState } from 'react'
import { MessageBubble } from './ui/message-bubble'
import { InputArea } from './ui/input-area'
import { ArrowDown, Download } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

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
}

interface ChatInterfaceProps {
    messages: Message[]
    onSendMessage: (text: string, type: 'note' | 'question') => void
    onCopyMessage: (id: string, text: string) => void
    onDeleteMessage: (id: string) => void
    copiedMessageId: string | null
    isLoading: boolean
    inputChildren?: React.ReactNode
    isListening?: boolean
    onVoiceStart?: () => void
    onVoiceStop?: () => void
    inputValue: string
    onInputChange: (value: string) => void
    onDownloadNotes?: () => void
}

export const ChatInterface = ({
    messages,
    onSendMessage,
    onCopyMessage,
    onDeleteMessage,
    copiedMessageId,
    isLoading,
    inputChildren,
    isListening,
    onVoiceStart,
    onVoiceStop,
    inputValue,
    onInputChange,
    onDownloadNotes
}: ChatInterfaceProps) => {
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [showScrollButton, setShowScrollButton] = useState(false)

    const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior })
    }

    // Auto-scroll on new messages
    useEffect(() => {
        scrollToBottom()
    }, [messages, isLoading])

    // Scroll button visibility
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
            setShowScrollButton(!isNearBottom)
        }

        container.addEventListener('scroll', handleScroll)
        return () => container.removeEventListener('scroll', handleScroll)
    }, [])

    return (
        <div className="relative h-full flex flex-col">
            {/* Header Actions */}
            {onDownloadNotes && (
                <div className="absolute top-4 right-4 z-50">
                    <button
                        onClick={onDownloadNotes}
                        className="p-2 rounded-full bg-glass backdrop-blur-md border border-glass-border text-text-secondary hover:text-primary hover:bg-glass-hover transition-colors"
                        title="Download Notes"
                    >
                        <Download className="w-5 h-5" />
                    </button>
                </div>
            )}

            {/* Messages Area */}
            <div
                ref={containerRef}
                className="flex-1 overflow-y-auto custom-scrollbar px-4 pt-20 pb-32 scroll-smooth"
            >
                <div className="max-w-3xl mx-auto">
                    <AnimatePresence initial={false}>
                        {messages.map((msg) => (
                            <MessageBubble
                                key={msg.id}
                                message={msg}
                                onCopy={onCopyMessage}
                                onDelete={onDeleteMessage}
                                isCopied={copiedMessageId === msg.id}
                            />
                        ))}
                    </AnimatePresence>

                    {isLoading && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2 text-text-muted ml-4"
                        >
                            <div className="flex space-x-1">
                                <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                                <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                                <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                            </div>
                            <span className="text-xs">AI is thinking...</span>
                        </motion.div>
                    )}

                    <div ref={messagesEndRef} className="h-4" />
                </div>
            </div>

            {/* Scroll to Bottom Button */}
            <AnimatePresence>
                {showScrollButton && (
                    <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        onClick={() => scrollToBottom()}
                        className="absolute bottom-24 right-6 p-3 rounded-full bg-glass backdrop-blur-md border border-glass-border text-primary shadow-lg z-40 hover:bg-glass-hover transition-colors"
                    >
                        <ArrowDown className="w-5 h-5" />
                    </motion.button>
                )}
            </AnimatePresence>

            {/* Input Area */}
            <InputArea
                value={inputValue}
                onChange={onInputChange}
                onSend={onSendMessage}
                isLoading={isLoading}
                isListening={isListening}
                onVoiceStart={onVoiceStart}
                onVoiceStop={onVoiceStop}
            >
                {inputChildren}
            </InputArea>
        </div>
    )
}
