import { CompletionError } from './errors';
import { t } from "./i18n";
import type { ChatMessage, Completion, Config, ToolCall, ToolSchema } from "./types";

export function endpoint(baseURL: string): string {
  let url: URL;
  try { url = new URL(baseURL.trim()); } catch { throw new Error(t("请输入完整的 API 地址，例如 https://api.example.com/v1")); }
  if (url.username || url.password || url.search || url.hash) throw new Error(t("API 地址不能包含密码、查询参数或片段。"));
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error(t("远程 API 请使用 HTTPS；本机服务可使用 HTTP。"));
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  return url.toString();
}

function friendlyStatus(status: number): string {
  if (status === 401 || status === 403) return t("API 认证失败，请检查 API Key 和模型访问权限。");
  if (status === 429) return t("API 额度不足或请求过于频繁，请稍后重试。");
  if (status === 404) return t("未找到 API 接口或模型，请检查地址和模型名称。");
  return t('模型服务返回 HTTP {status}，请检查配置后重试。',{status});
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
    if (response.status === 404 || response.status === 405) throw new Error(t("服务不支持获取模型列表，请手动添加模型 ID。"));
    if (!response.ok) throw new Error(friendlyStatus(response.status));
    let data: any;
    try { data = await response.json(); } catch { throw new Error(t("模型列表格式无法识别，请手动添加模型 ID。")); }
    if (!Array.isArray(data?.data)) throw new Error(t("模型列表格式无法识别，请手动添加模型 ID。"));
    return [...new Set<string>(data.data.map((item: any) => item?.id).filter((id: unknown) => typeof id === 'string' && id.trim()).map((id: string) => id.trim()))].sort();
  } catch (error) {
    if (signal.aborted) throw new Error(t("已取消获取模型"));
    if (controller.signal.aborted) throw new Error(t("获取模型超时，请重试或手动添加模型 ID。"));
    if (error instanceof TypeError) throw new Error(t("无法连接模型服务，请检查 API 地址和网络。"));
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

/** Limits for retained content are independent of SSE framing and network chunk sizes. */
export const RESPONSE_LIMITS = {
  textChars: 100_000, toolChars: 262_144, eventChars: 1_048_576, transferBytes: 64 * 1024 * 1024,
};
type ParseOptions = Partial<typeof RESPONSE_LIMITS> & { onActivity?: () => void };
/** Parses SSE across arbitrary byte boundaries, including split UTF-8 and CRLF. */
export async function parseCompletion(response: Response, onText: (text: string) => void, signal: AbortSignal, options: ParseOptions = {}): Promise<Completion> {
  const limits = { ...RESPONSE_LIMITS, ...options };
  if (!response.body) throw new Error(t('模型返回空响应。'));
  const streaming = response.headers.get('content-type')?.includes('text/event-stream');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', content = '', done = false, finish = '', size = 0, toolChars = 0;
  const calls = new Map<number, ToolCall>();
  function appendText(text: unknown): void {
    if (text == null) return;
    if (typeof text !== 'string') throw new CompletionError('stream_invalid');
    const accepted = text.slice(0, Math.max(0, limits.textChars - content.length));
    if (accepted) { content += accepted; onText(accepted); }
    if (accepted.length !== text.length) throw new CompletionError('output_limit');
  }
  function appendCall(part: any): void {
    if (!part || !Number.isInteger(part.index) || part.index < 0 || part.index > 15) throw new CompletionError('stream_invalid');
    const call = calls.get(part.index) || { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
    for (const [value, target, key] of [[part.id, call, 'id'], [part.function?.name, call.function, 'name'], [part.function?.arguments, call.function, 'arguments']] as const) {
      if (value == null) continue;
      if (typeof value !== 'string') throw new CompletionError('stream_invalid');
      toolChars += value.length;
      if (toolChars > limits.toolChars) throw new CompletionError('tool_limit');
      (target as any)[key] += value;
    }
    calls.set(part.index, call);
  }
  function event(raw: string): void {
    if (raw.length > limits.eventChars) throw new CompletionError('event_limit');
    const payload = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload) return;
    if (payload === '[DONE]') { done = true; return; }
    let chunk: any;
    try { chunk = JSON.parse(payload); } catch { throw new CompletionError('stream_invalid'); }
    if (chunk?.error) throw new CompletionError('provider_error');
    const choice = chunk?.choices?.[0];
    if (!choice) return;
    finish = choice.finish_reason || finish;
    const delta = choice.delta || {};
    appendText(delta.content);
    if (delta.tool_calls != null && !Array.isArray(delta.tool_calls)) throw new CompletionError('stream_invalid');
    for (const part of delta.tool_calls || []) appendCall(part);
  }
  // Aborting also releases an outstanding read when a stream implementation does not observe fetch's signal.
  const abortRead = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abortRead, { once: true });
  try {
    while (!done) {
      if (signal.aborted) throw new CompletionError('cancelled');
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch { throw new CompletionError(signal.aborted ? 'cancelled' : 'network'); }
      if (signal.aborted) throw new CompletionError('cancelled');
      if (chunk.value?.byteLength) options.onActivity?.();
      size += chunk.value?.byteLength || 0;
      if (size > limits.transferBytes) throw new CompletionError('transport_limit');
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (streaming) {
        let start = 0, match: RegExpExecArray | null;
        const separator = /\r?\n\r?\n/g;
        while ((match = separator.exec(buffer))) {
          event(buffer.slice(start, match.index)); start = separator.lastIndex;
          if (done) break;
        }
        buffer = buffer.slice(start);
      }
      // Check the remaining incomplete event after consuming complete events, not the network chunk.
      if (!done && buffer.length > limits.eventChars) throw new CompletionError('event_limit');
      if (chunk.done) {
        if (streaming) { if (buffer.trim()) event(buffer); }
        else {
          let data: any;
          try { data = JSON.parse(buffer); } catch { throw new CompletionError('stream_invalid'); }
          const choice = data?.choices?.[0];
          if (!choice?.message || data.error) throw new CompletionError('provider_error');
          appendText(choice.message.content);
          finish = choice.finish_reason || '';
          for (const [index, call] of validateCalls(choice.message.tool_calls || []).entries()) appendCall({ ...call, index });
          done = true;
        }
        break;
      }
    }
  } finally {
    signal.removeEventListener('abort', abortRead);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
  if (!done && !finish) throw new CompletionError('network');
  if (finish === 'length') throw new CompletionError('model_length');
  if (finish === 'content_filter') throw new CompletionError('content_filter');
  return { content, toolCalls: validateCalls([...calls.values()]) };
}
function validateCalls(calls: any[]): ToolCall[] {
  if (!Array.isArray(calls) || calls.length > 16 || calls.some(c => !c.id || c.type !== "function" || typeof c.function?.name !== "string" || typeof c.function?.arguments !== "string")) throw new Error(t("模型返回的工具调用格式不正确。"));
  return calls;
}

export async function complete(config: Config, messages: ChatMessage[], tools: ToolSchema[], onText: (text: string) => void, signal: AbortSignal, fetcher: typeof fetch = fetch, timeouts = { idleMs: 60_000, totalMs: 600_000 }): Promise<Completion> {
  if (!config.model.trim()) throw new Error(t("请先在设置中填写模型名称。"));
  const url = endpoint(config.baseURL);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let timeoutCode: 'idle_timeout' | 'total_timeout' | undefined;
  let idleTimer: ReturnType<typeof setTimeout>;
  const expire = (code: typeof timeoutCode) => { if (!controller.signal.aborted) { timeoutCode = code; controller.abort(); } };
  const activity = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => expire('idle_timeout'), timeouts.idleMs); };
  activity();
  const timeout = setTimeout(() => expire('total_timeout'), timeouts.totalMs);
  try {
    const response = await fetcher(url, {
      method: "POST", signal: controller.signal, redirect: "error", credentials: "omit",
      headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ model: config.model.trim(), messages, stream: true, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
    });
    if (!response.ok) throw new Error(friendlyStatus(response.status));
    activity();
    return await parseCompletion(response, onText, controller.signal, { onActivity: activity });
  } catch (error) {
    if (signal.aborted) throw new CompletionError('cancelled');
    if (timeoutCode) throw new CompletionError(timeoutCode);
    if (error instanceof TypeError) throw new Error(t("无法连接模型服务，请检查 API 地址和网络。"));
    throw error;
  } finally { clearTimeout(timeout); clearTimeout(idleTimer!); signal.removeEventListener("abort", abort); }
}

export async function testConnection(config: Config, signal: AbortSignal): Promise<void> {
  const tools: ToolSchema[] = [{ type: "function", function: { name: "connection_check", description: "Call this function to confirm tool calling works.", parameters: { type: "object", properties: {}, additionalProperties: false } } }];
  const result = await complete(config, [{ role: "user", content: "Call connection_check with {}. Do not answer in text." }], tools, () => {}, signal);
  if (!result.toolCalls.some(t => t.function.name === "connection_check")) throw new Error(t("连接成功，但模型未执行工具调用。请选用支持工具调用的模型。"));
}
