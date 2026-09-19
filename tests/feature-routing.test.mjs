import test from 'node:test';
import assert from 'node:assert/strict';
import { featureFixture, call, createLink, patch, request, row, FakeKV, PASSWORD, noTarget } from './feature-helpers.mjs';
import { cacheKey } from '../.build/packages/shared/src/redirect-cache.js';
import { geoRules, chooseGeoTarget, CONTINENTS } from '../.build/packages/shared/src/geo.js';

const geo = [{ kind: 'continent', code: 'AS', target_url: 'https://asia.example.org/' }, { kind: 'country', code: 'JP', target_url: 'https://japan.example.org/' }];

test('unbound KV stays D1-only and unlimited ordinary redirects do not write D1', async t => {
  const { env, domain } = await featureFixture(t); await createLink(env, domain); env.DB.queries.length = 0;
  assert.equal((await request(env)).status, 301);
  assert.equal(env.DB.queries.filter(q => /^SELECT/.test(q)).length, 2);
  assert.equal(env.DB.queries.filter(q => /UPDATE|INSERT|DELETE/.test(q)).length, 0);
});
test('KV miss loads D1 and caches only a route; a subsequent hit is guarded by one compact D1 query', async t => {
  const { env, domain, kv } = await featureFixture(t, { kv: true }); const link = await createLink(env, domain);
  kv.values.clear(); kv.operations.length = 0; env.DB.queries.length = 0;
  assert.equal((await request(env)).headers.get('location'), link.target_url);
  assert.deepEqual(kv.operations.map(o => o[0]), ['get', 'put']);
  const value = kv.values.get(cacheKey(domain.hostname, link.slug)); assert.ok(value);
  for (const key of ['password_hash','password_protected','redirect_count','max_redirects','created_by']) assert.equal(Object.hasOwn(JSON.parse(value).rule, key), false, key);
  kv.operations.length = 0; env.DB.queries.length = 0;
  assert.equal((await request(env)).status, 301);
  assert.deepEqual(kv.operations.map(o => o[0]), ['get']);
  assert.equal(env.DB.queries.length, 1); assert.match(env.DB.queries[0], /l\.rule_revision/); assert.doesNotMatch(env.DB.queries[0], /SELECT l\.\*/);
});
test('KV keys separate domains and preserve case-sensitive slugs', async t => {
  const { env, domain, kv } = await featureFixture(t, { kv: true });
  const other = await call(env, '/domains', 'POST', { hostname: 's.example.net' });
  await createLink(env, domain, { slug: 'Docs', target_url: 'https://a.example.org/' });
  await createLink(env, domain, { slug: 'docs', target_url: 'https://b.example.org/' });
  await createLink(env, other.data, { slug: 'docs', target_url: 'https://c.example.org/' });
  assert.equal(kv.values.size, 3);
  assert.equal((await request(env, '/Docs')).headers.get('location'), 'https://a.example.org/');
  assert.equal((await request(env, '/docs')).headers.get('location'), 'https://b.example.org/');
  assert.equal((await request(env, '/docs', { host: 's.example.net' })).headers.get('location'), 'https://c.example.org/');
});
test('KV read, write and deletion outages fall back safely without turning committed CRUD into errors', async t => {
  const { env, domain, kv } = await featureFixture(t, { kv: true });
  kv.failPut = true; const link = await createLink(env, domain);
  kv.failGet = true; assert.equal((await request(env)).status, 301);
  const updated = await patch(env, link, { target_url: 'https://new.example.org/' });
  assert.equal((await request(env)).headers.get('location'), updated.target_url);
  kv.failDelete = true;
  assert.equal((await call(env, '/links/' + link.id + '?version=' + updated.version, 'DELETE')).status, 200);
  await noTarget(await request(env), 404);
});
test('slow KV reads are bounded and recover using D1', async t => {
  const { env, domain } = await featureFixture(t); await createLink(env, domain);
  env.REDIRECT_CACHE = { get: () => new Promise(() => {}), put: async () => {}, delete: async () => {} };
  const start = performance.now(); assert.equal((await request(env)).status, 301); assert.ok(performance.now() - start < 2000);
});
test('malformed, mismatched, expired and future cache envelopes cannot replace D1', async t => {
  const { env, domain, kv } = await featureFixture(t, { kv: true }); await createLink(env, domain);
  const key = cacheKey(domain.hostname, 'docs'), good = JSON.parse(kv.values.get(key));
  for (const change of [() => '{bad', e => { e.schema = 9; }, e => { e.until = 0; }, e => { e.until += 90000; }, e => { e.rule.slug = 'other'; }, e => { e.rule.hostname = 'evil.example'; }, e => { e.rule.id = 'a'.repeat(36); }, e => { e.rule.version++; }, e => { e.rule.geo_rules = '{}'; }, e => { e.rule.target_url = 'javascript:alert(1)'; }]) {
    const e = structuredClone(good); const value = change(e); kv.values.set(key, value ?? JSON.stringify(e));
    assert.equal((await request(env)).headers.get('location'), 'https://example.org/docs');
  }
});
test('old fills after mutations never resurrect stale routes, removed links, or disabled domains', async t => {
  const { env, domain, kv } = await featureFixture(t, { kv: true }); const link = await createLink(env, domain);
  const key = cacheKey(domain.hostname, 'docs'), old = kv.values.get(key);
  let current = await patch(env, link, { target_url: 'https://new.example.org/' }); kv.values.set(key, old);
  assert.equal((await request(env)).headers.get('location'), current.target_url);
  current = await patch(env, link, { enabled: false }); kv.values.set(key, old); await noTarget(await request(env), 404);
  current = await patch(env, link, { enabled: true });
  await call(env, '/domains/' + domain.id, 'PATCH', { version: domain.version, enabled: false }); kv.values.set(key, old); await noTarget(await request(env), 404);
  await call(env, '/domains/' + domain.id, 'PATCH', { version: domain.version + 1, enabled: true });
  await call(env, '/links/' + link.id + '?version=' + current.version, 'DELETE'); kv.values.set(key, old); await noTarget(await request(env), 404);
});
test('new password and quota settings cannot be bypassed by an old unprotected KV entry', async t => {
  const { env, domain, kv } = await featureFixture(t, { kv: true }); const link = await createLink(env, domain);
  const key = cacheKey(domain.hostname, 'docs'), old = kv.values.get(key);
  await patch(env, link, { password: PASSWORD }); kv.values.set(key, old);
  const locked = await request(env); await noTarget(locked, 200); assert.match(await locked.text(), /password-protected/);
  await patch(env, link, { password: null, max_redirects: 1 }); kv.values.set(key, old);
  assert.equal((await request(env)).status, 301); kv.values.set(key, old); await noTarget(await request(env), 403);
});
test('direct SQL changes invalidate route revisions even without a public version update', async t => {
  const { env, domain } = await featureFixture(t, { kv: true }); const link = await createLink(env, domain);
  env.DB.sqlite.prepare('UPDATE links SET target_url=? WHERE id=?').run('https://new.example.org/', link.id);
  assert.equal(row(env, link.id).version, 1); assert.equal(row(env, link.id).rule_revision, 2);
  assert.equal((await request(env)).headers.get('location'), 'https://new.example.org/');
});
test('KV hits still fail closed on D1 outages and new managed target registrations', async t => {
  const { env, domain } = await featureFixture(t, { kv: true }); await createLink(env, domain);
  const db = env.DB; env.DB = { prepare() { throw new Error('fixture database outage'); } }; await noTarget(await request(env), 503); env.DB = db;
  db.sqlite.prepare('INSERT INTO domains(id,hostname,created_at,updated_at) VALUES(?,?,0,0)').run(crypto.randomUUID(), 'example.org');
  await noTarget(await request(env), 503);
});
test('cache hits reapply current private-target policy, not just cached write-time validation', async t => {
  const { env, domain } = await featureFixture(t, { kv: true, PRIVATE_TARGET_ALLOWLIST: '["10.0.0.8"]' });
  await createLink(env, domain, { target_url: 'http://10.0.0.8/' }); assert.equal((await request(env)).status, 301);
  env.PRIVATE_TARGET_ALLOWLIST = '[]'; await noTarget(await request(env), 503);
});
test('KV is checked before the SQL guard, but no negative cache entries are written', async t => {
  const { env, kv } = await featureFixture(t, { kv: true }); kv.operations.length = 0;
  await noTarget(await request(env, '/missing'), 404); assert.deepEqual(kv.operations.map(o => o[0]), ['get']); assert.equal(kv.values.size, 0);
});
test('API rename/domain move and bulk enable/disable/delete maintain cache keys', async t => {
  const { env, domain, kv } = await featureFixture(t, { kv: true }); const link = await createLink(env, domain);
  const d2 = (await call(env, '/domains', 'POST', { hostname: 's.example.net' })).data;
  await patch(env, link, { slug: 'moved', domain_id: d2.id }); assert.equal(kv.values.has(cacheKey(domain.hostname, 'docs')), false);
  assert.equal((await request(env, '/moved', { host: d2.hostname })).status, 301);
  for (const action of ['disable','enable','delete']) {
    const result = await call(env, '/links/bulk', 'POST', { action, items: [{ id: link.id, version: row(env, link.id).version }] }); assert.equal(result.data.results[0].ok, true);
    const response = await request(env, '/moved', { host: d2.hostname }); assert.equal(response.status, action === 'enable' ? 301 : 404);
  }
});
test('cache payload excludes the password verifier and successful counters even for protected capped links', async t => {
  const { env, domain, kv } = await featureFixture(t, { kv: true }); const link = await createLink(env, domain, { password: PASSWORD, max_redirects: 2 });
  const value = [...kv.values.values()][0]; const stored = row(env, link.id);
  assert.ok(!value.includes(PASSWORD)); assert.ok(!value.includes(stored.password_hash)); assert.ok(!value.includes('redirect_count')); assert.ok(!value.includes('max_redirects'));
});

