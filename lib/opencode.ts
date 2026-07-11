import Anthropic from '@anthropic-ai/sdk'

const OPENCODE_GO_BASE = 'https://opencode.ai/zen/go'
const OPENCODE_MESSAGES_URL = `${OPENCODE_GO_BASE}/v1/messages`

let client: Anthropic | null = null

export function getOpencodeClient(): Anthropic {
  if (client) return client

  const apiKey = process.env.OPENCODE_API_KEY
  if (!apiKey) {
    throw new Error('OPENCODE_API_KEY is not set.')
  }

  client = new Anthropic({
    apiKey,
    baseURL: OPENCODE_GO_BASE,
  })

  return client
}

export function getOpencodeModel(): string {
  return process.env.OPENCODE_MODEL || 'glm-5.2'
}

function getApiKey(): string {
  const apiKey = process.env.OPENCODE_API_KEY
  if (!apiKey) {
    throw new Error('OPENCODE_API_KEY is not set.')
  }
  return apiKey
}

/** Parse OpenCode / Anthropic-style error JSON into a user-facing Error. */
export function formatOpencodeErrorPayload(payload: unknown, status?: number): Error {
  const fallback = status
    ? `OpenCode request failed (HTTP ${status}).`
    : 'OpenCode request failed.'

  if (!payload || typeof payload !== 'object') {
    return new Error(fallback)
  }

  const root = payload as {
    type?: string
    error?: { type?: string; message?: string }
    message?: string
  }

  const errType = root.error?.type || root.type || ''
  const errMessage = root.error?.message || root.message || ''

  if (errType === 'GoUsageLimitError' || /usage limit/i.test(errMessage)) {
    return new Error(
      errMessage ||
        'OpenCode Go monthly usage limit reached. Enable balance usage in your OpenCode workspace, or wait for the limit to reset.',
    )
  }

  if (errType === 'CreditsError' || /insufficient balance/i.test(errMessage)) {
    return new Error(
      errMessage ||
        'OpenCode balance is insufficient. Add credits in your OpenCode workspace billing settings.',
    )
  }

  if (errMessage) {
    return new Error(errMessage)
  }

  return new Error(fallback)
}

async function buildOpencodeHttpError(response: Response): Promise<Error> {
  let text = ''
  try {
    text = await response.text()
  } catch {
    // ignore
  }

  if (text) {
    try {
      return formatOpencodeErrorPayload(JSON.parse(text), response.status)
    } catch {
      return new Error(`OpenCode request failed (HTTP ${response.status}): ${text.slice(0, 400)}`)
    }
  }

  if (response.status === 429) {
    return new Error(
      'OpenCode rate limit or monthly usage limit hit (HTTP 429). Check your OpenCode Go usage and billing.',
    )
  }

  return new Error(`OpenCode request failed (HTTP ${response.status}).`)
}

export type OpencodeChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Stream text from OpenCode Go via the Anthropic-compatible messages API.
 * Uses raw fetch so HTTP errors (429 usage limit, credits, etc.) surface clearly
 * instead of the SDK's opaque "request ended without sending any chunks".
 */
export async function* streamOpencodeText(options: {
  model?: string
  max_tokens: number
  system?: string
  messages: OpencodeChatMessage[]
}): AsyncGenerator<string, void, unknown> {
  const model = options.model ?? getOpencodeModel()
  const body: Record<string, unknown> = {
    model,
    max_tokens: options.max_tokens,
    stream: true,
    messages: options.messages,
  }
  if (options.system) {
    body.system = options.system
  }

  const response = await fetch(OPENCODE_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw await buildOpencodeHttpError(response)
  }

  if (!response.body) {
    throw new Error('OpenCode returned an empty response body.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let yieldedText = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trimEnd()
      if (!line.startsWith('data:')) continue

      const data = line.replace(/^data:\s*/, '').trim()
      if (!data || data === '[DONE]') continue

      let parsed: unknown
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }

      if (!parsed || typeof parsed !== 'object') continue
      const event = parsed as {
        type?: string
        error?: { type?: string; message?: string }
        delta?: { type?: string; text?: string }
        message?: string
      }

      if (event.type === 'error' || event.error) {
        throw formatOpencodeErrorPayload(event)
      }

      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        yieldedText = true
        yield event.delta.text
      }
    }
  }

  if (!yieldedText) {
    throw new Error(
      'OpenCode stream ended without any text. This is often a usage limit, billing issue, or model timeout — check OpenCode workspace billing/Go limits.',
    )
  }
}

/** Non-streaming completion (query expansion, short tasks). */
export async function createOpencodeText(options: {
  model?: string
  max_tokens: number
  system?: string
  messages: OpencodeChatMessage[]
}): Promise<string> {
  const model = options.model ?? getOpencodeModel()
  const body: Record<string, unknown> = {
    model,
    max_tokens: options.max_tokens,
    stream: false,
    messages: options.messages,
  }
  if (options.system) {
    body.system = options.system
  }

  const response = await fetch(OPENCODE_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw await buildOpencodeHttpError(response)
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>
    error?: { type?: string; message?: string }
  }

  if (payload.error) {
    throw formatOpencodeErrorPayload(payload)
  }

  return (payload.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('')
    .trim()
}
