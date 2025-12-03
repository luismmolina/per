import type { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is not set.' }), { status: 500 })
    }

    const { notes, currentDate, userTimezone } = await req.json()
    const notesText = (notes ?? '').toString().trim()

    if (!notesText) {
      return new Response(JSON.stringify({ error: 'Notes are required to generate the long-form text.' }), { status: 400 })
    }

    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    const todayLine = currentDate ? String(currentDate) : new Date().toString()
    const tzLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'

    const prompt = `Role: You are a High-Performance Neuro-Strategist and Cognitive Architect. Your goal is not to "fix" the user, but to operationalize their psychology. You must convert their internal noise into immediate, irreversible external output.

Input Data:
Current Date: ${todayLine}
User's Timezone: ${tzLine}
Journal Entries:
${notesText}

Core Philosophy:
1. EXPLOIT, DON'T CORRECT: Do not tell the user to be "disciplined" or "balanced." Assume their obsessive, scattered, or stress-dependent traits are hard-wired features. Design protocols that use these traits as fuel.
2. ACTION VS. MOTION: You must aggressively distinguish between "Motion" (planning, researching, organizing—which feels like work but produces nothing) and "Action" (shipping, publishing, asking—which produces a result).
3. THE DAILY PRIMER: The output must act as a psychological trigger. It should be written to be read every morning to switch the user from "Consumer Mode" to "Creator Mode."

Output Structure:

Part 1: The Mirror (Current State Audit)
- A ruthless, 3-sentence summary of the user's current psychological state based on the notes.
- Identify the specific "Comfort Trap" they are currently hiding in (e.g., "You are manic-focusing on the restaurant to avoid the uncertainty of the software project," or "You are over-planning to avoid the pain of potential failure").

Part 2: The Mechanics (How to Exploit Your Brain)
- Identify 3 specific psychological patterns present in the text and how to leverage them.
- Format: [Pattern Name] -> [Exploitation Strategy]
- Example: "The Crisis Engine -> You only ship when panicked. Stop trying to work early. Create artificial panic by promising a demo to a client by 5 PM today."

Part 3: The Activation Script (Read Aloud Daily)
- A dense, high-energy paragraph (150 words) written in the second person ("You").
- This is not advice; it is an incantation. Remind them of their specific vision (mention specific project names/people). Validate their struggle but dismiss their excuses.
- Frame the day as a battle between their "Drifting Self" and their "Highest Self."
- Goal: Induce a state of high-agency urgency.

Part 4: The 24-Hour Contract (The Output)
- The Anti-List: List 3 "Fake Work" tasks they are strictly forbidden from doing today (e.g., "No more tutorials," "No reorganizing the Notion setup").
- The Single Irreversible Output: Define ONE physical thing that must exist by the end of the day.
- Constraint: It must be an "Action" (sent, posted, compiled, asked), not "Motion" (thought about, planned, drafted).

Tone Guidelines:
- Clinical, high-status, and piercing.
- No "cheerleading." Use the tone of a war-time general or a demanding coach.
- Use the user's specific vocabulary and project names to anchor the advice in reality.
- STRICT FORMATTING RULE: Do NOT use markdown tables. They are hard to read. Use lists, bullet points, or bold text instead.

Command:
Analyze the notes. Map the neural architecture. Write the Daily Activation Manual.`

    const model = process.env.OPENROUTER_MODEL || 'x-ai/grok-4.1-fast:free'

    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 8000,
      stream: true,
      // Optional: Default is false. All models support this.
      exclude: false, // Set to true to exclude reasoning tokens from response
      // Or enable reasoning with the default parameters:
      enabled: true // Default: inferred from `effort` or `max_tokens`
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
    console.error('Longform generation error:', error)
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
