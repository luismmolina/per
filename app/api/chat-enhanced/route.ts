import type { NextRequest } from 'next/server'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

import {
  GoogleGenAI,
  Content,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/genai'

// Removed legacy dishes/COGS context: this endpoint focuses on personal notes only.

function iteratorToStream(iterator: AsyncGenerator<any, any, undefined>): ReadableStream<any> {
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        for await (const chunk of iterator) {
          try {
            const candidates = (chunk as any)?.candidates
            const content = candidates && candidates[0]?.content
            const parts = content?.parts as any[] | undefined
            if (parts) {
              for (const part of parts) {
                if (part?.text) {
                  const dbg = (globalThis as any).process?.env?.DEBUG
                  if (dbg) {
                    console.log('Part received:', {
                      hasThought: (part as any).thought === true,
                      textPreview: (part.text as string)?.substring(0, 100) + '...'
                    })
                  }
                  // If the part is marked as a thought, stream as a thought event
                  if ((part as any).thought === true) {
                    const data = { type: 'thought', content: part.text as string }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                  } else {
                    const data = { type: 'text', content: part.text as string }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                  }
                } else if (part?.executableCode) {
                  const data = { type: 'code', content: { code: part.executableCode.code, language: part.executableCode.language } }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                } else if ((part as any)?.codeExecutionResult) {
                  const cer: any = (part as any).codeExecutionResult
                  const output = cer?.output ?? cer?.out ?? ''
                  const error = cer?.error ?? cer?.err ?? ''
                  const data = { type: 'code_result', content: { output, error } }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                }
              }
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
    const apiKey = (globalThis as any).process?.env?.GEMINI_API_KEY || (globalThis as any).process?.env?.NEXT_PUBLIC_GEMINI_API_KEY
    if (!apiKey) {
      console.error('API Key not found.')
      return new Response('Error: GEMINI_API_KEY is not set.', { status: 500 })
    }

    const { message, conversationHistory = [], currentDate, userTimezone } = await req.json()

    if (!message) {
      return new Response('Error: Message is required.', { status: 400 })
    }

    const genAI = new GoogleGenAI({ apiKey })
    let result: any

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

    const fullContext = context

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

    const contents: Content[] = [
      { role: 'user', parts: [{ text: systemInstruction }] },
    ]

    const model = (globalThis as any).process?.env?.GEMINI_MODEL || 'gemini-2.5-pro'
    const tokenCount = await genAI.models.countTokens({ model, contents })
    const inputTokens = (tokenCount as any).totalTokens || 0
    const dbg = (globalThis as any).process?.env?.DEBUG
    if (dbg) {
      const inputCost = (inputTokens / 1_000_000) * 1.25
      console.log(`Single-Model (Pro) - Input: ${inputTokens} tokens ($${inputCost.toFixed(4)})`)
    }

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Single-model request timeout')), 30000)
    })

    const streamPromise = genAI.models.generateContentStream({
      model,
      contents,
      config: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: -1,
        },
        tools: [
          { codeExecution: {} } as any,
        ] as any,
        safetySettings: [
          { category: (HarmCategory as any).HARM_CATEGORY_HARASSMENT, threshold: (HarmBlockThreshold as any).BLOCK_MEDIUM_AND_ABOVE },
          { category: (HarmCategory as any).HARM_CATEGORY_HATE_SPEECH, threshold: (HarmBlockThreshold as any).BLOCK_MEDIUM_AND_ABOVE },
          { category: (HarmCategory as any).HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: (HarmBlockThreshold as any).BLOCK_MEDIUM_AND_ABOVE },
          { category: (HarmCategory as any).HARM_CATEGORY_DANGEROUS_CONTENT, threshold: (HarmBlockThreshold as any).BLOCK_MEDIUM_AND_ABOVE },
        ] as any,
      },
    }) as any

    result = await Promise.race([streamPromise, timeoutPromise])

    const stream = iteratorToStream(result)
    return new Response(stream, {
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
