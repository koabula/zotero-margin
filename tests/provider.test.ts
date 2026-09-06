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
  await assert.rejects(parseCompletion(new Response(body, { headers: { "content-type": "text/event-stream" } }), () => {}, new AbortController().signal), /断开/);
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
