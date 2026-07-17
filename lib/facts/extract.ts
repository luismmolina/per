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
              'ONE full sentence that stands alone: product/dish, what the value is (size grade, unit cost, qty, price…), the value, and unit. Stranger-readable.',
          },
          entity: {
            type: 'string',
            description:
              'Specific subject, e.g. taco gobernador, Costa Coral, Buffet Básico, Health worker system — never a vague label alone',
          },
          attribute: {
            type: 'string',
            description:
              'Specific role of the value, e.g. shrimp_size_grade, shrimp_unit_cost_mxn, shrimp_quantity_per_taco, subscription_price_monthly — never bare "price" or "cost"',
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

  return `You extract atomic FACTS from a personal business/life journal.
Goal: compress fluff but KEEP ALL operational signal (prices, sizes, costs, quantities, recipes, ROAS, policies, plans).

NOTE TIMESTAMP (default asOf if no date in text): ${input.noteTimestampIso}
CHUNK: ${input.chunkIndex + 1}/${input.chunkTotal}
${derivedBlock}

═══════════════════════════════════════════════════════════════
COMPLETENESS (most common failure — avoid it)
═══════════════════════════════════════════════════════════════
- If a note has N independent concrete signals, emit about N facts. Do NOT collapse to one.
- Independent signals include: product sizes/grades, unit costs, recipe quantities, prices,
  sales, ROAS, staff counts, hours, policies, planned changes.
- Example of UNDER-extraction (WRONG): note mentions shrimp size 16/20, cost 4.4 MXN each,
  and 2 per taco → only one fact "2 shrimp" is emitted. That drops the substance.
- Example of CORRECT: three separate facts (size, unit cost, qty) for the same product.

PRIMARY RULE — claim carries meaning:
- Every fact MUST include "claim": one full sentence a stranger understands WITHOUT the note.
- Bad claim: "Price is 1999" / "2 shrimp"
- Good claim: "Considering 2 shrimp per taco gobernador (recipe plan)."
- Bad rawSpan: "a monthly of 1999 pesos"
- Good rawSpan: product/topic + number + what the number is (fee, size grade, unit cost, qty…)

RULES:
1. Extract concrete claims: numbers, sizes/grades (e.g. 16/20 shrimp), prices, unit costs,
   recipe qty, metrics, policies, decisions, identity, hard constraints, and ACTIVE PLANS
   with numbers ("thinking of changing…", "plan to put…", "it will cost…").
2. Skip pure emotion/motivation with no number or policy, and empty process chatter.
3. If a number appears but you cannot say WHAT it is for, omit it — no hollow triples.
4. polarity:
   - measurement: observed / sold / measured / POS / "today we…"
   - decision: "I decided", "we will" as committed, "we no longer allow", live policy
   - estimate: "around", "I think ~", approximate current belief
   - plan: considering / thinking of / maybe / plan to / "it will cost" under a proposal (NOT live truth yet)
   - hypothesis: possible explanation
   - constraint: hard limit (no alcohol license, closed Tuesdays, etc.)
   - identity: stable person/business identity (name, location, role)
5. entity: specific dish/product/business (taco gobernador, Costa Coral, Buffet Básico…).
6. attribute: specific role — NEVER bare "price"/"cost"/"amount":
   good: shrimp_size_grade, shrimp_unit_cost_mxn, shrimp_quantity_per_taco,
   subscription_price_monthly, buffet.basico_price, daily_sales, tiktok.ROAS
7. valueText/valueNum/unit hold the quantity; claim holds the full meaning.
   Size grades like "16/20" → valueText "16/20", valueNum omit if not a single number.
8. If a note says "was X now Y", emit TWO facts (old + new), each with a full claim.
9. Currency is usually MXN. ROAS as multiplier (10x → valueNum 10, unit "x").
10. Max 15 facts per chunk. Prefer COMPLETE coverage of concrete signals over under-extraction.
    Do not invent facts. Do not drop a clear number/size/cost/qty to "keep it short".
11. If nothing extractable with clear meaning, return facts: [].

EXAMPLES:

Note: "I decided the health worker system will be a monthly of 1999 pesos"
→ ONE fact:
  claim: "Decided the Health worker system product subscription price is 1,999 MXN per month."
  entity: "Health worker system", attribute: "subscription_price_monthly",
  valueText: "1999", unit: "MXN", polarity: decision

Note: "today we sold $8737"
→ claim: "Costa Coral sold 8,737 MXN today."
  entity: "Costa Coral", attribute: "daily_sales", valueText: "8737", unit: "MXN", polarity: measurement

Note: "currently thinking on changing the shrimp size of taco gobernador, to a size called 16/20. it will cost 4.4 mxn per shrimp and we plan to put 2 shrimp in each taco"
→ THREE facts (all polarity plan):
  1) claim: "Considering changing taco gobernador shrimp size grade to 16/20."
     entity: "taco gobernador", attribute: "shrimp_size_grade", valueText: "16/20", unit: null
  2) claim: "Planned unit cost for taco gobernador shrimp is 4.4 MXN per shrimp (under size 16/20 proposal)."
     entity: "taco gobernador", attribute: "shrimp_unit_cost_mxn", valueText: "4.4", valueNum: 4.4, unit: "MXN"
  3) claim: "Planned recipe for taco gobernador uses 2 shrimp per taco."
     entity: "taco gobernador", attribute: "shrimp_quantity_per_taco", valueText: "2", valueNum: 2, unit: "shrimp"

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
  'size',
  'quantity',
  'qty',
])

function isHollowAttribute(attribute: string): boolean {
  const a = attribute.toLowerCase().replace(/\s+/g, '_')
  return HOLLOW_ATTRIBUTES.has(a)
}

function claimLooksMeaningful(claim: string, valueText: string, entity: string): boolean {
  if (claim.length < 24) return false
  const lower = claim.toLowerCase()
  if (/^(price|amount|value|cost|it|this|size|quantity)\s+(is|=)\s+/i.test(claim)) return false
  const entityToken = entity.split(/\s+/).find((t) => t.length >= 4)?.toLowerCase()
  const mentionsEntity = entityToken ? lower.includes(entityToken) : true
  const normalizedValue = valueText.toLowerCase().replace(/,/g, '')
  const mentionsValue = valueText
    ? lower.includes(normalizedValue) || lower.includes(valueText.toLowerCase())
    : true
  // Role words that make a short operational claim usable without the full note
  const hasRole =
    /(per month|monthly|buffet|roas|sold|sales|subscription|price of|fee|spend|cogs|taco|guest|staff|rent|ads?|shrimp|size|grade|unit cost|per shrimp|recipe|plan|considering|thinking)\b/i.test(
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

  // Upgrade hollow attributes when claim/span has enough meaning
  if (isHollowAttribute(attribute)) {
    const blob = `${claim} ${rawSpan} ${entity}`
    if (/month|mensual|subscription|suscrip/i.test(blob)) {
      attribute = 'subscription_price_monthly'
    } else if (/unit cost|per shrimp|por camar[oó]n|each shrimp/i.test(blob)) {
      attribute = 'unit_cost'
    } else if (/\bsize\b|grade|16\/20|21\/25|u\/?\d/i.test(blob)) {
      attribute = 'size_grade'
    } else if (/per taco|quantity|qty|pieces? per|piezas/i.test(blob)) {
      attribute = 'quantity_per_unit'
    } else if (/buffet|b[aá]sico|premium/i.test(blob)) {
      attribute = 'menu_price'
    } else {
      // Still hollow and no upgrade path — reject rather than store garbage
      if (!claimLooksMeaningful(claim, valueText, entity)) return null
      attribute = 'value_unspecified'
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
      'You extract complete operational facts. If a note has multiple numbers/sizes/costs/quantities, emit multiple facts — never drop signal to stay short. Every fact needs a full standalone claim. Reply with one JSON object only.',
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
