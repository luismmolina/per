'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Send, Plus, Mic, StopCircle } from 'lucide-react'
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
}

export const InputArea = ({
    onSend,
    onVoiceStart,
    onVoiceStop,
    isListening,
    isLoading,
    children,
    keyboardOffset = 0,
    onHeightChange
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
            className="fixed left-0 right-0 z-50 px-4 flex justify-center pointer-events-none"
            style={{
                bottom: bottomOffset,
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)'
            }}
        >
            <div className={cn(
                "w-full max-w-2xl pointer-events-auto transition-all duration-300",
                "glass-pill rounded-[2rem] p-2"
            )}>
                {children}
                <div className="flex items-end gap-2 relative">

                    {/* Voice Button */}
                    <button
                        onClick={isListening ? onVoiceStop : onVoiceStart}
                        className={cn(
                            "p-3.5 rounded-full transition-all duration-300 flex-shrink-0",
                            isListening ? "bg-red-500/20 text-red-500 animate-pulse" : "hover:bg-white/10 text-gray-400 hover:text-white"
                        )}
                    >
                        {isListening ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>

                    {/* Text Input */}
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        placeholder="Type a memory or ask a question..."
                        rows={1}
                        className="flex-1 bg-transparent text-white placeholder-gray-500 text-[16px] py-3.5 px-2 focus:outline-none resize-none max-h-[150px] custom-scrollbar leading-relaxed"
                        style={{ minHeight: '52px' }}
                    />

                    {/* Actions */}
                    <div className="flex items-center gap-1 pb-1.5 pr-1.5">
                        <AnimatePresence mode="wait">
                            {value.trim() ? (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9, x: 10 }}
                                    animate={{ opacity: 1, scale: 1, x: 0 }}
                                    exit={{ opacity: 0, scale: 0.9, x: 10 }}
                                    className="flex gap-2"
                                >
                                    <button
                                        onClick={() => handleSend('note')}
                                        className="p-3 rounded-full bg-white/5 hover:bg-white/10 text-emerald-400 border border-emerald-500/20 transition-all"
                                        title="Save as Memory"
                                        disabled={isLoading}
                                    >
                                        <Plus className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => handleSend('question')}
                                        className="p-3 rounded-full bg-white text-black hover:bg-gray-200 shadow-[0_0_15px_rgba(255,255,255,0.3)] transition-all hover:scale-105 active:scale-95"
                                        title="Ask AI"
                                        disabled={isLoading}
                                    >
                                        <Send className="w-5 h-5" />
                                    </button>
                                </motion.div>
                            ) : (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                >
                                    {/* Empty state actions if needed */}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </motion.div>
    )
}
