import { NextRequest, NextResponse } from 'next/server'
import { loadConversations } from '../../../lib/storage'

export async function GET(req: NextRequest) {
    try {
        const conversations = await loadConversations()

        // Ensure we have messages
        const messages = conversations.messages || []

        // Filter for notes only
        const notes = messages
            .filter((msg: any) => msg.type === 'note')
            .map((msg: any) => ({
                content: msg.content,
                date: msg.timestamp
            }))
            .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())

        return NextResponse.json({ notes })
    } catch (error) {
        console.error('Failed to load notes:', error)
        return NextResponse.json({ notes: [], error: 'Failed to load notes' }, { status: 500 })
    }
}
