'use client'

import React, { useRef, useEffect, useState, useMemo } from 'react'
import { MessageBubble } from './ui/message-bubble'
import { InputArea } from './ui/input-area'
import { FactsStatusPanel } from './facts-status-panel'
import { ArrowDown, ChevronUp, Download, FileText } from 'lucide-react'
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
    onDownloadSignal?: () => void
    onSwitchToSignal?: () => void
    onSwitchToMove?: () => void
    onSwitchToWrite?: () => void
}

const INITIAL_VISIBLE_MESSAGES = 10
const LOAD_MORE_BATCH_SIZE = 10

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
    onDownloadNotes,
    onDownloadSignal,
    onSwitchToSignal,
    onSwitchToMove,
    onSwitchToWrite
}: ChatInterfaceProps) => {
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [showScrollButton, setShowScrollButton] = useState(false)
    const [inputHeight, setInputHeight] = useState(140)
    const [keyboardInset, setKeyboardInset] = useState(0)
    const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_MESSAGES)
    const prevMessageCountRef = useRef(0)
    const isStreamingRef = useRef(false)

    const noteCount = useMemo(
        () => messages.filter((m) => m.type === 'note').length,
        [messages]
    )

    const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior })
    }

    useEffect(() => {
        const currentCount = messages.length
        const isNewMessage = currentCount > prevMessageCountRef.current

        if (isNewMessage) {
            scrollToBottom(isLoading ? 'auto' : 'smooth')
            prevMessageCountRef.current = currentCount
        } else if (isLoading && !isStreamingRef.current) {
            isStreamingRef.current = true
            scrollToBottom('auto')
        } else if (!isLoading && isStreamingRef.current) {
            isStreamingRef.current = false
            scrollToBottom('smooth')
        }
    }, [messages.length, isLoading])

    const visibleMessages = messages.slice(-visibleCount)
    const hasMoreMessages = messages.length > visibleCount

    const handleLoadMore = () => {
        setVisibleCount((prev) => prev + LOAD_MORE_BATCH_SIZE)
    }

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

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const { scrollTop, scrollHeight, clientHeight } = container
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 140
        if (isNearBottom) {
            scrollToBottom('auto')
        }
    }, [keyboardInset])

    const contentBottomPadding = Math.max(130, inputHeight + keyboardInset + 16)
    const headerPad = 'calc(env(safe-area-inset-top, 0px) + 0.55rem)'

    return (
        <div className="relative flex min-h-0 flex-1 flex-col bg-black">
            <header
                className="fixed top-0 left-0 right-0 z-40 border-b border-line bg-black/95 backdrop-blur-md"
                style={{ paddingTop: headerPad }}
            >
                <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 pb-2.5">
                    <div className="flex min-w-0 shrink items-baseline gap-1.5">
                        <span className="font-mono text-[11px] tracking-[0.16em] uppercase text-text-primary">
                            Notes
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-text-muted">
                            {noteCount}
                        </span>
                    </div>
                    <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-1.5">
                        <FactsStatusPanel />
                        {onSwitchToWrite && (
                            <button
                                onClick={onSwitchToWrite}
                                className="t-btn t-btn-ghost hidden lg:inline-flex"
                                title="Writer"
                            >
                                <FileText className="h-3.5 w-3.5" />
                                <span>Write</span>
                            </button>
                        )}
                        {onDownloadNotes && (
                            <button
                                onClick={onDownloadNotes}
                                className="t-btn t-btn-ghost shrink-0 px-2 sm:px-3"
                                title="Export all raw notes"
                                aria-label="Export all raw notes"
                            >
                                <Download className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Notes</span>
                            </button>
                        )}
                        {onDownloadSignal && (
                            <button
                                onClick={onDownloadSignal}
                                className="t-btn t-btn-ghost shrink-0 px-2 sm:px-3"
                                title="Export processed signal (CURRENT STATE + facts)"
                                aria-label="Export processed signal"
                            >
                                <Download className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Signal</span>
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <div
                ref={containerRef}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-3"
                style={{
                    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3.25rem)',
                    paddingBottom: contentBottomPadding,
                }}
            >
                <div className="max-w-3xl mx-auto">
                    {hasMoreMessages && (
                        <div className="flex justify-center mb-4 pt-2">
                            <button onClick={handleLoadMore} className="t-btn t-btn-ghost">
                                <ChevronUp className="w-3 h-3" />
                                <span>Older</span>
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
                        <div className="flex items-center gap-2 py-3 font-mono text-[10px] tracking-[0.12em] uppercase text-text-muted">
                            <span className="inline-block h-1.5 w-1.5 bg-accent-amber animate-pulse" />
                            Processing
                        </div>
                    )}

                    <div ref={messagesEndRef} className="h-3" />
                </div>
            </div>

            <AnimatePresence>
                {showScrollButton && (
                    <motion.button
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        onClick={() => scrollToBottom()}
                        className="absolute right-3 z-40 t-btn t-btn-ghost p-2.5"
                        style={{ bottom: Math.max(100, inputHeight + 12) }}
                        aria-label="Scroll to bottom"
                    >
                        <ArrowDown className="w-4 h-4" />
                    </motion.button>
                )}
            </AnimatePresence>

            <InputArea
                onSend={onSendMessage}
                isLoading={isLoading}
                isListening={isListening}
                onVoiceStart={onVoiceStart}
                onVoiceStop={onVoiceStop}
                keyboardOffset={keyboardInset}
                onHeightChange={setInputHeight}
                onSwitchToSignal={onSwitchToSignal}
                onSwitchToMove={onSwitchToMove}
            >
                {inputChildren}
            </InputArea>
        </div>
    )
}
