/** Parse known-safe XHTML explicitly: Gecko sanitizes innerHTML in privileged documents. */
export function setMarkup(element: HTMLElement, markup: string): void {
  const doc = element.ownerDocument;
  const Parser = doc.defaultView!.DOMParser;
  const parsed = new Parser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml">${markup}</div>`, "application/xhtml+xml");
  if (parsed.querySelector("parsererror")) throw new Error("界面内容格式错误。");
  element.replaceChildren(...Array.from(parsed.documentElement.childNodes, node => doc.importNode(node, true)));
}
