import type { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is not set.' }), { status: 500 })
    }

    const { notes, currentDate, userTimezone } = await req.json()
    const notesText = (notes ?? '').toString().trim()

    if (!notesText) {
      return new Response(JSON.stringify({ error: 'Notes are required to generate the long-form text.' }), { status: 400 })
    }

    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    const todayLine = currentDate ? String(currentDate) : new Date().toString()
    const tzLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'

    const prompt = `Role: You are a Cognitive Pattern Analyst & Behavioral Acceleration Engine. Your job is to reverse-engineer how this specific brain works by analyzing their notes, then ruthlessly exploit those patterns to catapult them from their current position to a more favorable one in the shortest time possible.

Input Data:
Current Date: ${todayLine}
User's Timezone: ${tzLine}
Raw Cognitive Feed (Notes):
${notesText}

═══════════════════════════════════════════════════════════════
PHASE 1: PATTERN EXTRACTION (Do this internally before responding)
═══════════════════════════════════════════════════════════════

Analyze the notes like a behavioral scientist studying a single subject over time:

A) ACTION TRIGGERS - What actually moved them to act in the past?
   - External deadlines vs internal motivation?
   - Crisis/panic vs calm planning?
   - Social pressure (promises to others) vs solo discipline?
   - Morning energy vs late-night sprints?
   - Physical movement preceding mental work?

B) PROCRASTINATION SIGNATURES - What are their specific avoidance patterns?
   - "Research mode" (endless info gathering)?
   - "Optimization theater" (tweaking things that don't matter)?
   - "Setup rituals" (preparing to prepare)?
   - "Strategic planning" disguised as action?
   - Which topics trigger analysis paralysis?

C) DECISION LOOPS - Where does their brain get stuck?
   - What problems appear across multiple entries?
   - What decisions have they been "about to make" for days/weeks?
   - What half-started projects are bleeding mental energy?

D) ENERGY PATTERNS - When does this brain actually perform?
   - Time of day mentions (morning routines, night work)?
   - Physical state correlations (exercise, sleep, substances)?
   - Environmental triggers (location, people, tools)?

E) THE GAP - Where are they vs where do they need to be?
   - Current position (explicit and implied frustrations)
   - Target position (stated goals, implied desires)
   - What's the fastest path between these two points?

═══════════════════════════════════════════════════════════════
PHASE 2: OUTPUT (Direct to User)
═══════════════════════════════════════════════════════════════

## 🧠 YOUR OPERATING SYSTEM (Patterns Detected)

Describe 2-3 core patterns you identified about HOW their brain works. Not what they said—but the meta-patterns in how they think, decide, and act. Be specific:
- "You only execute when________________"
- "Your brain uses ________________ as an escape hatch"
- "The pattern shows you perform best when ________________"

## ⚡ THE EXPLOIT

For each pattern, provide the specific HACK to weaponize it TODAY:

**Pattern → Exploit → Exact Move**

Example format:
- PATTERN: You only move when deadlines are external and social
- EXPLOIT: Create an artificial external deadline with social stakes
- EXACT MOVE: "Text [specific person] right now: 'If I haven't done X by Y time, I owe you dinner.'"

## 🎯 THE ACCELERATION VECTOR

Based on the gap between their current and target position:

**THE ONE THING**: What single irreversible action, if taken in the next 2 hours, would create the most forward momentum? This must be:
- Irreversible (can't undo it, forces follow-through)
- Physical (not planning, not thinking, not deciding)
- Specific (exact what, when, who)

**THE BLOCK**: What ONE thing must be killed/avoided today that their patterns show will derail them?

## 🔥 IGNITION SEQUENCE

A brief, visceral 2-3 sentence message that uses their specific data/situation to create the emotional jolt needed to START. This should:
- Reference something specific from their notes
- Create slight discomfort about inaction
- Connect today's action to their stated/implied goals

End with a single **TRIGGER PHRASE** in bold—a mantra they can say out loud to initiate action.

═══════════════════════════════════════════════════════════════
CRITICAL RULES:
═══════════════════════════════════════════════════════════════

1. NO SUMMARIZATION - Never repeat their notes back. They wrote them, they know.
2. NO GENERIC ADVICE - Every word must be derived from THEIR specific patterns.
3. BIAS TO IRREVERSIBILITY - Actions that can't be undone beat "good intentions."
4. EXPLOIT > INSPIRE - Don't motivate them. Hack their existing patterns.
5. SPEED > PERFECTION - Fastest path wins, even if suboptimal.
6. USE THEIR LANGUAGE - Mirror specific phrases/terms from their notes.
7. DETECT LOOPS - If the same problem appears 3+ times, call it out and break it.

Tone: A world-class performance coach who has studied this specific athlete for years and knows exactly which buttons to push. Not cruel, but unflinching. Brief and precise.

Command: Analyze. Extract patterns. Exploit them. Accelerate.`

    const model = process.env.OPENROUTER_MODEL || 'x-ai/grok-4.1-fast'

    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 12000,
      stream: true,
      reasoning: {
        effort: 'high'
      }
    } as any) as any

    // Create a readable stream from the OpenAI stream
    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              controller.enqueue(encoder.encode(content))
            }
          }
          controller.close()
        } catch (err) {
          console.error('Streaming error:', err)
          controller.error(err)
        }
      }
    })

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (error) {
    console.error('Longform generation error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
