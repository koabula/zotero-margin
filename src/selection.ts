/** Keep copy shortcuts inside the assistant; never capture PDF or input selections. */
export class TextSelection {
  private dragging = false;
  private menu: HTMLButtonElement;
  private doc: Document;
  constructor(private root: HTMLElement, private copy: (text: string) => void, private changed: () => void) {
    this.doc = root.ownerDocument;
    this.menu = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
    this.menu.type = 'button'; this.menu.className = 'margin-copy-menu'; this.menu.hidden = true;
    this.menu.textContent = '复制所选文字';
    this.menu.addEventListener('mousedown', e => e.preventDefault());
    this.menu.addEventListener('click', () => { const text = this.text(); if (text) this.copy(text); this.menu.hidden = true; });
    root.append(this.menu);
    this.doc.addEventListener('keydown', this.keydown, true);
    this.doc.addEventListener('copy', this.onCopy, true);
    this.doc.addEventListener('selectionchange', this.onChange);
    this.doc.addEventListener('pointerdown', this.down, true);
    this.doc.addEventListener('pointerup', this.up, true);
    root.addEventListener('contextmenu', this.contextMenu);
  }
  text(): string {
    if (this.doc.activeElement?.matches('input,textarea')) return '';
    const selection = this.doc.getSelection();
    if (!selection || selection.isCollapsed || !this.root.contains(selection.anchorNode) || !this.root.contains(selection.focusNode)) return '';
    const parent = selection.anchorNode?.nodeType === 1 ? selection.anchorNode as Element : selection.anchorNode?.parentElement;
    return parent?.closest('.margin-prose,.margin-user') ? selection.toString() : '';
  }
  blocks(element?: Element): boolean {
    if (this.dragging) return true;
    if (!this.text()) return false;
    return !element || this.doc.getSelection()!.getRangeAt(0).intersectsNode(element);
  }
  private onChange = () => this.changed();
  private down = (e: PointerEvent) => {
    if (!this.menu.contains(e.target as Node)) this.menu.hidden = true;
    this.dragging = e.button === 0 && !!(e.target as Element).closest?.('.margin-prose,.margin-user') && this.root.contains(e.target as Node);
  };
  private up = () => { this.dragging = false; this.changed(); };
  private keydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.menu.hidden = true;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c') {
      const text = this.text();
      if (text) { e.preventDefault(); e.stopImmediatePropagation(); this.copy(text); }
    }
  };
  private onCopy = (e: ClipboardEvent) => {
    const text = this.text();
    if (text) { e.preventDefault(); e.stopImmediatePropagation(); if (e.clipboardData) e.clipboardData.setData('text/plain', text); else this.copy(text); }
  };
  private contextMenu = (e: MouseEvent) => {
    if (!this.text()) return;
    e.preventDefault(); e.stopPropagation();
    this.menu.hidden = false;
    this.menu.style.left = `${Math.max(0, Math.min(e.clientX, this.doc.defaultView!.innerWidth - 155))}px`;
    this.menu.style.top = `${Math.max(0, Math.min(e.clientY, this.doc.defaultView!.innerHeight - 40))}px`;
  };
  dispose(): void {
    this.doc.removeEventListener('keydown', this.keydown, true);
    this.doc.removeEventListener('copy', this.onCopy, true);
    this.doc.removeEventListener('selectionchange', this.onChange);
    this.doc.removeEventListener('pointerdown', this.down, true);
    this.doc.removeEventListener('pointerup', this.up, true);
    this.root.removeEventListener('contextmenu', this.contextMenu); this.menu.remove();
  }
}
