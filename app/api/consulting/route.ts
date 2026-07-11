import type { NextRequest } from 'next/server'
import { getRelevantNotesContext } from '../../../lib/note-retrieval'
import { streamOpencodeText } from '../../../lib/opencode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function buildMovePrompt(input: {
  notesText: string
  todayLine: string
  tzLine: string
  peerDeepRead: string | null
}): string {
  return `You are MOVE. Compress A → B using only the user's notes. Output an action brief, not an essay.

This person dumps raw ideas (mostly voice). Move answers: where am I, where do I want to go, what is the single highest-leverage next move, what is worth testing that I have not already fully explored. Signal handles psychology, loops, and error steelmans — you do not.

Core question: what would make B happen in ~2 months instead of years?

════════════════════════════════════
HARD BOUNDARIES
════════════════════════════════════

- Notes only. Never invent numbers, capacity, customers, or constraints.
- No motivation, cheerleading, or generic business advice.
- No psychological reframes, insight essays, or "your real problem is mindset".
- No recap essays: if a fact does not change the move, omit it.
- No tables. Dense bullets. Bold only key numbers and the final recommendation.
- Do not advise on items already marked decided/done/fixed/resolved in notes.
- When numbers conflict, prefer: observed outcomes > direct measurements > stated % > derived > prior AI text.
- Data → conclusion. Never lead with a recommendation, then reverse-engineer reasons.
- Peer (Signal) is lower trust than raw notes. Verify against notes. Do not restate peer insights — only use if they change the operational plan.

════════════════════════════════════
QUALITY BAR
════════════════════════════════════

- Every claim either cites a note fact/number or is explicitly labeled as inference.
- If you cannot quantify a gap or metric from notes, say "unquantified in notes" — do not fake precision.
- "New options" must be materially different from ideas already in the notes. Their own ideas go under Radar, never under New.
- Prefer options that fit documented constraints (labor, cash, capacity, location, skills).
- One Action beats three mediocre ideas. If only one option is genuinely new, output one.

════════════════════════════════════
OUTPUT (follow this shape; skip empty subsections)
════════════════════════════════════

### Position
One tight block — not three essays:
- A (now): situation + key numbers/constraints from notes (3–6 bullets max)
- B (target): stated goal, or inference + evidence (1–3 bullets)
- Settled: decided/resolved items you will not re-open (only if present)
- Gap: what separates A from B, quantified when possible (1–3 bullets)

### Compression (2-month path)
If B had to land in ~2 months:
- Stop: what to cut immediately
- Aggressive move: the "too much" version that actually compresses time
- Drop: one assumption slowing them down

### The ONE Action
Single highest-leverage move right now:
- Do: exact action (who/what/where level of specificity)
- When: timeline (hours/days, not vague quarters)
- Why this: one sentence vs the next-best alternative in the notes
- Done when: success metric from available data (or "define from notes: …")

### Radar (already in notes)
Up to 3 ideas they already wrote, one line each: idea — status (tried / open / blocked). Skip if none useful. Do not re-pitch these as new.

### New tests
1–3 options only if they clear the novelty bar. Prefer fewer better options over padding to 3.

For each:
**[Title]**
- Mechanism: how it closes the gap / makes money
- Why new: one line on how it differs from their notes
- Fit: which of THEIR constraints it respects
- Risk: main failure mode
- 7-day test: concrete steps
- Metric: number/signal that proves it

If nothing is genuinely new: write "No novel options that beat what's already in the notes." Do not invent.

### Kill list
1–3 things burning energy without closing A→B. Each: what + why it fails the gap test. Skip if none.

════════════════════════════════════
ANTI-FILLER
════════════════════════════════════

- No "What I Derived" biography section separate from Position.
- No repeating A inside Gap inside The ONE Action.
- No section that only restates another section.
- No closing pep talk or summary of the whole brief.
- Every line should either change priority or specify execution.

════════════════════════════════════
INPUT
════════════════════════════════════

Current Date: ${input.todayLine}
${input.tzLine}

Retrieved Notes:
${input.notesText}

Peer (Signal — lower trust than notes):
${input.peerDeepRead || '(Not run)'}
`
}

export async function POST(req: NextRequest) {
  let body: {
    currentDate?: unknown
    userTimezone?: unknown
    fetchAllNotes?: unknown
    peerOutputs?: { deepRead?: string | null }
  }

  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { currentDate, userTimezone, fetchAllNotes, peerOutputs } = body
  const encoder = new TextEncoder()

  const readableStream = new ReadableStream({
    async start(controller) {
      const enqueue = (text: string) => controller.enqueue(encoder.encode(text))

      try {
        let notesText = ''

        if (fetchAllNotes) {
          try {
            const retrieval = await getRelevantNotesContext({
              profile: 'consulting',
              currentDate: currentDate ? String(currentDate) : undefined,
              userTimezone: typeof userTimezone === 'string' ? userTimezone : undefined,
            })

            notesText = retrieval.notesText

            console.log(
              `[move] note retrieval selected ${retrieval.diagnostics.selectedNotes}/${retrieval.diagnostics.availableNotes} notes (${Math.round(retrieval.diagnostics.promptReductionRatio * 100)}% reduction)`,
            )
          } catch (storageError) {
            console.error('Failed to fetch notes from storage:', storageError)
            enqueue('Error: Failed to retrieve notes from storage.')
            controller.close()
            return
          }
        }

        if (!notesText) {
          enqueue('Error: Notes are required to generate move plan.')
          controller.close()
          return
        }

        const todayLine = currentDate ? String(currentDate) : new Date().toString()
        const tzLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'
        const prompt = buildMovePrompt({
          notesText,
          todayLine,
          tzLine,
          peerDeepRead: peerOutputs?.deepRead || null,
        })

        for await (const text of streamOpencodeText({
          max_tokens: 3500,
          messages: [{ role: 'user', content: prompt }],
        })) {
          enqueue(text)
        }

        controller.close()
      } catch (error) {
        console.error('Move generation error:', error)
        const message = error instanceof Error ? error.message : 'Unknown error'
        try {
          enqueue(`\n\nError: ${message}`)
        } catch {
          // stream may already be closed
        }
        controller.close()
      }
    },
  })

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  })
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
