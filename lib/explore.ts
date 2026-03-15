export interface ExploreRealityMap {
  currentState: string[]
  constraints: string[]
  alreadyWorking: string[]
  underusedAssets: string[]
}

export interface ExploreExistingIdea {
  idea: string
  status: 'already yours' | 'partially explored' | 'tested'
  evidence: string
}

export interface ExploreExperiment {
  name: string
  steps: string[]
  successMetric: string
  successSignal: string
}

export interface ExploreIdea {
  title: string
  mechanism: string
  whyNew: string
  whyItCouldWorkHere: string
  differsFromYourNotes: string
  risks: string[]
  noveltyScore: number
  fitScore: number
  upsideScore: number
  speedScore: number
  experiment: ExploreExperiment
}

export interface ExploreResult {
  objective: string
  summary: string
  realityMap: ExploreRealityMap
  opportunitySpaces: string[]
  alreadyThought: ExploreExistingIdea[]
  adjacentIdeas: ExploreIdea[]
  newIdeas: ExploreIdea[]
  questions: string[]
}

function formatBulletSection(title: string, items: string[]): string {
  if (!items.length) {
    return `${title}\n- None`
  }

  return `${title}\n${items.map((item) => `- ${item}`).join('\n')}`
}

function formatIdeaBlock(label: string, idea: ExploreIdea): string {
  const scoreLine = `Novelty ${idea.noveltyScore}/10 | Fit ${idea.fitScore}/10 | Upside ${idea.upsideScore}/10 | Speed ${idea.speedScore}/10`

  return [
    `${label}: ${idea.title}`,
    `Mechanism: ${idea.mechanism}`,
    `Why new: ${idea.whyNew}`,
    `Why it could work here: ${idea.whyItCouldWorkHere}`,
    `Differs from notes: ${idea.differsFromYourNotes}`,
    formatBulletSection('Risks', idea.risks),
    scoreLine,
    `Experiment: ${idea.experiment.name}`,
    formatBulletSection('Steps', idea.experiment.steps),
    `Success metric: ${idea.experiment.successMetric}`,
    `Success signal: ${idea.experiment.successSignal}`,
  ].join('\n')
}

export function formatExploreResultAsText(result: ExploreResult): string {
  const sections: string[] = [
    `Objective: ${result.objective}`,
    '',
    result.summary,
    '',
    formatBulletSection('Current state', result.realityMap.currentState),
    '',
    formatBulletSection('Constraints', result.realityMap.constraints),
    '',
    formatBulletSection('Already working', result.realityMap.alreadyWorking),
    '',
    formatBulletSection('Underused assets', result.realityMap.underusedAssets),
    '',
    formatBulletSection('Opportunity spaces', result.opportunitySpaces),
    '',
    'Already thought',
    ...(result.alreadyThought.length
      ? result.alreadyThought.map((item) => `- ${item.idea} [${item.status}] | ${item.evidence}`)
      : ['- None']),
    '',
    'Adjacent ideas',
    ...(result.adjacentIdeas.length
      ? result.adjacentIdeas.flatMap((idea, index) => [formatIdeaBlock(`Adjacent ${index + 1}`, idea), ''])
      : ['- None', '']),
    'Actually new ideas',
    ...(result.newIdeas.length
      ? result.newIdeas.flatMap((idea, index) => [formatIdeaBlock(`New ${index + 1}`, idea), ''])
      : ['- None', '']),
    formatBulletSection('Unlock questions', result.questions),
  ]

  return sections.join('\n').trim()
}
