import { t, type MessageKey } from './i18n';
const messages = {
  model_length: '模型输出达到上限，已保留生成内容，可继续生成。',
  output_limit: '回答达到插件的文字上限，已保留生成内容，可继续生成。',
  transport_limit: '响应数据达到插件的传输保护上限，已保留生成内容。',
  event_limit: '服务返回的单条响应数据过大，插件已停止接收。',
  tool_limit: '服务返回的工具参数过大，插件已停止执行。',
  stream_invalid: '模型返回了损坏的数据流，请重试。',
  network: '响应连接中断，已保留生成内容，请检查网络后继续。',
  idle_timeout: '模型服务长时间没有返回数据，已保留生成内容，可重试或继续。',
  total_timeout: '本次模型请求达到总时限，已保留生成内容，可继续生成。',
  cancelled: '已停止生成',
  provider_error: '模型服务中断了响应，请重试。',
  content_filter: '模型服务未能完成此请求。',
} satisfies Record<string, MessageKey>;
export type CompletionFailure = keyof typeof messages;
export class CompletionError extends Error {
  constructor(readonly code: CompletionFailure) { super(t(messages[code])); this.name='CompletionError'; }
}
