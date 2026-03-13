import { createHash } from 'node:crypto'

import { embedTexts, isGeminiRetrievalEnabled } from './embeddings'
import { rerankNotesWithCheapModel, type NoteRetrievalProfile } from './note-rerank'
import { getSql } from './postgres'
import {
  getMessageTimestampIso,
  getNoteMessages,
  loadConversations,
  normalizeConversationData,
  type ConversationData,
  type StoredMessage,
} from './storage'

type TimestampStyle = 'date' | 'datetime'

interface NoteIndexSource {
  noteId: string
  content: string
  contentHash: string
  timestampIso: string
}

interface IndexedNoteRecord extends NoteIndexSource {
  embedding: number[]
}

interface RetrievalCandidate extends IndexedNoteRecord {
  similarityScore: number
  recencyScore: number
  keywordScore: number
  combinedScore: number
}

interface RetrievalProfileConfig {
  candidateLimit: number
  selectionLimit: number
  maxPromptChars: number
  guaranteedRecentCount: number
  recentWindowDays?: number
  recencyHalfLifeDays: number
  timestampStyle: TimestampStyle
  forceRecentCoverage?: boolean
  weights: {
    similarity: number
    recency: number
    keyword: number
  }
  buildQueries: (input: NoteContextRequest) => string[]
}

interface NoteIndexRow {
  note_id: string
  content: string
  content_hash: string
  note_timestamp: string | Date
  embedding: unknown
}

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'because',
  'been',
  'being',
  'from',
  'have',
  'into',
  'just',
  'more',
  'most',
  'much',
  'only',
  'over',
  'same',
  'than',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'today',
  'very',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
  'your',
])

const RETRIEVAL_PROFILES: Record<NoteRetrievalProfile, RetrievalProfileConfig> = {
  chat: {
    candidateLimit: 18,
    selectionLimit: 8,
    maxPromptChars: 7000,
    guaranteedRecentCount: 2,
    recentWindowDays: 14,
    recencyHalfLifeDays: 21,
    timestampStyle: 'date',
    weights: { similarity: 0.76, recency: 0.14, keyword: 0.10 },
    buildQueries: (input) => {
      const queries = [input.userQuery?.trim() ?? '']
      const historySummary = summarizeConversationHistory(input.conversationHistory)
      if (historySummary) {
        queries.push(`${input.userQuery?.trim() || 'Current question'}\n\nRecent conversation:\n${historySummary}`)
      }

      return queries.filter(Boolean)
    },
  },
  longform: {
    candidateLimit: 80,
    selectionLimit: 60,
    maxPromptChars: 80000,
    guaranteedRecentCount: 8,
    recentWindowDays: 90,
    recencyHalfLifeDays: 60,
    timestampStyle: 'datetime',
    weights: { similarity: 0.68, recency: 0.12, keyword: 0.20 },
    buildQueries: () => [
      'Recurring patterns, lessons, contradictions, and self-knowledge in the notes.',
      'Wins, failures, turning points, repeated mistakes, and proof-backed insights in the notes.',
      'Recent changes, constraints, emotional themes, and things the user keeps forgetting.',
    ],
  },
  consulting: {
    candidateLimit: 24,
    selectionLimit: 12,
    maxPromptChars: 12000,
    guaranteedRecentCount: 3,
    recentWindowDays: 30,
    recencyHalfLifeDays: 30,
    timestampStyle: 'datetime',
    weights: { similarity: 0.70, recency: 0.12, keyword: 0.18 },
    buildQueries: () => [
      'Current situation, goals, desired state, constraints, and bottlenecks in the notes.',
      'Numbers, revenue, profit, operations, leverage, and what has already worked in the notes.',
      'Strategic blockers, unresolved decisions, risks, and opportunities in the notes.',
    ],
  },
  reframe: {
    candidateLimit: 16,
    selectionLimit: 6,
    maxPromptChars: 5000,
    guaranteedRecentCount: 3,
    recentWindowDays: 10,
    recencyHalfLifeDays: 7,
    timestampStyle: 'datetime',
    forceRecentCoverage: true,
    weights: { similarity: 0.56, recency: 0.28, keyword: 0.16 },
    buildQueries: () => [
      'Recent guilt, regret, self-judgment, worry, and mental loops in the notes.',
      'Recent contradictions, emotional friction, second-guessing, and relief-producing facts in the notes.',
    ],
  },
  'morning-brief': {
    candidateLimit: 16,
    selectionLimit: 6,
    maxPromptChars: 4500,
    guaranteedRecentCount: 4,
    recentWindowDays: 7,
    recencyHalfLifeDays: 5,
    timestampStyle: 'datetime',
    forceRecentCoverage: true,
    weights: { similarity: 0.52, recency: 0.30, keyword: 0.18 },
    buildQueries: () => [
      'Active tasks, recent decisions, deadlines, momentum, and next steps in the notes.',
      'Projects that can move forward immediately, energy constraints, and what matters today.',
    ],
  },
}

