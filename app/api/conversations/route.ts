import { NextRequest, NextResponse } from 'next/server'
import { estimateJsonBytes, logDbTransfer } from '../../../lib/db-diagnostics'
import { computeNoteIndexFingerprint } from '../../../lib/note-retrieval'
import {
  appendConversationMessages,
  clearConversations,
  loadConversations,
  saveConversations,
  upsertConversationMessages,
} from '../../../lib/storage'

let _syncNoteIndex: ((data: any) => Promise<any>) | null | undefined = undefined
let _syncNoteFacts: ((data: any, options?: { maxNotes?: number }) => Promise<any>) | null | undefined = undefined

async function syncNoteIndex(data: any): Promise<boolean> {
  if (_syncNoteIndex === undefined) {
    try {
      const mod = await import('../../../lib/note-retrieval')
      _syncNoteIndex = mod.syncConversationNoteIndex
    } catch {
      console.warn('[conversations] note-retrieval unavailable — skipping index sync')
      _syncNoteIndex = null
    }
  }
  if (_syncNoteIndex) {
    await _syncNoteIndex(data)
    return true
  }
  return false
}

async function syncNoteFacts(data: any, maxNotes = 3): Promise<boolean> {
  if (_syncNoteFacts === undefined) {
    try {
      const mod = await import('../../../lib/facts')
      _syncNoteFacts = mod.syncConversationNoteFacts
    } catch {
      console.warn('[conversations] facts module unavailable — skipping fact sync')
      _syncNoteFacts = null
    }
  }
  if (_syncNoteFacts) {
    await _syncNoteFacts(data, { maxNotes })
    return true
  }
  return false
}

async function maybeSyncNoteIndex(
  conversations: Record<string, unknown>,
  previousFingerprint?: string,
): Promise<boolean> {
  const fingerprint = computeNoteIndexFingerprint(conversations as any)
  if (fingerprint === previousFingerprint) {
    logDbTransfer('conversations.syncNoteIndex', { syncSkipped: true })
    // Still extract facts for any dirty notes (independent of embedding fingerprint)
    try {
      await syncNoteFacts(conversations, 3)
    } catch (error) {
      console.error('Failed to sync note facts:', error)
    }
    return false
  }

  const conversationData = {
    ...conversations,
    noteIndexFingerprint: fingerprint,
  }

  if (conversations.noteIndexFingerprint !== fingerprint) {
    await saveConversations(conversationData as any)
  }

  await syncNoteIndex(conversationData)
  try {
    await syncNoteFacts(conversationData, 3)
  } catch (error) {
    console.error('Failed to sync note facts after index sync:', error)
  }
  logDbTransfer('conversations.syncNoteIndex', { syncSkipped: false, noteIndexFingerprint: fingerprint })
  return true
}

function getMessageKey(message: any) {
  if (message?.id) return `id:${message.id}`
  return [
    message?.type || 'unknown',
    message?.timestamp || '',
    message?.content || ''
  ].join(':')
}

function getTimestampMs(message: any) {
  const timestamp = new Date(message?.timestamp).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function mergeMessages(existingMessages: any[], incomingMessages: any[]) {
  const merged = [...existingMessages]
  const indexByKey = new Map<string, number>()

  merged.forEach((message, index) => {
    indexByKey.set(getMessageKey(message), index)
  })

  for (const message of incomingMessages) {
    const key = getMessageKey(message)
    const existingIndex = indexByKey.get(key)

    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length)
      merged.push(message)
      continue
    }

    merged[existingIndex] = {
      ...merged[existingIndex],
      ...message
    }
  }

  return merged.sort((a, b) => getTimestampMs(a) - getTimestampMs(b))
}

// Fetch dishes data from external COGS API
async function fetchDishesData() {
  try {
    console.log('🍽️ Fetching dishes data for conversations API...')

    const response = await fetch('https://cogs-two.vercel.app/api/dishes/prices', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GeminiPlayground/1.0)',
      },
    })

    if (!response.ok) {
      console.warn('Failed to fetch dishes data:', response.status, response.statusText)
      return null
    }

    const data = await response.json()

    if (data.error) {
      console.warn('Dishes API returned error:', data.error)
      return null
    }

    console.log('🍽️ Successfully fetched dishes data for conversations API:', {
      totalDishes: data.totalDishes,
      lastUpdated: data.lastUpdated,
      dishesWithCalculationNotes: data.dishes?.filter((d: any) => d.calculationNotes)?.length || 0,
      sampleDishNames: data.dishes?.slice(0, 3).map((d: any) => d.name) || []
    })

    return data
  } catch (error) {
    console.warn('Error fetching dishes data:', error)
    return null
  }
}

