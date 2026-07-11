'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Send, Plus, Mic, Square, Radio, Crosshair } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface InputAreaProps {
    onSend: (text: string, type: 'note' | 'question') => void
    onVoiceStart?: () => void
    onVoiceStop?: () => void
    isListening?: boolean
    isLoading?: boolean
    children?: React.ReactNode
    keyboardOffset?: number
    onHeightChange?: (height: number) => void
    onSwitchToSignal?: () => void
    onSwitchToMove?: () => void
}

export const InputArea = ({
    onSend,
    onVoiceStart,
    onVoiceStop,
    isListening,
    isLoading,
    children,
    keyboardOffset = 0,
    onHeightChange,
    onSwitchToSignal,
    onSwitchToMove
}: InputAreaProps) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isFocused, setIsFocused] = useState(false)
    const [value, setValue] = useState('')

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 140) + 'px'
        }
    }, [value])

    const handleSend = (type: 'note' | 'question') => {
        if (!value.trim()) return
        onSend(value, type)
        setValue('')
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.focus()
        }
    }

    const handleKeyDown = (_e: React.KeyboardEvent) => {
        // Enter inserts newlines
    }

    useEffect(() => {
        if (!containerRef.current || !onHeightChange) return
        const element = containerRef.current
        let lastHeight = 0

        const notifyHeight = () => {
            const currentHeight = Math.round(element.getBoundingClientRect().height)
            if (currentHeight !== lastHeight) {
                lastHeight = currentHeight
                onHeightChange(currentHeight)
            }
        }

        const observer = new ResizeObserver(() => notifyHeight())
        notifyHeight()
        observer.observe(element)
        return () => observer.disconnect()
    }, [onHeightChange])

    const bottomOffset = Math.max(0, keyboardOffset)
    const isTyping = Boolean(value.trim())

    return (
        <div
            ref={containerRef}
            className="fixed left-0 right-0 z-50 px-3 pt-2"
            style={{
                bottom: bottomOffset,
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.65rem)',
                background: 'linear-gradient(to top, #000 70%, rgba(0,0,0,0.92) 88%, transparent)',
            }}
        >
            <div
                className={cn(
                    'max-w-3xl mx-auto border bg-background-secondary transition-colors',
                    isFocused ? 'border-line-strong' : 'border-line'
                )}
            >
                {children}

                <div className="flex flex-col gap-2 p-2.5">
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        placeholder="Note or query…"
                        rows={1}
                        className="w-full bg-transparent text-[15px] text-text-primary placeholder:text-text-muted py-2 px-1.5 focus:outline-none resize-none max-h-[140px] custom-scrollbar leading-relaxed"
                        style={{ minHeight: '40px' }}
                    />

                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar">
                            <button
                                onClick={isListening ? onVoiceStop : onVoiceStart}
                                className={cn(
                                    't-btn shrink-0',
                                    isListening ? 't-btn-live' : 't-btn-primary'
                                )}
                                aria-label={isListening ? 'Stop recording' : 'Start voice'}
                            >
                                {isListening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-3.5 h-3.5" />}
                                <span>{isListening ? 'Stop' : 'Voice'}</span>
                            </button>

                            {onSwitchToSignal && !isTyping && (
                                <button
                                    onClick={onSwitchToSignal}
                                    className="t-btn t-btn-ghost shrink-0"
                                    title="Signal"
                                >
                                    <Radio className="w-3.5 h-3.5" />
                                    <span>Signal</span>
                                </button>
                            )}

                            {onSwitchToMove && !isTyping && (
                                <button
                                    onClick={onSwitchToMove}
                                    className="t-btn t-btn-ghost shrink-0"
                                    title="Move"
                                >
                                    <Crosshair className="w-3.5 h-3.5" />
                                    <span>Move</span>
                                </button>
                            )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                            <AnimatePresence mode="wait">
                                {isTyping ? (
                                    <motion.div
                                        initial={{ opacity: 0, x: 8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 8 }}
                                        className="flex gap-1.5"
                                    >
                                        <button
                                            onClick={() => handleSend('note')}
                                            className="t-btn t-btn-ghost"
                                            title="Save note"
                                            disabled={isLoading}
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                            <span>Note</span>
                                        </button>
                                        <button
                                            onClick={() => handleSend('question')}
                                            className="t-btn t-btn-primary"
                                            title="Ask"
                                            disabled={isLoading}
                                        >
                                            <Send className="w-3.5 h-3.5" />
                                            <span>Ask</span>
                                        </button>
                                    </motion.div>
                                ) : null}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
