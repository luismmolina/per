/**
 * Backfill fact ledger from existing notes.
 *
 * Usage:
 *   npm run facts:sync
 *   npm run facts:sync -- --limit 10
 *   npm run facts:sync -- --base http://localhost:3000
 *
 * Requires the Next.js server running (uses POST /api/facts/sync).
 * Loops until remainingDirty is 0 or a pass processes nothing.
 */

const DEFAULT_BASE = process.env.FACTS_SYNC_BASE || 'http://localhost:3000'
const DEFAULT_LIMIT = 12
const MAX_ROUNDS = 80

function parseArgs(argv) {
  let base = DEFAULT_BASE
  let limit = DEFAULT_LIMIT

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--base' && argv[i + 1]) {
      base = argv[i + 1]
      i += 1
    } else if (arg === '--limit' && argv[i + 1]) {
      limit = Math.max(1, Math.min(40, Number(argv[i + 1]) || DEFAULT_LIMIT))
      i += 1
    }
  }

  return { base: base.replace(/\/$/, ''), limit }
}

async function main() {
  const { base, limit } = parseArgs(process.argv.slice(2))
  console.log(`[facts:sync] base=${base} limit=${limit}`)

  // Status first
  try {
    const statusRes = await fetch(`${base}/api/facts/sync`)
    const status = await statusRes.json()
    console.log('[facts:sync] status:', JSON.stringify({
      enabled: status.enabled,
      extractorVersion: status.extractorVersion,
      indexCount: status.indexCount,
      byStatus: status.byStatus,
      currentStateCount: status.currentStateCount,
    }, null, 2))

    if (status.enabled === false) {
      console.error('[facts:sync] facts disabled — set GEMINI_API_KEY or OPENCODE_API_KEY')
      process.exit(1)
    }
  } catch (error) {
    console.error(
      '[facts:sync] cannot reach API. Is `npm run dev` running?\n',
      error instanceof Error ? error.message : error,
    )
    process.exit(1)
  }

  let round = 0
  let totalProcessed = 0
  let totalFacts = 0

  while (round < MAX_ROUNDS) {
    round += 1
    const res = await fetch(`${base}/api/facts/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit }),
    })

    const body = await res.json()
    if (!res.ok || !body.success) {
      console.error('[facts:sync] error:', body.error || res.statusText)
      process.exit(1)
    }

    totalProcessed += body.processed || 0
    totalFacts += body.factsWritten || 0

    console.log(
      `[facts:sync] round ${round}: processed=${body.processed} failed=${body.failed} skipped=${body.skipped} facts=${body.factsWritten} remaining=${body.remainingDirty}`,
    )

    if (!body.remainingDirty || body.processed === 0) {
      console.log(`[facts:sync] done. totalProcessed=${totalProcessed} totalFacts=${totalFacts}`)
      break
    }
  }

  // Final sample
  const finalRes = await fetch(`${base}/api/facts/sync`)
  const finalStatus = await finalRes.json()
  console.log('[facts:sync] current_state sample:')
  for (const row of finalStatus.sampleState || []) {
    const prev = row.previous ? ` (was ${row.previous.value})` : ''
    console.log(`  - ${row.entity} / ${row.attribute}: ${row.value}${prev}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
