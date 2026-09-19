import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadRuntimeToolchain } from '../../scripts/runtime-toolchain.mjs';
import { createOutboundRouter } from './outbound-router.mjs';
import { deniedOrigins } from '../unlock-cases.mjs';
const { Miniflare, convertV4MiniflareOptions, build } = loadRuntimeToolchain();
const compiled = await build({entryPoints:[fileURLToPath(new URL('./link-controls-worker.ts', import.meta.url))], bundle:true, format:'esm', platform:'browser', target:'es2022', write:false});
const password='native-workerd-test-password';
const domain='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222';
// These project migrations contain no semicolons inside string values. Preserve
// complete trigger blocks instead of splitting their BEGIN...END body at ';'.
function migrationStatements(text) {
  const triggers=[]; const withoutComments=text.replace(/^\s*--.*$/gm,'');
  const flat=withoutComments.replace(/CREATE TRIGGER\b[\s\S]*?\bEND\s*;/gi, trigger=>`__TRIGGER_${triggers.push(trigger)-1}__;`);
  return flat.split(';').map(s=>s.trim()).filter(Boolean).map(s=>/^__TRIGGER_\d+__$/.test(s)?triggers[Number(s.match(/\d+/)[0])]:s);
}
async function fixture(t, cached=false, browser=false) {
  const router=createOutboundRouter();
  const mf=new Miniflare(convertV4MiniflareOptions({cf:false,outboundService:router.outboundService,modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-15',
    d1Databases:{DB:'link-control-test'},...(cached?{kvNamespaces:{REDIRECT_CACHE:'link-control-cache'}}:{}),bindings:{
      BROWSER_TIMEZONE_ENABLED:String(browser),BROWSER_CHECK_SECRET:'b'.repeat(43),ENVIRONMENT:'production',ADMIN_ORIGIN:'https://admin.example.com',LINK_PASSWORD_SECRET:'native-test-pepper-never-deploy-this-0123456789ABCDE',
      QUERY_FORWARD_ALLOWLIST:'["utm_source"]',PRIVATE_TARGET_ALLOWLIST:'[]',EXPIRED_LINK_STATUS:'404',REDIRECT_CACHE_TTL:'300',ANALYTICS_ENABLED:'false',
    }}));
  t.after(async()=>{try {await mf.dispose();} finally {router.assertComplete();}}); const db=await mf.getD1Database('DB');
  for(const name of (await readdir(new URL('../../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) {
    for(const statement of migrationStatements(await readFile(new URL('../../migrations/'+name,import.meta.url),'utf8'))) await db.prepare(statement).run();
  }
  await db.prepare('INSERT INTO domains(id,hostname,created_at,updated_at) VALUES(?,?,0,0)').bind(domain,'go.example.com').run();
  return {mf,db};
}
async function seed(db, {hash=null,cap=null,geo='[]'}={}) {
  await db.prepare('INSERT INTO links(id,domain_id,slug,target_url,created_at,updated_at,password_hash,max_redirects,geo_rules) VALUES(?,?,?,?,0,0,?,?,?)').bind(id,domain,'docs','https://example.org/docs',hash,cap,geo).run();
}
async function verifier(mf) {
  const r=await mf.dispatchFetch('https://go.example.com/__test__/password',{redirect:'manual',method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});assert.equal(r.status,200);return r.json();
}
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
  const cookie=unlock.headers.get('set-cookie').split(';')[0];const first=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',headers:{cookie}});assert.equal(first.status,301);
  await db.prepare('UPDATE links SET title=? WHERE id=?').bind('Invalidate unlock',id).run();
  const locked=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',headers:{cookie}});assert.equal(locked.status,200);assert.equal(locked.headers.get('location'),null);
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
  // transport canary and remain in the Node-only policy matrix (report D3).
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
async function nativeBrowser(mf, zone='Asia/Tokyo', cf={country:'JP',timezone:'Asia/Tokyo'}) {
  const headers={'cf-connecting-ip':'203.0.113.31'};
  const first=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',cf,headers});assert.equal(first.status,200);
  const html=await first.text();assert.doesNotMatch(html,/example\.org\/docs/);const challenge=html.match(/name="challenge" value="([A-Za-z0-9_.-]+)"/)[1];
  const post=await mf.dispatchFetch('https://go.example.com/__Linro_browser/docs',{redirect:'manual',method:'POST',cf,headers:{...headers,origin:'null','sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({challenge,timezone:zone}).toString()});
  return {post,cf,headers};
}
for(const cached of [false,true])test(`workerd browser collection native D1/KV=${cached} returns no target until proof`,{timeout:60000},async t=>{
  const {mf,db}=await fixture(t,cached,true);await seed(db,{cap:2});await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
  const {post,cf,headers}=await nativeBrowser(mf);assert.equal(post.status,303);assert.match(post.headers.get('set-cookie'),/^__Host-.*HttpOnly.*Secure/);
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,0);
  const r=await mf.dispatchFetch('https://go.example.com'+post.headers.get('location'),{redirect:'manual',cf,headers:{...headers,cookie:post.headers.get('set-cookie').split(';')[0]}});
  assert.equal(r.status,301);assert.equal(r.headers.get('location'),'https://example.org/docs');assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await db.prepare('SELECT redirect_count FROM links WHERE id=?').bind(id).first()).redirect_count,1);
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
test('workerd new browser policy invalidates old proof and cached rule through D1', {timeout:60000},async t=>{
 const {mf,db}=await fixture(t,true,true);await seed(db);const {post,cf,headers}=await nativeBrowser(mf,'Europe/London');assert.equal(post.status,303);
 await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
 const r=await mf.dispatchFetch('https://go.example.com'+post.headers.get('location'),{redirect:'manual',cf,headers:{...headers,cookie:post.headers.get('set-cookie').split(';')[0]}});
 assert.equal(r.status,403);assert.equal(r.headers.get('location'),null);
});

test('workerd D4 JSON success and legacy form share the signed proof; only final GET spends quota', {timeout:60000}, async t => {
 const {mf,db}=await fixture(t,true,true);await seed(db,{cap:2});await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
 const cf={country:'JP',timezone:'Asia/Tokyo'};const headers={'cf-connecting-ip':'203.0.113.31'};
 const page=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',cf,headers});
 const token=(await page.text()).match(/name="challenge" value="([A-Za-z0-9_.-]+)"/)[1];
 const body=new URLSearchParams({challenge:token,timezone:'Asia/Tokyo'}).toString();
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
test('workerd D4 Accept JSON cannot bypass policy, same-origin, form or signature validation', {timeout:60000}, async t => {
 const {mf,db}=await fixture(t,true,true);await seed(db,{cap:2});await db.prepare('UPDATE links SET block_vpn=1 WHERE id=?').bind(id).run();
 const cf={country:'JP',timezone:'Asia/Tokyo'};const base={'cf-connecting-ip':'203.0.113.31'};
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
test('workerd D4 JSON text flow returns no content before both password and browser proofs are valid', {timeout:60000}, async t => {
 const {mf,db}=await fixture(t,true,true);const v=await verifier(mf);await seed(db,{cap:2,hash:v.hash});
 await db.prepare("UPDATE links SET response_mode='text',text_content='native protected text',target_url='about:blank',block_vpn=1 WHERE id=?").bind(id).run();
 const cf={country:'JP',timezone:'Asia/Tokyo'};const base={'cf-connecting-ip':'203.0.113.31',origin:'https://go.example.com','sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded'};
 const unlocked=await mf.dispatchFetch('https://go.example.com/__Linro_unlock/docs',{redirect:'manual',cf,method:'POST',headers:base,body:new URLSearchParams({password}).toString()});assert.equal(unlocked.status,303);
 const pw=unlocked.headers.get('set-cookie').split(';')[0];
 const page=await mf.dispatchFetch('https://go.example.com/docs',{redirect:'manual',cf,headers:{...base,cookie:pw}});
 const html=await page.text();assert.doesNotMatch(html,/native protected text/);const token=html.match(/name="challenge" value="([A-Za-z0-9_.-]+)"/)[1];
 const json=await mf.dispatchFetch('https://go.example.com/__Linro_browser/docs',{redirect:'manual',cf,method:'POST',headers:{...base,cookie:pw,accept:'application/json'},body:new URLSearchParams({challenge:token,timezone:'Asia/Tokyo'}).toString()});
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
