import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, setup, call, createLink, admin } from './harness.mjs';
import { newToken, sha256 } from '../.build/packages/shared/src/crypto.js';
async function scopedToken(env, role, scopes) {
  const id = crypto.randomUUID(); const now = Math.floor(Date.now() / 1000); const token = newToken();
  await env.DB.prepare('INSERT INTO users(id,email,role,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id, `${id}@example.org`, role, now, now).run();
  await env.DB.prepare('INSERT INTO api_tokens(id,user_id,name,token_hash,prefix,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), id, 'test', await sha256(token), token.slice(0, 12), JSON.stringify(scopes), now + 300, now).run();
  return { id, token, options: { headers: { Authorization: `Bearer ${token}` }, noDev: true } };
}
test('bootstrap requires a local secret; unknown host and production bypasses are blocked', async t => {
  const env = environment(); t.after(() => env.DB.close());
  assert.equal((await call(env, '/session', 'GET', undefined, { noDev: true })).status, 401);
  assert.equal((await call(env, '/session', 'GET', undefined, { url: 'http://evil.example/Linro/v1/session' })).status, 421);
  env.ENVIRONMENT = 'production'; env.ADMIN_ORIGIN = 'https://admin.example.com';
  assert.equal((await call(env, '/session')).status, 401);
  const asset = await admin.fetch(new Request(env.ADMIN_ORIGIN + '/assets/main.js'), env); assert.equal(asset.status, 401);
  const fallback = await admin.fetch(new Request(env.ADMIN_ORIGIN + '/anything'), env); assert.equal(fallback.status, 401);
});
test('CRUD returns a stable shape and optimistic version conflicts do not overwrite newer data', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const link = await createLink(env, domain);
  assert.equal(link.short_url, 'https://go.example.com/docs'); assert.equal(link.version, 1);
  assert.equal((await call(env, '/links/' + link.id, 'PATCH', { title: 'New', version: 1 })).status, 200);
  const stale = await call(env, '/links/' + link.id, 'PATCH', { title: 'Stale', version: 1 }); assert.equal(stale.status, 409);
  assert.equal((await call(env, '/links/' + link.id)).data.title, 'New');
  assert.equal((await call(env, '/links/' + link.id, 'PATCH', { title: 'Missing version' })).status, 400);
  assert.equal((await call(env, '/links/' + link.id + '?version=1', 'DELETE')).status, 409);
});
test('duplicates conflict, same slug on another host is allowed, and random codes are bounded', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); await createLink(env, domain);
  assert.equal((await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'docs', target_url: 'https://example.net/' })).status, 409);
  const second = await call(env, '/domains', 'POST', { hostname: 's.example.com' }); assert.equal(second.status, 201);
  assert.equal((await createLink(env, second.data)).slug, 'docs');
  const auto = await createLink(env, domain, { slug: '' }); assert.match(auto.slug, /^[A-Za-z0-9]{8}$/);
});
test('hostnames, protocols, credentials, reserved slugs and mass assignment are rejected', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close());
  for (const target of ['javascript:alert(1)', 'data:text/plain,test', '//example.org', 'https://a:b@example.org/', 'https://example.org/%0d%0aX-Test:yes', 'https:\\evil.example', ' https://example.org/']) {
    assert.equal((await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'bad', target_url: target })).status, 400, target);
  }
  for (const slug of ['HEALTH', 'a/b', '你好', '%41', '..', 'x'.repeat(65)]) assert.equal((await call(env, '/links', 'POST', { domain_id: domain.id, slug, target_url: 'https://example.org/' })).status, 400, slug);
  for (const hostname of ['https://go.example.org', 'go.example.org:443', 'go.example.org.', '-a.example.org', '192.0.2.1']) assert.equal((await call(env, '/domains', 'POST', { hostname })).status, 400, hostname);
  assert.equal((await call(env, '/links', 'POST', { domain_id: domain.id, target_url: 'https://example.org/', created_by: 'attacker' })).status, 400);
});
test('managed destination chains and domain conversion of existing destinations are rejected', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close());
  assert.equal((await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'chain', target_url: 'https://go.example.com/other' })).status, 400);
  assert.equal((await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'admin', target_url: 'http://127.0.0.1:8787/' })).status, 400);
  await createLink(env, domain); assert.equal((await call(env, '/domains', 'POST', { hostname: 'example.org' })).status, 409);
});
test('LIKE wildcard characters and SQL fragments stay data; pagination is bounded', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); await createLink(env, domain);
  for (const q of ['%', '_', "' OR 1=1 --"]) { const result = await call(env, '/links?q=' + encodeURIComponent(q)); assert.equal(result.status, 200); assert.equal(result.data.total, 0); }
  const result = await call(env, '/links?q=docs&limit=1'); assert.equal(result.data.total, 1); assert.equal(result.data.items.length, 1);
  assert.equal((await call(env, '/links?limit=101')).status, 400); assert.equal((await call(env, '/links?page=0')).status, 400);
});
test('a failing import batch rolls back every insert and its audit events', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); await createLink(env, domain);
  const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_logs').first();
  const result = await call(env, '/links/import', 'POST', { links: [
    { domain_id: domain.id, slug: 'new-in-batch', target_url: 'https://example.net/1' },
    { domain_id: domain.id, slug: 'docs', target_url: 'https://example.net/2' },
  ] });
  assert.equal(result.status, 409); assert.equal((await call(env, '/links?q=new-in-batch')).data.total, 0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_logs').first()).n, before.n);
});
test('full import stays below 50 D1 statements, and oversized imports are rejected', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close());
  const links = Array.from({ length: 10 }, (_, i) => ({ domain_id: domain.id, slug: `bulk${i}`, target_url: 'https://example.net/' + i }));
  env.DB.queries = []; const result = await call(env, '/links/import', 'POST', { links }); assert.equal(result.status, 201); assert.ok(env.DB.queries.length <= 50, String(env.DB.queries.length));
  assert.equal((await call(env, '/links/import', 'POST', { links: [...links, links[0]] })).status, 400);
});
test('bulk operations report per-item version conflicts without false audit entries', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const a = await createLink(env, domain); const b = await createLink(env, domain, { slug: 'second' });
  const result = await call(env, '/links/bulk', 'POST', { action: 'disable', items: [{ id: a.id, version: 1 }, { id: b.id, version: 99 }] });
  assert.equal(result.status, 200); assert.equal(result.data.results[0].ok, true); assert.equal(result.data.results[1].ok, false);
  assert.equal((await call(env, '/links/' + a.id)).data.enabled, 0); assert.equal((await call(env, '/links/' + b.id)).data.enabled, 1);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='disable'").first()).n, 1);
});
test('last enabled owner is protected in SQL, not just the API', async t => {
  const { env, user } = await setup(); t.after(() => env.DB.close());
  assert.equal((await call(env, '/users/' + user.id, 'PATCH', { enabled: false, version: 1 })).status, 409);
  assert.equal((await call(env, '/users/' + user.id, 'PATCH', { role: 'viewer', version: 1 })).status, 409);
  await assert.rejects(() => env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.id).run(), /last_enabled_owner/);
  const other = await call(env, '/users', 'POST', { email: 'second@example.com', role: 'owner' }); assert.equal(other.status, 201);
  assert.equal((await call(env, '/users/' + other.data.id, 'PATCH', { enabled: false, version: 1 })).status, 200);
  assert.equal((await call(env, '/users/' + user.id, 'PATCH', { enabled: false, version: 1 })).status, 409);
});
test('API tokens are one-time, hashed, least-privilege, revocable, and cannot mint tokens', async t => {
  const { env } = await setup(); t.after(() => env.DB.close());
  const created = await call(env, '/tokens', 'POST', { name: 'read only', scopes: ['links:read'], expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert.equal(created.status, 201); const token = created.data.token; assert.match(token, /^Linro_[\w-]{43}$/);
  const stored = await env.DB.prepare('SELECT * FROM api_tokens WHERE id=?').bind(created.data.id).first(); assert.equal(stored.token_hash, await sha256(token)); assert.ok(!JSON.stringify(stored).includes(token));
  const list = await call(env, '/tokens'); assert.ok(!JSON.stringify(list.data).includes(token)); assert.ok(!JSON.stringify(list.data).includes(stored.token_hash));
  const options = { noDev: true, headers: { Authorization: `Bearer ${token}` } };
  assert.equal((await call(env, '/links', 'GET', undefined, options)).status, 200);
  assert.equal((await call(env, '/links', 'POST', {}, options)).status, 403);
  assert.equal((await call(env, '/tokens', 'POST', {}, options)).status, 403);
  await call(env, '/tokens/' + created.data.id, 'DELETE'); assert.equal((await call(env, '/links', 'GET', undefined, options)).status, 401);
});
test('token permissions intersect current user role, and disabling a user blocks existing tokens', async t => {
  const { env } = await setup(); t.after(() => env.DB.close()); const actor = await scopedToken(env, 'editor', ['links:read', 'links:write']);
  assert.equal((await call(env, '/links', 'GET', undefined, actor.options)).status, 200);
  await env.DB.prepare("UPDATE users SET role='viewer' WHERE id=?").bind(actor.id).run();
  assert.equal((await call(env, '/links', 'POST', {}, actor.options)).status, 403);
  await env.DB.prepare('UPDATE users SET enabled=0 WHERE id=?').bind(actor.id).run();
  assert.equal((await call(env, '/links', 'GET', undefined, actor.options)).status, 401);
});
test('Viewer cannot edit; token administrative scopes and domain deletion with links are blocked', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); await createLink(env, domain);
  const viewer = await scopedToken(env, 'viewer', ['links:read', 'links:write', 'users:write']);
  assert.equal((await call(env, '/users', 'GET', undefined, viewer.options)).status, 403);
  assert.equal((await call(env, '/domains', 'POST', { hostname: 'x.example.com' }, viewer.options)).status, 403);
  assert.equal((await call(env, '/tokens', 'POST', { name: 'bad', scopes: ['users:write'], expires_at: Math.floor(Date.now() / 1000) + 3600 })).status, 403);
  assert.equal((await call(env, '/domains/' + domain.id + '?version=1', 'DELETE')).status, 409);
});
test('rate limits fail closed; API misses remain JSON and cannot fall into SPA', async t => {
  const { env } = await setup(); t.after(() => env.DB.close());
  const missing = await call(env, '/no-such-endpoint'); assert.equal(missing.status, 404); assert.equal(missing.body.ok, false);
  env.WRITE_LIMITER = { limit: async () => ({ success: false }) };
  const write = await call(env, '/links', 'POST', {}); assert.equal(write.status, 429); assert.equal(write.response.headers.get('retry-after'), '60');
  env.AUTH_LIMITER = { limit: async () => ({ success: false }) }; assert.equal((await call(env, '/session')).status, 429);
});
test('audit redacts target query/fragment and never records token contents', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); await createLink(env, domain, { target_url: 'https://example.org/docs?access_token=top-secret#private-fragment' });
  const audits = await call(env, '/audit'); const value = JSON.stringify(audits.data); assert.doesNotMatch(value, /top-secret|private-fragment/); assert.match(value, /redacted/);
});
test('request body enforces JSON type and actual streamed size, not Content-Length alone', async t => {
  const { env } = await setup(); t.after(() => env.DB.close());
  const request = (body, headers = {}) => new Request(env.ADMIN_ORIGIN + '/Linro/v1/links', { method: 'POST', headers: { 'X-Linro-Dev': env.LOCAL_DEV_TOKEN, ...headers }, body });
  assert.equal((await admin.fetch(request('{}', { 'Content-Type': 'text/plain' }), env)).status, 415);
  assert.equal((await admin.fetch(request('{', { 'Content-Type': 'application/json' }), env)).status, 400);
  assert.equal((await admin.fetch(request(JSON.stringify({ text: 'x'.repeat(270000) }), { 'Content-Type': 'application/json', 'Content-Length': '1' }), env)).status, 413);
});
test('unconfigured analytics returns unavailable, not a fabricated zero count', async t => {
  const { env } = await setup(); t.after(() => env.DB.close()); const result = await call(env, '/stats'); assert.equal(result.status, 200); assert.equal(result.data.available, false); assert.equal(result.data.clicks, undefined);
});
