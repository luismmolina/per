import { neon, neonConfig } from '@neondatabase/serverless'

// Cache connections across invocations (ideal for serverless/Next.js)
neonConfig.fetchConnectionCache = true

// Ensure DATABASE_URL is present
export function assertDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

// Lazily create a singleton sql client
let _sql: ReturnType<typeof neon> | null = null
export function getSql() {
  if (_sql) return _sql
  const url = assertDatabaseUrl()
  _sql = neon(url)
  return _sql
}

