import type { NextRequest } from 'next/server'
import { getRelevantNotesContext } from '../../../lib/note-retrieval'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      console.error('API Key not found.')
      return new Response('Error: OPENROUTER_API_KEY is not set.', { status: 500 })
    }

    const { message, conversationHistory = [], currentDate, userTimezone, specialistOutputs } = await req.json()

    if (!message) {
      return new Response('Error: Message is required.', { status: 400 })
    }

    const currentDateLine = currentDate ? String(currentDate) : new Date().toString();
    const timezoneLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'
    let notesContext = ''

    try {
      const retrieval = await getRelevantNotesContext({
        profile: 'chat',
        userQuery: String(message),
        conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
        currentDate: currentDate ? String(currentDate) : undefined,
        userTimezone: typeof userTimezone === 'string' ? userTimezone : undefined,
      })

      notesContext = retrieval.notesText || '(No saved notes yet.)'

      console.log(
        `[chat-enhanced] note retrieval selected ${retrieval.diagnostics.selectedNotes}/${retrieval.diagnostics.availableNotes} notes (${Math.round(retrieval.diagnostics.promptReductionRatio * 100)}% reduction)`,
      )
    } catch (err) {
      console.error('Failed to load notes for chat context:', err)
      notesContext = "(System: Failed to load long-term notes. Rely only on conversation history.)"
    }

    // Updated Prompt: First Principles & Logic Oriented
    let systemInstruction = `You are a First-Principles Thinking Partner. You do not provide motivation, fluff, or standard customer-service platitudes. You provide clarity, rigorous logic, and strategy based on facts.

CONTEXT:
- Today: ${currentDateLine}
- ${timezoneLine}

    LONG-TERM MEMORY (RETRIEVED USER NOTES):
    ${notesContext}

USER QUERY:
${message}

═══════════════════════════════════════════════════════════════
SPECIALIST AI ANALYSES (Lower trust than raw notes)
═══════════════════════════════════════════════════════════════

Other AI tools analyzed the same notes. Their conclusions are below.

TRUST HIERARCHY:
1. Raw notes (highest) — ground truth
2. Your own first-principles analysis
3. Specialist AI outputs (lowest) — opinions, may contain errors

YOUR JOB:
- If a specialist made a claim, verify it against the raw notes before agreeing
- Explicitly note if you DISAGREE with a specialist and why
- Do not repeat their conclusions — add new value

[DEEP READ]:
${specialistOutputs?.deepRead || "(Not run)"}

[A→B CONSULTING]:
${specialistOutputs?.consulting || "(Not run)"}

[REFRAME]:
${specialistOutputs?.reframe || "(Not run)"}

═══════════════════════════════════════════════════════════════
CRITICAL: FIRST PRINCIPLES & MATH FIRST
═══════════════════════════════════════════════════════════════

Your answers MUST be derived from first-principles thinking and math/logic FIRST.

DO NOT:
- Generate an answer and then retrofit justification.
- Start with a conclusion and work backwards to find supporting evidence.
- Use intuition or pattern-matching without explicit reasoning.

DO:
- Start from raw data and first principles.
- Build your logic step-by-step BEFORE stating the conclusion.
- If numbers are involved, show the math.
- Let the answer EMERGE from the reasoning, not precede it.

If your reasoning leads to an unexpected or uncomfortable conclusion, state it anyway. The user values truth over comfort.

═══════════════════════════════════════════════════════════════

YOUR CORE DIRECTIVES:
1. **Directness**: Start immediately with the reasoning or core insight. No "Hello", "That's a great question", or "Here is what I found".
2. **First Principles**: Break problems down to their mechanics. Specific observations > general advice.
3. **Math & Numbers**: If the question involves quantities, show calculations. Don't hand-wave.
4. **Data-Driven**: Base your answers on the User Notes provided. If the notes contradict the user's current stance, point it out.
5. **Cognitive Awareness**: If the user seems stuck in a loop (guilt, indecision), name the paradox or pattern you see.

TONE:
- Professional, high-bandwidth, "Chief of Staff" or "Senior Strategist" persona.
- Concise. Use bullet points for density.
- No "cheerleading". The user feels better through clarity, not compliments.

How to Structure Your Answer:
- **The Reasoning**: Walk through the logic or math first.
- **The Core Truth**: What conclusion emerges from the reasoning?
- **The Strategic Shift**: How should the user view this differently? or What is the next move?
`

    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-4.6'

    const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: message }
        ],
        stream: true,
        // Extended thinking for deeper first-principles reasoning
        thinking: {
          type: 'enabled',
          budget_tokens: 10000,
        },
      }),
    })

    if (!orResponse.ok || !orResponse.body) {
      const errText = await orResponse.text().catch(() => orResponse.statusText)
      throw new Error(`OpenRouter request failed (${orResponse.status}): ${errText}`)
    }

    // Pipe the SSE stream, extracting text content from each chunk
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const responseStream = new ReadableStream({
      async start(controller) {
        const reader = orResponse.body!.getReader()
        let buffer = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) continue
              const payload = trimmed.slice(5).trim()
              if (!payload || payload === '[DONE]') continue

              try {
                const chunk = JSON.parse(payload)
                const content = chunk.choices?.[0]?.delta?.content
                if (content) {
                  const data = { type: 'text', content }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                }
              } catch {
                // skip malformed chunks
              }
            }
          }

          controller.close()
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          console.error(`Stream error caught: ${errorMessage}`, { error })
          try {
            const errorData = { type: 'error', content: 'An unexpected error occurred during the stream.', details: errorMessage }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`))
          } finally {
            controller.close()
          }
        }
      },
    })

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
