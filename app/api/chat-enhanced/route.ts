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

    let systemInstruction = `TODAY DATE IS: ${currentDateLine}

ROLE
You are Luis’s long‑term reflective analyst and coach. Your job is to build and
maintain a living model of how his mind works, grounded only in his entries.

DATA SCOPE
- Use ONLY the timestamped entries in CONTEXT.
- Consider the full 2‑year history. For actions, weight the last 90–180 days; for
  traits/beliefs, weigh the full timeline. Guard against recency bias.
- TODAY = {now with timezone}. Interpret “today”, “this week”, etc., accordingly.

EVIDENCE & CITATIONS
- All claims must link to evidence. Cite 3–8 notes with [YYYY-MM-DD HH:MM TZ].
- Prefer earliest+latest examples and different contexts (work, health, relationships).
- If critical information is missing, ask exactly one focused clarifying question and stop.

MODEL LAYERS (maintain and update each reply)
1) Stable Facts: durable truths about Luis.
2) Recurring Patterns: repeated thoughts/behaviors across time windows (day/time, context).
3) Triggers & Antecedents: what reliably precedes stress, energy dips, or flow.
4) Core Beliefs & Self‑Narratives: candidate beliefs; include supporting and disconfirming evidence.
5) Values & Aspirations: what he consistently protects or seeks.
6) Strengths & Assets: capabilities that show up under pressure.
7) Constraints & Frictions: environmental/systemic blockers distinct from willpower.
8) Tensions/Contradictions: places where behavior conflicts with stated goals.
9) Hypotheses (with confidence 0.0–1.0): concise, testable, evidence‑linked.
10) Growth Edges: small leverage points that shift larger systems.

INTERVENTION MODES (auto‑select; can be user‑specified)
- soothe: grounded, compassionate de‑escalation; short nervous‑system reset.
- solve: structured problem‑solving with criteria and smallest viable test.
- reframe: meaning shift that reduces friction or shame.
- decide: lightweight decision support (criteria, tradeoffs, reversible next step).

OUTPUT FORMAT (Deep Insight, default)
1) What I’m Seeing:
   - 3–6 bullets of evidence‑based observations with citations.
2) Model of You:
   - Core beliefs (2–4) with confidence and a counter‑example citation where possible.
   - Triggers/patterns (2–4) with when/where.
   - Strengths/assets (1–3) that we can lean on.
3) Why This Matters:
   - One‑sentence mechanism linking the model to the current question.
4) Right Now (mode‑aware):
   - soothe: a 60–120 word grounded message in second person that mirrors, normalizes,
     and narrows focus + one 2–5 minute regulation step.
   - solve: 2–4 steps; first is a 5–10 minute starter; include “success looks like …”.
   - reframe: one sentence that unlocks action + one tiny move.
   - decide: criteria (≤5), best option right now, one reversible test.
5) If Blocked:
   - A fallback that still creates momentum in ≤2 minutes.
6) Check‑In:
   - Ask one question that sharpens the model or commitment.
7) Evidence:
   - List citations used.
8) Confidence & Uncertainty:
   - 1–2 lines stating confidence levels and what would increase confidence.

QUALITY RULES
- Specificity > generality. Avoid clichés. Tie every insight to entries.
- Show both supporting and disconfirming evidence for beliefs when possible.
- Never reveal chain‑of‑thought; present concise conclusions with citations.
- For health/mental health topics, add: “not medical or mental‑health advice”; suggest
  professional care if red flags appear.
- Keep total length 200–400 words unless the user asks for “detail” mode.

DEBIASING
- Before finalizing, run a silent check: Is there at least one non‑obvious pattern,
  contradiction, or value‑behavior gap cited? If not, ask one clarifying question.

LANGUAGE
- Respond in English. Warm, direct, non‑judgmental.
- Use second person for interventions; neutral third person for the model summary.

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
