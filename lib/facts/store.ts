import type { DocumentData } from 'firebase-admin/firestore'

import { estimateJsonBytes, logDbTransfer } from '../db-diagnostics'
import { getFirestoreDb } from '../firebase'
import type {
  CurrentStateRecord,
  FactEvent,
  FactIndexStatus,
  FactPolarity,
  NoteFactIndexRecord,
} from './types'

const NOTE_FACT_INDEX = 'note_fact_index'
const FACT_EVENTS = 'fact_events'
const CURRENT_STATE = 'current_state'
const FACT_LEDGER_META = 'fact_ledger_meta'
const LEDGER_META_DOC_ID = 'default'

export interface FactLedgerMetaRecord {
  extractorVersion: string
  totalNotes: number
  processedForVersion: number
  remainingDirty: number
  indexCount: number
  currentStateCount: number
  byStatus: {
    done: number
    skipped: number
    failed: number
    pending: number
  }
  staleVersion: number
  lastSyncAt: string
  updatedAt: string
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asPolarity(value: unknown): FactPolarity {
  const allowed: FactPolarity[] = [
    'measurement',
    'decision',
    'estimate',
    'plan',
    'hypothesis',
    'constraint',
    'identity',
  ]
  return allowed.includes(value as FactPolarity) ? (value as FactPolarity) : 'estimate'
}

function asStatus(value: unknown): FactIndexStatus {
  const allowed: FactIndexStatus[] = ['pending', 'done', 'failed', 'skipped']
  return allowed.includes(value as FactIndexStatus) ? (value as FactIndexStatus) : 'pending'
}

function mapIndexDoc(noteId: string, data: DocumentData): NoteFactIndexRecord {
  return {
    noteId,
    contentHash: asString(data.content_hash),
    status: asStatus(data.status),
    extractorVersion: asString(data.extractor_version),
    processedAt: asString(data.processed_at, new Date(0).toISOString()),
    factCount: typeof data.fact_count === 'number' ? data.fact_count : 0,
    attempts: typeof data.attempts === 'number' ? data.attempts : 0,
    error: typeof data.error === 'string' ? data.error : undefined,
    contentLength: typeof data.content_length === 'number' ? data.content_length : 0,
    timestampIso: asString(data.note_timestamp, new Date(0).toISOString()),
  }
}

function mapFactEvent(factId: string, data: DocumentData): FactEvent {
  const entity = asString(data.entity)
  const attribute = asString(data.attribute)
  const valueText = asString(data.value_text)
  const unit = typeof data.unit === 'string' ? data.unit : null
  const claimFromDb = asString(data.claim)
  // Back-compat for facts-v1 rows without claim
  const claim =
    claimFromDb ||
    [entity, attribute, valueText, unit].filter(Boolean).join(' · ')

  return {
    factId,
    sourceNoteId: asString(data.source_note_id),
    sourceContentHash: asString(data.source_content_hash),
    entity,
    attribute,
    stateKey: asString(data.state_key),
    claim,
    valueText,
    valueNum: asNumberOrNull(data.value_num),
    unit,
    polarity: asPolarity(data.polarity),
    asOf: asString(data.as_of, new Date(0).toISOString()),
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    rawSpan: typeof data.raw_span === 'string' ? data.raw_span : null,
    extractorVersion: asString(data.extractor_version),
    createdAt: asString(data.created_at, new Date(0).toISOString()),
  }
}

function mapCurrentState(stateKey: string, data: DocumentData): CurrentStateRecord {
  const entity = asString(data.entity)
  const attribute = asString(data.attribute)
  const valueText = asString(data.value_text)
  const unit = typeof data.unit === 'string' ? data.unit : null
  const claimFromDb = asString(data.claim)
  const claim =
    claimFromDb ||
    [entity, attribute, valueText, unit].filter(Boolean).join(' · ')

  return {
    stateKey,
    entity,
    attribute,
    claim,
    valueText,
    valueNum: asNumberOrNull(data.value_num),
    unit,
    polarity: asPolarity(data.polarity),
    asOf: asString(data.as_of, new Date(0).toISOString()),
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    sourceNoteId: asString(data.source_note_id),
    sourceFactId: asString(data.source_fact_id),
    previousValueText: typeof data.previous_value_text === 'string' ? data.previous_value_text : null,
    previousClaim: typeof data.previous_claim === 'string' ? data.previous_claim : null,
    previousAsOf: typeof data.previous_as_of === 'string' ? data.previous_as_of : null,
    previousSourceNoteId:
      typeof data.previous_source_note_id === 'string' ? data.previous_source_note_id : null,
    updatedAt: asString(data.updated_at, new Date(0).toISOString()),
  }
}

/**
 * Full index scan — AVOID on batch/save hot paths. Prefer getFactIndex(noteId).
 * Kept for rare admin/export tooling only.
 */
export async function listFactIndexRecords(): Promise<NoteFactIndexRecord[]> {
  const db = getFirestoreDb()
  const snapshot = await db.collection(NOTE_FACT_INDEX).get()
  logDbTransfer('listFactIndexRecords', {
    indexRowsLoaded: snapshot.size,
  })
  return snapshot.docs.map((doc) => mapIndexDoc(doc.id, doc.data()))
}

/** Single index doc — 1 read. Use this on sync hot path. */
export async function getFactIndex(noteId: string): Promise<NoteFactIndexRecord | null> {
  const db = getFirestoreDb()
  const snap = await db.collection(NOTE_FACT_INDEX).doc(noteId).get()
  if (!snap.exists) return null
  return mapIndexDoc(snap.id, snap.data() ?? {})
}

/**
 * @deprecated Full collection scan. Do not use in sync/batch — use getFactIndex.
 */
export async function getFactIndexMap(): Promise<Map<string, NoteFactIndexRecord>> {
  const records = await listFactIndexRecords()
  return new Map(records.map((record) => [record.noteId, record]))
}

export async function getFactLedgerMeta(): Promise<FactLedgerMetaRecord | null> {
  const db = getFirestoreDb()
  const snap = await db.collection(FACT_LEDGER_META).doc(LEDGER_META_DOC_ID).get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  const by = (data.by_status && typeof data.by_status === 'object')
    ? data.by_status as Record<string, unknown>
    : {}
  return {
    extractorVersion: asString(data.extractor_version),
    totalNotes: typeof data.total_notes === 'number' ? data.total_notes : 0,
    processedForVersion:
      typeof data.processed_for_version === 'number' ? data.processed_for_version : 0,
    remainingDirty: typeof data.remaining_dirty === 'number' ? data.remaining_dirty : 0,
    indexCount: typeof data.index_count === 'number' ? data.index_count : 0,
    currentStateCount:
      typeof data.current_state_count === 'number' ? data.current_state_count : 0,
    byStatus: {
      done: typeof by.done === 'number' ? by.done : 0,
      skipped: typeof by.skipped === 'number' ? by.skipped : 0,
      failed: typeof by.failed === 'number' ? by.failed : 0,
      pending: typeof by.pending === 'number' ? by.pending : 0,
    },
    staleVersion: typeof data.stale_version === 'number' ? data.stale_version : 0,
    lastSyncAt: asString(data.last_sync_at, new Date(0).toISOString()),
    updatedAt: asString(data.updated_at, new Date(0).toISOString()),
  }
}

export async function upsertFactLedgerMeta(meta: FactLedgerMetaRecord): Promise<void> {
  const db = getFirestoreDb()
  await db.collection(FACT_LEDGER_META).doc(LEDGER_META_DOC_ID).set({
    extractor_version: meta.extractorVersion,
    total_notes: meta.totalNotes,
    processed_for_version: meta.processedForVersion,
    remaining_dirty: meta.remainingDirty,
    index_count: meta.indexCount,
    current_state_count: meta.currentStateCount,
    by_status: meta.byStatus,
    stale_version: meta.staleVersion,
    last_sync_at: meta.lastSyncAt,
    updated_at: meta.updatedAt,
  })
}

export async function upsertFactIndex(record: NoteFactIndexRecord): Promise<void> {
  const db = getFirestoreDb()
  await db.collection(NOTE_FACT_INDEX).doc(record.noteId).set(
    {
      content_hash: record.contentHash,
      status: record.status,
      extractor_version: record.extractorVersion,
      processed_at: record.processedAt,
      fact_count: record.factCount,
      attempts: record.attempts,
      error: record.error ?? null,
      content_length: record.contentLength,
      note_timestamp: record.timestampIso,
    },
    { merge: true },
  )
}

export async function deleteFactIndex(noteIds: string[]): Promise<number> {
  if (!noteIds.length) return 0
  const db = getFirestoreDb()
  let deleted = 0
  const batchSize = 400

  for (let index = 0; index < noteIds.length; index += batchSize) {
    const batch = db.batch()
    const chunk = noteIds.slice(index, index + batchSize)
    for (const noteId of chunk) {
      batch.delete(db.collection(NOTE_FACT_INDEX).doc(noteId))
    }
    await batch.commit()
    deleted += chunk.length
  }

  return deleted
}

export async function listFactEventsByNoteId(noteId: string): Promise<FactEvent[]> {
  const db = getFirestoreDb()
  const snapshot = await db.collection(FACT_EVENTS).where('source_note_id', '==', noteId).get()
  return snapshot.docs.map((doc) => mapFactEvent(doc.id, doc.data()))
}

export async function listFactEventsByStateKey(stateKey: string): Promise<FactEvent[]> {
  const db = getFirestoreDb()
  const snapshot = await db.collection(FACT_EVENTS).where('state_key', '==', stateKey).get()
  return snapshot.docs.map((doc) => mapFactEvent(doc.id, doc.data()))
}

export async function listAllFactEvents(): Promise<FactEvent[]> {
  const db = getFirestoreDb()
  const snapshot = await db.collection(FACT_EVENTS).get()
  const events = snapshot.docs.map((doc) => mapFactEvent(doc.id, doc.data()))
  logDbTransfer('listAllFactEvents', {
    factRowsLoaded: events.length,
    factBytesLoaded: estimateJsonBytes(events),
  })
  return events
}

export async function deleteFactEventsByNoteId(noteId: string): Promise<string[]> {
  const existing = await listFactEventsByNoteId(noteId)
  if (!existing.length) return []

  const db = getFirestoreDb()
  const batchSize = 400
  const stateKeys = [...new Set(existing.map((event) => event.stateKey))]

  for (let index = 0; index < existing.length; index += batchSize) {
    const batch = db.batch()
    const chunk = existing.slice(index, index + batchSize)
    for (const event of chunk) {
      batch.delete(db.collection(FACT_EVENTS).doc(event.factId))
    }
    await batch.commit()
  }

  return stateKeys
}

export async function writeFactEvents(events: FactEvent[]): Promise<number> {
  if (!events.length) return 0

  const db = getFirestoreDb()
  const batchSize = 200
  let written = 0

  for (let index = 0; index < events.length; index += batchSize) {
    const batch = db.batch()
    const chunk = events.slice(index, index + batchSize)

    for (const event of chunk) {
      batch.set(db.collection(FACT_EVENTS).doc(event.factId), {
        source_note_id: event.sourceNoteId,
        source_content_hash: event.sourceContentHash,
        entity: event.entity,
        attribute: event.attribute,
        state_key: event.stateKey,
        claim: event.claim,
        value_text: event.valueText,
        value_num: event.valueNum,
        unit: event.unit,
        polarity: event.polarity,
        as_of: event.asOf,
        confidence: event.confidence,
        raw_span: event.rawSpan,
        extractor_version: event.extractorVersion,
        created_at: event.createdAt,
      })
    }

    await batch.commit()
    written += chunk.length
  }

  return written
}

/** Point-get one CURRENT STATE row — 1 read. Prefer this on recompute. */
export async function getCurrentState(stateKey: string): Promise<CurrentStateRecord | null> {
  const db = getFirestoreDb()
  const snap = await db.collection(CURRENT_STATE).doc(encodeStateKeyDocId(stateKey)).get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  const key =
    typeof data.state_key === 'string' && data.state_key ? data.state_key : stateKey
  return mapCurrentState(key, data)
}

/**
 * Sample of CURRENT STATE for UI — limited reads, not full collection.
 */
export async function listCurrentStateSample(limit = 40): Promise<CurrentStateRecord[]> {
  const db = getFirestoreDb()
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))
  const snapshot = await db.collection(CURRENT_STATE).limit(safeLimit).get()
  const rows = snapshot.docs.map((doc) => {
    const data = doc.data()
    const stateKey =
      typeof data.state_key === 'string' && data.state_key ? data.state_key : doc.id
    return mapCurrentState(stateKey, data)
  })
  logDbTransfer('listCurrentStateSample', {
    stateRowsLoaded: rows.length,
    stateBytesLoaded: estimateJsonBytes(rows),
  })
  return rows
}

