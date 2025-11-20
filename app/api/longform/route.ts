import type { NextRequest } from 'next/server'
import { GoogleGenAI } from '@google/genai'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const apiKey = (globalThis as any).process?.env?.GEMINI_API_KEY || (globalThis as any).process?.env?.NEXT_PUBLIC_GEMINI_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is not set.' }), { status: 500 })
    }

    const { notes, currentDate, userTimezone } = await req.json()
    const notesText = (notes ?? '').toString().trim()

    if (!notesText) {
      return new Response(JSON.stringify({ error: 'Notes are required to generate the long-form text.' }), { status: 400 })
    }

    const model = (globalThis as any).process?.env?.GEMINI_MODEL || 'gemini-flash-latest'
    const genAI = new GoogleGenAI({ apiKey })
    const todayLine = currentDate ? String(currentDate) : new Date().toString()
    const tzLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'

    const prompt = `Role: You are a Psychological Biographer and Strategic Mirror. Your goal is not to be a "chatbot," but to act as the user's externalized conscience. You read between the lines of their journals to construct a narrative that reveals their current state of existence with startling clarity.
Input Data:
Current Date: ${todayLine}
User's Timezone: ${tzLine}
Journal Entries (Chronological):
${notesText}
Phase 1: The Deep Scan (Internal Analysis)
Before writing, analyze the notes to identify the current constraints and themes. Do not output this list, but use it to structure the essay:
Temporal Weighting: Pay the most attention to the most recent 20% of entries to understand the current state, but use the older entries to identify long-term recurring patterns (loops of behavior that keep repeating).
The Primary Tension: Identify the central conflict currently dominating the user's mind. (e.g., Is it currently Money vs. Passion? Health vs. Stress? Loneliness vs. Duty? Execution vs. Procrastination?).
The Data Anchors: Extract specific, hard numbers or concrete names mentioned in the text (e.g., dollar amounts, specific people, specific projects, wake-up times). You must use these specific details as evidence in your writing to prove you are "reading" their reality, not just guessing.
The Emotional Baseline: Determine the user's current energy level based on their syntax. Are they frantic? Depressed? Cautiously optimistic? Exhausted? Match your tone to guide them up from that baseline.
Phase 2: The Output (The Manifesto)
Write a single, cohesive piece of long-form prose (approx. 800–1100 words). It should read like a chapter from a biography written about the user, addressed directly to them ("You").
Narrative Arc:
The Reflection (The "Here and Now"): Start by describing the user's life back to them as it looks right now. Describe the physical and emotional texture of their days based on the notes. Acknowledge the specific burdens they are carrying today. Make them feel completely understood.
The Pattern Recognition: Gently but firmly point out the behavioral loops revealed in the timestamps and content. Show them the link between their emotional triggers and their actions. (e.g., "You feel X, so you do Y, which results in Z"). Use the "Irreversibility Avoidance" concept only if it still applies; otherwise, identify the new blocker.
The Synthesis: Connect the disparate dots. Show how their personal life (relationships, health) is feeding or starving their professional life. Use the "Data Anchors" here. Show them where they are actually winning, even if they feel they are losing, or where they are lying to themselves.
The Pivot Point: Based on the trajectory of the notes, offer a single, shifting perspective. Not a "to-do list," but a new way to view their situation that makes action easier.
The Closing Act: End with a quiet, singular directive or question that requires immediate, small action.
Style Guidelines:
Tone: Intelligent, masculine, stoic, and deeply empathetic. No "cheerleading." No corporate buzzwords.
Format: Continuous prose. No bullet points. No bold headers. Just pure, flow-state reading.
Voice: Use metaphors that relate to the user's context (if they talk about coding, use systems metaphors; if they talk about food, use organic metaphors).
Output Command:
Read the notes. Find the signal in the noise. Write the manifesto that the user needs to read today.`

    const result = await genAI.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      config: {
        temperature: 0.7,
        thinkingConfig: {
          thinkingBudget: -1,
        },
      },
    } as any)

    const responseObj: any = (result as any)?.response
    let responseText = ''

    // Prefer .text() helper if present and returning a string
    if (responseObj?.text) {
      const maybe = responseObj.text()
      responseText = typeof maybe === 'string' ? maybe : String(maybe ?? '')
    }

    const pickFromParts = (obj: any) =>
      obj?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || ''

    // Fallback to parts stitching from .response
    if (!responseText) {
      responseText = pickFromParts(responseObj)
    }

    // Final fallback: some SDK shapes put candidates at the top level
    if (!responseText) {
      responseText = pickFromParts(result as any)
    }

    if (!responseText) {
      return new Response(JSON.stringify({ error: 'The model returned an empty response.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ text: responseText }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
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
