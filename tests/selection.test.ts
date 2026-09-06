import { setLanguage } from "../src/i18n";
import test from 'node:test';
test.beforeEach(() => setLanguage("zh-CN"));
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { TextSelection } from '../src/selection';

test('copy handles assistant selections and ignores outside text and input focus', () => {
  const dom=new JSDOM('<div id="outside">PDF content</div><div id="root"><article class="margin-prose"><p>中文 text</p><pre>code()</pre></article><textarea></textarea></div>');
  const doc=dom.window.document,root=doc.querySelector<HTMLElement>('#root')!;const copied:string[]=[];
  const handler=new TextSelection(root,text=>copied.push(text),()=>{});
  const selection=doc.getSelection()!;
  const select=(selector:string)=>{const range=doc.createRange();range.selectNodeContents(doc.querySelector(selector)!);selection.removeAllRanges();selection.addRange(range);};
  const copy=()=>doc.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'c',ctrlKey:true,cancelable:true,bubbles:true}));
  select('p');assert.equal(handler.blocks(root.querySelector('article')!),true);copy();assert.deepEqual(copied,['中文 text']);
  select('pre');copy();assert.equal(copied.at(-1),'code()');
  root.querySelector('pre')!.dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
  assert.equal(root.querySelector<HTMLButtonElement>('.margin-copy-menu')!.hidden,false);
  root.querySelector<HTMLButtonElement>('.margin-copy-menu')!.click();assert.equal(copied.length,3);
  root.querySelector('textarea')!.focus();copy();assert.equal(copied.length,3);
  root.querySelector('textarea')!.blur();select('#outside');copy();assert.equal(copied.length,3);
  handler.dispose();select('p');copy();assert.equal(copied.length,3,'listeners cleaned up');
});
