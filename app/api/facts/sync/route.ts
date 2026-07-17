import { NextRequest, NextResponse } from 'next/server'

import {
  FACT_EXTRACTOR_VERSION,
  isNoteFactsEnabled,
  listCurrentState,
  listFactIndexRecords,
  syncConversationNoteFacts,
} from '../../../../lib/facts'
import { loadConversations } from '../../../../lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/facts/sync
 * Process dirty notes into the fact ledger (backfill / catch-up).
 *
 * Body: { limit?: number }  — max notes to process (default 15, max 40)
 */
export async function POST(req: NextRequest) {
  if (!isNoteFactsEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Note facts disabled. Set ENABLE_NOTE_FACTS=true (default) and provide GEMINI_API_KEY or OPENCODE_API_KEY.',
      },
      { status: 400 },
    )
  }

  let limit = 15
  try {
    const body = await req.json().catch(() => ({}))
    if (typeof body?.limit === 'number' && Number.isFinite(body.limit)) {
      limit = Math.max(1, Math.min(40, Math.floor(body.limit)))
    }
  } catch {
    // empty body is fine
  }

  try {
    const conversations = await loadConversations()
    const result = await syncConversationNoteFacts(conversations, { maxNotes: limit })

    return NextResponse.json({
      success: true,
      extractorVersion: FACT_EXTRACTOR_VERSION,
      ...result,
      hint:
        result.remainingDirty > 0
          ? `Call again to process remaining ${result.remainingDirty} dirty notes.`
          : 'All notes are up to date for this extractor version.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[facts/sync] failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * GET /api/facts/sync
 * Status of fact index + sample of current state.
 */
export async function GET() {
  try {
    const [index, state] = await Promise.all([
      listFactIndexRecords(),
      listCurrentState(),
    ])

    const byStatus = {
      done: 0,
      skipped: 0,
      failed: 0,
      pending: 0,
    }
    for (const row of index) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
    }

    const staleVersion = index.filter(
      (row) => row.extractorVersion !== FACT_EXTRACTOR_VERSION,
    ).length

    return NextResponse.json({
      enabled: isNoteFactsEnabled(),
      extractorVersion: FACT_EXTRACTOR_VERSION,
      indexCount: index.length,
      byStatus,
      staleVersion,
      currentStateCount: state.length,
      sampleState: state.slice(0, 40).map((row) => ({
        entity: row.entity,
        attribute: row.attribute,
        value: row.valueText,
        unit: row.unit,
        polarity: row.polarity,
        asOf: row.asOf,
        previous: row.previousValueText
          ? { value: row.previousValueText, asOf: row.previousAsOf }
          : null,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
