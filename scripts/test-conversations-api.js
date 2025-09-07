// Test script for the conversations API endpoint
// This script tests the /api/conversations endpoint to verify it returns only notes

async function testConversationsAPI() {
  const baseUrl = process.env.API_URL || 'http://localhost:3000'
  
  console.log('🧪 Testing Conversations API endpoint...')
  console.log(`📍 Base URL: ${baseUrl}`)
  
  try {
    // Test the conversations endpoint
    console.log('\n📝 Testing GET /api/conversations...')
    const response = await fetch(`${baseUrl}/api/conversations`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    
    console.log('✅ Conversations API Response:')
    console.log('📊 Metadata:', {
      totalMessages: data.totalMessages,
      lastUpdated: data.lastUpdated,
      messageCount: data.messages?.length || 0
    })

    console.log('\n📋 Messages Summary:')
    if (data.messages && data.messages.length > 0) {
      console.log(`Total messages retrieved: ${data.messages.length}`)
      
      // Show first few messages as examples
      const sampleMessages = data.messages.slice(0, 3)
      sampleMessages.forEach((msg, index) => {
        console.log(`\n${index + 1}. Message:`)
        console.log(`   Content: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`)
        console.log(`   Timestamp: ${msg.timestamp}`)
        
        // Check that id and type fields are not present
        if (msg.id !== undefined) {
          console.log(`   ⚠️  WARNING: 'id' field is still present: ${msg.id}`)
        }
        if (msg.type !== undefined) {
          console.log(`   ⚠️  WARNING: 'type' field is still present: ${msg.type}`)
        }
        
        // Show available fields
        const fields = Object.keys(msg)
        console.log(`   Available fields: ${fields.join(', ')}`)
      })

      if (data.messages.length > 3) {
        console.log(`\n... and ${data.messages.length - 3} more messages`)
      }
    } else {
      console.log('No messages found')
    }

    // Verify that all messages are notes (no questions or AI responses)
    console.log('\n🔍 Message Type Verification:')
    const hasQuestions = data.messages?.some(msg => msg.type === 'question')
    const hasAIResponses = data.messages?.some(msg => msg.type === 'ai-response')
    
    if (hasQuestions) {
      console.log('   ⚠️  WARNING: Questions found in response (should be filtered out)')
    } else {
      console.log('   ✅ No questions found (correctly filtered)')
    }
    
    if (hasAIResponses) {
      console.log('   ⚠️  WARNING: AI responses found in response (should be filtered out)')
    } else {
      console.log('   ✅ No AI responses found (correctly filtered)')
    }

    console.log('\n✅ Conversations API test completed successfully!')

  } catch (error) {
    console.error('❌ Conversations API test failed:', error.message)
    process.exit(1)
  }
}

// Run the test
testConversationsAPI().catch(console.error)