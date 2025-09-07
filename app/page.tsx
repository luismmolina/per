'use client'

import React, { useState, useRef, useEffect, memo, useCallback, useMemo } from 'react'
import { Plus, Send, Bot, User, Scissors, Search, Copy, Check, Download, Trash } from 'lucide-react'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Message {
  id: string
  content: string
  type: 'note' | 'question' | 'ai-response'
  timestamp: Date
  codeBlocks?: Array<{
    code: string
    language: string
    result?: string
  }>
  thoughts?: string[]
}

// Minimal inline icons to avoid version mismatches
type IconProps = { className?: string }
const MicIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 1a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
)

const StopIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
)

// Add interface for dishes data
interface Dish {
  name: string
  cost: {
    amount: number
    unit: string
  }
  lastUpdated: string
  buffetBasico: boolean
  buffetPremium: boolean
  calculationNotes?: string // Keep as optional for backward compatibility
}

interface DishesData {
  dishes: Dish[]
  totalDishes: number
  lastUpdated: string
  buffetStats?: {
    averageCostBuffetBasico: number
    averageCostBuffetPremium: number
    cogsPerCustomerBuffetBasico: number
    cogsPerCustomerBuffetPremium: number
    buffetBasicoDishCount: number
    buffetPremiumDishCount: number
  }
}

// Memoized Markdown component to prevent unnecessary re-renders
const Markdown = React.memo(
  ({ children }: { children: string }) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({children}) => <p className="mb-1.5 last:mb-0">{children}</p>,
        ul: ({children}) => <ul className="list-disc ml-4 mb-1.5">{children}</ul>,
        li: ({children}) => <li className="mb-1">{children}</li>,
        strong: ({children}) => <strong className="font-semibold text-blue-400">{children}</strong>,
        table: ({children}) => (
          <div className="overflow-x-auto my-3">
            <table className="min-w-full border border-gray-600 rounded-lg bg-gray-800 text-xs">
              {children}
            </table>
          </div>
        ),
        thead: ({children}) => <thead className="bg-gray-700">{children}</thead>,
        tbody: ({children}) => <tbody>{children}</tbody>,
        tr: ({children, index}) => <tr key={index} className="border-b border-gray-600 hover:bg-gray-750">{children}</tr>,
        th: ({children, index}) => (
          <th key={index} className="px-3 py-2 text-left text-yellow-400 font-medium border-r border-gray-600">
            {children}
          </th>
        ),
        td: ({children, index}) => (
          <td key={index} className="px-3 py-2 text-gray-200 border-r border-gray-600">
            {children}
          </td>
        ),
        code: ({children, className, ...props}) => {
          const isBlock = className?.includes('language-') || props.node?.position?.start?.line !== props.node?.position?.end?.line;
          
          if (isBlock) {
            // Block code - make it collapsible
            const language = className?.replace('language-', '') || 'code';
            
            return (
              <div className="my-3 border border-gray-600 rounded-lg bg-gray-800 overflow-hidden">
                <details className="group">
                  <summary className="w-full flex items-center justify-between p-3 bg-gray-700 hover:bg-gray-600 transition-colors cursor-pointer list-none">
                  <span className="text-yellow-400 text-sm font-medium">
                    📄 {language.toUpperCase()} Code
                  </span>
                    <span className="text-gray-400 text-xs group-open:hidden">
                      ▶️ Expand
                  </span>
                    <span className="text-gray-400 text-xs hidden group-open:inline">
                      🔽 Collapse
                    </span>
                  </summary>
                  <pre className="p-3 text-green-400 font-mono text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-w-full">
                    <code>{children}</code>
                  </pre>
                </details>
              </div>
            );
          } else {
            // Inline code
            return (
              <code className="bg-gray-800 text-green-400 px-1 py-0.5 rounded text-xs font-mono break-words">
                {children}
              </code>
            );
          }
        },
        pre: ({children}) => {
          // Handle pre blocks that might not have been caught by code renderer
          return (
            <div className="my-3 border border-gray-600 rounded-lg bg-gray-800 overflow-hidden">
              <details className="group">
                <summary className="w-full flex items-center justify-between p-3 bg-gray-700 hover:bg-gray-600 transition-colors cursor-pointer list-none">
                <span className="text-yellow-400 text-sm font-medium">
                  📄 Code Block
                </span>
                  <span className="text-gray-400 text-xs group-open:hidden">
                    ▶️ Expand
                </span>
                  <span className="text-gray-400 text-xs hidden group-open:inline">
                    🔽 Collapse
                  </span>
                </summary>
                <div className="p-3 text-green-400 font-mono text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-w-full">
                  {children}
                </div>
              </details>
            </div>
          );
        }
      }}
    >
      {children}
    </ReactMarkdown>
  ),
  (prev, next) => prev.children === next.children
)

