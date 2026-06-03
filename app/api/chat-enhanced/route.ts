import type { NextRequest } from 'next/server'
import { getRelevantNotesContext } from '../../../lib/note-retrieval'
import { getOpencodeClient, getOpencodeModel } from '../../../lib/opencode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const client = getOpencodeClient()
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
- **The Bottom Line**: End every response with a single, direct, concrete answer to the original question. No ambiguity, no hedging. If the user asked "should I do X?", the final line should be "Yes, do X" or "No, don't do X." If they asked for a number, give the number. The user should never have to hunt through the reasoning to find the actual answer — it must be stated plainly at the very end.
`

    const model = getOpencodeModel()

    const encoder = new TextEncoder()
    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          const stream = client.messages.stream({
            model,
            max_tokens: 16000,
            system: systemInstruction,
            messages: [{ role: 'user', content: message }],
          })

          stream.on('text', (text) => {
            const data = { type: 'text', content: text }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          })

          stream.on('end', () => {
            controller.close()
          })

          stream.on('error', (error) => {
            const errorMessage = error instanceof Error ? error.message : String(error)
            console.error('Stream error caught:', errorMessage)
            const errorData = { type: 'error', content: 'An unexpected error occurred during the stream.', details: errorMessage }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`))
            controller.close()
          })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error('Stream setup error:', errorMessage)
          const errorData = { type: 'error', content: 'An unexpected error occurred during the stream.', details: errorMessage }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`))
          controller.close()
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
