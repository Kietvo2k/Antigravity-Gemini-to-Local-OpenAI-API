async function runTests() {
  console.log('--- TEST 1: GET /v1/models ---');
  const modelsRes = await fetch('http://127.0.0.1:8045/v1/models');
  const modelsData = await modelsRes.json();
  console.log(`Fetched ${modelsData.data.length} models. Sample:`, modelsData.data.slice(0, 3).map(m => m.id));

  console.log('\n--- TEST 2: POST /v1/chat/completions (Stream: false) ---');
  const chatRes = await fetch('http://127.0.0.1:8045/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3.8-flash-high',
      stream: false,
      messages: [
        { role: 'system', content: 'Bạn là chuyên gia lập trình tối giản.' },
        { role: 'user', content: '2 + 5 bằng mấy? Trả lời 1 số.' }
      ]
    })
  });
  const chatData = await chatRes.json();
  console.log('Non-stream response:', JSON.stringify(chatData, null, 2));

  console.log('\n--- TEST 3: POST /v1/chat/completions (Stream: true, SSE) ---');
  const streamRes = await fetch('http://127.0.0.1:8045/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3.8-flash-high',
      stream: true,
      messages: [
        { role: 'user', content: 'Đếm từ 1 đến 5, cách nhau bằng dấu cách.' }
      ]
    })
  });

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let receivedContent = '';

  process.stdout.write('Stream tokens: ');
  while (!done) {
    const { value, done: isDone } = await reader.read();
    done = isDone;
    if (value) {
      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:') && !line.includes('[DONE]')) {
          try {
            const parsed = JSON.parse(line.slice(5).trim());
            const delta = parsed.choices[0]?.delta;
            if (delta?.content) {
              receivedContent += delta.content;
              process.stdout.write(delta.content);
            }
          } catch (e) {}
        }
      }
    }
  }
  console.log('\nFinal Streamed Output:', receivedContent);
}

runTests().catch(console.error);
