import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (!buffer || buffer.length === 0) {
      return NextResponse.json({ error: 'Uploaded audio is empty' }, { status: 400 })
    }
    
    // Build a File object for the SDK with a stable filename and MIME
    const name = ((file as any).name as string) || 'voice_note.webm'
    const type = ((file as any).type as string) || 'audio/webm'
    const makeFile = () => new File([buffer], name, { type })

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
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
