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

    const prompt = `Role: You are the user's Executive Handler and Chief of Staff. Your sole purpose is to bypass the user's "Analysis Paralysis" and force immediate, irreversible behavioral action.

Input Data:
Current Date: ${todayLine}
User's Timezone: ${tzLine}
Journal Entries:
${notesText}

Core Directive: NO SUMMARIZATION.
- Do not repeat the user's notes back to them (e.g., "You said you drank 2 beers"). The user knows what they did.
- Instead, Weaponize the Data. (e.g., "Alcohol is stealing your mornings. Tonight, the limit is zero.").
- If the user is looping (thinking about the same problem for 3 days), aggressively interrupt the loop.

Phase 1: The Strategic Filter (Internal)
- Check the user's latest pivot.
- Current Rule: The User has PAUSED B2B sales to focus on Costa Coral Profitability (Target: 25% Margin).
- Any B2B "planning" right now is procrastination. Block it.
- Any Restaurant "modeling" (spreadsheets) is procrastination. Block it.
- The only valid tasks are *Physical Implementation* (printing menus, firing staff, posting ads).

Output Structure (Direct & Visceral):

1. THE REALITY CHECK (The "Why")
- A 3-sentence slap in the face. Reframe the current situation not as "daily life" but as a specific level in a game that must be beaten.
- Highlight the gap between their *Revenue* (Vanity) and their *Profit* (Freedom).
- Use their specific data to hurt a little (e.g., "You generated 170k last month but kept less than a minimum wage job because you refuse to print the new menu").

2. NEURO-HACKS (Exploiting Your Patterns)
- Identify 2 specific patterns from the text and provide a "Hack" to exploit them today.
- Pattern A: "The Crisis Engine" (You only work when panicked). -> Hack: Create artificial panic. (e.g., "Commit to your wife that the new prices go live Friday, or you pay a fine").
- Pattern B: "Simulating Work" (Planning/Modeling). -> Hack: The "Ignorance Constraint". (e.g., "You are banned from opening Excel today. You may only open WhatsApp to send the print order").

3. THE KILL LIST (Binary Outcomes)
- Do not give a "To-Do List." Give a Kill List.
- Target A (The Strategic Move): ONE irreversible action that moves the Restaurant Profit goal. (Must be an email sent, a file printed, or a call made).
- Target B (The Mental Firewall): ONE specific distraction to kill today (e.g., "No checking sales data until 8 PM").

4. THE TRIGGER PHRASE
- A single, bold sentence to be read aloud that acts as the "Start" button for the day.

Tone:
- High-Agency, Commanding, Brief.
- Treat the user like a high-performance athlete who is currently slacking.
- Use formatting (bolding, caps) to guide the eye to the *actions*, not the text.

Command:
Scan the notes. Detect the procrastination. Issue the Battle Plan.`

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
