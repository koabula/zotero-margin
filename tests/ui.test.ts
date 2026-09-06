import { setLanguage } from "../src/i18n";
import test from "node:test";
test.beforeEach(() => setLanguage("zh-CN"));
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Sidebar } from "../src/ui";
import { emptySession, type ReaderBridge, type Session, type Store } from "../src/types";
import { normalizeConfig } from '../src/models';
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function setup() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:8888' });
  const sessions = new Map<string, Session>();
  const store: Store = { getConfig: async () => ({ baseURL: "", model: "", apiKey: "" }), saveConfig: async () => {}, loadSession: async key => sessions.get(key) || emptySession(), saveSession: async (key, value) => { sessions.set(key, structuredClone(value)); } };
  const bridge: ReaderBridge = { context: async () => ({ attachmentID: 1, libraryID: 1, attachmentKey: 'ABCDEFGH', title: 'Real Paper', authors: 'Author', pageIndex: 1, pageLabel: '21', pageCount: 3, selection: 'Selected passage' }), readPage: async i => ({pageIndex:i,pageLabel:String(i),text:'text'}), annotations: async () => [], navigate: async () => {}, createNote: async () => ({id:1}), assertActive: () => {} };
  const sidebar = new Sidebar(dom.window.document.querySelector('#root') as HTMLElement, { store, copy: () => {}, openURL: () => {} });
  return { dom, sidebar, bridge, store, sessions };
}
test("sidebar follows document context, lets users exclude selection, and opens settings without sending", async () => {
  const { sidebar, bridge } = setup(); await sidebar.attach(bridge);
  assert.ok(sidebar.root.textContent?.includes('Real Paper'));
  assert.ok(sidebar.root.textContent?.includes('PDF 2/3'));
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="selection"]')!.click();
  assert.equal(sidebar.root.querySelector<HTMLElement>('.margin-selection')!.hidden, true);
  await sidebar.send('Explain');
  assert.equal(sidebar.root.querySelector<HTMLElement>('.margin-settings')!.hidden, false);
  assert.equal(sidebar.root.querySelectorAll('.margin-user').length, 0);
  sidebar.dispose();
});
test("new conversations archive and restore the document's history", async () => {
  const { sidebar, bridge, sessions } = setup();
  sessions.set('1-ABCDEFGH', { version: 1, draft: '', messages: [{ id:'a',role:'user',content:'An earlier question',sources:[] }] });
  await sidebar.attach(bridge);
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="new"]')!.click(); await tick();
  assert.equal(sessions.get('1-ABCDEFGH')!.archives!.length, 1);
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="history"]')!.click();
  assert.ok(sidebar.root.querySelector('.margin-history')!.textContent?.includes('An earlier question'));
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="restore"]')!.click(); await tick();
  assert.ok(sidebar.root.querySelector('.margin-user')!.textContent?.includes('An earlier question'));
  sidebar.dispose();
});
test("closing a reader disables the composer", async () => {
  const { sidebar, bridge } = setup(); await sidebar.attach(bridge); await sidebar.attach(null);
  assert.equal(sidebar.root.querySelector('textarea')!.disabled, true); sidebar.dispose();
});

test("a late reader load or context refresh cannot reopen a closed document", async () => {
  const { sidebar, bridge } = setup();
  const context = await bridge.context();
  let resolve!: (value: typeof context) => void;
  bridge.context = () => new Promise(done => { resolve = done; });
  const opening = sidebar.attach(bridge);
  await sidebar.attach(null); resolve(context); await opening;
  assert.equal(sidebar.root.querySelector('textarea')!.disabled, true);
  bridge.context = async () => context;
  await sidebar.attach(bridge);
  bridge.context = () => new Promise(done => { resolve = done; });
  const refreshing = sidebar.refreshContext();
  await sidebar.attach(null); resolve(context); await refreshing;
  assert.equal(sidebar.root.querySelector('textarea')!.disabled, true);
  sidebar.dispose();
});

