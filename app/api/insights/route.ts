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

        const { currentDate, userTimezone } = await req.json()

        // Always fetch all notes from storage
        let notesText = ''
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
                    return `[${date}] ${m.content}`
                })
                .join('\n')

            if (fetchedNotes) {
                notesText = fetchedNotes
            }
        } catch (storageError) {
            console.error('Failed to fetch notes from storage:', storageError)
            return new Response(JSON.stringify({ error: 'Failed to retrieve notes from storage.' }), { status: 500 })
        }

        if (!notesText) {
            return new Response(JSON.stringify({ error: 'No notes found to generate insights.' }), { status: 400 })
        }

        const openai = new OpenAI({
            apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
        })

        const todayLine = currentDate ? String(currentDate) : new Date().toString()
        const tzLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'

        const prompt = `You are INSIGHT EXTRACTOR.

Your job is to identify 4 CORE INSIGHTS from this person's notes — recurring patterns, past breakthroughs, or lessons learned that they should be constantly reminded of.

═══════════════════════════════════════════════════════════════
WHAT MAKES A GOOD INSIGHT
═══════════════════════════════════════════════════════════════

A good insight is:
1. PROVEN BY THEIR OWN EXPERIENCE — They tried something and it worked, or they keep making the same mistake
2. RECURRING — It appears multiple times in their notes (pattern recognition)
3. ACTIONABLE — It can be applied today, not just abstract wisdom
4. PERSONAL — Specific to their situation, not generic advice

Examples of good insights:
- "TikTok ads work — you documented 10x ROAS and 40% of customers from TikTok"
- "Sleeping late destroys your next day — you've noted this 15+ times"
- "Imperfect action beats perfect planning — you procrastinate on 'perfect' solutions"

Examples of BAD insights:
- "Work-life balance is important" (generic)
- "You should exercise more" (not from their notes)
- "Remember to be patient" (not actionable)

═══════════════════════════════════════════════════════════════
YOUR PROCESS
═══════════════════════════════════════════════════════════════

1. Read through ALL the notes carefully
2. Look for:
   - Things they tried that WORKED (and might forget to keep doing)
   - Mistakes they keep REPEATING (patterns of self-sabotage)
   - Truths they DISCOVERED about themselves
   - Fears or doubts that proved UNFOUNDED
3. Select the 4 most powerful, recurring, actionable insights
4. For each insight, cite specific evidence from their notes

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON
═══════════════════════════════════════════════════════════════

Return ONLY valid JSON in this exact format (no markdown, no code blocks, no extra text):

{
  "insights": [
    {
      "emoji": "🔥",
      "title": "Short punchy title (max 6 words)",
      "summary": "One sentence explaining the insight",
      "evidence": "Quoted evidence or specific examples from their notes"
    },
    {
      "emoji": "🌙",
      "title": "...",
      "summary": "...",
      "evidence": "..."
    },
    {
      "emoji": "📱",
      "title": "...",
      "summary": "...",
      "evidence": "..."
    },
    {
      "emoji": "⚙️",
      "title": "...",
      "summary": "...",
      "evidence": "..."
    }
  ]
}

Choose emojis that match the topic (🔥 for action, 🌙 for sleep, 💰 for money, 📱 for tech, ⚙️ for systems, 🎯 for focus, etc.)

═══════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════

1. ONLY 4 INSIGHTS — No more, no less
2. EVIDENCE REQUIRED — Each insight must have specific evidence from the notes
3. NO GENERIC ADVICE — Everything must come from their documented experience
4. TIGHT WRITING — Keep it punchy. These are reminders, not essays.
5. RETURN ONLY JSON — No explanation, no markdown, just the JSON object

INPUT:
Current Date: ${todayLine}
User's Timezone: ${tzLine}

Notes:
${notesText}`

        const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-preview'

        const response = await openai.chat.completions.create({
            model,
            messages: [
                { role: 'user', content: prompt }
            ],
            temperature: 0.5,
            max_tokens: 2000,
        })

        const content = response.choices[0]?.message?.content || ''

        // Try to parse as JSON
        try {
            // Clean the response - remove markdown code blocks if present
            let cleanedContent = content.trim()
            if (cleanedContent.startsWith('```json')) {
                cleanedContent = cleanedContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
            } else if (cleanedContent.startsWith('```')) {
                cleanedContent = cleanedContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
            }

            const parsed = JSON.parse(cleanedContent)
            return new Response(JSON.stringify(parsed), {
                headers: { 'Content-Type': 'application/json' }
            })
        } catch (parseError) {
            console.error('Failed to parse insights JSON:', parseError)
            return new Response(JSON.stringify({
                error: 'Failed to parse insights response',
                raw: content
            }), { status: 500 })
        }
    } catch (error) {
        console.error('Insights generation error:', error)
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
