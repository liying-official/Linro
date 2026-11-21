import { newTestSecret } from './fixture-credentials.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { featureFixture, call, createLink, patch, request, row, FakeKV, PASSWORD } from './feature-helpers.mjs';
import { cacheKey } from '../.build/packages/shared/src/redirect-cache.js';
import { exportCSV, parseCSV } from '../.build/apps/admin/src/web/csv.js';

test('per-link KV TTL inherits globally, supports disable/override, and retains client cache semantics', async t => {
  const {env,domain}=await featureFixture(t,{kv:true,REDIRECT_CACHE_TTL:'1800'});
  assert.equal((await call(env,'/session')).data.features.redirect_cache_default_ttl,1800);
  const link=await createLink(env,domain,{cache_ttl:30});
  assert.equal(link.kv_cache_ttl,null);assert.equal(link.cache_ttl,30);
  const next=await patch(env,link,{kv_cache_ttl:7200});assert.equal(next.kv_cache_ttl,7200);assert.equal(next.cache_ttl,30);
  assert.match((await request(env)).headers.get('cache-control'),/max-age=30/);
  for(const value of [-1,1,59,86401,1.5,'300',false])assert.equal((await call(env,'/links/'+next.id,'PATCH',{version:next.version,kv_cache_ttl:value})).status,400,String(value));
  const off=await patch(env,next,{kv_cache_ttl:0});assert.equal(off.kv_cache_ttl,0);
  assert.equal((await patch(env,off,{kv_cache_ttl:null})).kv_cache_ttl,null);
});

test('refill TTL expiry and configuration changes cannot be suppressed by an earlier version', async t=>{
  let clock=Date.now();t.mock.method(Date,'now',()=>clock);
  const {env,domain}=await featureFixture(t,{REDIRECT_CACHE_TTL:'300'});const link=await createLink(env,domain);
  const kv=new FakeKV();env.REDIRECT_CACHE=kv;
  await request(env);assert.equal(kv.operations.filter(o=>o[0]==='put').length,1);
  clock+=299000;await request(env);assert.equal(kv.operations.filter(o=>o[0]==='put').length,1);
  clock+=1000;await request(env);assert.equal(kv.operations.filter(o=>o[0]==='put').length,2);
  const changed=await patch(env,link,{kv_cache_ttl:7200});
  assert.equal(kv.operations.filter(o=>o[0]==='put').at(-1)[2].expirationTtl,7200);
  env.DB.sqlite.prepare('UPDATE links SET kv_cache_ttl=0 WHERE id=?').run(changed.id);
  kv.operations.length=0;await request(env);assert.deepEqual(kv.operations,[]);
});

test('JSON/CSV cache preferences preserve inheritance and stay within existing link ownership rules', async t=>{
  const {env,domain}=await featureFixture(t);const inherited=await createLink(env,domain,{slug:'inherited'});
  const explicit=await createLink(env,domain,{slug:'custom',kv_cache_ttl:3600});const off=await createLink(env,domain,{slug:'off',kv_cache_ttl:0});
  const rows=parseCSV(exportCSV([inherited,explicit,off]));assert.deepEqual(rows.map(r=>r.kv_cache_ttl),['','3600','0']);
  const imported=await call(env,'/links/import','POST',{links:[{domain_id:domain.id,slug:'imported',target_url:'https://example.org/',kv_cache_ttl:3600}]});assert.equal(imported.status,201);
  assert.equal((await call(env,'/links/'+imported.data.ids[0])).data.kv_cache_ttl,3600);
  const token=await call(env,'/tokens','POST',{name:'fixture',scopes:['links:write'],expires_at:Math.floor(Date.now()/1000)+3600});
  env.DB.sqlite.prepare('UPDATE links SET created_by=NULL WHERE id=?').run(explicit.id);
  const denied=await call(env,'/links/'+explicit.id,'PATCH',{version:explicit.version,kv_cache_ttl:60},{noDev:true,headers:{Authorization:'Bearer '+token.data.token}});
  assert.equal(denied.status,403);assert.equal(row(env,explicit.id).kv_cache_ttl,3600);
});

