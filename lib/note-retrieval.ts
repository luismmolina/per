import { createHash } from 'node:crypto'

import { embedTexts, isGeminiRetrievalEnabled } from './embeddings'
import { type NoteRetrievalProfile } from './note-rerank'
import { getOpencodeClient, getOpencodeModel } from './opencode'

import { estimateJsonBytes, logDbTransfer } from './db-diagnostics'
import {
  deleteNoteEmbeddings,
  fetchNoteContentsByIds,
  listNoteEmbeddingHashes,
  listNoteEmbeddingMetadata,
  upsertNoteEmbeddings,
} from './note-embeddings-store'
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

interface IndexedNoteRecord {
  noteId: string
  contentHash: string
  timestampIso: string
  embedding: number[]
  contentLength: number
  content?: string
}

interface RetrievalCandidate extends IndexedNoteRecord {
  similarityScore: number
  recencyScore: number
  keywordScore: number
  combinedScore: number
}

type HydratedRetrievalCandidate = RetrievalCandidate & { content: string }

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
  shortNoteMaxChars?: number
  shortNoteScoreBoost?: number
  shortNoteMinScore?: number
  shortNoteBudgetRatio?: number
  buildQueries: (input: NoteContextRequest) => string[]
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

const QUERY_EXPANSION_TIMEOUT_MS = 15000

