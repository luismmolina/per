import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FREE_TIER_MAX_BYTES = 25 * 1024 * 1024
const DEV_TIER_MAX_BYTES = 100 * 1024 * 1024
const FFMPEG_BINARY = ffmpegPath || 'ffmpeg'

type AudioPreprocessResult = {
  file: File
  applied: boolean
  originalSize: number
  processedSize: number
  error?: string
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
  try {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY not set' }, { status: 500 })
    }

    const form = await req.formData()
    const file = form.get('audio') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No audio file provided (field name: audio)' }, { status: 400 })
    }

    const tier = (process.env.GROQ_AUDIO_TIER || 'free').toLowerCase()
    const byteLimit = tier === 'dev' ? DEV_TIER_MAX_BYTES : FREE_TIER_MAX_BYTES

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

    const processedBuffer = Buffer.from(await processedFile.arrayBuffer())
    if (!processedBuffer || processedBuffer.length === 0) {
      return NextResponse.json({ error: 'Preprocessed audio is empty' }, { status: 400 })
    }

    const name = ((processedFile as any).name as string) || 'voice_note.flac'
    const type = ((processedFile as any).type as string) || 'audio/flac'
    const makeFile = () => new File([processedBuffer], name, { type })

    const groq = new Groq({ apiKey })
    let transcription: any
    try {
      // Prefer English translation if available
      transcription = await (groq as any).audio.translations.create({
        file: makeFile(),
        model: 'whisper-large-v3',
        response_format: 'verbose_json',
      })
    } catch {
      // Fallback to transcription
      transcription = await groq.audio.transcriptions.create({
        file: makeFile(),
        model: 'whisper-large-v3',
        response_format: 'verbose_json',
      })
    }

    return NextResponse.json({
      text: (transcription as any)?.text || '',
      raw: transcription,
      meta: {
        preprocessing: {
          applied: preprocessing.applied,
          originalSizeBytes: preprocessing.originalSize,
          processedSizeBytes: preprocessing.processedSize,
          error: preprocessing.error,
        },
        tier,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