export interface NoteContextRequest {
  profile: NoteRetrievalProfile
  userQuery?: string
  conversationHistory?: unknown[]
  currentDate?: string
  userTimezone?: string
}

export interface NoteContextDiagnostics {
  profile: NoteRetrievalProfile
  availableNotes: number
  indexedNotes: number
  candidateNotes: number
  selectedNotes: number
  fullPromptChars: number
  selectedPromptChars: number
  promptReductionRatio: number
  rerankerUsed: boolean
  fallbackUsed: boolean
}

export interface NoteContextResult {
  notesText: string
  noteIds: string[]
  diagnostics: NoteContextDiagnostics
}

function hashString(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

function buildNoteIndexSource(message: StoredMessage): NoteIndexSource | null {
  if (typeof message.content !== 'string') {
    return null
  }

  const content = message.content.trim()
  if (!content) {
    return null
  }

  const timestampIso = getMessageTimestampIso(message)
  const stableId = typeof message.id === 'string' && message.id.trim().length > 0
    ? message.id
    : hashString(`${timestampIso}:${content}`)

  return {
    noteId: stableId,
    content,
    contentHash: hashString(content),
    timestampIso,
  }
}

function normalizeTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return new Date(0).toISOString()
  }

  return date.toISOString()
}

function normalizeNowIso(value?: string): string {
  if (!value) {
    return new Date().toISOString()
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString()
  }

  return date.toISOString()
}

function parseEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is number => typeof entry === 'number')
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed.filter((entry): entry is number => typeof entry === 'number') : []
    } catch {
      return []
    }
  }

  return []
}

function serializeJson(sql: ReturnType<typeof getSql>, value: unknown): unknown {
  const sqlWithJson = sql as unknown as { json?: (input: unknown) => unknown }
  return typeof sqlWithJson.json === 'function' ? sqlWithJson.json(value) : JSON.stringify(value)
}

async function ensureNoteIndexSchema() {
  const sql = getSql()

  await sql`
    create table if not exists note_embeddings (
      note_id text primary key,
      content text not null,
      content_hash text not null,
      note_timestamp timestamptz not null,
      embedding jsonb not null,
      embedding_model text not null,
      embedding_dimensions integer not null,
      updated_at timestamptz default now()
    )
  `

  await sql`create index if not exists note_embeddings_note_timestamp_idx on note_embeddings (note_timestamp desc)`
  await sql`create index if not exists note_embeddings_updated_at_idx on note_embeddings (updated_at desc)`
}

function collectNoteSources(conversations: ConversationData): NoteIndexSource[] {
  return getNoteMessages(conversations)
    .map(buildNoteIndexSource)
    .filter((note): note is NoteIndexSource => Boolean(note))
}

