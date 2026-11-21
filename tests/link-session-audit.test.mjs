import { testPassword } from './fixture-credentials.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { call, setup, createLink } from './harness.mjs';
import {
  normalizeLinkFields,
  sourceDomainId,
} from '../.build/apps/admin/src/worker/link-fields.js';
import { webController, settled, deferred } from './web-controller.mjs';

test('link fields normalize deterministically without bindings, a clock, a generated identifier or password derivation', () => {
  const domain = {
    id: 'domain-a',
    hostname: 'go.example.com',
    enabled: 1,
    default_redirect_code: 307,
  };
  const settings = Object.freeze({ ADMIN_ORIGIN: 'https://admin.example.com' });
  const input = Object.freeze({
    domain_id: domain.id,
    target_url: 'https://EXAMPLE.org./文',
    password: testPassword,
    geo_rules: [{ kind: 'country', code: 'JP', target_url: 'https://EXAMPLE.net:444/jp' }],
  });
  assert.equal(sourceDomainId(input), domain.id);
  const draft = normalizeLinkFields(input, domain, settings, false);
  assert.deepEqual(draft, normalizeLinkFields(input, domain, settings, false));
  assert.equal(draft.fields.redirect_code, 307);
  assert.equal(draft.fields.slug, null);
  assert.deepEqual(draft.destinationHosts, ['example.org', 'example.net']);
  assert.match(draft.fields.target_url, /%E6%96%87/);
  for (const hidden of ['password', 'password_hash', 'id', 'created_at', 'updated_at'])
    assert.ok(!Object.hasOwn(draft.fields, hidden));
  assert.throws(() => normalizeLinkFields({ ...input, block_vpn: true }, domain, settings, false), {
    code: 'browser_check_unconfigured',
  });
  assert.throws(() => sourceDomainId({ ...input, unrecognized: true }), { code: 'unknown_field' });
});

test('invalid static fields fail before password hashing, and a metadata-only PATCH preserves the existing verifier', async (t) => {
  const { env, domain } = await setup();
  t.after(() => env.DB.close());
  const bad = await call(env, '/links', 'POST', {
    domain_id: domain.id,
    slug: 'bad',
    target_url: 'https://example.org',
    kv_cache_ttl: 42,
    password: testPassword,
  });
  assert.equal(bad.status, 400);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM links').get().n, 0);
  env.LINK_PASSWORD_SECRET = 'p'.repeat(43);
  const link = await createLink(env, domain, { password: testPassword });
  const stored = () =>
    env.DB.sqlite.prepare('SELECT password_hash FROM links WHERE id=?').get(link.id).password_hash;
  const first = stored();
  delete env.LINK_PASSWORD_SECRET;
  const edited = await call(env, '/links/' + link.id, 'PATCH', {
    version: link.version,
    title: 'Changed',
  });
  assert.equal(edited.status, 200);
  assert.equal(stored(), first);
  assert.equal(edited.data.password_protected, true);
});

test('a pending session read cannot replace a newer session or change its navigation', async () => {
  const { module } = webController();
  const { LatestRead } = module('latest-read.ts');
  const { permittedPage } = module('navigation.ts');
  const slow = deferred();
  let requests = 0;
  const received = [];
  const errors = [];
  const loader = new LatestRead();
  const read = () => (++requests === 1 ? slow.promise : Promise.resolve({ user: 'new' }));
  const refresh = () =>
    loader.run(
      read,
      (v) => received.push(v.user),
      (e) => errors.push(e),
    );
  const a = refresh();
  await refresh();
  slow.resolve({ user: 'old' });
  await a;
  assert.deepEqual(received, ['new']);
  assert.deepEqual(errors, []);
  assert.equal(permittedPage('users', ['links:read']), 'dashboard');
  assert.equal(permittedPage('users', ['users:write']), 'users');
});

test('audit cursor pages use the existing ordered index without counting and preserve the legacy exact-count page', async (t) => {
  const { env } = await setup();
  t.after(() => env.DB.close());
  const db = env.DB.sqlite;
  const insert = db.prepare(
    "INSERT INTO audit_logs(id,actor_email,action,resource_type,resource_id,request_id,created_at) VALUES(?,'test@example.com','read','test',?,'fixture',123)",
  );
  for (let i = 0; i < 180; i++) {
    const id = 'fixture-' + String(i).padStart(4, '0');
    insert.run(id, id);
  }
  const expected = (await call(env, '/audit?limit=100&page=1')).data;
  assert.ok(expected.total >= 180);
  const ids = [];
  let cursor;
  do {
    const start = env.DB.queries.length;
    const resp = await call(
      env,
      '/audit?pagination=cursor&limit=17' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
    );
    assert.equal(resp.status, 200);
    assert.ok(!Object.hasOwn(resp.data, 'total'));
    const sql = env.DB.queries.slice(start).find((q) => q.includes('FROM audit_logs'));
    assert.ok(sql && !/OFFSET|COUNT/i.test(sql));
    if (cursor) {
      const plan = db
        .prepare('EXPLAIN QUERY PLAN ' + sql)
        .all(123, 'fixture-0040', 18)
        .map((r) => r.detail)
        .join(' ');
      assert.match(plan, /SEARCH .*idx_audit_created/);
      assert.doesNotMatch(plan, /TEMP B-TREE/);
    }
    ids.push(...resp.data.items.map((r) => r.id));
    cursor = resp.data.next_cursor;
  } while (cursor);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, expected.total);
  assert.deepEqual(
    ids.slice(0, 100),
    expected.items.map((r) => r.id),
  );
  assert.equal((await call(env, '/audit?pagination=cursor&cursor=not-a-cursor')).status, 400);
});

test('audit UI requests the first or next cursor without fetching totals, and can return to the first page', async () => {
  const { app, calls } = webController({
    state: { page: 'audit' },
    request: (path) => ({ items: [], next_cursor: path.includes('cursor=abc') ? null : 'abc' }),
  });
  await app.loadPage();
  app.changeAuditPage(true);
  await settled();
  app.changeAuditPage(false);
  await settled();
  const urls = calls.map(([path]) => new URL(path, 'http://test'));
  assert.deepEqual(
    urls.map((u) => u.searchParams.get('cursor')),
    [null, 'abc', null],
  );
  assert.ok(
    urls.every((u) => u.searchParams.get('pagination') === 'cursor' && !u.searchParams.has('page')),
  );
});
