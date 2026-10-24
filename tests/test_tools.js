async function testTools() {
  console.log('--- TEST: Function Calling / Tools ---');
  const res = await fetch('http://127.0.0.1:8045/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3.8-flash-high',
      stream: false,
      messages: [
        { role: 'user', content: 'Thời tiết ở Hà Nội hôm nay thế nào?' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_current_weather',
            description: 'Lấy thông tin thời tiết hiện tại của một thành phố',
            parameters: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: 'Tên thành phố, ví dụ: Hanoi, Tokyo'
                }
              },
              required: ['location']
            }
          }
        }
      ]
    })
  });

  const data = await res.json();
  console.log('Function call response:', JSON.stringify(data, null, 2));
}

testTools().catch(console.error);
