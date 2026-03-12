import { NextRequest, NextResponse } from 'next/server'
import { loadConversations, saveConversations, clearConversations } from '../../../lib/storage'

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

    // Check if the response contains an error
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

// Transform dishes data into notes format
function transformDishesToNotes(dishesData: any) {
  if (!dishesData || !dishesData.dishes) {
    return []
  }

  const notes = []

  // Add overall dishes summary note
  notes.push({
    content: `📊 DISHES SUMMARY: ${dishesData.totalDishes} dishes in production. Last updated: ${dishesData.lastUpdated}`,
    timestamp: new Date(dishesData.lastUpdated),
    source: 'COGS API'
  })

  // Add individual dish notes with calculation details
  dishesData.dishes.forEach((dish: any, index: number) => {
    const dishNote = {
      content: `🍽️ ${dish.name}: ${dish.cost.amount} ${dish.cost.unit} to produce (updated: ${dish.lastUpdated})`,
      timestamp: new Date(dish.lastUpdated),
      source: 'COGS API'
    }

    notes.push(dishNote)

    // Add detailed calculation notes if available
    if (dish.calculationNotes) {
      notes.push({
        content: `📊 COST BREAKDOWN - ${dish.name}:\n\n${dish.calculationNotes}`,
        timestamp: new Date(dish.lastUpdated),
        source: 'COGS API'
      })
    }
  })

  // Add buffet statistics if available
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

    // By default, return RAW conversations without mixing in COGS notes.
    // Optionally allow includeCogs=true to return the derived notes view.
    const { searchParams } = new URL(req.url)
    const includeCogs = searchParams.get('includeCogs') === 'true'

    if (!includeCogs) {
      // Ensure a stable shape
      if (!conversations || typeof conversations !== 'object' || !Array.isArray(conversations.messages)) {
        conversations = {
          messages: [],
          lastUpdated: new Date().toISOString(),
          totalMessages: 0
        }
      }
      return NextResponse.json(conversations)
    }

    // Derived notes view (non-persistent): user notes + COGS notes
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

// POST - Save conversations
export async function POST(req: NextRequest) {
  try {
    const { messages, forceOverwrite } = await req.json()

    // Safety check: Prevent accidental data loss
    // Don't allow saving fewer messages than already exist (unless explicitly forced)
    if (!forceOverwrite) {
      const existing = await loadConversations()
      const existingCount = existing?.messages?.length || 0
      const newCount = messages?.length || 0

      if (existingCount > 0 && newCount < existingCount) {
        console.warn(`[SAFETY] Blocked save that would reduce messages from ${existingCount} to ${newCount}`)
        return NextResponse.json({
          success: false,
          error: 'Save blocked: would result in data loss',
          existingCount,
          attemptedCount: newCount
        }, { status: 409 })
      }
    }

    const conversationData = {
      messages,
      lastUpdated: new Date().toISOString(),
      totalMessages: messages.length
    }

    await saveConversations(conversationData)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to save conversations:', error)
    return NextResponse.json({ success: false, error: 'Failed to save conversations' }, { status: 500 })
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

    // Filter out the message to delete
    const updatedMessages = existingMessages.filter((msg: any) => msg.id !== messageId)

    // Check if a message was actually removed
    if (updatedMessages.length === existingMessages.length) {
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 })
    }

    const conversationData = {
      messages: updatedMessages,
      lastUpdated: new Date().toISOString(),
      totalMessages: updatedMessages.length
    }

    await saveConversations(conversationData)

    console.log(`[DELETE MESSAGE] Removed message ${messageId}, ${existingMessages.length} -> ${updatedMessages.length} messages`)

    return NextResponse.json({ success: true, remainingMessages: updatedMessages.length })
  } catch (error) {
    console.error('Failed to delete message:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete message' }, { status: 500 })
  }
}

// DELETE - Clear conversations
export async function DELETE() {
  try {
    await clearConversations()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to clear conversations:', error)
    return NextResponse.json({ success: false, error: 'Failed to clear conversations' }, { status: 500 })
  }
} 
