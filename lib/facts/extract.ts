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
          claim: {
            type: 'string',
            description:
              'ONE full sentence that stands alone: who/what product, what the number means, the value, and unit. A stranger reading only this sentence must understand the fact.',
          },
          entity: {
            type: 'string',
            description:
              'Specific subject people would search for, e.g. Costa Coral, Buffet Básico, TikTok ads Costa Coral, Health worker system product — never a vague label alone',
          },
          attribute: {
            type: 'string',
            description:
              'Specific metric/policy name that includes role of the value, e.g. subscription_price_monthly, buffet.basico_price, tiktok.ROAS — never bare "price"',
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
            description:
              '1-3 sentences copied/paraphrased tightly from the note that preserve WHAT the number is about — not a fragment like "a monthly of 1999 pesos"',
          },
        },
        required: ['claim', 'entity', 'attribute', 'valueText', 'polarity', 'rawSpan'],
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

  return `You extract MEANINGFUL atomic FACTS from a personal business/life journal. Compress fluff, never strip meaning.

NOTE TIMESTAMP (default asOf if no date in text): ${input.noteTimestampIso}
CHUNK: ${input.chunkIndex + 1}/${input.chunkTotal}
${derivedBlock}

PRIMARY RULE — claim is the product:
- Every fact MUST include "claim": one full sentence a stranger can understand WITHOUT reading the note.
- Bad claim: "Price is 1999" / "monthly is 1999 pesos"
- Good claim: "The Health worker system product is priced at 1,999 MXN per month (subscription)."
- Bad rawSpan: "a monthly of 1999 pesos"
- Good rawSpan: include the product/topic + the number + what kind of price (monthly fee, buffet ticket, ad spend, etc.)

RULES:
1. Extract ONLY concrete claims: numbers, prices, metrics, policies, decisions, stable identity, hard constraints.
2. Skip emotions, motivation, vague worry, pure brainstorming without numbers, and pure process chatter.
3. If a number appears but you cannot say WHAT it is for (product, channel, metric role), DO NOT extract it — omit rather than emit a hollow triple.
4. polarity:
   - measurement: observed / sold / measured / POS / "today we…"
   - decision: "I decided", "we will", "we no longer allow", implemented policy
   - estimate: "around", "I think", "suspect", approximate
   - plan: considering / idea / maybe / other idea (NOT current truth)
   - hypothesis: possible explanation
   - constraint: hard limit (no alcohol license, closed Tuesdays, etc.)
   - identity: stable person/business identity (name, location, role)
5. entity: specific (Costa Coral, Buffet Básico, TikTok ads for Costa Coral, "Health worker system" product). Include enough to disambiguate.
6. attribute: specific role of the value (subscription_price_monthly, buffet.basico_price, daily_sales, tiktok.ROAS) — NEVER bare "price" or "amount" alone.
7. valueText/valueNum/unit hold the quantity; claim holds the meaning.
8. If a note says "was X now Y", emit TWO facts (old + new), each with a full claim.
9. Currency is usually MXN. ROAS as multiplier (10x → valueNum 10, unit "x").
10. Max 12 facts per chunk. Prefer fewer high-meaning facts over many hollow numbers.
11. If nothing extractable with clear meaning, return facts: [].

EXAMPLES:
Note fragment: "I decided the health worker system will be a monthly of 1999 pesos"
→ claim: "Decided the Health worker system product subscription price is 1,999 MXN per month."
→ entity: "Health worker system", attribute: "subscription_price_monthly", valueText: "1999", unit: "MXN", polarity: decision
→ rawSpan: full clause naming the product and that it is a monthly price of 1999 pesos

Note fragment: "today we sold $8737"
→ claim: "Costa Coral sold 8,737 MXN today."
→ entity: "Costa Coral", attribute: "daily_sales", ...

NOTE TEXT:
"""
${input.content}
"""

Return JSON only: { "facts": [...], "skipReason": "..." }.`
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

const HOLLOW_ATTRIBUTES = new Set([
  'price',
  'amount',
  'value',
  'cost',
  'number',
  'total',
  'monthly',
  'price.monthly',
  'price_monthly',
])

