import { createHash } from 'node:crypto'

import { generateStructuredGeminiOutput } from '../embeddings'
import { createOpencodeText } from '../opencode'
import type { ExtractedFactDraft, FactEvent, FactPolarity } from './types'
import { FACT_EXTRACTOR_VERSION } from './types'

const MAX_CHUNK_CHARS = 2800
const CHUNK_OVERLAP = 200
const MAX_FACTS_PER_NOTE = 40
const SKIP_MIN_CHARS = 12

const POLARITIES: FactPolarity[] = [
  'measurement',
  'decision',
  'estimate',
  'plan',
  'hypothesis',
  'constraint',
  'identity',
]

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entity: {
            type: 'string',
            description: 'Stable subject, e.g. Costa Coral, TikTok ads, Buffet Básico, Luis',
          },
          attribute: {
            type: 'string',
            description: 'Snake or dotted metric/policy name, e.g. daily_sales, buffet.tacos_per_guest, ROAS, price',
          },
          valueText: {
            type: 'string',
            description: 'Human-readable value exactly as claimed',
          },
          valueNum: {
            type: 'number',
            description: 'Numeric value when applicable, else omit',
            nullable: true,
          },
          unit: {
            type: 'string',
            description: 'MXN, %, x, tacos, people, etc.',
            nullable: true,
          },
          polarity: {
            type: 'string',
            enum: POLARITIES,
          },
          asOf: {
            type: 'string',
            description: 'ISO date if the note states a specific date; else omit',
            nullable: true,
          },
          confidence: {
            type: 'number',
            description: '0-1 confidence',
          },
          rawSpan: {
            type: 'string',
            description: 'Short quote from the note supporting the fact',
            nullable: true,
          },
        },
        required: ['entity', 'attribute', 'valueText', 'polarity'],
      },
    },
    skipReason: {
      type: 'string',
      description: 'If no extractable signal, brief reason; else omit or empty',
      nullable: true,
    },
  },
  required: ['facts'],
}

interface ExtractResponse {
  facts?: ExtractedFactDraft[]
  skipReason?: string | null
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
}

export function buildStateKey(entity: string, attribute: string): string {
  const e = normalizeLabel(entity).toLowerCase()
  const a = normalizeLabel(attribute).toLowerCase().replace(/\s+/g, '_')
  return `${e}|${a}`
}

function looksLikeDerivedAnalysis(content: string): boolean {
  if (content.length < 4000) return false
  const headerHits = (content.match(/^\d+\.\s/gm) ?? []).length
  const sectionHits = (content.match(/^---+$/gm) ?? []).length
  const modelPhrases = /(you think|your realistic|scenario|option [ab]:|break-even|reconstructed)/i.test(content)
  return headerHits >= 4 || sectionHits >= 3 || (content.length > 8000 && modelPhrases)
}

function chunkNoteContent(content: string): string[] {
  if (content.length <= MAX_CHUNK_CHARS) {
    return [content]
  }

  const chunks: string[] = []
  let start = 0

  while (start < content.length) {
    let end = Math.min(content.length, start + MAX_CHUNK_CHARS)

    if (end < content.length) {
      const slice = content.slice(start, end)
      const breakAt = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('. '),
      )
      if (breakAt > MAX_CHUNK_CHARS * 0.4) {
        end = start + breakAt + 1
      }
    }

    const chunk = content.slice(start, end).trim()
    if (chunk) chunks.push(chunk)

    if (end >= content.length) break
    start = Math.max(0, end - CHUNK_OVERLAP)
  }

  return chunks.length ? chunks : [content.slice(0, MAX_CHUNK_CHARS)]
}

