import { CompletionError } from './errors';
import { t, L, refreshTranslations, onLanguageChange, getLanguage, getLocale, setLanguage, translateKnown, type MessageKey } from "./i18n";
import { ReadingAgent } from "./agent";
import { setMarkup } from "./dom";
import { complete, endpoint, testConnection, listModels } from "./provider";
import { normalizeConfig, type ModelConfig } from './models';
import { TextSelection } from './selection';
import { renderMarkdown, renderNote, escapeHTML } from "./markdown";
import { emptySession, type Config, type DisplayMessage, type ReaderBridge, type ReaderContext, type Session, type Source, type Store } from "./types";

const paths: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  arrow: '<path d="m6 12 6-6 6 6M12 6v13"/>',
  book: '<path d="M12 5v15M12 6C9 3 5 3 3 4v14c3-1 6 0 9 2 3-2 6-3 9-2V4c-2-1-6-1-9 2Z"/>',
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  note: '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M15 3l6 6M15 3v6h6M7 13h10M7 17h7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
export const icon = (name: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
const button = (action: string, label: MessageKey, symbol: string) => `<button type="button" class="margin-icon-button" data-action="${action}" data-i18n-aria-label="${label}" data-i18n-title="${label}" aria-label="${t(label)}" title="${t(label)}">${icon(symbol)}</button>`;
export interface UIHost {
  store: Store;
  copy(text: string): void;
  openURL(url: string): void;
  focusPane?(): void;
}

export class Sidebar {
  readonly root: HTMLElement;
  private bridge: ReaderBridge | null = null;
  private context: ReaderContext | null = null;
  private session = emptySession();
  private key = "";
  private generation = 0;
  private controller?: AbortController;
  private connectionController?: AbortController;
  private config: ModelConfig = normalizeConfig({ baseURL: "", model: "", apiKey: "" });
  private discoveryController?: AbortController;
  private settingsIDs = new Set<string>();
  private settingsDefault = '';
  private availableModels: string[] = [];
  private selection: TextSelection;
  private messageNodes = new Map<string, { node: HTMLElement; markup: string }>();
  private includeSelection = true;
  private view: "chat" | "settings" | "history" = "chat";
  private renderTimer?: ReturnType<typeof setTimeout>;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private logs: string[] = [];
  private pendingNote?: { title: string; content: string; sources: Source[]; resolve: (value: { saved: boolean; id?: number }) => void };
  private disposed = false;
  private preparing = false;
  private unsubscribeLanguage: () => void;
  constructor(body: HTMLElement, private host: UIHost) {
    this.root = body.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml", "div");
    this.root.className = "margin-app";
    setMarkup(this.root, `
      <header class="margin-header"><div class="margin-context"><span class="margin-document-title">${L('打开一篇文献')}</span><span class="margin-document-meta">${L('打开文献开始阅读')}</span></div><nav data-i18n-aria-label="助手操作" aria-label="${t('助手操作')}">${button("new", "新对话", "plus")}${button("history", "历史对话", "history")}${button("settings", "模型设置", "settings")}</nav></header>
      <main class="margin-chat"><div class="margin-transcript" role="log" data-i18n-aria-label="阅读对话" aria-label="${t('阅读对话')}"></div><div class="margin-note-review" hidden="hidden"></div><div class="margin-status" role="status" aria-live="polite"></div><div class="margin-error" role="alert" hidden="hidden"></div>
      <form class="margin-composer"><div class="margin-selection" hidden="hidden"><span></span>${button("selection", "移除选区上下文", "close")}</div><textarea data-i18n-aria-label="向文献提问" aria-label="${t('向文献提问')}" rows="2" data-i18n-placeholder="问问这篇文献…" placeholder="${t('问问这篇文献…')}"></textarea><div class="margin-composer-bottom"><select class="margin-model" data-i18n-aria-label="聊天模型" aria-label="${t('聊天模型')}"></select><button class="margin-send" type="submit" data-i18n-aria-label="发送问题" aria-label="${t('发送问题')}" data-i18n-title="发送 · Enter" title="${t('发送 · Enter')}">${icon("arrow")}</button></div></form></main>
      <section class="margin-settings" hidden="hidden" data-i18n-aria-label="模型设置" aria-label="${t('模型设置')}"></section><section class="margin-history" hidden="hidden" data-i18n-aria-label="历史对话" aria-label="${t('历史对话')}"></section>`);
    body.append(this.root);
    this.selection = new TextSelection(this.root, text => this.host.copy(text), () => this.scheduleRender());
    this.root.addEventListener('change', e => this.change(e));
    this.root.addEventListener("click", e => this.click(e));
    this.el<HTMLFormElement>(".margin-composer").addEventListener("submit", e => { e.preventDefault(); if (this.controller) this.stop(); else void this.send(); });
    const input = this.el<HTMLTextAreaElement>("textarea");
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!this.controller) void this.send(); } });
    input.addEventListener("input", () => { this.session.draft = input.value; this.deferSave(); input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 150)}px`; });
    this.unsubscribeLanguage = onLanguageChange(() => this.refreshLanguage());
    this.root.lang = getLocale();
    this.renderMessages();
    this.updateContext();
    void this.refreshConfig();
  }
  private refreshLanguage(): void {
    if (this.disposed) return;
    refreshTranslations(this.root);
    this.selection.refreshLanguage();
    for(const node of this.root.querySelectorAll<HTMLElement>('.margin-citation[data-source]')) {
      const message=this.message(node); const source=(message?.sources || this.pendingNote?.sources || []).find(s=>s.id===node.dataset.source);
      if(source) node.title=t('PDF 第 {page} 页',{page:source.pageIndex+1});
    }
    this.updateContext(); this.updateModel();
    const send = this.el<HTMLButtonElement>('.margin-send');
    send.title = t(this.controller ? '停止生成' : '发送 · Enter');
    send.setAttribute('aria-label', t(this.controller ? '停止生成' : '发送问题'));
    // These containers contain only plugin status text, never model output or form values.
    for (const selector of ['.margin-status','.margin-error','.margin-model-feedback','.margin-settings-feedback','[data-action="fetch-models"]']) {
      const element=this.root.querySelector(selector); if (!element) continue;
      const walker=this.root.ownerDocument.createTreeWalker(element,4);
      while(walker.nextNode()) { const node=walker.currentNode; const value=translateKnown(node.nodeValue || ''); if(value!==node.nodeValue) node.nodeValue=value; }
    }
    if (this.view === 'history') { const view=this.el('.margin-history'), scroll=view.scrollTop; this.openHistory(); view.scrollTop=scroll; }
    if (this.view === 'settings') { this.el<HTMLSelectElement>('[name="language"]').value=getLanguage(); this.renderModelList(); }
  }
  private el<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector(selector)!; }
  private show(selector: string, visible: boolean): void { this.el(selector).hidden = !visible; }
  async attach(bridge: ReaderBridge | null): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    if (!bridge) { this.stop(); this.bridge = null; this.context = null; this.updateContext(); return; }
    try {
      const context = await bridge.context();
      if (this.disposed || generation !== this.generation) return;
      const key = `${context.libraryID}-${context.attachmentKey}`;
      if (key !== this.key) {
        this.stop();
        if (this.key) await this.persist();
        if (this.disposed || generation !== this.generation) return;
        const session = await this.host.store.loadSession(key);
        if (this.disposed || generation !== this.generation) return;
        this.key = key; this.session = session; this.includeSelection = true;
        this.el<HTMLTextAreaElement>("textarea").value = session.draft;
        this.renderMessages();
        this.clearError();
      }
      this.bridge = bridge; this.context = context; this.updateContext(); this.updateModel();
    } catch (error) { if (generation === this.generation) this.error(error); }
  }
  async refreshContext(): Promise<void> {
    if (!this.bridge || this.controller || this.disposed) return;
    const bridge = this.bridge, generation = this.generation;
    try {
      const context = await bridge.context();
      if (!this.disposed && bridge === this.bridge && generation === this.generation) { this.context = context; this.updateContext(); }
    } catch { /* Closing/loading tabs are handled by attach. */ }
  }
  private updateContext(): void {
    const context = this.context;
    this.el(".margin-document-title").textContent = context?.title || t("打开一篇文献");
    this.el(".margin-document-title").title = context?.title || "";
    this.el(".margin-document-meta").textContent = context ? t('第 {page} 页 · PDF {index}/{total}', {page:context.pageLabel,index:context.pageIndex+1,total:context.pageCount}) : t("在 Zotero 阅读器里开始");
    const selected = !!context?.selection && this.includeSelection;
    this.show(".margin-selection", selected);
    if (selected) this.el(".margin-selection span").textContent = t('已选文字 · {text}', {text:context!.selection.slice(0,65)+(context!.selection.length>65?'…':'')});
    this.el<HTMLTextAreaElement>("textarea").disabled = !context;
    this.el<HTMLButtonElement>(".margin-send").disabled = !context;
  }
  async refreshConfig(): Promise<void> {
    try { const config = await this.host.store.getConfig(); if (!this.disposed) { this.config = normalizeConfig(config); this.updateModel(); } } catch (e) { this.error(e); }
  }
  private updateModel(): boolean {
    const select = this.el<HTMLSelectElement>('.margin-model');
    const { modelIDs, defaultModelID } = this.config;
    let removed = false;
    if (modelIDs.length && !modelIDs.includes(this.session.modelID || '')) {
      if (this.session.modelID) { removed = true; this.status(t("原模型已移除，已切换到默认模型")); }
      this.session.modelID = defaultModelID; this.deferSave();
    }
    const options = modelIDs.length ? modelIDs.map(id => `<option value="${escapeHTML(id)}">${escapeHTML(id)}</option>`).join('') : `<option value="">${t('请先配置模型')}</option>`;
    setMarkup(select, options); select.value = this.session.modelID || defaultModelID;
    select.title = select.value || t("请在右上角设置模型"); select.disabled = !!this.controller || this.preparing || !modelIDs.length;
    return removed;
  }
  private change(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.name === 'language') {
      const value=input.value as import('./i18n').LanguagePreference;
      void (async () => { try { await this.host.store.saveLanguage?.(value); setLanguage(value); } catch { input.value=getLanguage(); this.error(new Error(t('语言保存失败，请重试。'))); } })(); return;
    }
    if (input.matches('.margin-model')) {
      if (this.controller || this.preparing || !this.config.modelIDs.includes(input.value)) { this.updateModel(); return; }
      this.session.modelID = input.value; this.deferSave(); return;
    }
    if (input.matches('[data-model-id]')) {
      if (input.checked) this.settingsIDs.add(input.dataset.modelId!); else this.settingsIDs.delete(input.dataset.modelId!);
      if (!this.settingsIDs.has(this.settingsDefault)) this.settingsDefault = [...this.settingsIDs][0] || '';
      this.renderModelList();
    }
    if (input.name === 'defaultModel') this.settingsDefault = input.value;
  }
  private canContinue(message: DisplayMessage): boolean { return message.role === 'assistant' && !!message.status && !!message.content.trim() && message.failureCode !== 'content_filter' && this.session.messages.at(-1) === message; }
  private renderMessages(): void {
    if (this.disposed) return;
    const transcript = this.el(".margin-transcript");
    const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 100;
    if (!this.session.messages.length) {
      this.messageNodes.clear();
      if (transcript.querySelector(".margin-welcome")) return;
      setMarkup(transcript, `<section class="margin-welcome"><span class="margin-welcome-icon">${icon("book")}</span><h2>${L('一起读懂这篇文献')}</h2><p>${L('选中一段文字，或直接提问')}</p><div class="margin-suggestions"><button data-i18n-data-prompt="请解释我选中的这段文字，说明关键概念，并举一个简单例子。" data-prompt="${t('请解释我选中的这段文字，说明关键概念，并举一个简单例子。')}">${L('解释选区')}</button><button data-i18n-data-prompt="请总结当前页的核心观点，区分结论与论证，并引用原文。" data-prompt="${t('请总结当前页的核心观点，区分结论与论证，并引用原文。')}">${L('总结本页')}</button></div></section>`);
      return;
    }
    const markupFor = (m: DisplayMessage) => m.role === "user"
      ? `<article class="margin-user" data-message="${escapeHTML(m.id)}"><div>${escapeHTML(m.content).replace(/\n/g, "<br/>")}</div>${m.contextLabel ? `<small>${escapeHTML(m.contextLabel)}</small>` : ""}</article>`
      : `<article class="margin-assistant" data-message="${escapeHTML(m.id)}"><div class="margin-prose">${m.content ? renderMarkdown(m.content, m.sources) : '<span class="margin-thinking"><i></i><i></i><i></i></span>'}</div>${m.modelID ? `<div class="margin-answer-model">${escapeHTML(m.modelID)}</div>` : ""}${m.status ? `<div class="margin-message-status">${L(m.status === "stopped" ? "已停止 · 保留已生成内容" : "本次回答未完成")}</div>` : ""}${m.content ? `<div class="margin-message-actions">${button("copy", "复制回答", "copy")}${button("save-answer", "保存为文献笔记", "note")}${this.canContinue(m) ? `<button type="button" class="margin-secondary" data-action="continue" data-i18n-title="使用此回答的原模型继续生成，仅查阅原文。" title="${t("使用此回答的原模型继续生成，仅查阅原文。")}">${L("继续生成")}</button>` : ""}${m.sources.length ? `<details><summary>${L('{count} 处参考',{count:m.sources.length})}</summary><div class="margin-source-list">${m.sources.map(s => `<button type="button" data-source="${escapeHTML(s.id)}">${L('第 {page} 页',{page:s.pageLabel})} <small>PDF ${s.pageIndex + 1}</small></button>`).join("")}</div></details>` : ""}</div>` : ""}</article>`;
    transcript.querySelector('.margin-welcome')?.remove();
    const ids = new Set(this.session.messages.map(m => m.id));
    for (const [id, entry] of this.messageNodes) if (!ids.has(id)) { entry.node.remove(); this.messageNodes.delete(id); }
    for (const message of this.session.messages) {
      const revision = JSON.stringify([message,this.canContinue(message)]);
      const markup = markupFor(message);
      let entry = this.messageNodes.get(message.id);
      if (!entry) {
        const holder = this.root.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        setMarkup(holder, markup);
        entry = {node:holder.firstElementChild as HTMLElement, markup:revision};
        this.messageNodes.set(message.id, entry); transcript.append(entry.node);
      } else if (entry.markup !== revision && !this.selection.blocks(entry.node)) {
        const holder = this.root.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        setMarkup(holder, markup);
        entry.node.replaceChildren(...Array.from(holder.firstElementChild!.childNodes)); entry.markup = revision;
      }
    }
    if (nearBottom && !this.selection.blocks()) transcript.scrollTop = transcript.scrollHeight;
  }
  private scheduleRender(): void { if (!this.renderTimer) this.renderTimer = setTimeout(() => { this.renderTimer = undefined; this.renderMessages(); }, 80); }
  private status(text: string, success = true): void {
    if (this.disposed) return;
    if (this.logs.at(-1) !== text) this.logs.push(text);
    setMarkup(this.el(".margin-status"), `<details><summary>${this.controller ? '<span class="margin-status-dot"></span>' : icon(success ? "check" : "close")}${escapeHTML(text)}</summary><div>${this.logs.slice(-8).map(l => `<p>${escapeHTML(l)}</p>`).join("")}</div></details>`);
  }
  private error(error: unknown): void {
    if (this.disposed) return;
    const message = error instanceof Error ? error.message : String(error);
    if (this.view === "settings" && this.root.querySelector(".margin-settings-feedback")) this.el(".margin-settings-feedback").textContent = message;
    else { this.el(".margin-error").textContent = message; this.show(".margin-error", true); }
  }
  private clearError(): void { this.show(".margin-error", false); }
  private async persist(): Promise<void> { if (this.key) await this.host.store.saveSession(this.key, this.session); }
  private deferSave(): void { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => void this.persist().catch(e => this.error(e)), 400); }
  private busy(value: boolean): void {
    const send = this.el<HTMLButtonElement>(".margin-send");
    setMarkup(send, value ? '<span class="margin-stop-icon"></span>' : icon("arrow"));
    send.title = value ? t("停止生成") : t("发送 · Enter");
    send.setAttribute("aria-label", value ? t("停止生成") : t("发送问题"));
    this.root.classList.toggle("margin-is-busy", value); this.updateModel();
  }
  async send(question?: string, resumeID?: string): Promise<void> {
    if (this.controller || this.preparing || !this.bridge || !this.context) return;
    const input = this.el<HTMLTextAreaElement>("textarea");
    const resume = resumeID ? this.session.messages.find(message => message.id === resumeID) : undefined;
    if (resumeID && (!resume || !this.canContinue(resume))) return;
    const resumeIndex = resume ? this.session.messages.indexOf(resume) : -1;
    let questionIndex = resumeIndex - 1;
    while (questionIndex >= 0 && this.session.messages[questionIndex].role !== 'user') questionIndex--;
    const text = (resume ? this.session.messages[questionIndex]?.content || '' : question ?? input.value).trim();
    if (!text) return;
    if (text.length > 12000) { this.error(new Error(t("问题过长，请控制在 12000 字以内。"))); return; }
    this.clearError();
    this.preparing = true; this.updateModel();
    const bridge = this.bridge, requestSession = this.session;
    try { this.config = normalizeConfig(await this.host.store.getConfig()); this.updateModel(); endpoint(this.config.baseURL); if (!this.config.defaultModelID) throw new Error(t("请先配置模型。")); }
    catch { this.preparing = false; this.updateModel(); if (!this.disposed && bridge === this.bridge) this.openSettings(); return; }
    if (this.disposed || bridge !== this.bridge || requestSession !== this.session) { this.preparing = false; return; }
    let context: ReaderContext;
    try { bridge.assertActive(); context = await bridge.context(); bridge.assertActive(); } catch (e) { this.preparing = false; this.updateModel(); this.error(e); return; }
    this.preparing = false;
    if (this.disposed || bridge !== this.bridge || requestSession !== this.session) return;
    const config = { ...this.config, model: resume?.modelID || this.session.modelID || this.config.defaultModelID };
    if (!this.config.modelIDs.includes(config.model)) { this.updateModel(); this.error(new Error(t('请先重新启用这条回答使用的模型，再继续生成。'))); return; }
    if (resume?.requestContext && resume.requestContext.attachmentKey === context.attachmentKey && resume.requestContext.libraryID === context.libraryID) context = resume.requestContext;
    if (!resume && !this.includeSelection) context.selection = "";
    this.context = context;
    const controller = new AbortController(); this.controller = controller;
    const history = resume ? this.session.messages.slice(0,questionIndex) : [...this.session.messages];
    const continuation = resume ? {content:resume.content,sources:[...resume.sources]} : undefined;
    const answer: DisplayMessage = resume || { id: uid(), role: "assistant", content: "", sources: [], modelID: config.model, requestContext: { ...context } };
    answer.modelID ??= config.model; answer.requestContext ??= { ...context };
    answer.status = undefined; answer.failureCode = undefined;
    if (!resume) {
    this.session.messages.push({ id: uid(), role: "user", content: text, sources: [], contextLabel: t('第 {page} 页',{page:context.pageLabel})+(context.selection?t(' · 已选文字'):'') }, answer);
    input.value = ""; input.style.height = "auto"; this.session.draft = "";
    }
    this.logs = []; this.busy(true); this.renderMessages();
    const transcript = this.el(".margin-transcript"); transcript.scrollTop = transcript.scrollHeight;
    const agent = new ReadingAgent(bridge, context, (messages, tools, onText, signal) => complete(config, messages, tools, onText, signal), {
      text: delta => { answer.content += delta; this.scheduleRender(); },
      status: label => this.status(label),
      sources: sources => { answer.sources = sources; },
      note: (title, content, sources, signal) => this.reviewNote(title, content, sources, signal),
    });
    try { await agent.run(text, history, controller.signal, continuation); }
    catch (error) { answer.failureCode = error instanceof CompletionError ? error.code : undefined; answer.status = controller.signal.aborted ? "stopped" : "error"; if (!controller.signal.aborted) this.error(error); }
    finally {
      if (this.controller === controller) { this.controller = undefined; this.busy(false); this.status(answer.status === "stopped" ? t("已停止") : answer.status === "error" ? t("请求未完成，可再次提问") : t("回答完成"), !answer.status); }
      this.renderMessages(); await this.persist().catch(e => this.error(e));
    }
  }
  stop(): void { this.controller?.abort(); this.pendingNote?.resolve({ saved: false }); this.pendingNote = undefined; this.show(".margin-note-review", false); }
  private reviewNote(title: string, content: string, sources: Source[], signal: AbortSignal): Promise<{ saved: boolean; id?: number }> {
    return new Promise(resolve => {
      const abort = () => { this.pendingNote = undefined; this.show(".margin-note-review", false); resolve({ saved: false }); };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      this.pendingNote = { title, content, sources, resolve: value => { signal.removeEventListener("abort", abort); resolve(value); } };
      setMarkup(this.el(".margin-note-review"), `<div class="margin-review-label">${icon('note')}${L('笔记草稿')}</div><strong>${escapeHTML(title)}</strong><details><summary>${L('预览内容')}</summary><div class="margin-prose">${renderMarkdown(content, sources)}</div></details><div class="margin-review-actions"><button type="button" class="margin-secondary" data-action="dismiss-note">${L('暂不保存')}</button><button type="button" class="margin-primary" data-action="confirm-note">${L('保存到文献')}</button></div>`);
      this.show(".margin-note-review", true);
    });
  }
  private async saveNote(title: string, content: string, sources: Source[]): Promise<{ id: number }> {
    if (!this.bridge || !this.context) throw new Error(t("请先打开文献。"));
    return this.bridge.createNote(title, renderNote(content, sources, this.context.attachmentKey, this.context.groupID));
  }
  private click(event: Event): void {
    const target = (event.target as Element).closest<HTMLElement>("button, a");
    if (!target || !this.root.contains(target)) return;
    if (target.tagName.toLowerCase() === "a") { event.preventDefault(); const href = target.getAttribute("href") || ""; if (/^https?:\/\//.test(href)) this.host.openURL(href); return; }
    if (target.dataset.prompt) { if (!this.controller) { this.el<HTMLTextAreaElement>("textarea").value = target.dataset.prompt; this.session.draft = target.dataset.prompt; this.el("textarea").focus(); this.deferSave(); } return; }
    if (target.dataset.source) {
      const message = this.message(target);
      const source = (message?.sources || this.pendingNote?.sources || []).find(s => s.id === target.dataset.source);
      if (source) void this.bridge?.navigate(source).catch(e => this.error(e));
      return;
    }
    void this.action(target.dataset.action || "", target).catch(e => this.error(e));
  }
  private message(target: HTMLElement): DisplayMessage | undefined { return this.session.messages.find(m => m.id === target.closest<HTMLElement>("[data-message]")?.dataset.message); }
  private async action(action: string, target: HTMLElement): Promise<void> {
    if (action === 'continue') { const message=this.message(target); if(message) await this.send(undefined,message.id); return; }
    if (action === 'fetch-models') {
      if (this.discoveryController) { this.discoveryController.abort(); return; }
      const baseURL = this.el<HTMLInputElement>('[name="baseURL"]').value.trim();
      const apiKey = this.el<HTMLInputElement>('[name="apiKey"]').value.trim();
      const controller = new AbortController(); this.discoveryController = controller;
      target.textContent = t("取消获取");
      const feedback = this.el('.margin-model-feedback'); feedback.textContent = t("正在获取模型…");
      try {
        const ids = await listModels(baseURL, apiKey, controller.signal);
        if (this.discoveryController !== controller || this.view !== 'settings') return;
        this.availableModels = [...new Set([...this.settingsIDs, ...ids])].sort(); this.renderModelList();
        feedback.textContent = ids.length ? t('获取到 {count} 个模型，请勾选需要的模型。',{count:ids.length}) : t("服务返回空列表，请手动添加模型 ID。");
      } catch (e) { if (this.discoveryController === controller) feedback.textContent = e instanceof Error ? e.message : String(e); }
      finally { if (this.discoveryController === controller) { this.discoveryController = undefined; target.textContent = t("获取模型"); } }
      return;
    }
    if (action === 'add-model') {
      const input = this.el<HTMLInputElement>('[name="manualModel"]'), id = input.value.trim();
      if (!id) { this.el('.margin-model-feedback').textContent = t("请输入模型 ID"); return; }
      this.settingsIDs.add(id); this.availableModels = [...new Set([...this.availableModels, id])].sort();
      if (!this.settingsDefault) this.settingsDefault = id;
      input.value = ''; this.el<HTMLInputElement>('[name="modelSearch"]').value = ''; this.renderModelList();
      this.el('.margin-model-feedback').textContent = t("已添加，保存配置后生效"); return;
    }
    if (action === "settings") { this.openSettings(); return; }
    if (action === "back") { this.connectionController?.abort(); this.setView("chat"); return; }
    if (action === "selection") { this.includeSelection = false; this.updateContext(); return; }
    if (action === "copy") { const message = this.message(target); if (message) { this.host.copy(message.content.replace(/\[\[([^\]]+)\]\]/g, (_, id) => { const source = message.sources.find(s => s.id === id); return source ? `[${t('第 {page} 页',{page:source.pageLabel})}]` : t("[出处未验证]"); })); this.status(t("已复制回答")); } return; }
    if (action === "save-answer") { const message = this.message(target); if (message) { (target as HTMLButtonElement).disabled = true; try { await this.saveNote(t("阅读笔记 · ") + this.context?.title.slice(0, 80), message.content, message.sources); this.status(t("已保存到文献笔记")); } finally { (target as HTMLButtonElement).disabled = false; } } return; }
    if (action === "confirm-note" && this.pendingNote) {
      const pending = this.pendingNote; (target as HTMLButtonElement).disabled = true;
      try { const result = await this.saveNote(pending.title, pending.content, pending.sources); pending.resolve({ saved: true, id: result.id }); this.pendingNote = undefined; this.show(".margin-note-review", false); }
      finally { (target as HTMLButtonElement).disabled = false; }
      return;
    }
    if (action === "dismiss-note") { this.pendingNote?.resolve({ saved: false }); this.pendingNote = undefined; this.show(".margin-note-review", false); return; }
    if (action === "new") {
      if (this.controller || this.preparing) { this.error(new Error(t("请先停止当前回答，再开始新对话。"))); return; }
      if (this.session.messages.length) (this.session.archives ??= []).unshift({ createdAt: new Date().toISOString(), messages: this.session.messages, modelID: this.session.modelID });
      this.session.modelID = this.config.defaultModelID; this.updateModel();
      this.session.messages = []; this.session.draft = ""; this.el<HTMLTextAreaElement>("textarea").value = "";
      this.includeSelection = true; this.el(".margin-status").textContent = ""; this.clearError(); this.setView("chat"); this.renderMessages(); this.updateContext(); await this.persist(); return;
    }
    if (action === "history") { this.openHistory(); return; }
    if (action === "restore") {
      if (this.controller || this.preparing) throw new Error(t("请先停止当前回答。"));
      const index = Number(target.dataset.index), archive = this.session.archives?.[index];
      if (!archive) return;
      this.session.archives!.splice(index, 1);
      if (this.session.messages.length) this.session.archives!.unshift({ createdAt: new Date().toISOString(), messages: this.session.messages, modelID: this.session.modelID });
      this.session.modelID = archive.modelID; this.updateModel();
      this.session.messages = archive.messages; this.setView("chat"); this.renderMessages(); await this.persist(); return;
    }
    if (action === "save-settings" || action === "test-settings") {
      const config = this.readSettings(); endpoint(config.baseURL); if (!config.modelIDs.length) throw new Error(t("请至少选择或添加一个模型。"));
      const feedback = this.el(".margin-settings-feedback"); feedback.textContent = "";
      (target as HTMLButtonElement).disabled = true;
      try {
        if (action === "save-settings") { await this.host.store.saveConfig(config); this.config = config; const removed = this.updateModel(); this.setView("chat"); this.status(removed ? t("模型配置已保存 · 原模型已移除，已切换到默认模型") : t("模型配置已保存")); }
        else { this.connectionController?.abort(); this.connectionController = new AbortController(); feedback.textContent = t("正在检查连接与工具调用…"); await testConnection(config, this.connectionController.signal); feedback.textContent = t("连接成功，工具调用可用。"); }
      } catch (error) { feedback.textContent = error instanceof Error ? error.message : String(error); }
      finally { (target as HTMLButtonElement).disabled = false; }
    }
  }
  private setView(view: "chat" | "settings" | "history"): void {
    if (view !== 'settings') { this.discoveryController?.abort(); this.discoveryController = undefined; this.connectionController?.abort(); }
    this.view = view; this.show(".margin-chat", view === "chat"); this.show(".margin-settings", view === "settings"); this.show(".margin-history", view === "history");
  }
  private openSettings(): void {
    this.discoveryController?.abort(); this.discoveryController = undefined; this.connectionController?.abort();
    this.settingsIDs = new Set(this.config.modelIDs); this.settingsDefault = this.config.defaultModelID;
    this.availableModels = [...this.settingsIDs].sort();
    this.setView('settings');
    setMarkup(this.el('.margin-settings'), `<div class="margin-section-heading">${button('back', '返回对话', 'back')}<span>${L('模型设置')}</span></div>
      <label>Language / 语言<select name="language" aria-label="Language / 语言"><option value="auto" data-i18n="跟随 Zotero">${t('跟随 Zotero')}</option><option value="zh-CN">简体中文</option><option value="en-US">English</option></select></label>
      <label>Base URL<input name="baseURL" type="url" placeholder="https://api.example.com/v1" autocomplete="off" value="${escapeHTML(this.config.baseURL)}"/></label>
      <label>API Key<input name="apiKey" type="password" data-i18n-placeholder="本机服务可留空" placeholder="${t('本机服务可留空')}" autocomplete="off" value="${escapeHTML(this.config.apiKey)}"/></label>
      <div class="margin-model-heading"><strong>${L('可用模型')}</strong><button type="button" class="margin-secondary" data-action="fetch-models">${L('获取模型')}</button></div>
      <input name="modelSearch" data-i18n-aria-label="搜索模型" aria-label="${t('搜索模型')}" data-i18n-placeholder="搜索模型 ID…" placeholder="${t('搜索模型 ID…')}"/>
      <div class="margin-model-list" data-i18n-aria-label="选择可用模型" aria-label="${t('选择可用模型')}"></div>
      <div class="margin-manual-model"><input name="manualModel" data-i18n-aria-label="手动模型 ID" aria-label="${t('手动模型 ID')}" data-i18n-placeholder="手动输入模型 ID" placeholder="${t('手动输入模型 ID')}"/><button type="button" class="margin-secondary" data-action="add-model">${L('添加')}</button></div>
      <p class="margin-model-feedback" role="status"></p>
      <label>${L('默认模型')}<select name="defaultModel" data-i18n-aria-label="默认模型" aria-label="${t('默认模型')}"></select></label>
      <p class="margin-settings-intro">${L('新对话使用默认模型。列表中的模型不一定支持工具调用，可测试默认模型的连接。')}</p>
      <div class="margin-settings-actions"><button type="button" class="margin-secondary" data-action="test-settings">${L('测试连接')}</button><button type="button" class="margin-primary" data-action="save-settings">${L('保存配置')}</button></div>
      <p class="margin-settings-feedback" role="status"></p>
      <div class="margin-privacy"><p>${L('使用兼容 OpenAI Chat Completions 的服务。提问时会发送相关原文和对话；获取模型列表不发送文献。')}</p><p>${L('密钥保存在 Zotero 凭据库。设置只在点击保存后生效。')}</p></div>`);
    this.el<HTMLSelectElement>('[name="language"]').value=getLanguage();
    this.el('[name="modelSearch"]').addEventListener('input', () => this.renderModelList());
    for (const name of ['baseURL','apiKey']) this.el(`[name="${name}"]`).addEventListener('input', () => { this.discoveryController?.abort(); this.discoveryController = undefined; this.el('[data-action="fetch-models"]').textContent = t("获取模型"); this.el('.margin-model-feedback').textContent = ''; this.availableModels = [...this.settingsIDs]; this.renderModelList(); });
    this.el('[name="manualModel"]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void this.action('add-model', this.el('[data-action="add-model"]')); } });
    this.renderModelList();
  }
  private renderModelList(): void {
    const query = this.el<HTMLInputElement>('[name="modelSearch"]').value.toLowerCase().trim();
    const ids = this.availableModels.filter(id => id.toLowerCase().includes(query));
    setMarkup(this.el('.margin-model-list'), ids.length ? ids.map(id => `<label class="margin-model-option"><input type="checkbox" data-model-id="${escapeHTML(id)}" ${this.settingsIDs.has(id) ? 'checked="checked"' : ''}/><span title="${escapeHTML(id)}">${escapeHTML(id)}</span></label>`).join('') : `<p>${query ? t("没有匹配的模型") : t("获取模型列表，或在下方手动添加")}</p>`);
    const select = this.el<HTMLSelectElement>('[name="defaultModel"]');
    setMarkup(select, this.settingsIDs.size ? [...this.settingsIDs].map(id => `<option value="${escapeHTML(id)}">${escapeHTML(id)}</option>`).join('') : `<option value="">${t('请先选择模型')}</option>`);
    select.value = this.settingsDefault; select.disabled = !this.settingsIDs.size;
  }
  private readSettings(): ModelConfig {
    return normalizeConfig({ baseURL:this.el<HTMLInputElement>('[name="baseURL"]').value.trim(), apiKey:this.el<HTMLInputElement>('[name="apiKey"]').value.trim(), model:this.settingsDefault, defaultModelID:this.settingsDefault, modelIDs:[...this.settingsIDs] });
  }
  private openHistory(): void {
    this.setView("history");
    const items = this.session.archives?.map((archive, index) => {
      const title = archive.messages.find(message => message.role === 'user')?.content || t('阅读对话');
      const date = new Date(archive.createdAt);
      const formattedDate = date.toLocaleString(getLocale());
      return `<button type="button" class="margin-history-item" data-action="restore" data-index="${index}" title="${escapeHTML(title)}"><strong class="margin-history-title">${escapeHTML(title)}</strong><span class="margin-history-meta"><time datetime="${escapeHTML(archive.createdAt)}">${escapeHTML(formattedDate)}</time><span>${L(archive.messages.length===1?'1 条消息':'{count} 条消息',{count:archive.messages.length})}</span></span></button>`;
    }).join('');
    setMarkup(this.el('.margin-history'), `<div class="margin-section-heading">${button('back','返回对话','back')}<span>${L('这篇文献的对话')}</span></div><p class="margin-settings-intro">${L('每次新对话，都会留在这里。')}</p><div class="margin-history-list">${items || `<div class="margin-history-empty">${L('还没有历史对话')}</div>`} </div>`);
  }
  focusInput(): void { this.setView("chat"); this.host.focusPane?.(); this.el("textarea").focus(); }
  dispose(): void { this.unsubscribeLanguage(); this.stop(); this.connectionController?.abort(); this.discoveryController?.abort(); this.selection.dispose(); clearTimeout(this.renderTimer); clearTimeout(this.saveTimer); void this.persist().catch(() => {}); this.disposed = true; this.root.remove(); }
}
function uid(): string { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
