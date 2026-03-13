const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_EMBEDDING_MODEL = 'models/gemini-embedding-2-preview'
const DEFAULT_RERANK_MODEL = 'models/gemini-3.1-flash-lite-preview'
const DEFAULT_EMBEDDING_DIMENSIONS = 768
const EMBEDDING_BATCH_SIZE = 12
// Gemini embedding models accept up to 8,192 tokens per input.
// ~4 chars/token with margin for overhead → safe char limit for text.
const MAX_EMBEDDING_INPUT_CHARS = 28000

export type GeminiEmbeddingTaskType =
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'QUESTION_ANSWERING'
  | 'FACT_VERIFICATION'
  | 'SEMANTIC_SIMILARITY'

export interface EmbeddingInput {
  text: string
  title?: string
}

interface GeminiContentEmbedding {
  values?: number[]
}

interface GeminiBatchEmbedResponse {
  embeddings?: GeminiContentEmbedding[]
  error?: {
    message?: string
  }
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
  }>
  error?: {
    message?: string
  }
}

type GeminiJsonSchema = {
  [key: string]: unknown
}

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set')
  }

  return apiKey
}

function normalizeModelName(modelName: string | undefined, fallback: string): string {
  const candidate = (modelName ?? fallback).trim()
  return candidate.startsWith('models/') ? candidate : `models/${candidate}`
}

function buildGeminiUrl(modelName: string, action: 'batchEmbedContents' | 'generateContent'): string {
  const encodedModel = normalizeModelName(modelName, DEFAULT_EMBEDDING_MODEL)
  return `${GEMINI_API_BASE}/${encodedModel}:${action}?key=${encodeURIComponent(getGeminiApiKey())}`
}

function getEmbeddingDimensions(): number {
  const parsed = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? DEFAULT_EMBEDDING_DIMENSIONS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EMBEDDING_DIMENSIONS
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

function normalizeEmbedding(values: number[]): number[] {
  let magnitude = 0

  for (const value of values) {
    magnitude += value * value
  }

  if (magnitude === 0) {
    return values
  }

  const divisor = Math.sqrt(magnitude)
  return values.map((value) => value / divisor)
}

async function parseGeminiError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: { message?: string } }
    return payload.error?.message || response.statusText || 'Unknown Gemini API error'
  } catch {
    return response.statusText || 'Unknown Gemini API error'
  }
}

export function isGeminiRetrievalEnabled(): boolean {
  return process.env.ENABLE_GEMINI_NOTE_RETRIEVAL !== 'false' && Boolean(process.env.GEMINI_API_KEY)
}

export function getGeminiRerankModel(): string {
  return normalizeModelName(process.env.GEMINI_RERANK_MODEL, DEFAULT_RERANK_MODEL)
}

export async function embedTexts(
  inputs: EmbeddingInput[],
  taskType: GeminiEmbeddingTaskType,
): Promise<number[][]> {
  if (!inputs.length) {
    return []
  }

  const model = normalizeModelName(process.env.GEMINI_EMBEDDING_MODEL, DEFAULT_EMBEDDING_MODEL)
  const dimensions = getEmbeddingDimensions()
  const results: number[][] = []

  for (const batch of chunkArray(inputs, EMBEDDING_BATCH_SIZE)) {
    const response = await fetch(buildGeminiUrl(model, 'batchEmbedContents'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: batch.map((input) => ({
          model,
          content: {
            parts: [{ text: input.text.slice(0, MAX_EMBEDDING_INPUT_CHARS) }],
          },
          taskType,
          title: taskType === 'RETRIEVAL_DOCUMENT' ? input.title ?? undefined : undefined,
          outputDimensionality: dimensions,
        })),
      }),
    })

    if (!response.ok) {
      throw new Error(`Gemini embeddings request failed: ${await parseGeminiError(response)}`)
    }

    const payload = await response.json() as GeminiBatchEmbedResponse
    const embeddings = payload.embeddings ?? []

    if (embeddings.length !== batch.length) {
      throw new Error(`Gemini embeddings request returned ${embeddings.length} embeddings for ${batch.length} inputs`)
    }

    for (const embedding of embeddings) {
      if (!Array.isArray(embedding.values) || embedding.values.length === 0) {
        throw new Error('Gemini embeddings response did not include embedding values')
      }

      results.push(normalizeEmbedding(embedding.values))
    }
  }

  return results
}

