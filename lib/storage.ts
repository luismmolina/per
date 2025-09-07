import { getSql } from './postgres'

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

export async function loadConversations(): Promise<any> {
  await ensureSchema()
  const sql = getSql()
  const rows = await sql<[{ data: any }]>`
    select data from conversations where id = ${CONVERSATIONS_KEY} limit 1
  `
  return rows[0]?.data ?? { messages: [] }
}

export async function saveConversations(data: any): Promise<void> {
  await ensureSchema()
  const sql = getSql()
  // Use JSON serialization helper to store the payload safely
  // @ts-ignore - sql.json is available at runtime
  const jsonData = (sql as any).json ? (sql as any).json(data) : JSON.stringify(data)
  await sql`
    insert into conversations (id, data, updated_at)
    values (${CONVERSATIONS_KEY}, ${jsonData}::jsonb, now())
    on conflict (id) do update
      set data = excluded.data,
          updated_at = now()
  `
}

export async function clearConversations(): Promise<void> {
  // Reset to an empty payload rather than deleting the row
  await saveConversations({ messages: [], lastUpdated: new Date().toISOString(), totalMessages: 0 })
}

