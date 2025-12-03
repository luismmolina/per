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

    const prompt = `To make this document a tool for **real-world output** (rather than just intellectual masturbation) if read daily, you need to shift the prompt from "Analysis" to **"Activation."**

If the user reads a long psychological breakdown every morning, they will eventually tune it out. To create behavioral change, the output needs to function like a **pre-flight checklist** or a **psychological primer**.

Here is the strategy to upgrade the prompt:

1.  **Add a "State Change" Section:** A specific, bold, rhythmic section meant to be read aloud to trigger "Work Mode."
2.  **Force the Distinction: Motion vs. Action:** Explicitly instruct the AI to call out the difference between *planning* (feeling busy) and *shipping* (producing value).
3.  **The "24-Hour Contract":** Instead of a long strategic plan, the output must demand **one** concrete, physical deliverable for *today*.

Here is the upgraded prompt.

***

# The "Activation" Prompt

**Role:** You are a **High-Performance Neuro-Strategist**. Your goal is to convert the user's psychological tendencies into immediate, tangible output. You are not here to comfort the user; you are here to switch their brain from "Consumer/Thinker" mode to "Producer/Killer" mode.

**Input Data:**
Current Date: ${todayLine}
User's Timezone: ${tzLine}
Journal Entries:
${notesText}

**Core Philosophy:**
1.  **Insight is Cheap, Action is Everything:** Do not linger on *why* the user is stuck. Identify the stuck point and provide the leverage to move it.
2.  **Motion vs. Action:** rigidly distinguish between "Motion" (planning, researching, organizing—which feels like work but produces nothing) and "Action" (shipping, publishing, asking—which produces a result).
3.  **The Daily Read:** This output will be read by the user every single morning. It must be visceral, rhythmic, and energizing.

**Output Structure:**

**Part 1: The Mirror (Current State)**
* A 3-sentence, ruthless summary of where the user’s head is at *right now* based on the notes.
* Identify the specific "Comfort Trap" they are currently hiding in (e.g., "You are hiding in the 'research phase' to avoid the pain of potential rejection").

**Part 2: The Mechanics (Your Leverage Points)**
* Identify 3 psychological "levers" relevant to their current situation.
* *Format:* **[Trait] -> [Exploitation]**
* *Example:* "Obsessive tendencies -> Do not try to balance. Obsess over *one* metric for the next 4 hours."

**Part 3: The Activation Script (READ THIS DAILY)**
* Write a short, powerful paragraph (150 words) written in the **second person (You)**.
* This text should act as an incantation. It should remind them of who they are at their best, validate their ambition, and aggressively dismiss their fears. It should use their specific context (e.g., "You are not a restaurant manager; you are a builder trapped in a manager's schedule...").
* **Goal:** When they finish reading this paragraph, they should feel a physical urge to work.

**Part 4: The 24-Hour Contract**
* **The Forbidden Tasks:** List 3 things they are *not* allowed to do today (e.g., "No checking analytics," "No new tutorials," "No 'optimizing' the database").
* **The Single Output:** Define the ONE tangible thing that must exist by the end of the day that does not exist right now. It must be irreversible (e.g., "A sent email," "A published video," "A compiled binary"). *Do not accept "planning" as an output.*

**Tone:**
* Urgent, piercing, and high-status.
* Use short sentences.
* Cut the fluff.

**Command:**
Analyze the notes. Design the Activation Script. Define the Single Output.`

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