function buildExtractPrompt(input: {
  content: string
  noteTimestampIso: string
  derivedAnalysis: boolean
  chunkIndex: number
  chunkTotal: number
}): string {
  const derivedBlock = input.derivedAnalysis
    ? `
SPECIAL: This text looks like a pasted AI analysis / economic model of older data.
- Prefer FIRST-PERSON measurements and explicit decisions only.
- Do NOT promote restated model assumptions, scenario math, or historical ladders as current measurements unless the user clearly states they are true now.
- Prefer polarity estimate/plan for model-derived numbers.
`
    : ''

  return `You extract atomic FACTS from a personal business/life journal note. Signal only — no fluff.

NOTE TIMESTAMP (default asOf if no date in text): ${input.noteTimestampIso}
CHUNK: ${input.chunkIndex + 1}/${input.chunkTotal}
${derivedBlock}

RULES:
1. Extract ONLY concrete claims: numbers, prices, metrics, policies, decisions, stable identity, hard constraints.
2. Skip emotions, motivation, vague worry, pure brainstorming without numbers, and pure process chatter.
3. polarity:
   - measurement: observed / sold / measured / POS / "today we…"
   - decision: "I decided", "we will", "we no longer allow", implemented policy
   - estimate: "around", "I think", "suspect", approximate
   - plan: considering / idea / maybe / other idea (NOT current truth)
   - hypothesis: possible explanation
   - constraint: hard limit (no alcohol license, closed Tuesdays, etc.)
   - identity: stable person/business identity (name, location, role)
4. entity: stable name (Costa Coral, TikTok ads, Buffet Básico, Buffet Premium, Luis, staff names).
5. attribute: short snake/dot name (price, daily_sales, ROAS, monthly_sales, buffet.tacos_per_guest, beverage_share, staff_count, policy.no_mixed_tables).
6. If a note says "was X now Y" or "reduced from A to B", emit TWO facts (old + new) with clear values.
7. currency is usually MXN. ROAS as multiplier (10x → valueNum 10, unit "x"). Percents as 0-100 or ratio — keep valueText faithful.
8. Max 15 facts per chunk. Prefer fewer high-signal facts.
9. If nothing extractable, return facts: [].

NOTE TEXT:
"""
${input.content}
"""

Return JSON only matching the schema: { "facts": [...], "skipReason": "..." }.`
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.6
  return Math.min(1, Math.max(0, value))
}

function normalizePolarity(value: unknown): FactPolarity {
  if (typeof value === 'string' && POLARITIES.includes(value as FactPolarity)) {
    return value as FactPolarity
  }
  return 'estimate'
}

function normalizeDraft(raw: ExtractedFactDraft): ExtractedFactDraft | null {
  const entity = normalizeLabel(String(raw.entity ?? ''))
  const attribute = normalizeLabel(String(raw.attribute ?? ''))
  const valueText = normalizeLabel(String(raw.valueText ?? ''))

  if (!entity || !attribute || !valueText) return null
  if (valueText.length > 240) return null

  let valueNum: number | null = null
  if (typeof raw.valueNum === 'number' && Number.isFinite(raw.valueNum)) {
    valueNum = raw.valueNum
  }

  return {
    entity,
    attribute,
    valueText,
    valueNum,
    unit: raw.unit ? normalizeLabel(String(raw.unit)) : null,
    polarity: normalizePolarity(raw.polarity),
    asOf: raw.asOf ? String(raw.asOf) : null,
    confidence: clampConfidence(raw.confidence),
    rawSpan: raw.rawSpan ? String(raw.rawSpan).slice(0, 280) : null,
  }
}

function parseJsonFacts(text: string): ExtractResponse {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Extractor returned no JSON object')
  }
  return JSON.parse(candidate.slice(start, end + 1)) as ExtractResponse
}

async function extractChunkWithModel(prompt: string): Promise<ExtractResponse> {
  if (process.env.GEMINI_API_KEY) {
    try {
      return await generateStructuredGeminiOutput<ExtractResponse>(prompt, {
        maxOutputTokens: 4096,
        temperature: 0.1,
        responseJsonSchema: EXTRACT_SCHEMA,
      })
    } catch (error) {
      console.warn(
        '[facts] Gemini extract failed, falling back to OpenCode:',
        error instanceof Error ? error.message : error,
      )
    }
  }

  if (!process.env.OPENCODE_API_KEY) {
    throw new Error('No extractor API key: set GEMINI_API_KEY or OPENCODE_API_KEY')
  }

  const text = await createOpencodeText({
    max_tokens: 2500,
    system:
      'You are a precise fact extractor. Reply with a single JSON object only. No markdown, no commentary.',
    messages: [{ role: 'user', content: prompt }],
  })

  return parseJsonFacts(text)
}

