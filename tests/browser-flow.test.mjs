import test from 'node:test'; import assert from 'node:assert/strict';
import { fixture, challenge, submit, complete, send, current, count, patch, defaultCF } from './browser-fixture.mjs';
import { call, redirect } from './harness.mjs';
import { cacheKey } from '../.build/packages/shared/src/redirect-cache.js';
for(const kv of [false,true])for(const mode of ['redirect','text']){
 const fields=mode==='text'?{response_mode:'text',text_content:'secret plain text <script>no execution</script>',target_url:''}:{};
 test(`${kv?'KV':'D1'} ${mode}: JS collection then final success consumes/logs exactly once`,async t=>{
  const f=await fixture(t,fields,{kv});const c=await challenge(f);
  assert.equal(c.response.headers.get('location'),null);assert.match(c.response.headers.get('content-security-policy'),/script-src 'self'/);
  assert.doesNotMatch(c.html,/example\.org|secret plain text|unsafe-inline/);assert.match(c.html,/browser\.js/);assert.equal(count(f),0);assert.equal(f.events.length,0);
  const p=await submit(f,c.token);assert.equal(p.status,303);assert.equal(count(f),0);assert.equal(f.events.length,0);
  const cookie=p.headers.get('set-cookie').split(';')[0];
  const r=await send(f,p.headers.get('location'),{headers:{cookie}});
  assert.equal(r.status,mode==='text'?200:301);assert.match(r.headers.get('cache-control'),/no-store/);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
  if(mode==='text'){assert.equal(await r.text(),fields.text_content);assert.equal(r.headers.get('location'),null);}
  else assert.equal(r.headers.get('location'),'https://example.org/docs');
  assert.equal(count(f),1);assert.equal(f.events.length,1);assert.deepEqual(f.events[0].blobs.slice(8),['Asia/Tokyo','match','success']);
  assert.deepEqual(f.events[0].doubles,[1,mode==='text'?200:301,0,0,0,0,0]);
  if(kv)for(const raw of f.kv.map.values())assert.doesNotMatch(raw,/browserTimezone|BROWSER_CHECK_SECRET|password_hash|secret plain text|block_vpn/);
 });
 test(`${kv?'KV':'D1'} ${mode}: mismatch blocks before target, text and quota`,async t=>{
  const f=await fixture(t,{...fields,block_vpn:true},{kv});const c=await challenge(f);
  const r=await submit(f,c.token,'Europe/London');assert.equal(r.status,403);assert.equal(r.headers.get('location'),null);assert.equal(r.headers.get('set-cookie'),null);
  assert.doesNotMatch(await r.text(),/example.org|secret plain text/);assert.equal(count(f),0);assert.equal(f.events.length,1);
  assert.deepEqual(f.events[0].doubles,[0,403,1,1,0,0,0]);
 });
 test(`${kv?'KV':'D1'} ${mode}: 40 final requests contend for 7 slots`,async t=>{
  const f=await fixture(t,{...fields,block_vpn:true,max_redirects:7},{kv});const c=await challenge(f);const p=await submit(f,c.token);
  const cookie=p.headers.get('set-cookie').split(';')[0];const rows=await Promise.all(Array.from({length:40},()=>send(f,p.headers.get('location'),{headers:{cookie}})));
  assert.equal(rows.filter(r=>r.status===(mode==='text'?200:301)).length,7);assert.equal(rows.filter(r=>r.status===403).length,33);assert.equal(count(f),7);assert.equal(f.events.length,7);
 });
}
test('without blocking a timezone mismatch succeeds and is recorded as suspected, not blocked',async t=>{
 const f=await fixture(t);const out=await complete(f,'Europe/London',{path:'/docs?utm_source=test&_Linro_lang=en',headers:{referer:'https://initial.example/path?secret=1'}});
 assert.equal(out.response.status,301);assert.deepEqual(f.events[0].doubles,[1,301,1,0,0,0,0]);
 assert.equal(f.events[0].blobs[5],'Asia/Tokyo');assert.equal(f.events[0].blobs[8],'Europe/London');assert.equal(f.events[0].blobs[3],'initial.example');
 assert.doesNotMatch(out.response.headers.get('location'),/_Linro_check|_Linro_lang/);
});
for(const blocked of [false,true])for(const cf of [defaultCF,{country:'JP'},null])
 test(`unknown JS/IP timezone with block=${blocked} CF=${JSON.stringify(cf)}`,async t=>{
  const f=await fixture(t,{block_vpn:blocked});const c=await challenge(f,'/docs',{cf});const r=await submit(f,c.token,'','/__Linro_browser/docs',{cf});
  if(blocked){assert.equal(r.status,403);assert.equal(count(f),0);assert.deepEqual(f.events[0].doubles,[0,403,0,0,1,0,0]);}
  else {assert.equal(r.status,303);const result=await send(f,r.headers.get('location'),{cf,headers:{cookie:r.headers.get('set-cookie').split(';')[0]}});assert.equal(result.status,301);assert.equal(f.events[0].blobs[8],'none');assert.deepEqual(f.events[0].doubles,[1,301,0,0,0,1,0]);}
 });
