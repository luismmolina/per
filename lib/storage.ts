import { getFirestoreDb } from './firebase'

export type ConversationMessageType = 'note' | 'question' | 'ai-response'

export interface StoredMessage {
  id?: string
  content?: string
  type?: ConversationMessageType | string
  timestamp?: string | Date
  [key: string]: unknown
}

export interface ConversationData {
  messages: StoredMessage[]
  lastUpdated?: string
  totalMessages?: number
  [key: string]: unknown
}

const CONVERSATIONS_DOC = 'contextual-conversations'
const CONVERSATIONS_COLLECTION = 'conversations'

function getMessageKey(message: StoredMessage) {
  if (message?.id) return `id:${message.id}`
  return [
    message?.type || 'unknown',
    message?.timestamp || '',
    message?.content || '',
  ].join(':')
}

function getTimestampMs(message: StoredMessage) {
  const timestamp = new Date(message?.timestamp ?? '').getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function mergeStoredMessages(existingMessages: StoredMessage[], incomingMessages: StoredMessage[]) {
  const merged = [...existingMessages]
  const indexByKey = new Map<string, number>()

  merged.forEach((message, index) => {
    indexByKey.set(getMessageKey(message), index)
  })

  for (const message of incomingMessages) {
    const key = getMessageKey(message)
    const existingIndex = indexByKey.get(key)

    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length)
      merged.push(message)
      continue
    }

    merged[existingIndex] = {
      ...merged[existingIndex],
      ...message,
    }
  }

  return merged.sort((a, b) => getTimestampMs(a) - getTimestampMs(b))
}

function getConversationsRef() {
  return getFirestoreDb().collection(CONVERSATIONS_COLLECTION).doc(CONVERSATIONS_DOC)
}

export function normalizeConversationData(value: unknown): ConversationData {
  if (!value || typeof value !== 'object') {
    return { messages: [], totalMessages: 0 }
  }

  const candidate = value as Record<string, unknown>
  const messages = Array.isArray(candidate.messages)
    ? candidate.messages.filter((message): message is StoredMessage => Boolean(message && typeof message === 'object'))
    : []

  return {
    ...candidate,
    messages,
    totalMessages: typeof candidate.totalMessages === 'number' ? candidate.totalMessages : messages.length,
  }
}

export function isNoteMessage(message: StoredMessage): message is StoredMessage & { content: string } {
  return message.type === 'note' && typeof message.content === 'string' && message.content.trim().length > 0
}

export function getMessageTimestampIso(message: Pick<StoredMessage, 'timestamp'>): string {
  if (!message.timestamp) {
    return new Date(0).toISOString()
  }

  const timestamp = message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp)
  if (Number.isNaN(timestamp.getTime())) {
    return new Date(0).toISOString()
  }

  return timestamp.toISOString()
}

export function getNoteMessages(data: ConversationData): Array<StoredMessage & { content: string }> {
  return normalizeConversationData(data)
    .messages
    .filter(isNoteMessage)
}

export async function loadConversations(): Promise<ConversationData> {
  const snapshot = await getConversationsRef().get()
  if (!snapshot.exists) {
    return { messages: [], totalMessages: 0 }
  }

  return normalizeConversationData(snapshot.data())
}

export async function saveConversations(data: ConversationData): Promise<void> {
  const normalized = normalizeConversationData(data)
  const payload = {
    ...normalized,
    lastUpdated: normalized.lastUpdated ?? new Date().toISOString(),
    totalMessages: normalized.totalMessages ?? normalized.messages.length,
    updated_at: new Date().toISOString(),
  }

  await getConversationsRef().set(payload, { merge: false })
}

export async function clearConversations(): Promise<void> {
  await saveConversations({ messages: [], lastUpdated: new Date().toISOString(), totalMessages: 0 })
}

export async function appendConversationMessages(incoming: StoredMessage[]): Promise<number> {
  if (!incoming.length) return 0

  const ref = getConversationsRef()
  const existing = await loadConversations()
  const messages = [...existing.messages, ...incoming]
  const lastUpdated = new Date().toISOString()

  await ref.set({
    ...existing,
    messages,
    lastUpdated,
    totalMessages: messages.length,
    updated_at: lastUpdated,
  }, { merge: false })

  return messages.length
}

export async function upsertConversationMessages(incoming: StoredMessage[]): Promise<ConversationData> {
  const existing = await loadConversations()
  const merged = mergeStoredMessages(existing.messages, incoming)
  const data: ConversationData = {
    ...existing,
    messages: merged,
    lastUpdated: new Date().toISOString(),
    totalMessages: merged.length,
  }

  await saveConversations(data)
  return data
}