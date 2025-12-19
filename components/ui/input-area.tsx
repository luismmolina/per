'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Send, Plus, Mic, StopCircle, BookOpen } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
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
    onSwitchToDeepRead?: () => void
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
    onSwitchToDeepRead
}: InputAreaProps) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isFocused, setIsFocused] = useState(false)
    const [value, setValue] = useState('')

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px'
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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend('question')
        }
    }

    // Report the current height so the message list can keep clear space.
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

    return (
        <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            ref={containerRef}
            className="fixed left-0 right-0 z-50 px-4 pt-3 bg-gradient-to-t from-black via-black/95 to-transparent"
            style={{
                bottom: bottomOffset,
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)'
            }}
        >
            <div className={cn(
                "max-w-3xl mx-auto rounded-2xl p-3 transition-all duration-300",
                isFocused ? "bg-gradient-to-r from-primary/30 via-accent-purple/30 to-primary/30 shadow-[0_0_40px_-10px_rgba(59,130,246,0.4)]" : "bg-white/5 border border-white/10"
            )}>
                {children}
                <div className="bg-black/70 backdrop-blur-xl rounded-xl flex flex-col gap-3 p-3 relative overflow-hidden">

                    {/* Text Input - Full width on top */}
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        placeholder="Type or ask..."
                        rows={1}
                        className="w-full bg-transparent text-text-primary placeholder-text-muted text-base py-2 px-1 focus:outline-none resize-none max-h-[150px] custom-scrollbar"
                        style={{ minHeight: '44px' }}
                    />

                    {/* Action buttons row - Below textarea */}
                    <div className="flex items-center gap-2">
                        {/* Voice Button */}
                        <button
                            onClick={isListening ? onVoiceStop : onVoiceStart}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 rounded-full transition-all duration-300 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                                isListening
                                    ? "bg-red-500/20 text-red-400 animate-pulse"
                                    : "bg-white/5 hover:bg-white/10 text-text-secondary hover:text-text-primary border border-white/10"
                            )}
                            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                        >
                            {isListening ? <StopCircle className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                            <span className="hidden sm:inline">{isListening ? 'Stop' : 'Voice'}</span>
                        </button>

                        {/* Deep Read Button */}
                        {onSwitchToDeepRead && (
                            <button
                                onClick={onSwitchToDeepRead}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-text-secondary hover:text-white border border-white/10 transition-all text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                                title="Open Deep Read"
                                aria-label="Open Deep Read"
                            >
                                <BookOpen className="w-4 h-4" />
                                <span className="hidden sm:inline">Deep Read</span>
                            </button>
                        )}

                        <div className="flex-1" />

                        {/* Note and Ask buttons */}
                        <AnimatePresence mode="wait">
                            {value.trim() ? (
                                <motion.div
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                    className="flex gap-2"
                                >
                                    <button
                                        onClick={() => handleSend('note')}
                                        className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-accent-green/10 text-accent-green hover:bg-accent-green/20 transition-colors text-sm font-medium border border-accent-green/20 focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:outline-none"
                                        title="Save as Note"
                                        disabled={isLoading}
                                        aria-label="Save as Note"
                                    >
                                        <Plus className="w-4 h-4" />
                                        <span className="hidden sm:inline">Note</span>
                                    </button>
                                    <button
                                        onClick={() => handleSend('question')}
                                        className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-white shadow-lg shadow-primary/30 hover:scale-105 active:scale-95 transition-all text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                                        title="Ask AI"
                                        disabled={isLoading}
                                        aria-label="Ask AI"
                                    >
                                        <Send className="w-4 h-4" />
                                        <span className="hidden sm:inline">Ask</span>
                                    </button>
                                </motion.div>
                            ) : (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 0.5 }}
                                    exit={{ opacity: 0 }}
                                    className="text-xs text-text-muted pr-2"
                                >
                                    Type to save a note or ask AI
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </motion.div>
    )
}