test("closing during credential loading prevents a pending question from being sent", async () => {
  const { sidebar, bridge, store } = setup();
  await sidebar.attach(bridge);
  let resolve!: (value: Awaited<ReturnType<Store['getConfig']>>) => void;
  store.getConfig = () => new Promise(done => { resolve = done; });
  const sending = sidebar.send('解释原文');
  await sidebar.attach(null);
  resolve({baseURL:'http://localhost:18765/v1',model:'test',apiKey:''});
  await sending;
  assert.equal(sidebar.root.querySelectorAll('.margin-user').length, 0);
  assert.equal(sidebar.root.querySelector('textarea')!.disabled, true);
  sidebar.dispose();
});

test("a complete answer renders progress, formulas and source buttons in the XHTML host", async () => {
  const { sidebar, bridge, store } = setup();
  store.getConfig = async () => ({ baseURL:'http://localhost:18765/v1', model:'test', apiKey:'' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices:[{ message:{ content:'原文解释 [[p2]]。公式 $x^2 + y^2$。', role:'assistant' }, finish_reason:'stop' }] }), { headers:{'Content-Type':'application/json'} });
  try {
    await sidebar.attach(bridge);
    await sidebar.send('解释本页');
    assert.equal(sidebar.root.querySelector<HTMLElement>('.margin-error')!.hidden, true);
    assert.ok(sidebar.root.querySelector('.margin-status')!.textContent?.includes('回答完成'));
    assert.equal(sidebar.root.querySelectorAll('.margin-citation').length, 1);
    assert.ok(sidebar.root.querySelector('.katex'));
    assert.equal(sidebar.root.querySelector('.margin-send')!.getAttribute('aria-label'), '发送问题');
  } finally { globalThis.fetch = originalFetch; sidebar.dispose(); }
});

test('models can be manually added, filtered, defaulted and saved without fetching', async () => {
  const {sidebar,bridge,store,dom}=setup();
  let saved=normalizeConfig({baseURL:'http://localhost/v1',apiKey:'',model:'a'});
  store.getConfig=async()=>saved; store.saveConfig=async config=>{saved=normalizeConfig(config);};
  await sidebar.attach(bridge);await sidebar.refreshConfig();
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();
  const manual=sidebar.root.querySelector<HTMLInputElement>('[name="manualModel"]')!;manual.value='b';
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="add-model"]')!.click();
  const search=sidebar.root.querySelector<HTMLInputElement>('[name="modelSearch"]')!;search.value='b';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(sidebar.root.querySelectorAll('[data-model-id]').length,1);
  const defaultModel=sidebar.root.querySelector<HTMLSelectElement>('[name="defaultModel"]')!;defaultModel.value='b';defaultModel.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="save-settings"]')!.click();await tick();
  assert.deepEqual(saved.modelIDs,['a','b']);assert.equal(saved.defaultModelID,'b');
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="new"]')!.click();await tick();
  assert.equal(sidebar.root.querySelector<HTMLSelectElement>('.margin-model')!.value,'b');sidebar.dispose();
});

