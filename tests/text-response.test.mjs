import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SQLiteD1 } from './harness.mjs';
import { featureFixture, call, createLink, patch, row, count, request, unlock, cookie, PASSWORD, noTarget } from './feature-helpers.mjs';
import { exportCSV, parseCSV } from '../.build/apps/admin/src/web/csv.js';
const content = '第一行\r\nsecond line\n<script>alert("not executed")</script>\t结束';
const textLink = (env, domain, values = {}) => createLink(env, domain, { response_mode: 'text', target_url: undefined, text_content: content, ...values });

for (const kv of [false, true]) {
  test(`text GET/HEAD return literal UTF-8 200 with no Location or cache; kv=${kv}`, async t => {
    const { env, domain, kv: cache } = await featureFixture(t, { kv }); const link = await textLink(env, domain, { cache_ttl: 3600 });
    const oldFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('Must not fetch a text body or a target'); }; t.after(() => { globalThis.fetch = oldFetch; });
    const response = await request(env, '/docs?next=https://example.net/'); await noTarget(response, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /object-src 'none'/); assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
    assert.equal(await response.text(), content); const head = await request(env, '/docs', { method: 'HEAD' }); await noTarget(head, 200); assert.equal(await head.text(), '');
    assert.equal(count(env, link.id), 0); assert.equal(row(env, link.id).target_url, 'about:blank');
    if (cache) { assert.equal(cache.values.size, 0); assert.ok(cache.operations.every(op => !JSON.stringify(op).includes(content))); }
  });
  test(`text passwords/cookies and revisions protect literal body before quota; kv=${kv}`, async t => {
    const events = []; const { env, domain } = await featureFixture(t, { kv, ANALYTICS_ENABLED: 'true', ANALYTICS: { writeDataPoint: event => events.push(event) } });
    const link = await textLink(env, domain, { password: PASSWORD, max_redirects: 3 });
    const page = await request(env); await noTarget(page, 200); assert.ok(!(await page.text()).includes('not executed'));
    assert.equal((await unlock(env, 'docs', 'wrong')).status, 401); assert.equal(count(env, link.id), 0); assert.equal(events.length, 0);
    const login = await unlock(env, 'docs', PASSWORD, { origin: 'null', 'sec-fetch-site': 'same-origin' }); assert.equal(login.status, 303); assert.equal(count(env, link.id), 0);
    const authorization = cookie(login); assert.ok(authorization); const response = await request(env, '/docs', { headers: { cookie: authorization } }); assert.equal(await response.text(), content); assert.equal(count(env, link.id), 1); assert.equal(events.length, 1);
    await patch(env, link, { text_content: 'changed protected text' });
    const stale = await request(env, '/docs', { headers: { cookie: authorization } }); assert.equal(stale.status, 200); assert.ok(!(await stale.text()).includes('changed protected text')); assert.equal(count(env, link.id), 1);
    const head = await request(env, '/docs', { method: 'HEAD' }); assert.equal(head.headers.get('location'), null); assert.equal(await head.text(), ''); assert.equal(events.length, 1);
  });
  test(`text quota is atomic under 60 concurrent GETs plus HEAD; kv=${kv}`, async t => {
    const { env, domain } = await featureFixture(t, { kv }); const link = await textLink(env, domain, { max_redirects: 7 });
    const head = await request(env, '/docs', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(count(env, link.id), 1);
    const results = await Promise.all(Array.from({ length: 60 }, () => request(env, '/docs?_Linro_lang=zh-CN')));
    assert.equal(results.filter(r => r.status === 200).length, 6); assert.equal(results.filter(r => r.status === 403).length, 54); assert.equal(count(env, link.id), 7);
    for (const result of results.filter(r => r.status === 403)) { assert.equal(await result.text(), '此链接请求次数已到达上限，请联系管理员'); assert.equal(result.headers.get('location'), null); }
    await patch(env, link, { max_redirects: 10, text_content: 'modified' }); assert.equal(count(env, link.id), 7);
    await patch(env, link, { reset_redirect_count: true }); assert.equal(count(env, link.id), 0); assert.equal(await (await request(env)).text(), 'modified');
  });
}
test('mode changes cannot use stale KV redirect rules, even if KV deletion fails', async t => {
  const { env, domain, kv } = await featureFixture(t, { kv: true }); const link = await createLink(env, domain); await request(env); const oldEntry = [...kv.values.entries()][0]; assert.ok(oldEntry);
  kv.failDelete = true; await patch(env, link, { response_mode: 'text', text_content: 'only literal text' }); kv.values.set(...oldEntry);
  const response = await request(env); assert.equal(response.status, 200); assert.equal(response.headers.get('location'), null); assert.equal(await response.text(), 'only literal text');
  await patch(env, link, { response_mode: 'redirect', target_url: 'https://example.net/new' }); const redirect = await request(env); assert.equal(redirect.status, 301); assert.equal(redirect.headers.get('location'), 'https://example.net/new'); assert.equal(row(env, link.id).text_content, '');
});
test('direct SQL text edits increment revisions and invalidate old password cookies', async t => {
  const { env, domain } = await featureFixture(t); const link = await textLink(env, domain, { password: PASSWORD }); const auth = cookie(await unlock(env));
  const before = row(env, link.id); env.DB.sqlite.prepare('UPDATE links SET text_content=? WHERE id=?').run('new private body', link.id);
  const after = row(env, link.id); assert.equal(after.version, before.version); assert.equal(after.rule_revision, before.rule_revision + 1);
  const response = await request(env, '/docs', { headers: { cookie: auth } }); assert.ok(!(await response.text()).includes('new private body'));
});
for (const [name, value] of [['empty', ''], ['null', null], ['number', 12], ['array', ['x']], ['too long', 'x'.repeat(16385)], ['too many bytes', '中'.repeat(12000)], ['NUL', 'a\0b'], ['unpaired surrogate', '\ud800']]) {
  test(`text validation rejects ${name} before DB write`, async t => {
    const { env, domain } = await featureFixture(t); const audits = env.DB.sqlite.prepare('SELECT count(*) n FROM audit_logs').get().n;
    const r = await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'bad', response_mode: 'text', text_content: value }); assert.equal(r.status, 400);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM links').get().n, 0); assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM audit_logs').get().n, audits);
  });
}
test('maximum text byte length and whitespace/multiline content are preserved', async t => {
  const { env, domain } = await featureFixture(t); const bytes = 'é'.repeat(16384); await textLink(env, domain, { text_content: bytes }); assert.equal(await (await request(env)).text(), bytes);
});
test('plain text import/export retains content but never leaks it into audit or KV', async t => {
  const { env, domain, kv } = await featureFixture(t, { kv: true }); const body = '=FORMULA("private")\n正文';
  const result = await call(env, '/links/import', 'POST', { links: [{ domain_id: domain.id, slug: 'plain', response_mode: 'text', text_content: body }] }); assert.equal(result.status, 201, JSON.stringify(result.body));
  const link = (await call(env, '/links')).data.items[0]; const csv = exportCSV([link]); const restored = parseCSV(csv)[0]; assert.equal(restored.response_mode, 'text'); assert.equal(restored.text_content, body);
  assert.equal((await call(env, '/links/' + link.id)).data.text_content, body);
  for (const log of env.DB.sqlite.prepare('SELECT details FROM audit_logs').all()) assert.ok(!log.details.includes('private'));
  assert.equal(kv.values.size, 0); const audit = env.DB.sqlite.prepare("SELECT details FROM audit_logs WHERE resource_type='link'").get(); assert.equal(JSON.parse(audit.details).response_mode, 'text');
});
test('text mode refuses geographic rules; switching back requires a valid safe URL', async t => {
  const { env, domain } = await featureFixture(t); const link = await createLink(env, domain, { geo_rules: [{ kind: 'country', code: 'JP', target_url: 'https://example.net/japan' }] });
  const bad = await call(env, '/links/' + link.id, 'PATCH', { version: row(env, link.id).version, response_mode: 'text', text_content: 'text' }); assert.equal(bad.status, 400); assert.equal(bad.error.code, 'text_geo_conflict');
  await patch(env, link, { response_mode: 'text', text_content: 'text', geo_rules: [], query_mode: 'replace' }); assert.equal(row(env, link.id).query_mode, 'discard');
  for (const target of [undefined, 'javascript:alert(1)', 'http://127.0.0.1:8787/', 'http://127.0.0.1/']) {
    const r = await call(env, '/links/' + link.id, 'PATCH', { version: row(env, link.id).version, response_mode: 'redirect', target_url: target }); assert.equal(r.status, 400, JSON.stringify(r.body));
  }
});
test('text write/delete/reset still enforce Editor ownership', async t => {
  const { env, domain, user } = await featureFixture(t); const link = await textLink(env, domain, { max_redirects: 4 });
  const other = (await call(env, '/users', 'POST', { email: 'other@example.com', role: 'owner' })).data;
  env.DB.sqlite.prepare('UPDATE links SET created_by=? WHERE id=?').run(other.id, link.id);
  await call(env, '/users/' + user.id, 'PATCH', { version: user.version, role: 'editor' });
  for (const changes of [{ text_content: 'hijack' }, { response_mode: 'redirect', target_url: 'https://example.net/' }, { reset_redirect_count: true }]) assert.equal((await call(env, '/links/' + link.id, 'PATCH', { version: row(env, link.id).version, ...changes })).status, 403);
  assert.equal((await call(env, '/links/' + link.id + '?version=' + row(env, link.id).version, 'DELETE')).status, 403); assert.equal(await (await request(env)).text(), content);
});
for (const failure of ['disabled', 'expired', 'domain disabled', 'rate limited', 'corrupt text']) {
  test(`text ${failure} neither discloses body nor consumes quota`, async t => {
    const { env, domain } = await featureFixture(t); const link = await textLink(env, domain, { max_redirects: 5 });
    if (failure === 'disabled') await patch(env, link, { enabled: false });
    if (failure === 'expired') env.DB.sqlite.exec("UPDATE links SET expires_at=1");
    if (failure === 'domain disabled') env.DB.sqlite.exec('UPDATE domains SET enabled=0');
    if (failure === 'rate limited') env.REDIRECT_LIMITER = { limit: async () => ({ success: false }) };
    if (failure === 'corrupt text') env.DB.sqlite.exec("UPDATE links SET text_content=''");
    const r = await request(env); assert.ok([404, 429, 503].includes(r.status)); assert.ok(!(await r.text()).includes('not executed')); assert.equal(count(env, link.id), 0);
  });
}
test('0003 preserves all previous columns, including password, quota, owner and default code', () => {
  const db = new SQLiteD1(':memory:', false);
  try {
    for (const name of ['0001_initial.sql', '0002_link_controls.sql']) db.sqlite.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
    db.sqlite.exec("INSERT INTO users(id,email,role,created_at,updated_at) VALUES('u','u@example.com','owner',1,1); INSERT INTO domains(id,hostname,default_redirect_code,created_at,updated_at) VALUES('d','go.example.com',302,1,1); INSERT INTO links(id,domain_id,slug,target_url,created_by,created_at,updated_at,redirect_code,password_hash,max_redirects,redirect_count) VALUES('l','d','x','https://example.net','u',1,1,301,'old-verifier',20,7);");
    const before = { ...db.sqlite.prepare('SELECT * FROM links').get() }; db.sqlite.exec(readFileSync(new URL('../migrations/0003_text_responses.sql', import.meta.url), 'utf8')); const after = db.sqlite.prepare('SELECT * FROM links').get();
    for (const key of Object.keys(before)) assert.equal(after[key], before[key], key); assert.equal(after.response_mode, 'redirect'); assert.equal(after.text_content, '');
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sqlite_master WHERE name=\'links_rule_revision\'').get().n, 1); assert.equal(db.sqlite.prepare('SELECT default_redirect_code n FROM domains').get().n, 302);
    assert.throws(() => db.sqlite.exec("UPDATE links SET response_mode='html'")); assert.throws(() => db.sqlite.exec("UPDATE users SET role='viewer'"));
  } finally { db.close(); }
});

test('leading UTF-8 BOM is preserved as data, not stripped during validation or response encoding', async t => {
  const { env, domain } = await featureFixture(t); const value = '\uFEFF literal body\n';
  await textLink(env, domain, { text_content: value });
  const response = await request(env); assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new TextEncoder().encode(value));
});
