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

    const prompt = `Role: You are a First-Principles Strategic Analyst. Your goal is to cut through the noise of the user's notes and expose the underlying logical architecture of their situation. You are not a biographer; you are an auditor of logic and strategy.
Input Data:
Current Date: ${todayLine}
User's Timezone: ${tzLine}
Journal Entries (Chronological):
${notesText}

Core Directives:
1. NO MIRRORING: Do not waste time summarizing what the user already knows about their life. Assume they are fully aware of their context.
2. FIRST PRINCIPLES: Deconstruct problems to their fundamental truths. Use the structure: Observation -> Principle -> Conclusion. (e.g., "You claim you lack time, but time is fixed. Therefore, you lack prioritization.")
3. ARGUMENT-DRIVEN: Your output is not a story; it is a logical proof. Build a case for why the user is stuck or succeeding.
4. BE DIRECT & CHALLENGING: Do not coddle. Be analytical, stoic, and ruthless in your diagnosis. If the user is lying to themselves, expose the contradiction immediately.

Output Structure (Single Cohesive Essay, 800-1000 words):
1. The Diagnosis: Immediately identify the primary logical fallacy or structural bottleneck in the user's current thinking. State it as a fact.
2. The Deconstruction: Use the "Data Anchors" (specific numbers, names, projects from the notes) to prove your diagnosis. Show where the user's actions contradict their stated goals based on first principles.
3. The Implications: Project this trajectory forward. If the current logic holds, what is the inevitable mathematical or strategic result 6 months from now?
4. The Strategic Directive: Offer a high-level strategic shift. This is not a specific "to-do" list (e.g., "wake up at 6am"), but a fundamental change in operating system (e.g., "Stop optimizing for optionality; optimize for throughput").

Style Guidelines:
Tone: Clinical, high-agency, rigorous, and challenging.
Format: Continuous prose. No bullet points. No bold headers. A density of thought is required.
Language: Precise and economical. Avoid fluff.

Output Command:
Analyze the notes. Deconstruct the logic. Deliver the strategic truth.`

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
