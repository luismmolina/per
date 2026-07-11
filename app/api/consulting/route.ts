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
  return `You are MOVE — compress the path from A to B using only the user's notes.

This person dumps raw ideas (mostly voice). They do NOT want four AI tools.
They want ONE high-signal action brief:
1. Where they are (A) and where they want to be (B)
2. The single highest-leverage move
3. A few options they have NOT already fully explored — with short tests

Do NOT do deep psychological reframes, long insight essays, or steelman error analysis. That is a different tool (Signal).
Do NOT motivate. Do NOT invent numbers not in the notes.

═══════════════════════════════════════════════════════════════
YOUR ONLY JOB: MOVE THEM FROM A TO B — FASTER
═══════════════════════════════════════════════════════════════

**A** = where they are RIGHT NOW (derive from notes: income, constraints, situation)
**B** = where they want to be (stated goals, or carefully inferred from frustrations)

Everything serves ONE purpose: compress timeline from A to B.

Ask: "What would it take to reach B in 2 MONTHS instead of 2 years?"

═══════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════

1. **DERIVE ALL CONTEXT FROM THE NOTES** — no pre-programmed knowledge of this person.

2. **TRACK RESOLVED VS ACTIVE**
   - Already decided/solved: "I decided", "done", "fixed", "resolved" → do NOT advise on these
   - Still active: no documented resolution

3. **FIRST PRINCIPLES** — data → conclusions. Never recommendation first.

4. **DATA HIERARCHY** when numbers conflict:
   - Actual observed outcomes (highest)
   - Direct measurements
   - Stated percentages
   - Calculated/derived
   - Previous AI analysis (lowest)

5. **NO GENERIC ADVICE** — specific, quantified, note-backed. If you can't quantify, don't say it.

6. **NOVELTY FILTER for options**
   - Explicitly separate what they ALREADY thought from what is NEW
   - Do NOT smuggle their own ideas into "new options"
   - Every new option needs a 7-day test and a success metric
   - Prefer options that fit documented constraints (labor, cash, capacity, location)

7. **NO MOTIVATION** — no cheerleading.

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — SCANNABLE. DENSE. NO TABLES.
═══════════════════════════════════════════════════════════════

### 1. What I Derived
- Who / what they do
- Key numbers (income, profit, constraints)
- Already decided (will NOT advise on these)

### 2. A — Now
Current state with specific numbers from notes.

### 3. B — Target
Target state. If inferred, state the inference and the evidence.

### 4. The Gap
What separates A from B? Quantify.

### 5. The 2-Month Version
If B had to happen in 2 months:
- Stop immediately:
- Do that feels "too aggressive":
- Assumption to drop:

### 6. The ONE Action
Single highest-leverage move:
- Exactly what to do
- Timeline
- Why this over alternatives

### 7. Already On Your Radar
3–5 ideas already in their notes (so they don't re-invent them). One line each with status if known.

### 8. New Options Worth Testing
Exactly 3 options that are materially different from the notes.
For each:

**[Title]**
- Mechanism: how it makes money / closes the gap
- Why new: how this differs from what they already wrote
- Fit: why it could work given THEIR constraints
- Risk: main risk
- 7-day test: concrete steps
- Success metric: what number/signal proves it

### 9. Kill List
1–3 things to stop or deprioritize that are burning energy without closing A→B.

═══════════════════════════════════════════════════════════════
FORMAT RULES
═══════════════════════════════════════════════════════════════

- NO markdown tables
- Bullets + headers
- Bold key numbers and conclusions
- Short paragraphs
- Maximize signal per word

═══════════════════════════════════════════════════════════════
INPUT
═══════════════════════════════════════════════════════════════

Current Date: ${input.todayLine}
${input.tzLine}

Retrieved Notes:
${input.notesText}

═══════════════════════════════════════════════════════════════
PEER AI (lower trust than raw notes)
═══════════════════════════════════════════════════════════════

[SIGNAL — insight/reframe peer]:
${input.peerDeepRead || '(Not run)'}

Trust hierarchy: raw notes > your analysis > peer output.
Verify peer claims against notes. Disagree when warranted. Do not repeat peer conclusions — add operational value.
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
