'use client'

import React, { useRef, useEffect, useState } from 'react'
import { MessageBubble } from './ui/message-bubble'
import { InputArea } from './ui/input-area'
import { ArrowDown, Download, ChevronUp } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface Message {
    id: string
    content: string
    type: 'note' | 'question' | 'ai-response'
    timestamp: Date
    currentThought?: string | null
    codeBlocks?: Array<{
        code: string
        language: string
        result?: string
    }>
    thoughts?: string[]
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
    onDownloadNotes
}: ChatInterfaceProps) => {
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [showScrollButton, setShowScrollButton] = useState(false)
    const [inputHeight, setInputHeight] = useState(140)
    const [keyboardInset, setKeyboardInset] = useState(0)
    const [visibleCount, setVisibleCount] = useState(8)

    const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior })
    }

    // Auto-scroll on new messages
    useEffect(() => {
        // Only scroll to bottom if we are showing the latest messages or if it's a new message
        scrollToBottom()
    }, [messages, isLoading])

    const visibleMessages = messages.slice(-visibleCount)
    const hasMoreMessages = messages.length > visibleCount

    const handleLoadMore = () => {
        setVisibleCount(prev => prev + 8)
    }

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

    // Track keyboard inset so the input hugs the top of the keyboard on mobile.
    useEffect(() => {
        const viewport = window.visualViewport
        if (!viewport) return

        const updateInset = () => {
            const inset = Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop))
            setKeyboardInset(inset)
        }

        updateInset()
        viewport.addEventListener('resize', updateInset)
        viewport.addEventListener('scroll', updateInset)
        return () => {
            viewport.removeEventListener('resize', updateInset)
            viewport.removeEventListener('scroll', updateInset)
        }
    }, [])

    // Keep the latest messages visible when the keyboard opens.
    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const { scrollTop, scrollHeight, clientHeight } = container
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 140
        if (isNearBottom) {
            scrollToBottom('auto')
        }
    }, [keyboardInset])

    const contentBottomPadding = Math.max(140, inputHeight + keyboardInset + 40)

    return (
        <div className="relative h-full flex flex-col">
            {/* Header Actions */}
            {onDownloadNotes && (
                <div className="absolute top-4 right-4 z-50">
                    <button
                        onClick={onDownloadNotes}
                        className="p-2 rounded-full bg-white/5 backdrop-blur-md border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                        title="Download Notes"
                    >
                        <Download className="w-5 h-5" />
                    </button>
                </div>
            )}

            {/* Messages Area */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-4 pt-20 scroll-smooth"
                style={{ paddingBottom: contentBottomPadding }}
            >
                <div className="max-w-3xl mx-auto">
                    {hasMoreMessages && (
                        <div className="flex justify-center mb-6">
                            <button
                                onClick={handleLoadMore}
                                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-gray-500 hover:bg-white/10 hover:text-white transition-all text-xs font-medium"
                            >
                                <ChevronUp className="w-3 h-3" />
                                Load older messages
                            </button>
                        </div>
                    )}

                    <AnimatePresence initial={false}>
                        {visibleMessages.map((msg) => (
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
                            className="flex items-center gap-2 text-gray-500 ml-4"
                        >
                            <div className="flex space-x-1">
                                <div className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                                <div className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                                <div className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                            </div>
                            <span className="text-xs font-medium tracking-wide uppercase">Thinking</span>
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
                        className="absolute bottom-32 right-6 p-3 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white shadow-lg z-40 hover:bg-white/20 transition-colors"
                    >
                        <ArrowDown className="w-5 h-5" />
                    </motion.button>
                )}
            </AnimatePresence>

            {/* Input Area */}
            <InputArea
                onSend={onSendMessage}
                isLoading={isLoading}
                isListening={isListening}
                onVoiceStart={onVoiceStart}
                onVoiceStop={onVoiceStop}
                keyboardOffset={keyboardInset}
                onHeightChange={setInputHeight}
            >
                {inputChildren}
            </InputArea>
        </div>
    )
}
