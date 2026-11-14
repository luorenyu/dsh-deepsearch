import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {catalog,search} from './fixtures.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export async function startDemo({depsDir,port=0}={}) {
  if(!depsDir) throw new Error('Pass depsDir pointing to an isolated React 18 installation');
  const requests=[];
  const files=new Map([
    ['/',[path.join(here,'index.html'),'text/html']],
    ['/client.js',[path.resolve(here,'../../client.js'),'text/javascript']],
    ['/demo/host.js',[path.join(here,'host.js'),'text/javascript']],
    ['/vendor/react.js',[path.join(depsDir,'node_modules/react/umd/react.production.min.js'),'text/javascript']],
    ['/vendor/react-dom.js',[path.join(depsDir,'node_modules/react-dom/umd/react-dom.production.min.js'),'text/javascript']],
  ]);
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/api/deepsearch/catalog' && req.method==='GET') {
        requests.push({path:url.pathname});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(catalog()));return;
      }
      if(url.pathname==='/api/deepsearch/search' && req.method==='POST') {
        let raw='';for await(const chunk of req) {raw+=chunk;if(raw.length>8192)throw new Error('Demo request too large');}
        const body=JSON.parse(raw);requests.push({path:url.pathname,body});
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(search(body)));return;
      }
      const file=files.get(url.pathname);
      if(file && req.method==='GET') {res.setHeader('Content-Type',file[1]+';charset=utf-8');res.end(await readFile(file[0]));return;}
      res.writeHead(404);res.end('Not in isolated demo allowlist');
    } catch(error) {res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:'http://127.0.0.1:'+server.address().port,requests,close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const demo=await startDemo({depsDir:process.env.DEEPSEARCH_DEMO_DEPS,port:Number(process.env.PORT||0)});
  console.log('Isolated demo: '+demo.url);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await demo.close();process.exit(0);});
}
