// Simple CLI to stream thoughts from the API
// Requires Node.js 18+
// Set API_URL env var when running against a deployed instance

async function fetchThoughts() {
  const baseUrl = process.env.API_URL || 'http://localhost:3000'
  const response = await fetch(`${baseUrl}/api/chat-enhanced`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Tell me your thoughts',
      conversationHistory: []
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      const line = event.trim();
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'thought') {
            console.log(`THOUGHT: ${data.content}`);
          } else if (data.type === 'text') {
            process.stdout.write(data.content);
          }
        } catch (err) {
          console.error('Failed to parse chunk:', err);
        }
      }
    }
  }
}

fetchThoughts().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
