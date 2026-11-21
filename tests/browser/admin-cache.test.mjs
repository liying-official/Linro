import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { admin, environment } from '../harness.mjs';
import { chromium, until } from './chromium-cdp.mjs';
import { listenOnLoopback } from '../loopback-port.mjs';

test('repeat navigation reuses the private Admin bundle and fetches the new bundle when the HTML changes', {timeout:60000}, async t => {
  const hits = new Map();
  const env = environment({ ASSETS: { async fetch(req) {
    const path = new URL(req.url).pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path.endsWith('.js')) return new Response("document.documentElement.dataset.ready = 'yes'", {headers:{'content-type':'text/javascript'}});
    if (path.endsWith('.css')) return new Response('body{color:#123}', {headers:{'content-type':'text/css'}});
    const hash = path === '/updated' ? 'Other123' : 'First123';
    return new Response(`<!doctype html><link rel="icon" href="data:,"><link rel="stylesheet" href="/assets/app-${hash}.css"><script defer src="/assets/app-${hash}.js"></script><h1>${hash}</h1>`,{headers:{'content-type':'text/html'}});
  } } });
  t.after(()=>env.DB.close());
  const server = http.createServer(async (req,res)=>{
    const result = await admin.fetch(new Request(env.ADMIN_ORIGIN+req.url),env);
    res.writeHead(result.status,Object.fromEntries(result.headers));
    res.end(Buffer.from(await result.arrayBuffer()));
  });
  await listenOnLoopback(server);
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  env.ADMIN_ORIGIN='http://127.0.0.1:'+server.address().port;
  const browser=await chromium();t.after(()=>browser.close());
  const page=await browser.page([env.ADMIN_ORIGIN]);
  for(const path of ['/first','/second','/updated']){
    await page.navigate(env.ADMIN_ORIGIN+path);
    await until(()=>page.evaluate(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete' && document.documentElement.dataset.ready === 'yes'`),'Admin test page did not load');
  }
  for (const hash of ['First123','Other123']) for(const ext of ['js','css']) assert.equal(hits.get('/assets/app-'+hash+'.'+ext),1);
  assert.deepEqual(page.blocked,[]);
});
