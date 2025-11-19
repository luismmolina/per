'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { Copy, Check, Trash, Bot } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

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

interface MessageBubbleProps {
    message: Message
    onCopy?: (id: string, content: string) => void
    onDelete?: (id: string) => void
    isCopied?: boolean
}

export const MessageBubble = React.memo(({ message, onCopy, onDelete, isCopied }: MessageBubbleProps) => {
    const isAI = message.type === 'ai-response'
    const isNote = message.type === 'note'
    const thinkingLine = message.currentThought ?? (message.thoughts && message.thoughts.length > 0
        ? message.thoughts[message.thoughts.length - 1]
        : undefined)
    const showThinking = isAI && !!thinkingLine && !message.content

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className={cn(
                "flex w-full mb-6",
                isAI ? "justify-start" : "justify-end"
            )}
        >
            <div className={cn(
                "relative max-w-[90%] sm:max-w-[85%] md:max-w-[75%] rounded-3xl p-1",
                isAI ? "bg-glass border border-glass-border" :
                    isNote ? "bg-gradient-to-br from-emerald-500/20 to-emerald-900/20 border border-emerald-500/30" :
                        "bg-gradient-to-br from-primary/20 to-accent-purple/20 border border-primary/30"
            )}>
                {/* Inner Glow/Glass Container */}
                <div className={cn(
                    "relative overflow-hidden rounded-[1.3rem] px-5 py-4",
                    isAI ? "bg-black/40 backdrop-blur-md" : "backdrop-blur-sm"
                )}>

                    {/* Header / Icon */}
                    <div className="flex items-center gap-3 mb-2 opacity-80">
                        {isAI && (
                            <div className="p-1.5 rounded-full bg-primary/10 border border-primary/20">
                                <Bot className="w-4 h-4 text-primary" />
                            </div>
                        )}
                        <span className="text-xs font-medium text-text-secondary">
                            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {!isAI && (
                            <div className={cn(
                                "ml-auto text-[10px] px-2 py-0.5 rounded-full border",
                                isNote ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10" :
                                    "border-primary/50 text-primary-400 bg-primary/500/10"
                            )}>
                                {isNote ? "NOTE" : "YOU"}
                            </div>
                        )}
                    </div>

                    {/* Content */}
                    <div className={cn(
                        "prose prose-invert prose-sm max-w-none leading-relaxed",
                        "prose-p:my-1 prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl"
                    )}>
                        {isAI ? (
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    code: ({ node, className, children, ...props }) => {
                                        const match = /language-(\w+)/.exec(className || '')
                                        return match ? (
                                            <div className="relative group rounded-xl overflow-hidden my-2 border border-white/10 bg-black/50">
                                                <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
                                                    <span className="text-xs text-text-muted font-mono">{match[1]}</span>
                                                </div>
                                                <pre className="p-3 overflow-x-auto">
                                                    <code className={className} {...props}>
                                                        {children}
                                                    </code>
                                                </pre>
                                            </div>
                                        ) : (
                                            <code className="bg-white/10 px-1.5 py-0.5 rounded text-accent-cyan font-mono text-xs" {...props}>
                                                {children}
                                            </code>
                                        )
                                    }
                                }}
                            >
                                {message.content}
                            </ReactMarkdown>
                        ) : (
                            <p className="whitespace-pre-wrap text-text-primary">{message.content}</p>
                        )}
                    </div>

                    {showThinking && (
                        <div className="mt-3 p-3 rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-400/40 shadow-[0_0_0_1px_rgba(251,191,36,0.25)] backdrop-blur-sm">
                            <p className="text-[11px] uppercase tracking-[0.08em] text-amber-200/90 mb-2 font-semibold">
                                Thought summary — not final answer
                            </p>
                            <div className="text-sm text-amber-50/90 italic">
                                <p style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {thinkingLine}
                                </p>
                            </div>
                        </div>
                    )}

                    {isAI && message.codeBlocks && message.codeBlocks.length > 0 && (
                        <div className="mt-4 space-y-3">
                            {message.codeBlocks.map((block, idx) => (
                                <div key={`${message.id}-code-${idx}`} className="border border-white/10 rounded-2xl overflow-hidden bg-black/50">
                                    <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/5">
                                        <span className="text-xs font-mono text-text-muted">{block.language}</span>
                                        <span className="text-[10px] text-text-muted">code #{idx + 1}</span>
                                    </div>
                                    <pre className="p-4 overflow-x-auto text-sm">
                                        <code>{block.code}</code>
                                    </pre>
                                    {block.result && (
                                        <div className="px-4 py-2 border-t border-white/5 bg-black/60 text-xs text-text-secondary whitespace-pre-wrap">
                                            {block.result}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-white/5">
                        {onCopy && (
                            <button
                                onClick={() => onCopy(message.id, message.content)}
                                className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
                            >
                                {isCopied ? <Check className="w-3.5 h-3.5 text-accent-green" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                        )}
                        {onDelete && isNote && (
                            <button
                                onClick={() => onDelete(message.id)}
                                className="p-1.5 rounded-lg hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-colors"
                            >
                                <Trash className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    )
})

MessageBubble.displayName = 'MessageBubble'
