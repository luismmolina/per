import { getSql } from './postgres'

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

const CONVERSATIONS_KEY = 'contextual-conversations'

async function ensureSchema() {
  const sql = getSql()
  await sql`
    create table if not exists conversations (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz default now()
    )
  `
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
  await ensureSchema()
  const sql = getSql()
  const rows = await sql`
    select data from conversations where id = ${CONVERSATIONS_KEY} limit 1
  `
  const first = Array.isArray(rows) ? (rows[0] as { data?: unknown } | undefined) : undefined
  return normalizeConversationData(first?.data)
}

export async function saveConversations(data: ConversationData): Promise<void> {
  await ensureSchema()
  const sql = getSql()
  const normalized = normalizeConversationData(data)
  const sqlWithJson = sql as unknown as { json?: (value: unknown) => unknown }
  const jsonData = typeof sqlWithJson.json === 'function'
    ? sqlWithJson.json(normalized)
    : JSON.stringify(normalized)

  await sql`
    insert into conversations (id, data, updated_at)
    values (${CONVERSATIONS_KEY}, ${jsonData}::jsonb, now())
    on conflict (id) do update
      set data = excluded.data,
          updated_at = now()
  `
}

export async function clearConversations(): Promise<void> {
  await saveConversations({ messages: [], lastUpdated: new Date().toISOString(), totalMessages: 0 })
}
