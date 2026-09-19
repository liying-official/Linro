import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, createLink, call, visit, redirect } from './harness.mjs';
for (const code of [301, 302, 307, 308]) test(`returns ${code}, Location and no-store without database writes`, async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close());
  await createLink(env, domain, { redirect_code: code }); env.DB.queries = [];
  const response = await visit(env);
  assert.equal(response.status, code); assert.equal(response.headers.get('location'), 'https://example.org/docs');
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(env.DB.queries.length, 2); assert.ok(env.DB.queries.every(q => /^SELECT/.test(q))); // lookup plus target-policy revalidation
});
test('HEAD has no body and does not record analytics', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); await createLink(env, domain);
  let count = 0; env.ANALYTICS_ENABLED = 'true'; env.ANALYTICS = { writeDataPoint: () => count++ };
  const head = await visit(env, '/docs', 'HEAD'); assert.equal(head.status, 301); assert.equal(await head.text(), ''); assert.equal(count, 0);
  const get = await visit(env); assert.equal(get.status, 301); assert.equal(count, 1);
});
test('disabled domain/link and expired link return 404 by default', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const link = await createLink(env, domain);
  assert.equal((await call(env, '/links/' + link.id, 'PATCH', { enabled: false, version: 1 })).status, 200);
  assert.equal((await visit(env)).status, 404);
  await call(env, '/links/' + link.id, 'PATCH', { enabled: true, expires_at: Math.floor(Date.now() / 1000) - 1, version: 2 });
  assert.equal((await visit(env)).status, 404);
  await call(env, '/links/' + link.id, 'PATCH', { expires_at: null, version: 3 });
  await call(env, '/domains/' + domain.id, 'PATCH', { enabled: false, version: 1 });
  assert.equal((await visit(env)).status, 404);
});
test('edits are visible on the next lookup; deleted links stop redirecting', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const link = await createLink(env, domain);
  assert.equal((await visit(env)).headers.get('location'), link.target_url);
  const update = await call(env, '/links/' + link.id, 'PATCH', { target_url: 'https://example.net/new', version: link.version }); assert.equal(update.status, 200);
  assert.equal((await visit(env)).headers.get('location'), 'https://example.net/new');
  assert.equal((await call(env, `/links/${link.id}?version=2`, 'DELETE')).status, 200); assert.equal((await visit(env)).status, 404);
});
test('case-sensitive slugs, exact host matching and malformed paths fail closed', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); await createLink(env, domain, { slug: 'Docs' });
  assert.equal((await visit(env, '/Docs')).status, 301); assert.equal((await visit(env, '/docs')).status, 404);
  for (const path of ['/Docs/', '/Docs/x', '/%44ocs', '/%ZZ', '/%2fDocs', '/Linro', '/admin', '/a.b']) assert.equal((await visit(env, path)).status, 404, path);
  assert.equal((await redirect.fetch(new Request('https://unknown.example.com/Docs'), env)).status, 404);
});
test('discard, merge destination-wins, and replace reviewed parameter strategies', async t => {
  const { env, domain } = await setup({ QUERY_FORWARD_ALLOWLIST: JSON.stringify(['fixed', 'x']) }); t.after(() => env.DB.close());
  const link = await createLink(env, domain, { target_url: 'https://example.org/?fixed=1&fixed=2#section', query_mode: 'discard' });
  assert.equal((await visit(env, '/docs?fixed=9&x=3&x=4')).headers.get('location'), 'https://example.org/?fixed=1&fixed=2#section');
  await call(env, '/links/' + link.id, 'PATCH', { query_mode: 'merge', version: 1 });
  assert.equal((await visit(env, '/docs?fixed=9&x=3&x=4')).headers.get('location'), 'https://example.org/?fixed=1&fixed=2&x=3&x=4#section');
  await call(env, '/links/' + link.id, 'PATCH', { query_mode: 'replace', version: 2 });
  assert.equal((await visit(env, '/docs?x=3')).headers.get('location'), 'https://example.org/?x=3#section');
  assert.equal((await visit(env)).headers.get('location'), 'https://example.org/#section');
});
test('analytics errors never prevent redirects and no raw IP/UA/query is recorded', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const link = await createLink(env, domain);
  let point; env.ANALYTICS_ENABLED = 'true'; env.ANALYTICS = { writeDataPoint: p => { point = p; } };
  const response = await visit(env, '/docs?secret=123', 'GET', { headers: { 'cf-connecting-ip': '192.0.2.42', 'user-agent': 'Chrome/155.0 secret-agent', referer: 'https://referrer.example/path?secret=456' } });
  assert.equal(response.status, 301); assert.equal(point.indexes[0], link.id); assert.equal(point.blobs[3], 'referrer.example');
  assert.doesNotMatch(JSON.stringify(point), /192\.0\.2|secret|456|155\.0/);
  env.ANALYTICS.writeDataPoint = () => { throw new Error('simulated analytics failure'); };
  assert.equal((await visit(env)).status, 301);
});
test('database failure returns retryable 503, not a misleading 404', async () => {
  const env = { ENVIRONMENT: 'development', DB: { prepare() { throw new Error('database unavailable'); } } };
  const response = await visit(env); assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '5');
});
test('cache lifetime never exceeds expiration and negative/unknown results are no-store', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close());
  await createLink(env, domain, { cache_ttl: 300, expires_at: Math.floor(Date.now() / 1000) + 10 });
  const response = await visit(env); const max = Number(response.headers.get('cache-control').match(/max-age=(\d+)/)[1]); assert.ok(max > 0 && max <= 10);
  assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store');
  assert.match((await visit(env, '/unknown')).headers.get('cache-control'), /no-store/);
});
test('health is independent of D1 and non-GET methods cannot forward request bodies', async () => {
  const env = { ENVIRONMENT: 'development', DB: { prepare() { throw new Error('must not query'); } } };
  assert.equal((await visit(env, '/health')).status, 200); const response = await visit(env, '/docs', 'POST'); assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD');
});
test('direct database corruption and self-loop fail closed', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const link = await createLink(env, domain);
  await env.DB.prepare('UPDATE links SET target_url=? WHERE id=?').bind('javascript:alert(1)', link.id).run(); assert.equal((await visit(env)).status, 503);
  await env.DB.prepare('UPDATE links SET target_url=? WHERE id=?').bind('https://go.example.com/docs', link.id).run(); assert.equal((await visit(env)).status, 503); // shared target policy denies any managed-host chain
});
