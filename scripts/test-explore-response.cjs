require('ts-node/register/transpile-only')

const assert = require('node:assert/strict')
const {
  extractMessageContent,
  normalizeExploreResult,
  parseExploreModelJson,
} = require('../lib/explore-response.ts')

function run(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

run('parseExploreModelJson extracts fenced JSON', () => {
  const value = parseExploreModelJson(`
Here is the result:
\`\`\`json
{"objective":"Increase profit"}
\`\`\`
`)

  assert.equal(value.objective, 'Increase profit')
})

run('parseExploreModelJson repairs truncated JSON', () => {
  const value = parseExploreModelJson(
    '{"objective":"Increase profit","questions":["What can we sell before the table?"'
  )

  assert.equal(value.objective, 'Increase profit')
  assert.deepEqual(value.questions, ['What can we sell before the table?'])
})

run('normalizeExploreResult filters invalid ideas and clamps scores', () => {
  const result = normalizeExploreResult({
    objective: 'Increase profit',
    summary: 'Look outside the buffet.',
    realityMap: {
      currentState: ['Sales are flat'],
      constraints: ['Labor is limited'],
      alreadyWorking: ['Beverage share increased'],
      underusedAssets: ['Reservations'],
    },
    opportunitySpaces: ['Monetize reservations'],
    alreadyThought: [
      { idea: 'No mixed tables', status: 'tested', evidence: 'You logged it multiple times.' },
      { idea: '', status: 'tested', evidence: 'Should be removed.' },
    ],
    adjacentIdeas: [
      {
        title: 'Reservation upsell',
        mechanism: 'Sell premium add-ons before arrival.',
        whyNew: 'Extension of reservation thinking.',
        whyItCouldWorkHere: 'Guests already ask about water incentives.',
        differsFromYourNotes: 'Pre-sells extras instead of only changing water rules.',
        risks: ['Could lower conversion if too pushy.'],
        noveltyScore: 12,
        fitScore: 8,
        upsideScore: 7,
        speedScore: 0,
        experiment: {
          name: '7-day reservation script',
          steps: ['Offer a premium add-on during reservation confirmation.'],
          successMetric: 'Take rate on the add-on.',
          successSignal: 'At least 20% attach rate.',
        },
      },
      {
        title: 'Broken idea',
        mechanism: 'Missing experiment should be dropped.',
        whyNew: 'Nope.',
        whyItCouldWorkHere: 'Nope.',
        differsFromYourNotes: 'Nope.',
        risks: [],
      },
    ],
    newIdeas: [],
    questions: ['What can be sold before arrival?'],
  }, 'Fallback objective')

  assert.equal(result.alreadyThought.length, 1)
  assert.equal(result.adjacentIdeas.length, 1)
  assert.equal(result.adjacentIdeas[0]?.noveltyScore, 10)
  assert.equal(result.adjacentIdeas[0]?.speedScore, 1)
})

run('extractMessageContent handles content-part arrays', () => {
  const content = extractMessageContent([
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'world' },
  ])

  assert.equal(content, 'Hello world')
})

console.log('All explore response checks passed.')