/**
 * Full CURRENT STATE scan. Prefer listCurrentStateSample for UI.
 * Still used for AI prompt formatting and full export.
 */
export async function listCurrentState(): Promise<CurrentStateRecord[]> {
  const db = getFirestoreDb()
  const snapshot = await db.collection(CURRENT_STATE).get()
  const rows = snapshot.docs.map((doc) => {
    const data = doc.data()
    const stateKey = typeof data.state_key === 'string' && data.state_key
      ? data.state_key
      : doc.id
    return mapCurrentState(stateKey, data)
  })
  logDbTransfer('listCurrentState', {
    stateRowsLoaded: rows.length,
    stateBytesLoaded: estimateJsonBytes(rows),
  })
  return rows.sort((left, right) => left.stateKey.localeCompare(right.stateKey))
}

export async function upsertCurrentState(record: CurrentStateRecord): Promise<void> {
  const db = getFirestoreDb()
  // Firestore doc ids cannot contain `/` — stateKey may; sanitize for doc id.
  const docId = encodeStateKeyDocId(record.stateKey)
  await db.collection(CURRENT_STATE).doc(docId).set({
    state_key: record.stateKey,
    entity: record.entity,
    attribute: record.attribute,
    claim: record.claim,
    value_text: record.valueText,
    value_num: record.valueNum,
    unit: record.unit,
    polarity: record.polarity,
    as_of: record.asOf,
    confidence: record.confidence,
    source_note_id: record.sourceNoteId,
    source_fact_id: record.sourceFactId,
    previous_value_text: record.previousValueText ?? null,
    previous_claim: record.previousClaim ?? null,
    previous_as_of: record.previousAsOf ?? null,
    previous_source_note_id: record.previousSourceNoteId ?? null,
    updated_at: record.updatedAt,
  })
}

export async function deleteCurrentStateKeys(stateKeys: string[]): Promise<void> {
  if (!stateKeys.length) return
  const db = getFirestoreDb()
  const batchSize = 400

  for (let index = 0; index < stateKeys.length; index += batchSize) {
    const batch = db.batch()
    const chunk = stateKeys.slice(index, index + batchSize)
    for (const stateKey of chunk) {
      batch.delete(db.collection(CURRENT_STATE).doc(encodeStateKeyDocId(stateKey)))
    }
    await batch.commit()
  }
}

/** Encode stateKey for use as a Firestore document id. */
export function encodeStateKeyDocId(stateKey: string): string {
  return Buffer.from(stateKey, 'utf8').toString('base64url')
}
