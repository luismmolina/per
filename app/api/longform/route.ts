import type { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { loadConversations } from '../../../lib/storage'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is not set.' }), { status: 500 })
    }

    const { notes, currentDate, userTimezone, fetchAllNotes } = await req.json()

    let notesText = (notes ?? '').toString().trim()

    // If configured to fetch from storage, retrieve all notes
    if (fetchAllNotes) {
      try {
        const conversations = await loadConversations()
        const messages = conversations?.messages || []

        const fetchedNotes = messages
          .filter((m: any) => m.type === 'note')
          .map((m: any) => {
            const date = new Date(m.timestamp).toLocaleString('en-US', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
              timeZoneName: 'short'
            })
            return `[${date}] (note) ${m.content}`
          })
          .join('\n')

        if (fetchedNotes) {
          notesText = fetchedNotes
        }
      } catch (storageError) {
        console.error('Failed to fetch notes from storage:', storageError)
        // Fall back to provided notes if any, otherwise fail
        if (!notesText) {
          return new Response(JSON.stringify({ error: 'Failed to retrieve notes from storage.' }), { status: 500 })
        }
      }
    }

    if (!notesText) {
      return new Response(JSON.stringify({ error: 'Notes are required to generate the long-form text.' }), { status: 400 })
    }

    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    const todayLine = currentDate ? String(currentDate) : new Date().toString()
    const tzLine = userTimezone ? `USER TIMEZONE: ${userTimezone}` : 'USER TIMEZONE: Not provided'

    const prompt = `You analyze human notes to identify obstacles and explain them through first principles — the mechanical, causal reasons why someone is stuck, and the specific leverage points that create movement.

═══════════════════════════════════════════════════════════════
CRITICAL: WHAT "FIRST PRINCIPLES" MEANS
═══════════════════════════════════════════════════════════════

First principles are UNDENIABLE TRUTHS that require no citation. They are derivable from basic logic, mathematics, or physics.

✅ ALLOWED (True first principles):
- "You cannot have data about an action you haven't taken" (logical necessity)
- "Choosing to keep all options open closes the option of forward movement" (logical structure)
- "The path you've taken 100 times is easier than the path you've taken 0 times" (observable, no study needed)
- "A decision made is information gained; a decision delayed is information lost" (logical)
- "If X always follows Y in your notes, X will likely follow Y again" (pattern recognition from THEIR data)

❌ FORBIDDEN (Research/psychology that could be wrong):
- "Ego depletion" / "willpower is a finite resource" / "prefrontal cortex exhaustion" — DEBUNKED
- "Dopamine hits" / "dopamine addiction" — oversimplified pop-psychology  
- "Your amygdala is..." — neuroscience claims you can't verify
- "Studies show..." / "Research indicates..." — appeals to authority
- "Cognitive behavioral..." / "According to psychology..." — field-specific claims
- Any claim that requires trusting external research to be true

THE TEST: If you need a study to prove it, don't say it. If it's self-evidently true from logic alone, say it.

═══════════════════════════════════════════════════════════════
PHILOSOPHY
═══════════════════════════════════════════════════════════════

- NO self-help language ("believe in yourself", "you can do it", "face your fears")
- NO neuroscience claims (you don't know what the prefrontal cortex is actually doing)
- NO psychological frameworks (they may be wrong)
- ONLY: Logic, mathematics, patterns from the user's own notes, undeniable cause→effect
- The explanation itself should create movement — understanding WHY reveals HOW

INPUT:
Current Date: ${todayLine}
User's Timezone: ${tzLine}
Notes:
${notesText}

═══════════════════════════════════════════════════════════════
ANALYSIS (Internal — do not output)
═══════════════════════════════════════════════════════════════

1. CURRENT STATE
   - What is this person working on / thinking about?
   - What patterns appear in their notes? (loops, stuck points, energy drains)
   - What has moved them forward before? (evidence of past action)

2. THE OBSTACLE (if one exists)
   - What specific thing are they stuck on?
   - WHAT IS THE MECHANICAL REASON for the stuckness?
     Use ONLY these types of explanations:
     • Information asymmetry: They lack data that only action provides
     • Local minimum: Current position feels stable but is suboptimal
     • Prediction without data: Their expectation is based on 0 data points for this specific thing
     • Cost miscalculation: They're measuring the wrong variable
     • Optionality trap: Keeping options open = closing the option to move forward
     
3. THE LEVERAGE POINT
   - What single change in the system creates movement?
   - NOT motivation. What changes the STRUCTURE of the situation?
     Examples:
     • Reduce the size of the first step (smaller = more likely)
     • Create one data point (changes prediction from guess to measurement)
     • Make the cost of inaction visible (reframe what "doing nothing" costs)
     • Create irreversibility (remove the option to retreat)
     • External commitment (make future-self accountable to present-decision)

═══════════════════════════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════════════════════════

## The Terrain

[From the notes: where is this person? What's their current state? Be concrete. Reference their words.]

## The Obstacle

[IF one exists: Name the specific obstacle. Quote evidence from notes.

IF no obstacle: State "No obstacle detected in these notes. Current state appears to be motion."]

## The Mechanism

[THIS IS THE CORE. Explain WHY they are stuck using ONLY logic and patterns from their notes.

WRONG: "Your willpower is depleted from making decisions all day."
RIGHT: "You've written about this decision 4 times without acting. Each time you analyze instead of act, you practice analyzing. The path of 'analyze again' is now the path of least resistance because it's the path you've walked before."

WRONG: "Your dopamine system is hijacked by social media."
RIGHT: "You open Twitter when you feel X (from your notes). You've done this enough times that 'feel X → open Twitter' is now automatic. The question is not 'how do I resist?' but 'what happens before X?'"

WRONG: "Your prefrontal cortex is exhausted."
RIGHT: "At 11 PM, you consistently make choices you regret (from your notes). Whatever the cause, the pattern is clear: decisions made after 10 PM are lower quality. This is an observable fact from YOUR data, not a theory."

Make it UNDENIABLE through their own patterns, not through psychological claims.]

## The Lever

[One specific action that changes the structure of the situation.

**The Action:** [Concrete, specific, doable]
**Why This Works (from first principles):** [Explain using logic, not psychology. How does this action change the system?]
**What Changes After:** [The new state after the action. What becomes possible that wasn't before?]

Note: This is about changing the structure so action becomes the path of least resistance — not about summoning effort.]

## The Test

[One sentence: how will they know the obstacle is cleared? Make it measurable, not feeling-based.]

═══════════════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════════════

1. NO RESEARCH — Never cite studies, psychology, neuroscience. If it could be debunked tomorrow, don't say it.
2. LOGIC ONLY — Every claim must be derivable from: math, logic, or patterns visible in the user's own notes.
3. THEIR DATA — Use the notes as the only source of truth about this person. Quote their patterns.
4. NO WILLPOWER — Don't ask them to summon effort. Change the structure so effort isn't needed.
5. MAKE VAGUE CONCRETE — Transform "I feel anxious" into "You mention X right before you avoid Y. The pattern is X→avoidance."
6. UNDERSTANDING = MOVEMENT — The explanation should make the obstacle feel solvable through comprehension.
7. ONE OBSTACLE, ONE LEVER — Find the single point of maximum leverage. Don't overwhelm.
8. IF NO OBSTACLE, SAY SO — Don't manufacture problems. Motion is valid.
9. BE HONEST ABOUT UNCERTAINTY — If you don't know, say "I can't determine this from your notes."

Tone: An engineer looking at a system that's stuck, finding the one constraint that, if removed, unlocks movement. No motivation. No psychology. Just mechanics.`

    const model = process.env.OPENROUTER_MODEL || 'google/gemini-3-pro-preview'

    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 14000,
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
