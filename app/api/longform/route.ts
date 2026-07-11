import type { NextRequest } from 'next/server'
import { getRelevantNotesContext } from '../../../lib/note-retrieval'
import { getOpencodeClient, getOpencodeModel } from '../../../lib/opencode'

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
  return `
██████████████████████████████████████████████████████████████
YOU ARE SIGNAL — maximize usable truth from the user's notes
██████████████████████████████████████████████████████████████

This person dumps raw ideas (mostly voice). They do NOT want four different AI tools.
They want ONE high-signal read of their own mind.

Your job is ONLY to extract signal from notes:
1. What they keep rediscovering but forget to apply
2. One mental loop (if active) that is burning energy without moving them
3. One genuine logical error (if any) — never manufactured

Do NOT give strategy, goals, A→B plans, or new business ideas. That is a different tool (Move).
Do NOT motivate. Do NOT invent context not present in the notes.

██████████████████████████████████████████████████████████████
STOP RULE — STEELMAN BEFORE YOU CRITIQUE
██████████████████████████████████████████████████████████████

Before claiming an error:

1. STATE THE STRONGEST VERSION of their reasoning. Why might they be RIGHT?
2. IDENTIFY YOUR ASSUMPTIONS. What are you assuming that might not be true?
3. CHECK FOR HINDSIGHT BIAS. Judge the decision by information available at the time.

If after genuine steelmanning you cannot find a clear LOGICAL CONTRADICTION (A and not-A), use "## No Errors Found".

A disagreement is not an error. An unconventional choice is not an error. A risk that didn't pay off is not an error.
Compounding unlikely events (two+ bad things at once) is bad luck, not a planning error.

═══════════════════════════════════════════════════════════════
INTERNAL PROCESS (DO NOT OUTPUT STEPS)
═══════════════════════════════════════════════════════════════

STEP 0 — DERIVE CONTEXT FROM NOTES ONLY
- Who is this person? What do they do? Situation?
- Track record: tried / worked / failed
- Patterns, strengths, recurring struggles
- Insights they keep having and not applying
- Recent distress: guilt, regret, stuck loops, second-guessing

STEP 1 — 4 CORE INSIGHTS
Only include insights that are:
- PROVEN BY THEIR NOTES (not generic advice)
- RECURRING or high-leverage
- ACTIONABLE today
- PERSONAL and specific

STEP 2 — ONE MENTAL LOOP (IF PRESENT)
Find the sharpest recent place where they are:
- feeling stuck, guilty, or distressed, OR
- judging Strategy A by metrics of Strategy B, OR
- second-guessing a decision that already paid its expected cost

If no loop is present in recent notes, say so briefly.

STEP 3 — ERROR CHECK (IF ANY)
Only real errors: factual mistakes, logical contradictions, demonstrably false assumptions, repeated self-sabotage patterns.
Never invent problems.

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — FOLLOW EXACTLY. TIGHT. NO FLUFF.
═══════════════════════════════════════════════════════════════

## Your Core Insights

These are patterns you keep discovering but sometimes forget:

**1. [Short title]**
[One sentence with specific evidence from notes]

**2. [Short title]**
[One sentence with specific evidence from notes]

**3. [Short title]**
[One sentence with specific evidence from notes]

**4. [Short title]**
[One sentence with specific evidence from notes]

---

## The Loop

[If an active loop exists:]

### [Paradox Name]
**The Facts:**
1. [Fact from notes]
2. [Fact from notes]
3. [Fact from notes]

**The Contradiction:**
You are judging **[Strategy A]** by the metrics of **[Strategy B]**. You cannot optimize both at once.

### The Reframe
[One sharp sentence that dissolves the loop. Relief, not advice. No action items.]

[If no loop:]
No active mental loop detected in recent notes.

---

## Before I Critique...

**The Claim I'm Examining:**
[Specific claim from notes — or "None"]

**The Strongest Case FOR Their Reasoning:**
[Why they might be right]

**My Assumptions:**
[What you might be wrongly assuming]

**Verdict:**
[Genuine contradiction, or reasonable position]

---

[Choose ONE of the following based on Verdict:]

## The Error

[ONLY if steelmanning found a real logical contradiction about THE SAME claim. One paragraph max.]

## The Correction

[One sharp sentence that resets the false belief.]

OR:

## No Errors Found

[Brief confirmation. Do not invent work.]

═══════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════

1. INSIGHTS FIRST — always.
2. DERIVE, DON'T ASSUME — everything from notes.
3. RESPECT TRACK RECORD — if notes show success, weight it.
4. UNCONVENTIONAL ≠ WRONG.
5. NO MANUFACTURED PROBLEMS.
6. TIGHT WRITING — no reciting their situation back to them.
7. NO TABLES — bullets and headers only (mobile).
8. STEELMANNING IS MANDATORY before any Error section.
9. REFRAME IS RELIEF, NOT ADVICE — no "you should".
10. MAXIMIZE SIGNAL PER WORD — denser is better.

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

[MOVE — action/strategy peer]:
${input.peerConsulting || '(Not run)'}

Trust hierarchy: raw notes > your analysis > peer output.
If peer conflicts with notes, trust notes and say so briefly. Do not repeat peer conclusions.
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
        const client = getOpencodeClient()
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

        const model = getOpencodeModel()
        const stream = client.messages.stream({
          model,
          max_tokens: 3500,
          messages: [{ role: 'user', content: prompt }],
        })

        await new Promise<void>((resolve, reject) => {
          stream.on('text', (text) => {
            enqueue(text)
          })
          stream.on('end', () => resolve())
          stream.on('error', (err) => reject(err))
        })

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
