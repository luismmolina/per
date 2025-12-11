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
            layout="position"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
                "flex w-full mb-4",
                isAI ? "justify-start" : "justify-end"
            )}
        >
            <div className={cn(
                "relative max-w-[85vw] sm:max-w-[75%] w-fit flex flex-col min-w-0 rounded-[1.5rem] p-[1px] overflow-hidden",
                isAI ? "bg-gradient-to-br from-white/10 to-white/5" :
                    "bg-gradient-to-br from-primary/20 to-accent-purple/20 border border-primary/30"
            )}>
                {/* Inner Glow/Glass Container */}
                <div className={
                    cn(
                        "relative w-full overflow-hidden rounded-[1.3rem] px-4 sm:px-5 py-4",
                        isAI ? "bg-black/40 backdrop-blur-md" : "backdrop-blur-sm"
                    )
                } >

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
                        {
                            !isAI && (
                                <div className={cn(
                                    "ml-auto text-[10px] px-2 py-0.5 rounded-full border",
                                    isNote ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10" :
                                        "border-primary/50 text-primary-400 bg-primary/500/10"
                                )}>
                                    {isNote ? "NOTE" : "YOU"}
                                </div>
                            )
                        }
                    </div >

                    {/* Content */}
                    <div className="space-y-3">
                        {
                            isAI ? (
                                <div className="w-full min-w-0 rounded-2xl p-5 break-words overflow-hidden bg-gradient-to-br from-white/5 to-transparent" style={{ overflowWrap: 'anywhere' }} >
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            p: ({ children }) => <p className="mb-4 leading-[1.8] text-[#f0e8d7] text-[17px] font-serif break-words whitespace-normal" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</p>,
                                            h2: ({ children }) => <h2 className="text-lg font-bold mb-3 text-white mt-6 font-sans tracking-tight">{children}</h2>,
                                            h3: ({ children }) => <h3 className="text-base font-semibold mb-2 text-white/90 mt-4 font-sans">{children}</h3>,
                                            ul: ({ children }) => <ul className="my-4 list-disc list-outside pl-5 space-y-2 text-[#f0e8d7] font-serif text-[17px] leading-[1.8] break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</ul>,
                                            ol: ({ children }) => <ol className="my-4 list-decimal list-outside pl-5 space-y-2 text-[#f0e8d7] font-serif text-[17px] leading-[1.8] break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</ol>,
                                            li: ({ children }) => <li className="leading-[1.7] break-words pl-1" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</li>,
                                            strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                                            em: ({ children }) => <em className="text-[#e8dfc8]/80 italic">{children}</em>,
                                            blockquote: ({ children }) => <blockquote className="border-l-3 border-white/20 pl-4 my-4 italic text-white/70 font-serif">{children}</blockquote>,
                                            code: ({ node, className, children, ...props }) => {
                                                const match = /language-(\w+)/.exec(className || '')
                                                return match ? (
                                                    <div className="relative group rounded-xl overflow-hidden my-4 border border-white/10 bg-black/50 w-full max-w-full">
                                                        <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
                                                            <span className="text-xs text-text-muted font-mono">{match[1]}</span>
                                                        </div>
                                                        <pre className="p-3 overflow-x-auto w-full max-w-full">
                                                            <code className={className} {...props}>
                                                                {children}
                                                            </code>
                                                        </pre>
                                                    </div>
                                                ) : (
                                                    <code className="bg-white/10 px-1.5 py-0.5 rounded text-[#7dd3fc] font-mono text-sm break-words whitespace-pre-wrap" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }} {...props}>
                                                        {children}
                                                    </code>
                                                )
                                            }
                                        }}
                                    >
                                        {message.content}
                                    </ReactMarkdown>
                                </div>
                            ) : (
                                <div className={cn(
                                    "prose prose-invert prose-sm max-w-none leading-relaxed break-words",
                                    "prose-p:my-1 prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl"
                                )} style={{ overflowWrap: 'anywhere' }}>
                                    <p className="whitespace-pre-wrap break-words text-text-primary" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{message.content}</p>
                                </div>
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

                    {
                        isAI && message.codeBlocks && message.codeBlocks.length > 0 && (
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
                        )
                    }

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-white/5">
                        {onCopy && (
                            <button
                                onClick={() => onCopy(message.id, message.content)}
                                aria-label="Copy message"
                                className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
                            >
                                {isCopied ? <Check className="w-3.5 h-3.5 text-accent-green" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                        )}
                        {onDelete && isNote && (
                            <button
                                onClick={() => onDelete(message.id)}
                                aria-label="Delete message"
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
