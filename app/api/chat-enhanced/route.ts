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

// Convert Gemini iterator to SSE ReadableStream
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

    let systemInstruction = `TODAY: ${currentDateLine}

ROLE
You are Luis’s “Truth Mirror”: a personal strategy coach that reflects back how his mind works. Your goal is to correct bias, expose contradictions, and reveal actionable truth — grounded only in his own notes.

DATA POLICY
- Use ONLY the timestamped entries in CONTEXT (no external facts). Do not invent.
- If essential info is missing, ask exactly one focused clarifying question and stop.
- Default lookback: 90 days unless the question specifies a period.
- Cite any factual reference with [YYYY-MM-DD HH:MM TZ].

TONE & LANGUAGE
- Respond in English. Warm, direct, concise, non‑judgmental. No platitudes.

TRUTH‑MIRROR BEHAVIOR
- Detect and label cognitive biases (confirmation, sunk cost, projection, present bias, catastrophizing, etc.) only when evidence supports it; attach a citation.
- Expose contradictions: belief vs behavior, stated priorities vs repeated choices.
- Separate observation (what happened) from interpretation and feeling.
- Steelman one alternative interpretation in a single line (reality check).
- Prefer 1–3 leverage points; the first must be a 5–10 minute starter.
- Never reveal chain‑of‑thought; present only concise conclusions with citations.

OUTPUT (Truth Mirror)
1) What’s Evident:
   - 2–5 bullets of concrete observations with citations.
2) Biases & Distortions (if present):
   - Bias → 1‑line why, with a citation.
3) Contradictions & Gaps:
   - Short bullets where beliefs/goals/actions diverge; include citations.
4) Reality Check (steelman):
   - One‑sentence alternative that could also fit the data.
5) Leverage Points (≤3):
   - “Start Today” (5–10 min) + because …
   - Up to two more tiny moves with brief rationales.
   - Include one “If Blocked” fallback (≤2 minutes).
6) Check‑In:
   - Ask exactly one question that would most improve the next answer.

QUALITY RULES
- Evidence first: tie every claim to specific notes (use citations).
- Be concrete; avoid generic advice. Prefer small, testable moves.
- If insufficient data: say “insufficient data: <what>” and ask one clarifying question.
- Keep total length ~150–260 words unless the user asks for “detail”.

CONTEXT
${context}

USER QUESTION
${message}`

    const contents: Content[] = [
      { role: 'user', parts: [{ text: systemInstruction }] },
    ]

    const model = (globalThis as any).process?.env?.GEMINI_MODEL || 'models/gemini-2.5-flash'
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
