import { t } from "./i18n";
export interface Config {
  baseURL: string;
  model: string;
  apiKey: string;
  modelIDs?: string[];
  defaultModelID?: string;
}
export interface Source {
  id: string;
  pageIndex: number;
  pageLabel: string;
  excerpt: string;
  annotationID?: string;
}
export interface ReaderContext {
  attachmentID: number;
  libraryID: number;
  groupID?: number;
  attachmentKey: string;
  title: string;
  authors: string;
  pageIndex: number;
  pageLabel: string;
  pageCount: number;
  selection: string;
  selectionPageIndex?: number;
}
export interface PageText { pageIndex: number; pageLabel: string; text: string }
export interface AnnotationText { id: string; pageIndex: number; pageLabel: string; text: string; comment: string }
export interface ReaderBridge {
  context(): Promise<ReaderContext>;
  readPage(pageIndex: number, signal?: AbortSignal): Promise<PageText>;
  annotations(): Promise<AnnotationText[]>;
  navigate(source: Source): Promise<void>;
  createNote(title: string, html: string): Promise<{ id: number }>;
  assertActive(): void;
}
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  status?: "stopped" | "error";
  contextLabel?: string;
  modelID?: string;
}
export interface Session { version: 1; messages: DisplayMessage[]; draft: string; modelID?: string; archives?: { createdAt: string; messages: DisplayMessage[]; modelID?: string }[] }
export interface Store {
  getLanguage?(): Promise<import('./i18n').LanguagePreference>;
  saveLanguage?(language: import('./i18n').LanguagePreference): Promise<void>;
  getConfig(): Promise<Config>;
  saveConfig(config: Config): Promise<void>;
  loadSession(key: string): Promise<Session>;
  saveSession(key: string, session: Session): Promise<void>;
}
export type ToolSchema = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export interface Completion { content: string; toolCalls: ToolCall[] }
export type Complete = (messages: ChatMessage[], tools: ToolSchema[], onText: (text: string) => void, signal: AbortSignal) => Promise<Completion>;
export function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw new Error(t("已停止生成")); }
export const emptySession = (): Session => ({ version: 1, messages: [], draft: "" });
