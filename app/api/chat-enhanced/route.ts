import type { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

function iteratorToStream(iterator: AsyncIterable<any>): ReadableStream<any> {
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        for await (const chunk of iterator) {
          try {
            const content = chunk.choices[0]?.delta?.content
            if (content) {
              const data = { type: 'text', content: content }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
            }
          } catch (innerErr) {
            console.error('Error processing chunk part:', innerErr)
          }
        }

        controller.close();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Stream error caught: ${errorMessage}`, { error });
        try {
          const errorData = { type: 'error', content: 'An unexpected error occurred during the stream. Please check the server logs.', details: errorMessage };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`));
        } finally {
          controller.close();
        }
      }
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      console.error('API Key not found.')
      return new Response('Error: OPENROUTER_API_KEY is not set.', { status: 500 })
    }

    const { message, conversationHistory = [], currentDate, userTimezone } = await req.json()

    if (!message) {
      return new Response('Error: Message is required.', { status: 400 })
    }

    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    // Personal assistant: focus on user notes only (no external domain filters)

    const currentDateLine = currentDate ? String(currentDate) : new Date().toString();

    // Build context from conversation history
    const context = (conversationHistory as any[])
      .map((entry: any) => {
        if (entry.role === 'user' && entry.parts) {
          return 'User: ' + entry.parts.map((part: any) => part.text).join(' ')
        }
        if (entry.role === 'model' && entry.parts) {
          return 'AI: ' + entry.parts.map((part: any) => part.text).join(' ')
        }
        return ''
      })
      .join('\n')

    const timezoneLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'

    let systemInstruction = `SYSTEM ROLE: You are a First-Principles Analyst and Strategist. Your goal is to synthesize raw notes into high-signal insights, separating signal from noise, and logic from emotion.

INPUTS
- TODAY: ${currentDateLine}
- ${timezoneLine}
- CONTEXT NOTES (chronological with timestamps): ${context}
- ACTIVE QUESTION: ${message}

CORE PROTOCOLS
1. Radical Objectivity: Strip away the user's narrative fluff. Look for the mechanics of the situation (incentives, patterns, resource constraints, stated facts).
2. Evidence-Backed Deduction: Do not make a claim unless you can link it to a specific timestamp in the notes or a stated axiom. If you are guessing, label it [Hypothesis].
3. Contextual Empathy: Understand the user's psychology (implied in the notes) but answer with cold logic.
4. Action Bias: Insights are useless without application. Every conclusion must lead to a testable next step.

RESPONSE FORMAT

1. EXECUTIVE SYNTHESIS
(2-3 sentences max). The direct answer to the question based on the strongest signal in the notes.

2. THE LOGIC CHAIN (First Principles & Evidence)
Trace the insight from raw fact to conclusion. Use this format:
*   **Fact/Observation:** [Quote/Reference from timestamp]
*   **Deduction:** [The logical consequence of that fact]
*   **Synthesis:** [How this answers the user's question]

3. DEPTH ANALYSIS (The 3 Layers)
*   **Surface:** What physically happened or what is explicitly stated.
*   **Subconscious/Emotional:** What seems to be driving the behavior (fears, biases, identity) based on the tone/phrasing of the notes.
*   **Deep Truth:** The fundamental reality that remains when you remove the emotions and stories.

4. FORWARD PROTOCOL (Action Plan)
Provide 2-3 experiments or decisions. Format:
*   **Action:** [Specific Step]
*   **Why:** [Link to logic]
*   **Success Metric:** [How to know if it worked]

5. BLIND SPOTS
Identify one crucial piece of missing information that, if known, would change this entire analysis.

CONSTRAINTS
- Tone: Clinical, precise, yet supportive.
- Length: High density. No filler words.
- If the notes do not answer the question, state clearly: "Insufficient data to derive a conclusion."`

    const model = process.env.OPENROUTER_MODEL || 'x-ai/grok-4.1-fast:free'

    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: message } // Redundant but good for clarity if systemInstruction is treated as system
      ],
      stream: true,
    })

    const responseStream = iteratorToStream(stream)
    return new Response(responseStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (e) {
    console.error('Enhanced chat API error:', e)
    const errorMessage = e instanceof Error ? e.message : String(e)
    return new Response(`Error: ${errorMessage}`, { status: 500 })
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
