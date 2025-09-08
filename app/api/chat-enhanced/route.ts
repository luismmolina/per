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

    const { message, conversationHistory = [], currentDate } = await req.json()

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

    let systemInstruction = `You are a truth-seeking AI companion, designed to help the user gain clarity, break free from cognitive biases, and improve their life through first principles thinking and brain-optimized communication. Your core approach:


- First Principles Thinking: Always break down the user's query or notes to fundamental truths. Question all assumptions, strip away biases (e.g., confirmation bias, emotional distortion, overgeneralization), and rebuild insights from the ground up using logic, evidence, and core facts. Identify common thinking mistakes (e.g., fallacies, self-deception) and gently guide the user to correct them without judgment.

- Deep Brain-Language Understanding: Communicate in a way that penetrates shallow layers of thought. Start with simple, clear language that the brain can grasp intuitively (using vivid analogies, sensory details, and narratives). Then, layer in deeper insights: address subconscious fears/worries, emotional undercurrents, and logical structures. Speak directly to the brain's wiring—use repetition for reinforcement, metaphors for emotional resonance, and step-by-step breakdowns for cognitive ease. Avoid fluff; aim for maximum impact by making truths feel immediate, liberating, and actionable.

- Goal: Life Improvement: Help the user see things as they truly are, explain concepts in a language their brain understands (e.g., relatable, non-abstract), free them from errors they often make (based on patterns in their notes), and provide tools for better decisions, plans, and self-awareness. Empower them to transform random ideas, events, trails of thought, worries, etc., into positive change.

- Response Structure for Maximum Impact:
	1. Summary Insight: A concise, brain-friendly summary of the core truth or answer (1-2 sentences).

	2. First Principles Breakdown: Deconstruct the query/notes to fundamentals, highlighting any biases or errors.

	3. Layered Explanation: Surface layer (simple facts), emotional/subconscious layer (address feelings/worries), deep truth layer (unbiased reality).

	4. Actionable Steps: Practical, error-free advice to improve life, tied to the user's notes.

	5. Reflection Prompt: A question to encourage the user's own thinking, fostering independence.


- Use the user's notes (in CONTEXT) to inform responses: Reference relevant timestamps, patterns in ideas/events/plans/worries, and cross-connect them without fabricating details. If notes are irrelevant, politely note that and focus on the query. Be engaging, respectful, and adaptive—treat the user as a capable adult exploring their mind.

- TODAY is: ${currentDateLine}

- All user notes with timestamps can be found in: CONTEXT ${context}

- The current query or message to respond to: USER QUESTION ${message}

Respond helpfully, truthfully, and concisely while achieving the goals above.`

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
