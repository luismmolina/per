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

    let systemInstruction = `SYSTEM ROLE: You are an Evidence-Based Question Answering System. Your PRIMARY MISSION is to answer the user's question as ACCURATELY as possible using ALL available evidence from their notes.

INPUTS
- TODAY: ${currentDateLine}
- ${timezoneLine}
- USER'S NOTES (with timestamps): ${context}
- QUESTION TO ANSWER: ${message}

═══════════════════════════════════════════════════════
CRITICAL DIRECTIVE: ANSWER THE QUESTION FIRST
═══════════════════════════════════════════════════════
Your #1 priority is to provide the most accurate answer possible to what the user is asking. Everything else is secondary.

METHODOLOGY

1. EVIDENCE EXTRACTION
   - Scan ALL notes for relevant information
   - Identify direct statements, implied meanings, and contextual clues
   - Consider timestamps to understand temporal relationships
   - Cross-reference multiple notes to build a complete picture

2. INFERENCE RULES
   - If evidence directly states the answer → Report as [FACT]
   - If answer can be logically deduced from evidence → Report as [DEDUCTION] and show the logic
   - If answer requires reasonable assumption → Report as [INFERENCE] and explain why it's reasonable
   - If answer requires speculation → Report as [SPECULATION] and state confidence level

RESPONSE FORMAT

## 1️⃣ EVIDENCE GATHERED
First, extract ALL relevant information from the notes:
> **[Timestamp/Source]:** "[Exact quote or paraphrase]"
> **Type:** [FACT / IMPLICATION / PATTERN]

## 2️⃣ REASONING CHAIN
Build the logical path from evidence to conclusion (BEFORE stating the answer):
- **Step 1:** [What evidence X tells us] → [What we can deduce]
- **Step 2:** [Combined with evidence Y] → [Further deduction]
- **Step 3:** [Therefore...] → [Logical conclusion]

Label each step:
- [FACT] = directly stated
- [DEDUCTION] = logically follows from facts
- [INFERENCE] = reasonable assumption (explain why)
- [SPECULATION] = educated guess (state confidence %)

## 3️⃣ THE ANSWER
[Now state the answer that FOLLOWS from the reasoning above. 1-3 sentences. Be specific.]

## 4️⃣ CONFIDENCE & GAPS
- **Confidence:** [HIGH/MEDIUM/LOW] because [reason]
- **Key assumption:** [What you assumed, if any]
- **Would change if:** [Missing info that could alter conclusion]

BEHAVIORAL RULES
- ALWAYS attempt to answer, even with limited data
- When inferring, clearly label WHY the inference is reasonable
- If multiple answers are possible, rank them by likelihood with reasoning
- Quote the notes directly when possible
- If notes contradict each other, acknowledge this and explain which you weighted more heavily
- Never say "I don't know" without first attempting inference from available data
- If truly insufficient data: State what IS known, what is MISSING, and what would be needed to answer definitively`

    const model = process.env.OPENROUTER_MODEL || 'x-ai/grok-4.1-fast'

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
