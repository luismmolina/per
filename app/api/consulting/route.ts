import type { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { loadConversations } from '../../../lib/storage'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
    try {
        const apiKey = process.env.OPENROUTER_API_KEY
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is not set.' }), { status: 500 })
        }

        const { currentDate, userTimezone, fetchAllNotes } = await req.json()

        let notesText = ''

        // If configured to fetch from storage, retrieve all notes
        if (fetchAllNotes) {
            try {
                const conversations = await loadConversations()
                const messages = conversations?.messages || []

                const fetchedNotes = messages
                    .filter((m: any) => m.type === 'note')
                    .map((m: any) => {
                        const date = new Date(m.timestamp).toLocaleString('en-US', {
                            weekday: 'short',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                            timeZoneName: 'short'
                        })
                        return `[${date}] (note) ${m.content}`
                    })
                    .join('\n')

                if (fetchedNotes) {
                    notesText = fetchedNotes
                }
            } catch (storageError) {
                console.error('Failed to fetch notes from storage:', storageError)
                return new Response(JSON.stringify({ error: 'Failed to retrieve notes from storage.' }), { status: 500 })
            }
        }

        if (!notesText) {
            return new Response(JSON.stringify({ error: 'Notes are required to generate consulting advice.' }), { status: 400 })
        }

        const openai = new OpenAI({
            apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
        })

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

Notes:
${notesText}`

        const model = process.env.OPENROUTER_MODEL || 'google/gemini-3-pro-preview'

        const stream = await openai.chat.completions.create({
            model,
            messages: [
                { role: 'user', content: prompt }
            ],
            temperature: 0.6,
            max_tokens: 16000,
            stream: true,
            reasoning: {
                effort: 'high'
            }
        } as any) as any

        // Create a readable stream from the OpenAI stream
        const readableStream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder()
                try {
                    for await (const chunk of stream) {
                        const content = chunk.choices[0]?.delta?.content || ''
                        if (content) {
                            controller.enqueue(encoder.encode(content))
                        }
                    }
                    controller.close()
                } catch (err) {
                    console.error('Streaming error:', err)
                    controller.error(err)
                }
            }
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