function resolveAsOf(draftAsOf: string | null | undefined, noteTimestampIso: string): string {
  if (!draftAsOf) return noteTimestampIso
  const parsed = new Date(draftAsOf)
  if (Number.isNaN(parsed.getTime())) return noteTimestampIso
  // If only a date was provided, keep ISO date noon UTC-ish via Date parse
  return parsed.toISOString()
}

function draftToEvent(
  draft: ExtractedFactDraft,
  input: {
    noteId: string
    contentHash: string
    noteTimestampIso: string
    index: number
  },
): FactEvent {
  const asOf = resolveAsOf(draft.asOf, input.noteTimestampIso)
  const stateKey = buildStateKey(draft.entity, draft.attribute)
  const factId = createHash('sha1')
    .update(
      [
        input.noteId,
        stateKey,
        draft.valueText,
        asOf,
        draft.polarity,
        String(input.index),
        input.contentHash,
      ].join('|'),
    )
    .digest('hex')

  return {
    factId,
    sourceNoteId: input.noteId,
    sourceContentHash: input.contentHash,
    entity: draft.entity,
    attribute: draft.attribute,
    stateKey,
    valueText: draft.valueText,
    valueNum: draft.valueNum ?? null,
    unit: draft.unit ?? null,
    polarity: draft.polarity,
    asOf,
    confidence: draft.confidence ?? 0.6,
    rawSpan: draft.rawSpan ?? null,
    extractorVersion: FACT_EXTRACTOR_VERSION,
    createdAt: new Date().toISOString(),
  }
}

function dedupeEvents(events: FactEvent[]): FactEvent[] {
  const seen = new Map<string, FactEvent>()

  for (const event of events) {
    const key = [
      event.stateKey,
      event.valueText.toLowerCase(),
      event.polarity,
      event.asOf.slice(0, 10),
    ].join('|')

    const existing = seen.get(key)
    if (!existing || event.confidence > existing.confidence) {
      seen.set(key, event)
    }
  }

  return [...seen.values()].slice(0, MAX_FACTS_PER_NOTE)
}

export async function extractFactsFromNote(input: {
  noteId: string
  content: string
  contentHash: string
  timestampIso: string
}): Promise<{ events: FactEvent[]; skipped: boolean; skipReason?: string }> {
  const content = input.content.trim()
  if (content.length < SKIP_MIN_CHARS) {
    return { events: [], skipped: true, skipReason: 'too_short' }
  }

  // Obvious non-signal
  if (/^this is a test\b/i.test(content) && content.length < 80) {
    return { events: [], skipped: true, skipReason: 'test_note' }
  }

  const derivedAnalysis = looksLikeDerivedAnalysis(content)
  const chunks = chunkNoteContent(content)
  const drafts: ExtractedFactDraft[] = []

  for (let index = 0; index < chunks.length; index += 1) {
    const prompt = buildExtractPrompt({
      content: chunks[index],
      noteTimestampIso: input.timestampIso,
      derivedAnalysis,
      chunkIndex: index,
      chunkTotal: chunks.length,
    })

    const response = await extractChunkWithModel(prompt)
    for (const raw of response.facts ?? []) {
      const draft = normalizeDraft(raw)
      if (draft) drafts.push(draft)
    }
  }

  if (!drafts.length) {
    return { events: [], skipped: true, skipReason: 'no_signal' }
  }

  const events = dedupeEvents(
    drafts.map((draft, index) =>
      draftToEvent(draft, {
        noteId: input.noteId,
        contentHash: input.contentHash,
        noteTimestampIso: input.timestampIso,
        index,
      }),
    ),
  )

  // Demote derived-analysis measurements slightly
  if (derivedAnalysis) {
    for (const event of events) {
      if (event.polarity === 'measurement') {
        event.confidence = Math.min(event.confidence, 0.55)
      }
    }
  }

  return { events, skipped: false }
}
