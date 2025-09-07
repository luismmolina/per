import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import fs from 'fs'
import path from 'path'

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

    // Choose a temp filename and extension
    const origName = (file as any).name || 'audio'
    const extGuess = (origName.split('.').pop() || '').slice(0, 8).toLowerCase() || 'webm'
    const tmpDir = '/tmp'
    const tmpPath = path.join(tmpDir, `voice-${Date.now()}-${Math.random().toString(36).slice(2)}.${extGuess}`)

    fs.writeFileSync(tmpPath, buffer)

    const groq = new Groq({ apiKey })
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath) as any,
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json' as any,
      // Force English transcription
      language: 'en' as any,
    } as any)

    // Clean up temp file
    try { fs.unlinkSync(tmpPath) } catch {}

    return NextResponse.json({
      text: (transcription as any)?.text || '',
      raw: transcription,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
