import { zhCN } from './locales/zh-CN';
import { enUS } from './locales/en-US';
export type LanguagePreference = 'auto' | 'zh-CN' | 'en-US';
export type Locale = 'zh-CN' | 'en-US';
export type MessageKey = keyof typeof zhCN;
export type MessageArgs = Record<string, string | number>;
export function languagePreference(value: unknown): LanguagePreference { return value === 'zh-CN' || value === 'en-US' ? value : 'auto'; }
export function resolveLocale(preference: LanguagePreference, hostLocale: string): Locale { return preference === 'auto' ? (/^zh(?:-|$)/i.test(hostLocale) ? 'zh-CN' : 'en-US') : preference; }
let preference: LanguagePreference = 'auto';
let hostLocale = 'en-US';
const listeners = new Set<() => void>();
const known = new Map<string, { key: MessageKey; args: MessageArgs }>();
export function getLocale(): Locale { return resolveLocale(preference, hostLocale); }
export function getLanguage(): LanguagePreference { return preference; }
export function setLanguage(value: LanguagePreference, host = hostLocale): void {
  const before = getLocale(), old = preference;
  preference = languagePreference(value); hostLocale = host;
  if (before !== getLocale() || old !== preference) for (const listener of listeners) listener();
}
export function onLanguageChange(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
function format(key: MessageKey, args: MessageArgs, locale: Locale): string {
  const catalog = locale === 'zh-CN' ? zhCN : enUS;
  return (catalog[key] || enUS[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(args[name] ?? `{${name}}`));
}
export function t(key: MessageKey, args: MessageArgs = {}): string {
  // Only plugin-generated status/error text is looked up here; document content is never translated.
  for (const locale of ['zh-CN','en-US'] as const) known.set(format(key,args,locale), { key, args });
  while (known.size > 1000) known.delete(known.keys().next().value!);
  return format(key,args,getLocale());
}
export function translateKnown(value: string): string { const message = known.get(value); return message ? t(message.key,message.args) : value; }
function escape(value: string): string { return value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!)); }
/** Explicit bindings update chrome text without touching answer nodes or form values. */
export function L(key: MessageKey, args: MessageArgs = {}): string { return `<span data-i18n="${escape(key)}" data-i18n-args="${escape(JSON.stringify(args))}">${escape(t(key,args))}</span>`; }
export function refreshTranslations(root: HTMLElement): void {
  root.lang = getLocale();
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const value=t(element.dataset.i18n as MessageKey,JSON.parse(element.dataset.i18nArgs || '{}'));
    if (element.textContent !== value) element.textContent=value;
  }
  for (const attr of ['title','aria-label','placeholder','data-prompt']) for (const element of root.querySelectorAll<HTMLElement>(`[data-i18n-${attr}]`)) {
    element.setAttribute(attr,t(element.getAttribute(`data-i18n-${attr}`) as MessageKey));
  }
}
