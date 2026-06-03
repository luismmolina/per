import type { NextRequest } from 'next/server'
import { getRelevantNotesContext } from '../../../lib/note-retrieval'
import { getOpencodeClient, getOpencodeModel } from '../../../lib/opencode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
    try {
        const client = getOpencodeClient()

        const { currentDate, userTimezone, fetchAllNotes, peerOutputs } = await req.json()

        let notesText = ''

        // If configured to fetch from storage, retrieve the most relevant notes for this route.
        if (fetchAllNotes) {
            try {
                const retrieval = await getRelevantNotesContext({
                    profile: 'consulting',
                    currentDate: currentDate ? String(currentDate) : undefined,
                    userTimezone: typeof userTimezone === 'string' ? userTimezone : undefined,
                })

                notesText = retrieval.notesText

                console.log(
                    `[consulting] note retrieval selected ${retrieval.diagnostics.selectedNotes}/${retrieval.diagnostics.availableNotes} notes (${Math.round(retrieval.diagnostics.promptReductionRatio * 100)}% reduction)`,
                )
            } catch (storageError) {
                console.error('Failed to fetch notes from storage:', storageError)
                return new Response(JSON.stringify({ error: 'Failed to retrieve notes from storage.' }), { status: 500 })
            }
        }

        if (!notesText) {
            return new Response(JSON.stringify({ error: 'Notes are required to generate consulting advice.' }), { status: 400 })
        }

        const todayLine = currentDate ? String(currentDate) : new Date().toString()
        const tzLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'

        const prompt = `You are a first-principles strategic advisor.

═══════════════════════════════════════════════════════════════
YOUR ONLY JOB: MOVE THE USER FROM A TO B
═══════════════════════════════════════════════════════════════

**A** = Where the user is RIGHT NOW (derive from notes: income, constraints, situation)
**B** = Where the user wants to be (derive from notes: stated goals, or infer from frustrations)

Everything you do serves ONE purpose: compress the timeline from A to B.

Ask yourself: "What would it take to reach B in 2 MONTHS instead of 2 years?"

═══════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════

1. **DERIVE ALL CONTEXT FROM THE NOTES** — You have NO pre-programmed knowledge of this person. Extract who they are, what they do, their situation, constraints, and goals entirely from what they wrote.

2. **TRACK RESOLVED VS ACTIVE** — Before analyzing, catalog:
   - What's ALREADY DECIDED/SOLVED (look for: "I decided", "done", "fixed", "resolved")
   - What's STILL ACTIVE (no documented resolution)
   - **Do NOT advise on solved problems.**

3. **FIRST PRINCIPLES** — Start with data, build up to conclusions. Do not start with a recommendation and justify it backwards.

4. **DATA HIERARCHY** — When numbers conflict:
   - Actual observed outcomes (highest trust)
   - Direct measurements
   - Stated percentages
   - Calculated/derived numbers
   - Previous AI analysis (lowest trust)

5. **NO GENERIC ADVICE** — Be specific. Calculate. Show the math. If you can't quantify it, don't say it.

6. **NO MOTIVATION** — No inspiration, no "you can do it", no cheerleading.

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════

### 1. What I Derived From Your Notes
- Who you are / what you do
- Key numbers (income, profit, constraints)
- What's already decided (will NOT advise on these)

### 2. A — Where You Are Now
Current state with specific numbers.

### 3. B — Where You Want to Be
Target state. If not explicit, state your inference and evidence.

### 4. The Gap
What separates A from B? Quantify it.

### 5. The 2-Month Version
If you HAD to reach B in 2 months instead of 2 years:
- What would you stop immediately?
- What would you do that feels "too aggressive"?
- What assumption would you have to drop?

### 6. The ONE Action
Single highest-leverage move. Include:
- What exactly to do
- Timeline
- Why this one over alternatives

═══════════════════════════════════════════════════════════════
FORMAT RULES
═══════════════════════════════════════════════════════════════

- NO markdown tables (render poorly on mobile)
- Use bullet points and headers
- Keep it short and scannable
- Bold key numbers and conclusions

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

[REFRAME]:
${peerOutputs?.reframe || "(Not run)"}`

        const model = getOpencodeModel()

        const stream = client.messages.stream({
            model,
            max_tokens: 16000,
            messages: [{ role: 'user', content: prompt }],
        })

        const readableStream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder()
                stream.on('text', (text) => {
                    controller.enqueue(encoder.encode(text))
                })
                stream.on('end', () => {
                    controller.close()
                })
                stream.on('error', (err) => {
                    console.error('Streaming error:', err)
                    controller.error(err)
                })
            },
        })

        return new Response(readableStream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Transfer-Encoding': 'chunked',
            },
        })
    } catch (error) {
        console.error('Consulting generation error:', error)
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