export async function syncConversationNoteIndex(conversations: ConversationData): Promise<{
  deleted: number
  indexed: number
}> {
  if (!isGeminiRetrievalEnabled()) {
    return { deleted: 0, indexed: 0 }
  }

  await ensureNoteIndexSchema()

  const notes = collectNoteSources(normalizeConversationData(conversations))
  const sql = getSql()
  const existingRows = await sql`select note_id, content_hash from note_embeddings`
  const existingById = new Map<string, string>()

  for (const row of existingRows as Array<{ note_id: string; content_hash: string }>) {
    existingById.set(row.note_id, row.content_hash)
  }

  const currentIds = new Set(notes.map((note) => note.noteId))
  let deleted = 0

  for (const [noteId] of existingById) {
    if (!currentIds.has(noteId)) {
      await sql`delete from note_embeddings where note_id = ${noteId}`
      deleted += 1
    }
  }

  const notesToIndex = notes.filter((note) => existingById.get(note.noteId) !== note.contentHash)
  if (!notesToIndex.length) {
    return { deleted, indexed: 0 }
  }

  const embeddings = await embedTexts(
    notesToIndex.map((note) => ({
      text: note.content,
      title: note.content.slice(0, 80),
    })),
    'RETRIEVAL_DOCUMENT',
  )

  const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL ?? 'models/gemini-embedding-2-preview'
  const embeddingDimensions = embeddings[0]?.length ?? 0

  for (const [index, note] of notesToIndex.entries()) {
    const embeddingPayload = serializeJson(sql, embeddings[index])

    await sql`
      insert into note_embeddings (
        note_id,
        content,
        content_hash,
        note_timestamp,
        embedding,
        embedding_model,
        embedding_dimensions,
        updated_at
      )
      values (
        ${note.noteId},
        ${note.content},
        ${note.contentHash},
        ${note.timestampIso},
        ${embeddingPayload}::jsonb,
        ${embeddingModel},
        ${embeddingDimensions},
        now()
      )
      on conflict (note_id) do update
        set content = excluded.content,
            content_hash = excluded.content_hash,
            note_timestamp = excluded.note_timestamp,
            embedding = excluded.embedding,
            embedding_model = excluded.embedding_model,
            embedding_dimensions = excluded.embedding_dimensions,
            updated_at = now()
    `
  }

  return { deleted, indexed: notesToIndex.length }
}

async function loadIndexedNotes(): Promise<IndexedNoteRecord[]> {
  await ensureNoteIndexSchema()
  const sql = getSql()
  const rows = await sql`
    select note_id, content, content_hash, note_timestamp, embedding
    from note_embeddings
    order by note_timestamp desc
  `

  return (rows as NoteIndexRow[])
    .map((row) => {
      const embedding = parseEmbedding(row.embedding)
      if (!embedding.length) {
        return null
      }

      return {
        noteId: row.note_id,
        content: row.content,
        contentHash: row.content_hash,
        timestampIso: normalizeTimestamp(row.note_timestamp),
        embedding,
      }
    })
    .filter((note): note is IndexedNoteRecord => Boolean(note))
}

