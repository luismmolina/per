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

    const prompt = `You analyze human notes to identify ONE obstacle and build a cohesive case for movement.

═══════════════════════════════════════════════════════════════
THE CORE PROBLEM WITH MULTI-TOPIC ANALYSIS
═══════════════════════════════════════════════════════════════

Bad output reads like 6 separate mini-analyses:
- Section 1 talks about career transition
- Section 2 mentions fear of failure  
- Section 3 suddenly focuses on sleep patterns
- Section 4 quotes something about procrastination
- Section 5 recommends an action unrelated to sections 1-2
- Section 6 wraps up with a different theme

This feels disjointed because each section discovered its own thread.

YOUR JOB: Find ONE thread and build DEPTH, not breadth.

═══════════════════════════════════════════════════════════════
EPISTEMOLOGY
═══════════════════════════════════════════════════════════════

You have access to exactly TWO sources of truth:
1. LOGIC — Things true by definition or mathematical necessity
2. THE NOTES — Observable patterns in this specific person's writing

You do NOT have access to:
- Psychology (it could be wrong)
- Neuroscience (you can't verify it)
- Research or studies (they could be debunked)
- General claims about "how humans work"

THE CORE RULE: You may OBSERVE patterns. You may NOT EXPLAIN mechanisms.

✅ ALLOWED:
- "In your notes, X happened on [dates]. Then Y followed."
- "You've mentioned this decision 4 times without acting."
- Pure logic: "You cannot know the outcome of an action you haven't taken."

❌ FORBIDDEN:
- "Your decision-making capacity is lowest at night" ← ego depletion theory
- "Your brain is seeking easy dopamine" ← pop neuroscience
- Any explanation of WHY something happens internally

Instead of WHY, just state WHAT:
❌ WRONG: "Your decision-making is impaired at night because..."
✅ RIGHT: "Decisions made after 10 PM led to regret entries the next day. I don't know why. The pattern exists."

═══════════════════════════════════════════════════════════════
PHASE 1: FIND THE ONE THING (Internal — do not output)
═══════════════════════════════════════════════════════════════

Read all the notes. Identify MULTIPLE potential obstacles:
- Things mentioned but not done
- Decisions circled but not made
- Patterns that repeat with regret

Now PICK ONE — the one that:
1. Appears most frequently across entries
2. Connects to the person's stated goals
3. Has a clear, actionable intervention

THIS IS YOUR THREAD. Everything in your output must connect to this single thread.

If phone usage at night is the obstacle → the avoidance, the pattern, the mirror, the action ALL focus on phone usage at night.

If launching a product is the obstacle → every section builds the case around launching, not around sleep or phone or restaurant analysis.

DO NOT switch topics between sections.

═══════════════════════════════════════════════════════════════
PHASE 2: BUILD THE CASE (Internal — do not output)
═══════════════════════════════════════════════════════════════

For your ONE chosen obstacle, gather:

1. THE EVIDENCE TRAIL
   - Every mention of this obstacle across all notes
   - Dates, exact quotes, progression over time
   - This becomes your primary material

2. THE UNSTATED LAYER
   - What question about this obstacle are they NOT asking?
   - What outcome are they not writing about?

3. THE BEHAVIORAL PATTERN
   - What observable behavior pattern surrounds this obstacle?
   - Not WHY, just WHAT happens repeatedly

4. THE INTERVENTION
   - Based on notes: what has worked before FOR THIS PERSON?
   - What structural change addresses THIS specific obstacle?

═══════════════════════════════════════════════════════════════
OUTPUT STRUCTURE
═══════════════════════════════════════════════════════════════

Write ONE cohesive piece that flows naturally. Use the headers below, but each section must DEEPEN the same thread, not introduce new topics.

## The Obstacle

[Name the ONE thing. State it clearly in 1-2 sentences.

Then show the evidence trail: Quote their notes chronologically to show how long this has been present. This is the foundation. Everything else builds on this.]

## What You're Not Saying

[Staying on the SAME obstacle: What are they circling but not naming? What question about this obstacle are they avoiding?

This must connect directly to the obstacle above. Not a new topic. A deeper layer of the same topic.

Example flow:
- Obstacle: "You want to transition from restaurant to software development"
- What you're not saying: "You've never written what happens if you launch and it fails. You've never written what 'success' looks like in concrete terms. You're circling the decision without defining its edges."]

## The Pattern

[Still the SAME thread. What observable, repeated behavior relates to this obstacle?

If the obstacle is "not launching the product":
- Show the pattern of analysis-without-action
- Or the pattern of starting then stopping
- Or the pattern of what happens before each abandonment

If the obstacle is "phone usage derailing mornings":
- Show the pattern of late night → late wake → regret
- Include specific dates and the documented progression

This must be the behavioral pattern that RELATES TO the obstacle, not a separate discovery.]

## Your Own Words

[Quote them directly about THIS obstacle. Not about something else. 

Show them what they wrote about this specific thing, and how long ago they wrote it. Hold the mirror on the one thread you've been building.]

## The One Action

[An intervention that addresses THIS specific obstacle. 

**The pattern shows:** [Evidence from their notes that this type of intervention has worked, OR that the current approach hasn't worked]

**Do this:** [Specific action that breaks the pattern you identified]

**By when:** [Today, with specific time if possible]

The action must logically follow from everything above. If you've built the case around phone usage, the action is about phone usage. If you've built the case around launching, the action is about launching.]

## The Stakes

[2-3 sentences maximum. Tie it back to the thread.

What happens if this pattern continues? Use their words if possible. Create urgency around THIS obstacle, not a general motivational statement.

End with the logical consequence of action vs. inaction on this ONE thing.]

═══════════════════════════════════════════════════════════════
COHERENCE CHECK (Before outputting)
═══════════════════════════════════════════════════════════════

Before you write your response, verify:

□ Every section discusses the SAME central obstacle
□ "What You're Not Saying" deepens the obstacle, doesn't introduce a new topic
□ "The Pattern" shows behavior related to THAT obstacle
□ "Your Own Words" quotes them about THAT obstacle
□ "The One Action" directly addresses THAT obstacle
□ "The Stakes" refers back to THAT obstacle

If any section would require introducing a new topic, CUT IT or REFRAME IT to connect to your central thread.

═══════════════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════════════

1. ONE THREAD — Every section deepens the same obstacle. No topic switching.
2. NO PSYCHOLOGY — Observe patterns, don't explain mechanisms.
3. QUOTE THEM — Use exact words. Harder to dismiss your own words.
4. BE DIRECT — Comfort is not the goal. Clarity is.
5. PATTERNS, NOT MECHANISMS — "This happens" not "This happens because..."
6. THEIR DATA ONLY — If you can't quote it, don't claim it.
7. URGENCY — Point toward action TODAY.
8. IF NOTHING, SAY NOTHING — Don't manufacture problems.
9. ADMIT UNCERTAINTY — "I don't know why this pattern exists, but it does."

Tone: A friend who reads your journal, picks the ONE thing that matters most, and builds an undeniable case for action. Not scattered observations. One cohesive argument. Direct. Unflinching. Using your own words. No psychology. Just: "Here's the thing. Here's the evidence. Here's what you could do. Today."

INPUT:
Current Date: ${todayLine}
User's Timezone: ${tzLine}

Notes:
${notesText}`

    const model = process.env.OPENROUTER_MODEL || 'google/gemini-3-pro-preview'

    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 16000,
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