async function expandQueryWithLLM(
  userQuery: string,
  conversationSummary?: string,
): Promise<string | null> {
  const systemPrompt = [
    'You are a search-query expander. Your ONLY job is to take a short user question and rewrite it as a richer, broader search query.',
    'Rules:',
    '- Do NOT change the intent or meaning of the original question.',
    '- Add related concepts, categories of information, and terms that would be needed to answer the question thoroughly.',
    '- Include synonyms and related keywords that might appear in personal notes (e.g. for "profit" also mention revenue, costs, expenses, margins, sales, COGS).',
    '- Output ONLY the expanded query text. No preamble, no explanation, no formatting.',
    '- Keep the expanded query under 200 words.',
    '- Write in the same language as the user question.',
  ].join('\n')

  const userContent = conversationSummary
    ? `Question: ${userQuery}\n\nRecent conversation context:\n${conversationSummary}`
    : `Question: ${userQuery}`

  try {
    const client = getOpencodeClient()
    const model = getOpencodeModel()

    const response = await Promise.race([
      client.messages.create({
        model,
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Query expansion timed out')), QUERY_EXPANSION_TIMEOUT_MS),
      ),
    ])

    const expanded = response.content
      .filter((block) => block.type === 'text')
      .map((block) => 'text' in block ? block.text : '')
      .join('')
      .trim()

    if (expanded && expanded.length > userQuery.length) {
      console.log(`[note-retrieval] Query expanded: "${userQuery}" → "${expanded.slice(0, 120)}..."`)
      return expanded
    }

    return null
  } catch (error) {
    console.warn('[note-retrieval] Query expansion error:', error instanceof Error ? error.message : error)
    return null
  }
}

const RETRIEVAL_PROFILES: Record<NoteRetrievalProfile, RetrievalProfileConfig> = {
  chat: {
    candidateLimit: 150,
    selectionLimit: 40,
    maxPromptChars: 50000,
    guaranteedRecentCount: 6,
    recentWindowDays: 14,
    recencyHalfLifeDays: 21,
    timestampStyle: 'date',
    weights: { similarity: 0.76, recency: 0.14, keyword: 0.10 },
    shortNoteMaxChars: 150,
    shortNoteScoreBoost: 0.12,
    shortNoteMinScore: 0.12,
    shortNoteBudgetRatio: 0.15,
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
    candidateLimit: 150,
    selectionLimit: 40,
    maxPromptChars: 200000,
    guaranteedRecentCount: 24,
    recentWindowDays: 90,
    recencyHalfLifeDays: 60,
    timestampStyle: 'datetime',
    weights: { similarity: 0.68, recency: 0.12, keyword: 0.20 },
    shortNoteMaxChars: 200,
    shortNoteScoreBoost: 0.08,
    shortNoteMinScore: 0.10,
    shortNoteBudgetRatio: 0.10,
    buildQueries: (input) => [
      `Recurring patterns, lessons, contradictions, and self-knowledge in the notes.${input.currentDate ? ` Current date: ${input.currentDate}.` : ''}`,
      'Wins, failures, turning points, repeated mistakes, and proof-backed insights in the notes.',
      'Recent changes, constraints, emotional themes, and things the user keeps forgetting.',
    ],
  },
  consulting: {
    candidateLimit: 80,
    selectionLimit: 40,
    maxPromptChars: 45000,
    guaranteedRecentCount: 10,
    recentWindowDays: 30,
    recencyHalfLifeDays: 30,
    timestampStyle: 'datetime',
    weights: { similarity: 0.70, recency: 0.12, keyword: 0.18 },
    shortNoteMaxChars: 150,
    shortNoteScoreBoost: 0.14,
    shortNoteMinScore: 0.10,
    shortNoteBudgetRatio: 0.18,
    buildQueries: (input) => [
      `Current situation, goals, desired state, constraints, and bottlenecks in the notes.${input.currentDate ? ` Current date: ${input.currentDate}.` : ''}`,
      'Numbers, revenue, profit, operations, leverage, and what has already worked in the notes.',
      'Strategic blockers, unresolved decisions, risks, and opportunities in the notes.',
    ],
  },
  explore: {
    candidateLimit: 110,
    selectionLimit: 48,
    maxPromptChars: 65000,
    guaranteedRecentCount: 12,
    recentWindowDays: 45,
    recencyHalfLifeDays: 35,
    timestampStyle: 'datetime',
    weights: { similarity: 0.64, recency: 0.12, keyword: 0.24 },
    shortNoteMaxChars: 180,
    shortNoteScoreBoost: 0.10,
    shortNoteMinScore: 0.10,
    shortNoteBudgetRatio: 0.15,
    buildQueries: (input) => [
      `Objective: ${input.userQuery?.trim() || 'Find new options that fit the notes'}. Current situation, economics, labor constraints, customer behavior, and what already appears to be working in the notes.${input.currentDate ? ` Current date: ${input.currentDate}.` : ''}`,
      'Ideas the user already proposed, experiments already tried, pricing changes, reservations, promotions, product mix, and cannibalization concerns in the notes.',
      'Underused assets, idle capacity, partnerships, group sales, B2B angles, take-home products, low-labor revenue, and other overlooked profit levers that the notes could support.',
    ],
  },
  reframe: {
    candidateLimit: 50,
    selectionLimit: 20,
    maxPromptChars: 18000,
    guaranteedRecentCount: 8,
    recentWindowDays: 10,
    recencyHalfLifeDays: 7,
    timestampStyle: 'datetime',
    forceRecentCoverage: true,
    weights: { similarity: 0.56, recency: 0.28, keyword: 0.16 },
    shortNoteMaxChars: 120,
    shortNoteScoreBoost: 0.06,
    shortNoteMinScore: 0.15,
    shortNoteBudgetRatio: 0.10,
    buildQueries: (input) => [
      `Recent guilt, regret, self-judgment, worry, and mental loops in the notes.${input.currentDate ? ` Current date: ${input.currentDate}.` : ''}`,
      'Recent contradictions, emotional friction, second-guessing, and relief-producing facts in the notes.',
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
  shortNotesIncluded: number
  shortNoteChars: number
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

export function computeNoteIndexFingerprint(conversations: ConversationData): string {
  const notes = collectNoteSources(normalizeConversationData(conversations))
  const serialized = notes.map((note) => `${note.noteId}:${note.contentHash}`).sort().join('|')
  return hashString(serialized)
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

  const notes = collectNoteSources(normalizeConversationData(conversations))
  const existingById = await listNoteEmbeddingHashes()

  const currentIds = new Set(notes.map((note) => note.noteId))
  const noteIdsToDelete = [...existingById.keys()].filter((noteId) => !currentIds.has(noteId))
  const deleted = await deleteNoteEmbeddings(noteIdsToDelete)

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

  const indexed = await upsertNoteEmbeddings(
    notesToIndex.map((note, index) => ({
      noteId: note.noteId,
      content: note.content,
      contentHash: note.contentHash,
      timestampIso: note.timestampIso,
      embedding: embeddings[index],
      embeddingModel,
      embeddingDimensions,
      contentLength: note.content.length,
    })),
  )

  return { deleted, indexed }
}

async function loadIndexedNoteMetadata(): Promise<IndexedNoteRecord[]> {
  const notes = await listNoteEmbeddingMetadata()
  return notes.map((note) => ({
    noteId: note.noteId,
    contentHash: note.contentHash,
    timestampIso: note.timestampIso,
    embedding: note.embedding,
    contentLength: note.contentLength,
  }))
}

function hydrateCandidatesWithContent(
  candidates: RetrievalCandidate[],
  contentById: Map<string, string>,
): HydratedRetrievalCandidate[] {
  return candidates
    .map((candidate) => {
      const content = contentById.get(candidate.noteId)
      if (!content) return null
      return {
        ...candidate,
        content,
        contentLength: content.length,
      }
    })
    .filter((candidate): candidate is HydratedRetrievalCandidate => Boolean(candidate))
}

function summarizeConversationHistory(history: unknown[] | undefined): string {
  if (!Array.isArray(history) || history.length === 0) {
    return ''
  }

  const MAX_SUMMARY_CHARS = 1500

  const lines = history
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

      // Cap individual entries so one long message doesn't dominate
      const capped = text.length > 300 ? text.slice(0, 300) + '…' : text
      return capped ? `${speaker}: ${capped}` : ''
    })
    .filter(Boolean)

  let result = ''
  for (const line of lines) {
    if (result.length + line.length + 1 > MAX_SUMMARY_CHARS) break
    result += (result ? '\n' : '') + line
  }

  return result
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
  const shortMax = profile.shortNoteMaxChars ?? 150
  const boostFactor = profile.shortNoteScoreBoost ?? 0

  return notes
    .map((note) => {
      const similarityScore = queryEmbeddings.length
        ? Math.max(...queryEmbeddings.map((embedding) => Math.max(0, dotProduct(embedding, note.embedding))))
        : 0
      const recencyScore = computeRecencyScore(note.timestampIso, nowIso, profile)
      const contentLength = note.content?.length ?? note.contentLength
      const keywordScore = note.content ? computeKeywordScore(note.content, queryTerms) : 0
      const baseCombinedScore =
        (similarityScore * profile.weights.similarity) +
        (recencyScore * profile.weights.recency) +
        (keywordScore * profile.weights.keyword)

      // Short notes get a density bonus — they provide context at negligible cost.
      // Bonus scales linearly: full boost at 0 chars, zero boost at shortNoteMaxChars.
      const densityBonus = boostFactor > 0 && contentLength > 0 && contentLength < shortMax
        ? boostFactor * (1 - contentLength / shortMax)
        : 0
      const combinedScore = baseCombinedScore + densityBonus

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
  logDbTransfer('getRelevantNotesContext.loadConversations', {
    profile: input.profile,
    conversationsBytesLoaded: estimateJsonBytes(conversations),
  })
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
        shortNotesIncluded: 0,
        shortNoteChars: 0,
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
        shortNotesIncluded: 0,
        shortNoteChars: 0,
        fullPromptChars: fullNotesText.length,
        selectedPromptChars: fullNotesText.length,
        promptReductionRatio: 0,
        rerankerUsed: false,
        fallbackUsed: true,
      },
    }
  }

  try {
    const indexedNotes = await loadIndexedNoteMetadata()
    if (!indexedNotes.length) {
      return {
        notesText: fullNotesText,
        noteIds: allNotes.map((note) => note.noteId),
        diagnostics: {
          profile: input.profile,
          availableNotes: allNotes.length,
          indexedNotes: 0,
          candidateNotes: allNotes.length,
          selectedNotes: allNotes.length,
          shortNotesIncluded: 0,
          shortNoteChars: 0,
          fullPromptChars: fullNotesText.length,
          selectedPromptChars: fullNotesText.length,
          promptReductionRatio: 0,
          rerankerUsed: false,
          fallbackUsed: true,
        },
      }
    }

    const queries = profile.buildQueries(input)

    // Expand short user queries for better embedding coverage (chat only)
    if (input.profile === 'chat' && input.userQuery?.trim()) {
      const conversationSummary = summarizeConversationHistory(input.conversationHistory)
      const expanded = await expandQueryWithLLM(input.userQuery.trim(), conversationSummary || undefined)
      if (expanded) {
        queries.push(expanded)
      }
    }

    const queryEmbeddings = await embedTexts(
      queries.map((query) => ({ text: query })),
      input.profile === 'chat' ? 'QUESTION_ANSWERING' : 'RETRIEVAL_QUERY',
    )
    const queryTerms = extractQueryTerms(queries)
    const rankedCandidates = rankCandidates(indexedNotes, queryEmbeddings, queryTerms, nowIso, profile)
    const mergedCandidates = mergeRecentCandidates(rankedCandidates, profile, nowIso)
    const limitedCandidates = mergedCandidates.slice(0, profile.candidateLimit)

    const shortNoteMaxChars = profile.shortNoteMaxChars ?? 150
    const shortNoteMinScore = profile.shortNoteMinScore ?? 0.12
    const contentIds = new Set<string>()

    for (const candidate of limitedCandidates) {
      contentIds.add(candidate.noteId)
    }

    for (const candidate of rankedCandidates) {
      if (
        candidate.contentLength > 0 &&
        candidate.contentLength <= shortNoteMaxChars &&
        candidate.combinedScore >= shortNoteMinScore
      ) {
        contentIds.add(candidate.noteId)
      }
    }

    const contentById = await fetchNoteContentsByIds([...contentIds])
    const hydratedLimitedCandidates = hydrateCandidatesWithContent(limitedCandidates, contentById)
    const hydratedRankedCandidates = hydrateCandidatesWithContent(rankedCandidates, contentById)

    // Pass 1: Primary selection — top-N notes by combined score
    let selectedCandidates: HydratedRetrievalCandidate[] = hydratedLimitedCandidates.slice(0, profile.selectionLimit)
    selectedCandidates = ensureRecentCoverage(
      selectedCandidates,
      hydratedLimitedCandidates,
      profile,
      nowIso,
    ) as HydratedRetrievalCandidate[]

    const primaryNotes = selectedCandidates
      .sort((left, right) => right.combinedScore - left.combinedScore)
      .map<NoteIndexSource>((candidate) => ({
        noteId: candidate.noteId,
        content: candidate.content,
        contentHash: candidate.contentHash,
        timestampIso: candidate.timestampIso,
      }))

    const budgetedPrimary = selectNotesWithinBudget(
      primaryNotes,
      profile.timestampStyle,
      input.userTimezone,
      profile.maxPromptChars,
    )

    // Pass 2: Short-note sweep — fill remaining budget with cheap, relevant short notes
    const shortNoteBudgetRatio = profile.shortNoteBudgetRatio ?? 0.15
    const primaryIds = new Set(budgetedPrimary.map((note) => note.noteId))

    let primaryChars = 0
    for (const note of budgetedPrimary) {
      const line = `[${formatTimestampForPrompt(note.timestampIso, profile.timestampStyle, input.userTimezone)}] ${note.content}`
      primaryChars += line.length + 1
    }

    const maxShortBudget = Math.floor(profile.maxPromptChars * shortNoteBudgetRatio)
    const remainingBudget = Math.min(maxShortBudget, profile.maxPromptChars - primaryChars)

    const shortNoteCandidates = hydratedRankedCandidates
      .filter((candidate) =>
        !primaryIds.has(candidate.noteId) &&
        candidate.content.length <= shortNoteMaxChars &&
        candidate.combinedScore >= shortNoteMinScore
      )
      .sort((left, right) => right.combinedScore - left.combinedScore)

    const sweepNotes: NoteIndexSource[] = []
    let sweepChars = 0
    for (const candidate of shortNoteCandidates) {
      const line = `[${formatTimestampForPrompt(candidate.timestampIso, profile.timestampStyle, input.userTimezone)}] ${candidate.content}`
      if (sweepChars + line.length + 1 > remainingBudget) {
        continue
      }
      sweepNotes.push({
        noteId: candidate.noteId,
        content: candidate.content,
        contentHash: candidate.contentHash,
        timestampIso: candidate.timestampIso,
      })
      sweepChars += line.length + 1
    }

    // Merge primary + sweep notes, sorted chronologically for coherent reading
    const allSelected = [...budgetedPrimary, ...sweepNotes]
      .sort((left, right) => new Date(left.timestampIso).getTime() - new Date(right.timestampIso).getTime())

    const notesText = allSelected
      .map((note) => `[${formatTimestampForPrompt(note.timestampIso, profile.timestampStyle, input.userTimezone)}] ${note.content}`)
      .join('\n')

    const selectedNoteIds = allSelected.map((note) => note.noteId)

    const promptReductionRatio = fullNotesText.length > 0
      ? Math.max(0, 1 - (notesText.length / fullNotesText.length))
      : 0

    console.log(
      `[note-retrieval] ${input.profile}: ${selectedNoteIds.length}/${allNotes.length} notes selected (${sweepNotes.length} short-note sweep, +${sweepChars} chars), ${Math.round(promptReductionRatio * 100)}% prompt reduction`,
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
        shortNotesIncluded: sweepNotes.length,
        shortNoteChars: sweepChars,
        fullPromptChars: fullNotesText.length,
        selectedPromptChars: notesText.length,
        promptReductionRatio,
        rerankerUsed: false,
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
        shortNotesIncluded: 0,
        shortNoteChars: 0,
        fullPromptChars: fullNotesText.length,
        selectedPromptChars: fullNotesText.length,
        promptReductionRatio: 0,
        rerankerUsed: false,
        fallbackUsed: true,
      },
    }
  }
}
