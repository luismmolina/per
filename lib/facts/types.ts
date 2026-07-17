/** Extractor version — bump to reprocess all notes with a new prompt/schema. */
export const FACT_EXTRACTOR_VERSION = 'facts-v3'

export type FactPolarity =
  | 'measurement'
  | 'decision'
  | 'estimate'
  | 'plan'
  | 'hypothesis'
  | 'constraint'
  | 'identity'

export type FactIndexStatus = 'pending' | 'done' | 'failed' | 'skipped'

export interface NoteFactIndexRecord {
  noteId: string
  contentHash: string
  status: FactIndexStatus
  extractorVersion: string
  processedAt: string
  factCount: number
  attempts: number
  error?: string
  contentLength: number
  timestampIso: string
}

export interface FactEvent {
  factId: string
  sourceNoteId: string
  sourceContentHash: string
  entity: string
  attribute: string
  /** Stable key: normalized entity|attribute */
  stateKey: string
  /** Standalone one-sentence claim — must be understandable without the note */
  claim: string
  valueText: string
  valueNum: number | null
  unit: string | null
  polarity: FactPolarity
  asOf: string
  confidence: number
  rawSpan: string | null
  extractorVersion: string
  createdAt: string
}

export interface CurrentStateRecord {
  stateKey: string
  entity: string
  attribute: string
  claim: string
  valueText: string
  valueNum: number | null
  unit: string | null
  polarity: FactPolarity
  asOf: string
  confidence: number
  sourceNoteId: string
  sourceFactId: string
  previousValueText?: string | null
  previousClaim?: string | null
  previousAsOf?: string | null
  previousSourceNoteId?: string | null
  updatedAt: string
}

export interface ExtractedFactDraft {
  entity: string
  attribute: string
  /** One full sentence: who/what, what changed, the number, and enough context to stand alone */
  claim: string
  valueText: string
  valueNum?: number | null
  unit?: string | null
  polarity: FactPolarity
  /** ISO date or datetime; if omitted, note timestamp is used */
  asOf?: string | null
  confidence?: number
  rawSpan?: string | null
}

export interface FactSyncResult {
  deletedNotes: number
  processed: number
  failed: number
  skipped: number
  factsWritten: number
  remainingDirty: number
  dirtyTotal: number
}

/**
 * Polarities that may set current_state.
 * Plans are eligible at lowest rank so active menu/ops plans still compress into
 * memory when no stronger measurement/decision exists for that key.
 * Hypotheses never write current_state.
 */
export const STATE_ELIGIBLE_POLARITIES: ReadonlySet<FactPolarity> = new Set([
  'measurement',
  'decision',
  'estimate',
  'plan',
  'constraint',
  'identity',
])
