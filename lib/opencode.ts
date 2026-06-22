import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

export function getOpencodeClient(): Anthropic {
  if (client) return client

  const apiKey = process.env.OPENCODE_API_KEY
  if (!apiKey) {
    throw new Error('OPENCODE_API_KEY is not set.')
  }

  client = new Anthropic({
    apiKey,
    baseURL: 'https://opencode.ai/zen/go',
  })

  return client
}

export function getOpencodeModel(): string {
  return process.env.OPENCODE_MODEL || 'glm-5.2'
}
