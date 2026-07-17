import { createHash } from 'node:crypto'

import {
  getMessageTimestampIso,
  getNoteMessages,
  normalizeConversationData,
  type ConversationData,
  type StoredMessage,
} from '../storage'
import { extractFactsFromNote } from './extract'
import {
  deleteCurrentStateKeys,
  deleteFactEventsByNoteId,
  deleteFactIndex,
  getFactIndexMap,
  listCurrentState,
  listFactEventsByStateKey,
  listFactIndexRecords,
  upsertCurrentState,
  upsertFactIndex,
  writeFactEvents,
} from './store'
import type { FactEvent, FactSyncResult, NoteFactIndexRecord } from './types'
import { FACT_EXTRACTOR_VERSION, STATE_ELIGIBLE_POLARITIES } from './types'

const MAX_ATTEMPTS = 4

export function isNoteFactsEnabled(): boolean {
  if (process.env.ENABLE_NOTE_FACTS === 'false') return false
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENCODE_API_KEY)
}

function hashContent(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

interface NoteSource {
  noteId: string
  content: string
  contentHash: string
  timestampIso: string
}

function buildNoteSource(message: StoredMessage): NoteSource | null {
  if (typeof message.content !== 'string') return null
  const content = message.content.trim()
  if (!content) return null

  const timestampIso = getMessageTimestampIso(message)
  const stableId =
    typeof message.id === 'string' && message.id.trim().length > 0
      ? message.id
      : hashContent(`${timestampIso}:${content}`)

  return {
    noteId: stableId,
    content,
    contentHash: hashContent(content),
    timestampIso,
  }
}

function collectNoteSources(conversations: ConversationData): NoteSource[] {
  return getNoteMessages(normalizeConversationData(conversations))
    .map(buildNoteSource)
    .filter((note): note is NoteSource => Boolean(note))
}

function isDirty(
  note: NoteSource,
  existing: NoteFactIndexRecord | undefined,
): boolean {
  if (!existing) return true
  if (existing.contentHash !== note.contentHash) return true
  if (existing.extractorVersion !== FACT_EXTRACTOR_VERSION) return true
  if (existing.status === 'failed' && existing.attempts < MAX_ATTEMPTS) return true
  if (existing.status === 'pending') return true
  return false
}

function pickWinningFact(events: FactEvent[]): { current: FactEvent; previous?: FactEvent } | null {
  const eligible = events
    .filter((event) => STATE_ELIGIBLE_POLARITIES.has(event.polarity))
    .sort((left, right) => {
      const timeDiff = new Date(right.asOf).getTime() - new Date(left.asOf).getTime()
      if (timeDiff !== 0) return timeDiff

      // Prefer measurement/decision over estimate when same day
      const rank = (polarity: string) => {
        if (polarity === 'measurement' || polarity === 'decision') return 2
        if (polarity === 'constraint' || polarity === 'identity') return 1
        return 0
      }
      const rankDiff = rank(right.polarity) - rank(left.polarity)
      if (rankDiff !== 0) return rankDiff

      return right.confidence - left.confidence
    })

  if (!eligible.length) return null

  const current = eligible[0]
  const previous = eligible.find(
    (event) =>
      event.factId !== current.factId &&
      (event.valueText !== current.valueText || event.asOf !== current.asOf),
  )

  return { current, previous }
}

export async function recomputeCurrentStateForKeys(stateKeys: string[]): Promise<void> {
  const uniqueKeys = [...new Set(stateKeys.filter(Boolean))]
  if (!uniqueKeys.length) return

  const emptyKeys: string[] = []

  for (const stateKey of uniqueKeys) {
    const events = await listFactEventsByStateKey(stateKey)
    const winner = pickWinningFact(events)

    if (!winner) {
      emptyKeys.push(stateKey)
      continue
    }

    const { current, previous } = winner
    await upsertCurrentState({
      stateKey: current.stateKey,
      entity: current.entity,
      attribute: current.attribute,
      claim: current.claim,
      valueText: current.valueText,
      valueNum: current.valueNum,
      unit: current.unit,
      polarity: current.polarity,
      asOf: current.asOf,
      confidence: current.confidence,
      sourceNoteId: current.sourceNoteId,
      sourceFactId: current.factId,
      previousValueText: previous?.valueText ?? null,
      previousClaim: previous?.claim ?? null,
      previousAsOf: previous?.asOf ?? null,
      previousSourceNoteId: previous?.sourceNoteId ?? null,
      updatedAt: new Date().toISOString(),
    })
  }

  if (emptyKeys.length) {
    await deleteCurrentStateKeys(emptyKeys)
  }
}

async function processOneNote(
  note: NoteSource,
  existing: NoteFactIndexRecord | undefined,
): Promise<{ factsWritten: number; failed: boolean; skipped: boolean }> {
  const attempts = (existing?.attempts ?? 0) + 1

  try {
    // Drop prior facts from this note so re-extract replaces, not stacks
    const touchedFromDelete = await deleteFactEventsByNoteId(note.noteId)

    const result = await extractFactsFromNote({
      noteId: note.noteId,
      content: note.content,
      contentHash: note.contentHash,
      timestampIso: note.timestampIso,
    })

    let factsWritten = 0
    const touchedKeys = new Set(touchedFromDelete)

    if (result.events.length) {
      factsWritten = await writeFactEvents(result.events)
      for (const event of result.events) {
        touchedKeys.add(event.stateKey)
      }
    }

    await recomputeCurrentStateForKeys([...touchedKeys])

    await upsertFactIndex({
      noteId: note.noteId,
      contentHash: note.contentHash,
      status: result.skipped && !result.events.length ? 'skipped' : 'done',
      extractorVersion: FACT_EXTRACTOR_VERSION,
      processedAt: new Date().toISOString(),
      factCount: factsWritten,
      attempts,
      error: result.skipReason,
      contentLength: note.content.length,
      timestampIso: note.timestampIso,
    })

    return {
      factsWritten,
      failed: false,
      skipped: Boolean(result.skipped && !result.events.length),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[facts] extract failed for ${note.noteId}:`, message)

    await upsertFactIndex({
      noteId: note.noteId,
      contentHash: note.contentHash,
      status: 'failed',
      extractorVersion: FACT_EXTRACTOR_VERSION,
      processedAt: new Date().toISOString(),
      factCount: existing?.factCount ?? 0,
      attempts,
      error: message.slice(0, 500),
      contentLength: note.content.length,
      timestampIso: note.timestampIso,
    })

    return { factsWritten: 0, failed: true, skipped: false }
  }
}

export interface FactLedgerStatus {
  enabled: boolean
  extractorVersion: string
  totalNotes: number
  indexCount: number
  processedCount: number
  remainingDirty: number
  percentComplete: number
  byStatus: {
    done: number
    skipped: number
    failed: number
    pending: number
  }
  staleVersion: number
  currentStateCount: number
  sampleState: Array<{
    entity: string
    attribute: string
    claim: string
    value: string
    unit: string | null
    polarity: string
    asOf: string
    previous: { value: string; claim: string | null; asOf: string | null } | null
  }>
}

/** Full ledger status for UI / GET /api/facts/sync */
export async function getFactLedgerStatus(
  conversations?: ConversationData,
): Promise<FactLedgerStatus> {
  const enabled = isNoteFactsEnabled()
  const [index, state, conv] = await Promise.all([
    listFactIndexRecords(),
    listCurrentState(),
    conversations ? Promise.resolve(conversations) : loadConversationsLazy(),
  ])

  const notes = collectNoteSources(conv)
  const existingById = new Map(index.map((row) => [row.noteId, row]))
  const dirty = notes.filter((note) => isDirty(note, existingById.get(note.noteId)))

  const byStatus = {
    done: 0,
    skipped: 0,
    failed: 0,
    pending: 0,
  }
  for (const row of index) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
  }

  const processedCount = byStatus.done + byStatus.skipped
  const totalNotes = notes.length
  const remainingDirty = dirty.length
  const percentComplete =
    totalNotes > 0 ? Math.round((Math.min(processedCount, totalNotes) / totalNotes) * 100) : 0

  const staleVersion = index.filter(
    (row) => row.extractorVersion !== FACT_EXTRACTOR_VERSION,
  ).length

  return {
    enabled,
    extractorVersion: FACT_EXTRACTOR_VERSION,
    totalNotes,
    indexCount: index.length,
    processedCount,
    remainingDirty,
    percentComplete,
    byStatus,
    staleVersion,
    currentStateCount: state.length,
    sampleState: state.slice(0, 40).map((row) => ({
      entity: row.entity,
      attribute: row.attribute,
      claim: row.claim,
      value: row.valueText,
      unit: row.unit,
      polarity: row.polarity,
      asOf: row.asOf,
      previous: row.previousValueText
        ? {
            value: row.previousValueText,
            claim: row.previousClaim ?? null,
            asOf: row.previousAsOf ?? null,
          }
        : null,
    })),
  }
}

async function loadConversationsLazy(): Promise<ConversationData> {
  const { loadConversations } = await import('../storage')
  return loadConversations()
}

/**
 * Sync fact index for conversation notes.
 * - Deletes facts for removed notes
 * - Processes dirty notes (hash / version / failed)
 * - Newest dirty notes first
 */
export async function syncConversationNoteFacts(
  conversations: ConversationData,
  options?: {
    /** Max dirty notes to process this call (default 3 on save, higher for backfill) */
    maxNotes?: number
    /** Only process these note ids if provided */
    onlyNoteIds?: string[]
  },
): Promise<FactSyncResult> {
  if (!isNoteFactsEnabled()) {
    return {
      deletedNotes: 0,
      processed: 0,
      failed: 0,
      skipped: 0,
      factsWritten: 0,
      remainingDirty: 0,
      dirtyTotal: 0,
    }
  }

  const maxNotes = options?.maxNotes ?? 3
  const notes = collectNoteSources(conversations)
  const noteById = new Map(notes.map((note) => [note.noteId, note]))
  const existingById = await getFactIndexMap()

  // Remove index + facts for deleted notes
  const liveIds = new Set(notes.map((note) => note.noteId))
  const deletedIds = [...existingById.keys()].filter((noteId) => !liveIds.has(noteId))

  let deletedNotes = 0
  if (deletedIds.length) {
    const touched: string[] = []
    for (const noteId of deletedIds) {
      const keys = await deleteFactEventsByNoteId(noteId)
      touched.push(...keys)
    }
    await deleteFactIndex(deletedIds)
    await recomputeCurrentStateForKeys(touched)
    deletedNotes = deletedIds.length
  }

  let dirty = notes.filter((note) => isDirty(note, existingById.get(note.noteId)))

  if (options?.onlyNoteIds?.length) {
    const allow = new Set(options.onlyNoteIds)
    dirty = dirty.filter((note) => allow.has(note.noteId))
  }

  // Newest first so current_state stabilizes early during backfill
  dirty.sort(
    (left, right) =>
      new Date(right.timestampIso).getTime() - new Date(left.timestampIso).getTime(),
  )

  const dirtyTotal = dirty.length
  const batch = dirty.slice(0, Math.max(0, maxNotes))

  let processed = 0
  let failed = 0
  let skipped = 0
  let factsWritten = 0

  for (const note of batch) {
    // Re-read map entry (may be stale after prior iterations — fine)
    const result = await processOneNote(note, existingById.get(note.noteId))
    processed += 1
    factsWritten += result.factsWritten
    if (result.failed) failed += 1
    if (result.skipped) skipped += 1
  }

  const remainingDirty = Math.max(0, dirtyTotal - batch.length)

  console.log(
    `[facts] sync: processed=${processed} failed=${failed} skipped=${skipped} facts=${factsWritten} remaining=${remainingDirty} deletedNotes=${deletedNotes} (of ${noteById.size} notes)`,
  )

  return {
    deletedNotes,
    processed,
    failed,
    skipped,
    factsWritten,
    remainingDirty,
    dirtyTotal,
  }
}
