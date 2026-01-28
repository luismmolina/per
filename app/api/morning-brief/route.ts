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
            return new Response(JSON.stringify({ error: 'Notes are required to generate the morning brief.' }), { status: 400 })
        }

        const openai = new OpenAI({
            apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
        })

        const todayLine = currentDate ? String(currentDate) : new Date().toString()
        const tzLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'

        // Parse the current time to understand morning context
        const currentTime = new Date(todayLine)
        const hour = currentTime.getHours()
        const dayOfWeek = currentTime.toLocaleDateString('en-US', { weekday: 'long' })

        const prompt = `You are MORNING BRIEF — a 40-minute action accelerator.

═══════════════════════════════════════════════════════════════
YOUR ONLY JOB: CREATE A 3-ITEM ACTION LIST FOR RIGHT NOW
═══════════════════════════════════════════════════════════════

The user has PRECIOUS morning time before their work day starts. Your job is to:
1. Extract what they SHOULD do today based on their notes
2. Prioritize by: What moves them from A to B fastest?
3. Make each action completable in 5-15 minutes
4. Link each action to their personal WHY (from notes)

Current time: ${todayLine}
Day: ${dayOfWeek}
${hour < 12 ? '☀️ This is MORNING time — their most valuable hours.' : hour < 17 ? '⚡ This is MIDDAY — focus on highest impact.' : '🌙 This is EVENING — prepare for tomorrow.'}

═══════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════

1. **3 ACTIONS ONLY** — No more. Each action must be:
   - Specific (not "work on marketing" but "create 1 TikTok hook for Costa Coral")
   - Doable in 5-15 minutes
   - Started RIGHT NOW, not "today" or "this week"

2. **IMPERFECT ACTION** — Remind them: "An imperfect post published beats a perfect post never made"
   - The user has documented they procrastinate when seeking perfection
   - Each action should be the SMALLEST viable step

3. **LINK TO THE WHY** — For each action, include a short reminder of WHY it matters:
   - Pull their goals from the notes (e.g., "30k/month profit", "less stress", "more time with family")
   - Connect the action to the goal in ONE line

4. **ENERGY-AWARE** — If recent notes mention tiredness, sickness, or low energy:
   - Adjust to simpler, lower-effort actions
   - Prioritize rest if they haven't slept

5. **NO MOTIVATION** — Be direct. No cheerleading. Just the list.

═══════════════════════════════════════════════════════════════
EXTRACT FROM NOTES — WHAT MATTERS TODAY
═══════════════════════════════════════════════════════════════

Look for:
- Recent decisions that need implementation
- Tasks they mentioned wanting to do
- Recurring patterns they want to break (e.g., phone time)
- Projects with momentum (e.g., TikTok content, Costa Coral improvements)
- Things that have WORKED before (repeat them)
- Any DEADLINES or time-sensitive items

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — SHORT AND PUNCHY
═══════════════════════════════════════════════════════════════

## ☀️ Your 40-Minute Sprint

**1. [Action title]** (X min)
[Exactly what to do. Specific. No ambiguity.]
→ *Why: [Connection to their goal in 1 line]*

**2. [Action title]** (X min)
[Exactly what to do. Specific. No ambiguity.]
→ *Why: [Connection to their goal in 1 line]*

**3. [Action title]** (X min)
[Exactly what to do. Specific. No ambiguity.]
→ *Why: [Connection to their goal in 1 line]*

---

**After this sprint:** [One sentence on what comes next OR permission to rest if they've earned it]

═══════════════════════════════════════════════════════════════
HARD RULES
═══════════════════════════════════════════════════════════════

- **MAX 150 WORDS TOTAL** — This should fit on one phone screen
- **NO EXPLANATIONS** — Just the actions
- **NO TABLES** — Use the format above exactly
- **START WITH THE HIGHEST-LEVERAGE ACTION** — The thing that moves them most toward B
- **IF IT'S VERY EARLY MORNING** — Include "drink coffee" or similar ritual if relevant

═══════════════════════════════════════════════════════════════
INPUT
═══════════════════════════════════════════════════════════════

Current Date: ${todayLine}
Timezone: ${tzLine}

Notes:
${notesText}`

        // Use the grok-4.1-fast model as requested
        const model = 'moonshotai/kimi-k2.5'

        const stream = await openai.chat.completions.create({
            model,
            messages: [
                { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 1000,
            stream: true,
        })

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
        console.error('Morning Brief generation error:', error)
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
