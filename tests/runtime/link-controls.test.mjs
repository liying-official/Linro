import { newTestSecret, testPassword } from '../fixture-credentials.mjs';
import {startLocalRuntime} from '../loopback-port.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMigrations } from './migrations.mjs';
import { fileURLToPath } from 'node:url';
import { loadRuntimeToolchain } from '../../scripts/runtime-toolchain.mjs';
import { createOutboundRouter } from './outbound-router.mjs';
import { deniedOrigins } from '../unlock-cases.mjs';
import { collectLatency, radarToken, radarURL, radarBody, vpnCF } from '../vpn-fixture.mjs';
const { Miniflare, convertV4MiniflareOptions, build } = loadRuntimeToolchain();
const compiled = await build({entryPoints:[fileURLToPath(new URL('./link-controls-worker.ts', import.meta.url))], bundle:true, format:'esm', platform:'browser', target:'es2022', write:false});
const password=testPassword;
const domain='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222';
async function fixture(t, cached=false, browser=false, measure=false, radarReply) {
  const router=createOutboundRouter();
  router.expect({url:radarURL,headers:{authorization:'Bearer '+radarToken}}, radarReply ?? {status:200,body:JSON.stringify(radarBody()),headers:{'content-type':'application/json'}}, {optional:true,persist:!!radarReply});
  const mf=await startLocalRuntime(port => new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port,cf:false,outboundService:router.outboundService,modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-15',
    d1Databases:{DB:'link-control-test'},...(cached?{kvNamespaces:{REDIRECT_CACHE:'link-control-cache'}}:{}),bindings:{
      BROWSER_TIMEZONE_ENABLED:String(browser),MEASURE_KV:String(measure),BROWSER_CHECK_SECRET:newTestSecret(),RADAR_API_TOKEN:radarToken,ENVIRONMENT:'production',ADMIN_ORIGIN:'https://admin.example.com',LINK_PASSWORD_SECRET:newTestSecret(),
      QUERY_FORWARD_ALLOWLIST:'["utm_source"]',PRIVATE_TARGET_ALLOWLIST:'[]',EXPIRED_LINK_STATUS:'404',REDIRECT_CACHE_TTL:'300',ANALYTICS_ENABLED:String(browser),
    }})));
  t.after(async()=>{try {await mf.dispose();} finally {router.assertComplete();}}); const db=await mf.getD1Database('DB');
  await applyMigrations(db);
  await db.prepare('INSERT INTO domains(id,hostname,created_at,updated_at) VALUES(?,?,0,0)').bind(domain,'go.example.com').run();
  return {mf,db,radarReads:()=>router.calls.filter(call=>call.url===radarURL).length};
}
async function seed(db, {hash=null,cap=null,geo='[]'}={}) {
  await db.prepare('INSERT INTO links(id,domain_id,slug,target_url,created_at,updated_at,password_hash,max_redirects,geo_rules) VALUES(?,?,?,?,0,0,?,?,?)').bind(id,domain,'docs','https://example.org/docs',hash,cap,geo).run();
}
async function verifier(mf) {
  const r=await mf.dispatchFetch('https://go.example.com/__test__/password',{redirect:'manual',method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});assert.equal(r.status,200);return r.json();
}

test('workerd KV budget: browser checks bypass native KV and do not backfill', async t=>{
  const {mf,db}=await fixture(t,true,true,true);await seed(db);
  for(let i=0;i<8;i++){
    const response=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual'});
    assert.equal(response.status,200);assert.match(await response.text(),/__Linro_browser/);
  }
  const metrics=await mf.dispatchFetch('https://go.example.com/__test__/kv-metrics',{redirect:'manual'});
  assert.deepEqual(await metrics.json(),{get:0,put:0,delete:0});
});