test('chat model is frozen during tools, switch preserves context, and archives restore the model', async () => {
  const {sidebar,bridge,store,dom}=setup();
  store.getConfig=async()=>normalizeConfig({baseURL:'http://localhost/v1',apiKey:'',model:'a',modelIDs:['a','b']});
  await sidebar.attach(bridge);await sidebar.refreshConfig();
  const select=sidebar.root.querySelector<HTMLSelectElement>('.margin-model')!;
  const originalFetch=globalThis.fetch;const bodies:any[]=[];
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(init!.body as string);bodies.push(body);
    if(bodies.length===1){
      assert.equal(select.disabled,true);select.value='b';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
      return Response.json({choices:[{message:{content:null,tool_calls:[{id:'c',type:'function',function:{name:'get_reader_context',arguments:'{}'}}]},finish_reason:'tool_calls'}]});
    }
    return Response.json({choices:[{message:{content:'回答 [[p2]]'},finish_reason:'stop'}]});
  };
  try {
    await sidebar.send('first');assert.deepEqual(bodies.map(b=>b.model),['a','a']);
    const old=sidebar.root.querySelector('.margin-assistant');
    select.value='b';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await sidebar.send('second');
    assert.equal(bodies[2].model,'b');assert.ok(JSON.stringify(bodies[2].messages).includes('first'));
    assert.equal(sidebar.root.querySelector('.margin-assistant'),old,'previous messages retain DOM');
    sidebar.root.querySelector<HTMLButtonElement>('[data-action="new"]')!.click();await tick();assert.equal(select.value,'a');
    sidebar.root.querySelector<HTMLButtonElement>('[data-action="history"]')!.click();sidebar.root.querySelector<HTMLButtonElement>('[data-action="restore"]')!.click();await tick();assert.equal(select.value,'b');
  } finally {globalThis.fetch=originalFetch;sidebar.dispose();}
});

test('removing the conversation model falls back once and a failed refresh preserves chosen IDs', async () => {
  const {sidebar,bridge,store,dom}=setup();
  let config=normalizeConfig({baseURL:'http://localhost/v1',apiKey:'',model:'a',modelIDs:['a','b']});
  store.getConfig=async()=>config;await sidebar.attach(bridge);await sidebar.refreshConfig();
  const select=sidebar.root.querySelector<HTMLSelectElement>('.margin-model')!;
  select.value='b';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  config=normalizeConfig({...config,modelIDs:['a']});await sidebar.refreshConfig();assert.equal(select.value,'a');
  const status=sidebar.root.querySelector('.margin-status')!.textContent;await sidebar.refreshConfig();assert.equal(sidebar.root.querySelector('.margin-status')!.textContent,status);
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:404});
  try {sidebar.root.querySelector<HTMLButtonElement>('[data-action="fetch-models"]')!.click();await tick();assert.equal(sidebar.root.querySelector<HTMLInputElement>('[data-model-id="a"]')!.checked,true);assert.ok(sidebar.root.querySelector('.margin-model-feedback')!.textContent?.includes('手动添加'));}
  finally {globalThis.fetch=originalFetch;sidebar.dispose();}
});

test('discovery uses unsaved credentials, preserves enabled IDs and replaces stale fetched options', async () => {
  const {sidebar,bridge,store,dom}=setup();
  store.getConfig=async()=>normalizeConfig({baseURL:'http://localhost/v1',apiKey:'old',model:'manual'});
  let saves=0;store.saveConfig=async()=>{saves++;};
  await sidebar.attach(bridge);await sidebar.refreshConfig();
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();
  sidebar.root.querySelector<HTMLInputElement>('[name="baseURL"]')!.value='https://example.com/prefix/chat/completions';
  sidebar.root.querySelector<HTMLInputElement>('[name="apiKey"]')!.value='new-key';
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://example.com/prefix/models');assert.equal((init!.headers as any).Authorization,'Bearer new-key');assert.equal(init!.body,undefined);
    return Response.json({data:(++calls===1?['a','b']:['c']).map(id=>({id}))});
  };
  try {
    const fetchButton=sidebar.root.querySelector<HTMLButtonElement>('[data-action="fetch-models"]')!;
    fetchButton.click();await tick();sidebar.root.querySelector<HTMLInputElement>('[data-model-id="a"]')!.click();
    fetchButton.click();await tick();
    assert.ok(sidebar.root.querySelector('[data-model-id="manual"]'));
    assert.equal(sidebar.root.querySelector<HTMLInputElement>('[data-model-id="a"]')!.checked,true);
    assert.equal(sidebar.root.querySelector('[data-model-id="b"]'),null);assert.ok(sidebar.root.querySelector('[data-model-id="c"]'));
    assert.equal(saves,0);
    globalThis.fetch=async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('cancelled'))));
    fetchButton.click();fetchButton.click();await tick();assert.match(sidebar.root.querySelector('.margin-model-feedback')!.textContent!,/已取消/);
    fetchButton.click();const key=sidebar.root.querySelector<HTMLInputElement>('[name="apiKey"]')!;key.value='changed';key.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await tick();
    assert.equal(fetchButton.textContent,'获取模型');assert.equal(sidebar.root.querySelector('.margin-model-feedback')!.textContent,'');
  } finally {globalThis.fetch=originalFetch;sidebar.dispose();}
});

