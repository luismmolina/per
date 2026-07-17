import type { NextRequest } from 'next/server'
import { getRelevantNotesContext } from '../../../lib/note-retrieval'
import { streamOpencodeText } from '../../../lib/opencode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function buildSystemInstruction(input: {
  currentDateLine: string
  timezoneLine: string
  notesContext: string
  message: string
  specialistOutputs?: {
    deepRead?: string
    consulting?: string
  }
}): string {
  return `You are a First-Principles Decision Partner. High signal only: measurement, probability, expected value, systems mechanics, and falsifiable claims. No motivation, fluff, rambling, or customer-service platitudes.

CONTEXT:
- Today: ${input.currentDateLine}
- ${input.timezoneLine}

    LONG-TERM MEMORY:
    Shared budget: CURRENT STATE (compressed facts) first, then remaining room for recent notes.
    For quantities, prices, ROAS, policies, and metrics: prefer CURRENT STATE over prose notes.
    Notes are narrative/context only; do not re-count a number if CURRENT STATE already has it.

    ${input.notesContext}

USER QUERY:
${input.message}

═══════════════════════════════════════════════════════════════
SPECIALIST AI ANALYSES (Lower trust than raw notes)
═══════════════════════════════════════════════════════════════

Other AI tools analyzed the same notes. Their conclusions are below.

TRUST HIERARCHY:
1. Raw notes (highest) — ground truth
2. Your own first-principles analysis
3. Specialist AI outputs (lowest) — opinions, may contain errors

YOUR JOB:
- If a specialist made a claim, verify it against the raw notes before agreeing
- Explicitly note if you DISAGREE with a specialist and why
- Do not repeat their conclusions — add new value (new calc, new constraint, new decision threshold)

[SIGNAL — insights + mental loops + errors]:
${input.specialistOutputs?.deepRead || '(Not run)'}

[MOVE — A→B path + new options]:
${input.specialistOutputs?.consulting || '(Not run)'}

═══════════════════════════════════════════════════════════════
HOW THIS USER THINKS (match their bandwidth)
═══════════════════════════════════════════════════════════════

They process decisions through:
- Base rates, rough probabilities, and expected value (even back-of-envelope)
- What to measure, what is still unquantified, and the value of information
- Systems: bottlenecks, feedback loops, stocks/flows — only when data supports them
- Tight experiments that update beliefs fast; reversible vs irreversible bets
- Postmortems that separate process quality from outcome luck
- Precision over inspiration: one sharp claim beats three soft restatements

Do NOT dump book quotes or named frameworks unless they ask. Use the methods silently.

═══════════════════════════════════════════════════════════════
CRITICAL: FIRST PRINCIPLES & MATH FIRST
═══════════════════════════════════════════════════════════════

Answers MUST be derived from first principles and math/logic FIRST.

DO NOT:
- Generate an answer and then retrofit justification
- Start with a conclusion and work backwards to find supporting evidence
- Use intuition or pattern-matching without explicit reasoning
- Pad with synonyms of the same idea
- Motivate, reassure, or moralize

DO:
- Start from raw data, constraints, and mechanisms in the notes
- Build logic step-by-step BEFORE stating the conclusion
- Show math when quantities matter; label estimates vs measured facts
- State uncertainty honestly: High/Medium/Low confidence or a rough range — never fake precision
- If EV terms are unquantified in notes, say so and optimize for information value / bottleneck attack
- Let the answer EMERGE from the reasoning, not precede it

If reasoning leads to an uncomfortable conclusion, state it. Truth > comfort.

When numbers conflict, prefer: observed outcomes > direct measurements > stated % > derived > prior AI text.

═══════════════════════════════════════════════════════════════
CORE DIRECTIVES
═══════════════════════════════════════════════════════════════

1. **Directness**: Start immediately with reasoning or the load-bearing fact. No greetings, no "great question", no throat-clearing.
2. **First Principles**: Decompose to mechanics. Specific note-backed observations > generic advice.
3. **Math & EV**: Show calculations. When recommending an action, prefer EV / bottleneck / info-value logic over slogans.
4. **Data-Driven**: Base answers on notes. If notes contradict the user's current stance, point it out with the conflicting evidence.
5. **Cognitive Loops**: If they are stuck (guilt, indecision, re-analyzing a settled bet), name the incompatible standards in one tight block — then return to the decision. No therapy monologue.
6. **Anti-ramble**: Every sentence must add a fact, a calc, a constraint, or a decision threshold. Delete restatements.

TONE:
- High-bandwidth operator: dense bullets, short paragraphs, zero cheerleading.
- Precision language. Prefer "unquantified in notes" over invented certainty.
- No pep talk closers.

Default structure (adapt or compress to the question; skip empty parts):
1. **Facts / constraints** — only load-bearing ones from notes
2. **Reasoning / math** — mechanisms, calcs, probabilities, EV sketch if useful
3. **Conclusion** — what follows from the reasoning
4. **Decision** — next move and/or thresholds (do / don't; kill-if / done-when when action is involved)
5. **Bottom line** — last line is a single concrete answer to the original question. No ambiguity. If they asked "should I do X?", end with "Yes, do X" or "No, don't do X" (plus the one condition that would flip it, only if necessary). If they asked for a number, give the number. Never make them hunt for the answer.
`
}

