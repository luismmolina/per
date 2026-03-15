import type { NextRequest } from 'next/server'
import OpenAI from 'openai'

import type { ExploreResult } from '../../../lib/explore'
import {
  extractMessageContent,
  normalizeExploreResult,
  parseExploreModelJson,
} from '../../../lib/explore-response'
import { getRelevantNotesContext } from '../../../lib/note-retrieval'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_OBJECTIVE_CHARS = 240
const MAX_PEER_OUTPUT_CHARS = 8000

function clipPromptText(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.length <= maxChars) {
    return trimmed
  }

  return `${trimmed.slice(0, maxChars).trim()}\n...[truncated]`
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is not set.' }), { status: 500 })
    }

    const {
      objective,
      currentDate,
      userTimezone,
      fetchAllNotes,
      peerOutputs,
    } = await req.json()

    const normalizedObjective = clipPromptText(objective, MAX_OBJECTIVE_CHARS) || 'Increase my profit'

    if (!fetchAllNotes) {
      return new Response(JSON.stringify({ error: 'Notes are required to explore new options.' }), { status: 400 })
    }

    let notesText = ''

    try {
      const retrieval = await getRelevantNotesContext({
        profile: 'explore',
        userQuery: normalizedObjective,
        currentDate: currentDate ? String(currentDate) : undefined,
        userTimezone: typeof userTimezone === 'string' ? userTimezone : undefined,
      })

      notesText = retrieval.notesText

      console.log(
        `[explore] note retrieval selected ${retrieval.diagnostics.selectedNotes}/${retrieval.diagnostics.availableNotes} notes (${Math.round(retrieval.diagnostics.promptReductionRatio * 100)}% reduction)`,
      )
    } catch (storageError) {
      console.error('Failed to fetch notes for explore:', storageError)
      return new Response(JSON.stringify({ error: 'Failed to retrieve notes from storage.' }), { status: 500 })
    }

    if (!notesText) {
      return new Response(JSON.stringify({ error: 'Notes are required to generate exploration ideas.' }), { status: 400 })
    }

    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    const todayLine = currentDate ? String(currentDate) : new Date().toString()
    const tzLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'
    const deepReadText = clipPromptText(peerOutputs?.deepRead, MAX_PEER_OUTPUT_CHARS) || '(Not run)'
    const consultingText = clipPromptText(peerOutputs?.consulting, MAX_PEER_OUTPUT_CHARS) || '(Not run)'
    const reframeText = clipPromptText(peerOutputs?.reframe, MAX_PEER_OUTPUT_CHARS) || '(Not run)'

    const prompt = `You are EXPLORE — a novelty-first strategist.

YOUR JOB:
Turn the user's objective into a board of options that are meaningfully different from the ideas already present in their notes.

OBJECTIVE:
${normalizedObjective}

DATE CONTEXT:
- Today: ${todayLine}
- ${tzLine}

TRUST HIERARCHY:
1. Raw notes
2. Your own analysis
3. Peer AI outputs

HARD RULES:
1. Derive facts, numbers, constraints, and prior ideas from the raw notes.
2. Explicitly separate:
   - alreadyThought: ideas the user already proposed or clearly implied
   - adjacentIdeas: evolutions of their thinking
   - newIdeas: materially different options not already present in the notes
3. Do NOT smuggle the user's own ideas into newIdeas.
4. For each new idea, explain exactly why it is different from the notes.
5. Force exploration beyond the dominant themes in the notes. Search across:
   - pricing architecture
   - reservations and prepayment
   - partnerships and external channels
   - groups, offices, hotels, events, and B2B
   - low-labor or no-table revenue
   - idle-capacity monetization
   - packaged / take-home offers
   - recurring revenue or prepaid revenue
6. If an idea sounds clever but clashes with the user's actual constraints, lower its fit score and say why.
7. Every idea needs a 7-day test with concrete steps and a success metric.
8. Keep the output dense, specific, and operational. No motivational language.
9. Return ONLY valid JSON. No markdown. No code fences. No extra commentary.

PEER OUTPUTS:
[DEEP READ]
${deepReadText}

[A TO B CONSULTING]
${consultingText}

[REFRAME]
${reframeText}

JSON SHAPE:
{
  "objective": "string",
  "summary": "2-4 sentence summary of the current situation and where the new angles probably are",
  "realityMap": {
    "currentState": ["string"],
    "constraints": ["string"],
    "alreadyWorking": ["string"],
    "underusedAssets": ["string"]
  },
  "opportunitySpaces": ["string"],
  "alreadyThought": [
    {
      "idea": "string",
      "status": "already yours" | "partially explored" | "tested",
      "evidence": "short note-based evidence"
    }
  ],
  "adjacentIdeas": [
    {
      "title": "string",
      "mechanism": "how the idea makes money or profit",
      "whyNew": "why this is at least somewhat different",
      "whyItCouldWorkHere": "specific fit with the notes",
      "differsFromYourNotes": "what makes it different from what the user already thought",
      "risks": ["string"],
      "noveltyScore": 1-10,
      "fitScore": 1-10,
      "upsideScore": 1-10,
      "speedScore": 1-10,
      "experiment": {
        "name": "string",
        "steps": ["string"],
        "successMetric": "string",
        "successSignal": "string"
      }
    }
  ],
  "newIdeas": [
    {
      "title": "string",
      "mechanism": "how the idea makes money or profit",
      "whyNew": "why this does not appear in the notes",
      "whyItCouldWorkHere": "specific fit with the notes",
      "differsFromYourNotes": "explicit contrast with the user's existing ideas",
      "risks": ["string"],
      "noveltyScore": 1-10,
      "fitScore": 1-10,
      "upsideScore": 1-10,
      "speedScore": 1-10,
      "experiment": {
        "name": "string",
        "steps": ["string"],
        "successMetric": "string",
        "successSignal": "string"
      }
    }
  ],
  "questions": ["question that unlocks more options"]
}

OUTPUT TARGETS:
- 4 to 6 alreadyThought items
- 3 to 5 opportunitySpaces
- 2 to 3 adjacentIdeas
- 3 to 4 newIdeas
- 4 to 6 questions

RAW NOTES:
${notesText}`

    const model = process.env.OPENROUTER_EXPLORE_MODEL || 'z-ai/glm-5'

    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 6000,
    } as any)

    const content = extractMessageContent(response.choices[0]?.message?.content)
    if (!content.trim()) {
      throw new Error('Explore route received an empty response from the model.')
    }

    const parsed = parseExploreModelJson<unknown>(content)
    const result = normalizeExploreResult(parsed, normalizedObjective)

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Explore generation error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
