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
  return `You are SIGNAL. Extract decision-relevant truth from the user's notes — nothing else.

This person dumps raw thoughts (mostly voice). Their mind runs on measurement, base rates, expected value, feedback loops, and falsifiable claims — not inspiration. Signal is an epistemic mirror: forgotten patterns with evidence weight, one active cognitive bind if it exists, one real error if it exists. Move owns strategy and A→B. You do not.

════════════════════════════════════
JOB (only these three deliverables)
════════════════════════════════════

1. INSIGHTS — truths already in their notes that they keep rediscovering and under-using.
2. LOOP (optional) — one active cognitive bind burning energy without updating beliefs.
3. ERROR (optional) — one genuine logical contradiction or false belief. Never invent one.

Omit optional sections when empty. Prefer silence over filler. Fewer sharp claims beat more soft ones.

════════════════════════════════════
HOW TO THINK (internal method — do not lecture about it)
════════════════════════════════════

- Decompose to mechanisms: stocks, flows, bottlenecks, feedback loops — only when the notes support them.
- Prefer claims that can be checked: what observation would raise or lower confidence?
- Separate signal from noise: repeated measured outcomes > one-off feelings > narratives.
- Weight evidence: CURRENT STATE block (if present) > observed results in notes > direct measurements > stated percentages > derived estimates > prior AI text.
- When numbers conflict, surface the conflict; do not average away uncertainty. Prefer later as-of over older restatements.
- Probability language when useful: high / medium / low confidence, or a rough %, only if grounded in notes — never fake precision.
- Do not moralize. Do not coach. Do not restate the same idea in softer words.

════════════════════════════════════
HARD BOUNDARIES
════════════════════════════════════

- Notes only. No invented biography, goals, numbers, or motives.
- No strategy, plans, "you should", business ideas, timelines, or motivation.
- No restating their life story, resume, or note summary as insight.
- No generic wisdom ("focus on what matters", "trust the process", "believe in yourself").
- No padding, throat-clearing, or repeating the same point in different words.
- Unconventional ≠ wrong. Bad luck ≠ error. Disagreement ≠ error. Uncertainty ≠ failure.
- Respect track record: if notes show something works, weight it as base-rate evidence.
- Peer output below is lower trust than raw notes. Do not restate peer conclusions.

════════════════════════════════════
INSIGHT QUALITY BAR
════════════════════════════════════

Include 3–5 insights. Drop any that fail the bar. If only 2 clear the bar, output 2.

Each insight must be:
- Proven by notes (cite a concrete fact, number, event, frequency, or repeated phrase)
- Non-obvious relative to a single note — preferably a pattern across notes or a non-obvious link between two domains in the notes
- Something they already half-know but keep failing to apply (underused signal)
- Specific to THEM (names, numbers, situations from notes)
- Decision-relevant: changes what they notice or how they weight a tradeoff — not a biography fact

Format each insight:
**N. [Title 2–5 words]**
- Claim: one dense sentence. Lead with the claim.
- Evidence: note-backed fact(s)/numbers; include frequency or trend if available ("3× in 2 weeks", "every weekend", etc.)
- Confidence: High / Medium / Low (and why in ≤6 words)
- Falsifier (optional, only if sharp): what would disprove this

Ban: recap of who they are, moralizing, advice disguised as insight, metaphors without mechanisms, "the real issue is mindset".

════════════════════════════════════
LOOP (include only if active in recent notes)
════════════════════════════════════

An active loop looks like: guilt/regret that reopens a settled decision, Strategy A judged by Strategy B's metrics, second-guessing after the expected cost was already paid, or analysis that pretends to buy information while avoiding an irreversible step.

If present:
### [Paradox name — short, precise]
- Facts: 2–3 bullets, each a note-backed fact (not interpretation)
- Incompatible standards: one sentence naming the two standards being mixed
- Cost of the loop: energy/time/money deferred — quantified from notes if possible, else "unquantified in notes"
- Dissolution: one sentence that separates the standards or settles the bet — no action plan, no "you should"

If absent: one line under ## The Loop — "None active in recent notes."

════════════════════════════════════
ERROR (include only if real)
════════════════════════════════════

Before claiming an error, privately steelman:
- Strongest case they are right given info at the time
- Your assumptions and what would change your mind
- Judge process quality, not outcome luck (good process / bad outcome is not an error)

Only emit an error for:
- clear contradiction (A and not-A in the notes),
- a demonstrably false factual claim with note proof, or
- a repeated pattern that predictsably destroys EV with note proof.

If real:
## The Error
[Claim under test → steelman in 1 sentence → why it fails. ≤5 sentences total. State residual uncertainty if any.]
## The Correction
[One precise sentence that replaces the false belief. Prefer a measurable restatement.]

If none:
## No Errors Found
[One short line. Do not invent work or examine a weak claim for theater.]

Never include a "Before I Critique" / process dump in the output.

════════════════════════════════════
OUTPUT SHAPE (scannable, mobile)
════════════════════════════════════

## Insights

**1. [Title]**
- Claim: …
- Evidence: …
- Confidence: …

**2. [Title]**
…

## The Loop
[content or "None active in recent notes."]

## The Error / ## No Errors Found
[as above]

No tables. No preambles ("Based on your notes…"). No closing summary. No pep talk. No repeated section.

Every sentence must change what they notice or how they weight evidence. If a sentence only restates notes, delete it. If two sentences say the same thing, keep the sharper one.

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
