import { listCurrentState } from './store'
import type { CurrentStateRecord } from './types'

/** Hard ceiling for the CURRENT STATE block alone (within shared total budget). */
const DEFAULT_MAX_STATE_CHARS = 12000

/** Approximate size of section headers when combining state + notes. */
const COMBINE_OVERHEAD_CHARS = 320

/**
 * Never let state consume the entire memory budget — keep room for narrative notes.
 * Fraction of the *shared* total reserved as max for compressed facts.
 */
const MAX_STATE_FRACTION_OF_TOTAL = 0.45

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
  const claim = record.claim?.trim()
    || `${record.entity} / ${record.attribute}: ${formatValue(record)}`
  const previous = record.previousClaim
    ? `  (was: ${record.previousClaim})`
    : record.previousValueText && record.previousAsOf
      ? `  (was ${record.previousValueText}${record.unit ? ` ${record.unit}` : ''} on ${formatDate(record.previousAsOf)})`
      : ''

  return `- ${claim} [${record.polarity}, as of ${formatDate(record.asOf)}]${previous}`
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
      if (row.previousClaim && row.claim) {
        return `- ${formatDate(row.asOf)} · ${row.previousClaim} → ${row.claim}`
      }
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

export interface WorldStateBudget {
  worldState: string
  /** Chars remaining for raw note lines after state + section headers. */
  notesBudgetChars: number
  /** Shared total budget this split was computed for. */
  totalBudgetChars: number
  stateChars: number
}

/**
 * Split a *shared* memory budget between CURRENT STATE and raw notes.
 * State is loaded first; notes only fill what is left so we do not stack
 * full note windows on top of compressed facts.
 */
export async function loadWorldStateForPromptBudget(
  totalBudgetChars: number,
): Promise<WorldStateBudget> {
  const safeTotal = Math.max(0, Math.floor(totalBudgetChars))
  const maxStateChars = Math.min(
    DEFAULT_MAX_STATE_CHARS,
    Math.max(0, Math.floor(safeTotal * MAX_STATE_FRACTION_OF_TOTAL)),
  )

  const worldState = maxStateChars > 0
    ? await formatWorldStateForPrompt({ maxStateChars })
    : ''

  if (!worldState) {
    return {
      worldState: '',
      notesBudgetChars: safeTotal,
      totalBudgetChars: safeTotal,
      stateChars: 0,
    }
  }

  const stateChars = worldState.length
  const notesBudgetChars = Math.max(0, safeTotal - stateChars - COMBINE_OVERHEAD_CHARS)

  return {
    worldState,
    notesBudgetChars,
    totalBudgetChars: safeTotal,
    stateChars,
  }
}

/**
 * Combine pre-loaded world state with already-budgeted note text.
 * Prefer loadWorldStateForPromptBudget → select notes → this, so totals stay bounded.
 */
export function combineWorldStateAndNotes(worldState: string, notesText: string): string {
  if (!worldState?.trim()) {
    return notesText
  }

  const notesBlock = notesText?.trim()
    ? `═══════════════════════════════════════════════════════════════
RECENT / SELECTED NOTES (narrative only — quantities prefer CURRENT STATE above)
═══════════════════════════════════════════════════════════════
${notesText}`
    : '(No additional notes in remaining budget after CURRENT STATE.)'

  return `${worldState}\n\n${notesBlock}`
}

/**
 * @deprecated Prefer loadWorldStateForPromptBudget + select notes under notesBudgetChars +
 * combineWorldStateAndNotes so compressed state does not increase total context.
 * Kept for any external callers: uses a default shared total of 28k.
 */
export async function prependWorldStateToNotes(notesText: string): Promise<string> {
  const { worldState, notesBudgetChars } = await loadWorldStateForPromptBudget(28_000)
  // Caller already selected notes without knowing the budget — only combine, cannot shrink.
  // Truncate raw notes if they exceed the remaining budget so we still do not explode context.
  let trimmed = notesText?.trim() ?? ''
  if (trimmed.length > notesBudgetChars) {
    trimmed = `${trimmed.slice(0, Math.max(0, notesBudgetChars - 1)).trimEnd()}…`
  }
  return combineWorldStateAndNotes(worldState, trimmed)
}
