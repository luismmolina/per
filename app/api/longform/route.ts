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

## What You're Avoiding

[Search the notes for things the person has mentioned doing, wanting to do, or needing to do — but hasn't done.

Quote them directly. Be specific. Be uncomfortable.

Example: "On Nov 15: 'I need to call the supplier.' On Nov 22: 'Still haven't called.' On Dec 3: 'I really should call.' On Dec 10: 'Why haven't I called yet?'"

Four entries. No call. That's the pattern. Name it.]

## The Thing You Haven't Said

[Look for what they're circling but not naming. The topic they approach and retreat from. The question they're not asking.

Don't explain WHY they're avoiding it. Just surface it.

"You've mentioned X seven times. You've never written what happens if X fails. You've never written what happens if X succeeds. You're circling the decision without landing on it."]

## The Pattern (Not The Reason)

[Show them their own pattern. NOT why it happens. Just THAT it happens.

❌ WRONG: "You avoid this because you fear rejection."
✅ RIGHT: "Every time you write about doing X, the next entry is about something else. X appears, then disappears. That's happened 6 times in these notes."

❌ WRONG: "Your willpower is lowest at night."
✅ RIGHT: "Entries written after 10 PM: 8 total. Entries containing regret the next day: 6 of those 8. I don't know why. That's the pattern."

Let the pattern speak for itself. It's more powerful than any explanation.]

## The Mirror

[Use their own words. Hold them up. Don't soften them.

"You wrote: '[exact quote from notes].' That was [X days/weeks] ago. What's different now?"

This isn't cruelty. It's showing them what they already know but haven't looked at directly.]

## The One Action

[Based on patterns in the notes — what has actually worked for this person before? What got them to move?

If the notes show they act when [X], suggest [X].
If the notes show they succeed in the morning, suggest morning.
If the notes show external commitments work, suggest one.

**Do this:** [Specific action]
**By when:** [Time frame — ideally today]
**Because the pattern shows:** [Reference to their notes showing this approach has worked]

Don't explain why this works psychologically. Just show the pattern that suggests it might.]

## The Truth

[2-3 sentences maximum. Direct. Using their words.

The structure:
1. Quote their own fear or avoidance
2. How long they've been circling it
3. What changes if they act TODAY

End with something that creates urgency. Not motivation. Just truth.

Example endings (adapt to their specific situation):
- "The pattern will repeat tomorrow unless you interrupt it today."
- "You already know what to do. You wrote it yourself on [date]."
- "Another entry analyzing this decision creates another data point for 'analyzed but not acted.' Break the pattern."]

═══════════════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════════════

1. NO PSYCHOLOGY — Don't explain WHY they feel or act this way. You don't know. Just show WHAT the notes reveal.
2. QUOTE THEM — Use their exact words whenever possible. It's harder to dismiss your own words.
3. BE DIRECT — Don't soften the truth. Comfort is not the goal. Clarity is.
4. PATTERNS, NOT MECHANISMS — "This happens" not "This happens because..."
5. THEIR DATA ONLY — Every claim must be visible in the notes. If you can't quote it, don't claim it.
6. URGENCY — Always point toward action TODAY. Not "someday." Not "when you're ready."
7. ONE OBSTACLE — Find the most important thing, not everything.
8. IF NOTHING, SAY NOTHING — If the notes show motion and no avoidance, acknowledge that. Don't manufacture problems.
9. ADMIT UNCERTAINTY — "I don't know why this pattern exists, but it does."

Tone: A friend who reads your journal and says the thing you've been avoiding hearing. Direct. Unflinching. Using your own words. No psychology. No theories. Just: "Here's what you wrote. Here's the pattern. Here's what you could do. Today."`

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