function transformDishesToNotes(dishesData: any) {
  if (!dishesData || !dishesData.dishes) {
    return []
  }

  const notes = []

  notes.push({
    content: `📊 DISHES SUMMARY: ${dishesData.totalDishes} dishes in production. Last updated: ${dishesData.lastUpdated}`,
    timestamp: new Date(dishesData.lastUpdated),
    source: 'COGS API'
  })

  dishesData.dishes.forEach((dish: any) => {
    const dishNote = {
      content: `🍽️ ${dish.name}: ${dish.cost.amount} ${dish.cost.unit} to produce (updated: ${dish.lastUpdated})`,
      timestamp: new Date(dish.lastUpdated),
      source: 'COGS API'
    }

    notes.push(dishNote)

    if (dish.calculationNotes) {
      notes.push({
        content: `📊 COST BREAKDOWN - ${dish.name}:\n\n${dish.calculationNotes}`,
        timestamp: new Date(dish.lastUpdated),
        source: 'COGS API'
      })
    }
  })

  if (dishesData.buffetStats) {
    notes.push({
      content: `🍽️ BUFFET STATISTICS:
• Basic Buffet: ${dishesData.buffetStats.buffetBasicoDishCount} dishes, avg cost: ${dishesData.buffetStats.averageCostBuffetBasico} MXN
• Premium Buffet: ${dishesData.buffetStats.buffetPremiumDishCount} dishes, avg cost: ${dishesData.buffetStats.averageCostBuffetPremium} MXN
• COGS per customer - Basic: ${dishesData.buffetStats.cogsPerCustomerBuffetBasico} MXN
• COGS per customer - Premium: ${dishesData.buffetStats.cogsPerCustomerBuffetPremium} MXN`,
      timestamp: new Date(dishesData.lastUpdated),
      source: 'COGS API'
    })
  }

  return notes
}

// GET - Load conversations (including COGS data)
export async function GET(req: NextRequest) {
  try {
    let conversations: any = await loadConversations()
    logDbTransfer('conversations.GET', {
      conversationsBytesLoaded: estimateJsonBytes(conversations),
    })

    const { searchParams } = new URL(req.url)
    const includeCogs = searchParams.get('includeCogs') === 'true'

    if (!includeCogs) {
      if (!conversations || typeof conversations !== 'object' || !Array.isArray(conversations.messages)) {
        conversations = {
          messages: [],
          lastUpdated: new Date().toISOString(),
          totalMessages: 0
        }
      }
      return NextResponse.json(conversations)
    }

    const userNotes = (conversations.messages || [])
      .filter((msg: any) => msg.type === 'note')
      .map((msg: any) => {
        const { id, type, ...filteredMsg } = msg
        return {
          ...filteredMsg,
          source: 'User Input'
        }
      })

    let cogsNotes: Array<{
      content: string
      timestamp: Date
      source: string
    }> = []
    try {
      const dishesData = await fetchDishesData()
      cogsNotes = transformDishesToNotes(dishesData)
    } catch (error) {
      console.warn('Failed to load COGS notes:', error)
      cogsNotes = []
    }

    const allNotes = [...userNotes, ...cogsNotes].sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    const derivedView = {
      messages: allNotes,
      lastUpdated: new Date().toISOString(),
      totalMessages: allNotes.length,
      sources: ['User Input', 'COGS API']
    }

    return NextResponse.json(derivedView)
  } catch (error) {
    console.error('Failed to load conversations:', error)
    return NextResponse.json({ messages: [] }, { status: 500 })
  }
}

// POST - Save conversations (full merge)
export async function POST(req: NextRequest) {
  try {
    const { messages, forceOverwrite } = await req.json()

    if (!Array.isArray(messages)) {
      return NextResponse.json({ success: false, error: 'messages must be an array' }, { status: 400 })
    }

    const existing = await loadConversations()
    logDbTransfer('conversations.POST.load', {
      conversationsBytesLoaded: estimateJsonBytes(existing),
      incomingMessages: messages.length,
      incomingBytes: estimateJsonBytes(messages),
    })

    const existingCount = existing?.messages?.length || 0
    const newCount = messages.length

    if (!forceOverwrite && existingCount > 0 && newCount < existingCount * 0.5) {
      return NextResponse.json(
        { success: false, error: `Save blocked: would reduce messages from ${existingCount} to ${newCount}. Use forceOverwrite to override.` },
        { status: 409 }
      )
    }

    const messagesToSave = forceOverwrite
      ? messages
      : mergeMessages(existing?.messages || [], messages)

    const noteIndexFingerprint = computeNoteIndexFingerprint({ messages: messagesToSave })
    const conversationData = {
      messages: messagesToSave,
      lastUpdated: new Date().toISOString(),
      totalMessages: messagesToSave.length,
      noteIndexFingerprint,
    }

    await saveConversations(conversationData)
    logDbTransfer('conversations.POST.save', {
      conversationsBytesWritten: estimateJsonBytes(conversationData),
    })

    let retrievalSynced = false
    try {
      retrievalSynced = await maybeSyncNoteIndex(
        conversationData,
        typeof existing.noteIndexFingerprint === 'string' ? existing.noteIndexFingerprint : undefined,
      )
    } catch (error) {
      console.error('Failed to sync note index after save:', error)
    }

    return NextResponse.json({ success: true, retrievalSynced })
  } catch (error) {
    console.error('Failed to save conversations:', error)
    return NextResponse.json({ success: false, error: 'Failed to save conversations' }, { status: 500 })
  }
}

