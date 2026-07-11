'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { Copy, Check, Trash } from 'lucide-react'
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

    const time = message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    return (
        <motion.div
            layout="position"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className={cn('flex w-full mb-3', isAI ? 'justify-start' : 'justify-end')}
        >
            <div
                className={cn(
                    'relative flex flex-col min-w-0 overflow-hidden',
                    isAI
                        ? 'w-full border-l-2 border-line-strong pl-3 py-1'
                        : 'max-w-[88vw] sm:max-w-[78%] w-fit border border-line bg-background-tertiary'
                )}
            >
                <div className={cn('relative w-full overflow-hidden', isAI ? 'py-1' : 'px-3 py-2.5')}>
                    <div className="flex items-center gap-2 mb-1.5">
                        <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-text-muted">
                            {isAI ? 'AI' : isNote ? 'Note' : 'Query'}
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-text-muted/80">
                            {time}
                        </span>
                    </div>

                    <div>
                        {isAI ? (
                            <div
                                className="w-full min-w-0 break-words overflow-hidden t-prose"
                                style={{ overflowWrap: 'anywhere' }}
                            >
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        p: ({ children }) => (
                                            <p className="mb-3 text-[15px] leading-[1.65] text-text-primary break-words whitespace-normal">
                                                {children}
                                            </p>
                                        ),
                                        h2: ({ children }) => (
                                            <h2 className="font-mono text-[12px] tracking-[0.1em] uppercase text-text-primary mt-5 mb-2 border-b border-line pb-1">
                                                {children}
                                            </h2>
                                        ),
                                        h3: ({ children }) => (
                                            <h3 className="font-mono text-[11px] tracking-[0.1em] uppercase text-accent-amber mt-4 mb-1.5">
                                                {children}
                                            </h3>
                                        ),
                                        ul: ({ children }) => (
                                            <ul className="my-3 list-disc list-outside pl-4 space-y-1.5 text-[15px] text-text-primary">
                                                {children}
                                            </ul>
                                        ),
                                        ol: ({ children }) => (
                                            <ol className="my-3 list-decimal list-outside pl-4 space-y-1.5 text-[15px] text-text-primary">
                                                {children}
                                            </ol>
                                        ),
                                        li: ({ children }) => (
                                            <li className="leading-[1.55] break-words pl-0.5">{children}</li>
                                        ),
                                        strong: ({ children }) => (
                                            <strong className="font-semibold text-white">{children}</strong>
                                        ),
                                        em: ({ children }) => (
                                            <em className="not-italic text-text-secondary border-b border-accent-amber/40">
                                                {children}
                                            </em>
                                        ),
                                        blockquote: ({ children }) => (
                                            <blockquote className="border-l-2 border-accent-amber pl-3 my-3 text-text-secondary">
                                                {children}
                                            </blockquote>
                                        ),
                                        code: ({ className, children, ...props }) => {
                                            const match = /language-(\w+)/.exec(className || '')
                                            return match ? (
                                                <div className="my-3 border border-line bg-background-secondary w-full max-w-full overflow-hidden">
                                                    <div className="px-2.5 py-1 border-b border-line font-mono text-[10px] tracking-wider uppercase text-text-muted">
                                                        {match[1]}
                                                    </div>
                                                    <pre className="p-2.5 overflow-x-auto w-full max-w-full text-[12px]">
                                                        <code className={className} {...props}>
                                                            {children}
                                                        </code>
                                                    </pre>
                                                </div>
                                            ) : (
                                                <code
                                                    className="bg-background-raised border border-line px-1 py-0.5 font-mono text-[12px] text-text-secondary break-words"
                                                    style={{ overflowWrap: 'anywhere' }}
                                                    {...props}
                                                >
                                                    {children}
                                                </code>
                                            )
                                        },
                                    }}
                                >
                                    {message.content}
                                </ReactMarkdown>
                            </div>
                        ) : (
                            <p
                                className="whitespace-pre-wrap break-words text-[15px] leading-[1.55] text-text-primary"
                                style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                            >
                                {message.content}
                            </p>
                        )}
                    </div>

                    {showThinking && (
                        <div className="mt-2 border border-line bg-background-secondary px-2.5 py-2">
                            <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-accent-amber mb-1">
                                Thinking
                            </p>
                            <p
                                className="text-[13px] text-text-secondary"
                                style={{
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                }}
                            >
                                {thinkingLine}
                            </p>
                        </div>
                    )}

                    {isAI && message.codeBlocks && message.codeBlocks.length > 0 && (
                        <div className="mt-3 space-y-2">
                            {message.codeBlocks.map((block, idx) => (
                                <div key={`${message.id}-code-${idx}`} className="border border-line bg-background-secondary overflow-hidden">
                                    <div className="flex items-center justify-between px-2.5 py-1 border-b border-line">
                                        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                                            {block.language}
                                        </span>
                                        <span className="font-mono text-[10px] text-text-muted">#{idx + 1}</span>
                                    </div>
                                    <pre className="p-2.5 overflow-x-auto text-[12px]">
                                        <code>{block.code}</code>
                                    </pre>
                                    {block.result && (
                                        <div className="px-2.5 py-2 border-t border-line text-[12px] text-text-secondary whitespace-pre-wrap">
                                            {block.result}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-0.5 mt-2 pt-1.5 border-t border-line-faint">
                        {onCopy && (
                            <button
                                onClick={() => onCopy(message.id, message.content)}
                                className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
                                aria-label="Copy"
                            >
                                {isCopied ? (
                                    <Check className="w-3.5 h-3.5 text-accent-green" />
                                ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                )}
                            </button>
                        )}
                        {onDelete && isNote && (
                            <button
                                onClick={() => onDelete(message.id)}
                                className="p-1.5 text-text-muted hover:text-accent-red transition-colors"
                                aria-label="Delete"
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
