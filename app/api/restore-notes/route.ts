import { NextRequest, NextResponse } from 'next/server'
import { restoreNotes } from '../../../scripts/restore-notes'

// POST - Trigger notes restoration
export async function POST(req: NextRequest) {
  try {
    console.log('🔄 Notes restoration API: Starting restoration process...')
    
    // Run the restoration process
    const success = await restoreNotes()
    
    if (success) {
      console.log('✅ Notes restoration API: Restoration completed successfully')
      return NextResponse.json({ 
        success: true, 
        message: 'Notes restored successfully',
        timestamp: new Date().toISOString()
      })
    } else {
      console.log('❌ Notes restoration API: Restoration failed')
      return NextResponse.json({ 
        success: false, 
        error: 'Notes restoration failed',
        timestamp: new Date().toISOString()
      }, { status: 500 })
    }
    
  } catch (error) {
    console.error('💥 Notes restoration API: Unexpected error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Unexpected error during restoration',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

// GET - Check restoration status (for future use)
export async function GET() {
  return NextResponse.json({ 
    message: 'Notes restoration endpoint is available',
    usage: 'Send POST request to trigger restoration',
    timestamp: new Date().toISOString()
  })
}

// Handle preflight requests
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
} 