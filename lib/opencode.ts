import OpenAI from 'openai'

/**
 * OpenCode Zen — OpenAI-compatible chat completions.
 * Docs: https://opencode.ai/docs/zen/
 * Base must end at /v1 so the client hits .../v1/chat/completions.
 * Grok 4.5 lives on Zen (not Go): https://opencode.ai/zen/v1/chat/completions
 */
const OPENCODE_ZEN_BASE_URL = 'https://opencode.ai/zen/v1'

let client: OpenAI | null = null

function getApiKey(): string {
  const apiKey = process.env.OPENCODE_API_KEY
  if (!apiKey) {
    throw new Error('OPENCODE_API_KEY is not set.')
  }
  return apiKey
}

/** OpenAI SDK client pointed at OpenCode Zen (chat/completions). */
export function getOpencodeClient(): OpenAI {
  if (client) return client

  client = new OpenAI({
    apiKey: getApiKey(),
    baseURL: OPENCODE_ZEN_BASE_URL,
  })

  return client
}

export function getOpencodeModel(): string {
  return process.env.OPENCODE_MODEL || 'grok-4.5'
}

/** Parse OpenCode / OpenAI-style error JSON into a user-facing Error. */
export function formatOpencodeErrorPayload(payload: unknown, status?: number): Error {
  const fallback = status
    ? `OpenCode request failed (HTTP ${status}).`
    : 'OpenCode request failed.'

  if (!payload || typeof payload !== 'object') {
    return new Error(fallback)
  }

  const root = payload as {
    type?: string
    error?: { type?: string; message?: string; code?: string }
    message?: string
  }

  const errType = root.error?.type || root.type || root.error?.code || ''
  const errMessage = root.error?.message || root.message || ''

  if (errType === 'GoUsageLimitError' || /usage limit/i.test(errMessage)) {
    return new Error(
      errMessage ||
        'OpenCode usage limit reached. Check billing or wait for the limit to reset.',
    )
  }

  if (errType === 'CreditsError' || /insufficient balance/i.test(errMessage)) {
    return new Error(
      errMessage ||
        'OpenCode balance is insufficient. Add credits in your OpenCode Zen billing settings.',
    )
  }

  if (errMessage) {
    return new Error(errMessage)
  }

  return new Error(fallback)
}

function rethrowOpenAIError(error: unknown): never {
  if (error && typeof error === 'object') {
    const maybe = error as {
      status?: number
      error?: { type?: string; message?: string; code?: string }
      message?: string
    }

    if (maybe.error || maybe.status) {
      throw formatOpencodeErrorPayload(
        { error: maybe.error, message: maybe.message },
        maybe.status,
      )
    }
  }

  if (error instanceof Error) {
    // Anthropic-style opaque stream failure from older paths
    if (/without sending any chunks/i.test(error.message)) {
      throw new Error(
        'OpenCode stream ended without any text. Often a billing issue or model timeout — check OpenCode Zen billing.',
      )
    }
    throw error
  }

  throw new Error(String(error))
}

export type OpencodeChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

function buildChatMessages(options: {
  system?: string
  messages: OpencodeChatMessage[]
}): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

  if (options.system) {
    messages.push({ role: 'system', content: options.system })
  }

  for (const message of options.messages) {
    if (message.role === 'system') {
      messages.push({ role: 'system', content: message.content })
      continue
    }
    if (message.role === 'assistant') {
      messages.push({ role: 'assistant', content: message.content })
      continue
    }
    messages.push({ role: 'user', content: message.content })
  }

  return messages
}

/**
 * Stream text from OpenCode Zen via OpenAI-compatible chat/completions.
 * POST https://opencode.ai/zen/v1/chat/completions
 */
export async function* streamOpencodeText(options: {
  model?: string
  max_tokens: number
  system?: string
  messages: OpencodeChatMessage[]
}): AsyncGenerator<string, void, unknown> {
  const openai = getOpencodeClient()
  const model = options.model ?? getOpencodeModel()
  let yieldedText = false

  try {
    const stream = await openai.chat.completions.create({
      model,
      max_tokens: options.max_tokens,
      stream: true,
      messages: buildChatMessages(options),
    })

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      // Some OpenCode models put reasoning separately; prefer visible content.
      const content = delta?.content
      if (typeof content === 'string' && content.length > 0) {
        yieldedText = true
        yield content
      }
    }
  } catch (error) {
    rethrowOpenAIError(error)
  }

  if (!yieldedText) {
    throw new Error(
      'OpenCode stream ended without any text. This is often a billing issue or model timeout — check OpenCode Zen billing.',
    )
  }
}

/** Non-streaming completion (query expansion, explore, short tasks). */
export async function createOpencodeText(options: {
  model?: string
  max_tokens: number
  system?: string
  messages: OpencodeChatMessage[]
}): Promise<string> {
  const openai = getOpencodeClient()
  const model = options.model ?? getOpencodeModel()

  try {
    const response = await openai.chat.completions.create({
      model,
      max_tokens: options.max_tokens,
      stream: false,
      messages: buildChatMessages(options),
    })

    const text = response.choices?.[0]?.message?.content
    if (typeof text === 'string' && text.trim()) {
      return text.trim()
    }

    throw new Error('OpenCode returned an empty completion.')
  } catch (error) {
    rethrowOpenAIError(error)
  }
}
