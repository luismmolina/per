import type { NextRequest } from 'next/server'
import { getRelevantNotesContext } from '../../../lib/note-retrieval'
import { streamOpencodeText } from '../../../lib/opencode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Hobby fluid compute allows up to 300s; only transcribe was configured before.
export const maxDuration = 300

function buildSignalPrompt(input: {
  notesText: string
  todayLine: string
  tzLine: string
  peerConsulting: string | null
}): string {
  return `You are SIGNAL. Extract usable truth from the user's notes — nothing else.

This person dumps raw thoughts (mostly voice). Signal is a mirror: forgotten patterns, one active mental loop if it exists, one real error if it exists. Move handles strategy and A→B. You do not.

════════════════════════════════════
JOB (only these three deliverables)
════════════════════════════════════

1. INSIGHTS — truths already in their notes that they keep rediscovering and under-using.
2. LOOP (optional) — one active cognitive bind burning energy without progress.
3. ERROR (optional) — one genuine logical contradiction or false belief. Never invent one.

Omit optional sections when empty. Prefer silence over filler.

════════════════════════════════════
HARD BOUNDARIES
════════════════════════════════════

- Notes only. No invented biography, goals, numbers, or motives.
- No strategy, plans, "you should", business ideas, timelines, or motivation.
- No restating their life story, resume, or note summary as insight.
- No generic wisdom ("focus on what matters", "trust the process").
- No padding, throat-clearing, or repeating the same point in different words.
- Unconventional ≠ wrong. Bad luck ≠ error. Disagreement ≠ error.
- Respect track record: if notes show something works, weight it.
- Peer output below is lower trust than raw notes. Do not restate peer conclusions.

════════════════════════════════════
INSIGHT QUALITY BAR
════════════════════════════════════

Include 3–5 insights. Drop any that fail the bar.

Each insight must be:
- Proven by notes (cite a concrete fact, number, event, or repeated phrase)
- Non-obvious relative to a single note — preferably a pattern across notes
- Something they already half-know but keep forgetting to apply
- Specific to THEM (names, numbers, situations from notes)

Title: 2–5 words. Body: 1–2 dense sentences max. Lead with the claim, then the evidence.

Ban: recap of who they are, moralizing, advice disguised as insight.

════════════════════════════════════
LOOP (include only if active in recent notes)
════════════════════════════════════

An active loop looks like: guilt/regret that reopens a settled decision, Strategy A judged by Strategy B's metrics, or second-guessing after the expected cost was already paid.

If present:
### [Paradox name]
- Facts: 2–3 bullets, each a note-backed fact (not interpretation)
- Bind: one sentence naming the incompatible standards
- Reframe: one sentence of relief that dissolves the bind — no action items, no "you should"

If absent: one line under ## The Loop — "None active in recent notes."

════════════════════════════════════
ERROR (include only if real)
════════════════════════════════════

Before claiming an error, privately steelman:
- Strongest case they are right
- Your assumptions
- Judge with info available at the time (no hindsight)

Only emit an error for a clear contradiction (A and not-A), a demonstrably false factual claim in the notes, or a repeated self-sabotage pattern with note proof.

If real:
## The Error
[Claim under test + why the steelman fails. ≤5 sentences.]
## The Correction
[One sentence that resets the false belief.]

If none:
## No Errors Found
[One short line. Do not invent work or examine a weak claim for theater.]

Never include a "Before I Critique" / process dump in the output.

════════════════════════════════════
OUTPUT SHAPE (scannable, mobile)
════════════════════════════════════

## Insights

**1. [Title]**
[1–2 sentences]

**2. [Title]**
...

## The Loop
[content or "None active in recent notes."]

## The Error / ## No Errors Found
[as above]

No tables. No preambles ("Based on your notes…"). No closing summary. No repeated section.

Every sentence must change what they notice. If a sentence only restates notes, delete it.

════════════════════════════════════
INPUT
════════════════════════════════════

Current Date: ${input.todayLine}
${input.tzLine}

Retrieved Notes:
${input.notesText}

Peer (Move — lower trust than notes):
${input.peerConsulting || '(Not run)'}
`
}

export async function POST(req: NextRequest) {
  let body: {
    notes?: unknown
    currentDate?: unknown
    userTimezone?: unknown
    fetchAllNotes?: unknown
    peerOutputs?: { consulting?: string | null }
  }

  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { notes, currentDate, userTimezone, fetchAllNotes, peerOutputs } = body
  const encoder = new TextEncoder()

  // Return the stream immediately so TTFB is not blocked by note load / model setup.
  const readableStream = new ReadableStream({
    async start(controller) {
      const enqueue = (text: string) => controller.enqueue(encoder.encode(text))

      try {
        let notesText = (notes ?? '').toString().trim()

        if (fetchAllNotes) {
          try {
            const retrieval = await getRelevantNotesContext({
              profile: 'longform',
              currentDate: currentDate ? String(currentDate) : undefined,
              userTimezone: typeof userTimezone === 'string' ? userTimezone : undefined,
            })

            notesText = retrieval.notesText

            console.log(
              `[signal] note retrieval selected ${retrieval.diagnostics.selectedNotes}/${retrieval.diagnostics.availableNotes} notes (${Math.round(retrieval.diagnostics.promptReductionRatio * 100)}% reduction)`,
            )
          } catch (storageError) {
            console.error('Failed to fetch notes from storage:', storageError)
            if (!notesText) {
              enqueue('Error: Failed to retrieve notes from storage.')
              controller.close()
              return
            }
          }
        }

        if (!notesText) {
          enqueue('Error: Notes are required to generate signal.')
          controller.close()
          return
        }

        const todayLine = currentDate ? String(currentDate) : new Date().toString()
        const tzLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'
        const prompt = buildSignalPrompt({
          notesText,
          todayLine,
          tzLine,
          peerConsulting: peerOutputs?.consulting || null,
        })

        for await (const text of streamOpencodeText({
          max_tokens: 3500,
          messages: [{ role: 'user', content: prompt }],
        })) {
          enqueue(text)
        }

        controller.close()
      } catch (error) {
        console.error('Signal generation error:', error)
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
