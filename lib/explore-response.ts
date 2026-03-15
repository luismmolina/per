import type {
  ExploreExistingIdea,
  ExploreIdea,
  ExploreResult,
} from './explore'

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asStringArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, limit)
}

function clampScore(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return 5
  }

  return Math.max(1, Math.min(10, Math.round(numeric)))
}

function normalizeExistingIdeas(value: unknown): ExploreExistingIdea[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      const objectValue = asObject(entry)
      if (!objectValue) return null

      const status = asTrimmedString(objectValue.status)
      const normalizedStatus = status === 'already yours' || status === 'partially explored' || status === 'tested'
        ? status
        : 'already yours'

      const idea = asTrimmedString(objectValue.idea)
      const evidence = asTrimmedString(objectValue.evidence)
      if (!idea || !evidence) return null

      return {
        idea,
        status: normalizedStatus,
        evidence,
      } satisfies ExploreExistingIdea
    })
    .filter((entry): entry is ExploreExistingIdea => Boolean(entry))
    .slice(0, 8)
}

function normalizeIdeas(value: unknown): ExploreIdea[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      const objectValue = asObject(entry)
      if (!objectValue) return null

      const experimentValue = asObject(objectValue.experiment)
      const title = asTrimmedString(objectValue.title)
      const mechanism = asTrimmedString(objectValue.mechanism)
      const whyNew = asTrimmedString(objectValue.whyNew)
      const whyItCouldWorkHere = asTrimmedString(objectValue.whyItCouldWorkHere)
      const differsFromYourNotes = asTrimmedString(objectValue.differsFromYourNotes)
      const experimentName = experimentValue ? asTrimmedString(experimentValue.name) : null
      const successMetric = experimentValue ? asTrimmedString(experimentValue.successMetric) : null
      const successSignal = experimentValue ? asTrimmedString(experimentValue.successSignal) : null

      if (!title || !mechanism || !whyNew || !whyItCouldWorkHere || !differsFromYourNotes || !experimentName || !successMetric || !successSignal) {
        return null
      }

      const steps = experimentValue ? asStringArray(experimentValue.steps, 6) : []
      const risks = asStringArray(objectValue.risks, 6)

      if (!steps.length || !risks.length) {
        return null
      }

      return {
        title,
        mechanism,
        whyNew,
        whyItCouldWorkHere,
        differsFromYourNotes,
        risks,
        noveltyScore: clampScore(objectValue.noveltyScore),
        fitScore: clampScore(objectValue.fitScore),
        upsideScore: clampScore(objectValue.upsideScore),
        speedScore: clampScore(objectValue.speedScore),
        experiment: {
          name: experimentName,
          steps,
          successMetric,
          successSignal,
        },
      } satisfies ExploreIdea
    })
    .filter((entry): entry is ExploreIdea => Boolean(entry))
    .slice(0, 6)
}

function extractBalancedJsonCandidate(text: string, startIndex: number): string | null {
  const startChar = text[startIndex]
  if (startChar !== '{' && startChar !== '[') {
    return null
  }

  const stack: string[] = [startChar === '{' ? '}' : ']']
  let inString = false
  let escaping = false

  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }

      if (char === '\\') {
        escaping = true
        continue
      }

      if (char === '"') {
        inString = false
      }

      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      stack.push('}')
      continue
    }

    if (char === '[') {
      stack.push(']')
      continue
    }

    if ((char === '}' || char === ']') && stack[stack.length - 1] === char) {
      stack.pop()
      if (stack.length === 0) {
        return text.slice(startIndex, index + 1)
      }
    }
  }

  return null
}

function collectJsonCandidates(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  const candidates = new Set<string>([trimmed])

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const fenced = match[1]?.trim()
    if (fenced) {
      candidates.add(fenced)
    }
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (char !== '{' && char !== '[') {
      continue
    }

    const candidate = extractBalancedJsonCandidate(trimmed, index)
    if (candidate) {
      candidates.add(candidate.trim())
    }
  }

  return Array.from(candidates)
}

function repairTruncatedJson(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return null
  }

  const closers: string[] = []
  let inString = false
  let escaping = false

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }

      if (char === '\\') {
        escaping = true
        continue
      }

      if (char === '"') {
        inString = false
      }

      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      closers.push('}')
      continue
    }

    if (char === '[') {
      closers.push(']')
      continue
    }

    if ((char === '}' || char === ']') && closers.length > 0 && closers[closers.length - 1] === char) {
      closers.pop()
    }
  }

  if (closers.length === 0) {
    return null
  }

  let repaired = trimmed
  if (inString) {
    repaired += '"'
  }

  repaired = repaired.replace(/[,:\s]+$/, '')

  while (closers.length > 0) {
    repaired += closers.pop()
  }

  return repaired
}

export function parseExploreModelJson<T>(text: string): T {
  let lastError: Error | null = null
  const candidates = collectJsonCandidates(text)

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  for (const target of [text.trim(), ...candidates]) {
    const repaired = repairTruncatedJson(target)
    if (!repaired) {
      continue
    }

    try {
      return JSON.parse(repaired) as T
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw new Error(`Failed to parse model JSON.${lastError ? ` ${lastError.message}` : ''}`)
}

export function normalizeExploreResult(value: unknown, fallbackObjective: string): ExploreResult {
  const objectValue = asObject(value)
  const realityMap = objectValue ? asObject(objectValue.realityMap) : null

  return {
    objective: objectValue ? asTrimmedString(objectValue.objective) || fallbackObjective : fallbackObjective,
    summary: objectValue ? asTrimmedString(objectValue.summary) || 'No summary generated.' : 'No summary generated.',
    realityMap: {
      currentState: realityMap ? asStringArray(realityMap.currentState, 8) : [],
      constraints: realityMap ? asStringArray(realityMap.constraints, 8) : [],
      alreadyWorking: realityMap ? asStringArray(realityMap.alreadyWorking, 8) : [],
      underusedAssets: realityMap ? asStringArray(realityMap.underusedAssets, 8) : [],
    },
    opportunitySpaces: objectValue ? asStringArray(objectValue.opportunitySpaces, 8) : [],
    alreadyThought: objectValue ? normalizeExistingIdeas(objectValue.alreadyThought) : [],
    adjacentIdeas: objectValue ? normalizeIdeas(objectValue.adjacentIdeas) : [],
    newIdeas: objectValue ? normalizeIdeas(objectValue.newIdeas) : [],
    questions: objectValue ? asStringArray(objectValue.questions, 8) : [],
  }
}

export function extractMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const objectValue = asObject(part)
        return objectValue && typeof objectValue.text === 'string' ? objectValue.text : ''
      })
      .join('')
  }

  return ''
}
