async function testStreamTools() {
  console.log('--- TEST: Streaming Function Calling ---');
  const res = await fetch('http://127.0.0.1:8045/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3.8-flash-high',
      stream: true,
      messages: [
        { role: 'user', content: 'Lấy thời tiết ở Tokyo giúp tôi' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_current_weather',
            description: 'Lấy thời tiết hiện tại',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' }
              },
              required: ['location']
            }
          }
        }
      ]
    })
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let fullChunks = [];

  while (!done) {
    const { value, done: isDone } = await reader.read();
    done = isDone;
    if (value) {
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split('\n')) {
        if (line.startsWith('data:') && !line.includes('[DONE]')) {
          try {
            fullChunks.push(JSON.parse(line.slice(5).trim()));
          } catch (e) {}
        }
      }
    }
  }

  console.log(`Received ${fullChunks.length} stream chunks.`);
  for (const c of fullChunks) {
    const delta = c.choices[0]?.delta;
    if (delta?.tool_calls) {
      console.log('Tool call chunk:', JSON.stringify(delta.tool_calls));
    }
  }
}

testStreamTools().catch(console.error);
