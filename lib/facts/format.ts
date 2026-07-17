import { listCurrentState } from './store'
import type { CurrentStateRecord } from './types'

const DEFAULT_MAX_STATE_CHARS = 12000
const DEFAULT_MAX_RECENT_CHANGES = 25

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 10)
}

function formatValue(record: Pick<CurrentStateRecord, 'valueText' | 'unit'>): string {
  if (record.unit) {
    return `${record.valueText} ${record.unit}`.trim()
  }
  return record.valueText
}

function formatStateLine(record: CurrentStateRecord): string {
  const value = formatValue(record)
  const previous =
    record.previousValueText && record.previousAsOf
      ? `  (was ${record.previousValueText}${record.unit ? ` ${record.unit}` : ''} on ${formatDate(record.previousAsOf)})`
      : ''

  return `- ${record.entity} / ${record.attribute}: ${value} [${record.polarity}, as of ${formatDate(record.asOf)}]${previous}`
}

/**
 * Dense authoritative block for AI prompts. Prefer this over prose for numbers/policies.
 * Built only from current_state (no full fact_events scan on every request).
 */
export async function formatWorldStateForPrompt(options?: {
  maxStateChars?: number
  maxRecentChanges?: number
}): Promise<string> {
  const maxStateChars = options?.maxStateChars ?? DEFAULT_MAX_STATE_CHARS
  const maxRecentChanges = options?.maxRecentChanges ?? DEFAULT_MAX_RECENT_CHANGES

  let stateRows: CurrentStateRecord[] = []
  try {
    stateRows = await listCurrentState()
  } catch (error) {
    console.warn(
      '[facts] failed to load current_state:',
      error instanceof Error ? error.message : error,
    )
    return ''
  }

  if (!stateRows.length) {
    return ''
  }

  // Prefer measurements/decisions first, then estimates, then identity/constraints
  const polarityRank: Record<string, number> = {
    measurement: 0,
    decision: 1,
    constraint: 2,
    estimate: 3,
    identity: 4,
  }

  const sorted = [...stateRows].sort((left, right) => {
    const pr =
      (polarityRank[left.polarity] ?? 9) - (polarityRank[right.polarity] ?? 9)
    if (pr !== 0) return pr
    return new Date(right.asOf).getTime() - new Date(left.asOf).getTime()
  })

  const stateLines: string[] = []
  let stateChars = 0

  for (const row of sorted) {
    const line = formatStateLine(row)
    if (stateChars + line.length + 1 > maxStateChars) break
    stateLines.push(line)
    stateChars += line.length + 1
  }

  // Supersessions only (rows that have a previous value) — signal of what changed
  const recentLines = [...stateRows]
    .filter((row) => row.previousValueText && row.previousAsOf)
    .sort((left, right) => new Date(right.asOf).getTime() - new Date(left.asOf).getTime())
    .slice(0, maxRecentChanges)
    .map((row) => {
      const unit = row.unit ? ` ${row.unit}` : ''
      return `- ${formatDate(row.asOf)} · ${row.entity} / ${row.attribute}: ${row.previousValueText}${unit} → ${row.valueText}${unit}`
    })

  const parts = [
    '═══════════════════════════════════════════════════════════════',
    'CURRENT STATE (authoritative for numbers & policies — prefer over prose notes)',
    'When a note conflicts with this block, prefer the later as-of fact and cite both.',
    '═══════════════════════════════════════════════════════════════',
    stateLines.join('\n'),
  ]

  if (recentLines.length) {
    parts.push(
      '',
      'RECENT SUPERSESSIONS (was → now):',
      recentLines.join('\n'),
    )
  }

  return parts.join('\n')
}

/**
 * Prepend world state to a notes context string for any AI route.
 */
export async function prependWorldStateToNotes(notesText: string): Promise<string> {
  const worldState = await formatWorldStateForPrompt()
  if (!worldState) return notesText

  const notesBlock = notesText?.trim()
    ? `═══════════════════════════════════════════════════════════════
RECENT / SELECTED NOTES (narrative evidence — lower trust than CURRENT STATE for quantities)
═══════════════════════════════════════════════════════════════
${notesText}`
    : '(No recent notes in budget.)'

  return `${worldState}\n\n${notesBlock}`
}
