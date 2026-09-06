import http from 'node:http';
const calls = [];
const server = http.createServer(async (req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ calls })); return; }
  if (req.url === '/v1/models' && req.method === 'GET') { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({data:[{id:'margin-test-model'},{id:'margin-test-alternate'}]})); return; }
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const data = JSON.parse(raw); const messages = data.messages || [];
  const called = messages.filter(m => m.role === 'assistant').flatMap(m => m.tool_calls || []).map(c => c.function.name);
  if (['margin-test-long','margin-test-resume'].includes(data.model)) {
    const entry={model:data.model,kind:data.model,bytes:0,tools:(data.tools || []).map(t=>t.function.name),at:new Date().toISOString()};calls.push(entry);
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
    const send=value=>{const frame='data: '+JSON.stringify(value)+'\n\n';entry.bytes+=Buffer.byteLength(frame);res.write(frame);};
    if(data.model==='margin-test-long') {
      const answer='长回答传输测试，协议开销不应该截断正文。'.repeat(500);
      for(const content of answer)send({id:'synthetic-large-stream',model:data.model,choices:[{delta:{content,reasoning_content:'ignored metadata '.repeat(12)},finish_reason:null}]});
      send({choices:[{delta:{},finish_reason:'stop'}]});
    } else if(entry.tools.includes('create_note')) {
      send({choices:[{delta:{content:'保留原文引用 [[p3]]。下一部分：**'},finish_reason:'length'}]});
    } else if(!called.includes('create_note')) {
      // Deliberately violate the offered schema to verify the agent's execution guard.
      send({choices:[{delta:{tool_calls:[{index:0,id:'duplicate-note',type:'function',function:{name:'create_note',arguments:'{"title":"Must not save twice","content":"duplicate"}'}},{index:1,id:'duplicate-nav',type:'function',function:{name:'navigate',arguments:'{"page":1}'}}]},finish_reason:'tool_calls'}]});
    } else {
      send({choices:[{delta:{content:'续写完成，保留来源。**'},finish_reason:'stop'}]});
    }
    res.end('data: [DONE]\n\n');return;
  }
  const sequence = [
    ['read_pages', { pages: [2, 3] }],
    ['search_document', { query: 'simulator' }],
    ['get_annotations', {}],
    ['navigate', { page: 3 }],
    ['create_note', { title: '理解模拟器', content: '模拟器生成理想世界的视图，用于与真实执行比较。[[p2]]\n\n定义见下一页。[[p3]]' }],
  ];
  const next = data.tools?.[0]?.function?.name === 'connection_check' ? ['connection_check', {}] : sequence.find(([name]) => !called.includes(name));
  calls.push({ model: data.model, next: next?.[0] || 'answer', at: new Date().toISOString() });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const send = data => res.write('data: ' + JSON.stringify(data) + '\n\n');
  if (next) {
    send({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: next[0], arguments: JSON.stringify(next[1]) } }] }, finish_reason: 'tool_calls' }] });
  } else {
    const text = '模拟器的作用，是在理想世界中生成与真实执行难以区分的视图。[[p2]]\n\nA simulator generates an ideal-world view.\n\n可以把它理解为一份“只凭允许的信息也能生成的记录”：如果这份记录与真实记录无法区分，真实执行就没有暴露额外信息。这里是对原文的解释。[[p3]]\n\n```text\nsimulator(input)\n  -> ideal-world view\n```\n\n已定位到定义所在页，并保存阅读笔记。';
    for (const part of text.match(/.{1,6}|\n/g)) { send({ choices: [{ delta: { content: part } }] }); await new Promise(r => setTimeout(r, 35)); }
    send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
  }
  res.end('data: [DONE]\n\n');
});
const port=Number(process.argv[2] || 18765);
server.listen(port, '127.0.0.1', () => console.log('Local test model listening on 127.0.0.1:'+port));
