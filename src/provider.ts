import type { ChatMessage, Completion, Config, ToolCall, ToolSchema } from "./types";

export function endpoint(baseURL: string): string {
  let url: URL;
  try { url = new URL(baseURL.trim()); } catch { throw new Error("请输入完整的 API 地址，例如 https://api.example.com/v1"); }
  if (url.username || url.password || url.search || url.hash) throw new Error("API 地址不能包含密码、查询参数或片段。");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("远程 API 请使用 HTTPS；本机服务可使用 HTTP。");
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  return url.toString();
}

function friendlyStatus(status: number): string {
  if (status === 401 || status === 403) return "API 认证失败，请检查 API Key 和模型访问权限。";
  if (status === 429) return "API 额度不足或请求过于频繁，请稍后重试。";
  if (status === 404) return "未找到 API 接口或模型，请检查地址和模型名称。";
  return `模型服务返回 HTTP ${status}，请检查配置后重试。`;
}

export async function listModels(baseURL: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch, timeoutMs = 15_000): Promise<string[]> {
  const url = endpoint(baseURL).replace(/\/chat\/completions$/, '/models');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetcher(url, { method:'GET', signal:controller.signal, redirect:'error', credentials:'omit', headers: apiKey ? {Authorization:`Bearer ${apiKey}`} : {} });
    if (response.status === 404 || response.status === 405) throw new Error('服务不支持获取模型列表，请手动添加模型 ID。');
    if (!response.ok) throw new Error(friendlyStatus(response.status));
    let data: any;
    try { data = await response.json(); } catch { throw new Error('模型列表格式无法识别，请手动添加模型 ID。'); }
    if (!Array.isArray(data?.data)) throw new Error('模型列表格式无法识别，请手动添加模型 ID。');
    return [...new Set<string>(data.data.map((item: any) => item?.id).filter((id: unknown) => typeof id === 'string' && id.trim()).map((id: string) => id.trim()))].sort();
  } catch (error) {
    if (signal.aborted) throw new Error('已取消获取模型');
    if (controller.signal.aborted) throw new Error('获取模型超时，请重试或手动添加模型 ID。');
    if (error instanceof TypeError) throw new Error('无法连接模型服务，请检查 API 地址和网络。');
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

/** Parses SSE across arbitrary byte boundaries, including split UTF-8 and CRLF. */
export async function parseCompletion(response: Response, onText: (text: string) => void, signal: AbortSignal): Promise<Completion> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice?.message || data.error) throw new Error("模型返回了无法识别的响应，请确认 API 兼容 Chat Completions。");
    if (choice.finish_reason === "length") throw new Error("模型输出达到长度上限，请缩小问题范围后重试。");
    const content = choice.message.content || "";
    if (content) onText(content);
    return { content, toolCalls: validateCalls(choice.message.tool_calls || []) };
  }
  if (!response.body) throw new Error("模型返回空响应。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", content = "", done = false, finish = "", size = 0;
  const calls = new Map<number, ToolCall>();
  function event(raw: string) {
    const payload = raw.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
    if (!payload) return;
    if (payload === "[DONE]") { done = true; return; }
    let chunk: any;
    try { chunk = JSON.parse(payload); } catch { throw new Error("模型返回了损坏的数据流，请重试。"); }
    if (chunk.error) throw new Error("模型服务中断了响应，请重试。");
    const choice = chunk.choices?.[0];
    if (!choice) return;
    finish = choice.finish_reason || finish;
    const delta = choice.delta || {};
    if (typeof delta.content === "string") { content += delta.content; onText(delta.content); }
    for (const part of delta.tool_calls || []) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index > 15) throw new Error("工具调用格式错误。");
      const call = calls.get(part.index) || { id: "", type: "function", function: { name: "", arguments: "" } };
      if (part.id) call.id += part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      calls.set(part.index, call);
    }
  }
  try {
    while (!done) {
      if (signal.aborted) throw new Error("已停止生成");
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      size += chunk.value?.byteLength || 0;
      if (size > 2_000_000) throw new Error("响应过长，请缩小问题范围。");
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        event(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (done) break;
      }
      if (chunk.done) { if (buffer.trim()) event(buffer); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!done && !finish) throw new Error("连接在回答完成前断开，请重试。");
  if (finish === "length") throw new Error("模型输出达到长度上限，请缩小问题范围后重试。");
  if (finish === "content_filter") throw new Error("模型服务未能完成此请求。");
  return { content, toolCalls: validateCalls([...calls.values()]) };
}
function validateCalls(calls: any[]): ToolCall[] {
  if (!Array.isArray(calls) || calls.length > 16 || calls.some(c => !c.id || c.type !== "function" || typeof c.function?.name !== "string" || typeof c.function?.arguments !== "string")) throw new Error("模型返回的工具调用格式不正确。");
  return calls;
}

export async function complete(config: Config, messages: ChatMessage[], tools: ToolSchema[], onText: (text: string) => void, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Completion> {
  if (!config.model.trim()) throw new Error("请先在设置中填写模型名称。");
  const url = endpoint(config.baseURL);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetcher(url, {
      method: "POST", signal: controller.signal, redirect: "error", credentials: "omit",
      headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ model: config.model.trim(), messages, stream: true, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
    });
    if (!response.ok) throw new Error(friendlyStatus(response.status));
    return await parseCompletion(response, onText, controller.signal);
  } catch (error) {
    if (signal.aborted) throw new Error("已停止生成");
    if (controller.signal.aborted) throw new Error("请求超时，请检查网络或换用响应更快的模型。");
    if (error instanceof TypeError) throw new Error("无法连接模型服务，请检查 API 地址和网络。");
    throw error;
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
}

export async function testConnection(config: Config, signal: AbortSignal): Promise<void> {
  const tools: ToolSchema[] = [{ type: "function", function: { name: "connection_check", description: "Call this function to confirm tool calling works.", parameters: { type: "object", properties: {}, additionalProperties: false } } }];
  const result = await complete(config, [{ role: "user", content: "Call connection_check with {}. Do not answer in text." }], tools, () => {}, signal);
  if (!result.toolCalls.some(t => t.function.name === "connection_check")) throw new Error("连接成功，但模型未执行工具调用。请选用支持工具调用的模型。");
}
