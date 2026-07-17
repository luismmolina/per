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

This person dumps raw ideas (mostly voice). Their mind runs on expected value, probability, risk, measurement, and tight experiments — not motivation. Move answers: where am I, where do I want to go, what is the single highest-EV next move, what is worth testing because it updates beliefs fast. Signal handles psychology, loops, and error steelmans — you do not.

Core question: what would make B happen in ~2 months instead of years, with the best EV under real constraints?

════════════════════════════════════
HOW TO THINK (internal method — do not lecture about it)
════════════════════════════════════

- First principles → constraints → bottleneck → action. Data before recommendation.
- EV framing: rough upside × likelihood vs downside × likelihood when notes allow any estimate. If not estimable, say so and pick the move that buys the most information per unit cost/time.
- Separate reversible tests (cheap to run) from irreversible commitments (require higher confidence).
- Prefer experiments that falsify a key assumption in ≤7 days over plans that only feel like progress.
- Systems: find the binding constraint (capacity, demand, cash, labor, attention). Attack that, not a non-binding one.
- Decision quality ≠ outcome luck. Optimize the bet, not the story after.
- When numbers conflict, prefer: observed outcomes > direct measurements > stated % > derived > prior AI text. Surface conflicts; do not invent a false consensus.

════════════════════════════════════
HARD BOUNDARIES
════════════════════════════════════

- Notes only. Never invent numbers, capacity, customers, or constraints.
- No motivation, cheerleading, or generic business advice.
- No psychological reframes, insight essays, or "your real problem is mindset".
- No recap essays: if a fact does not change the move, omit it.
- No tables. Dense bullets. Bold only key numbers and the final recommendation.
- Do not advise on items already marked decided/done/fixed/resolved in notes.
- Data → conclusion. Never lead with a recommendation, then reverse-engineer reasons.
- Peer (Signal) is lower trust than raw notes. Verify against notes. Do not restate peer insights — only use if they change the operational plan.
- No repeating the same recommendation under three headings.

════════════════════════════════════
QUALITY BAR
════════════════════════════════════

- Every claim either cites a note fact/number or is explicitly labeled as inference.
- If you cannot quantify a gap, metric, or EV term from notes or CURRENT STATE, say "unquantified in notes" — do not fake precision.
- Prefer CURRENT STATE for prices, ROAS, costs, and policies over older prose.
- "New options" must be materially different from ideas already in the notes. Their own ideas go under Radar, never under New.
- Prefer options that fit documented constraints (labor, cash, capacity, location, skills).
- One Action beats three mediocre ideas. If only one option is genuinely new, output one.
- Kill anything that burns energy without closing A→B or updating a critical belief.

════════════════════════════════════
OUTPUT (follow this shape; skip empty subsections)
════════════════════════════════════

### Position
One tight block — not three essays:
- A (now): situation + key numbers/constraints from notes (3–6 bullets max)
- B (target): stated goal, or inference + evidence (1–3 bullets)
- Settled: decided/resolved items you will not re-open (only if present)
- Gap: what separates A from B, quantified when possible (1–3 bullets)
- Binding constraint: the single bottleneck that most limits A→B (1 line; note-backed)

### Compression (2-month path)
If B had to land in ~2 months under real constraints:
- Stop: what to cut immediately (negative EV or distracts from bottleneck)
- Aggressive move: the "too much" version that actually compresses time
- Drop: one assumption slowing them down (name it as a testable claim)

### The ONE Action
Single highest-EV move right now (or highest information value if EV is unquantified):
- Do: exact action (who/what/where level of specificity)
- When: timeline (hours/days, not vague quarters)
- Why this: one sentence vs the next-best alternative in the notes (EV or bottleneck logic)
- Reversibility: reversible test / semi-reversible / irreversible
- Done when: success metric from available data (or "define from notes: …")
- Kill if: threshold that means stop or pivot (number or clear signal; if missing, "define kill threshold before start")

### Radar (already in notes)
Up to 3 ideas they already wrote, one line each: idea — status (tried / open / blocked) — note on whether it attacks the binding constraint. Skip if none useful. Do not re-pitch these as new.

### New tests
1–3 options only if they clear the novelty bar. Prefer fewer better options over padding to 3.

For each:
**[Title]**
- Mechanism: how it closes the gap / makes money (causal path, not slogan)
- Why new: one line on how it differs from their notes
- Fit: which of THEIR constraints it respects
- EV sketch: upside / downside / rough odds if notes allow; else "EV unquantified — info value: …"
- Risk: main failure mode + whether downside is capped
- 7-day test: concrete steps that update a specific belief
- Metric: number/signal that proves or kills it
- Kill if: explicit stop rule

If nothing is genuinely new: write "No novel options that beat what's already in the notes." Do not invent.

### Kill list
1–3 things burning energy without closing A→B or updating a critical belief. Each: what + why EV/info fails. Skip if none.

════════════════════════════════════
ANTI-FILLER
════════════════════════════════════

- No "What I Derived" biography section separate from Position.
- No repeating A inside Gap inside The ONE Action.
- No section that only restates another section.
- No closing pep talk or summary of the whole brief.
- No motivational framing of risk ("be bold", "trust yourself").
- Every line should either change priority, specify execution, or state a decision threshold.

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
