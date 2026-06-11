export function estimateJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return 0
  }
}

export function logDbTransfer(
  context: string,
  stats: Record<string, number | boolean | string | undefined>,
): void {
  console.log(`[db-transfer] ${context}`, stats)
}