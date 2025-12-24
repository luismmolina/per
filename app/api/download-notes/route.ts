import { NextRequest, NextResponse } from 'next/server'
import { loadConversations } from '../../../lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const conversations = await loadConversations()
    const messages = conversations?.messages || []

    // Filter for notes and sort by timestamp (oldest first for better readability)
    const noteMessages = messages
      .filter((m: any) => m.type === 'note')
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    const notes = noteMessages
      .map((m: any) => {
        const date = new Date(m.timestamp).toLocaleString('en-US', {
          dateStyle: 'short',
          timeStyle: 'short'
        })
        return `[${date}] ${m.content}`
      })
      .join('\n\n')

    // Add header with stats for debugging
    const totalMessages = messages.length
    const noteCount = noteMessages.length
    const header = `=== Notes Export ===
Total messages in database: ${totalMessages}
Notes found: ${noteCount}
Exported: ${new Date().toISOString()}
${'='.repeat(50)}

`

    const filename = `notes-${new Date().toISOString().split('T')[0]}.txt`

    return new NextResponse(header + notes, {
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