for(const [name,values,config] of [
  ['password',{password:PASSWORD},{}],['quota',{max_redirects:5},{}],
  ['text',{response_mode:'text',text_content:'fixture'},{}],['expiry',{expires_at:2000000000},{}],
  ['geo',{geo_rules:[{kind:'country',code:'JP',target_url:'https://example.org/jp'}]},{}],
  ['VPN',{block_vpn:true},{BROWSER_CHECK_SECRET:newTestSecret()}],
  ['global browser',{}, {BROWSER_TIMEZONE_ENABLED:'true',BROWSER_CHECK_SECRET:newTestSecret(),ANALYTICS_ENABLED:'true',ANALYTICS:{writeDataPoint(){}}}],
]) test(`protected ${name} links never read, fill, or delete KV during visits`, async t=>{
  const {env,domain,kv}=await featureFixture(t,{kv:true,...config});await createLink(env,domain,values);
  assert.deepEqual(kv.operations,[],'protected creation must not populate KV');
  for(let n=0;n<4;n++)await request(env);
  assert.deepEqual(kv.operations,[],'visits must entirely bypass KV');
});

test('cold parallel misses and negative propagation cause one refill per isolate and TTL', async t=>{
  const {env,domain}=await featureFixture(t);await createLink(env,domain);
  const kv=new FakeKV();kv.get=async function(key,options){this.operations.push(['get',key,options]);return null;};env.REDIRECT_CACHE=kv;
  const replies=await Promise.all(Array.from({length:40},()=>request(env)));
  assert.ok(replies.every(r=>r.status===301));assert.equal(kv.operations.filter(x=>x[0]==='put').length,1);
  for(let n=0;n<10;n++)await request(env);
  assert.equal(kv.operations.filter(x=>x[0]==='put').length,1,'negative KV propagation cannot cause refill storms');
});

test('read outages do not cause puts and failed fills are cooled down', async t=>{
  const {env,domain}=await featureFixture(t);await createLink(env,domain);
  const kv=new FakeKV();env.REDIRECT_CACHE=kv;kv.failGet=true;
  for(let n=0;n<5;n++)assert.equal((await request(env)).status,301);
  assert.equal(kv.operations.filter(x=>x[0]==='put').length,0);
  kv.failGet=false;kv.failPut=true;
  for(let n=0;n<10;n++)assert.equal((await request(env)).status,301);
  assert.equal(kv.operations.filter(x=>x[0]==='put').length,1);
});

test('warm public entries cannot bypass protection added before or during a KV read', async t=>{
  const {env,domain,kv}=await featureFixture(t,{kv:true});const link=await createLink(env,domain);
  const original=kv.get.bind(kv);let changed=false;
  kv.get=async(...args)=>{const value=await original(...args);if(!changed){changed=true;await patch(env,link,{password:PASSWORD});}return value;};
  const response=await request(env);assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);
  kv.operations.length=0;await request(env);assert.deepEqual(kv.operations,[]);
});

test('disabled and missing routes never consume KV and stale data cannot bypass latest D1', async t=>{
  const {env,domain,kv}=await featureFixture(t,{kv:true});const link=await createLink(env,domain);
  const stale=kv.values.get(cacheKey(domain.hostname,link.slug));await patch(env,link,{kv_cache_ttl:0});kv.values.set(cacheKey(domain.hostname,link.slug),stale);
  kv.operations.length=0;assert.equal((await request(env)).status,301);assert.deepEqual(kv.operations,[]);
  assert.equal((await request(env,'/missing')).status,404);assert.deepEqual(kv.operations,[]);
  env.DB.sqlite.prepare('UPDATE links SET enabled=0 WHERE id=?').run(link.id);
  assert.equal((await request(env)).status,404);assert.deepEqual(kv.operations,[]);
});
