import MarkdownIt from "markdown-it";
import katex from "katex";
import type { Source } from "./types";

export function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
const md = new MarkdownIt({ html: false, linkify: false, breaks: true, typographer: false, xhtmlOut: true });
// Remote images never load in the privileged Zotero document.
md.renderer.rules.image = (tokens, index) => `[图像：${escapeHTML(tokens[index].content || "未加载")}]`;
md.renderer.rules.link_open = (tokens, index) => {
  const href = tokens[index].attrGet("href") || "";
  return /^https?:\/\//i.test(href) ? `<a href="${escapeHTML(href)}" rel="noreferrer noopener">` : "<span>";
};
md.renderer.rules.link_close = (tokens, index) => {
  let level = 1;
  for (let i = index - 1; i >= 0; i--) {
    if (tokens[i].type === "link_close") level++;
    if (tokens[i].type === "link_open" && --level === 0) return /^https?:\/\//i.test(tokens[i].attrGet("href") || "") ? "</a>" : "</span>";
  }
  return "</a>";
};
md.inline.ruler.before("text", "margin_citation", (state, silent) => {
  const match = /^\[\[([a-zA-Z0-9_-]+)\]\]/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) { const token = state.push("margin_citation", "", 0); token.content = match[1]; }
  state.pos += match[0].length;
  return true;
});
md.renderer.rules.margin_citation = (tokens, index, _options, env) => {
  const id = tokens[index].content;
  const source = (env.sources as Source[]).find(s => s.id === id);
  if (!source) return `<span class="margin-unverified" title="未找到对应原文">[出处未验证]</span>`;
  return env.note
    ? `<a href="${escapeHTML(env.noteLink(source))}">[第 ${escapeHTML(source.pageLabel)} 页]</a>`
    : `<button type="button" class="margin-citation" data-source="${escapeHTML(id)}" title="PDF 第 ${source.pageIndex + 1} 页">${escapeHTML(source.pageLabel)} ↗</button>`;
};
md.inline.ruler.before("escape", "margin_math", (state, silent) => {
  const start = state.pos;
  const rest = state.src.slice(start);
  const opener = rest.startsWith("\\(") ? "\\(" : rest.startsWith("\\[") ? "\\[" : rest.startsWith("$$") ? "$$" : rest.startsWith("$") ? "$" : "";
  if (!opener) return false;
  const closer = opener === "\\(" ? "\\)" : opener === "\\[" ? "\\]" : opener;
  const end = state.src.indexOf(closer, start + opener.length);
  if (end < 0 || end === start + opener.length) return false;
  if (opener === "$" && (/\s/.test(state.src[start + 1]) || /\s/.test(state.src[end - 1]))) return false;
  if (!silent) {
    const token = state.push("margin_math", "", 0);
    token.content = state.src.slice(start + opener.length, end);
    token.meta = { display: opener === "$$" || opener === "\\[" };
  }
  state.pos = end + closer.length;
  return true;
});
md.renderer.rules.margin_math = (tokens, index) => {
  try { return katex.renderToString(tokens[index].content, { displayMode: tokens[index].meta.display, throwOnError: false, trust: false, strict: "ignore", maxExpand: 500, output: "htmlAndMathml" }); }
  catch { return `<code>${escapeHTML(tokens[index].content)}</code>`; }
};
export function renderMarkdown(text: string, sources: Source[] = []): string { return md.render(text, { sources }); }
export function renderNote(text: string, sources: Source[], attachmentKey: string, groupID?: number): string {
  const prefix = groupID ? `groups/${groupID}` : "library";
  return md.render(text, { sources, note: true, noteLink: (s: Source) => `zotero://open-pdf/${prefix}/items/${attachmentKey}?page=${s.pageIndex + 1}${s.annotationID ? `&annotation=${encodeURIComponent(s.annotationID)}` : ""}` });
}
