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
  getCurrentState,
  getFactIndex,
  getFactLedgerMeta,
  listCurrentStateSample,
  listFactEventsByStateKey,
  upsertCurrentState,
  upsertFactIndex,
  upsertFactLedgerMeta,
  writeFactEvents,
  type FactLedgerMetaRecord,
} from './store'
import type { CurrentStateRecord, FactEvent, FactSyncResult, NoteFactIndexRecord } from './types'
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
  existing: NoteFactIndexRecord | null | undefined,
): boolean {
  if (!existing) return true
  if (existing.contentHash !== note.contentHash) return true
  if (existing.extractorVersion !== FACT_EXTRACTOR_VERSION) return true
  if (existing.status === 'failed' && existing.attempts < MAX_ATTEMPTS) return true
  if (existing.status === 'pending') return true
  return false
}

function polarityRank(polarity: string): number {
  if (polarity === 'measurement' || polarity === 'decision') return 4
  if (polarity === 'constraint' || polarity === 'identity') return 3
  if (polarity === 'estimate') return 2
  if (polarity === 'plan') return 1
  return 0
}

function pickWinningFact(events: FactEvent[]): { current: FactEvent; previous?: FactEvent } | null {
  const eligible = events
    .filter((event) => STATE_ELIGIBLE_POLARITIES.has(event.polarity))
    .sort((left, right) => {
      const timeDiff = new Date(right.asOf).getTime() - new Date(left.asOf).getTime()
      if (timeDiff !== 0) return timeDiff
      const rankDiff = polarityRank(right.polarity) - polarityRank(left.polarity)
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

function eventBeatsState(event: FactEvent, state: CurrentStateRecord): boolean {
  const timeDiff = new Date(event.asOf).getTime() - new Date(state.asOf).getTime()
  if (timeDiff !== 0) return timeDiff > 0
  const rankDiff = polarityRank(event.polarity) - polarityRank(state.polarity)
  if (rankDiff !== 0) return rankDiff > 0
  return event.confidence >= state.confidence
}

function stateFromEvent(
  event: FactEvent,
  previous: CurrentStateRecord | null,
): CurrentStateRecord {
  const sameValue =
    previous &&
    previous.valueText === event.valueText &&
    previous.asOf === event.asOf

  return {
    stateKey: event.stateKey,
    entity: event.entity,
    attribute: event.attribute,
    claim: event.claim,
    valueText: event.valueText,
    valueNum: event.valueNum,
    unit: event.unit,
    polarity: event.polarity,
    asOf: event.asOf,
    confidence: event.confidence,
    sourceNoteId: event.sourceNoteId,
    sourceFactId: event.factId,
    previousValueText: sameValue
      ? previous?.previousValueText ?? null
      : previous && previous.valueText !== event.valueText
        ? previous.valueText
        : previous?.previousValueText ?? null,
    previousClaim: sameValue
      ? previous?.previousClaim ?? null
      : previous && previous.valueText !== event.valueText
        ? previous.claim
        : previous?.previousClaim ?? null,
    previousAsOf: sameValue
      ? previous?.previousAsOf ?? null
      : previous && previous.valueText !== event.valueText
        ? previous.asOf
        : previous?.previousAsOf ?? null,
    previousSourceNoteId: sameValue
      ? previous?.previousSourceNoteId ?? null
      : previous && previous.valueText !== event.valueText
        ? previous.sourceNoteId
        : previous?.previousSourceNoteId ?? null,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Cheap CURRENT STATE update after one note re-extract.
 * Default: 1 point-get per touched key (NOT full fact_events history).
 * History query only if this note owned the key and now has no replacement.
 */
export async function applyCurrentStateAfterNote(
  noteId: string,
  newEvents: FactEvent[],
  deletedKeys: string[],
): Promise<void> {
  const byKey = new Map<string, FactEvent[]>()
  for (const event of newEvents) {
    if (!STATE_ELIGIBLE_POLARITIES.has(event.polarity)) continue
    const list = byKey.get(event.stateKey) ?? []
    list.push(event)
    byKey.set(event.stateKey, list)
  }

  const allKeys = new Set<string>([...deletedKeys, ...byKey.keys()])
  if (!allKeys.size) return

  const emptyKeys: string[] = []

  for (const stateKey of allKeys) {
    const fromNote = byKey.get(stateKey) ?? []
    const bestFromNote = pickWinningFact(fromNote)?.current
    const existing = await getCurrentState(stateKey)

    if (bestFromNote) {
      if (
        !existing ||
        existing.sourceNoteId === noteId ||
        eventBeatsState(bestFromNote, existing)
      ) {
        await upsertCurrentState(stateFromEvent(bestFromNote, existing))
      }
      continue
    }

    // No new eligible facts for this key from this note
    if (existing?.sourceNoteId === noteId) {
      // Rare: we removed the previous winner. Must look for another note's event.
      const history = await listFactEventsByStateKey(stateKey)
      const winner = pickWinningFact(history)
      if (!winner) {
        emptyKeys.push(stateKey)
      } else {
        await upsertCurrentState(
          stateFromEvent(winner.current, {
            ...existing,
            valueText: winner.previous?.valueText ?? existing.valueText,
            claim: winner.previous?.claim ?? existing.claim,
            asOf: winner.previous?.asOf ?? existing.asOf,
            sourceNoteId: winner.previous?.sourceNoteId ?? existing.sourceNoteId,
          }),
        )
      }
    }
    // else another note owns this key — leave it alone (0 extra history reads)
  }

  if (emptyKeys.length) {
    await deleteCurrentStateKeys(emptyKeys)
  }
}

/**
 * @deprecated Prefer applyCurrentStateAfterNote. Full history recompute is expensive.
 * Kept for rare prune paths.
 */
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
  existing: NoteFactIndexRecord | null | undefined,
): Promise<{ factsWritten: number; failed: boolean; skipped: boolean }> {
  const attempts = (existing?.attempts ?? 0) + 1

  try {
    // Drop prior facts from this note so re-extract replaces, not stacks
    // Cost: 1 query + N event docs for THIS note only (not whole ledger)
    const touchedFromDelete = await deleteFactEventsByNoteId(note.noteId)

    const result = await extractFactsFromNote({
      noteId: note.noteId,
      content: note.content,
      contentHash: note.contentHash,
      timestampIso: note.timestampIso,
    })

    let factsWritten = 0
    if (result.events.length) {
      factsWritten = await writeFactEvents(result.events)
    }

    await applyCurrentStateAfterNote(note.noteId, result.events, touchedFromDelete)

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
  /** True when numbers come from the 1-doc meta counter (cheap). */
  statusSource: 'meta' | 'estimated'
}

function emptyMeta(totalNotes: number): FactLedgerMetaRecord {
  const now = new Date().toISOString()
  return {
    extractorVersion: FACT_EXTRACTOR_VERSION,
    totalNotes,
    processedForVersion: 0,
    remainingDirty: totalNotes,
    indexCount: 0,
    currentStateCount: 0,
    byStatus: { done: 0, skipped: 0, failed: 0, pending: totalNotes },
    staleVersion: totalNotes,
    lastSyncAt: now,
    updatedAt: now,
  }
}

function statusFromMeta(
  meta: FactLedgerMetaRecord,
  sample: Awaited<ReturnType<typeof listCurrentStateSample>>,
  enabled: boolean,
): FactLedgerStatus {
  const totalNotes = meta.totalNotes
  const remainingDirty = Math.max(0, meta.remainingDirty)
  const processedCount = Math.max(0, Math.min(totalNotes, totalNotes - remainingDirty))
  const percentComplete =
    totalNotes > 0 ? Math.round((processedCount / totalNotes) * 100) : 0

  return {
    enabled,
    extractorVersion: FACT_EXTRACTOR_VERSION,
    totalNotes,
    indexCount: meta.indexCount,
    processedCount,
    remainingDirty,
    percentComplete,
    byStatus: meta.byStatus,
    staleVersion: meta.staleVersion,
    currentStateCount: meta.currentStateCount,
    statusSource: 'meta',
    sampleState: sample.map((row) => ({
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

/**
 * Ledger status for UI / GET.
 * Cost target: ~1 meta read + up to ~12 sample state reads.
 * NEVER full-scans note_fact_index or fact_events.
 */
export async function getFactLedgerStatus(
  conversations?: ConversationData,
): Promise<FactLedgerStatus> {
  const enabled = isNoteFactsEnabled()
  const [meta, sample, conv] = await Promise.all([
    getFactLedgerMeta(),
    listCurrentStateSample(12),
    conversations ? Promise.resolve(conversations) : loadConversationsLazy(),
  ])

  const totalNotes = collectNoteSources(conv).length

  if (!meta || meta.extractorVersion !== FACT_EXTRACTOR_VERSION) {
    // Version bump or first run: remaining = all notes until catch-up updates meta
    const estimated = emptyMeta(totalNotes)
    estimated.currentStateCount = sample.length
    return statusFromMeta(estimated, sample, enabled)
  }

  const adjusted: FactLedgerMetaRecord = {
    ...meta,
    totalNotes,
    // If note count grew, bump remaining by new notes not yet in processed count
    remainingDirty: Math.max(
      0,
      meta.remainingDirty + Math.max(0, totalNotes - meta.totalNotes),
    ),
  }

  return statusFromMeta(adjusted, sample, enabled)
}

async function loadConversationsLazy(): Promise<ConversationData> {
  const { loadConversations } = await import('../storage')
  return loadConversations()
}

/**
 * Sync fact index for conversation notes.
 *
 * Cost design (hot path):
 * - NO full collection scan of note_fact_index
 * - Walk notes newest-first; point-get index only until maxNotes dirty processed
 * - CURRENT STATE: point-get per key, not full event history
 * - Status counters: 1 meta doc write at end
 * - Deleted-note prune is OFF by default (was O(full index))
 */
export async function syncConversationNoteFacts(
  conversations: ConversationData,
  options?: {
    /** Max dirty notes to process this call (default 3 on save, higher for backfill) */
    maxNotes?: number
    /** Only process these note ids if provided */
    onlyNoteIds?: string[]
    /**
     * Dangerous/expensive: scan whole index for deleted notes.
     * Default false — never do this on batch/catch-up.
     */
    pruneDeleted?: boolean
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
  const totalNotes = notes.length
  const allow = options?.onlyNoteIds?.length
    ? new Set(options.onlyNoteIds)
    : null

  // Newest first — process current decisions first
  const ordered = [...notes].sort(
    (left, right) =>
      new Date(right.timestampIso).getTime() - new Date(left.timestampIso).getTime(),
  )

  const deletedNotes = 0
  // pruneDeleted intentionally ignored on hot path (would full-scan index).
  void options?.pruneDeleted

  let meta = await getFactLedgerMeta()
  if (!meta || meta.extractorVersion !== FACT_EXTRACTOR_VERSION) {
    meta = emptyMeta(totalNotes)
  } else {
    meta = {
      ...meta,
      totalNotes,
      remainingDirty: Math.max(
        0,
        meta.remainingDirty + Math.max(0, totalNotes - meta.totalNotes),
      ),
    }
  }

  let processed = 0
  let failed = 0
  let skipped = 0
  let factsWritten = 0
  let dirtySeen = 0
  let indexPointGets = 0
  let scanned = 0
  let stoppedEarlyWithMore = false

  for (const note of ordered) {
    if (allow && !allow.has(note.noteId)) continue

    // Enough dirty notes processed for this call
    if (processed >= maxNotes) {
      // Peek whether more dirty likely exists without finishing full walk:
      // if we still have unscanned notes, assume remaining work may exist.
      stoppedEarlyWithMore = scanned < ordered.length
      break
    }

    const existing = await getFactIndex(note.noteId)
    indexPointGets += 1
    scanned += 1

    if (!isDirty(note, existing)) {
      continue
    }

    dirtySeen += 1
    const result = await processOneNote(note, existing)
    processed += 1
    factsWritten += result.factsWritten
    if (result.failed) failed += 1
    if (result.skipped) skipped += 1

    // Update counters as we go (meta written once at end)
    if (!result.failed) {
      meta.processedForVersion = Math.min(totalNotes, meta.processedForVersion + 1)
      if (result.skipped) {
        meta.byStatus.skipped += 1
      } else {
        meta.byStatus.done += 1
      }
    } else {
      meta.byStatus.failed += 1
    }
  }

  // remainingDirty estimate without full corpus dirty-scan:
  // - If we finished walking all notes without filling maxNotes → remaining 0
  // - If we stopped at maxNotes → at least 0 more; keep prior estimate minus processed, floor 0
  let remainingDirty: number
  if (processed < maxNotes && !stoppedEarlyWithMore) {
    remainingDirty = 0
  } else if (stoppedEarlyWithMore) {
    remainingDirty = Math.max(0, meta.remainingDirty - processed)
    // If meta was freshly reset (all dirty), after first batch remaining ≈ total - processed
    if (meta.processedForVersion <= processed) {
      remainingDirty = Math.max(0, totalNotes - meta.processedForVersion)
    }
  } else {
    remainingDirty = Math.max(0, meta.remainingDirty - processed)
  }

  // If we never found a dirty note and scanned everything, remaining is 0
  if (processed === 0 && scanned >= ordered.length) {
    remainingDirty = 0
    meta.processedForVersion = totalNotes
  }

  const now = new Date().toISOString()
  meta = {
    ...meta,
    extractorVersion: FACT_EXTRACTOR_VERSION,
    totalNotes,
    remainingDirty,
    staleVersion: remainingDirty,
    indexCount: Math.max(meta.indexCount, meta.processedForVersion),
    lastSyncAt: now,
    updatedAt: now,
  }

  await upsertFactLedgerMeta(meta)

  console.log(
    `[facts] sync: processed=${processed} failed=${failed} skipped=${skipped} facts=${factsWritten} remaining≈${remainingDirty} indexGets=${indexPointGets} deletedNotes=${deletedNotes} (of ${totalNotes} notes)`,
  )

  return {
    deletedNotes,
    processed,
    failed,
    skipped,
    factsWritten,
    remainingDirty,
    dirtyTotal: dirtySeen + remainingDirty,
  }
}