function isHollowAttribute(attribute: string): boolean {
  const a = attribute.toLowerCase().replace(/\s+/g, '_')
  return HOLLOW_ATTRIBUTES.has(a)
}

function claimLooksMeaningful(claim: string, valueText: string, entity: string): boolean {
  if (claim.length < 28) return false
  // Must not be just "X is Y"
  const lower = claim.toLowerCase()
  if (/^(price|amount|value|cost|it|this)\s+(is|=)\s+/i.test(claim)) return false
  // Prefer that claim mentions the entity or a substantial word from it
  const entityToken = entity.split(/\s+/).find((t) => t.length >= 4)?.toLowerCase()
  const mentionsEntity = entityToken ? lower.includes(entityToken) : true
  const mentionsValue = valueText ? lower.includes(valueText.toLowerCase().replace(/,/g, '')) : true
  // Need either entity mention or a clear "what for" pattern (per month, buffet, ROAS, sold…)
  const hasRole =
    /(per month|monthly|buffet|roas|sold|sales|subscription|price of|fee|spend|cogs|taco|guest|staff|rent|ads?)\b/i.test(
      claim,
    )
  return (mentionsEntity || hasRole) && (mentionsValue || hasRole)
}

function normalizeDraft(raw: ExtractedFactDraft): ExtractedFactDraft | null {
  const entity = normalizeLabel(String(raw.entity ?? ''))
  let attribute = normalizeLabel(String(raw.attribute ?? ''))
  const valueText = normalizeLabel(String(raw.valueText ?? ''))
  let claim = normalizeLabel(String(raw.claim ?? ''))
  let rawSpan = raw.rawSpan ? normalizeLabel(String(raw.rawSpan)).slice(0, 500) : ''

  if (!entity || !attribute || !valueText) return null
  if (valueText.length > 240) return null

  // Upgrade hollow attributes when claim has enough meaning
  if (isHollowAttribute(attribute)) {
    if (/month|mensual|subscription|suscrip/i.test(claim + ' ' + rawSpan)) {
      attribute = 'subscription_price_monthly'
    } else if (/buffet|b[aá]sico|premium/i.test(claim + ' ' + rawSpan + ' ' + entity)) {
      attribute = 'menu_price'
    } else {
      // Still hollow and no upgrade path — reject rather than store garbage
      if (!claimLooksMeaningful(claim, valueText, entity)) return null
      attribute = 'price_unspecified'
    }
  }

  // Synthesize a minimal claim only if model forgot it but rawSpan is rich
  if (!claim || claim.length < 20) {
    if (rawSpan.length >= 40) {
      claim = rawSpan.length > 220 ? `${rawSpan.slice(0, 217)}…` : rawSpan
    } else {
      return null
    }
  }

  if (!claimLooksMeaningful(claim, valueText, entity)) {
    // One more chance: merge entity + value into a sentence if rawSpan helps
    if (rawSpan.length >= 40) {
      claim = `${entity}: ${rawSpan}`.slice(0, 280)
      if (!claimLooksMeaningful(claim, valueText, entity)) return null
    } else {
      return null
    }
  }

  // rawSpan must not be a meaningless fragment
  if (!rawSpan || rawSpan.length < 20) {
    rawSpan = claim
  }

  let valueNum: number | null = null
  if (typeof raw.valueNum === 'number' && Number.isFinite(raw.valueNum)) {
    valueNum = raw.valueNum
  }

  return {
    entity,
    attribute,
    claim: claim.slice(0, 320),
    valueText,
    valueNum,
    unit: raw.unit ? normalizeLabel(String(raw.unit)) : null,
    polarity: normalizePolarity(raw.polarity),
    asOf: raw.asOf ? String(raw.asOf) : null,
    confidence: clampConfidence(raw.confidence),
    rawSpan: rawSpan.slice(0, 500),
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
    max_tokens: 3500,
    system:
      'You extract meaningful facts. Every fact needs a full standalone claim sentence. Reply with a single JSON object only. No markdown, no commentary.',
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
        draft.claim,
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
    claim: draft.claim,
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
