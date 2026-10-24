async function testThinking() {
  console.log('--- TEST: Reasoning / Thinking Tokens ---');
  const res = await fetch('http://127.0.0.1:8045/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3.8-flash-high',
      stream: true,
      messages: [
        { role: 'user', content: 'Có bao nhiêu chữ r trong từ "strawberry"? Giải thích ngắn gọn.' }
      ]
    })
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let thoughts = '';
  let content = '';

  while (!done) {
    const { value, done: isDone } = await reader.read();
    done = isDone;
    if (value) {
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split('\n')) {
        if (line.startsWith('data:') && !line.includes('[DONE]')) {
          try {
            const parsed = JSON.parse(line.slice(5).trim());
            const delta = parsed.choices[0]?.delta;
            if (delta?.reasoning_content) {
              thoughts += delta.reasoning_content;
            }
            if (delta?.content) {
              content += delta.content;
            }
          } catch (e) {}
        }
      }
    }
  }

  console.log('Thoughts length:', thoughts.length);
  if (thoughts) {
    console.log('Sample thinking:', thoughts.substring(0, 150));
  }
  console.log('Output content:', content);
}

testThinking().catch(console.error);
