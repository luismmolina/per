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

// Fetch dishes data from external COGS API
async function fetchDishesData() {
  try {
    console.log('🍽️ Fetching dishes data for notes endpoint...')
    
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
    
    console.log('🍽️ Successfully fetched dishes data for notes endpoint:', {
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
    id: `dishes-summary-${Date.now()}`,
    content: `📊 DISHES SUMMARY: ${dishesData.totalDishes} dishes in production. Last updated: ${dishesData.lastUpdated}`,
    type: 'cogs-summary' as const,
    timestamp: new Date(dishesData.lastUpdated),
    source: 'COGS API',
    metadata: {
      totalDishes: dishesData.totalDishes,
      lastUpdated: dishesData.lastUpdated,
      buffetStats: dishesData.buffetStats
    }
  })

  // Add individual dish notes with calculation details
  dishesData.dishes.forEach((dish: any, index: number) => {
    const dishNote = {
      id: `dish-${index}-${Date.now()}`,
      content: `🍽️ ${dish.name}: ${dish.cost.amount} ${dish.cost.unit} to produce (updated: ${dish.lastUpdated})`,
      type: 'cogs-dish' as const,
      timestamp: new Date(dish.lastUpdated),
      source: 'COGS API',
      metadata: {
        dishName: dish.name,
        cost: dish.cost,
        lastUpdated: dish.lastUpdated,
        buffetBasico: dish.buffetBasico,
        buffetPremium: dish.buffetPremium
      }
    }

    notes.push(dishNote)

    // Add detailed calculation notes if available
    if (dish.calculationNotes) {
      notes.push({
        id: `dish-calculation-${index}-${Date.now()}`,
        content: `📊 COST BREAKDOWN - ${dish.name}:\n\n${dish.calculationNotes}`,
        type: 'cogs-calculation' as const,
        timestamp: new Date(dish.lastUpdated),
        source: 'COGS API',
        metadata: {
          dishName: dish.name,
          cost: dish.cost,
          lastUpdated: dish.lastUpdated
        }
      })
    }
  })

  // Add buffet statistics if available
  if (dishesData.buffetStats) {
    notes.push({
      id: `buffet-stats-${Date.now()}`,
      content: `🍽️ BUFFET STATISTICS:
• Basic Buffet: ${dishesData.buffetStats.buffetBasicoDishCount} dishes, avg cost: ${dishesData.buffetStats.averageCostBuffetBasico} MXN
• Premium Buffet: ${dishesData.buffetStats.buffetPremiumDishCount} dishes, avg cost: ${dishesData.buffetStats.averageCostBuffetPremium} MXN
• COGS per customer - Basic: ${dishesData.buffetStats.cogsPerCustomerBuffetBasico} MXN
• COGS per customer - Premium: ${dishesData.buffetStats.cogsPerCustomerBuffetPremium} MXN`,
      type: 'cogs-buffet' as const,
      timestamp: new Date(dishesData.lastUpdated),
      source: 'COGS API',
      metadata: {
        buffetStats: dishesData.buffetStats,
        lastUpdated: dishesData.lastUpdated
      }
    })
  }

  return notes
}

// GET - Retrieve all notes including COGS data
export async function GET() {
  try {
    console.log('📝 Notes API: Fetching all notes including COGS data...')

    // Get user notes from conversations
    let userNotes = []
    try {
      if (isRedisAvailable()) {
        console.log('📝 Using Redis for loading user notes')
        const redis = getRedisClient()
        const conversations = await redis.get(CONVERSATIONS_KEY)
        
        // Type guard to ensure conversations has the expected structure
        if (conversations && typeof conversations === 'object' && 'messages' in conversations && Array.isArray(conversations.messages)) {
          userNotes = conversations.messages.filter((msg: any) => msg.type === 'note').map((msg: any) => ({
            id: msg.id,
            content: msg.content,
            type: 'user-note' as const,
            timestamp: new Date(msg.timestamp),
            source: 'User Input'
          }))
        }
      } else {
        console.log('📝 Using file storage for loading user notes')
        const conversations = await loadFromFile()
        if (conversations && typeof conversations === 'object' && 'messages' in conversations && Array.isArray(conversations.messages)) {
          userNotes = conversations.messages.filter((msg: any) => msg.type === 'note').map((msg: any) => ({
            id: msg.id,
            content: msg.content,
            type: 'user-note' as const,
            timestamp: new Date(msg.timestamp),
            source: 'User Input'
          }))
        }
      }
    } catch (error) {
      console.warn('Failed to load user notes:', error)
      userNotes = []
    }

    // Get COGS data and transform to notes
    let cogsNotes: Array<{
      id: string
      content: string
      type: 'cogs-summary' | 'cogs-dish' | 'cogs-calculation' | 'cogs-buffet'
      timestamp: Date
      source: string
      metadata: any
    }> = []
    try {
      const dishesData = await fetchDishesData()
      cogsNotes = transformDishesToNotes(dishesData)
    } catch (error) {
      console.warn('Failed to load COGS notes:', error)
      cogsNotes = []
    }

    // Combine all notes and sort by timestamp
    const allNotes = [...userNotes, ...cogsNotes].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    // Prepare response with metadata
    const response = {
      notes: allNotes,
      metadata: {
        totalNotes: allNotes.length,
        userNotes: userNotes.length,
        cogsNotes: cogsNotes.length,
        notesByType: {
          'user-note': userNotes.length,
          'cogs-summary': cogsNotes.filter(n => n.type === 'cogs-summary').length,
          'cogs-dish': cogsNotes.filter(n => n.type === 'cogs-dish').length,
          'cogs-calculation': cogsNotes.filter(n => n.type === 'cogs-calculation').length,
          'cogs-buffet': cogsNotes.filter(n => n.type === 'cogs-buffet').length
        },
        lastUpdated: new Date().toISOString(),
        sources: ['User Input', 'COGS API']
      }
    }

    console.log('📝 Notes API: Successfully compiled notes:', {
      totalNotes: response.metadata.totalNotes,
      userNotes: response.metadata.userNotes,
      cogsNotes: response.metadata.cogsNotes,
      notesByType: response.metadata.notesByType
    })

    return NextResponse.json(response, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })

  } catch (error) {
    console.error('Notes API: Failed to retrieve notes:', error)
    return NextResponse.json(
      { 
        error: 'Failed to retrieve notes',
        notes: [],
        metadata: {
          totalNotes: 0,
          userNotes: 0,
          cogsNotes: 0,
          notesByType: {},
          lastUpdated: new Date().toISOString(),
          sources: []
        }
      }, 
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      }
    )
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}