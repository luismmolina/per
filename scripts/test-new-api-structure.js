// Test script to verify the new dishes API structure integration
const baseUrl = process.env.API_URL || 'http://localhost:3000'

async function testNewApiStructure() {
  console.log('🧪 Testing new dishes API structure integration...\n')
  
  try {
    // Test 1: Fetch dishes data through our proxy
    console.log('1️⃣ Testing dishes-proxy endpoint...')
    const proxyResponse = await fetch(`${baseUrl}/api/dishes-proxy`)
    const proxyData = await proxyResponse.json()
    
    if (proxyData.error) {
      console.error('❌ Proxy failed:', proxyData.error)
      return
    }
    
    console.log('✅ Proxy successful')
    console.log(`   - Total dishes: ${proxyData.totalDishes}`)
    console.log(`   - Last updated: ${proxyData.lastUpdated}`)
    console.log(`   - Has buffet stats: ${!!proxyData.buffetStats}`)
    console.log(`   - Sample dishes: ${proxyData.dishes?.slice(0, 2).map(d => d.name).join(', ')}`)
    
    if (proxyData.buffetStats) {
      console.log(`   - Basic buffet: ${proxyData.buffetStats.buffetBasicoDishCount} dishes, avg ${proxyData.buffetStats.averageCostBuffetBasico} MXN`)
      console.log(`   - Premium buffet: ${proxyData.buffetStats.buffetPremiumDishCount} dishes, avg ${proxyData.buffetStats.averageCostBuffetPremium} MXN`)
    }
    
    // Test 2: Test chat-enhanced endpoint with dishes context
    console.log('\n2️⃣ Testing chat-enhanced endpoint with dishes context...')
    const chatResponse = await fetch(`${baseUrl}/api/chat-enhanced`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What is the most expensive dish in the basic buffet?',
        conversationHistory: []
      })
    })
    
    if (!chatResponse.ok || !chatResponse.body) {
      console.error('❌ Chat enhanced failed:', chatResponse.status, chatResponse.statusText)
      return
    }
    
    console.log('✅ Chat enhanced request successful')
    console.log('   - Response status:', chatResponse.status)
    console.log('   - Content-Type:', chatResponse.headers.get('content-type'))
    console.log('   - Streaming response...')

    // Process the streamed response
    const reader = chatResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    let streamEnded = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;

      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // Keep the last partial line in the buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonString = line.substring(6);
            try {
              const data = JSON.parse(jsonString);
              console.log(`     [STREAM] Received type: ${data.type}`);
              if (data.type === 'end') {
                console.log('     [STREAM] End of stream message received.');
                streamEnded = true;
              }
               if (data.type === 'error') {
                console.error(`     [STREAM] Error message received:`, data.content);
                streamEnded = true;
              }
            } catch (e) {
              console.error('❌ Failed to parse JSON from stream:', e);
              console.error('   - Faulty JSON string:', jsonString);
            }
          }
        }
      }
    }

    if (streamEnded) {
       console.log('✅ Chat stream processed successfully.');
    } else {
       console.warn('⚠️ Chat stream finished without an explicit end message.');
    }
    
    // Test 3: Verify data structure compatibility
    console.log('\n3️⃣ Verifying data structure compatibility...')
    const requiredFields = ['dishes', 'totalDishes', 'lastUpdated']
    const dishRequiredFields = ['name', 'cost', 'lastUpdated', 'buffetBasico', 'buffetPremium']
    const costRequiredFields = ['amount', 'unit']
    
    let allGood = true
    
    // Check top-level fields
    for (const field of requiredFields) {
      if (!(field in proxyData)) {
        console.error(`❌ Missing required field: ${field}`)
        allGood = false
      }
    }
    
    // Check dish structure
    if (proxyData.dishes && proxyData.dishes.length > 0) {
      const firstDish = proxyData.dishes[0]
      for (const field of dishRequiredFields) {
        if (!(field in firstDish)) {
          console.error(`❌ Missing required dish field: ${field}`)
          allGood = false
        }
      }
      
      // Check cost structure
      if (firstDish.cost) {
        for (const field of costRequiredFields) {
          if (!(field in firstDish.cost)) {
            console.error(`❌ Missing required cost field: ${field}`)
            allGood = false
          }
        }
      } else {
        console.error('❌ Missing cost object in dish')
        allGood = false
      }
    }
    
    if (allGood) {
      console.log('✅ All required fields present')
    }
    
    // Test 4: Check buffet information
    console.log('\n4️⃣ Checking buffet information...')
    if (proxyData.dishes) {
      const basicDishes = proxyData.dishes.filter(d => d.buffetBasico)
      const premiumDishes = proxyData.dishes.filter(d => d.buffetPremium)
      
      console.log(`   - Basic buffet dishes: ${basicDishes.length}`)
      console.log(`   - Premium buffet dishes: ${premiumDishes.length}`)
      console.log(`   - Dishes in both: ${proxyData.dishes.filter(d => d.buffetBasico && d.buffetPremium).length}`)
      
      if (basicDishes.length > 0) {
        const mostExpensiveBasic = basicDishes.reduce((max, dish) => 
          dish.cost.amount > max.cost.amount ? dish : max
        )
        console.log(`   - Most expensive basic dish: ${mostExpensiveBasic.name} (${mostExpensiveBasic.cost.amount} ${mostExpensiveBasic.cost.unit})`)
      }
    }
    
    console.log('\n🎉 All tests completed successfully!')
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }
}

// Run the test
testNewApiStructure() 