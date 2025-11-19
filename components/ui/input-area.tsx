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
}

export const InputArea = ({ onSend, onVoiceStart, onVoiceStop, isListening, isLoading, children }: InputAreaProps) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
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

    return (
        <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 pt-2 bg-gradient-to-t from-black via-black/90 to-transparent"
        >
            <div className={cn(
                "max-w-3xl mx-auto rounded-[2rem] p-1.5 transition-all duration-300",
                isFocused ? "bg-gradient-to-r from-primary/50 via-accent-purple/50 to-primary/50 shadow-[0_0_30px_-5px_rgba(59,130,246,0.3)]" : "bg-white/10 border border-white/10"
            )}>
                {children}
                <div className="bg-black/80 backdrop-blur-xl rounded-[1.7rem] flex items-end gap-2 p-2 relative overflow-hidden">

                    {/* Voice Button */}
                    <button
                        onClick={isListening ? onVoiceStop : onVoiceStart}
                        className={cn(
                            "p-3 rounded-full transition-all duration-300 flex-shrink-0",
                            isListening ? "bg-red-500/20 text-red-500 animate-pulse" : "hover:bg-white/10 text-text-secondary hover:text-text-primary"
                        )}
                    >
                        {isListening ? <StopCircle className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                    </button>

                    {/* Text Input */}
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        placeholder="Type or ask..."
                        rows={1}
                        className="flex-1 bg-transparent text-text-primary placeholder-text-muted text-base py-3 px-2 focus:outline-none resize-none max-h-[150px] custom-scrollbar"
                        style={{ minHeight: '48px' }}
                    />

                    {/* Actions */}
                    <div className="flex items-center gap-2 pb-1">
                        <AnimatePresence mode="wait">
                            {value.trim() ? (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.5 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.5 }}
                                    className="flex gap-2"
                                >
                                    <button
                                        onClick={() => handleSend('note')}
                                        className="p-3 rounded-full bg-accent-green/10 text-accent-green hover:bg-accent-green/20 transition-colors"
                                        title="Add Note"
                                        disabled={isLoading}
                                    >
                                        <Plus className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => handleSend('question')}
                                        className="p-3 rounded-full bg-primary text-white shadow-lg shadow-primary/30 hover:scale-105 active:scale-95 transition-all"
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
                                    {/* Placeholder or alternative actions when empty could go here */}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </motion.div>
    )
}