test('workerd KV budget: a plain link fills once and a new quota policy bypasses stale native KV', async t=>{
  const {mf,db}=await fixture(t,true,false,true);await seed(db);
  await db.prepare('UPDATE links SET kv_cache_ttl=3600 WHERE id=?').bind(id).run();
  for(let i=0;i<8;i++){
    const response=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual'});
    assert.equal(response.status,301);assert.equal(response.headers.get('location'),'https://example.org/docs');
    await response.arrayBuffer();
  }
  const before=await (await mf.dispatchFetch('https://go.example.com/__test__/kv-metrics',{redirect:'manual'})).json();
  assert.equal(before.get,2);assert.equal(before.put,1);assert.equal(before.delete,0);
  await db.prepare('UPDATE links SET max_redirects=1 WHERE id=?').bind(id).run();
  assert.equal((await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual'})).status,301);
  assert.equal((await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual'})).status,403);
  const after=await (await mf.dispatchFetch('https://go.example.com/__test__/kv-metrics',{redirect:'manual'})).json();
  assert.deepEqual(after,before);
});

test('workerd measures direct, cold, remote-hit, isolate-hit and negative routes using real D1 metadata', {timeout:90000}, async t=>{
  const samples=24;
  for(const cached of [false,true]) {
    const {mf,db}=await fixture(t,cached,false,true);
    await db.batch(Array.from({length:samples},(_,i)=>db.prepare(
      'INSERT INTO links(id,domain_id,slug,target_url,kv_cache_ttl,created_at,updated_at) VALUES(?,?,?,?,3600,0,0)'
    ).bind(crypto.randomUUID(),domain,'route-'+i,'https://example.org/r/'+i)));
    const metrics=async()=> (await mf.dispatchFetch('https://go.example.com/__test__/route-metrics',{redirect:'manual'})).json();
    async function measure(label,prefix,status,expectedCalls,expectedGets,expectedPuts) {
      const before=await metrics(), times=[];
      for(let i=0;i<samples;i++){
        const start=performance.now();
        const response=await mf.dispatchFetch('https://go.example.com/'+prefix+i,{redirect:'manual'});
        assert.equal(response.status,status); await response.arrayBuffer(); times.push(performance.now()-start);
      }
      const after=await metrics(), result={};
      for(const field of Object.keys(before)) result[field]=(after[field]-before[field])/samples;
      assert.equal(result.calls,expectedCalls); assert.equal(result.get,expectedGets); assert.equal(result.put,expectedPuts);
      assert.equal(result.rowsWritten,0);
      times.sort((a,b)=>a-b);
      t.diagnostic(JSON.stringify({scenario:label,samples,...result,p50ms:+times[Math.ceil(samples*.5)-1].toFixed(2),p95ms:+times[Math.ceil(samples*.95)-1].toFixed(2)}));
    }
    if (cached) {
      await measure('cold KV','route-',301,2,1,1);
      await measure('remote KV hit','route-',301,2,1,0);
      await measure('isolate KV hit','route-',301,1,0,0);
      await measure('negative with KV','missing-',404,1,0,0);
    } else {
      await measure('D1 only','route-',301,1,0,0);
      await measure('negative without KV','missing-',404,1,0,0);
    }
  }
});

test('workerd coalesces independent Radar invocations and recovers after a 429 Retry-After', {timeout:60000}, async t=>{
  let failures=true;
  const radar=async()=>{
    await new Promise(resolve=>setTimeout(resolve,125));
    return failures ? {status:429,headers:{'Retry-After':'1'}} :
      {status:200,body:JSON.stringify(radarBody()),headers:{'content-type':'application/json'}};
  };
  const {mf,db,radarReads}=await fixture(t,false,false,false,radar);
  await seed(db);await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
  const visit=async()=>{
    const r=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',cf:vpnCF,headers:{'cf-connecting-ip':'203.0.113.31'}});
    await r.arrayBuffer();return r.status;
  };
  assert.deepEqual(await Promise.all(Array.from({length:25},visit)),Array(25).fill(403));
  assert.equal(radarReads(),1);
  failures=false;
  assert.equal(await visit(),403);assert.equal(radarReads(),1);
  await new Promise(resolve=>setTimeout(resolve,1050));
  assert.deepEqual(await Promise.all(Array.from({length:25},visit)),Array(25).fill(200));
  assert.equal(radarReads(),2);
});

test('workerd resolves brand and former admin-only slugs while keeping live system routes', async t => {
  const {mf,db}=await fixture(t);
  for (const value of ['Linro','linro','LINRO','admin','api','assets','robots','favicon']) {
    await db.prepare('INSERT INTO links(id,domain_id,slug,target_url,redirect_code,created_at,updated_at) VALUES(?,?,?,?,302,0,0)').bind(crypto.randomUUID(),domain,value,'https://example.org/'+value).run();
    for (const method of ['GET','HEAD']) {
      const response=await mf.dispatchFetch('https://go.example.com/'+value,{method,redirect:'manual'});
      assert.equal(response.status,302,value);assert.equal(response.headers.get('location'),'https://example.org/'+value);
    }
  }
  assert.equal((await mf.dispatchFetch('https://go.example.com/health',{redirect:'manual'})).status,200);
  assert.equal((await mf.dispatchFetch('https://go.example.com/robots.txt',{redirect:'manual'})).status,200);
  assert.equal((await mf.dispatchFetch('https://go.example.com/__Linro_assets/browser.js',{redirect:'manual'})).status,200);
  assert.equal((await mf.dispatchFetch('https://go.example.com/cdn-cgi',{redirect:'manual'})).status,404);
});
test('workerd executes peppered PBKDF2 at configured cost and verifies only the right password', {timeout:60000},async t=>{
  const {mf}=await fixture(t); const r=await verifier(mf); assert.equal(r.valid,true);assert.equal(r.invalid,false);assert.match(r.hash,/^v1\$pbkdf2-sha256\$100000\$/);
});
for(const cached of [false,true]) test(`workerd native D1 ${cached?'plus KV':'only'} atomically allows exactly 4 of 30 requests`,{timeout:60000},async t=>{
  const {mf,db}=await fixture(t,cached);await seed(db,{cap:4});
  const res=await Promise.all(Array.from({length:30},()=>mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual'})));
  assert.equal(res.filter(r=>r.status===301).length,4);assert.equal(res.filter(r=>r.status===403).length,26);
  const row=await db.prepare('SELECT redirect_count,rule_revision FROM links WHERE id=?').bind(id).first();assert.equal(row.redirect_count,4);assert.equal(row.rule_revision,1);
});
test('workerd uses Cloudflare cf country before continent and falls back without it', {timeout:60000},async t=>{
  const {mf,db}=await fixture(t,true);await seed(db,{geo:JSON.stringify([{kind:'continent',code:'AS',target_url:'https://asia.example.org/'},{kind:'country',code:'JP',target_url:'https://japan.example.org/'}])});
  const r=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',cf:{country:'JP',continent:'AS'}});assert.equal(r.status,301);assert.equal(r.headers.get('location'),'https://japan.example.org/');assert.match(r.headers.get('cache-control'),/no-store/);
  const fallback=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',cf:{country:'XX',continent:''}});assert.equal(fallback.headers.get('location'),'https://example.org/docs');
});
test('workerd native password form, signed secure cookie and D1 revision revocation round-trip', {timeout:60000},async t=>{
  const {mf,db}=await fixture(t,true);const v=await verifier(mf);await seed(db,{hash:v.hash,cap:2});
  const initial=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual'});assert.equal(initial.status,200);assert.equal(initial.headers.get('location'),null);
  const unlock=await mf.dispatchFetch('https://go.example.com/__Linro_unlock/docs',{redirect:'manual',method:'POST',headers:{origin:'https://go.example.com','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password}).toString()});
  assert.equal(unlock.status,303);assert.equal(unlock.headers.get('location'),'/docs');assert.match(unlock.headers.get('set-cookie'),/__Host-.*HttpOnly.*Secure/);
  const post=(value,origin='https://go.example.com')=>mf.dispatchFetch('https://go.example.com/__Linro_unlock/docs?utm_source=fixture',{redirect:'manual',method:'POST',headers:{origin,'sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({password:value}).toString()});
  for(const [value,origin,status] of [['wrong-workerd-test-password','https://go.example.com',401],[password,'https://foreign.example',403]]) {
    const denied=await post(value,origin);assert.equal(denied.status,status);assert.equal(denied.headers.get('set-cookie'),null);assert.equal(denied.headers.get('location'),null);
  }
  const modern=await post(password);assert.equal(modern.status,200);assert.equal(modern.headers.get('location'),null);assert.deepEqual(await modern.json(),{ok:true,data:{next:'/docs?utm_source=fixture'}});
  assert.match(modern.headers.get('set-cookie'),/__Host-.*HttpOnly.*Secure/);assert.match(modern.headers.get('content-security-policy'),/form-action 'self'/);
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,0);
  const cookie=unlock.headers.get('set-cookie').split(';')[0];const first=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',headers:{cookie}});assert.equal(first.status,301);
  await db.prepare('UPDATE links SET title=? WHERE id=?').bind('Invalidate unlock',id).run();
  const locked=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',headers:{cookie}});assert.equal(locked.status,200);assert.equal(locked.headers.get('location'),null);
  const modernLocked=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',headers:{cookie:modern.headers.get('set-cookie').split(';')[0]}});assert.equal(modernLocked.status,200);assert.equal(modernLocked.headers.get('location'),null);
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,1);
});

test('workerd accepts Chromium-shaped Origin:null + same-origin form POST without relaxing Referrer-Policy', {timeout:60000}, async t=>{
  const {mf,db}=await fixture(t,true);const v=await verifier(mf);await seed(db,{hash:v.hash,cap:2});
  const page=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual'});
  assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'no-referrer');
  assert.doesNotMatch(await page.text(),/https:\/\/example\.org\/docs/);
  const unlocked=await mf.dispatchFetch('https://go.example.com/__Linro_unlock/docs',{redirect:'manual',method:'POST',headers:{origin:'null','sec-fetch-site':'same-origin','sec-fetch-mode':'navigate','sec-fetch-dest':'document','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password}).toString()});
  assert.equal(unlocked.status,303);assert.equal(unlocked.headers.get('location'),'/docs');assert.match(unlocked.headers.get('set-cookie'),/__Host-.*HttpOnly.*Secure/);
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,0);
  const cookie=unlocked.headers.get('set-cookie').split(';')[0];
  const target=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',headers:{cookie}});
  assert.equal(target.status,301);assert.equal(target.headers.get('location'),'https://example.org/docs');
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,1);
});
test('workerd rejects cross-site, absent evidence and contradictory foreign Origin without cookie or quota', {timeout:60000}, async t=>{
  const {mf,db}=await fixture(t,true);const v=await verifier(mf);await seed(db,{hash:v.hash,cap:2});
  // Native-expressible policy cases only; empty headers have a dedicated
  // transport canary and remain in the Node-only policy matrix.
  for (const [name,headers] of deniedOrigins) {
    const r=await mf.dispatchFetch('https://go.example.com/__Linro_unlock/docs',{redirect:'manual',method:'POST',headers:{...headers,'accept-language':'en','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password}).toString()});
    assert.equal(r.status,403,name);assert.equal(r.headers.get('location'),null,name);assert.equal(r.headers.get('set-cookie'),null,name);
    assert.equal(await r.text(),'Please submit the form from the short link password page.',name);
  }
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,0);
});
test('workerd browser-shaped POST still requires correct password and the bounded form format', {timeout:60000}, async t=>{
  const {mf,db}=await fixture(t);const v=await verifier(mf);await seed(db,{hash:v.hash,cap:2});
  for(const [body,contentType,status] of [['password=wrong-password-at-least-12','application/x-www-form-urlencoded',401],[JSON.stringify({password}),'application/json',415]]) {
    const r=await mf.dispatchFetch('https://go.example.com/__Linro_unlock/docs',{redirect:'manual',method:'POST',headers:{origin:'null','sec-fetch-site':'same-origin','content-type':contentType},body});
    assert.equal(r.status,status);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('location'),null);
  }
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,0);
});
test('workerd GET and HEAD on unlock endpoints give uniform 405 Allow:POST without revealing targets', {timeout:60000}, async t=>{
  const {mf}=await fixture(t);
  for(const method of ['GET','HEAD']) {
    const r=await mf.dispatchFetch('https://go.example.com/__Linro_unlock/does-not-exist',{redirect:'manual',method});
    assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'POST');assert.equal(r.headers.get('location'),null);
    if(method==='HEAD') assert.equal(await r.text(),'');
  }
});

for (const cached of [false, true]) test(`workerd serves protected plain text 200 and atomically limits responses; KV=${cached}`, {timeout:60000}, async t=>{
  const {mf,db}=await fixture(t,cached);const v=await verifier(mf);await seed(db,{hash:v.hash,cap:3});
  const body='<script>literal</script>\n正文';await db.prepare("UPDATE links SET response_mode='text',text_content=?,target_url='about:blank' WHERE id=?").bind(body,id).run();
  const prompt=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual'});assert.equal(prompt.status,200);assert.ok(!(await prompt.text()).includes('literal'));
  const login=await mf.dispatchFetch('https://go.example.com/__Linro_unlock/docs',{redirect:'manual',method:'POST',headers:{origin:'null','sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password}).toString()});assert.equal(login.status,303);
  const cookie=login.headers.get('set-cookie').split(';')[0];const requests=await Promise.all(Array.from({length:15},()=>mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',headers:{cookie}})));
  assert.equal(requests.filter(r=>r.status===200).length,3);assert.equal(requests.filter(r=>r.status===403).length,12);
  for(const r of requests.filter(r=>r.status===200)){assert.equal(r.headers.get('content-type'),'text/plain; charset=utf-8');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('location'),null);assert.equal(await r.text(),body);}
  assert.equal((await db.prepare('SELECT redirect_count n FROM links WHERE id=?').bind(id).first()).n,3);
});
test('workerd stale KV redirect cannot override new text mode, and text HEAD has no body', {timeout:60000}, async t=>{
  const {mf,db}=await fixture(t,true);await seed(db);assert.equal((await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual'})).status,301);
  await db.prepare("UPDATE links SET response_mode='text',text_content='new text',target_url='about:blank' WHERE id=?").bind(id).run();
  const r=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual'});assert.equal(r.status,200);assert.equal(r.headers.get('location'),null);assert.equal(await r.text(),'new text');
  const head=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('workerd receives cf timezone metadata and uses an explicitly enabled Cloudflare device header', {timeout:60000}, async t=>{
  const {mf}=await fixture(t);
  const r=await mf.dispatchFetch('https://go.example.com/__test__/dimensions',{redirect:'manual',cf:{timezone:'Asia/Tokyo'},headers:{'CF-Device-Type':'tablet'}});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{timezone:'Asia/Tokyo',device:'mobile'});
});

// Real Worker crypto/Intl/Request and native D1/KV; only test Cloudflare metadata
// and the original per-location rate bindings are injected by the fixture.
async function browserBody(mf, challenge, timezone, cf, headers, protectedLink, echoDelays) {
  const fields = new URLSearchParams({ challenge, timezone });
  if (protectedLink) fields.set('latency', await collectLatency(await mf.dispatchFetch('https://go.example.com/__Linro_rtt', {
    method:'GET', redirect:'manual', cf, headers:{...headers, origin:'https://go.example.com', upgrade:'websocket', 'sec-websocket-protocol':'linro-rtt-v3, '+challenge},
  }), echoDelays));
  return fields.toString();
}
async function nativeBrowser(mf, zone='Asia/Tokyo', cf=vpnCF, echoDelays) {
  const headers={'cf-connecting-ip':'203.0.113.31'};
  const first=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',cf,headers});assert.equal(first.status,200);
  const html=await first.text();assert.doesNotMatch(html,/example\.org\/docs/);const challenge=html.match(/name="challenge" value="([A-Za-z0-9_.-]+)"/)[1];
  const post=await mf.dispatchFetch('https://go.example.com/__Linro_browser/docs',{redirect:'manual',method:'POST',cf,headers:{...headers,origin:'null','sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded'},body:await browserBody(mf,challenge,zone,cf,headers,html.includes('name="latency"'),echoDelays)});
  return {post,cf,headers};
}
test('workerd protected navigation uses four D1 statements, including its final authorization, with or without RTT', {timeout:60000},async t=>{
  const {mf,db}=await fixture(t,true,true,true);await seed(db);
  const readMetrics=async()=> (await mf.dispatchFetch('https://go.example.com/__test__/route-metrics',{redirect:'manual'})).json();
  for(const block of [0,1]){
    await db.prepare('UPDATE links SET block_vpn=? WHERE id=?').bind(block,id).run();
    const paths=[];
    const tracked={dispatchFetch:(url,options)=>{
      paths.push(new URL(url).pathname);return mf.dispatchFetch(url,{...options,redirect:'manual'});
    }};
    const before=await readMetrics();
    const {post,cf,headers}=await nativeBrowser(tracked);
    assert.equal(post.status,303);
    const final=await tracked.dispatchFetch('https://go.example.com'+post.headers.get('location'),{
      redirect:'manual',cf,headers:{...headers,cookie:post.headers.get('set-cookie').split(';')[0]},
    });
    assert.equal(final.status,301);await final.arrayBuffer();
    assert.deepEqual(paths,['/docs',...(block?['/__Linro_rtt']:[]),'/__Linro_browser/docs','/docs']);
    const after=await readMetrics();
    assert.equal(after.calls-before.calls,4);
    assert.equal(after.get-before.get,0);
    assert.equal(after.rowsWritten-before.rowsWritten,0);
    t.diagnostic(JSON.stringify({block_vpn:block,requestsWithoutAssets:paths.length,d1Calls:4,rowsRead:after.rowsRead-before.rowsRead}));
  }
});
for(const cached of [false,true])test(`workerd browser collection native D1/KV=${cached} returns no target until proof`,{timeout:60000},async t=>{
  const {mf,db,radarReads}=await fixture(t,cached,true);await seed(db,{cap:2});await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
  const {post,cf,headers}=await nativeBrowser(mf);assert.equal(post.status,303);assert.match(post.headers.get('set-cookie'),/^__Host-.*HttpOnly.*Secure/);
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,0);
  const r=await mf.dispatchFetch('https://go.example.com'+post.headers.get('location'),{redirect:'manual',cf,headers:{...headers,cookie:post.headers.get('set-cookie').split(';')[0]}});
  assert.equal(r.status,301);assert.equal(r.headers.get('location'),'https://example.org/docs');assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,1);
  assert.equal(radarReads(),1,'page, proof POST and final GET share one cached ASN classification');
});
for(const timezone of ['Europe/London',''])test(`workerd block VPN rejects mismatched or unavailable timezone ${timezone}`,{timeout:60000},async t=>{
 const {mf,db}=await fixture(t,true,true);await seed(db,{cap:2});await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
 const {post}=await nativeBrowser(mf,timezone);assert.equal(post.status,403);assert.equal(post.headers.get('location'),null);assert.equal(post.headers.get('set-cookie'),null);
 assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,0);
});
test('workerd Cloudflare T1 is denied directly and HEAD cannot disclose target', {timeout:60000},async t=>{
 const {mf,db}=await fixture(t,true,false);await seed(db);await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
 for(const method of ['GET','HEAD']){const r=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',method,cf:{country:'T1'},headers:{'cf-connecting-ip':'203.0.113.31'}});assert.equal(r.status,403);assert.equal(r.headers.get('location'),null);if(method==='HEAD')assert.equal(await r.text(),'');}
});
test('workerd rejects five WS rounds outside the QUIC tolerance on an ACCESS_ISP link', {timeout:60000}, async t => {
  const {mf,db} = await fixture(t,true,true);
  await seed(db,{cap:2});
  await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
  const cf = {...vpnCF,httpProtocol:'HTTP/3',clientQuicRtt:3000};
  const {post} = await nativeBrowser(mf,'Asia/Tokyo',cf);
  assert.equal(post.status,403);
  assert.equal(post.headers.get('location'),null);
  assert.equal(post.headers.get('set-cookie'),null);
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,0);
});
test('workerd measures echo delays at the server and accepts one qualifying round of five', {timeout:60000}, async t => {
  const {mf,db}=await fixture(t,true,true); await seed(db,{cap:2});
  await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
  const cf={...vpnCF,httpProtocol:'HTTP/3',clientQuicRtt:5,clientTcpRtt:3000};
  const slow=await nativeBrowser(mf,'Asia/Tokyo',cf,[150,150,150,150,150]);
  assert.equal(slow.post.status,403);assert.equal(slow.post.headers.get('set-cookie'),null);
  const oneMatch=await nativeBrowser(mf,'Asia/Tokyo',cf,[150,150,0,150,150]);
  assert.equal(oneMatch.post.status,303);
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,0);
});
test('workerd new browser policy invalidates old proof and cached rule through D1', {timeout:60000},async t=>{
 const {mf,db}=await fixture(t,true,true);await seed(db);const {post,cf,headers}=await nativeBrowser(mf,'Europe/London');assert.equal(post.status,303);
 await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
 const r=await mf.dispatchFetch('https://go.example.com'+post.headers.get('location'),{redirect:'manual',cf,headers:{...headers,cookie:post.headers.get('set-cookie').split(';')[0]}});
 assert.equal(r.status,403);assert.equal(r.headers.get('location'),null);
});

test('workerd JSON success and legacy form share the signed proof; only final GET spends quota', {timeout:60000}, async t => {
 const {mf,db}=await fixture(t,true,true);await seed(db,{cap:2});await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
 const cf=vpnCF;const headers={'cf-connecting-ip':'203.0.113.31'};
 const page=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',cf,headers});
 const token=(await page.text()).match(/name="challenge" value="([A-Za-z0-9_.-]+)"/)[1];
 const body=await browserBody(mf,token,'Asia/Tokyo',cf,headers,true);
 const options={redirect:'manual',cf,method:'POST',headers:{...headers,origin:'https://go.example.com','sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded'},body};
 const legacy=await mf.dispatchFetch('https://go.example.com/__Linro_browser/docs',{...options,redirect:'manual'});assert.equal(legacy.status,303);
 const json=await mf.dispatchFetch('https://go.example.com/__Linro_browser/docs',{...options,redirect:'manual',headers:{...options.headers,accept:'application/json'}});
 assert.equal(json.status,200);assert.equal(json.headers.get('location'),null);assert.match(json.headers.get('content-type'),/^application\/json/);
 assert.equal(json.headers.get('set-cookie').split(';')[0],legacy.headers.get('set-cookie').split(';')[0]);
 assert.match(json.headers.get('content-security-policy'),/form-action 'self'/);assert.equal(json.headers.get('referrer-policy'),'no-referrer');
 const result=await json.json();assert.deepEqual(result,{ok:true,data:{next:legacy.headers.get('location')}});
 assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,0);
 const final=await mf.dispatchFetch('https://go.example.com'+result.data.next,{redirect:'manual',cf,headers:{...headers,cookie:json.headers.get('set-cookie').split(';')[0]}});
 assert.equal(final.status,301);assert.equal(final.headers.get('location'),'https://example.org/docs');
 assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,1);
});
test('workerd Accept JSON cannot bypass policy, same-origin, form or signature validation', {timeout:60000}, async t => {
 const {mf,db}=await fixture(t,true,true);await seed(db,{cap:2});await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
 const cf=vpnCF;const base={'cf-connecting-ip':'203.0.113.31'};
 const page=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',cf,headers:base});
 const token=(await page.text()).match(/name="challenge" value="([A-Za-z0-9_.-]+)"/)[1];
 for(const [timezone,challenge,origin,contentType,status] of [
   ['Europe/London',token,'https://go.example.com','application/x-www-form-urlencoded',403],
   ['',token,'https://go.example.com','application/x-www-form-urlencoded',403],
   ['Asia/Tokyo','forged','https://go.example.com','application/x-www-form-urlencoded',403],
   ['Asia/Tokyo',token,'https://evil.example','application/x-www-form-urlencoded',403],
   ['Asia/Tokyo',token,'https://go.example.com','application/json',415],
 ]){
   const response=await mf.dispatchFetch('https://go.example.com/__Linro_browser/docs',{redirect:'manual',cf,method:'POST',headers:{...base,origin,'sec-fetch-site':'same-origin',accept:'application/json','content-type':contentType},body:new URLSearchParams({challenge,timezone}).toString()});
   assert.equal(response.status,status);assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('location'),null);
 }
 assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,0);
});
test('workerd JSON text flow returns no content before both password and browser proofs are valid', {timeout:60000}, async t => {
 const {mf,db}=await fixture(t,true,true);const v=await verifier(mf);await seed(db,{cap:2,hash:v.hash});
 await db.prepare("UPDATE links SET response_mode='text',text_content='native protected text',target_url='about:blank',block_vpn=1 WHERE id=?").bind(id).run();
 const cf=vpnCF;const base={'cf-connecting-ip':'203.0.113.31',origin:'https://go.example.com','sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded'};
 const unlocked=await mf.dispatchFetch('https://go.example.com/__Linro_unlock/docs',{redirect:'manual',cf,method:'POST',headers:base,body:new URLSearchParams({password}).toString()});assert.equal(unlocked.status,303);
 const pw=unlocked.headers.get('set-cookie').split(';')[0];
 const page=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',cf,headers:{...base,cookie:pw}});
 const html=await page.text();assert.doesNotMatch(html,/native protected text/);const token=html.match(/name="challenge" value="([A-Za-z0-9_.-]+)"/)[1];
 const body=await browserBody(mf,token,'Asia/Tokyo',cf,{...base,cookie:pw},true);
 const json=await mf.dispatchFetch('https://go.example.com/__Linro_browser/docs',{redirect:'manual',cf,method:'POST',headers:{...base,cookie:pw,accept:'application/json'},body});
 assert.equal(json.status,200);const result=await json.json();assert.deepEqual(Object.keys(result.data),['next']);
 const final=await mf.dispatchFetch('https://go.example.com'+result.data.next,{redirect:'manual',cf,headers:{...base,cookie:pw+'; '+json.headers.get('set-cookie').split(';')[0]}});
 assert.equal(final.status,200);assert.equal(final.headers.get('location'),null);assert.equal(await final.text(),'native protected text');
 assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,1);
});

// Linro security-review regressions. Missing toolchain is a failing gate, not a skip.
test('workerd Linro API Origin guard blocks explicit foreign origins before authentication', {timeout:60000}, async t=>{
 const {mf}=await fixture(t);
 for(const method of ['GET','HEAD','POST','OPTIONS'])for(const origin of ['https://evil.example','null']){
  const r=await mf.dispatchFetch('https://admin.example.com/Linro/v1/links',{method,redirect:'manual',headers:{origin}});
  assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
  assert.equal(r.headers.get('strict-transport-security'),'max-age=31536000; includeSubDomains');
  if(method==='HEAD')assert.equal(await r.text(),'');else assert.equal((await r.json()).error.code,'cross_origin');
 }
 for(const headers of [{},{origin:'https://admin.example.com'}]){const r=await mf.dispatchFetch('https://admin.example.com/Linro/v1/links',{redirect:'manual',headers});assert.equal(r.status,401);}
});
test('workerd Linro HSTS hardens HTTPS redirects/assets/errors and omits HTTP policy', {timeout:60000}, async t=>{
 const {mf,db}=await fixture(t);await seed(db);
 for(const method of ['GET','HEAD'])for(const [path,status]of [['/docs',301],['/unknown',404],['/health',200],['/__Linro_assets/password.css',200]]){
  const r=await mf.dispatchFetch('https://go.example.com'+path,{method,redirect:'manual'});assert.equal(r.status,status);
  assert.equal(r.headers.get('strict-transport-security'),'max-age=31536000; includeSubDomains');
  if(method==='HEAD')assert.equal(await r.text(),'');
 }
 const local=await mf.dispatchFetch('http://go.example.com/health',{redirect:'manual'});assert.equal(local.status,200);assert.equal(local.headers.get('strict-transport-security'),null);
});