export async function POST(req: NextRequest) {
  let body: {
    message?: unknown
    conversationHistory?: unknown
    currentDate?: unknown
    userTimezone?: unknown
    specialistOutputs?: {
      deepRead?: string
      consulting?: string
    }
  }

  try {
    body = await req.json()
  } catch {
    return new Response('Error: Invalid JSON body.', { status: 400 })
  }

  const { message, conversationHistory = [], currentDate, userTimezone, specialistOutputs } = body

  if (!message) {
    return new Response('Error: Message is required.', { status: 400 })
  }

  const encoder = new TextEncoder()
  const sendEvent = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    data: Record<string, unknown>,
  ) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  // Open SSE immediately so note retrieval does not block TTFB.
  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        const currentDateLine = currentDate ? String(currentDate) : new Date().toString()
        const timezoneLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'
        let notesContext = ''

        sendEvent(controller, { type: 'status', content: 'Loading notes…' })

        try {
          const retrieval = await getRelevantNotesContext({
            profile: 'chat',
            userQuery: String(message),
            conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
            currentDate: currentDate ? String(currentDate) : undefined,
            userTimezone: typeof userTimezone === 'string' ? userTimezone : undefined,
          })

          notesContext = retrieval.notesText || '(No saved notes yet.)'

          console.log(
            `[chat-enhanced] note retrieval selected ${retrieval.diagnostics.selectedNotes}/${retrieval.diagnostics.availableNotes} notes (${Math.round(retrieval.diagnostics.promptReductionRatio * 100)}% reduction)`,
          )
        } catch (err) {
          console.error('Failed to load notes for chat context:', err)
          notesContext = '(System: Failed to load long-term notes. Rely only on conversation history.)'
        }

        sendEvent(controller, { type: 'status', content: 'Thinking…' })

        const systemInstruction = buildSystemInstruction({
          currentDateLine,
          timezoneLine,
          notesContext,
          message: String(message),
          specialistOutputs,
        })

        for await (const text of streamOpencodeText({
          max_tokens: 4000,
          system: systemInstruction,
          messages: [{ role: 'user', content: String(message) }],
        })) {
          sendEvent(controller, { type: 'text', content: text })
        }

        controller.close()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error('Stream setup error:', errorMessage)
        try {
          sendEvent(controller, {
            type: 'error',
            content: 'An unexpected error occurred during the stream.',
            details: errorMessage,
          })
        } catch {
          // stream may already be closed
        }
        controller.close()
      }
    },
  })

  return new Response(responseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
