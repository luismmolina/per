import { NextRequest, NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { promises as fs } from 'fs'
import path from 'path'

const CONVERSATIONS_KEY = 'contextual-conversations'
const LOCAL_FILE_PATH = path.join(process.cwd(), 'data', 'conversations.json')

// Check if Redis is available
function isRedisAvailable() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  return !!(url && token)
}

// Initialize Redis client
function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  
  if (!url || !token) {
    throw new Error('Redis configuration missing')
  }
  
  return new Redis({
    url,
    token,
  })
}

// File-based storage functions for local development
async function ensureDataDirectory() {
  const dataDir = path.dirname(LOCAL_FILE_PATH)
  try {
    await fs.access(dataDir)
  } catch {
    await fs.mkdir(dataDir, { recursive: true })
  }
}

async function loadFromFile() {
  try {
    await ensureDataDirectory()
    const data = await fs.readFile(LOCAL_FILE_PATH, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    // File doesn't exist or is empty, return empty array
    return { messages: [] }
  }
}

async function saveToFile(data: any) {
  try {
    await ensureDataDirectory()
    await fs.writeFile(LOCAL_FILE_PATH, JSON.stringify(data, null, 2))
  } catch (error) {
    console.error('Failed to save to file:', error)
    throw error
  }
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
    let conversations: any

    if (isRedisAvailable()) {
      console.log('Using Redis for loading conversations')
      const redis = getRedisClient()
      conversations = await redis.get(CONVERSATIONS_KEY)

      if (!conversations) {
        conversations = { messages: [] }
      }
    } else {
      console.log('Using file storage for loading conversations')
      conversations = await loadFromFile()
    }

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
    const { messages } = await req.json()
    
    const conversationData = {
      messages,
      lastUpdated: new Date().toISOString(),
      totalMessages: messages.length
    }
    
    if (isRedisAvailable()) {
      console.log('Using Redis for saving conversations')
      const redis = getRedisClient()
      await redis.set(CONVERSATIONS_KEY, conversationData)
    } else {
      console.log('Using file storage for saving conversations')
      await saveToFile(conversationData)
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to save conversations:', error)
    return NextResponse.json({ success: false, error: 'Failed to save conversations' }, { status: 500 })
  }
}

// DELETE - Clear conversations
export async function DELETE() {
  try {
    if (isRedisAvailable()) {
      console.log('Using Redis for clearing conversations')
      const redis = getRedisClient()
      await redis.del(CONVERSATIONS_KEY)
    } else {
      console.log('Using file storage for clearing conversations')
      await saveToFile({ messages: [] })
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to clear conversations:', error)
    return NextResponse.json({ success: false, error: 'Failed to clear conversations' }, { status: 500 })
  }
} 