test('reader preparation failure releases the model selector', async () => {
  const {sidebar,bridge,store}=setup();
  store.getConfig=async()=>({baseURL:'http://localhost/v1',apiKey:'',model:'a'});
  await sidebar.attach(bridge);await sidebar.refreshConfig();bridge.context=async()=>{throw new Error('reader unavailable');};
  await sidebar.send('question');assert.equal(sidebar.root.querySelector<HTMLSelectElement>('.margin-model')!.disabled,false);sidebar.dispose();
});

test('saving settings keeps the removed-model fallback visible', async () => {
  const {sidebar,bridge,store,dom}=setup();
  store.getConfig=async()=>normalizeConfig({baseURL:'http://localhost/v1',apiKey:'',model:'a',modelIDs:['a','b']});
  await sidebar.attach(bridge);await sidebar.refreshConfig();
  const select=sidebar.root.querySelector<HTMLSelectElement>('.margin-model')!;
  select.value='b';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();
  sidebar.root.querySelector<HTMLInputElement>('[data-model-id="b"]')!.click();
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="save-settings"]')!.click();await tick();
  assert.equal(select.value,'a');assert.match(sidebar.root.querySelector('.margin-status')!.textContent!,/原模型已移除/);sidebar.dispose();
});

test('language saves independently of API settings and synchronizes panels without losing form edits', async()=>{
  const first=setup(),second=setup();await first.sidebar.attach(first.bridge);await second.sidebar.attach(second.bridge);
  let language='auto',modelSaves=0;
  first.store.saveLanguage=async value=>{language=value;};first.store.saveConfig=async()=>{modelSaves++;};
  const input=first.sidebar.root.querySelector('textarea')!;input.value='unsent draft';input.dispatchEvent(new first.dom.window.Event('input',{bubbles:true}));
  first.sidebar.root.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();
  const base=first.sidebar.root.querySelector<HTMLInputElement>('[name="baseURL"]')!;base.value='https://unsaved.example/v1';
  const select=first.sidebar.root.querySelector<HTMLSelectElement>('[name="language"]')!;select.value='en-US';select.dispatchEvent(new first.dom.window.Event('change',{bubbles:true}));await tick();
  assert.equal(language,'en-US');assert.equal(modelSaves,0);assert.equal(base.value,'https://unsaved.example/v1');assert.equal(input.value,'unsent draft');
  assert.equal(first.sidebar.root.lang,'en-US');assert.equal(second.sidebar.root.lang,'en-US');
  assert.ok(first.sidebar.root.textContent?.includes('Model settings'));assert.equal(second.sidebar.root.querySelector('textarea')!.placeholder,'Ask about this document…');
  first.sidebar.root.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
  assert.ok(first.sidebar.root.querySelector<HTMLButtonElement>('[data-prompt]')!.dataset.prompt!.startsWith('Explain'));
  first.sidebar.dispose();second.sidebar.dispose();
});

