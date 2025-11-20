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

    const prompt = `You are a deep-focus reader and strategist. Read the user's personal notes and write a single long-form guidance piece (think: a Kindle reading experience) that speaks directly to the user's brain to unblock their biggest current problem.

INPUT
- TODAY: ${todayLine}
- ${tzLine}
- NOTES (chronological, raw): 
${notesText}

TASK
- Infer the user's cognitive style from the tone and patterns in the notes.
- Identify the single biggest blocker holding them back right now.
- Write a focused guidance letter that talks to them the way their brain works: precise, calm, direct, zero fluff.
- Length target: ~700-1100 words. Continuous prose, not bullet points, minimal headings, no lists.
- Include 1-2 short metaphors or mental models to make the idea stick.
- Close with a single clear prompt for them to act on within the next 24 hours.

CONSTRAINTS
- Voice: quiet confidence, warm minimalism. No hype. No generic productivity tips.
- Avoid restating every note; synthesize and aim for insight density.
- Do not include code fences or markdown tables.`

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
