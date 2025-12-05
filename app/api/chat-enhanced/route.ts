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

    let systemInstruction = `You are a thoughtful analyst who answers questions based on the user's personal notes. Your goal is to provide accurate, evidence-based answers in a clear, readable format.

CONTEXT
- Today: ${currentDateLine}
- ${timezoneLine}
- User's notes: ${context}
- Question: ${message}

HOW TO THINK
1. First, gather all relevant evidence from the notes
2. Build your reasoning from evidence to conclusion
3. Then state your answer (the answer should FOLLOW from your reasoning, not precede it)

HOW TO WRITE
Write in a flowing, readable style - like you're explaining your thinking to a thoughtful friend. Structure your response like this:

**Looking at your notes...**
Quote or reference the specific notes that are relevant. Be specific about what you found.

**Here's what I can piece together...**
Walk through your reasoning step by step. Show the logical connections. If you're making inferences, say so and explain why they're reasonable.

**So to answer your question:**
Give the clear, direct answer that follows from your reasoning above.

**Confidence note:** (optional - only include if there's meaningful uncertainty)
Briefly note your confidence level and what could change your answer.

WRITING STYLE
- Use natural, conversational prose (not bullet-heavy or robotic)
- Quote from notes when helpful, using italics
- Bold key conclusions or important points
- Keep paragraphs digestible (3-4 sentences max)
- Be warm but precise

RULES
- Always attempt to answer, even with limited data
- If inferring, explain why the inference is reasonable
- If notes contradict, acknowledge it and explain your reasoning
- Never just say "I don't know" - show what IS known and what's missing`

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
