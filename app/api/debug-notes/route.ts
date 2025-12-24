import { NextRequest, NextResponse } from 'next/server'
import { loadConversations } from '../../../lib/storage'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
    try {
        const conversations = await loadConversations()
        const messages = conversations?.messages || []

        // Analyze messages by type
        const typeAnalysis = messages.reduce((acc: Record<string, number>, m: any) => {
            const type = m.type || 'unknown'
            acc[type] = (acc[type] || 0) + 1
            return acc
        }, {})

        // Get notes specifically
        const notes = messages.filter((m: any) => m.type === 'note')

        // Get date range
        const timestamps = notes
            .map((m: any) => new Date(m.timestamp).getTime())
            .filter((t: number) => !isNaN(t))
            .sort((a: number, b: number) => a - b)

        const oldestNote = timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : null
        const newestNote = timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]).toISOString() : null

        // Sample of recent notes (last 5)
        const recentNotes = notes
            .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 5)
            .map((m: any) => ({
                id: m.id,
                timestamp: m.timestamp,
                preview: m.content?.substring(0, 100) + (m.content?.length > 100 ? '...' : ''),
                contentLength: m.content?.length || 0
            }))

        return NextResponse.json({
            totalMessages: messages.length,
            typeBreakdown: typeAnalysis,
            noteCount: notes.length,
            dateRange: {
                oldest: oldestNote,
                newest: newestNote
            },
            recentNotes: recentNotes,
            rawDataSize: JSON.stringify(conversations).length
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        })
    } catch (error) {
        console.error('Debug notes error:', error)
        return NextResponse.json({ error: String(error) }, { status: 500 })
    }
}
