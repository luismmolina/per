import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FREE_TIER_MAX_BYTES = 25 * 1024 * 1024
const DEV_TIER_MAX_BYTES = 100 * 1024 * 1024
const DEFAULT_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3'
type TranscriptResponseFormat = 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt'

function parseGranularities(value: string | null) {
  if (!value) return undefined
  return value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token === 'word' || token === 'segment')
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()

  try {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY not set' }, { status: 500 })
    }

    const tier = (process.env.GROQ_AUDIO_TIER || 'free').toLowerCase()
    const byteLimit = tier === 'dev' ? DEV_TIER_MAX_BYTES : FREE_TIER_MAX_BYTES

    const form = await req.formData()
    const file = form.get('audio') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No audio file provided (field name: audio)' }, { status: 400 })
    }

    const sessionId = (form.get('sessionId') as string) || undefined
    const chunkIndex = Number(form.get('chunkIndex') ?? '0')
    const isLastChunk = (form.get('isLast') as string) === 'true'
    const language = (form.get('language') as string) || undefined
    const prompt = (form.get('prompt') as string) || undefined
    const responseFormat = (form.get('response_format') as TranscriptResponseFormat | null) ?? 'verbose_json'
    const mode = ((form.get('mode') as string) || 'auto').toLowerCase()
    const timestampGranularities = parseGranularities(form.get('timestampGranularities') as string | null)
    const model = (form.get('model') as string) || DEFAULT_MODEL
    const temperature = Number(form.get('temperature') ?? '0')

    let fileBuffer: ArrayBuffer | null = null
    let fileSize = typeof file.size === 'number' ? file.size : undefined
    if (fileSize === undefined) {
      fileBuffer = await file.arrayBuffer()
      fileSize = fileBuffer.byteLength
    }

    if (!fileSize || fileSize <= 0) {
      return NextResponse.json({ error: 'Uploaded audio is empty' }, { status: 400 })
    }

    if (fileSize > byteLimit) {
      return NextResponse.json(
        {
          error: `Audio chunk is too large (${(fileSize / (1024 * 1024)).toFixed(2)} MB). Max allowed is ${
            byteLimit / (1024 * 1024)
          } MB for the current plan.`,
        },
        { status: 413 }
      )
    }

    const fileName = ((file as any).name as string) || `voice_chunk_${chunkIndex}.webm`
    const mimeType = ((file as any).type as string) || 'audio/webm'
    const normalizedFile =
      typeof (file as any).name === 'string' && typeof (file as any).stream === 'function'
        ? file
        : new File([fileBuffer ?? (await file.arrayBuffer())], fileName, { type: mimeType })

    const groq = new Groq({ apiKey })

    const sharedPayload = {
      file: normalizedFile,
      model,
      response_format: responseFormat,
      temperature,
      ...(prompt ? { prompt } : {}),
    }

    const transcriptionPayload = {
      ...sharedPayload,
      ...(language ? { language } : {}),
      ...(timestampGranularities?.length && responseFormat === 'verbose_json'
        ? { timestamp_granularities: timestampGranularities }
        : {}),
    }

    const translationPayload = { ...sharedPayload }

    let transcription: any
    const shouldTryTranslation = mode === 'translate' || (mode === 'auto' && (!language || language === 'en'))

    try {
      if (shouldTryTranslation) {
        transcription = await (groq as any).audio.translations.create(translationPayload)
      } else {
        throw new Error('Skip translation')
      }
    } catch {
      transcription = await groq.audio.transcriptions.create(transcriptionPayload)
    }

    return NextResponse.json({
      text: (transcription as any)?.text || '',
      raw: transcription,
      meta: {
        sessionId,
        chunkIndex,
        isLastChunk,
        model,
        responseFormat,
        durationMs: Date.now() - startedAt,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
