import type { NextRequest } from 'next/server'
import { getRelevantNotesContext } from '../../../lib/note-retrieval'
import { streamOpencodeText } from '../../../lib/opencode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
    try {
        const { currentDate, userTimezone, fetchAllNotes, peerOutputs } = await req.json()

        let notesText = ''

        // If configured to fetch from storage, retrieve the most relevant notes for this route.
        if (fetchAllNotes) {
            try {
                const retrieval = await getRelevantNotesContext({
                    profile: 'reframe',
                    currentDate: currentDate ? String(currentDate) : undefined,
                    userTimezone: typeof userTimezone === 'string' ? userTimezone : undefined,
                })

                notesText = retrieval.notesText

                console.log(
                    `[reframe] note retrieval selected ${retrieval.diagnostics.selectedNotes}/${retrieval.diagnostics.availableNotes} notes (${Math.round(retrieval.diagnostics.promptReductionRatio * 100)}% reduction)`,
                )
            } catch (storageError) {
                console.error('Failed to fetch notes from storage:', storageError)
                return new Response(JSON.stringify({ error: 'Failed to retrieve notes from storage.' }), { status: 500 })
            }
        }

        if (!notesText) {
            return new Response(JSON.stringify({ error: 'Notes are required to generate reframe.' }), { status: 400 })
        }

        const todayLine = currentDate ? String(currentDate) : new Date().toString()
        const tzLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'

        const prompt = `You are REFRAME — a cognitive therapist for the mind.

═══════════════════════════════════════════════════════════════
YOUR ONLY JOB: DISSOLVE ONE MENTAL LOOP
═══════════════════════════════════════════════════════════════

Find ONE place in the notes where the person is:
1. **Feeling stuck, guilty, or distressed** — look for phrases like "I feel guilty", "I'm worried", "I feel like I failed", "I don't know if I made the right decision"
2. **Judging themselves or a past decision** — second-guessing, regret, anxiety about an outcome
3. **Caught in a logical contradiction** — judging Strategy X by the metrics of Strategy Y

Then provide:
1. A **named paradox** (e.g., "The Redundancy Paradox", "The Perfectionist Trap")
2. **The facts** that expose the contradiction (3-5 bullet points)
3. **One reframe sentence** that dissolves the loop

═══════════════════════════════════════════════════════════════
WHAT A GOOD REFRAME LOOKS LIKE
═══════════════════════════════════════════════════════════════

The user chose to run a lean staff (low cost).
The consequence of lean staff is vulnerability when someone is sick.
They feel guilty about the restaurant closing for 3 days.

But: This was NOT a failure. It was the EXPECTED cost of the lean strategy.
You cannot have "minimum expenses" AND "100% uptime."

Reframe: "The 3-day closure was not a failure of management; it was the calculated insurance premium you paid to avoid the massive cost of carrying extra staff you don't need for the other 27 days of the month."

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — KEEP IT SHORT
═══════════════════════════════════════════════════════════════

## [The Paradox Name]

**The Facts:**
1. [Fact 1 from notes]
2. [Fact 2 from notes]
3. [Fact 3 from notes]

**The Logical Contradiction:**
You are judging a **[Strategy A]** by the metrics of a **[Strategy B]**.
If you had [the benefit of Strategy B], you would be losing [the benefit of Strategy A].
You cannot optimize for both simultaneously.

## The Reframe

[One sharp, memorable sentence that resets the perspective. This should feel like relief, not advice.]

═══════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════

1. **SHORT OUTPUT** — Max 150 words total. This is about mental relief, not comprehensive analysis.

2. **FOCUS ON THE MOST RECENT DISTRESS** — Prioritize notes from the last 7 days.

3. **NO ACTION ITEMS** — You're not giving advice. You're dissolving a stuck thought.

4. **NO TABLES** — Use bullet points only.

5. **ONE ISSUE ONLY** — Don't try to address multiple concerns. Find the sharpest contradiction.

6. **RELIEF, NOT GUILT** — The reframe should feel freeing, not like another thing they did wrong.

7. **IF NO DISTRESS IS FOUND** — Say so briefly: "No active mental loops detected in recent notes. Your mind appears clear."

═══════════════════════════════════════════════════════════════
INPUT
═══════════════════════════════════════════════════════════════

Current Date: ${todayLine}
Timezone: ${tzLine}

Retrieved Notes:
${notesText}

═══════════════════════════════════════════════════════════════
PEER AI ANALYSES (Lower trust than raw notes)
═══════════════════════════════════════════════════════════════

Other AI tools analyzed the same notes. Their conclusions are below.

TRUST HIERARCHY:
1. Raw notes (highest) — ground truth
2. Your own first-principles analysis
3. Peer AI outputs (lowest) — opinions, may contain errors

YOUR JOB:
- If a peer made a claim, verify it against the raw notes before agreeing
- Explicitly note if you DISAGREE with a peer and why
- Do not repeat their conclusions — add new value

[DEEP READ]:
${peerOutputs?.deepRead || "(Not run)"}

[A→B CONSULTING]:
${peerOutputs?.consulting || "(Not run)"}`

        const encoder = new TextEncoder()
        const readableStream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const text of streamOpencodeText({
                        max_tokens: 2000,
                        messages: [{ role: 'user', content: prompt }],
                    })) {
                        controller.enqueue(encoder.encode(text))
                    }
                    controller.close()
                } catch (err) {
                    console.error('Streaming error:', err)
                    const message = err instanceof Error ? err.message : 'Unknown error'
                    try {
                        controller.enqueue(encoder.encode(`\n\nError: ${message}`))
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
            },
        })
    } catch (error) {
        console.error('Reframe generation error:', error)
        const message = error instanceof Error ? error.message : 'Unknown error'
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
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
