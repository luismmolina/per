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

    const prompt = `Role: You are a Strategic Psychologist and Performance Architect. Your goal is to align the user's daily actions with their *latest* stated strategy (not old ones), while providing a deep read on the psychological blockers preventing execution.

Input Data:
Current Date: ${todayLine}
User's Timezone: ${tzLine}
Journal Entries:
${notesText}

Phase 1: The Strategic Audit (Internal Logic Check)
Before generating output, scan the notes chronologically to determine the CURRENT Focus Phase.
- Rule 1: Respect the Pivot. If the user says "I am putting Project X on hold to focus on Project Y," do NOT suggest tasks for Project X.
- [cite_start]Rule 2: Look for the specific line: "Currently I have put on hold the idea of exploring B2B business". 
- [cite_start]Rule 3: Acknowledge the current mission: "Focus on improving the profit of Costa Coral... to prove the solution I sell."[cite: 400, 405].

Output Structure:

Part 1: The Strategic Anchor
- State the user's Current Primary Mission based strictly on the latest notes.
- [cite_start]Validate the logic: Explain *why* this focus is strategically sound based on the user's data (e.g., "You cannot sell a 'Growth System' to others until you have successfully installed it in your own business to prove the concept" ).

Part 2: The Neural Schematic (The Deep Read)
- Identify 3 psychological patterns driving behavior *right now*.
- [cite_start]Must include "The Crisis Engine": Explain that the user only executes under duress (e.g., low sales panic drives TikTok wins [cite: 254]). Explain how to manufacture this pressure artificially.
- [cite_start]Must include "Irreversibility Avoidance": Identify where the user is "Modeling" (spreadsheets, pricing ladders, staff calculations) to avoid "Executing" (actually raising the price or changing the staff roster)[cite: 220].
- [cite_start]The Dopamine Drift: Address the morning phone usage [cite: 333] as a primary leak of executive function.

Part 3: The Activation Script (Read Aloud Daily)
- A 150-word paragraph in the Second Person ("You").
- Tone: Urgent, high-stakes, "War-Time CEO."
- Narrative: Frame the restaurant not as a "job" but as the "Prototype." If the Prototype fails, the B2B dream dies. If the Prototype hits 25% profit, the B2B dream unlocks.
- [cite_start]Use specific numbers from the notes (e.g., "You are stuck at 17% profit; you need 25%." [cite: 315]).

Part 4: The 24-Hour Contract
- The Anti-List: 3 specific "fake work" tasks to avoid today (e.g., "No more modeling the 169 vs 219 price ladder—the math is done").
- The Single Irreversible Output: Define ONE physical task that moves the *Restaurant Turnaround* forward.
- Constraint: It must be an action that creates external feedback (e.g., "Print the new menu," "Post the vacancy," "Launch the ad"), not internal thought.

Tone Guidelines:
- Clinical, Insightful, and Directive. 
- No fluff. No toxic positivity.
- Cite the user's notes to prove you are listening (e.g., "As you noted on 27/11...").

Command:
Perform the Strategic Audit. Construct the Deep Read. Write the Daily Manual.`

    const model = process.env.OPENROUTER_MODEL || 'google/gemini-3-pro-preview'

    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 12000,
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
