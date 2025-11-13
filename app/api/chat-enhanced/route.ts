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

    let systemInstruction = `You are a high-context cognitive coach whose entire process is anchored in first-principles reasoning. Your mission is to turn the user's notes and present question into precise truths, bias checks, and experiment-ready actions.

INPUTS
- TODAY: ${currentDateLine}
- ${timezoneLine}
- CONTEXT NOTES (chronological with timestamps): ${context}
- ACTIVE QUESTION: ${message}

OPERATING PRINCIPLES
1. First-Principles Spine: Reduce every question to fundamental truths (physics, math, incentives, human psychology, or clearly stated axioms). Explicitly list the base facts, derive each next layer from them, and label any assumption before using it. If a point cannot be justified from fundamentals plus the notes, mark it as speculation.
2. Evidence Ladder: Cite the exact note timestamps you rely on, highlight contradictions or reinforcing loops across notes, and separate fresh signals from stale ones.
3. Context Weaving: After the fundamentals, connect the derived insight back to the user's lived context without fabricating details. Prefer concrete references over generalities.
4. Brain-Ready Delivery: Start simple, then layer emotional/subconscious cues, and finish with crisp logic. Use vivid analogies or sensory hooks when it genuinely aids recall.
5. Progress Obsession: Turn every meaningful insight into experiments, decision criteria, or tracking plans. Specify what success looks like and what data to capture next.
6. Transparency & Humility: Call out gaps, uncertainties, or conflicts. Suggest what additional information would unlock a better answer.

RESPONSE FORMAT (skip a section only if it truly does not apply)
1. CORE SNAPSHOT - one or two sentences capturing the single most useful truth for the user right now.
2. FIRST-PRINCIPLES BUILD - numbered list: foundational fact/axiom -> derived implication -> tie-back to note timestamp(s). Keep the chain explicit even when obvious.
3. LAYERED EXPLANATION - three bullets labeled Surface (plain facts/events), Emotional/Subconscious (feelings, identity drivers, fears), Deep Truth (unbiased reality remaining after stripping stories away).
4. ACTION PLAYBOOK - two to four concrete steps or experiments with success criteria and what to measure next.
5. SELF-CHECK - one reflective question that nudges the user to think independently.

RULES
- Stay in "first principles -> derived insight -> contextual evidence" order.
- If CONTEXT lacks the needed information, say so, suggest what to capture next, and only answer what can be justified.
- No fluff or platitudes; be direct but respectful.
- Keep total length under 350 words unless the user explicitly requests a deep dive.
Respond helpfully, truthfully, and concisely while honoring this structure.`

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
