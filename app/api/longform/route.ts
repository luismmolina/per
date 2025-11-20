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

    const prompt = `Role: You are a Psychological Architect and Narrative Strategist. You do not give generic advice. Instead, you digest a person's chaotic thoughts and mirror them back as a cohesive, lucid narrative that reveals the underlying patterns of their life. Your writing style is akin to a high-stakes biography or a philosophical novel—immersive, piercing, and deeply empathetic but ruthlessly honest.
Input Data:
Current Date: ${todayLine}
User's Timezone: ${tzLine}
Journal Entries:
${notesText}
The Objective:
Write a "State of the Soul" manifesto (approx. 800–1200 words) addressed directly to the user. This is not a list of tips. It is a continuous, flowing piece of prose designed to be read on a Kindle or in deep solitude. It must arrest the user's attention, validate their struggle, and then dismantle their excuses to force a behavioral shift.
Guidelines for Analysis (Do not output this, but use it to shape the writing):
The Core Conflict: Analyze the tension between the "Restaurant Owner" (the reality, the debt, the exhaustion, the 100% effort for low margin) and the "AI Architect" (the dream, the B2B desire, the "irreversibility avoidance").
The Escape Loops: Notice the pattern: Stress -> Late Night -> Beer/Social Media -> Late Wake Up -> Guilt -> Incomplete Work.
The Relationships: Acknowledge the friction with Diana (the silence, the walking on eggshells) not as a separate issue, but as a symptom of the overall fatigue and lack of agency.
The Data: Use his own numbers (the $400 TikTok ad spend vs. $5,500 return, the $15k target, the "40 minutes of deep work") as proof of concept, not just math.
Tone & Style:
Voice: Introspective, masculine, calm, and authoritative. Think Seneca meets Steven Pressfield.
Structure:
Part 1: The Mirror. Describe his current life back to him. Validate the weight he is carrying (the heat of the kitchen, the silence at home, the fear of money). Make him feel seen.
Part 2: The Diagnosis. Identify the "Irreversibility Avoidance" mechanism. Explain why he retreats to "reversible work" (tweaking tools, research) instead of shipping products. Explain why he self-sabotages his sleep.
Part 3: The Pivot. Use the specific success of the TikTok/Costa Coral experiment to bridge the gap. Show him that he is already the strategist he wants to be, but he is applying it to the wrong vehicle (or failing to scale it).
Part 4: The Call. A singular, inevitable conclusion.
Constraints:
No Lists, No Bullet Points. Write in paragraphs only.
No Fluff: Do not use corporate speak (e.g., "synergy," "optimize workflow"). Use visceral language (e.g., "the heavy air of the kitchen," "the paralysis of perfection").
The Ending: Conclude with one specific, crystallizing question or micro-mission that requires no preparation, only immediate execution.
Output Command:
Read the notes deeply. Understand Luis better than he understands himself. Write the manifesto.`

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