test('switching language during streaming preserves selected answer DOM, draft, model and request', async()=>{
  const {sidebar,bridge,store,dom}=setup();store.getConfig=async()=>({baseURL:'http://localhost/v1',apiKey:'',model:'a'});
  await sidebar.attach(bridge);await sidebar.refreshConfig();
  const originalFetch=globalThis.fetch;let stream!:ReadableStreamDefaultController<Uint8Array>;let request:any;
  globalThis.fetch=async(_url,init)=>{request=JSON.parse(init!.body as string);return new Response(new ReadableStream({start(c){stream=c;}}),{headers:{'content-type':'text/event-stream'}});};
  const chunk=(content:string)=>stream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n'));
  try {
    const pending=sidebar.send('Explain this page in English');await tick();chunk('Selected answer.');await new Promise(r=>setTimeout(r,100));
    const answer=sidebar.root.querySelector('.margin-prose')!, text=answer.querySelector('p')!;
    const range=dom.window.document.createRange();range.selectNodeContents(text);const selection=dom.window.getSelection()!;selection.addRange(range);
    const input=sidebar.root.querySelector('textarea')!;input.value='next draft';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    setLanguage('en-US');chunk(' More content.');await new Promise(r=>setTimeout(r,100));
    assert.equal(sidebar.root.querySelector('.margin-prose'),answer);assert.equal(selection.toString(),'Selected answer.');assert.equal(input.value,'next draft');
    assert.equal(sidebar.root.querySelector<HTMLSelectElement>('.margin-model')!.disabled,true);assert.equal(request.model,'a');assert.equal('language' in request,false);
    selection.removeAllRanges();dom.window.document.dispatchEvent(new dom.window.Event('selectionchange'));
    stream.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));stream.close();await pending;
    assert.equal(sidebar.root.querySelector('.margin-prose p')!.textContent,'Selected answer. More content.');
    assert.ok(sidebar.root.querySelector('.margin-status')!.textContent?.includes('Response complete'));
  } finally {globalThis.fetch=originalFetch;sidebar.dispose();}
});


test('history keeps complete titles, escapes markup and formats dates in the current language', async () => {
  const {sidebar,bridge,sessions}=setup();
  const title='A very long question '.repeat(12)+'<img src=x onerror=alert(1)> "quoted"';
  sessions.set('1-ABCDEFGH',{version:1,draft:'keep draft',messages:[],archives:[{createdAt:'2026-12-31T23:59:59Z',messages:[{id:'old',role:'user',content:title,sources:[]}]}]});
  await sidebar.attach(bridge);setLanguage('en-US');
  sidebar.root.querySelector<HTMLButtonElement>('[data-action="history"]')!.click();
  let row=sidebar.root.querySelector<HTMLButtonElement>('.margin-history-item')!;
  assert.equal(row.title,title);assert.equal(row.querySelector('strong')!.textContent,title);
  assert.equal(row.querySelector('img'),null);assert.ok(row.textContent!.includes('1 message'));
  assert.equal(row.querySelector('time')!.textContent,new Date('2026-12-31T23:59:59Z').toLocaleString('en-US'));
  setLanguage('zh-CN');row=sidebar.root.querySelector<HTMLButtonElement>('.margin-history-item')!;
  assert.equal(row.title,title);assert.equal(row.querySelector('time')!.textContent,new Date('2026-12-31T23:59:59Z').toLocaleString('zh-CN'));
  row.click();await tick();assert.equal(sidebar.root.querySelector('.margin-user div')!.textContent,title);
  assert.equal(sidebar.root.querySelector('textarea')!.value,'keep draft');sidebar.dispose();
});


