import { NextRequest, NextResponse } from 'next/server'
import { loadConversations } from '../../../lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const conversations = await loadConversations()
    const messages = conversations?.messages || []

    const notes = messages
      .filter((m: any) => m.type === 'note')
      .map((m: any) => {
        const date = new Date(m.timestamp).toLocaleString('en-US', {
          dateStyle: 'short',
          timeStyle: 'short'
        })
        return `[${date}] ${m.content}`
      })
      .join('\n\n')

    const filename = `notes-${new Date().toISOString().split('T')[0]}.txt`

    return new NextResponse(notes, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    })
  } catch (error) {
    console.error('Failed to download notes:', error)
    return new NextResponse('Failed to download notes', { status: 500 })
  }
}
