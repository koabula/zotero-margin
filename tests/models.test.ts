import test from 'node:test';
import assert from 'node:assert/strict';
import { listModels } from '../src/provider';
import { normalizeConfig } from '../src/models';

test('legacy model migrates and invalid defaults resolve to an enabled model', () => {
  assert.deepEqual(normalizeConfig({baseURL:'https://host/v1',apiKey:'key',model:'old'}),{baseURL:'https://host/v1',apiKey:'key',model:'old',modelIDs:['old'],defaultModelID:'old'});
  const config=normalizeConfig({baseURL:'',apiKey:'',model:'removed',modelIDs:['a','b','a'],defaultModelID:'removed'});
  assert.deepEqual(config.modelIDs,['a','b']);assert.equal(config.defaultModelID,'a');
});

test('model discovery preserves prefix, sends only auth, and deduplicates IDs', async () => {
  let request: RequestInit | undefined;
  const result=await listModels('https://host/custom/v1/chat/completions','secret',new AbortController().signal,(async(url,init)=>{
    assert.equal(url,'https://host/custom/v1/models'); request=init;
    return Response.json({data:[{id:'b'},{id:'a'},{id:'b'},{id:null},{id:'  '}]});
  }) as typeof fetch);
  assert.deepEqual(result,['a','b']);assert.equal(request!.method,'GET');assert.equal(request!.body,undefined);
  assert.equal(request!.redirect,'error');assert.equal(request!.credentials,'omit');
  assert.deepEqual(request!.headers,{Authorization:'Bearer secret'});
});

test('model discovery handles empty, unauthorized, unsupported and malformed responses', async () => {
  const run=(response:Response)=>listModels('http://localhost/v1/','',new AbortController().signal,(async()=>response) as typeof fetch);
  assert.deepEqual(await run(Response.json({data:[]})),[]);
  await assert.rejects(run(new Response('secret must not echo',{status:401})),/认证失败/);
  await assert.rejects(run(new Response('',{status:404})),/手动添加/);
  await assert.rejects(run(Response.json({models:[]})),/格式无法识别/);
  await assert.rejects(run(new Response('not json')),/格式无法识别/);
});

test('model discovery supports cancellation and timeout', async () => {
  const fetcher=(async(_url,init)=>new Promise<Response>((resolve,reject)=>{
    if(init!.signal!.aborted)reject(new Error('aborted'));
    else init!.signal!.addEventListener('abort',()=>reject(new Error('aborted')));
  })) as typeof fetch;
  const control=new AbortController(); const pending=listModels('http://localhost/v1','',control.signal,fetcher);
  control.abort();await assert.rejects(pending,/已取消/);
  await assert.rejects(listModels('http://localhost/v1','',new AbortController().signal,fetcher,10),/超时/);
});
