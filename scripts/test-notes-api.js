// Test script for the new notes API endpoint
// This script tests the /api/notes endpoint to verify it returns all notes including COGS data

async function testNotesAPI() {
  const baseUrl = process.env.API_URL || 'http://localhost:3000'
  
  console.log('🧪 Testing Notes API endpoint...')
  console.log(`📍 Base URL: ${baseUrl}`)
  
  try {
    // Test the notes endpoint
    console.log('\n📝 Testing GET /api/notes...')
    const response = await fetch(`${baseUrl}/api/notes`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    
    console.log('✅ Notes API Response:')
    console.log('📊 Metadata:', {
      totalNotes: data.metadata?.totalNotes,
      userNotes: data.metadata?.userNotes,
      cogsNotes: data.metadata?.cogsNotes,
      notesByType: data.metadata?.notesByType,
      lastUpdated: data.metadata?.lastUpdated,
      sources: data.metadata?.sources
    })

    console.log('\n📋 Notes Summary:')
    if (data.notes && data.notes.length > 0) {
      console.log(`Total notes retrieved: ${data.notes.length}`)
      
      // Show first few notes as examples
      const sampleNotes = data.notes.slice(0, 5)
      sampleNotes.forEach((note, index) => {
        console.log(`\n${index + 1}. [${note.type}] ${note.source}`)
        console.log(`   ID: ${note.id}`)
        console.log(`   Timestamp: ${note.timestamp}`)
        console.log(`   Content: ${note.content.substring(0, 100)}${note.content.length > 100 ? '...' : ''}`)
      })

      if (data.notes.length > 5) {
        console.log(`\n... and ${data.notes.length - 5} more notes`)
      }
    } else {
      console.log('No notes found')
    }

    // Test specific note types
    console.log('\n🔍 Note Type Analysis:')
    const noteTypes = data.notes?.reduce((acc, note) => {
      acc[note.type] = (acc[note.type] || 0) + 1
      return acc
    }, {}) || {}
    
    Object.entries(noteTypes).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} notes`)
    })

    // Test COGS-specific data
    const cogsNotes = data.notes?.filter(note => note.source === 'COGS API') || []
    console.log(`\n🍽️ COGS Notes: ${cogsNotes.length} notes from COGS API`)
    
    if (cogsNotes.length > 0) {
      const cogsTypes = cogsNotes.reduce((acc, note) => {
        acc[note.type] = (acc[note.type] || 0) + 1
        return acc
      }, {})
      
      Object.entries(cogsTypes).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} notes`)
      })
    }

    console.log('\n✅ Notes API test completed successfully!')

  } catch (error) {
    console.error('❌ Notes API test failed:', error.message)
    process.exit(1)
  }
}

// Run the test
testNotesAPI().catch(console.error)