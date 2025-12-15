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

    const prompt = `You analyze human notes to identify obstacles and explain them through first principles — the mechanical, causal reasons why someone is stuck, and the specific leverage points that create movement.

PHILOSOPHY:
- NO self-help language ("believe in yourself", "you can do it", "face your fears")
- NO willpower-based solutions (willpower is finite and unreliable)
- ONLY mechanical explanations: cause → effect, system dynamics, physics analogies
- Make the vague CONCRETE: transform fuzzy feelings into understandable mechanisms
- The explanation itself should create movement — understanding WHY something is stuck reveals HOW it moves

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
     Examples of mechanical reasons:
     • Information asymmetry (they lack data that only action provides)
     • Local minimum trap (current position feels "safe" but is suboptimal)
     • Prediction error (brain is using old data to predict new situations)
     • Energy accounting (perceived cost of action > perceived cost of inaction)
     • Identity protection (the action threatens how they see themselves)
     • Optionality hoarding (keeping options open = closing the option to act)
     
3. THE LEVERAGE POINT
   - What single change in the system creates movement?
   - NOT motivation. NOT willpower. What changes the PHYSICS of the situation?
     Examples:
     • Reduce activation energy (make the first step smaller)
     • Change the information state (one data point changes the prediction)
     • Shift the cost function (make inaction more expensive than action)
     • Create irreversibility (remove the escape route, forcing forward motion)
     • External commitment (bind future-self to present-decision)

═══════════════════════════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════════════════════════

## The Terrain

[From the notes: where is this person? What's their current state? Be concrete. Reference their words.]

## The Obstacle

[IF one exists: Name the specific obstacle. Quote evidence from notes.

IF no obstacle: State "No obstacle detected in these notes. Current state appears to be motion."]

## The Mechanism

[THIS IS THE CORE. Explain WHY they are stuck in mechanical/physics terms.

Do NOT say: "You're afraid of failure"
DO say: "Your brain is running a prediction: 'If I try X, I will experience Y.' This prediction is based on [specific past data from notes or implied]. But predictions require data. You have zero data points for this specific action. Your brain is predicting from adjacent experiences, which is unreliable. The only way to update the prediction is to create one data point."

Do NOT say: "You need to take action"
DO say: "You're in a local minimum. The energy to leave feels higher than the energy to stay. But you're measuring the wrong variable. You're measuring immediate discomfort (high) vs immediate comfort (low). The correct measurement is: cumulative cost of staying (compounds daily) vs one-time cost of moving (fixed). Here's the real math..."

Make it UNDENIABLE through logic, not motivating through emotion.]

## The Lever

[One specific action that changes the physics of the situation.

**The Action:** [Concrete, specific, doable]
**Why This Works (mechanically):** [Explain the causal chain — how this action changes the system state]
**What Changes After:** [The new state after the action. What becomes possible that wasn't before?]

Note: This is NOT about summoning willpower. It's about understanding that this specific action is the minimum energy input that shifts the system.]

## The Test

[One sentence: how will they know the obstacle is cleared? Make it measurable, not feeling-based.]

═══════════════════════════════════════════════════════════════
RULES:
═══════════════════════════════════════════════════════════════

1. FIRST PRINCIPLES ONLY — Explain mechanisms, not feelings. Why does this happen? What causes what?
2. NO WILLPOWER — Never suggest "just do it." Find the lever that makes action the path of least resistance.
3. PHYSICS LANGUAGE — Use: energy, momentum, equilibrium, data, prediction, measurement, system state, optimization, local minimum, feedback loops.
4. MAKE VAGUE CONCRETE — Transform "I feel anxious" into "Your brain is predicting [specific outcome] because [specific reason], but this prediction has [specific flaw]."
5. EVIDENCE FROM NOTES — All claims reference the user's actual notes, not hypotheticals.
6. UNDERSTANDING = MOVEMENT — The explanation should make the obstacle feel solvable through comprehension, not motivation.
7. ONE OBSTACLE, ONE LEVER — Don't overwhelm. Find the single point of maximum leverage.
8. IF NO OBSTACLE, SAY SO — Don't manufacture problems. Motion is valid.

Tone: An engineer explaining why a machine is jammed and which specific bolt to turn. Not a coach. Not a therapist. A systems analyst who happens to be analyzing a human system.`

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
