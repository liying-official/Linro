import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup, environment, call, createLink, visit, admin, redirect } from './harness.mjs';
import { securityPolicy, sensitiveTarget, isPrivateTarget } from '../.build/packages/shared/src/policy.js';
import { buildTarget, targetURL } from '../.build/packages/shared/src/validation.js';
import { exportCSV, parseCSV } from '../.build/apps/admin/src/web/csv.js';
import { queryAnalytics } from '../.build/apps/admin/src/worker/analytics.js';
import { verifyAccess } from '../.build/packages/shared/src/access.js';
const auditCount = env => env.DB.sqlite.prepare('SELECT count(*) AS n FROM audit_logs').get().n;
const snapshot = env => env.DB.sqlite.prepare('SELECT * FROM links ORDER BY id').all();

const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'security-test', use: 'sig', alg: 'RS256' };
const aud = 'a'.repeat(64);
async function jwt(issuer, email = 'owner@example.com', extra = {}) {
  const now = Math.floor(Date.now() / 1000), b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${b64({ alg: 'RS256', kid: jwk.kid })}.${b64({ iss: issuer, aud, type: 'app', sub: email, email, iat: now - 5, exp: now + 300, ...extra })}`;
  return `${data}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(data))).toString('base64url')}`;
}
async function rolesFixture(t) {
  const env = environment({ ENVIRONMENT: 'production', ADMIN_ORIGIN: 'https://admin.example.com', ACCESS_ISSUER: 'https://role-security.cloudflareaccess.com', ACCESS_AUD: aud });
  const original = globalThis.fetch;
  globalThis.fetch = async url => { assert.equal(String(url), `${env.ACCESS_ISSUER}/cdn-cgi/access/certs`); return Response.json({ keys: [jwk] }); };
  t.after(() => { globalThis.fetch = original; env.DB.close(); });
  const browser = {};
  for (const name of ['owner', 'editor', 'other', 'admin', 'viewer']) browser[name] = { noDev: true, headers: { 'Cf-Access-Jwt-Assertion': await jwt(env.ACCESS_ISSUER, name + '@example.com') } };
  const request = (who, path, method = 'GET', body) => call(env, path, method, body, typeof who === 'string' ? browser[who] : who);
  const owner = (await request('owner', '/session')).data.user;
  const users = { owner };
  for (const [name, role] of [['editor', 'editor'], ['other', 'editor'], ['admin', 'admin'], ['viewer', 'viewer']]) {
    const result = await request('owner', '/users', 'POST', { email: name + '@example.com', role });
    assert.equal(result.status, 201); users[name] = result.data;
  }
  const d = await request('owner', '/domains', 'POST', { hostname: 'go.example.com' }); assert.equal(d.status, 201);
  const make = async (who, slug) => {
    const res = await request(who, '/links', 'POST', { domain_id: d.data.id, slug, target_url: 'https://example.org/' }); assert.equal(res.status, 201); return res.data;
  };
  const tokenFor = async name => {
    const res = await request(name, '/tokens', 'POST', { name: 'fixture', scopes: ['links:read', 'links:write', 'links:delete'], expires_at: Math.floor(Date.now() / 1000) + 600 }); assert.equal(res.status, 201);
    return { noDev: true, headers: { 'Cf-Access-Jwt-Assertion': await jwt(env.ACCESS_ISSUER, undefined, { sub: '', common_name: 'fixture-service', email: undefined }), Authorization: 'Bearer ' + res.data.token } };
  };
  return { env, users, browser, request, make, tokenFor, domain: d.data };
}

for (const mode of ['merge', 'replace']) test(`M1 ${mode} forwards only reviewed keys; anonymous next/token/redirect_uri are discarded`, async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close());
  await createLink(env, domain, { target_url: 'https://example.org/page?utm_medium=stored', query_mode: mode });
  const response = await visit(env, '/docs?utm_source=one&utm_source=two&utm_medium=visitor&next=https://untrusted.example/&redirect_uri=https://untrusted.example/&token=x&UTM_SOURCE=wrong&unknown=y');
  assert.equal(response.status, 301);
  const u = new URL(response.headers.get('location')); assert.deepEqual(u.searchParams.getAll('utm_source'), ['one', 'two']);
  assert.equal(u.searchParams.get('utm_medium'), mode === 'merge' ? 'stored' : 'visitor');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['utm_medium','utm_source','utm_source']);
});
for (const target of ['https://bank.example/login', 'https://id.example/oauth2/authorize?client_id=123', 'https://id.example/%6Cogin', 'https://id.example/reset?token=example-secret', 'https://example.org/page?next=%2Fhome', 'https://example.org/#/callback?code=fixture']) test(`M1 sensitive target ${new URL(target).pathname} requires discard at writes`, async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const before = auditCount(env);
  for (const mode of ['merge', 'replace']) {
    const r = await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'protected', target_url: target, query_mode: mode });
    assert.equal(r.status, 400); assert.equal(r.error.code, 'unsafe_query_mode');
  }
  assert.equal(auditCount(env), before);
  const link = await createLink(env, domain, { slug: 'protected', target_url: target, query_mode: 'discard' });
  assert.equal((await visit(env, '/protected?next=https://untrusted.example/&utm_source=incoming')).headers.get('location'), link.target_url);
});
test('M1 legacy unsafe modes behave as discard without changing the saved link or fixed secret parameters', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const link = await createLink(env, domain);
  for (const mode of ['merge', 'replace']) {
    const target = 'https://bank.example/reset?token=fixture-token';
    env.DB.sqlite.prepare('UPDATE links SET target_url=?,query_mode=? WHERE id=?').run(target, mode, link.id);
    const old = snapshot(env), audit = auditCount(env);
    const response = await visit(env, '/docs?extra=1&token=attacker&utm_source=visitor');
    assert.equal(response.headers.get('location'), target); assert.deepEqual(snapshot(env), old); assert.equal(auditCount(env), audit);
  }
});
test('M1 sensitive-target detection covers mixed-case keys and SPA fragments', () => {
  for (const url of ['https://example.org/?reDirect_URI=x', 'https://example.org/?access-token=x', 'https://example.org/#id_token=x', 'https://example.org/api/authorize', 'https://example.org/signin.html']) assert.equal(sensitiveTarget(url), true, url);
  for (const url of ['https://example.org/docs?utm_source=release', 'https://example.org/blog#section', 'https://example.org/author']) assert.equal(sensitiveTarget(url), false, url);
});
test('M1 empty/restricted allowlists reject malformed configuration rather than widening forwarding', () => {
  for (const value of ['not json', '{}', '["next"]', '["redirect_uri"]', '["utm_source","utm_source"]', '[42]', '["UTM_SOURCE"]', '["bad-name"]']) assert.throws(() => securityPolicy({ QUERY_FORWARD_ALLOWLIST: value }), e => e.code === 'security_policy_invalid');
  const p = securityPolicy({ QUERY_FORWARD_ALLOWLIST: '[]' }); assert.deepEqual(p.queryKeys, []);
  assert.equal(buildTarget('https://example.org/', new URL('https://go.example.com/a?utm_source=x'), 'merge', p.queryKeys), 'https://example.org/');
});
test('M1 import and PATCH cannot bypass sensitive query policy or leave success audits on rejection', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const link = await createLink(env, domain);
  const old = snapshot(env), before = auditCount(env);
  const p = await call(env, '/links/' + link.id, 'PATCH', { version: 1, target_url: 'https://id.example/login', query_mode: 'replace' }); assert.equal(p.error.code, 'unsafe_query_mode');
  const r = await call(env, '/links/import', 'POST', { links: [
    { domain_id: domain.id, slug: 'safe', target_url: 'https://example.org/' },
    { domain_id: domain.id, slug: 'sensitive', target_url: 'https://id.example/login', query_mode: 'merge' },
  ] });
  assert.equal(r.error.code, 'unsafe_query_mode'); assert.deepEqual(snapshot(env), old); assert.equal(auditCount(env), before);
});
test('M1 forwarding filters control characters and bounds the final Location', () => {
  const incoming = new URL('https://go.example.com/a?utm_source=%0d%0aTest&next=%0d%0aX');
  assert.equal(buildTarget('https://example.org/', incoming, 'merge'), 'https://example.org/');
  assert.throws(() => buildTarget('https://example.org/' + 'a'.repeat(4090), new URL('https://go.example.com/a?utm_source=' + 'x'.repeat(6000)), 'merge'), e => e.status === 414);
});

test('M2 actual signed Editor session can read team links but mutate only its own', async t => {
  const f = await rolesFixture(t); const own = await f.make('editor', 'own'), foreign = await f.make('other', 'foreign');
  const session = await f.request('editor', '/session'); assert.equal(session.data.link_write_scope, 'owned');
  assert.equal((await f.request('editor', '/links')).data.total, 2);
  const before = auditCount(f.env);
  for (const method of ['PATCH', 'DELETE']) {
    const result = await f.request('editor', '/links/' + foreign.id + (method === 'DELETE' ? '?version=1' : ''), method, method === 'PATCH' ? { version: 1, target_url: 'https://example.net/' } : undefined);
    assert.equal(result.status, 403); assert.equal(result.error.code, 'link_owner_required');
  }
  assert.equal(auditCount(f.env), before);
  const update = await f.request('editor', '/links/' + own.id, 'PATCH', { version: 1, title: 'Own edit' }); assert.equal(update.status, 200);
  assert.equal((await f.request('editor', '/links/' + own.id + '?version=2', 'DELETE')).status, 200);
});
for (const role of ['owner', 'admin']) test(`M2 interactive ${role} retains cross-user administration`, async t => {
  const f = await rolesFixture(t), link = await f.make('other', 'foreign');
  assert.equal((await f.request(role, '/session')).data.link_write_scope, 'workspace');
  assert.equal((await f.request(role, '/links/' + link.id, 'PATCH', { version: 1, title: 'Managed' })).status, 200);
  assert.equal((await f.request(role, '/links/' + link.id + '?version=2', 'DELETE')).status, 200);
});
for (const role of ['owner', 'admin', 'editor']) test(`M2 ${role} bearer plus real service JWT remains ownership-limited`, async t => {
  const f = await rolesFixture(t), token = await f.tokenFor(role), foreign = await f.make('other', 'foreign'), own = await f.make(role, 'own');
  assert.equal((await f.request(token, '/session')).data.link_write_scope, 'owned');
  assert.equal((await f.request(token, '/links')).status, 200);
  const before = auditCount(f.env);
  assert.equal((await f.request(token, '/links/' + foreign.id, 'PATCH', { version: 1, title: 'No' })).status, 403);
  assert.equal((await f.request(token, '/links/' + foreign.id + '?version=1', 'DELETE')).status, 403);
  assert.equal(auditCount(f.env), before);
  assert.equal((await f.request(token, '/links/' + own.id, 'PATCH', { version: 1, title: 'Yes' })).status, 200);
});
for (const action of ['enable', 'disable', 'delete']) test(`M2 bulk ${action} reports foreign items without writing them or auditing success`, async t => {
  const f = await rolesFixture(t), own = await f.make('editor', 'own'), foreign = await f.make('other', 'foreign');
  const before = auditCount(f.env);
  const result = await f.request('editor', '/links/bulk', 'POST', { action, items: [{ id: own.id, version: 1 }, { id: foreign.id, version: 1 }] });
  assert.equal(result.status, 200); assert.deepEqual(result.data.results, [{ id: own.id, ok: true }, { id: foreign.id, ok: false, forbidden: true }]);
  assert.equal(auditCount(f.env), before + 1); assert.equal((await f.request('editor', '/links/' + foreign.id)).data.version, 1);
});
test('M2 null-owner legacy links need interactive administrators; clients cannot assign created_by', async t => {
  const f = await rolesFixture(t), own = await f.make('editor', 'own');
  f.env.DB.sqlite.prepare('UPDATE links SET created_by=NULL WHERE id=?').run(own.id);
  assert.equal((await f.request('editor', '/links/' + own.id, 'PATCH', { version: 1, title: 'No' })).status, 403);
  const token = await f.tokenFor('owner'); assert.equal((await f.request(token, '/links/' + own.id + '?version=1', 'DELETE')).status, 403);
  const newLink = await f.request('editor', '/links', 'POST', { domain_id: f.domain.id, slug: 'spoof', target_url: 'https://example.org/', created_by: f.users.owner.id }); assert.equal(newLink.error.code, 'unknown_field');
  assert.equal((await f.request('owner', '/links/' + own.id, 'PATCH', { version: 1, title: 'Repair' })).status, 200);
});
for (const method of ['PATCH', 'DELETE', 'bulk']) test(`M2 ${method} repeats ownership inside conditional SQL to block a race`, async t => {
  const f = await rolesFixture(t), own = await f.make('editor', 'own'), before = auditCount(f.env);
  const original = f.env.DB.batch.bind(f.env.DB); let raced = false;
  f.env.DB.batch = async statements => {
    if (!raced && /^(?:UPDATE|DELETE FROM) links/.test(statements[0]?.sql ?? '')) {
      raced = true; f.env.DB.sqlite.prepare('UPDATE links SET created_by=? WHERE id=?').run(f.users.other.id, own.id);
    }
    return original(statements);
  };
  const result = method === 'bulk' ? await f.request('editor', '/links/bulk', 'POST', { action: 'delete', items: [{ id: own.id, version: 1 }] }) : await f.request('editor', '/links/' + own.id + (method === 'DELETE' ? '?version=1' : ''), method, method === 'PATCH' ? { version: 1, title: 'Race' } : undefined);
  assert.equal(raced, true);
  if (method === 'bulk') assert.deepEqual(result.data.results, [{ id: own.id, ok: false, conflict: true }]); else assert.equal(result.status, 409);
  assert.equal((await f.request('owner', '/links/' + own.id)).data.version, 1); assert.equal(auditCount(f.env), before);
});
test('M2 import ownership is assigned from the authenticated editor, and Viewer still cannot write', async t => {
  const f = await rolesFixture(t);
  const result = await f.request('editor', '/links/import', 'POST', { links: [{ domain_id: f.domain.id, slug: 'imported', target_url: 'https://example.org/' }] }); assert.equal(result.status, 201);
  assert.equal((await f.request('editor', '/links/' + result.data.ids[0])).data.created_by, f.users.editor.id);
  assert.equal((await f.request('viewer', '/links/' + result.data.ids[0], 'PATCH', { version: 1, enabled: false })).status, 403);
});

test('M3 429 is returned before any D1 lookup, with no analytics and no HEAD body', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); await createLink(env, domain);
  let events = 0; env.ANALYTICS_ENABLED = 'true'; env.ANALYTICS = { writeDataPoint() { events++; } };
  env.REDIRECT_LIMITER = { limit: async () => ({ success: false }) };
  for (const path of ['/docs', '/guessed-slug', '/bad/path', '/health']) for (const method of ['GET', 'HEAD']) {
    env.DB.queries = []; const response = await visit(env, path, method);
    assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60'); assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('location'), null); assert.equal(env.DB.queries.length, 0);
    if (method === 'HEAD') assert.equal(await response.text(), '');
  }
  assert.equal(events, 0);
});
test('M3 missing or failed production limiter fails closed before the database', async () => {
  const db = { prepare() { throw new Error('must never query'); } };
  for (const limiter of [undefined, { limit: async () => { throw new Error('limiter outage'); } }]) {
    const response = await visit({ ENVIRONMENT: 'production', DB: db, REDIRECT_LIMITER: limiter });
    assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '5'); assert.equal(response.headers.get('location'), null);
  }
});
test('M3 hashed trusted-IP keys are stable across slug/query/host changes and ignore XFF', async t => {
  const { env } = await setup(); t.after(() => env.DB.close()); const keys = [];
  env.REDIRECT_LIMITER = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
  await visit(env, '/one?a=1', 'GET', { headers: { 'CF-Connecting-IP': '203.0.113.20', 'X-Forwarded-For': '1.2.3.4' } });
  await redirect.fetch(new Request('https://different.example.com/two?a=9', { headers: { 'CF-Connecting-IP': '203.0.113.20', 'X-Forwarded-For': '5.6.7.8' } }), env);
  await visit(env, '/one', 'GET', { headers: { 'CF-Connecting-IP': '203.0.113.21' } });
  assert.equal(keys[0], keys[1]); assert.notEqual(keys[0], keys[2]); for (const key of keys) assert.match(key, /^redirect:[0-9a-f]{64}$/);
});

test('L1 direct SQL changes cannot target admin/managed hosts, even trailing-dot, other ports or disabled domains', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const link = await createLink(env, domain);
  const other = await call(env, '/domains', 'POST', { hostname: 's.example.com', enabled: false }); assert.equal(other.status, 201);
  for (const target of ['http://127.0.0.1:8787/', 'https://go.example.com/other', 'http://go.example.com.:8080/other', 'https://s.example.com/', 'http://s.example.com./']) {
    env.DB.sqlite.prepare('UPDATE links SET target_url=? WHERE id=?').run(target, link.id);
    const response = await visit(env); assert.equal(response.status, 503, target); assert.equal(response.headers.get('location'), null);
  }
});
test('L1 write policy canonicalizes trailing-dot targets so managed chains cannot be stored', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close());
  const r = await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'chain', target_url: 'https://go.example.com./elsewhere' });
  assert.equal(r.status, 400); assert.equal(r.error.code, 'redirect_chain');
});
for (const address of ['10.1.2.3', '172.16.1.2', '192.168.1.2', '169.254.169.254', '100.64.1.1', '127.0.0.2', '2130706433', '0x7f000001', '0177.0.0.1', '[::1]', '[fc00::1]', '[fe80::1]', '[::ffff:192.168.1.2]', '[64:ff9b::c0a8:101]', '[2002:c0a8:101::1]', '[2001::1]', '[2001:0:0:1::1]', '[2001:db8::1]', 'metadata.google.internal', 'printer.local', 'intranet']) test(`L2 private/local target ${address} is denied at creation and at redirect`, async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const target = `http://${address}/`;
  const result = await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'private', target_url: target }); assert.equal(result.status, 400, JSON.stringify(result.body));
  const link = await createLink(env, domain); env.DB.sqlite.prepare('UPDATE links SET target_url=? WHERE id=?').run(target, link.id);
  const response = await visit(env); assert.equal(response.status, 503); assert.equal(response.headers.get('location'), null);
});
test('L2 exact private exception is administrator deployment policy, not link-controlled or a wildcard', async t => {
  const { env, domain } = await setup({ PRIVATE_TARGET_ALLOWLIST: '["192.168.1.20"]' }); t.after(() => env.DB.close());
  await createLink(env, domain, { target_url: 'https://192.168.1.20:8443/path' }); assert.equal((await visit(env)).status, 301);
  const r = await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'different', target_url: 'http://192.168.1.21/' }); assert.equal(r.error.code, 'private_target');
  for (const raw of ['["*.local"]', '["10.0.0.0/8"]', '["a.example:443"]', '["EXAMPLE.COM"]']) assert.throws(() => securityPolicy({ PRIVATE_TARGET_ALLOWLIST: raw }), e => e.status === 503);
  const forged = await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'forged', target_url: 'https://example.org/', private_target_allowlist: ['192.168.1.21'] }); assert.equal(forged.error.code, 'unknown_field');
});
test('L2 exact exceptions never bypass administration-host or managed-domain prohibitions', async t => {
  const { env, domain } = await setup({ PRIVATE_TARGET_ALLOWLIST: '["127.0.0.1","go.example.com"]' }); t.after(() => env.DB.close());
  for (const target of ['http://127.0.0.1/', 'https://go.example.com/']) {
    const r = await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'denied', target_url: target }); assert.equal(r.status, 400);
  }
});
test('L2 public literal and DNS targets still work without probing their destination', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const original = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('destination must not be fetched'); }; t.after(() => { globalThis.fetch = original; });
  for (const [i, target] of ['https://8.8.8.8/', 'https://[2606:4700:4700::1111]/', 'https://example.org/'].entries()) {
    const link = await createLink(env, domain, { slug: 'public-' + i, target_url: target }); assert.equal((await visit(env, '/' + link.slug)).status, 301);
    assert.equal(isPrivateTarget(new URL(targetURL(target)).hostname), false);
  }
});
test('L3 expired links default to indistinguishable 404; explicit 410 compatibility remains available', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); await createLink(env, domain, { expires_at: 1 });
  const expired = await visit(env), unknown = await visit(env, '/unknown'); assert.equal(expired.status, 404); assert.equal(await expired.text(), await unknown.text());
  env.EXPIRED_LINK_STATUS = '410'; assert.equal((await visit(env)).status, 410);
  const head = await visit(env, '/docs', 'HEAD'); assert.equal(head.status, 410); assert.equal(await head.text(), '');
});
test('L4/L5 compatibility: distinct-case slugs and explicit bounded cache TTL are preserved', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close());
  await createLink(env, domain, { slug: 'Hello', cache_ttl: 30 }); await createLink(env, domain, { slug: 'hello', redirect_code: 302 });
  const a = await visit(env, '/Hello'), b = await visit(env, '/hello'); assert.equal(a.status, 301); assert.equal(b.status, 302);
  assert.match(a.headers.get('cache-control'), /private, max-age=30/); assert.match(b.headers.get('cache-control'), /no-store/);
});
test('I1 multiline text stays data in JSON/CSV and does not create response headers', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const title = 'Notes\r\nX-Injected: test\tvalue';
  const link = await createLink(env, domain, { title, description: 'first\nsecond' });
  assert.equal(link.title, title); const response = await visit(env); assert.equal(response.headers.get('X-Injected'), null);
  assert.equal(parseCSV(exportCSV([link]))[0].title, title);
});
test('I2 production /health remains private without relying on the front-door Access application', async t => {
  const f = await rolesFixture(t);
  assert.equal((await admin.fetch(new Request(f.env.ADMIN_ORIGIN + '/health'), f.env)).status, 401);
  assert.equal((await admin.fetch(new Request('https://wrong.example.com/health'), f.env)).status, 421);
  for (const method of ['GET', 'HEAD']) {
    const response = await admin.fetch(new Request(f.env.ADMIN_ORIGIN + '/health', { method, headers: f.browser.owner.headers }), f.env); assert.equal(response.status, 200);
    if (method === 'HEAD') assert.equal(await response.text(), '');
  }
});
test('I3 user cleanup remains disable-only and preserves the user record/audit history', async t => {
  const f = await rolesFixture(t), id = f.users.editor.id;
  assert.equal((await f.request('owner', '/users/' + id, 'DELETE')).status, 404);
  assert.equal((await f.request('owner', '/users/' + id, 'PATCH', { version: 1, enabled: false })).status, 200);
  assert.equal(f.env.DB.sqlite.prepare('SELECT enabled FROM users WHERE id=?').get(id).enabled, 0);
});

