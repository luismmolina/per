import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import type { TranscriptionCreateParams } from 'groq-sdk/resources/audio/transcriptions'
import type { TranslationCreateParams } from 'groq-sdk/resources/audio/translations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FREE_TIER_MAX_BYTES = 25 * 1024 * 1024
const DEV_TIER_MAX_BYTES = 100 * 1024 * 1024
const DEFAULT_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3'
const TRANSLATION_SUPPORTED_MODELS = new Set(['whisper-large-v3'])
const FFMPEG_BINARY = ffmpegPath || 'ffmpeg'

type TranscriptResponseFormat = 'json' | 'text' | 'verbose_json'

type AudioPreprocessResult = {
  file: File
  applied: boolean
  originalSize: number
  processedSize: number
  error?: string
}

const parseGranularities = (value: string | null) => {
  if (!value) return undefined
  return value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token === 'word' || token === 'segment')
}

const getFileSize = async (file: File) => {
  if (typeof file.size === 'number') return file.size
  return (await file.arrayBuffer()).byteLength
}

const toFlacFileName = (name: string) => {
  if (!name) return 'voice_note.flac'
  const dotIndex = name.lastIndexOf('.')
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name
  return `${base}.flac`
}

async function transcodeToFlacMono16k(file: File): Promise<File> {
  if (!FFMPEG_BINARY) {
    throw new Error('FFmpeg binary is not available to preprocess audio')
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer())
  return await new Promise<File>((resolve, reject) => {
    const ffmpeg = spawn(FFMPEG_BINARY, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-map',
      '0:a',
      '-c:a',
      'flac',
      '-f',
      'flac',
      'pipe:1',
    ])

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    ffmpeg.stdout.on('data', (chunk) => stdoutChunks.push(chunk as Buffer))
    ffmpeg.stderr.on('data', (chunk) => stderrChunks.push(chunk as Buffer))
    ffmpeg.on('error', (error) => reject(error))
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        const convertedBuffer = Buffer.concat(stdoutChunks)
        const outputName = toFlacFileName(((file as any).name as string) || 'voice_note')
        resolve(new File([convertedBuffer], outputName, { type: 'audio/flac' }))
      } else {
        const stderr = Buffer.concat(stderrChunks).toString() || 'Unknown FFmpeg error'
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`))
      }
    })

    ffmpeg.stdin.on('error', (error) => reject(error))
    ffmpeg.stdin.end(inputBuffer)
  })
}

async function preprocessAudioForTranscription(file: File, byteLimit: number): Promise<AudioPreprocessResult> {
  const originalSize = await getFileSize(file)
  const normalizedName = ((file as any).name as string) || 'voice_note.webm'
  const normalizedType = ((file as any).type as string) || 'audio/webm'
  const normalizedFile =
    typeof (file as any).stream === 'function'
      ? file
      : new File([await file.arrayBuffer()], normalizedName, { type: normalizedType })

  const alreadyFlac = normalizedType === 'audio/flac'
  const shouldForceTranscode = originalSize > byteLimit

  if (!shouldForceTranscode && alreadyFlac) {
    return {
      file: normalizedFile,
      applied: false,
      originalSize,
      processedSize: originalSize,
    }
  }

  try {
    const converted = await transcodeToFlacMono16k(normalizedFile)
    const processedSize = await getFileSize(converted)
    return {
      file: converted,
      applied: true,
      originalSize,
      processedSize,
    }
  } catch (error) {
    console.warn('Audio preprocessing failed; using original upload', error)
    return {
      file: normalizedFile,
      applied: false,
      originalSize,
      processedSize: originalSize,
      error: error instanceof Error ? error.message : String(error),
    }
  }
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
    const requestedFormat = ((form.get('response_format') as string | null) ?? '').toLowerCase()
    const responseFormat: TranscriptResponseFormat =
      requestedFormat === 'text' || requestedFormat === 'json' ? (requestedFormat as TranscriptResponseFormat) : 'verbose_json'
    const mode = ((form.get('mode') as string) || 'auto').toLowerCase()
    const timestampGranularities = parseGranularities(form.get('timestampGranularities') as string | null)
    const model = (form.get('model') as string) || DEFAULT_MODEL
    const parsedTemperature = Number(form.get('temperature') ?? '0')
    const temperature = Number.isFinite(parsedTemperature) ? parsedTemperature : 0

    const preprocessing = await preprocessAudioForTranscription(file, byteLimit)
    const processedFile = preprocessing.file
    const processedSize = preprocessing.processedSize

    if (!processedSize || processedSize <= 0) {
      return NextResponse.json({ error: 'Uploaded audio is empty' }, { status: 400 })
    }

    if (processedSize > byteLimit) {
      return NextResponse.json(
        {
          error: `Audio is too large even after preprocessing (${(processedSize / (1024 * 1024)).toFixed(
            2
          )} MB). Limit for the current tier is ${(byteLimit / (1024 * 1024)).toFixed(2)} MB.`,
          originalSizeBytes: preprocessing.originalSize,
          processedSizeBytes: processedSize,
        },
        { status: 413 }
      )
    }

    const normalizedFile =
      typeof (processedFile as any).name === 'string' && typeof (processedFile as any).stream === 'function'
        ? processedFile
        : new File([await processedFile.arrayBuffer()], ((processedFile as any).name as string) || 'voice_note.flac', {
            type: ((processedFile as any).type as string) || 'audio/flac',
          })

    const groq = new Groq({ apiKey })

    const basePayload = {
      file: normalizedFile,
      model,
      temperature,
      ...(prompt ? { prompt } : {}),
    }

    const transcriptionPayload: TranscriptionCreateParams = {
      ...basePayload,
      response_format: responseFormat,
      ...(language ? { language } : {}),
      ...(timestampGranularities?.length && responseFormat === 'verbose_json'
        ? { timestamp_granularities: timestampGranularities }
        : {}),
    }

    const translationPayload: TranslationCreateParams = {
      ...basePayload,
      response_format: responseFormat === 'verbose_json' ? 'json' : responseFormat,
    }

    let transcription: any
    const wantsTranslation = mode === 'translate' || (mode === 'auto' && (!language || language === 'en'))
    const modelSupportsTranslation = TRANSLATION_SUPPORTED_MODELS.has(model)
    const shouldTryTranslation = wantsTranslation && modelSupportsTranslation
    let translationAttempted = false
    let translationSkippedReason: string | undefined

    if (shouldTryTranslation) {
      translationAttempted = true
      try {
        const translationResult = await (groq as any).audio.translations.create(translationPayload)
        const translationText = typeof translationResult?.text === 'string' ? translationResult.text.trim() : ''
        if (translationText) {
          transcription = translationResult
        } else {
          translationSkippedReason = 'translation_empty'
          console.warn('Groq translation returned empty text; falling back to transcription', {
            sessionId,
            chunkIndex,
          })
          transcription = await groq.audio.transcriptions.create(transcriptionPayload)
        }
      } catch (error) {
        translationSkippedReason = 'translation_failed'
        console.warn('Groq translation failed, retrying as transcription', error)
        transcription = await groq.audio.transcriptions.create(transcriptionPayload)
      }
    } else {
      if (wantsTranslation && !modelSupportsTranslation) {
        translationSkippedReason = 'model_not_supported'
      } else if (wantsTranslation) {
        translationSkippedReason = 'translation_disabled'
      }
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
        translationAttempted,
        translationSkippedReason,
        preprocessing: {
          applied: preprocessing.applied,
          originalSizeBytes: preprocessing.originalSize,
          processedSizeBytes: preprocessing.processedSize,
          error: preprocessing.error,
        },
        tier,
        durationMs: Date.now() - startedAt,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