// Memoized Message Component for better performance
const MessageComponent = memo(({
  message,
  onCopy,
  isCopied,
  onDelete
}: {
  message: Message
  onCopy?: (messageId: string, content: string) => void
  isCopied?: boolean
  onDelete?: (messageId: string) => void
}) => {
  return (
    <div
      className={`flex ${
        message.type === 'ai-response' ? 'justify-start' : 'justify-end'
      }`}
    >
      <div
        className={`max-w-[92%] sm:max-w-md lg:max-w-lg px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl shadow-lg message-bubble ${
          message.type === 'ai-response'
            ? 'message-bubble-ai'
            : message.type === 'note'
            ? 'message-bubble-note'
            : 'message-bubble-user'
        }`}
      >
        <div className="flex items-start space-x-2">
          {message.type === 'ai-response' && (
            <Bot className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            {message.type === 'ai-response' ? (
              <div className="text-sm sm:text-sm leading-relaxed animate-fadeIn">
                <Markdown>{message.content}</Markdown>
                {message.codeBlocks && message.codeBlocks.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.codeBlocks.map((block, blockIndex) => (
                      <div key={blockIndex} className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-sm">
                        <div className="text-yellow-400 mb-2 font-medium">Code ({block.language}):</div>
                        <pre className="whitespace-pre-wrap text-green-400 font-mono text-xs leading-relaxed overflow-x-auto">
                          {block.code}
                        </pre>
                        {block.result && (
                          <>
                            <div className="text-yellow-400 mt-3 mb-1 font-medium">Output:</div>
                            <pre className="whitespace-pre-wrap text-white font-mono text-xs leading-relaxed bg-gray-900 p-2 rounded border border-gray-700 overflow-x-auto">
                              {block.result}
                            </pre>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* Thoughts are only shown during live streaming, not in saved messages */}

              </div>
            ) : (
              <div className="text-sm sm:text-sm leading-relaxed whitespace-pre-wrap break-words animate-fadeIn">
                {message.content}
              </div>
            )}
            <div className="flex items-center justify-between mt-2">
              <p
                className={`text-xs ${
                  message.type === 'ai-response'
                    ? 'text-amoled-textMuted'
                    : 'text-white/80'
                }`}
              >
                {message.timestamp.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
              <div className="flex items-center flex-wrap gap-2 sm:gap-3">
                {message.type === 'ai-response' && onCopy && (
                  <button
                    onClick={() => onCopy(message.id, message.content)}
                    className="p-1.5 hover:bg-amoled-lightGray rounded-xl transition-colors touch-target"
                    title="Copy message"
                  >
                    {isCopied ? (
                      <Check className="w-4 h-4 text-accent-green animate-pulse" />
                    ) : (
                      <Copy className="w-4 h-4 text-amoled-textSecondary hover:text-white" />
                    )}
                  </button>
                )}
                {message.type === 'note' && onDelete && (
                  <button
                    onClick={() => onDelete(message.id)}
                    className="p-1.5 hover:bg-accent-red/20 rounded-xl transition-colors touch-target"
                    title="Delete note"
                  >
                    <Trash className="w-4 h-4 text-accent-red hover:text-red-300" />
                  </button>
                )}
                {message.type !== 'ai-response' && (
                  <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium border ${
                    message.type === 'note' 
                      ? 'bg-emerald-600/20 text-green-300 border-emerald-400/40' 
                      : 'bg-blue-600/20 text-blue-300 border-blue-400/40'
                  }`}>
                    {message.type === 'note' ? 'Note' : 'Question'}
                  </span>
                )}
              </div>
            </div>
          </div>
          {message.type !== 'ai-response' && (
            <User className="w-4 h-4 sm:w-5 sm:h-5 text-white/70 mt-0.5 flex-shrink-0" />
          )}
        </div>
      </div>
    </div>
  )
})

MessageComponent.displayName = 'MessageComponent'

// Memoized list of messages to avoid re-rendering on unrelated state changes
const MessagesList = memo(
  ({
    messages,
    onCopy,
    onDelete,
    copiedMessageId,
  }: {
    messages: Message[]
    onCopy: (id: string, text: string) => void
    onDelete: (id: string) => void
    copiedMessageId: string | null
  }) => (
    <>
      {messages.map((message) => (
        <MessageComponent
          key={message.id}
          message={message}
          onCopy={onCopy}
          onDelete={onDelete}
          isCopied={copiedMessageId === message.id}
        />
      ))}
    </>
  )
)

MessagesList.displayName = 'MessagesList'

// Simplified textarea component without expensive height adjustments
const OptimizedTextarea = React.forwardRef<
  HTMLTextAreaElement,
  {
    value: string
    onChange: (value: string) => void
    onKeyPress: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
    onFocus: () => void
    placeholder: string
    disabled: boolean
    className?: string
  }
>(({ value, onChange, onKeyPress, onFocus, placeholder, disabled, className }, ref) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
  }, [onChange])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={handleChange}
      onKeyDown={onKeyPress}
      onFocus={onFocus}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      className={`input-enhanced w-full resize-none overflow-y-auto ${className || ''}`}
      style={{
        fontSize: '16px', // prevent iOS zoom
        minHeight: '56px',
        maxHeight: '200px'
      }}
    />
  )
})

OptimizedTextarea.displayName = 'OptimizedTextarea'

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isPruning, setIsPruning] = useState(false)
  const [isFindingOpportunity, setIsFindingOpportunity] = useState(false)
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)
  const [visibleMessageCount, setVisibleMessageCount] = useState(30)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [currentResponse, setCurrentResponse] = useState('')
  const [currentCodeBlocks, setCurrentCodeBlocks] = useState<Array<{
    code: string
    language: string
    result?: string
  }>>([])
  const [isThinking, setIsThinking] = useState(false)
  const [currentThoughts, setCurrentThoughts] = useState<string[]>([])
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<string>('')
  const [showErrorNotification, setShowErrorNotification] = useState(false)
  const [errorNotificationMessage, setErrorNotificationMessage] = useState('')
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  // Debug: Log thought changes
  useEffect(() => {
    if (currentThoughts.length > 0) {
      const latestThought = currentThoughts[currentThoughts.length - 1]
      console.log('🧠 Showing thought', currentThoughts.length, ':', latestThought.substring(0, 100) + '...')
    }
  }, [currentThoughts])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const bottomBarRef = useRef<HTMLDivElement>(null)
  const [bottomBarHeight, setBottomBarHeight] = useState(160)
  const topBarRef = useRef<HTMLDivElement>(null)
  const [topBarHeight, setTopBarHeight] = useState(56)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const thoughtUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingThoughtsRef = useRef<string[]>([])
  const saveTimeoutRef = useRef<NodeJS.Timeout>()

  // Update bottom bar height dynamically using ResizeObserver
  useEffect(() => {
    if (!bottomBarRef.current) return

    const updateHeight = () => {
      if (bottomBarRef.current) {
        setBottomBarHeight(bottomBarRef.current.offsetHeight)
      }
    }

    updateHeight()

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(updateHeight)
    })
    observer.observe(bottomBarRef.current)

    window.addEventListener('resize', updateHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHeight)
    }
  }, [])

  // Update top bar height dynamically using ResizeObserver
  useEffect(() => {
    if (!topBarRef.current) return

    const updateHeight = () => {
      if (topBarRef.current) {
        setTopBarHeight(topBarRef.current.offsetHeight)
      }
    }

    updateHeight()

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(updateHeight)
    })
    observer.observe(topBarRef.current)

    window.addEventListener('resize', updateHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHeight)
    }
  }, [])

  // (Removed duplicate scrollIntoView logic; rely on unified scrollToBottom)

  // Enhanced scroll function to ensure new messages are fully visible
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      // Use a longer delay to ensure the new message is fully rendered
      setTimeout(() => {
      requestAnimationFrame(() => {
          const container = messagesEndRef.current?.closest('.messages-container') as HTMLElement;
          if (container && messagesEndRef.current) {
            // Scroll to the bottom with some padding to ensure full visibility
            container.scrollTo({
              top: container.scrollHeight,
              behavior: 'smooth'
            });
            setShowScrollToBottom(false)
          } else {
            // Fallback to scrollIntoView
        messagesEndRef.current?.scrollIntoView({ 
          behavior: 'smooth',
          block: 'end',
          inline: 'nearest'
            });
          }
        })
      }, 150) // Longer delay to ensure DOM update and message rendering
    }
  }, [])

  // Track scroll position to show a scroll-to-bottom FAB on Android
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const onScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      setShowScrollToBottom(distanceFromBottom > 72)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => container.removeEventListener('scroll', onScroll as EventListener)
  }, [])

  // Scroll when keyboard opens/closes
  useEffect(() => {
    const t = setTimeout(scrollToBottom, 350); // wait for keyboard animation
    return () => clearTimeout(t);
  }, [isKeyboardVisible, scrollToBottom]);

  // Handle virtual keyboard detection
  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== 'undefined' && window.innerWidth <= 768) {
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const windowHeight = window.innerHeight;
        const heightDifference = windowHeight - viewportHeight;
        setIsKeyboardVisible(heightDifference > 150);
      }
    };

    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      return () => window.visualViewport?.removeEventListener('resize', handleResize);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Throttled function to update thoughts - batches rapid updates
  const updateThoughtsThrottled = useCallback((newThoughts: string[]) => {
    pendingThoughtsRef.current = newThoughts
    
    if (thoughtUpdateTimeoutRef.current) {
      clearTimeout(thoughtUpdateTimeoutRef.current)
    }
    
    thoughtUpdateTimeoutRef.current = setTimeout(() => {
      setCurrentThoughts([...pendingThoughtsRef.current])
      thoughtUpdateTimeoutRef.current = null
    }, 50) // Reduced delay from 100ms to 50ms for faster updates
  }, [])

  // moved scrollToBottom above

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
    scrollToBottom()
    }
  }, [messages, scrollToBottom])

  // Also scroll when loading completes
  useEffect(() => {
    if (!isLoading) {
      setTimeout(scrollToBottom, 200)
    }
  }, [isLoading, scrollToBottom])

  // Scroll when current response updates during streaming
  useEffect(() => {
    if (currentResponse && isLoading) {
      setTimeout(scrollToBottom, 100)
    }
  }, [currentResponse, isLoading, scrollToBottom])

  // Ensure thoughts summary bubbles are fully visible while streaming
  useEffect(() => {
    if (isLoading && currentThoughts.length > 0) {
      setTimeout(scrollToBottom, 80)
    }
  }, [currentThoughts, isLoading, scrollToBottom])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (thoughtUpdateTimeoutRef.current) {
        clearTimeout(thoughtUpdateTimeoutRef.current)
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  // Copy message function
  const copyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedMessageId(messageId)
      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopiedMessageId(null)
      }, 2000)
    } catch (error) {
      console.error('Failed to copy message:', error)
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = content
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopiedMessageId(messageId)
      setTimeout(() => {
        setCopiedMessageId(null)
      }, 2000)
    }
  }, [])

  const showError = useCallback((message: string) => {
    setErrorNotificationMessage(message);
    setShowErrorNotification(true);
    const timer = setTimeout(() => {
      setShowErrorNotification(false);
      setErrorNotificationMessage('');
    }, 5000); // Notification visible for 5 seconds
    return () => clearTimeout(timer);
  }, []);

  // Menu is closed via overlay or header button; no document-level listener needed

  // Load messages from server on component mount
  useEffect(() => {
    const loadConversations = async () => {
      try {
        const response = await fetch('/api/conversations')
        if (response.ok) {
          const data = await response.json()
          if (data.messages && data.messages.length > 0) {
            const parsedMessages = data.messages.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp)
            }))
            // Check for duplicate IDs
            const ids = parsedMessages.map((m: any) => m.id)
            const uniqueIds = new Set(ids)
            if (ids.length !== uniqueIds.size) {
              console.warn('Duplicate message IDs found:', ids.filter((id: any, index: number) => ids.indexOf(id) !== index))
            }
            
            // Check for missing IDs
            const messagesWithoutIds = parsedMessages.filter((m: any) => !m.id)
            if (messagesWithoutIds.length > 0) {
              console.warn('Messages without IDs found:', messagesWithoutIds.length)
              // Add IDs to messages that don't have them
              const messagesWithIds = parsedMessages.map((msg: any, index: number) => ({
                ...msg,
                id: msg.id || `generated-${Date.now()}-${index}`
              }))
              setMessages(messagesWithIds)
              return
            }
            
            setMessages(parsedMessages)
          } else {
            console.log('No messages found in response')
          }
        } else {
          console.error('Failed to load conversations:', response.status, response.statusText)
        }
      } catch (error) {
        console.error('Failed to load conversations:', error)
      }
    }
    
    loadConversations()
  }, [])

  // Debounced save function to prevent excessive API calls
  const debouncedSave = useCallback((messagesToSave: Message[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await fetch('/api/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages: messagesToSave }),
        })
        console.log('Auto-save completed successfully')
      } catch (error) {
        console.error('Failed to save conversations:', error)
      }
    }, 1000) // Wait 1 second before saving
  }, [])

  // Save messages to server whenever messages change (with debouncing)
  useEffect(() => {
    if (messages.length > 0) {
      debouncedSave(messages)
    }
  }, [messages, debouncedSave])

  // Optimized input text change handler
  const handleInputTextChange = useCallback((newValue: string) => {
    setInputText(newValue)
  }, [])

  // Optimized textarea focus handler - reduced frequency
  const handleTextareaFocus = useCallback(() => {
    // Only scroll if not already at bottom to avoid unnecessary calls
    const shouldScroll = messagesEndRef.current && 
      messagesEndRef.current.getBoundingClientRect().bottom > window.innerHeight + 100
    
    if (shouldScroll) {
      setTimeout(() => {
        scrollToBottom()
      }, 400)
    }
  }, [scrollToBottom])

  const addNote = useCallback(() => {
    if (!inputText.trim()) return

    const newNote: Message = {
      id: Date.now().toString(),
      content: inputText.trim(),
      type: 'note',
      timestamp: new Date()
    }

    setMessages(prev => [...prev, newNote])
    setInputText('')
    
    // Scroll to bottom after adding note with delay
    setTimeout(() => scrollToBottom(), 200)
  }, [inputText, scrollToBottom])

  // Voice notes: recording + transcription via /api/transcribe (Groq Whisper)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])

  const transcribeBlob = useCallback(async (blob: Blob) => {
    try {
      setIsTranscribing(true)
      const form = new FormData()
      form.append('audio', new File([blob], 'voice_note.webm', { type: blob.type || 'audio/webm' }))
      const res = await fetch('/api/transcribe', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || `Transcription failed (${res.status})`)
      }
      const data = await res.json()
      const text = (data?.text || '').trim()
      if (!text) throw new Error('Empty transcription')

      const newNote: Message = {
        id: Date.now().toString(),
        content: text,
        type: 'note',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, newNote])
      setTimeout(() => scrollToBottom(), 200)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      showError(`Voice note error: ${msg}`)
    } finally {
      setIsTranscribing(false)
    }
  }, [setMessages, scrollToBottom, showError])

  const toggleRecording = useCallback(async () => {
    try {
      if (!isRecording) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined
        const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
        recordedChunksRef.current = []
        mr.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data)
        }
        mr.onstop = async () => {
          try {
            const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || 'audio/webm' })
            stream.getTracks().forEach(t => t.stop())
            await transcribeBlob(blob)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            showError(`Recording error: ${msg}`)
          }
        }
        mediaRecorderRef.current = mr
        mr.start()
        setIsRecording(true)
      } else {
        mediaRecorderRef.current?.stop()
        setIsRecording(false)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      showError(`Mic permission or recording failed: ${msg}`)
    }
  }, [isRecording, transcribeBlob, showError])

  const deleteNote = (id: string) => {
    if (!confirm('Delete this note?')) return
    setMessages(prev => prev.filter(m => m.id !== id))
  }

  const downloadNotes = () => {
    const notes = messages.filter(msg => msg.type === 'note')
    
    if (notes.length === 0) {
      alert('No notes to download')
      return
    }

    const content = notes.map(note => {
      const formattedDate = note.timestamp.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
      return `[${formattedDate}] ${note.content}`
    }).join('\n\n')

    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `notes-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const pruneConversation = async () => {
    if (messages.length === 0) return
    
    // Ask for confirmation
    if (!confirm('Clean up conversation by removing errors and useless messages? This cannot be undone.')) {
      return
    }
    
    setIsPruning(true)
    
    try {
      // Prepare the conversation for pruning analysis
      const conversationSummary = messages.map((msg, index) => {
        return `${index + 1}. [${msg.type.toUpperCase()}] ${msg.content}`
      }).join('\n')

      const pruningPrompt = `You are a conversation curator. Analyze this conversation and identify which messages should be KEPT vs REMOVED to maintain only valuable, relevant information.

KEEP messages that are:
- Valuable notes with useful information
- Meaningful questions and their answers
- Important context or facts
- Recent relevant information

REMOVE messages that are:
- Error messages (network errors, API failures, etc.)
- Duplicate or redundant information
- "Sorry, I encountered an error" type responses
- Useless or meaningless content
- Outdated information that's been superseded

CONVERSATION TO ANALYZE:
${conversationSummary}

Respond with ONLY a JSON array of the message numbers (1-${messages.length}) that should be KEPT. Example: [1, 3, 5, 7]`

      const response = await fetch('/api/chat-enhanced', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: pruningPrompt,
          conversationHistory: []
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No reader available')
      }

      let aiResponse = ''
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const event of events) {
          const line = event.trim()
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'text') {
                aiResponse += data.content
              }
            } catch (e) {
              console.error('Error parsing chunk:', e, line)
            }
          }
        }
      }
      console.log('Pruning response:', aiResponse)

      // Extract the JSON array from the response
      const jsonMatch = aiResponse.match(/\[[\d,\s]+\]/)
      if (jsonMatch) {
        const keepIndices = JSON.parse(jsonMatch[0])
        
        // Filter messages based on AI recommendation
        const prunedMessages = messages.filter((_, index) => 
          keepIndices.includes(index + 1)
        )

        if (prunedMessages.length < messages.length) {
          setMessages(prunedMessages)
          console.log(`Pruned conversation: ${messages.length} → ${prunedMessages.length} messages`)
        } else {
          console.log('No messages were pruned - all deemed valuable')
        }
      } else {
        console.error('Could not parse pruning response')
      }

    } catch (error) {
      console.error('Failed to prune conversation:', error)
    } finally {
      setIsPruning(false)
    }
  }

  const findProfitOpportunity = async () => {
    if (isFindingOpportunity) return

    setIsFindingOpportunity(true)
    
    try {
      // Get all notes for analysis with timestamps
      const allNotes = messages.filter(m => m.type === 'note').map(m => ({
        content: m.content,
        timestamp: m.timestamp
      }))
      
      // Build conversation history for the API
      const conversationHistory: any[] = []
      
      // Add notes to conversation history
      allNotes.forEach((note) => {
        const dateStr = note.timestamp.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
        conversationHistory.push({
          role: 'user',
          parts: [{ text: `note: [${dateStr}] ${note.content}` }]
        })
      })
      
      let opportunityPrompt = `You are a business consultant. Based on the notes provided, recommend ONE opportunity with the highest chance of increasing profits.`

      opportunityPrompt += `\n\nCURRENT NOTES (with timestamps):
  ${allNotes.length > 0 ? allNotes.map((note, index) => {
    const dateStr = note.timestamp.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    return `${index + 1}. [${dateStr}] ${note.content}`
  }).join('\n') : 'No notes provided yet.'}

  TASK:
  Identify one actionable opportunity most likely to boost profits. Keep it under two sentences and briefly explain why it is promising.`

      const response = await fetch('/api/chat-enhanced', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: opportunityPrompt,
          conversationHistory: conversationHistory
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No reader available')
      }

      let aiResponseText = ''
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const event of events) {
          const line = event.trim()
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'text') {
                aiResponseText += data.content
              }
            } catch (e) {
              console.error('Error parsing chunk:', e, line)
            }
          }
        }
      }

      if (!aiResponseText) {
        aiResponseText = 'No response received'
      }

      const opportunityResponse: Message = {
        id: Date.now().toString(),
        content: aiResponseText,
        type: 'ai-response',
        timestamp: new Date()
      }

      setMessages(prev => {
        const newMessages = [...prev, opportunityResponse]
        
        // Scroll to bottom after adding response with delay
        setTimeout(() => scrollToBottom(), 200)
        
        return newMessages
      })

    } catch (error) {
      console.error('Failed to find profit opportunity:', error)
      let errorMessage = 'Sorry, I encountered an error while searching for a profit opportunity. Please try again.';
      if (error instanceof Error) {
        errorMessage = `Error: ${error.message}`;
      }
      showError(errorMessage);
      const errorResponse: Message = {
        id: Date.now().toString(),
        content: errorMessage,
        type: 'ai-response',
        timestamp: new Date()
      }
      
      setMessages(prev => [...prev, errorResponse])
    } finally {
      setIsFindingOpportunity(false)
    }
  }

  // Function to fetch dishes prices data with client-side caching
  const fetchDishesData = async (): Promise<DishesData | null> => {
    const CACHE_KEY = 'dishesDataCache';
    const CACHE_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

    try {
      // Try to load from cache first
      if (typeof window !== 'undefined') {
        const cachedData = localStorage.getItem(CACHE_KEY);
        if (cachedData) {
          const { data, timestamp } = JSON.parse(cachedData);
          if (Date.now() - timestamp < CACHE_EXPIRATION_MS) {
            console.log('🍽️ Loading dishes data from cache.');
            return data;
          } else {
            console.log('🍽️ Cached dishes data expired. Fetching new data.');
          }
        }
      }

      console.log('🍽️ Fetching dishes data from proxy API...');
      const response = await fetch('/api/dishes-proxy', {
        method: 'GET',
      });
      
      if (!response.ok) {
        console.warn('Failed to fetch dishes data:', response.status, response.statusText);
        return null;
      }
      
      const data = await response.json();
      
      // Check if the response contains an error
      if (data.error) {
        console.warn('API returned error:', data.error);
        return null;
      }
      
      console.log('🍽️ Successfully fetched production cost data:', {
        totalDishes: data.totalDishes,
        lastUpdated: data.lastUpdated,
        sampleDishes: data.dishes.slice(0, 3).map((d: Dish) => `${d.name}: ${d.cost.amount} ${d.cost.unit} to produce`),
        dishesWithCalculationNotes: data.dishes.filter((d: Dish) => d.calculationNotes).length,
        buffetStats: data.buffetStats ? {
          basicDishes: data.buffetStats.buffetBasicoDishCount,
          premiumDishes: data.buffetStats.buffetPremiumDishCount,
          avgBasicCost: data.buffetStats.averageCostBuffetBasico,
          avgPremiumCost: data.buffetStats.averageCostBuffetPremium
        } : 'Not available'
      });

      // Cache the new data
      if (typeof window !== 'undefined') {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
      }
      
      return data;
    } catch (error) {
      console.warn('Error fetching dishes data:', error);
      return null;
    }
  }

  const askAI = useCallback(async () => {
    if (!inputText.trim()) return

    // Add user question first (as 'question' type, not 'note')
    const userQuestion: Message = {
      id: Date.now().toString(),
      content: inputText.trim(),
      type: 'question',
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userQuestion])
    setIsLoading(true)
    setIsThinking(true)
    setCurrentResponse('')
    setCurrentCodeBlocks([])
    setCurrentThoughts([])
    const currentQuestion = inputText.trim()
    setInputText('')

    try {
      // Get all previous notes for context (ONLY notes, not questions or AI responses) with timestamps
      const allNotes = messages.filter(m => m.type === 'note').map(m => ({
        content: m.content,
        timestamp: m.timestamp
      }))
      
      // Build conversation history for the API
      const conversationHistory: any[] = []
      
      // Add notes to conversation history
      allNotes.forEach((note) => {
        const dateStr = note.timestamp.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
        conversationHistory.push({
          role: 'user',
          parts: [{ text: `note: [${dateStr}] ${note.content}` }]
        })
      })

      // Get user's timezone for proper timestamp handling
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      console.log('🌍 User timezone detected:', userTimezone);

      // Use enhanced multi-step workflow
      setCurrentStep('Enhanced Analysis...')
      const response = await fetch('/api/chat-enhanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: currentQuestion,
          conversationHistory: conversationHistory,
          userTimezone: userTimezone
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No reader available')
      }

      let assistantResponse = ''
      let thoughts: string[] = []
      let codeBlocks: Array<{ code: string, language: string, result?: string }> = []
      let currentCodeBlock: { code: string, language: string, result?: string } | null = null
      let hasReceivedThoughts = false

      const decoder = new TextDecoder()
      let buffer = ''

      setIsThinking(false) // Stop thinking indicator when streaming starts
      setCurrentStep('') // Clear step indicator when streaming starts
      console.log('Starting to process stream...')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const event of events) {
          const line = event.trim()
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.type === 'thought') {
                thoughts.push(data.content);
                setCurrentThoughts([...thoughts]); // Direct state update for immediate feedback
                hasReceivedThoughts = true;
                console.log('🧠 Real-time thought received:', {
                  thoughtNumber: thoughts.length,
                  contentLength: data.content?.length || 0,
                  contentPreview: data.content?.substring(0, 150) + '...'
                })
              } else if (data.type === 'text') {
                assistantResponse += data.content
                setCurrentResponse(assistantResponse)
              } else if (data.type === 'code') {
                currentCodeBlock = {
                  code: data.content.code,
                  language: data.content.language
                }
                codeBlocks.push(currentCodeBlock)
                setCurrentCodeBlocks([...codeBlocks])
              } else if (data.type === 'code_result' && currentCodeBlock) {
                currentCodeBlock.result = data.content.output
                setCurrentCodeBlocks([...codeBlocks])
              }
            } catch (e) {
              console.error('Error parsing chunk:', e, line)
            }
          }
        }
      }

      // Thoughts are ephemeral - no need to log final summary
      if (hasReceivedThoughts) {
        console.log('✅ Thinking process completed, showing final response')
      }

      // Add complete assistant message (thoughts were already shown during streaming)
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        content: assistantResponse || 'No response received',
        type: 'ai-response',
        timestamp: new Date(),
        codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
        // Don't include thoughts in final message - they were shown during streaming
        thoughts: undefined
      }

      setMessages(prev => {
        const newMessages = [...prev, aiResponse]
        
        // Scroll to bottom after adding AI response with delay
        setTimeout(() => scrollToBottom(), 200)
        
        return newMessages
      })

      // Clear streaming state
      setCurrentResponse('')
      setCurrentCodeBlocks([])
      
      // Keep thoughts visible for 3 seconds after response completes
      if (thoughts.length > 0) {
        console.log('✅ Keeping thoughts visible for 3 more seconds')
        setTimeout(() => {
          console.log('🧹 Clearing thoughts after delay')
      setCurrentThoughts([])
        }, 3000)
      } else {
        setCurrentThoughts([])
      }
      
      // Clear any pending thought updates
      if (thoughtUpdateTimeoutRef.current) {
        clearTimeout(thoughtUpdateTimeoutRef.current)
        thoughtUpdateTimeoutRef.current = null
      }

    } catch (error) {
      console.error('Failed to get AI response:', error)
      
      // More detailed error message
      let errorMessage = 'Sorry, I encountered an error while processing your request.'
      
      if (error instanceof Error) {
        if (error.message.includes('API_KEY') || error.message.includes('credentials')) {
          errorMessage = 'API Key error: Please check your Gemini API key configuration.'
        } else if (error.message.includes('PERMISSION_DENIED')) {
          errorMessage = 'Permission denied: Your API key may not have access to Gemini Pro.'
        } else if (error.message.includes('QUOTA_EXCEEDED')) {
          errorMessage = 'Quota exceeded: You may have reached your API usage limit.'
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
          errorMessage = 'Network error: Please check your internet connection.'
        } else {
          errorMessage = `Error: ${error.message}`
        }
      }
      showError(errorMessage);
      const errorResponse: Message = {
        id: (Date.now() + 1).toString(),
        content: errorMessage,
        type: 'ai-response',
        timestamp: new Date()
      }
      setMessages(prev => {
        const newMessages = [...prev, errorResponse]
        
        // Scroll to bottom after adding error response with delay
        setTimeout(() => scrollToBottom(), 200)
        
        return newMessages
      })

      // Clear streaming state
      setCurrentResponse('')
      setCurrentCodeBlocks([])
    } finally {
      setIsLoading(false)
      setIsThinking(false)
      setCurrentStep('') // Clear step indicator when done
    }
  }, [inputText, messages, scrollToBottom, setCurrentThoughts, updateThoughtsThrottled, showError])

  // Optimized keyboard handler with useCallback
  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Send the text as a question when pressing Enter
      if (inputText.trim()) {
        void askAI()
      }
    }
  }, [inputText, askAI])

  // Calculate visible messages for performance
  const visibleMessages = useMemo(
    () => messages.slice(-visibleMessageCount),
    [messages, visibleMessageCount]
  )
  const hasMoreMessages = messages.length > visibleMessageCount

  // Memoize button states to prevent unnecessary re-renders
  const isAddNoteDisabled = useMemo(() => !inputText.trim(), [inputText])
  const isAskAIDisabled = useMemo(() => !inputText.trim() || isLoading, [inputText, isLoading])

  // Load more messages function
  const loadMoreMessages = useCallback(() => {
    setIsLoadingMore(true)
    setTimeout(() => {
      setVisibleMessageCount(prev => Math.min(prev + 30, messages.length))
      setIsLoadingMore(false)
    }, 300) // Small delay to show loading state
  }, [messages.length])

  return (
    <div className="bg-amoled-black min-h-screen">
      {/* Top App Bar */}
      <div ref={topBarRef} className="sticky top-0 z-40 bg-black/60 backdrop-blur-sm border-b border-amoled-border safe-area-inset-top">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center shadow-glow-blue">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Contextual Assistant</div>
              <div className="text-xs text-amoled-textMuted">Notes + AI on Android</div>
            </div>
          </div>
          <button
            onClick={() => setIsMenuOpen(true)}
            className="p-2 rounded-xl hover:bg-amoled-lightGray focus-ring touch-target"
            aria-label="Open menu"
          >
            <span className="text-xl leading-none text-white/80" aria-hidden="true">⋮</span>
          </button>
        </div>
      </div>
      {/* Messages Area */}
      <div
        ref={messagesContainerRef}
        className="overflow-y-auto px-3 sm:px-5 py-4 sm:py-6 custom-scrollbar messages-container"
        style={{
          height: `calc(100dvh - ${bottomBarHeight}px - ${topBarHeight}px)`,
        }}
      >
        {messages.length === 0 && !currentResponse && !isThinking && (
          <div className="text-center py-12 sm:py-16 px-6 flex flex-col items-center justify-center">
            <div className="w-20 h-20 bg-gradient-to-br from-accent-blue to-accent-purple rounded-3xl flex items-center justify-center mb-6 shadow-glow-blue">
              <Bot className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-3 text-gradient">
              Welcome to your Contextual Assistant
            </h2>
            <p className="text-base sm:text-lg text-amoled-textSecondary max-w-lg mx-auto leading-relaxed">
              Start by adding a note to build your knowledge base, or ask the AI a question to get instant insights.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 max-w-md">
              <div className="flex items-center space-x-2 text-sm text-amoled-textMuted">
                <div className="w-2 h-2 bg-accent-green rounded-full"></div>
                <span>Add notes for context</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-amoled-textMuted">
                <div className="w-2 h-2 bg-accent-blue rounded-full"></div>
                <span>Ask questions anytime</span>
              </div>
            </div>
          </div>
        )}

        {/* Load More Button - Show when there are more messages */}
        {hasMoreMessages && (
          <div className="text-center py-2">
            <button
              onClick={loadMoreMessages}
              disabled={isLoadingMore}
              className="btn-secondary px-6 py-3 touch-target"
            >
              {isLoadingMore ? (
                <div className="flex items-center space-x-3">
                  <div className="w-5 h-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  <span className="font-medium">Loading...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <span className="font-medium">Load {Math.min(30, messages.length - visibleMessageCount)} More</span>
                  <div className="w-1 h-1 bg-white rounded-full"></div>
                </div>
              )}
            </button>
          </div>
        )}

        {/* Bottom-anchored message area */}
        <div className="flex flex-col justify-end min-h-full mt-4 sm:mt-6">
          <div className="space-y-3 sm:space-y-4">
            <MessagesList
              messages={visibleMessages}
              onCopy={copyMessage}
              onDelete={deleteNote}
              copiedMessageId={copiedMessageId}
            />

            {/* Show loading state with thoughts */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="max-w-xs sm:max-w-sm lg:max-w-md px-3 sm:px-4 py-2 sm:py-3 rounded-2xl bg-gray-900 border border-gray-700">
                  <div className="flex items-start space-x-2">
                    <div className="flex items-center space-x-2">
                      <Bot className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                      {currentStep && (
                        <div className="text-xs text-blue-300 bg-blue-900/50 px-2 py-1 rounded-full border border-blue-700/50">
                          {currentStep}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {currentResponse ? (
                        <div className="text-sm leading-relaxed animate-fadeIn">
                          <Markdown>{currentResponse}</Markdown>
                          {currentCodeBlocks.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {currentCodeBlocks.map((block, blockIndex) => (
                                  <div key={blockIndex} className="border border-gray-600 rounded-lg bg-gray-800 overflow-hidden">
                                  <details className="group">
                                    <summary className="w-full flex items-center justify-between p-3 bg-gray-700 hover:bg-gray-600 transition-colors cursor-pointer list-none">
                                      <span className="text-yellow-400 text-sm font-medium">
                                        🔧 {block.language.toUpperCase()} Execution
                                      </span>
                                      <span className="text-gray-400 text-xs group-open:hidden">
                                        ▶️ Expand
                                      </span>
                                      <span className="text-gray-400 text-xs hidden group-open:inline">
                                        🔽 Collapse
                                      </span>
                                    </summary>
                                      <div className="p-3">
                                        <div className="text-yellow-400 mb-2 text-xs font-medium">Code:</div>
                                        <pre className="whitespace-pre-wrap text-green-400 font-mono text-xs leading-relaxed overflow-x-auto break-words max-w-full bg-gray-900 p-2 rounded">
                                          {block.code}
                                        </pre>
                                        {block.result && (
                                          <>
                                            <div className="text-yellow-400 mt-3 mb-1 text-xs font-medium">Output:</div>
                                            <pre className="whitespace-pre-wrap text-white font-mono text-xs leading-relaxed bg-gray-900 p-2 rounded border border-gray-700 overflow-x-auto break-words max-w-full">
                                              {block.result}
                                            </pre>
                                          </>
                                        )}
                                      </div>
                                  </details>
                                  </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : currentThoughts.length > 0 ? (
                        <div className="text-sm leading-relaxed">
                          <div className="flex items-center space-x-2 mb-3 bg-purple-800/30 px-2 py-1 rounded-full">
                            <div className="animate-pulse text-purple-400">🧠</div>
                            <div className="text-xs text-purple-300 font-medium">
                              Thinking... ({currentThoughts.length})
                            </div>
                            <div className="w-2 h-2 bg-purple-400 animate-ping rounded-full"></div>
                          </div>
                          <div className="relative border border-purple-500/40 rounded-lg bg-purple-900/30 overflow-hidden">
                            <div className="p-3">
                              <div className="text-xs text-purple-300 font-medium mb-2">
                                {(() => {
                                  const currentThought = currentThoughts[currentThoughts.length - 1] || '';
                                  const titleMatch = currentThought.match(/^\*\*(.*?)\*\*/);
                                  return titleMatch ? titleMatch[1] : 'Current Thought';
                                })()}:
                              </div>
                              <div className="relative">
                                <div 
                                  key={currentThoughts.length}
                                  className="text-purple-100 whitespace-pre-wrap text-sm leading-relaxed transition-opacity duration-300"
                                  style={{
                                    height: 'calc(6 * 1.5rem)',
                                    overflow: 'hidden',
                                    WebkitMask: 'linear-gradient(to bottom, black 0%, black 50%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.3) 85%, transparent 100%)',
                                    mask: 'linear-gradient(to bottom, black 0%, black 50%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.3) 85%, transparent 100%)'
                                  }}
                                >
                                  {(() => {
                                    const currentThought = currentThoughts[currentThoughts.length - 1] || '';
                                    const lines = currentThought.split('\n');
                                    if (lines[0] && lines[0].match(/^\*\*.*\*\*$/)) {
                                      let startIndex = 1;
                                      while (startIndex < lines.length && lines[startIndex].trim() === '') {
                                        startIndex++;
                                      }
                                      return lines.slice(startIndex).join('\n');
                                    }
                                    return currentThought;
                                  })()}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-start min-h-[24px]">
                          <div className="flex space-x-1 items-center">
                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Add bottom spacer for breathing room (dynamic to avoid clipping) */}
            <div ref={messagesEndRef} style={{ height: Math.max(24, bottomBarHeight / 2) }} />
          </div>
        </div>
      </div>

      {/* Error Notification */}
      {showErrorNotification && (
        <div className="notification bg-accent-red border-red-500">
          <div className="flex items-center space-x-3">
            <div className="w-5 h-5 bg-red-400 rounded-full flex items-center justify-center">
              <span className="text-xs">!</span>
            </div>
            <span className="font-medium">{errorNotificationMessage}</span>
          </div>
        </div>
      )}

      {/* Scroll to Bottom FAB */}
      {showScrollToBottom && (
        <button
          onClick={scrollToBottom}
          className="fixed right-4 z-40 rounded-full bg-amoled-gray border border-amoled-border shadow-amoled touch-target flex items-center justify-center w-12 h-12 hover:bg-amoled-lightGray active:scale-95 transition-all"
          style={{ bottom: bottomBarHeight + 16 }}
          aria-label="Scroll to latest"
        >
          <span className="text-xl text-white leading-none" aria-hidden="true">↓</span>
        </button>
      )}

      {/* Bottom Sheet Menu (Android style) */}
      {isMenuOpen && (
        <>
          <div className="menu-overlay" onClick={() => setIsMenuOpen(false)}></div>
          <div className="fixed inset-x-0 bottom-0 z-[9999] bg-amoled-gray border-t border-amoled-border rounded-t-3xl shadow-2xl animate-slideUp">
            <div className="px-6 pt-4 pb-2 flex items-center justify-between">
              <h3 className="text-white font-semibold text-lg">Quick actions</h3>
              <button onClick={() => setIsMenuOpen(false)} className="p-2 rounded-xl hover:bg-amoled-lightGray focus-ring" aria-label="Close menu">
                <span className="text-lg leading-none text-white/80" aria-hidden="true">✕</span>
              </button>
            </div>
            <div className="divide-y divide-amoled-border">
              <button
                onClick={() => {
                  downloadNotes()
                  setIsMenuOpen(false)
                }}
                className="w-full flex items-center space-x-4 px-6 py-4 text-left text-white hover:bg-amoled-lightGray transition-colors touch-target"
              >
                <div className="w-10 h-10 bg-accent-green/20 rounded-xl flex items-center justify-center">
                  <Download className="w-5 h-5 text-accent-green" />
                </div>
                <div className="flex-1">
                  <span className="text-base font-medium">Download Notes</span>
                  <p className="text-xs text-amoled-textMuted mt-1">Export all your notes</p>
                </div>
              </button>
              <button
                onClick={() => {
                  findProfitOpportunity()
                  setIsMenuOpen(false)
                }}
                disabled={isFindingOpportunity || isLoading}
                className="w-full flex items-center space-x-4 px-6 py-4 text-left text-white hover:bg-amoled-lightGray disabled:hover:bg-amoled-gray disabled:opacity-50 transition-colors touch-target"
              >
                <div className="w-10 h-10 bg-accent-amber/20 rounded-xl flex items-center justify-center">
                  {isFindingOpportunity ? (
                    <div className="w-5 h-5 animate-spin rounded-full border-2 border-accent-amber border-t-transparent"></div>
                  ) : (
                    <Search className="w-5 h-5 text-accent-amber" />
                  )}
                </div>
                <div className="flex-1">
                  <span className="text-base font-medium">Find Profit Opportunity</span>
                  <p className="text-xs text-amoled-textMuted mt-1">Analyze your notes</p>
                </div>
              </button>
              <button
                onClick={() => {
                  pruneConversation()
                  setIsMenuOpen(false)
                }}
                disabled={isPruning}
                className="w-full flex items-center space-x-4 px-6 py-4 text-left text-white hover:bg-amoled-lightGray disabled:hover:bg-amoled-gray disabled:opacity-50 transition-colors touch-target"
              >
                <div className="w-10 h-10 bg-accent-purple/20 rounded-xl flex items-center justify-center">
                  {isPruning ? (
                    <div className="w-5 h-5 animate-spin rounded-full border-2 border-accent-purple border-t-transparent"></div>
                  ) : (
                    <Scissors className="w-5 h-5 text-accent-purple" />
                  )}
                </div>
                <div className="flex-1">
                  <span className="text-base font-medium">Clean Up Conversation</span>
                  <p className="text-xs text-amoled-textMuted mt-1">Remove useless messages</p>
                </div>
              </button>
              <div className="h-6 safe-area-inset-bottom" />
            </div>
          </div>
        </>
      )}

      {/* Input Area - Fixed at bottom */}
      <div
        ref={bottomBarRef}
        className="keyboard-aware-bottom bg-amoled-dark border-t border-amoled-border p-4 pb-8 safe-area-inset-bottom"
      >
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="relative">
                          <OptimizedTextarea
                value={inputText}
                onChange={handleInputTextChange}
                onKeyPress={handleKeyPress}
                onFocus={handleTextareaFocus}
                placeholder="Type your note or question here..."
                disabled={isLoading}
              className="input-enhanced w-full resize-none"
              />
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={toggleRecording}
              disabled={isTranscribing}
              className="btn-secondary w-14 h-14 flex items-center justify-center rounded-xl"
              aria-label={isRecording ? 'Stop recording' : 'Start voice note'}
              title={isRecording ? 'Stop recording' : 'Start voice note'}
            >
              {isTranscribing ? (
                <div className="w-5 h-5 animate-spin rounded-full border-2 border-accent-purple border-t-transparent"></div>
              ) : isRecording ? (
                <StopIcon className="w-5 h-5 text-accent-red" />
              ) : (
                <MicIcon className="w-5 h-5 text-accent-purple" />
              )}
            </button>
            <button
              onClick={addNote}
              disabled={isAddNoteDisabled}
              className="btn-success flex-1 flex items-center justify-center space-x-3 px-4 py-4 touch-target"
            >
              <Plus className="w-5 h-5" />
              <span className="text-base font-semibold">Add Note</span>
            </button>
            <button
              onClick={askAI}
              disabled={isAskAIDisabled}
              className="btn-primary flex-1 flex items-center justify-center space-x-3 px-4 py-4 touch-target"
            >
              <Send className="w-5 h-5" />
              <span className="text-base font-semibold">Ask AI</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
} 
