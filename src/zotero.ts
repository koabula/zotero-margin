import { t, languagePreference, type LanguagePreference } from "./i18n";
import { checkAbort, emptySession, type AnnotationText, type Config, type PageText, type ReaderBridge, type ReaderContext, type Session, type Source, type Store } from "./types";
import { escapeHTML } from "./markdown";
import { normalizeConfig } from './models';
declare const Zotero: any, Services: any, Components: any, IOUtils: any, PathUtils: any;

const selectionCache = new WeakMap<object, { text: string; pageIndex: number; at: number }>();
export function rememberSelection(reader: any, annotation: any): void {
  if (annotation?.text) selectionCache.set(reader, { text: annotation.text, pageIndex: annotation.position?.pageIndex || 0, at: Date.now() });
}

/** The only layer that touches Zotero internals. No path/code/network tool is exposed. */
export class ZoteroReaderBridge implements ReaderBridge {
  private cache = new Map<number, PageText>();
  private pdf: any;
  constructor(readonly reader: any, private active: () => boolean) {}
  assertActive(): void {
    if (!this.active() || this.reader._isUninitialized) throw new Error(t("当前文献已切换或关闭，请返回原文献后操作。"));
  }
  private async application(): Promise<any> {
    if (this.reader._isUninitialized) throw new Error(t("文献已关闭，请重新打开。"));
    await this.reader._initPromise;
    const view = this.reader._internalReader?._primaryView;
    await view?.initializedPromise;
    await view?._pageLabelsPromise;
    const app = view?._iframeWindow?.PDFViewerApplication;
    if (!app?.pdfDocument) throw new Error(t("请在 Zotero 内打开一份 PDF。当前版本支持具有文字层的 PDF。"));
    if (this.pdf !== app.pdfDocument) { this.pdf = app.pdfDocument; this.cache.clear(); }
    return app;
  }
  async context(): Promise<ReaderContext> {
    const app = await this.application();
    const item = Zotero.Items.get(this.reader.itemID);
    if (!item || !item.isPDFAttachment()) throw new Error(t("当前附件不是 PDF。"));
    const parent = item.parentID ? Zotero.Items.get(item.parentID) : item;
    const internal = this.reader._internalReader;
    const primary = internal._lastViewPrimary !== false;
    const view = primary ? internal._primaryView : internal._secondaryView;
    const viewState = internal._state[primary ? "primaryViewState" : "secondaryViewState"];
    const pageIndex = viewState?.pageIndex ?? app.pdfViewer.currentPageNumber - 1;
    const popup = internal._state[primary ? "primaryViewSelectionPopup" : "secondaryViewSelectionPopup"]?.annotation;
    let selection = popup?.text || "";
    let selectionPageIndex = popup?.position?.pageIndex;
    if (!selection && view?._selectionRanges?.length && !view._selectionRanges[0].collapsed) {
      selection = view._selectionRanges.map((r: any) => r.text || "").join(" ");
      selectionPageIndex = view._selectionRanges[0].position?.pageIndex ?? pageIndex;
    }
    if (!selection) selection = view?._iframeWindow?.getSelection()?.toString() || "";
    const cached = selectionCache.get(this.reader);
    if (!selection && cached && Date.now() - cached.at < 120000 && cached.pageIndex === pageIndex) { selection = cached.text; selectionPageIndex = cached.pageIndex; }
    const creators = parent.getCreators?.() || [];
    const library = Zotero.Libraries.get(item.libraryID);
    return {
      attachmentID: item.id, libraryID: item.libraryID, attachmentKey: item.key,
      ...(library.libraryType === "group" ? { groupID: Zotero.Groups.getGroupIDFromLibraryID(item.libraryID) } : {}),
      title: parent.getField("title") || item.getField("title") || t("未命名文献"),
      authors: creators.slice(0, 3).map((c: any) => c.lastName || c.name || "").join("、") + (creators.length > 3 ? t(" 等") : ""),
      pageIndex, pageLabel: internal._state.pageLabels?.[pageIndex] || String(pageIndex + 1),
      pageCount: app.pdfDocument.numPages, selection: selection.slice(0, 10000), selectionPageIndex,
    };
  }
  async readPage(pageIndex: number, signal?: AbortSignal): Promise<PageText> {
    checkAbort(signal);
    const app = await this.application();
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= app.pdfDocument.numPages) throw new Error(t("页面超出文献范围。"));
    const cached = this.cache.get(pageIndex);
    if (cached) return cached;
    let text: string;
    if (typeof app.pdfDocument.getPageData === "function") {
      const request = Components.utils.cloneInto({ pageIndex }, this.reader._internalReader._primaryView._iframeWindow);
      const data = await app.pdfDocument.getPageData(request);
      text = (data.chars || []).map((c: any) => (c.u || "") + (c.paragraphBreakAfter ? "\n\n" : c.lineBreakAfter ? "\n" : c.spaceAfter ? " " : "")).join("").trim();
    } else {
      const page = await app.pdfDocument.getPage(pageIndex + 1);
      const content = await page.getTextContent();
      text = content.items.filter((i: any) => typeof i.str === "string").map((i: any) => i.str + (i.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+\n/g, "\n").trim();
    }
    checkAbort(signal);
    const result = { pageIndex, pageLabel: this.reader._internalReader._state.pageLabels?.[pageIndex] || String(pageIndex + 1), text };
    this.cache.set(pageIndex, result);
    if (this.cache.size > 120) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
  async annotations(): Promise<AnnotationText[]> {
    const item = Zotero.Items.get(this.reader.itemID);
    if (!item) throw new Error(t("文献已不存在。"));
    return item.getAnnotations().filter((a: any) => !a.deleted).map((a: any) => {
      let position: any = {};
      try { position = JSON.parse(a.annotationPosition || "{}"); } catch { /* Older malformed annotations have no usable position. */ }
      return { id: a.key, pageIndex: position.pageIndex ?? 0, pageLabel: a.annotationPageLabel || String((position.pageIndex ?? 0) + 1), text: a.annotationText || "", comment: a.annotationComment || "" };
    });
  }
  async navigate(source: Source): Promise<void> {
    this.assertActive();
    const app = await this.application();
    if (source.pageIndex < 0 || source.pageIndex >= app.pdfDocument.numPages) throw new Error(t("引用页码已失效。"));
    this.assertActive();
    await this.reader.navigate({ pageIndex: source.pageIndex, ...(source.annotationID ? { annotationID: source.annotationID } : {}) });
  }
  async createNote(title: string, html: string): Promise<{ id: number }> {
    this.assertActive();
    const attachment = Zotero.Items.get(this.reader.itemID);
    const library = Zotero.Libraries.get(attachment.libraryID);
    if (!library.editable) throw new Error(t("此文献库为只读，无法保存笔记。"));
    const note = new Zotero.Item("note");
    note.libraryID = attachment.libraryID;
    if (attachment.parentID) note.parentID = attachment.parentID;
    note.setNote(`<div data-schema-version="9"><h1>${escapeHTML(title)}</h1>${html}<p><em>${t('由 Margin 辅助整理 · 请结合原文核对')}</em></p></div>`);
    const id = await note.saveTx();
    return { id };
  }
}

const pref = "extensions.margin.";
const credentialOrigin = "chrome://margin";
export class ZoteroStore implements Store {
  async getLanguage(): Promise<LanguagePreference> { return languagePreference(Zotero.Prefs.get(pref + 'language', true)); }
  async saveLanguage(language: LanguagePreference): Promise<void> { Zotero.Prefs.set(pref + 'language', languagePreference(language), true); }
  private writes = new Map<string, Promise<void>>();
  private root = PathUtils.join(Services.dirsvc.get("ProfD", Components.interfaces.nsIFile).path, "margin", "sessions");
  async getConfig(): Promise<Config> {
    const baseURL = Zotero.Prefs.get(pref + "baseURL", true) || "";
    const model = Zotero.Prefs.get(pref + "model", true) || "";
    let apiKey = "";
    if (baseURL) {
      const logins = await Services.logins.findLogins(credentialOrigin, null, baseURL);
      apiKey = logins[0]?.password || "";
    }
    let modelIDs: string[] | undefined;
    try { modelIDs = JSON.parse(Zotero.Prefs.get(pref + 'modelIDs', true) || 'null') || undefined; } catch { /* Migrate legacy configuration. */ }
    return normalizeConfig({ baseURL, model, apiKey, modelIDs, defaultModelID: Zotero.Prefs.get(pref + 'defaultModelID', true) || undefined });
  }
  async saveConfig(config: Config): Promise<void> {
    config = normalizeConfig(config);
    const baseURL = config.baseURL.trim();
    const logins = await Services.logins.findLogins(credentialOrigin, null, baseURL);
    if (config.apiKey) {
      const LoginInfo = Components.Constructor("@mozilla.org/login-manager/loginInfo;1", "nsILoginInfo", "init");
      const login = new LoginInfo(credentialOrigin, null, baseURL, "api", config.apiKey, "", "");
      if (logins.length) await Services.logins.modifyLogin(logins[0], login);
      else await Services.logins.addLoginAsync(login);
    } else for (const login of logins) await Services.logins.removeLogin(login);
    Zotero.Prefs.set(pref + "baseURL", baseURL, true);
    Zotero.Prefs.set(pref + "model", config.model.trim(), true);
    Zotero.Prefs.set(pref + 'modelIDs', JSON.stringify(config.modelIDs), true);
    Zotero.Prefs.set(pref + 'defaultModelID', config.defaultModelID, true);
  }
  private path(key: string): string {
    if (!/^\d+-[A-Z0-9]+$/.test(key)) throw new Error(t("会话标识无效。"));
    return PathUtils.join(this.root, key + ".json");
  }
  async loadSession(key: string): Promise<Session> {
    await this.writes.get(key);
    const path = this.path(key);
    if (!(await IOUtils.exists(path))) return emptySession();
    let data: any;
    try { data = await IOUtils.readJSON(path); } catch { throw new Error(t("本地会话暂时无法读取，原文件已保留。请重试。")); }
    if (data.version !== 1 || !Array.isArray(data.messages) || typeof data.draft !== "string" || data.messages.some((m: any) => !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || !Array.isArray(m.sources))) throw new Error(t("会话文件格式不正确，原文件已保留。"));
    return data;
  }
  saveSession(key: string, session: Session): Promise<void> {
    const path = this.path(key);
    const snapshot = JSON.parse(JSON.stringify(session));
    const pending = (this.writes.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
      await IOUtils.makeDirectory(this.root, { ignoreExisting: true, createAncestors: true });
      await IOUtils.writeJSON(path, snapshot, { tmpPath: path + ".tmp" });
    });
    this.writes.set(key, pending);
    return pending;
  }
}
