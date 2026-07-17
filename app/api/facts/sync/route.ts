import { NextRequest, NextResponse } from 'next/server'

import {
  FACT_EXTRACTOR_VERSION,
  getFactLedgerStatus,
  isNoteFactsEnabled,
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
    const status = await getFactLedgerStatus(conversations)

    return NextResponse.json({
      success: true,
      extractorVersion: FACT_EXTRACTOR_VERSION,
      ...result,
      status,
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
 * Status of fact index + sample of current state (for UI).
 */
export async function GET() {
  try {
    const status = await getFactLedgerStatus()
    return NextResponse.json(status)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