test('interrupted answers resume in place with the original model, selection, sources and draft preserved',async()=>{
  const {sidebar,bridge,store,dom,sessions}=setup();
  store.getConfig=async()=>normalizeConfig({baseURL:'http://localhost/v1',apiKey:'',model:'a',modelIDs:['a','b']});
  const originalFetch=globalThis.fetch;const payloads:any[]=[];let resumeController:ReadableStreamDefaultController<Uint8Array>;
  globalThis.fetch=async(_url,init)=>{
    const payload=JSON.parse(init!.body as string);payloads.push(payload);
    if(payloads.length===1)return Response.json({choices:[{message:{content:'**原文解释 [[p2]]。'},finish_reason:'length'}]});
    assert.equal(payload.model,'a');assert.ok(payload.messages.some((m:any)=>m.content==='**原文解释 [[p2]]。'));
    assert.ok(payload.messages.some((m:any)=>m.content?.includes('Original question') && m.content.includes('Selected passage')));
    assert.ok(!payload.tools.some((tool:any)=>['create_note','navigate'].includes(tool.function.name)));
    return new Response(new ReadableStream({start(controller){resumeController=controller;}}),{headers:{'content-type':'text/event-stream'}});
  };
  try{
    await sidebar.attach(bridge);await sidebar.send('Original question');
    const saved=sessions.get('1-ABCDEFGH')!.messages.at(-1)!;
    assert.equal(saved.failureCode,'model_length');assert.ok(sidebar.root.querySelector('[data-action="continue"]'));
    const answer=sidebar.root.querySelector('.margin-assistant')!;
    const input=sidebar.root.querySelector('textarea')!;input.value='Keep my next question';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    const select=sidebar.root.querySelector<HTMLSelectElement>('.margin-model')!;select.value='b';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    const range=dom.window.document.createRange();range.selectNodeContents(answer.querySelector('.margin-prose')!);const selection=dom.window.getSelection()!;selection.addRange(range);const selected=selection.toString();
    const continuing=sidebar.send(undefined,saved.id);await tick();
    assert.equal(select.disabled,true);
    resumeController!.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"续写完成**"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));resumeController!.close();
    await continuing;assert.equal(selection.toString(),selected);assert.equal(sidebar.root.querySelector('.margin-assistant'),answer);
    selection.removeAllRanges();dom.window.document.dispatchEvent(new dom.window.Event('selectionchange'));await new Promise(resolve=>setTimeout(resolve,110));
    assert.equal(sessions.get('1-ABCDEFGH')!.messages.length,2);const resumed=sessions.get('1-ABCDEFGH')!.messages.at(-1)!;
    assert.equal(resumed.content,'**原文解释 [[p2]]。续写完成**');assert.equal(resumed.id,saved.id);assert.equal(resumed.status,undefined);
    assert.equal(input.value,'Keep my next question');assert.equal(select.value,'b');assert.equal(resumed.modelID,'a');assert.ok(resumed.sources.some(source=>source.id==='p2'));
    assert.equal(sidebar.root.querySelector('[data-action="continue"]'),null);
  }finally{globalThis.fetch=originalFetch;sidebar.dispose();}
});

test('legacy partial answers can resume, but removed models and older turns cannot silently resume',async()=>{
  const {sidebar,bridge,store,sessions}=setup();
  let config=normalizeConfig({baseURL:'http://localhost/v1',apiKey:'',model:'b'});store.getConfig=async()=>config;
  sessions.set('1-ABCDEFGH',{version:1,draft:'legacy draft',messages:[{id:'q',role:'user',content:'Original',sources:[]},{id:'old',role:'assistant',content:'Partial ',sources:[],status:'error',modelID:'a'}]});
  const originalFetch=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;return Response.json({choices:[{message:{content:'continued'},finish_reason:'stop'}]});};
  try{
    await sidebar.attach(bridge);await sidebar.send(undefined,'old');assert.equal(requests,0);assert.match(sidebar.root.querySelector('.margin-error')!.textContent!,/重新启用/);
    assert.equal(sidebar.root.querySelector<HTMLSelectElement>('.margin-model')!.disabled,false);
    config=normalizeConfig({...config,modelIDs:['a','b']});await sidebar.send(undefined,'old');assert.equal(requests,1);assert.equal(sessions.get('1-ABCDEFGH')!.messages.at(-1)!.content,'Partial continued');
    await sidebar.send(undefined,'old');assert.equal(requests,1);
  }finally{globalThis.fetch=originalFetch;sidebar.dispose();}
});
