const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const CONVERSATIONS_DOC = 'contextual-conversations'
const CONVERSATIONS_COLLECTION = 'conversations'
const DEFAULT_NOTES_FILE = 'notes.txt'

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex === -1) continue

    const key = trimmed.slice(0, equalsIndex).trim()
    let value = trimmed.slice(equalsIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

function hasFirebaseConfig() {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      (process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY)
  )
}

async function getFirestoreDb() {
  const { cert, getApps, initializeApp } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')

  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      const serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'),
      )
      initializeApp({ credential: cert(serviceAccount) })
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      initializeApp({ credential: cert(serviceAccount) })
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const absolutePath = path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
      const serviceAccount = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
      initializeApp({ credential: cert(serviceAccount) })
    } else {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      })
    }
  }

  return getFirestore()
}

function parseNotesExportFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const messages = []
  let currentNote = null

  const timestampRegex = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))\]\s*(.*)/

  for (const line of lines) {
    const trimmed = line.trimEnd()
    if (!trimmed.trim()) continue
    if (
      trimmed.startsWith('===') ||
      trimmed.startsWith('Total messages') ||
      trimmed.startsWith('Notes found') ||
      trimmed.startsWith('Exported') ||
      trimmed.startsWith('===================================================')
    ) {
      continue
    }

    const match = trimmed.match(timestampRegex)
    if (match) {
      if (currentNote) messages.push(currentNote)

      const timestampStr = match[1]
      const noteContent = match[2].trim()
      let date

      try {
        const parts = timestampStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i)
        if (parts) {
          const month = parseInt(parts[1], 10) - 1
          const day = parseInt(parts[2], 10)
          let year = parseInt(parts[3], 10)
          if (year < 100) year += 2000
          let hour = parseInt(parts[4], 10)
          const minute = parseInt(parts[5], 10)
          const ampm = parts[6].toUpperCase()
          if (ampm === 'PM' && hour !== 12) hour += 12
          if (ampm === 'AM' && hour === 12) hour = 0
          date = new Date(year, month, day, hour, minute)
        } else {
          date = new Date(timestampStr)
        }
      } catch {
        date = new Date()
      }

      if (Number.isNaN(date.getTime())) date = new Date()

      const timestampIso = date.toISOString()
      const stableId = crypto
        .createHash('sha1')
        .update(`note:${timestampIso}:${noteContent}`)
        .digest('hex')
        .slice(0, 20)

      currentNote = {
        id: `migrated-${stableId}`,
        content: noteContent,
        type: 'note',
        timestamp: timestampIso,
        source: 'notes.txt migration',
      }
    } else if (currentNote) {
      const continuation = trimmed.trim()
      if (continuation) currentNote.content += `\n${continuation}`
    }
  }

  if (currentNote) messages.push(currentNote)
  return messages
}

function dedupeKey(message) {
  const contentPrefix = (message.content || '').trim().substring(0, 200)
  return `${message.type || 'note'}:${contentPrefix}`
}

function mergeMessages(existingMessages, incomingMessages) {
  const messageMap = new Map()

  for (const message of existingMessages) {
    const key = dedupeKey(message)
    if (!messageMap.has(key)) messageMap.set(key, message)
  }

  let added = 0
  for (const message of incomingMessages) {
    const key = dedupeKey(message)
    if (!messageMap.has(key)) {
      messageMap.set(key, message)
      added += 1
    }
  }

  const mergedMessages = [...messageMap.values()].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  )

  return { mergedMessages, added }
}

async function syncNoteIndexIfRequested(conversationData, shouldSync) {
  if (!shouldSync) return

  try {
    require('ts-node/register/transpile-only')
    const { syncConversationNoteIndex } = require('../lib/note-retrieval')
    const result = await syncConversationNoteIndex(conversationData)
    console.log(`🔎 Note index synced: indexed=${result.indexed}, deleted=${result.deleted}`)
  } catch (error) {
    console.warn('⚠️ Note index sync skipped/failed:', error instanceof Error ? error.message : error)
  }
}

async function migrateNotesToFirebase(options = {}) {
  loadEnvLocal()

  const notesFile = options.file || DEFAULT_NOTES_FILE
  const notesFilePath = path.resolve(process.cwd(), notesFile)
  const shouldSyncIndex = Boolean(options.syncIndex)

  if (!fs.existsSync(notesFilePath)) {
    throw new Error(`Notes file not found: ${notesFilePath}`)
  }

  if (!hasFirebaseConfig()) {
    throw new Error(
      'Firebase credentials missing. Set FIREBASE_SERVICE_ACCOUNT_PATH in .env.local or use Vercel-safe Firebase env vars.',
    )
  }

  console.log(`📖 Parsing ${notesFile}...`)
  const parsedNotes = parseNotesExportFile(notesFilePath)
  console.log(`📊 Found ${parsedNotes.length} notes in file`)

  if (!parsedNotes.length) {
    throw new Error('No notes found to migrate.')
  }

  const db = await getFirestoreDb()
  const snapshot = await db.collection(CONVERSATIONS_COLLECTION).doc(CONVERSATIONS_DOC).get()
  const existing = snapshot.exists ? snapshot.data() : { messages: [] }
  const existingMessages = Array.isArray(existing.messages) ? existing.messages : []

  console.log(`🗂️ Existing messages in Firebase: ${existingMessages.length}`)

  const { mergedMessages, added } = mergeMessages(existingMessages, parsedNotes)
  const conversationData = {
    ...existing,
    messages: mergedMessages,
    lastUpdated: new Date().toISOString(),
    totalMessages: mergedMessages.length,
    migratedFrom: notesFile,
    migratedAt: new Date().toISOString(),
  }

  console.log(`➕ Adding ${added} new notes`)
  console.log(`💾 Saving ${mergedMessages.length} total messages to Firebase...`)

  await db.collection(CONVERSATIONS_COLLECTION).doc(CONVERSATIONS_DOC).set(conversationData, { merge: false })

  await syncNoteIndexIfRequested(conversationData, shouldSyncIndex)

  console.log('✅ Migration complete')
  console.log(`   Notes in file: ${parsedNotes.length}`)
  console.log(`   New notes added: ${added}`)
  console.log(`   Total messages saved: ${mergedMessages.length}`)

  return {
    parsed: parsedNotes.length,
    added,
    total: mergedMessages.length,
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const fileArgIndex = args.indexOf('--file')
  const file = fileArgIndex >= 0 ? args[fileArgIndex + 1] : undefined
  const syncIndex = args.includes('--sync-index')

  migrateNotesToFirebase({ file, syncIndex })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Migration failed:', error instanceof Error ? error.message : error)
      process.exit(1)
    })
}

module.exports = { migrateNotesToFirebase, parseNotesExportFile }