for (const code of [301, 302, 303, 307, 308]) test(`H5.1 Node guard rejects JWKS/Analytics ${code} without accepting a successful-looking body`, async t => {
  const issuer = `https://no-redirect-${code}.cloudflareaccess.com`; let calls = 0;
  await assert.rejects(() => jwt(issuer).then(value => verifyAccess(value, issuer, aud, async (_url, opts) => {
    calls++; assert.equal(opts.redirect, 'manual'); return new Response(JSON.stringify({ keys: [jwk] }), { status: code, headers: { location: 'https://untrusted.example/keys' } });
  })), e => e.status === 503); assert.equal(calls, 1);
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, opts) => { assert.equal(opts.redirect, 'manual'); return new Response('{"data":[]}', { status: code, headers: { location: 'https://untrusted.example/' } }); };
  await assert.rejects(() => queryAnalytics({ ANALYTICS_ENABLED: 'true', ANALYTICS_DATASET: 'test', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), ANALYTICS_API_TOKEN: 'fixture' }, 'SELECT 1'), e => e.status === 502);
});
test('runtime fixture is not deployed as an entry point', async () => {
  const a = JSON.parse(readFileSync(new URL('../apps/admin/wrangler.jsonc', import.meta.url))), r = JSON.parse(readFileSync(new URL('../apps/redirect/wrangler.jsonc', import.meta.url)));
  assert.equal(a.main, 'src/worker/index.ts'); assert.equal(r.main, 'src/index.ts');
});
