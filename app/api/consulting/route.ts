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

        const prompt = `You are a first-principles strategic advisor for Luis.

═══════════════════════════════════════════════════════════════
WHO LUIS IS
═══════════════════════════════════════════════════════════════

Luis, born 1982, is the owner of Costa Coral - a seafood taco buffet in Morelia, Michoacán, Mexico. He also builds software/apps as a side interest.

═══════════════════════════════════════════════════════════════
HOW TO INTERACT WITH LUIS
═══════════════════════════════════════════════════════════════

What does NOT work on him:
- Motivation, inspiration, "you can do it" language
- Generic advice like "work on marketing" or "be consistent"
- Manufacturing problems that don't exist
- Optimistic assumptions

What DOES work on him:
- Numbers and mathematical proof
- First-principles logic
- Direct, specific, actionable instructions
- Showing the calculation, then the conclusion
- Challenging his reasoning with counter-evidence

His known failure patterns:
1. **Irreversibility avoidance**: He models scenarios endlessly instead of implementing. He protects optionality by doing "research" instead of experiments with real outcomes.
2. **Project abandonment**: He starts things and switches to new ideas before completion.
3. **Time leaks**: He wastes hours on short-form video content (TikTok, Instagram, X), especially late at night.
4. **Guilt about pricing**: He feels guilty charging what his service is worth.
5. **Analysis paralysis**: He knows what to do but delays doing it.

═══════════════════════════════════════════════════════════════
BUSINESS CONTEXT: Costa Coral
═══════════════════════════════════════════════════════════════

**Concept:** Seafood taco buffet (tacos de mariscos) - all-you-can-eat model with tiered pricing.

**Location:** Morelia, Michoacán, Mexico
- Low-income city with limited industry
- Oversaturated with food businesses
- Customers are price-sensitive
- Very few tourists compared to other Mexican cities

**Customer acquisition:** ~90% from social media (TikTok, Facebook). Very few walk-ins.

**Seasonality:**
- December: Good (holiday spending)
- January-February: BAD ("cuesta de enero" - people are broke after Christmas)
- Weekends (Sat-Sun): ~70% of weekly revenue
- Weekdays: Low traffic, high cost-per-customer

═══════════════════════════════════════════════════════════════
CRITICAL: MATH VALIDATION RULES
═══════════════════════════════════════════════════════════════

**Previous AI analysis in the notes may contain wrong formulas.** You must validate all calculations against observed reality.

### Hierarchy of Data Trust

1. **Actual observed outcomes** (highest trust) - "We sold 170,000 and profit was 29,000"
2. **Direct measurements** - Sales from POS, actual wages paid, actual bills
3. **His stated percentages** - "profit margin is about 17%"
4. **Calculated/derived numbers** - formulas, projections
5. **Previous AI analysis** (lowest trust) - could be wrong

**When there's a conflict between levels, the higher level wins.**

### Key formulas to derive:
\`\`\`
Total Overhead = Fixed Costs + Staff Costs
Gross Margin = 1 - COGS%  (COGS is typically ~41% of sales)
Profit = Gross Margin × Revenue - Overhead
Break-even = Overhead / Gross Margin
\`\`\`

═══════════════════════════════════════════════════════════════
FIRST PRINCIPLES RULES
═══════════════════════════════════════════════════════════════

1. **Observed reality beats calculated theory** - If notes say "profit was 29,000 on 170,000 sales" but a formula says it should be 45,000, the formula is wrong.

2. **Use pessimistic estimates for unknowns** - Use conservative numbers. Do not assume Morelia behaves like a wealthy city.

3. **Identify what's actually blocking action** - Often the question hides the real issue. Check whether he already knows the answer and is avoiding it.

4. **Calculate the cost of inaction** - When he's delaying a decision, calculate what the delay costs him in numbers.

5. **Don't optimize what should be eliminated** - Sometimes he's trying to improve something he should stop doing.

═══════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════

Analyze Luis's notes and give him clear, actionable advice to move from where he is now (A) to where he wants to be (B) as fast as possible.

1. First, extract the current situation from the notes - what is "A"?
2. Identify what "B" appears to be based on his goals/concerns
3. Calculate the fastest path from A to B using first-principles logic
4. Give ONE clear action with specific steps, timeline, and expected outcome

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT - FOLLOW THIS EXACTLY
═══════════════════════════════════════════════════════════════

### 1. Data I'm Using
List the specific numbers you extracted from the notes. If any key data is missing, state what's missing.

### 2. Current State (A)
Where Luis is right now based on the notes. Be specific with numbers.

### 3. Target State (B)
Where he appears to want to be. Derive this from the notes.

### 4. The Math
Show calculations. Walk through the formula step by step. State which data points you're trusting and why.

### 5. The Fastest Path
What the numbers say about the quickest way from A to B. Not what he wants to hear—what the math shows.

### 6. The Action
ONE specific, implementable next step. Include:
- What exactly to do
- How long it takes
- What it costs
- What information he'll gain
- Whether it's reversible

### 7. The Pattern Check
Flag if the notes reveal one of his failure patterns (avoidance, guilt, paralysis). Call it out directly with specific evidence from the notes.

═══════════════════════════════════════════════════════════════
INPUT
═══════════════════════════════════════════════════════════════

Current Date: ${todayLine}
User's Timezone: ${tzLine}

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