function summarizeConversationHistory(history: unknown[] | undefined): string {
  if (!Array.isArray(history) || history.length === 0) {
    return ''
  }

  return history
    .slice(-6)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return ''
      }

      const candidate = entry as { role?: string; parts?: Array<{ text?: string }> }
      const speaker = candidate.role === 'model' ? 'AI' : 'User'
      const text = Array.isArray(candidate.parts)
        ? candidate.parts.map((part) => part.text ?? '').join(' ').trim()
        : ''

      return text ? `${speaker}: ${text}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractQueryTerms(queries: string[]): string[] {
  const terms = new Set<string>()

  for (const query of queries) {
    const matches = query.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []
    for (const match of matches) {
      if (!STOP_WORDS.has(match)) {
        terms.add(match)
      }
    }
  }

  return [...terms]
}

function computeKeywordScore(content: string, queryTerms: string[]): number {
  if (!queryTerms.length) {
    return 0
  }

  const lowerContent = content.toLowerCase()
  let matches = 0

  for (const term of queryTerms) {
    if (lowerContent.includes(term)) {
      matches += 1
    }
  }

  return matches / queryTerms.length
}

function computeRecencyScore(
  timestampIso: string,
  nowIso: string,
  profile: RetrievalProfileConfig,
): number {
  const noteTime = new Date(timestampIso)
  const now = new Date(nowIso)

  if (Number.isNaN(noteTime.getTime()) || Number.isNaN(now.getTime())) {
    return 0
  }

  const diffMs = Math.max(0, now.getTime() - noteTime.getTime())
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  const baseScore = 1 / (1 + (diffDays / profile.recencyHalfLifeDays))

  if (profile.recentWindowDays !== undefined && diffDays <= profile.recentWindowDays) {
    return Math.min(1, baseScore + 0.2)
  }

  return baseScore
}

function dotProduct(left: number[], right: number[]): number {
  const sharedLength = Math.min(left.length, right.length)
  let total = 0

  for (let index = 0; index < sharedLength; index += 1) {
    total += left[index] * right[index]
  }

  return total
}

function rankCandidates(
  notes: IndexedNoteRecord[],
  queryEmbeddings: number[][],
  queryTerms: string[],
  nowIso: string,
  profile: RetrievalProfileConfig,
): RetrievalCandidate[] {
  return notes
    .map((note) => {
      const similarityScore = queryEmbeddings.length
        ? Math.max(...queryEmbeddings.map((embedding) => Math.max(0, dotProduct(embedding, note.embedding))))
        : 0
      const recencyScore = computeRecencyScore(note.timestampIso, nowIso, profile)
      const keywordScore = computeKeywordScore(note.content, queryTerms)
      const combinedScore =
        (similarityScore * profile.weights.similarity) +
        (recencyScore * profile.weights.recency) +
        (keywordScore * profile.weights.keyword)

      return {
        ...note,
        similarityScore,
        recencyScore,
        keywordScore,
        combinedScore,
      }
    })
    .sort((left, right) => right.combinedScore - left.combinedScore)
}

function mergeRecentCandidates(
  rankedCandidates: RetrievalCandidate[],
  profile: RetrievalProfileConfig,
  nowIso: string,
): RetrievalCandidate[] {
  const selected = new Map<string, RetrievalCandidate>()

  for (const candidate of rankedCandidates.slice(0, profile.candidateLimit)) {
    selected.set(candidate.noteId, candidate)
  }

  const recentCandidates = [...rankedCandidates]
    .sort((left, right) => new Date(right.timestampIso).getTime() - new Date(left.timestampIso).getTime())
    .filter((candidate) => {
      if (profile.recentWindowDays === undefined) {
        return true
      }

      const ageScore = computeRecencyScore(candidate.timestampIso, nowIso, profile)
      return ageScore > 0.2
    })
    .slice(0, profile.guaranteedRecentCount)

  for (const candidate of recentCandidates) {
    selected.set(candidate.noteId, candidate)
  }

  return [...selected.values()].sort((left, right) => right.combinedScore - left.combinedScore)
}

function formatTimestampForPrompt(
  timestampIso: string,
  style: TimestampStyle,
  userTimezone?: string,
): string {
  const date = new Date(timestampIso)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date'
  }

  if (style === 'datetime') {
    return date.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: userTimezone,
      timeZoneName: userTimezone ? 'short' : undefined,
    })
  }

  return date.toLocaleDateString('en-US', {
    timeZone: userTimezone,
  })
}

function formatNotesForPrompt(
  notes: NoteIndexSource[],
  style: TimestampStyle,
  userTimezone?: string,
  maxPromptChars?: number,
): string {
  return selectNotesWithinBudget(notes, style, userTimezone, maxPromptChars)
    .map((note) => `[${formatTimestampForPrompt(note.timestampIso, style, userTimezone)}] ${note.content}`)
    .join('\n')
}

function selectNotesWithinBudget(
  notes: NoteIndexSource[],
  style: TimestampStyle,
  userTimezone?: string,
  maxPromptChars?: number,
): NoteIndexSource[] {
  if (maxPromptChars === undefined) {
    return notes
  }

  const lines: string[] = []
  const selectedNotes: NoteIndexSource[] = []
  let totalChars = 0

  for (const note of notes) {
    let line = `[${formatTimestampForPrompt(note.timestampIso, style, userTimezone)}] ${note.content}`
    let selectedNote = note

    if (maxPromptChars !== undefined && totalChars + line.length > maxPromptChars) {
      if (!lines.length) {
        const remaining = Math.max(120, maxPromptChars - 32)
        selectedNote = { ...note, content: note.content.slice(0, Math.max(0, remaining)).trimEnd() }
        line = `[${formatTimestampForPrompt(selectedNote.timestampIso, style, userTimezone)}] ${selectedNote.content}…`
      } else {
        continue
      }
    }

    lines.push(line)
    selectedNotes.push(selectedNote)
    totalChars += line.length + 1

    if (maxPromptChars !== undefined && totalChars >= maxPromptChars) {
      break
    }
  }

  return selectedNotes
}

function ensureRecentCoverage(
  selected: RetrievalCandidate[],
  mergedCandidates: RetrievalCandidate[],
  profile: RetrievalProfileConfig,
  nowIso: string,
): RetrievalCandidate[] {
  if (!profile.forceRecentCoverage || selected.length === 0) {
    return selected
  }

  const hasRecentNote = selected.some((candidate) => {
    if (profile.recentWindowDays === undefined) {
      return true
    }

    return computeRecencyScore(candidate.timestampIso, nowIso, profile) > 0.2
  })

  if (hasRecentNote) {
    return selected
  }

  const recentCandidate = mergedCandidates.find((candidate) => computeRecencyScore(candidate.timestampIso, nowIso, profile) > 0.2)
  if (!recentCandidate) {
    return selected
  }

  const withoutLast = selected.slice(0, Math.max(0, selected.length - 1))
  const merged = [...withoutLast, recentCandidate]
  const seen = new Set<string>()

  return merged.filter((candidate) => {
    if (seen.has(candidate.noteId)) {
      return false
    }

    seen.add(candidate.noteId)
    return true
  })
}

export async function getRelevantNotesContext(input: NoteContextRequest): Promise<NoteContextResult> {
  const profile = RETRIEVAL_PROFILES[input.profile]
  const conversations = await loadConversations()
  const allNotes = collectNoteSources(conversations)
  const fullNotesText = formatNotesForPrompt(allNotes, profile.timestampStyle, input.userTimezone)
  const nowIso = normalizeNowIso(input.currentDate)

  if (!allNotes.length) {
    return {
      notesText: '',
      noteIds: [],
      diagnostics: {
        profile: input.profile,
        availableNotes: 0,
        indexedNotes: 0,
        candidateNotes: 0,
        selectedNotes: 0,
        fullPromptChars: 0,
        selectedPromptChars: 0,
        promptReductionRatio: 0,
        rerankerUsed: false,
        fallbackUsed: false,
      },
    }
  }

  if (!isGeminiRetrievalEnabled()) {
    return {
      notesText: fullNotesText,
      noteIds: allNotes.map((note) => note.noteId),
      diagnostics: {
        profile: input.profile,
        availableNotes: allNotes.length,
        indexedNotes: 0,
        candidateNotes: allNotes.length,
        selectedNotes: allNotes.length,
        fullPromptChars: fullNotesText.length,
        selectedPromptChars: fullNotesText.length,
        promptReductionRatio: 0,
        rerankerUsed: false,
        fallbackUsed: true,
      },
    }
  }

  try {
    await syncConversationNoteIndex(conversations)
    const indexedNotes = await loadIndexedNotes()
    const queries = profile.buildQueries(input)
    const queryEmbeddings = await embedTexts(
      queries.map((query) => ({ text: query })),
      input.profile === 'chat' ? 'QUESTION_ANSWERING' : 'RETRIEVAL_QUERY',
    )
    const queryTerms = extractQueryTerms(queries)
    const rankedCandidates = rankCandidates(indexedNotes, queryEmbeddings, queryTerms, nowIso, profile)
    const mergedCandidates = mergeRecentCandidates(rankedCandidates, profile, nowIso)
    const limitedCandidates = mergedCandidates.slice(0, profile.candidateLimit)

    let rerankerUsed = false
    let selectedCandidates = limitedCandidates.slice(0, profile.selectionLimit)

    if (limitedCandidates.length > profile.selectionLimit) {
      try {
        const selectedIds = await rerankNotesWithCheapModel({
          profile: input.profile,
          candidates: limitedCandidates.map((candidate) => ({
            noteId: candidate.noteId,
            content: candidate.content,
            timestampIso: candidate.timestampIso,
            baseScore: candidate.combinedScore,
          })),
          maxSelections: profile.selectionLimit,
          userQuery: input.userQuery,
          queryHints: queries,
        })

        if (selectedIds.length > 0) {
          const minimumExpected = Math.max(1, Math.floor(profile.selectionLimit * 0.25))
          if (selectedIds.length < minimumExpected) {
            console.warn(
              `[note-retrieval] Reranker returned only ${selectedIds.length}/${profile.selectionLimit} ids (minimum ${minimumExpected}), likely truncated — falling back to score-ranked candidates`,
            )
          } else {
            rerankerUsed = true
            const byId = new Map(limitedCandidates.map((candidate) => [candidate.noteId, candidate]))
            selectedCandidates = selectedIds
              .map((noteId) => byId.get(noteId))
              .filter((candidate): candidate is RetrievalCandidate => Boolean(candidate))
          }
        }
      } catch (error) {
        console.warn(`[note-retrieval] Cheap reranker failed for ${input.profile}:`, error)
      }
    }

    selectedCandidates = ensureRecentCoverage(selectedCandidates, limitedCandidates, profile, nowIso)
    const selectedNotes = selectedCandidates
      .sort((left, right) => right.combinedScore - left.combinedScore)
      .map<NoteIndexSource>((candidate) => ({
        noteId: candidate.noteId,
        content: candidate.content,
        contentHash: candidate.contentHash,
        timestampIso: candidate.timestampIso,
      }))

    const budgetedNotes = selectNotesWithinBudget(
      selectedNotes,
      profile.timestampStyle,
      input.userTimezone,
      profile.maxPromptChars,
    )
    const notesText = formatNotesForPrompt(
      budgetedNotes,
      profile.timestampStyle,
      input.userTimezone,
    )

    const selectedNoteIds = budgetedNotes.map((note) => note.noteId)

    const promptReductionRatio = fullNotesText.length > 0
      ? Math.max(0, 1 - (notesText.length / fullNotesText.length))
      : 0

    console.log(
      `[note-retrieval] ${input.profile}: ${selectedNoteIds.length}/${allNotes.length} notes selected, ${Math.round(promptReductionRatio * 100)}% prompt reduction`,
    )

    return {
      notesText,
      noteIds: selectedNoteIds,
      diagnostics: {
        profile: input.profile,
        availableNotes: allNotes.length,
        indexedNotes: indexedNotes.length,
        candidateNotes: limitedCandidates.length,
        selectedNotes: selectedNoteIds.length,
        fullPromptChars: fullNotesText.length,
        selectedPromptChars: notesText.length,
        promptReductionRatio,
        rerankerUsed,
        fallbackUsed: false,
      },
    }
  } catch (error) {
    console.error(`[note-retrieval] Falling back to full note context for ${input.profile}:`, error)

    return {
      notesText: fullNotesText,
      noteIds: allNotes.map((note) => note.noteId),
      diagnostics: {
        profile: input.profile,
        availableNotes: allNotes.length,
        indexedNotes: 0,
        candidateNotes: allNotes.length,
        selectedNotes: allNotes.length,
        fullPromptChars: fullNotesText.length,
        selectedPromptChars: fullNotesText.length,
        promptReductionRatio: 0,
        rerankerUsed: false,
        fallbackUsed: true,
      },
    }
  }
}
