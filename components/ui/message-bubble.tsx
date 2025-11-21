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
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "flex w-full mb-6",
                isAI ? "justify-start" : "justify-end"
            )}
        >
            <div className={cn(
                "group relative max-w-[85vw] sm:max-w-[75%] w-fit flex flex-col min-w-0 overflow-hidden",
                isAI ? "rounded-[2rem] rounded-tl-none" : "rounded-[2rem] rounded-tr-none"
            )}>
                <div className={
                    cn(
                        "relative w-full px-6 py-5 text-premium",
                        isAI ? "card-fluid text-gray-100" : "card-solid text-white border-accent-gold"
                    )
                } >

                    {/* Header / Icon */}
                    <div className="flex items-center gap-3 mb-3 opacity-60">
                        {isAI ? (
                            <div className="flex items-center gap-2">
                                <Bot className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-medium tracking-wider uppercase">Assistant</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 ml-auto">
                                <span className="text-[10px] font-medium tracking-wider uppercase text-amber-400/80">Memory</span>
                            </div>
                        )}
                        <span className="text-[10px] font-medium">
                            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div >

                    {/* Content */}
                    <div className="space-y-3">
                        {
                            isAI ? (
                                <div className="w-full min-w-0 break-words" style={{ overflowWrap: 'anywhere' }} >
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            p: ({ children }) => <p className="my-2 leading-relaxed break-words whitespace-normal" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</p>,
                                            ul: ({ children }) => <ul className="my-2 list-disc list-outside pl-5 space-y-1 break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</ul >,
                                            ol: ({ children }) => <ol className="my-2 list-decimal list-outside pl-5 space-y-1 break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</ol>,
                                            li: ({ children }) => <li className="leading-relaxed break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</li>,
                                            strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                                            em: ({ children }) => <em className="text-gray-400">{children}</em>,
                                            code: ({ node, className, children, ...props }) => {
                                                const match = /language-(\w+)/.exec(className || '')
                                                return match ? (
                                                    <div className="relative group rounded-xl overflow-hidden my-4 border border-white/10 bg-black/40 w-full max-w-full">
                                                        <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
                                                            <span className="text-xs text-gray-400 font-mono">{match[1]}</span>
                                                        </div>
                                                        <pre className="p-4 overflow-x-auto w-full max-w-full">
                                                            <code className={className} {...props}>
                                                                {children}
                                                            </code>
                                                        </pre>
                                                    </div>
                                                ) : (
                                                    <code className="bg-white/10 px-1.5 py-0.5 rounded text-amber-200/80 font-mono text-xs break-words whitespace-pre-wrap" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }} {...props}>
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
                                    "prose-p:my-1"
                                )} style={{ overflowWrap: 'anywhere' }}>
                                    <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{message.content}</p>
                                </div>
                            )}
                    </div>

                    {showThinking && (
                        <div className="mt-4 p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
                            <p className="text-[10px] uppercase tracking-widest text-amber-500/70 mb-2 font-semibold">
                                Thinking
                            </p>
                            <div className="text-sm text-amber-200/60 italic">
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
                                    <div key={`${message.id}-code-${idx}`} className="border border-white/10 rounded-xl overflow-hidden bg-black/30">
                                        <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/5">
                                            <span className="text-xs font-mono text-gray-400">{block.language}</span>
                                        </div>
                                        <pre className="p-4 overflow-x-auto text-sm">
                                            <code>{block.code}</code>
                                        </pre>
                                        {block.result && (
                                            <div className="px-4 py-3 border-t border-white/5 bg-black/40 text-xs text-gray-400 whitespace-pre-wrap font-mono">
                                                {block.result}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )
                    }

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-3 mt-4 pt-3 border-t border-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onCopy && (
                            <button
                                onClick={() => onCopy(message.id, message.content)}
                                className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
                            >
                                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                        )}
                        {onDelete && isNote && (
                            <button
                                onClick={() => onDelete(message.id)}
                                className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
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
