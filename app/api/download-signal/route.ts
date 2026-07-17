import { NextResponse } from 'next/server'

import { getFactLedgerStatus, listAllFactEvents, listCurrentState } from '../../../lib/facts'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  return date.toISOString().slice(0, 10)
}

/**
 * GET /api/download-signal
 * Export the fact ledger (CURRENT STATE + all extracted facts) as a text file.
 */
export async function GET() {
  try {
    const [status, events, fullState] = await Promise.all([
      getFactLedgerStatus(),
      listAllFactEvents(),
      listCurrentState(),
    ])

    const currentStateBlock = fullState.length
      ? fullState
          .slice()
          .sort((a, b) => {
            const ent = a.entity.localeCompare(b.entity)
            if (ent !== 0) return ent
            return a.attribute.localeCompare(b.attribute)
          })
          .map((row) => {
            const unit = row.unit ? ` ${row.unit}` : ''
            const previous =
              row.previousValueText && row.previousAsOf
                ? `  (was ${row.previousValueText}${unit} on ${formatDay(row.previousAsOf)})`
                : ''
            return `- ${row.entity} / ${row.attribute}: ${row.valueText}${unit} [${row.polarity}, as of ${formatDay(row.asOf)}]${previous}`
          })
          .join('\n')
      : '(No current state yet — run Signal extract until notes are processed.)'

    const chronological = events
      .slice()
      .sort((a, b) => new Date(a.asOf).getTime() - new Date(b.asOf).getTime())

    const eventsBlock = chronological.length
      ? chronological
          .map((event) => {
            const unit = event.unit ? ` ${event.unit}` : ''
            const raw = event.rawSpan
              ? ` | raw: "${event.rawSpan.replace(/\s+/g, ' ').trim()}"`
              : ''
            return `[${formatDate(event.asOf)}] ${event.entity} / ${event.attribute}: ${event.valueText}${unit} [${event.polarity}, conf ${event.confidence.toFixed(2)}] note:${event.sourceNoteId.slice(0, 12)}${raw}`
          })
          .join('\n')
      : '(No fact events yet.)'

    const supersessions = fullState
      .filter((row) => row.previousValueText && row.previousAsOf)
      .sort((a, b) => new Date(b.asOf).getTime() - new Date(a.asOf).getTime())
      .map((row) => {
        const unit = row.unit ? ` ${row.unit}` : ''
        return `- ${formatDay(row.asOf)} · ${row.entity} / ${row.attribute}: ${row.previousValueText}${unit} → ${row.valueText}${unit}`
      })
      .join('\n')

    const header = `=== Signal Export (fact ledger) ===
Extractor: ${status.extractorVersion}
Enabled: ${status.enabled}
Notes in app: ${status.totalNotes}
Notes processed (done+skipped): ${status.processedCount}
  - with facts: ${status.byStatus.done}
  - no signal / skipped: ${status.byStatus.skipped}
  - failed: ${status.byStatus.failed}
Remaining to process: ${status.remainingDirty}
State keys: ${fullState.length}
Fact events: ${events.length}
Exported: ${new Date().toISOString()}
${'='.repeat(50)}

`

    const body = `## CURRENT STATE
(Authoritative values — prefer over raw notes for numbers and policies)

${currentStateBlock}

## RECENT SUPERSESSIONS (was → now)
${supersessions || '(None with a previous value recorded.)'}

## ALL FACT EVENTS (chronological)
(Atomic claims extracted from notes — includes measurements, decisions, estimates, plans)

${eventsBlock}
`

    const filename = `signal-${new Date().toISOString().split('T')[0]}.txt`

    return new NextResponse(header + body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('Failed to download signal:', error)
    return new NextResponse('Failed to download signal export', { status: 500 })
  }
}
