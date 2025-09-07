// Simple test to isolate chat-enhanced API issue
const baseUrl = process.env.API_URL || 'http://localhost:3000'

async function testSimpleChat() {
  console.log('🧪 Testing simple chat-enhanced endpoint...\n')
  
  try {
    // Test with minimal payload
    console.log('1️⃣ Testing with minimal payload...')
    const response = await fetch(`${baseUrl}/api/chat-enhanced`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Hello',
        conversationHistory: []
      })
    })
    
    console.log('Response status:', response.status)
    console.log('Response headers:', Object.fromEntries(response.headers.entries()))
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('Error response:', errorText)
      return
    }
    
    console.log('✅ Chat enhanced successful')
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }
}

testSimpleChat() 