for(const blocked of [false,true])test(`Cloudflare T1 directly suspected with block=${blocked}`,async t=>{
 const f=await fixture(t,{block_vpn:blocked});const cf={country:'T1',timezone:'Asia/Tokyo'};
 if(blocked){const r=await send(f,'/docs',{cf});assert.equal(r.status,403);assert.equal(count(f),0);assert.deepEqual(f.events[0].doubles,[0,403,1,1,0,0,1]);}
 else {const r=await complete(f,'Asia/Tokyo',{cf});assert.equal(r.response.status,301);assert.deepEqual(f.events[0].doubles,[1,301,1,0,0,0,1]);}
});
test('per-link blocking requires browser check even when global collection is disabled; legacy unblocked is direct',async t=>{
 const f=await fixture(t,{}, {env:{BROWSER_TIMEZONE_ENABLED:'false'}});assert.equal((await send(f,'/docs')).status,301);f.events.length=0;
 await patch(f,{block_vpn:true});assert.match((await challenge(f)).html,/Browser environment check/);
 assert.equal((await send(f,'/docs',{method:'HEAD'})).status,403);assert.equal(count(f),1);assert.equal(f.events.length,0);
});
test('HEAD does not count as browser success analytics; protected HEAD requires proof',async t=>{
 const f=await fixture(t,{block_vpn:true});let r=await send(f,'/docs',{method:'HEAD'});assert.equal(r.status,403);assert.equal(await r.text(),'');assert.equal(r.headers.get('location'),null);assert.equal(count(f),0);
 const c=await challenge(f);const p=await submit(f,c.token);r=await send(f,p.headers.get('location'),{method:'HEAD',headers:{cookie:p.headers.get('set-cookie').split(';')[0]}});
 assert.equal(r.status,301);assert.equal(await r.text(),'');assert.equal(count(f),1);assert.equal(f.events.length,0);
});
for(const missing of ['secret','https','ip'])test(`production browser collection fails closed on missing ${missing}`,async t=>{
 const f=await fixture(t);f.env.ENVIRONMENT='production';
 const headers={};let origin='https://go.example.com';
 if(missing==='secret')delete f.env.BROWSER_CHECK_SECRET;
 if(missing==='https')origin='http://go.example.com';
 if(missing==='ip')headers['cf-connecting-ip']='';
 const r=await send(f,'/docs',{headers,origin});assert.equal(r.status,missing==='https'?400:503);assert.equal(r.headers.get('location'),null);assert.equal(count(f),0);
});
test('production cookie uses __Host prefix, Secure/HttpOnly; marker alone never authorizes',async t=>{
 const f=await fixture(t,{block_vpn:true});f.env.ENVIRONMENT='production';
 const c=await challenge(f);const p=await submit(f,c.token);assert.match(p.headers.get('set-cookie'),/^__Host-.*HttpOnly.*Secure/);
 const r=await send(f,p.headers.get('location'));assert.equal(r.status,403);assert.equal(count(f),0);
});
for(const change of ['block','password','mode','disable','expiry','target'])test(`cached rule and old browser proof cannot bypass later ${change} update`,async t=>{
 const f=await fixture(t,{}, {kv:true});const c=await challenge(f);const p=await submit(f,c.token,'Europe/London');const old=new Map(f.kv.map);
 const values={block:{block_vpn:true},password:{password:'new-long-link-password'},mode:{response_mode:'text',text_content:'new secret text',target_url:'',geo_rules:[],query_mode:'discard'},disable:{enabled:false},expiry:{expires_at:Math.floor(Date.now()/1000)+1},target:{target_url:'https://new.example/new'}}[change];
 await patch(f,values);
 if(change==='expiry')f.env.DB.sqlite.prepare('UPDATE links SET expires_at=1 WHERE id=?').run(f.link.id);
 f.kv.map=old;
 const r=await send(f,p.headers.get('location'),{headers:{cookie:p.headers.get('set-cookie').split(';')[0]}});
 assert.ok([200,403,404].includes(r.status));assert.equal(r.headers.get('location'),null);assert.doesNotMatch(await r.text(),/new secret text|new\.example|example\.org/);assert.equal(count(f),0);
});
test('password authorization precedes collection and remains required at final GET',async t=>{
 const f=await fixture(t,{block_vpn:true,password:'private-long-password'});
 const first=await send(f,'/docs');assert.equal(first.status,200);assert.doesNotMatch(await first.text(),/name="challenge"/);
 const bad=await send(f,'/__Linro_browser/docs',{method:'POST',body:'timezone=Asia%2FTokyo&challenge=bad'});assert.equal(bad.status,403);
 const unlock=await send(f,'/__Linro_unlock/docs',{method:'POST',headers:{origin:'null','sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded'},body:'password=private-long-password'});
 assert.equal(unlock.status,303);const passwordCookie=unlock.headers.get('set-cookie').split(';')[0];
 const c=await challenge(f,'/docs',{headers:{cookie:passwordCookie}});const p=await submit(f,c.token,'Asia/Tokyo','/__Linro_browser/docs',{headers:{cookie:passwordCookie}});
 const proofCookie=p.headers.get('set-cookie').split(';')[0];assert.equal(count(f),0);assert.equal(f.events.length,0);
 const denied=await send(f,p.headers.get('location'),{headers:{cookie:proofCookie}});assert.equal(denied.status,200);assert.equal(denied.headers.get('location'),null);assert.equal(count(f),0);
 const yes=await send(f,p.headers.get('location'),{headers:{cookie:passwordCookie+'; '+proofCookie}});assert.equal(yes.status,301);assert.equal(count(f),1);
});
for(const headers of [{},{origin:'https://evil.example','sec-fetch-site':'same-origin'},{origin:'null','sec-fetch-site':'cross-site'},{origin:'https://go.example.com','sec-fetch-site':'same-site'}])
 test(`browser submission rejects origin ambiguity ${JSON.stringify(headers)}`,async t=>{
 const f=await fixture(t,{block_vpn:true});const c=await challenge(f);
 const r=await send(f,'/__Linro_browser/docs',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams({challenge:c.token,timezone:'Asia/Tokyo'}).toString()});
 assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null);assert.equal(count(f),0);assert.equal(f.events.length,0);
});
test('same-origin JSON/plain, duplicate fields and oversized probes cannot mint proofs',async t=>{
 const f=await fixture(t);const c=await challenge(f);
 for(const [body,type,status] of [[JSON.stringify({challenge:c.token,timezone:'Asia/Tokyo'}),'application/json',415],['challenge=x&timezone=x&timezone=y','application/x-www-form-urlencoded',400],['challenge=x&timezone=x&extra=1','application/x-www-form-urlencoded',400],['challenge=x&timezone='+'a'.repeat(4096),'application/x-www-form-urlencoded',413]]){
 const r=await send(f,'/__Linro_browser/docs',{method:'POST',headers:{origin:'https://go.example.com','content-type':type},body});assert.equal(r.status,status);assert.equal(r.headers.get('set-cookie'),null);
 }assert.equal(count(f),0);assert.equal(f.events.length,0);
});
test('probe method guards and scripts do not query D1 or emit analytics',async t=>{
 const f=await fixture(t);f.env.DB.queries.length=0;
 for(const method of ['GET','HEAD','PUT']){const r=await send(f,'/__Linro_browser/docs',{method});assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'POST');}
 const r=await send(f,'/__Linro_assets/browser.js');assert.equal(r.status,200);assert.match(await r.text(),/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
 assert.equal(f.env.DB.queries.length,0);assert.equal(f.events.length,0);
});
test('browser root secret is never in session/API/export or auditing; flag is a normal audited policy field',async t=>{
 const f=await fixture(t,{block_vpn:true});for(const path of ['/session','/links','/links/'+f.link.id,'/audit']) {
 const r=await call(f.env,path);assert.equal(r.status,200);assert.ok(!JSON.stringify(r.body).includes(f.env.BROWSER_CHECK_SECRET));
 }assert.equal(current(f).block_vpn,1);const rev=current(f).rule_revision;
 await patch(f,{title:'keep policy'});assert.equal(current(f).block_vpn,1);assert.ok(current(f).rule_revision>rev);
});
