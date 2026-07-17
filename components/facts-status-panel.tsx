'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Database, Download, Loader2, RefreshCw, X } from 'lucide-react'

export interface FactLedgerStatusPayload {
  enabled: boolean
  extractorVersion: string
  totalNotes: number
  indexCount: number
  processedCount: number
  remainingDirty: number
  percentComplete: number
  byStatus: {
    done: number
    skipped: number
    failed: number
    pending: number
  }
  staleVersion: number
  currentStateCount: number
  sampleState: Array<{
    entity: string
    attribute: string
    claim?: string
    value: string
    unit: string | null
    polarity: string
    asOf: string
    previous: { value: string; claim?: string | null; asOf: string | null } | null
  }>
  error?: string
}

function formatAsOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

export function FactsStatusPanel() {
  const [status, setStatus] = useState<FactLedgerStatusPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoadError(null)
      const res = await fetch('/api/facts/sync')
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setStatus(data as FactLedgerStatusPayload)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => {
      void refresh()
    }, 45_000)
    return () => window.clearInterval(id)
  }, [refresh])

  const runSyncBatch = async () => {
    setSyncing(true)
    setLastSyncMessage(null)
    try {
      const res = await fetch('/api/facts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 12 }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      if (data.status) {
        setStatus(data.status as FactLedgerStatusPayload)
      } else {
        await refresh()
      }
      setLastSyncMessage(
        `Batch: +${data.processed ?? 0} notes, ${data.factsWritten ?? 0} facts` +
          (data.remainingDirty > 0 ? ` · ${data.remainingDirty} left` : ' · complete'),
      )
    } catch (error) {
      setLastSyncMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncing(false)
    }
  }

  const processed = status?.processedCount ?? 0
  const total = status?.totalNotes ?? 0
  const remaining = status?.remainingDirty ?? 0
  const percent = status?.percentComplete ?? 0
  const disabled = status && !status.enabled

  // Compact on mobile so the header row does not collide with export buttons.
  const badgeLabelShort = loading
    ? '…'
    : disabled
      ? 'off'
      : total === 0
        ? '—'
        : remaining === 0
          ? `${processed}/${total}`
          : `${processed}/${total}`

  const badgeLabelFull = loading
    ? 'Signal …'
    : disabled
      ? 'Signal off'
      : total === 0
        ? 'Signal —'
        : remaining === 0
          ? `Signal ${processed}/${total}`
          : `Signal ${processed}/${total} · ${remaining} left`

  const badgeTone = disabled
    ? 'text-text-muted border-line'
    : remaining > 0
      ? 'text-accent-amber border-accent-amber/30'
      : 'text-accent-green border-accent-green/30'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`t-btn t-btn-ghost inline-flex max-w-[7.25rem] items-center gap-1 border px-2 sm:max-w-none sm:gap-1.5 sm:px-3 ${badgeTone}`}
        title={badgeLabelFull}
        aria-label={badgeLabelFull}
      >
        <Database className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate font-mono text-[10px] tracking-wide tabular-nums">
          <span className="sm:hidden">{badgeLabelShort}</span>
          <span className="hidden sm:inline">{badgeLabelFull}</span>
        </span>
        {!loading && !disabled && total > 0 && (
          <span className="hidden font-mono text-[9px] text-text-muted tabular-nums sm:inline">
            {percent}%
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default bg-black/40"
              aria-label="Close signal panel"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full z-50 mt-2 w-[min(100vw-1.5rem,22rem)] border border-line bg-background-raised/98 p-3 shadow-xl backdrop-blur-md"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-primary">
                    Signal ledger
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-text-muted">
                    Facts extracted from notes → CURRENT STATE for AI
                  </div>
                </div>
                <button
                  type="button"
                  className="t-btn t-btn-ghost p-1.5"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {loadError && (
                <p className="mb-2 font-mono text-[11px] text-accent-red">{loadError}</p>
              )}

              {status && !status.enabled && (
                <p className="mb-2 font-mono text-[11px] text-accent-amber">
                  Extraction off. Set GEMINI_API_KEY or OPENCODE_API_KEY (and ENABLE_NOTE_FACTS≠false).
                </p>
              )}

              {status && (
                <>
                  <div className="mb-2 h-1.5 w-full overflow-hidden bg-line-faint">
                    <div
                      className="h-full bg-accent-amber transition-all duration-300"
                      style={{ width: `${Math.min(100, percent)}%` }}
                    />
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[11px]">
                    <div className="flex justify-between gap-2 col-span-2">
                      <dt className="text-text-muted">Notes processed</dt>
                      <dd className="tabular-nums text-text-primary">
                        {processed} / {total}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-muted">With facts</dt>
                      <dd className="tabular-nums text-text-primary">{status.byStatus.done}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-muted">No signal</dt>
                      <dd className="tabular-nums text-text-primary">{status.byStatus.skipped}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-muted">Failed</dt>
                      <dd className="tabular-nums text-accent-red">{status.byStatus.failed}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-muted">Remaining</dt>
                      <dd className="tabular-nums text-accent-amber">{remaining}</dd>
                    </div>
                    <div className="flex justify-between gap-2 col-span-2">
                      <dt className="text-text-muted">State keys</dt>
                      <dd className="tabular-nums text-text-primary">{status.currentStateCount}</dd>
                    </div>
                    <div className="flex justify-between gap-2 col-span-2">
                      <dt className="text-text-muted">Extractor</dt>
                      <dd className="text-text-secondary">{status.extractorVersion}</dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="t-btn t-btn-ghost flex-1 min-w-[5.5rem]"
                      onClick={() => void refresh()}
                      disabled={loading || syncing}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                    <button
                      type="button"
                      className="t-btn t-btn-ghost flex-1 min-w-[5.5rem]"
                      onClick={() => {
                        window.location.href = '/api/download-signal'
                      }}
                      title="Download CURRENT STATE + all extracted facts as a text file"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Export</span>
                    </button>
                    <button
                      type="button"
                      className="t-btn t-btn-primary flex-1 min-w-[7rem]"
                      onClick={() => void runSyncBatch()}
                      disabled={!status.enabled || syncing || remaining === 0}
                      title={
                        remaining === 0
                          ? 'All notes processed for this extractor version'
                          : 'Extract facts from next batch of unprocessed notes (newest first)'
                      }
                    >
                      {syncing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Database className="h-3.5 w-3.5" />
                      )}
                      <span>{syncing ? 'Extracting…' : remaining === 0 ? 'Caught up' : 'Extract batch'}</span>
                    </button>
                  </div>

                  {lastSyncMessage && (
                    <p className="mt-2 font-mono text-[10px] text-text-secondary">{lastSyncMessage}</p>
                  )}

                  {remaining > 0 && status.enabled && (
                    <p className="mt-2 font-mono text-[10px] leading-relaxed text-text-muted">
                      First runs process newest notes first. Click Extract batch repeatedly (or leave
                      the app saving notes) until Remaining is 0.
                    </p>
                  )}

                  {status.sampleState.length > 0 && (
                    <div className="mt-3 border-t border-line pt-2">
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                        Sample CURRENT STATE
                      </div>
                      <ul className="max-h-48 space-y-2 overflow-y-auto custom-scrollbar font-mono text-[10px] text-text-secondary">
                        {status.sampleState.slice(0, 12).map((row) => (
                          <li key={`${row.entity}|${row.attribute}|${row.asOf}`}>
                            <div className="text-text-primary leading-snug">
                              {row.claim?.trim()
                                || `${row.entity} / ${row.attribute}: ${row.value}${row.unit ? ` ${row.unit}` : ''}`}
                            </div>
                            <div className="text-text-muted">
                              {formatAsOf(row.asOf)} · {row.polarity}
                              {row.previous?.claim
                                ? ` · was: ${row.previous.claim}`
                                : row.previous
                                  ? ` · was ${row.previous.value}`
                                  : ''}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {status.sampleState.length === 0 && remaining === total && total > 0 && (
                    <p className="mt-3 font-mono text-[10px] text-text-muted">
                      No facts yet. Run Extract batch — the first pass will fill CURRENT STATE from
                      your newest notes.
                    </p>
                  )}
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