function extractGenerateContentText(payload: GeminiGenerateContentResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? []
  return parts
    .map((part) => part.text ?? '')
    .join('')
    .trim()
}

function buildStructuredOutputPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
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

function collectStructuredJsonCandidates(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  const candidates = new Set<string>([trimmed])

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const fencedContent = match[1]?.trim()
    if (fencedContent) {
      candidates.add(fencedContent)
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

  // Walk the string tracking nesting so we can close what's open.
  const closers: string[] = []
  let inString = false
  let escaping = false

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]

    if (inString) {
      if (escaping) { escaping = false; continue }
      if (ch === '\\') { escaping = true; continue }
      if (ch === '"') { inString = false }
      continue
    }

    if (ch === '"') { inString = true; continue }
    if (ch === '{') { closers.push('}'); continue }
    if (ch === '[') { closers.push(']'); continue }
    if ((ch === '}' || ch === ']') && closers.length > 0 && closers[closers.length - 1] === ch) {
      closers.pop()
    }
  }

  if (closers.length === 0) {
    return null // already balanced — normal parse should have worked
  }

  // Close an open string if needed, strip any trailing partial value/comma
  let repaired = trimmed
  if (inString) {
    repaired += '"'
  }

  // Remove a trailing comma or colon that would make the JSON invalid
  repaired = repaired.replace(/[,:\s]+$/, '')

  // Close all open brackets/braces in reverse order
  while (closers.length > 0) {
    repaired += closers.pop()
  }

  return repaired
}

function parseStructuredGeminiOutput<T>(text: string): T {
  const candidates = collectStructuredJsonCandidates(text)
  let lastError: Error | null = null

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  // Attempt truncation repair on the raw text and any extracted candidates
  const repairTargets = [text.trim(), ...candidates]
  for (const target of repairTargets) {
    const repaired = repairTruncatedJson(target)
    if (repaired) {
      try {
        console.warn('[gemini] Recovered structured output from truncated JSON response')
        return JSON.parse(repaired) as T
      } catch {
        // repair didn't produce valid JSON either — continue
      }
    }
  }

  const preview = buildStructuredOutputPreview(text)
  const detail = lastError ? ` Last parse error: ${lastError.message}` : ''
  throw new Error(`Gemini generation request returned invalid JSON. Preview: "${preview}"${detail}`)
}

export async function generateStructuredGeminiOutput<T>(
  prompt: string,
  options?: {
    model?: string
    maxOutputTokens?: number
    temperature?: number
    responseJsonSchema?: GeminiJsonSchema
  },
): Promise<T> {
  const model = normalizeModelName(options?.model ?? process.env.GEMINI_RERANK_MODEL, DEFAULT_RERANK_MODEL)
  const response = await fetch(buildGeminiUrl(model, 'generateContent'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: options?.responseJsonSchema,
        maxOutputTokens: options?.maxOutputTokens ?? 2048,
        temperature: options?.temperature ?? 0.1,
        // Disable thinking for structured output calls — thinking tokens consume
        // the maxOutputTokens budget and can truncate the actual JSON response.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Gemini generation request failed: ${await parseGeminiError(response)}`)
  }

  const payload = await response.json() as GeminiGenerateContentResponse
  const text = extractGenerateContentText(payload)
  if (!text) {
    throw new Error('Gemini generation request returned an empty body')
  }

  return parseStructuredGeminiOutput<T>(text)
}
