import { setLanguage } from "../src/i18n";
import test from "node:test";
test.beforeEach(() => setLanguage("zh-CN"));
import assert from "node:assert/strict";
import { endpoint, complete, parseCompletion, testConnection } from "../src/provider";

test("API endpoints are normalized and prevent secret-bearing redirects/URLs", () => {
  assert.equal(endpoint("https://api.example.com/v1/"), "https://api.example.com/v1/chat/completions");
  assert.equal(endpoint("http://localhost:1234/v1/chat/completions"), "http://localhost:1234/v1/chat/completions");
  for (const url of ["file:///tmp", "http://example.com/v1", "https://user:password@example.com", "https://example.com?key=secret"]) assert.throws(() => endpoint(url));
});
test("streaming handles split UTF8, CRLF, and fragmented tool arguments", async () => {
  const frames = [
    { choices: [{ delta: { content: "你好，原文" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read_pages", arguments: '{"pages":[' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "2]}" } }] }, finish_reason: "tool_calls" }] },
  ];
  const bytes = new TextEncoder().encode(frames.map(f => `data: ${JSON.stringify(f)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n");
  const body = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2)); controller.close(); } });
  let text = "";
  const result = await parseCompletion(new Response(body, { headers: { "content-type": "text/event-stream" } }), t => { text += t; }, new AbortController().signal);
  assert.equal(text, "你好，原文"); assert.equal(result.toolCalls[0].function.arguments, '{"pages":[2]}');
});
test("a disconnected stream is not reported as a completed answer", async () => {
  const body = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
  await assert.rejects(parseCompletion(new Response(body, { headers: { "content-type": "text/event-stream" } }), () => {}, new AbortController().signal), error => error instanceof CompletionError && error.code === "network");
});
test("non-streaming compatibility and authentication failures", async () => {
  const result = await parseCompletion(Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), () => {}, new AbortController().signal);
  assert.equal(result.content, "ok");
  let options: RequestInit | undefined;
  await assert.rejects(complete({ baseURL: "https://api.example.com/v1", model: "model", apiKey: "secret" }, [], [], () => {}, new AbortController().signal, (async (_url: unknown, init: RequestInit) => { options = init; return new Response("secret echo", { status: 401 }); }) as typeof fetch), /认证失败/);
  assert.equal(options?.redirect, "error"); assert.equal(options?.credentials, "omit");
  assert.ok(!String(options?.body).includes("secret"));
});
test("aborting cancels the underlying network request", async () => {
  const signal = new AbortController();
  let called = false;
  const result = complete({ baseURL: "https://api.example.com", model: "m", apiKey: "" }, [], [], () => {}, signal.signal, (async (_url: unknown, init: RequestInit) => {
    called = true;
    return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
  }) as typeof fetch);
  assert.ok(called); signal.abort(); await assert.rejects(result, /已停止/);
});
import { CompletionError } from '../src/errors';
const frame = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({id:'synthetic',model:'synthetic-model',choices:[{delta,finish_reason}]})}\n\n`;
const sse = (text: string, width = Number.MAX_SAFE_INTEGER) => {
  const bytes=new TextEncoder().encode(text);let offset=0;
  return new Response(new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,offset+width));offset=Math.min(bytes.length,offset+width);}}),{headers:{'content-type':'text/event-stream'}});
};
const failure = (code: string) => (error: unknown) => error instanceof CompletionError && error.code===code;

test('SSE over the former 2 MB limit retains the same answer across network and model chunk sizes',async()=>{
  const text='中文😀'.repeat(4000);
  const wire=Array.from(text).map(char=>frame({content:char,reasoning_content:'ignored provider reasoning '.repeat(3)})).join('')+frame({},'stop')+'data: [DONE]\n\n';
  assert.ok(new TextEncoder().encode(wire).length>2_000_000);
  for(const width of [37,8192,Number.MAX_SAFE_INTEGER]){
    let shown='';const result=await parseCompletion(sse(wire,width),delta=>shown+=delta,new AbortController().signal);
    assert.equal(shown,text);assert.equal(result.content,text);
  }
  const result=await parseCompletion(sse(frame({content:text},'stop')+'data: [DONE]\n\n'),()=>{},new AbortController().signal);
  assert.equal(result.content,text);
});

test('text limits preserve a bounded partial answer independently of chunking',async()=>{
  for(const width of [1,4096]){
    let shown='';
    await assert.rejects(parseCompletion(sse(frame({content:'12345'})+frame({content:'67890'},'stop'),width),delta=>shown+=delta,new AbortController().signal,{textChars:8}),failure('output_limit'));
    assert.equal(shown,'12345678');
  }
});

test('event and tool limits guard unbounded data without confusing large network chunks with events',async()=>{
  const signal=new AbortController().signal;
  await assert.rejects(parseCompletion(sse('data: '+'x'.repeat(600)),()=>{},signal,{eventChars:512}),failure('event_limit'));
  const many=frame({content:'x'}).repeat(100)+'data: [DONE]\n\n';
  assert.equal((await parseCompletion(sse(many),()=>{},signal,{eventChars:512})).content.length,100);
  const call=(args:string,first=false)=>frame({tool_calls:[{index:0,...(first?{id:'c',function:{name:'create_note',arguments:args}}:{function:{arguments:args}})}]});
  await assert.rejects(parseCompletion(sse(call('x'.repeat(20),true)+call('x'.repeat(20))+'data: [DONE]\n\n'),()=>{},signal,{toolChars:40}),failure('tool_limit'));
  await assert.rejects(parseCompletion(sse(many),()=>{},signal,{transferBytes:100}),failure('transport_limit'));
});

test('JSON and SSE model truncation both preserve content and identify the model limit',async()=>{
  for(const response of [Response.json({choices:[{message:{content:'partial'},finish_reason:'length'}]}),sse(frame({content:'partial'},'length')+'data: [DONE]\n\n')]){
    let shown='';await assert.rejects(parseCompletion(response,delta=>shown+=delta,new AbortController().signal),failure('model_length'));assert.equal(shown,'partial');
  }
  await assert.rejects(parseCompletion(Response.json({choices:[{message:{content:'x'.repeat(1000)},finish_reason:'stop'}]}),()=>{},new AbortController().signal,{eventChars:200}),failure('event_limit'));
});

test('idle timeout cancels a stalled body and is distinct from the total request deadline',async()=>{
  const config={baseURL:'http://localhost/v1',model:'mock',apiKey:''};let cancelled=false;
  const stalled=(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}})) as typeof fetch;
  await assert.rejects(complete(config,[],[],()=>{},new AbortController().signal,stalled,{idleMs:20,totalMs:500}),failure('idle_timeout'));
  assert.equal(cancelled,true);
  let timer:ReturnType<typeof setInterval>;let count=0;
  const active=(async()=>new Response(new ReadableStream({start(controller){timer=setInterval(()=>controller.enqueue(new TextEncoder().encode(frame({content:String(count++)}))),5);},cancel(){clearInterval(timer);}}),{headers:{'content-type':'text/event-stream'}})) as typeof fetch;
  await assert.rejects(complete(config,[],[],()=>{},new AbortController().signal,active,{idleMs:100,totalMs:70}),failure('total_timeout'));
  assert.ok(count>1);
});

test('ongoing data resets the idle deadline and user stop remains distinguishable',async()=>{
  const config={baseURL:'http://localhost/v1',model:'mock',apiKey:''};let timer:ReturnType<typeof setInterval>;let count=0;
  const active=(async()=>new Response(new ReadableStream({start(controller){timer=setInterval(()=>{controller.enqueue(new TextEncoder().encode(frame({content:'x'})));if(++count===6){clearInterval(timer);controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));controller.close();}},20);},cancel(){clearInterval(timer);}}),{headers:{'content-type':'text/event-stream'}})) as typeof fetch;
  assert.equal((await complete(config,[],[],()=>{},new AbortController().signal,active,{idleMs:80,totalMs:600})).content,'xxxxxx');
  const abort=new AbortController();const stopped=complete(config,[],[],()=>{},abort.signal,(async()=>new Response(new ReadableStream({}),{headers:{'content-type':'text/event-stream'}})) as typeof fetch,{idleMs:100,totalMs:600});
  abort.abort();await assert.rejects(stopped,failure('cancelled'));
});