for (const cached of [false, true]) test(`country > continent > default using only request.cf (${cached ? 'KV' : 'D1'})`, async t => {
  const { env, domain } = await featureFixture(t, { kv: cached }); await createLink(env, domain, { geo_rules: geo, cache_ttl: 3600 });
  for (const [cf, expected] of [[{ country:'JP',continent:'AS' },'https://japan.example.org/'],[{ country:'CN',continent:'AS' },'https://asia.example.org/'],[{ country:'US',continent:'NA' },'https://example.org/docs'],[{},'https://example.org/docs'],[{country:'T1'},'https://example.org/docs']]) {
    const res = await request(env, '/docs', { cf }); assert.equal(res.status,301); assert.equal(res.headers.get('location'),expected); assert.match(res.headers.get('cache-control'),/no-store/);
  }
  assert.equal((await request(env, '/docs?country=JP&continent=AS', { headers: { 'cf-ipcountry':'JP','x-country':'JP','x-forwarded-for':'8.8.8.8' } })).headers.get('location'), 'https://example.org/docs');
});
test('all seven Cloudflare continent identifiers are selectable and exact country rules override array order', () => {
  for (const continent of CONTINENTS) {
    const rules = geoRules([{kind:'continent',code:continent,target_url:'https://regional.example/'},{kind:'country',code:'JP',target_url:'https://jp.example/'}]);
    const req = new Request('https://go.example/docs'); Object.defineProperty(req,'cf',{value:{continent,country:'JP'}});
    assert.equal(chooseGeoTarget(rules,'https://default.example/',req),'https://jp.example/');
    Object.defineProperty(new Request('https://go.example/docs'),'cf',{value:{continent}});
    const noCountry = new Request('https://go.example/docs'); Object.defineProperty(noCountry,'cf',{value:{continent}});
    assert.equal(chooseGeoTarget(rules,'https://default.example/',noCountry),'https://regional.example/');
  }
});
test('invalid, duplicate, oversized and unknown geo input shapes are rejected before mutation', async t => {
  const { env, domain } = await featureFixture(t);
  for (const rules of [null,{},'[]',[{kind:'ip',code:'JP',target_url:'https://x.example/'}],[{kind:'country',code:'jp',target_url:'https://x.example/'}],[{kind:'country',code:'XX',target_url:'https://x.example/'}],[{kind:'continent',code:'ZZ',target_url:'https://x.example/'}],[geo[0],geo[0]],Array(33).fill(geo[0]),[{...geo[0],password:'do-not-accept'}]]) {
    const res = await call(env,'/links','POST',{domain_id:domain.id,slug:'badgeo',target_url:'https://example.org/',geo_rules:rules}); assert.equal(res.status,400,JSON.stringify(rules));
  }
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM links').get().n,0);
});
test('all regional targets, including unmatched regions, retain private/managed/query safety checks', async t => {
  const { env, domain } = await featureFixture(t);
  for (const [target,mode] of [['http://127.0.0.1/','discard'],['https://go.example.com/docs','discard'],['https://auth.example/oauth/authorize?client_id=x','merge'],['javascript:alert(1)','discard']]) {
    const res=await call(env,'/links','POST',{domain_id:domain.id,slug:'badgeo',target_url:'https://example.org/',query_mode:mode,geo_rules:[{kind:'country',code:'JP',target_url:target}]}); assert.equal(res.status,400,target);
  }
});
test('a new domain cannot silently convert an existing geographic target into a managed redirect', async t => {
  const { env, domain }=await featureFixture(t); await createLink(env,domain,{geo_rules:geo});
  const res=await call(env,'/domains','POST',{hostname:'japan.example.org'}); assert.equal(res.status,409); assert.equal(res.error.code,'hostname_is_destination');
});
test('geo parameters follow the existing allowlist policy and internal language selection is never forwarded', async t => {
  const { env, domain }=await featureFixture(t); await createLink(env,domain,{query_mode:'merge',geo_rules:geo});
  const res=await request(env,'/docs?_Linro_lang=zh-CN&utm_source=test&next=evil',{cf:{country:'JP',continent:'AS'}});
  assert.equal(res.headers.get('location'),'https://japan.example.org/?utm_source=test');
});
test('geographic audit details redact target query strings and fragments', async t => {
  const { env, domain }=await featureFixture(t); await createLink(env,domain,{geo_rules:[{kind:'country',code:'JP',target_url:'https://japan.example.org/?secret=fixture#private'}]});
  const audit=env.DB.sqlite.prepare("SELECT details FROM audit_logs WHERE resource_type='link'").all().map(r=>r.details).join('');
  assert.ok(!audit.includes('fixture')); assert.ok(!audit.includes('#private')); assert.ok(audit.includes('japan.example.org'));
});

test('real Context waitUntil contract keeps cache writes off response latency and settles failures without rollback',async t=>{
  const {env,domain,kv}=await featureFixture(t,{kv:true});await createLink(env,domain);kv.values.clear();
  let fail;kv.put=()=>new Promise((_,reject)=>{fail=reject;});const tasks=[];
  const res=await request(env,'/docs',{ctx:{waitUntil(task){tasks.push(task);}}});assert.equal(res.status,301);assert.equal(tasks.length,1);assert.equal(typeof fail,'function');
  fail(new Error('fixture late KV outage'));await Promise.all(tasks);assert.equal((await call(env,'/links')).data.total,1);
});
