import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..');
await mkdir(path.join(root,'build/preview'), {recursive:true});
await build({entryPoints:[path.join(root,'preview/main.ts')],bundle:true,format:'iife',outfile:path.join(root,'build/preview/preview.js'),target:'es2022'});
const server = http.createServer(async(req,res)=>{
  if(req.url.startsWith('/v1/')) {
    const proxy = http.request({hostname:'127.0.0.1',port:18765,path:req.url,method:req.method,headers:req.headers}, response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    proxy.on('error',()=>{res.writeHead(502);res.end('Start node scripts/mock-provider.mjs for the interactive preview.');});
    req.pipe(proxy);return;
  }
  const url = new URL(req.url,'http://localhost');
  const files = {'/':'preview/index.html','/preview.js':'build/preview/preview.js','/styles.css':'addon/styles.css'};
  const relative = files[url.pathname] || (url.pathname.startsWith('/katex/') ? 'node_modules/katex/dist/'+url.pathname.slice(7) : null);
  if(!relative){res.writeHead(404);res.end();return;}
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try { const data=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream'});res.end(data); }
  catch{res.writeHead(404);res.end();}
});
server.listen(18766,'127.0.0.1',()=>console.log('Margin preview: http://127.0.0.1:18766'));
