const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_EMBEDDING_MODEL = 'models/gemini-embedding-2-preview'
const DEFAULT_RERANK_MODEL = 'models/gemini-2.5-flash'
const DEFAULT_EMBEDDING_DIMENSIONS = 768
const EMBEDDING_BATCH_SIZE = 12

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
            parts: [{ text: input.text }],
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

export async function generateStructuredGeminiOutput<T>(
  prompt: string,
  options?: {
    model?: string
    maxOutputTokens?: number
    temperature?: number
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
        maxOutputTokens: options?.maxOutputTokens ?? 512,
        temperature: options?.temperature ?? 0.1,
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

  return JSON.parse(text) as T
}
