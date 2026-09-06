import { t, setLanguage, onLanguageChange } from "./i18n";
import { Sidebar } from "./ui";
import { ZoteroReaderBridge, ZoteroStore, rememberSelection } from "./zotero";
declare const Zotero: any;
let pluginID = "", rootURI = "", paneID = "", observer: any, timer: ReturnType<typeof setInterval> | undefined;
const panels = new Map<HTMLElement, Sidebar>();
const bridges = new WeakMap<object, ZoteroReaderBridge>();
const windows = new Set<any>();
const navigationListeners = new Map<any, (event: MouseEvent) => void>();
let store: ZoteroStore;
let unsubscribeLanguage: (() => void) | undefined;

export async function startup(options: { id: string; rootURI: string }): Promise<void> {
  pluginID = options.id; rootURI = options.rootURI; store = new ZoteroStore();
  setLanguage(await store.getLanguage(), Zotero.locale || 'en-US');
  unsubscribeLanguage = onLanguageChange(updateNativeLanguage);
  for (const win of Zotero.getMainWindows()) windowLoad(win);
  paneID = Zotero.ItemPaneManager.registerSection({
    paneID: "margin", pluginID,
    header: { l10nID: "margin-pane-title", icon: rootURI + "icons/margin.svg" },
    sidenav: { l10nID: "margin-pane-tooltip", icon: rootURI + "icons/margin.svg" },
    onInit({ body, doc }: any) { setup(body, doc); },
    onDestroy({ body }: any) { body.closest('item-details')?.removeAttribute('data-margin-active'); panels.get(body)?.dispose(); panels.delete(body); },
    onItemChange({ tabType, setEnabled }: any) { setEnabled(tabType === "reader"); },
    onRender({ body, doc }: any) { setup(body, doc); void update(body); },
  });
  Zotero.Reader.registerEventListener("renderTextSelectionPopup", onSelection, pluginID);
  observer = Zotero.Notifier.registerObserver({ notify(action: string, type: string) {
    if (type === "tab" && ["select", "close", "load"].includes(action)) {
      for (const [body, panel] of panels) {
        const tabID = (body.closest("item-details") as any)?.tabID;
        const win = body.ownerDocument.defaultView as any;
        if (tabID && win.Zotero_Tabs?.selectedID !== tabID) { panel.stop(); body.closest('item-details')?.removeAttribute('data-margin-active'); }
        else { void update(body); void panel.refreshConfig(); }
      }
    }
  } }, ["tab"], "margin");
  timer = setInterval(() => {
    for (const [body, panel] of panels) if (body.isConnected && body.getBoundingClientRect().height > 0) void panel.refreshContext();
  }, 1200);
}
function setup(body: HTMLElement, doc: Document): void {
  if (panels.has(body)) return;
  windowLoad(doc.defaultView);
  body.style.padding = "0";
  body.dataset.marginBody = 'true';
  body.closest('item-pane-custom-section')?.classList.add('margin-native-section');
  const panel = new Sidebar(body, {
    store,
    copy: text => Zotero.Utilities.Internal.copyTextToClipboard(text),
    openURL: url => Zotero.launchURL(url),
    focusPane: () => activate(body),
  });
  panels.set(body, panel);
  setTimeout(updateNativeLanguage, 0);
}
function updateNativeLanguage(): void {
  for (const win of windows) for (const node of win.document.querySelectorAll('item-pane-sidenav [data-pane]')) {
    if (node.dataset.pane !== paneID) continue;
    node.removeAttribute('data-l10n-id'); node.setAttribute('title',t('AI 阅读助手')); node.setAttribute('tooltiptext',t('AI 阅读助手')); node.setAttribute('aria-label',t('AI 阅读助手'));
    for (const label of node.querySelectorAll('[data-l10n-id]')) { label.removeAttribute('data-l10n-id'); label.setAttribute('title',t('AI 阅读助手')); label.setAttribute('aria-label',t('AI 阅读助手')); }
  }
}
function activate(body: HTMLElement): void {
  const details = body.closest('item-details') as any;
  if (!details) return;
  const pane = body.closest('context-pane') as any;
  if (pane) pane.mode = 'item';
  details.setAttribute('data-margin-active', 'true');
  details.querySelector('.zotero-view-item')?.scrollTo(0, 0);
  void update(body);
}
async function update(body: HTMLElement): Promise<void> {
  const panel = panels.get(body);
  if (!panel || !body.isConnected) return;
  const win = body.ownerDocument.defaultView as any;
  const tabID = (body.closest("item-details") as any)?.tabID || win.Zotero_Tabs?.selectedID;
  const reader = tabID ? Zotero.Reader.getByTabID(tabID) : undefined;
  if (!reader) { await panel.attach(null); return; }
  let bridge = bridges.get(reader);
  if (!bridge) { bridge = new ZoteroReaderBridge(reader, () => win.Zotero_Tabs?.selectedID === tabID); bridges.set(reader, bridge); }
  await panel.attach(bridge);
}
function onSelection(event: any): void {
  const { reader, doc, params, append } = event;
  rememberSelection(reader, params.annotation);
  const button = doc.createElement("button");
  button.textContent = t("问问 Margin");
  button.style.cssText = "color:var(--fill-primary,#262626);padding:5px 9px;border:0;border-radius:5px;background:var(--material-button,transparent);cursor:pointer;font-size:12px;";
  button.addEventListener("click", async () => {
    await reader.setContextPaneOpen(true);
    for (const [body, panel] of panels) {
      if ((body.closest("item-details") as any)?.tabID === reader.tabID || (body.closest("item-details") as any)?.tabID === reader._tabID) {
        await update(body); panel.focusInput();
      }
    }
  });
  append(button);
}
export function windowLoad(win: any): void {
  if (!win?.document || windows.has(win)) return;
  windows.add(win);
  const navigation = (event: MouseEvent) => {
    const target = (event.target as Element).closest?.('[data-pane]') as HTMLElement | null;
    const sidenav = target?.closest('item-pane-sidenav') as any;
    if (!sidenav || event.button !== 0) return;
    const details = sidenav.container;
    if (target!.dataset.pane !== paneID) { details?.removeAttribute('data-margin-active'); return; }
    const body = [...panels.keys()].find(body => body.closest('item-details') === details);
    if (!body) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const reader = Zotero.Reader.getByTabID(details.tabID);
    if (reader) void reader.setContextPaneOpen(true);
    activate(body); panels.get(body)?.focusInput();
  };
  win.document.addEventListener('click', navigation, true);
  navigationListeners.set(win, navigation);
  win.MozXULElement?.insertFTLIfNeeded("margin.ftl");
  for (const file of ["styles.css", "katex/katex.min.css"]) {
    const link = win.document.createElementNS("http://www.w3.org/1999/xhtml", "link");
    link.rel = "stylesheet"; link.href = rootURI + file; link.dataset.marginStyle = "true";
    win.document.documentElement.append(link);
  }
}
export function windowUnload(win: any): void {
  win.document.removeEventListener('click', navigationListeners.get(win), true); navigationListeners.delete(win);
  for (const [body, panel] of panels) if (body.ownerDocument.defaultView === win) { body.closest('item-details')?.removeAttribute('data-margin-active'); panel.dispose(); panels.delete(body); }
  windows.delete(win);
}
export function shutdown(): void {
  unsubscribeLanguage?.(); unsubscribeLanguage = undefined;
  clearInterval(timer);
  for (const win of windows) { win.document.removeEventListener('click', navigationListeners.get(win), true); for (const node of win.document.querySelectorAll('[data-margin-active]')) node.removeAttribute('data-margin-active'); }
  navigationListeners.clear();
  for (const panel of panels.values()) panel.dispose();
  panels.clear();
  if (observer) Zotero.Notifier.unregisterObserver(observer);
  Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", onSelection);
  if (paneID) Zotero.ItemPaneManager.unregisterSection(paneID);
  for (const win of windows) for (const node of win.document.querySelectorAll('[data-margin-style="true"],link[href="margin.ftl"]')) node.remove();
  windows.clear();
}

// Exported for isolated-profile integration tests; this object is never exposed to the LLM.
export { ZoteroReaderBridge, ZoteroStore };