// PATCH - Append or upsert a small set of messages without sending the full history
export async function PATCH(req: NextRequest) {
  try {
    const { messages, mode } = await req.json()

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ success: false, error: 'messages must be a non-empty array' }, { status: 400 })
    }

    logDbTransfer('conversations.PATCH', {
      mode: mode === 'upsert' ? 'upsert' : 'append',
      incomingMessages: messages.length,
      incomingBytes: estimateJsonBytes(messages),
    })

    const affectsNotes = messages.some((message: any) => message?.type === 'note')
    const existingBeforePatch = await loadConversations()
    const previousFingerprint = typeof existingBeforePatch.noteIndexFingerprint === 'string'
      ? existingBeforePatch.noteIndexFingerprint
      : undefined

    let totalMessages = 0
    let conversationData: Record<string, unknown>

    if (mode === 'upsert') {
      const upserted = await upsertConversationMessages(messages)
      conversationData = upserted
      totalMessages = upserted.totalMessages ?? upserted.messages.length
      logDbTransfer('conversations.PATCH.upsert', {
        conversationsBytesWritten: estimateJsonBytes(conversationData),
      })
    } else {
      totalMessages = await appendConversationMessages(messages)
      conversationData = await loadConversations()
      logDbTransfer('conversations.PATCH.append', {
        conversationsBytesWritten: estimateJsonBytes(messages),
        totalMessages,
      })
    }

    let retrievalSynced = false
    if (affectsNotes) {
      try {
        retrievalSynced = await maybeSyncNoteIndex(
          conversationData,
          typeof previousFingerprint === 'string' ? previousFingerprint : undefined,
        )
      } catch (error) {
        console.error('Failed to sync note index after patch:', error)
      }
    } else {
      logDbTransfer('conversations.PATCH.syncNoteIndex', { syncSkipped: true, reason: 'no-notes' })
    }

    return NextResponse.json({ success: true, totalMessages, retrievalSynced })
  } catch (error) {
    console.error('Failed to patch conversations:', error)
    return NextResponse.json({ success: false, error: 'Failed to patch conversations' }, { status: 500 })
  }
}

// PUT - Delete a specific message by ID
export async function PUT(req: NextRequest) {
  try {
    const { messageId } = await req.json()

    if (!messageId) {
      return NextResponse.json({ success: false, error: 'messageId is required' }, { status: 400 })
    }

    const existing = await loadConversations()
    const existingMessages = existing?.messages || []
    const deletedMessage = existingMessages.find((msg: any) => msg.id === messageId)

    const updatedMessages = existingMessages.filter((msg: any) => msg.id !== messageId)

    if (updatedMessages.length === existingMessages.length) {
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 })
    }

    const noteIndexFingerprint = computeNoteIndexFingerprint({ messages: updatedMessages })
    const conversationData = {
      messages: updatedMessages,
      lastUpdated: new Date().toISOString(),
      totalMessages: updatedMessages.length,
      noteIndexFingerprint,
    }

    await saveConversations(conversationData)

    let retrievalSynced = false
    try {
      const shouldSync = deletedMessage?.type === 'note'
      if (shouldSync) {
        retrievalSynced = await maybeSyncNoteIndex(
          conversationData,
          typeof existing.noteIndexFingerprint === 'string' ? existing.noteIndexFingerprint : undefined,
        )
      } else {
        logDbTransfer('conversations.PUT.syncNoteIndex', { syncSkipped: true, reason: 'non-note-delete' })
      }
    } catch (error) {
      console.error('Failed to sync note index after deleting a message:', error)
    }

    console.log(`[DELETE MESSAGE] Removed message ${messageId}, ${existingMessages.length} -> ${updatedMessages.length} messages`)

    return NextResponse.json({ success: true, remainingMessages: updatedMessages.length, retrievalSynced })
  } catch (error) {
    console.error('Failed to delete message:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete message' }, { status: 500 })
  }
}

// DELETE - Clear conversations
export async function DELETE() {
  try {
    const existing = await loadConversations()
    await clearConversations()

    let retrievalSynced = false
    try {
      retrievalSynced = await maybeSyncNoteIndex(
        { messages: [], lastUpdated: new Date().toISOString(), totalMessages: 0 },
        typeof existing.noteIndexFingerprint === 'string' ? existing.noteIndexFingerprint : undefined,
      )
    } catch (error) {
      console.error('Failed to clear the note index after deleting conversations:', error)
    }

    return NextResponse.json({ success: true, retrievalSynced })
  } catch (error) {
    console.error('Failed to clear conversations:', error)
    return NextResponse.json({ success: false, error: 'Failed to clear conversations' }, { status: 500 })
  }
}