'use client'

import type { ExploreIdea, ExploreResult } from '@/lib/explore'

function scoreTone(score: number): string {
  if (score >= 8) return 'text-emerald-200 border-emerald-400/30 bg-emerald-500/10'
  if (score >= 6) return 'text-amber-100 border-amber-400/30 bg-amber-500/10'
  return 'text-rose-100 border-rose-400/30 bg-rose-500/10'
}

function ScoreChip({ label, value }: { label: string; value: number }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${scoreTone(value)}`}>
      {label} {value}/10
    </span>
  )
}

function IdeaCard({
  idea,
  tone,
}: {
  idea: ExploreIdea
  tone: 'adjacent' | 'new'
}) {
  const toneClasses = tone === 'new'
    ? 'border-sky-400/20 bg-sky-500/10'
    : 'border-amber-400/20 bg-amber-500/10'

  return (
    <article className={`rounded-3xl border p-5 backdrop-blur-sm ${toneClasses}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-white">{idea.title}</h3>
          <p className="text-sm leading-6 text-white/80">{idea.mechanism}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ScoreChip label="Novelty" value={idea.noveltyScore} />
          <ScoreChip label="Fit" value={idea.fitScore} />
          <ScoreChip label="Upside" value={idea.upsideScore} />
          <ScoreChip label="Speed" value={idea.speedScore} />
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Why New</p>
          <p className="mt-2 text-sm leading-6 text-white/80">{idea.whyNew}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Why It Could Work</p>
          <p className="mt-2 text-sm leading-6 text-white/80">{idea.whyItCouldWorkHere}</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Differs From Your Notes</p>
        <p className="mt-2 text-sm leading-6 text-white/80">{idea.differsFromYourNotes}</p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">7-Day Test</p>
          <p className="mt-2 text-sm font-medium text-white">{idea.experiment.name}</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-white/80">
            {idea.experiment.steps.map((step, index) => (
              <li key={`${idea.title}-step-${index}`} className="flex gap-2">
                <span className="mt-0.5 text-white/40">{index + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Success Metric</p>
            <p className="mt-2 text-sm leading-6 text-white/80">{idea.experiment.successMetric}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Success Signal</p>
            <p className="mt-2 text-sm leading-6 text-white/80">{idea.experiment.successSignal}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Risks</p>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-white/80">
              {idea.risks.map((risk, index) => (
                <li key={`${idea.title}-risk-${index}`} className="flex gap-2">
                  <span className="mt-0.5 text-white/40">-</span>
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </article>
  )
}

function BulletCard({
  title,
  items,
}: {
  title: string
  items: string[]
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-4 space-y-3 text-sm leading-6 text-white/80">
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="flex gap-2">
              <span className="mt-0.5 text-white/40">-</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm leading-6 text-white/45">Nothing solid extracted for this section yet.</p>
      )}
    </div>
  )
}

export function ExploreBoard({ result }: { result: ExploreResult }) {
  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] border border-sky-400/20 bg-gradient-to-br from-sky-500/15 via-white/5 to-emerald-500/10 p-6 md:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200/70">Objective</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white md:text-3xl">{result.objective}</h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-white/80 md:text-base">{result.summary}</p>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-white">Reality Map</h2>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/50">
            Grounded in notes
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <BulletCard title="Current State" items={result.realityMap.currentState} />
          <BulletCard title="Constraints" items={result.realityMap.constraints} />
          <BulletCard title="Already Working" items={result.realityMap.alreadyWorking} />
          <BulletCard title="Underused Assets" items={result.realityMap.underusedAssets} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Where To Look Next</h2>
        {result.opportunitySpaces.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {result.opportunitySpaces.map((space, index) => (
              <div
                key={`space-${index}`}
                className="rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-5 text-sm leading-6 text-emerald-50"
              >
                {space}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm leading-6 text-white/50">
            No opportunity spaces were extracted. Regenerate with a tighter objective or add more notes around the constraint you want to break.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-white">Already Yours</h2>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/50">
            Do not repeat these
          </span>
        </div>

        {result.alreadyThought.length > 0 ? (
          <div className="grid gap-4">
            {result.alreadyThought.map((item, index) => (
              <article key={`already-${index}`} className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-base font-medium text-white">{item.idea}</h3>
                  <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/60">
                    {item.status}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-white/75">{item.evidence}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm leading-6 text-white/50">
            The system could not confidently identify ideas that are already yours. That usually means the notes around this objective are too sparse or too broad.
          </div>
        )}
      </section>

      {result.adjacentIdeas.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-white">Adjacent Moves</h2>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/50">
              Evolutions of your thinking
            </span>
          </div>
          <div className="grid gap-5">
            {result.adjacentIdeas.map((idea, index) => (
              <IdeaCard key={`adjacent-${index}`} idea={idea} tone="adjacent" />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-white">Actually New</h2>
          <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-sky-100/80">
            Forced novelty
          </span>
        </div>
        {result.newIdeas.length > 0 ? (
          <div className="grid gap-5">
            {result.newIdeas.map((idea, index) => (
              <IdeaCard key={`new-${index}`} idea={idea} tone="new" />
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-sky-400/20 bg-sky-500/10 p-5 text-sm leading-6 text-sky-100/80">
            No sufficiently new ideas survived the fit and novelty filter. Tighten the objective or add notes that clarify the current constraints and assets.
          </div>
        )}
      </section>

      <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 md:p-7">
        <h2 className="text-xl font-semibold text-white">Questions That Unlock More Options</h2>
        {result.questions.length > 0 ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {result.questions.map((question, index) => (
              <div
                key={`question-${index}`}
                className="rounded-3xl border border-white/10 bg-black/30 p-4 text-sm leading-6 text-white/80"
              >
                {question}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-5 text-sm leading-6 text-white/50">
            No unlock questions were generated this time.
          </p>
        )}
      </section>
    </div>
  )
}
