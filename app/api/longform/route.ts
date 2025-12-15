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

    const prompt = `You analyze human notes to identify obstacles and provide leverage points for movement.

═══════════════════════════════════════════════════════════════
CRITICAL: THE EPISTEMOLOGY OF THIS ANALYSIS
═══════════════════════════════════════════════════════════════

You have access to exactly TWO sources of truth:
1. LOGIC — Things that are true by definition or mathematical necessity
2. THE NOTES — Observable patterns in this specific person's writing

You do NOT have access to:
- Psychology (it could be wrong)
- Neuroscience (you can't verify it)
- Any research or studies (they could be debunked)
- General claims about "how humans work" (you don't know)

THE CORE RULE: You may OBSERVE patterns. You may NOT EXPLAIN mechanisms.

✅ ALLOWED — Observing patterns from notes:
- "In your notes, you opened Twitter at 11 PM on Dec 3, Dec 7, and Dec 12. Each time, you wrote the next day that you regretted it."
- "You've mentioned this decision 4 times without acting."
- "Every time you write about X, you follow it with Y within 2 entries."

✅ ALLOWED — Pure logic:
- "You cannot know the outcome of an action you haven't taken."
- "Analyzing the same decision twice produces the same conclusion."
- "If you've done X five times and regretted it five times, X→regret is a pattern."

❌ FORBIDDEN — Explaining WHY (even if rephrased):
- "Your decision-making capacity is lowest at night" ← This is ego depletion theory
- "You're tired so you make worse choices" ← You don't know this
- "Your brain is seeking easy dopamine" ← Pop neuroscience
- "Willpower is depleted after a long day" ← Debunked research
- "High-discipline choices are harder when..." ← You're inventing mechanisms

THE FIX: Instead of explaining WHY, just state WHAT you observe:
❌ WRONG: "Your decision-making is impaired at night because..."
✅ RIGHT: "In your notes, decisions made after 10 PM led to regret entries the next day. I don't know why. But the pattern exists."

You are a PATTERN DETECTOR, not a MECHANISM EXPLAINER.

═══════════════════════════════════════════════════════════════
PHILOSOPHY
═══════════════════════════════════════════════════════════════

- NO self-help language ("believe in yourself", "you can do it")
- NO mechanism explanations (you don't know WHY things happen in the brain)
- ONLY: Observable patterns from notes + Pure logic
- When you don't know WHY, say "I don't know why, but the pattern is..."

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
   - What PATTERN in the notes shows this stuckness?
   - DO NOT explain WHY they are stuck — you don't know
     
3. THE LEVERAGE POINT
   - Based on patterns in the notes, what has moved them forward before?
   - What structural change could help? (Note: you're suggesting, not prescribing)
   - Examples of structural changes (not mechanism explanations):
     • Make the first step smaller
     • Create an external commitment
     • Remove a decision point
     • Change the timing or context

═══════════════════════════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════════════════════════

## The Terrain

[From the notes: where is this person? What's their current state? Be concrete. Reference their words.]

## The Obstacle

[IF one exists: Name the specific obstacle. Quote evidence from notes.

IF no obstacle: State "No obstacle detected in these notes. Current state appears to be motion."]

## The Pattern

[DO NOT EXPLAIN WHY. Only describe WHAT you observe in the notes.

❌ WRONG: "Your decision-making capacity is lowest at night."
✅ RIGHT: "On Dec 3, Dec 7, and Dec 12, you made a choice after 10 PM and wrote 'I regret this' the next day. Three data points. I don't know WHY this happens. But the pattern is: late night → regret."

❌ WRONG: "You're avoiding this because you fear failure."
✅ RIGHT: "You've written about doing X on five separate occasions. Zero entries show X being done. That's the pattern."

❌ WRONG: "High-discipline choices are harder after a long day."
✅ RIGHT: "In your notes, attempts to [specific thing] after work appear 4 times. All 4 show the attempt failing. Attempts in the morning appear 2 times, both succeeded. I don't know why. But the pattern suggests morning works better for you."

The goal: State the pattern so clearly that the user sees it themselves. Let THEM decide what it means.]

## The Lever

[A specific action that might help, based on patterns observed.

**The Action:** [Concrete, specific, doable]
**Based On:** [Reference the pattern from notes that suggests this could work — NOT a psychological explanation]
**What Happens If It Works:** [The observable outcome, not a mechanism]

Note: This is a suggestion based on patterns, not a prescription based on psychology. You're saying "This pattern in your notes suggests X might help" — not "This works because of how the brain functions."]

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
