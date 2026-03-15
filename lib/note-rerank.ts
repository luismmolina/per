import { generateStructuredGeminiOutput, getGeminiRerankModel, isGeminiRetrievalEnabled } from './embeddings'

export type NoteRetrievalProfile =
  | 'chat'
  | 'longform'
  | 'consulting'
  | 'explore'
  | 'reframe'

export interface NoteRerankCandidate {
  noteId: string
  content: string
  timestampIso: string
  baseScore: number
}

interface RerankResponse {
  selectedIds?: string[]
}

const RERANK_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    selectedIds: {
      type: 'array',
      description: 'Ordered note ids selected from the provided candidate list.',
      items: {
        type: 'string',
      },
    },
  },
  required: ['selectedIds'],
}

const PROFILE_OBJECTIVES: Record<NoteRetrievalProfile, string> = {
  chat: 'Select the notes that most directly answer the user query or provide facts that materially change the answer.',
  longform: 'Select notes that maximize coverage of recurring patterns, key lessons, contradictions, wins, failures, and recent changes.',
  consulting: 'Select notes that best describe the current state, desired state, constraints, economics, bottlenecks, leverage, and proven wins.',
  explore: 'Select notes that capture current economics, constraints, previous ideas, what has already been tested, underused assets, and evidence needed to judge whether a novel option fits.',
  reframe: 'Select notes that most clearly show recent guilt, regret, self-judgment, mental loops, contradictions, and the facts that dissolve them.',
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function formatTimestamp(timestampIso: string): string {
  const date = new Date(timestampIso)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time'
  }

  return date.toISOString()
}

export async function rerankNotesWithCheapModel(input: {
  profile: NoteRetrievalProfile
  candidates: NoteRerankCandidate[]
  maxSelections: number
  userQuery?: string
  queryHints: string[]
}): Promise<string[]> {
  const { candidates, maxSelections } = input
  if (!isGeminiRetrievalEnabled() || candidates.length === 0) {
    return []
  }

  const prompt = `You are selecting the smallest set of notes needed for downstream reasoning.

ROUTE:
${input.profile}

OBJECTIVE:
${PROFILE_OBJECTIVES[input.profile]}

USER QUERY:
${input.userQuery?.trim() || '(No direct user query; rely on the route objective and query hints.)'}

QUERY HINTS:
${input.queryHints.map((hint, index) => `${index + 1}. ${hint}`).join('\n')}

RULES:
- Select at most ${maxSelections} note ids.
- Prefer notes with concrete facts, numbers, direct observations, or emotionally salient evidence.
- Prefer diverse coverage over near-duplicates.
- Keep the smallest set that still gives strong coverage for this route.
- Do not invent ids. Use only ids from the candidate list.
- Return strict JSON with shape {"selectedIds":["id1","id2"]}.

CANDIDATE NOTES:
${candidates.map((candidate, index) => {
    const excerpt = collapseWhitespace(candidate.content).slice(0, 320)
    return `${index + 1}. id=${candidate.noteId}
time=${formatTimestamp(candidate.timestampIso)}
baseScore=${candidate.baseScore.toFixed(4)}
excerpt=${excerpt}`
  }).join('\n\n')}`

  // Estimate token budget: each note ID needs ~20-50 chars; add generous headroom for JSON framing.
  const estimatedOutputChars = maxSelections * 80 + 256
  const outputTokens = Math.max(2048, Math.ceil(estimatedOutputChars / 3))

  const response = await generateStructuredGeminiOutput<RerankResponse>(prompt, {
    model: getGeminiRerankModel(),
    maxOutputTokens: outputTokens,
    temperature: 0,
    responseJsonSchema: RERANK_RESPONSE_SCHEMA,
  })

  const selectedIds = Array.isArray(response.selectedIds) ? response.selectedIds : []
  const candidateIds = new Set(candidates.map((candidate) => candidate.noteId))

  return selectedIds
    .filter((noteId, index, array) => typeof noteId === 'string' && candidateIds.has(noteId) && array.indexOf(noteId) === index)
    .slice(0, maxSelections)
}
