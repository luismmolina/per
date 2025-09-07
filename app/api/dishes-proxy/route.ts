import { NextRequest } from 'next/server'

export async function GET() {
  try {
    console.log('🍽️ Proxy: Fetching dishes data from external API...')
    
    const response = await fetch('https://cogs-two.vercel.app/api/dishes/prices', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GeminiPlayground/1.0)',
      },
    })
    
    if (!response.ok) {
      console.error('Proxy: Failed to fetch dishes data:', response.status, response.statusText)
      return new Response(JSON.stringify({ error: 'Failed to fetch dishes data' }), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }
    
    const data = await response.json()
    console.log('🍽️ Proxy: Successfully fetched dishes data:', {
      totalDishes: data.totalDishes,
      lastUpdated: data.lastUpdated,
      dishesWithCalculationNotes: data.dishes?.filter((d: any) => d.calculationNotes)?.length || 0,
      sampleDishNames: data.dishes?.slice(0, 3).map((d: any) => d.name) || [],
      buffetStats: data.buffetStats ? {
        basicDishes: data.buffetStats.buffetBasicoDishCount,
        premiumDishes: data.buffetStats.buffetPremiumDishCount,
        avgBasicCost: data.buffetStats.averageCostBuffetBasico,
        avgPremiumCost: data.buffetStats.averageCostBuffetPremium
      } : 'Not available'
    })
    
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  } catch (error) {
    console.error('Proxy: Error fetching dishes data:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
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