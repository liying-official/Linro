import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, createLink, call } from './harness.mjs';
import { stats, rollup } from '../.build/apps/admin/src/worker/analytics.js';
const configured = { ANALYTICS_ENABLED: 'true', ANALYTICS_DATASET: 'cf_links_clicks', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), ANALYTICS_API_TOKEN: 'unit-test-not-a-real-secret' };
function mockFetch(t, handler) { const original = globalThis.fetch; globalThis.fetch = handler; t.after(() => { globalThis.fetch = original; }); }
const previousDate = () => new Date((Math.floor(Date.now() / 86400000) - 1) * 86400000).toISOString().slice(0, 10);
test('unconfigured analytics is unavailable, not a fabricated zero-click success', async t => {
  const { env } = await setup(); t.after(() => env.DB.close());
  assert.equal((await stats(env, 7, null)).available, false);
});
test('analytics generates sample-weighted SQL, UTC date grouping and a scoped filter', async t => {
  const { env, domain } = await setup(configured); t.after(() => env.DB.close()); const link = await createLink(env, domain); const sqls = [];
  mockFetch(t, async (url, options) => {
    assert.equal(String(url), `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/analytics_engine/sql`);
    assert.equal(options.headers.Authorization, 'Bearer unit-test-not-a-real-secret'); sqls.push(options.body);
    return Response.json({ data: !options.body.includes('GROUP BY') ? [{ clicks: 17 }] : [] });
  });
  const result = await stats(env, 7, link.id);
  assert.equal(result.available, true); assert.equal(result.sampled, true); assert.equal(result.clicks, 17); assert.equal(sqls.length, 8);
  assert.ok(sqls.every(sql => sql.includes('sum(_sample_interval * double1)') && sql.includes(`index1='${link.id}'`)));
  assert.ok(sqls.some(sql => sql.includes("formatDateTime(timestamp, '%Y-%m-%d')")));
});
test('provider query failures produce a visible 502 response', async t => {
  const { env } = await setup(configured); t.after(() => env.DB.close()); mockFetch(t, async () => new Response('Forbidden', { status: 403 }));
  const result = await call(env, '/stats?days=7'); assert.equal(result.status, 502); assert.equal(result.error.code, 'analytics_query_failed');
});
test('daily rollup executes actual UPSERT SQL, excludes deleted links and retries idempotently', async t => {
  const { env, domain } = await setup(configured); t.after(() => env.DB.close()); const link = await createLink(env, domain); const date = previousDate(); let clicks = 12;
  mockFetch(t, async () => Response.json({ data: [{ link_id: link.id, date, clicks }, { link_id: crypto.randomUUID(), date, clicks: 99 }] }));
  await rollup(env); clicks = 18; await rollup(env);
  const rows = env.DB.sqlite.prepare('SELECT * FROM daily_stats').all(); assert.equal(rows.length, 1); assert.equal(rows[0].clicks, 18);
  assert.ok(env.DB.sqlite.prepare("SELECT value FROM settings WHERE key='analytics_rollup_last_success'").get());
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key='analytics_rollup_cursor'").get().n, 0);
});
test('401-group archive checkpoints at 400 and completes next invocation without over 50 D1 statements', async t => {
  const { env, domain, user } = await setup(configured); t.after(() => env.DB.close()); const date = previousDate(); const ids = Array.from({ length: 401 }, () => crypto.randomUUID()).sort();
  const insert = env.DB.sqlite.prepare('INSERT INTO links(id,domain_id,slug,target_url,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
  ids.forEach((id, i) => insert.run(id, domain.id, 'item-' + i, 'https://example.org/', user.id, 1, 1));
  let requests = 0;
  mockFetch(t, async (_url, options) => { requests++; if (requests === 2) assert.ok(options.body.includes(`index1 > '${ids[399]}'`)); return Response.json({ data: (requests === 1 ? ids : [ids[400]]).map(link_id => ({ link_id, date, clicks: 1 })) }); });
  env.DB.queries.length = 0; await rollup(env); assert.ok(env.DB.queries.length <= 43, env.DB.queries.length); assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM daily_stats').get().n, 400);
  assert.equal(JSON.parse(env.DB.sqlite.prepare("SELECT value FROM settings WHERE key='analytics_rollup_cursor'").get().value).link_id, ids[399]);
  env.DB.queries.length = 0; await rollup(env); assert.ok(env.DB.queries.length <= 43); assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM daily_stats').get().n, 401);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key='analytics_rollup_cursor'").get().n, 0);
});
test('bad archive rows fail without partially committing daily aggregates', async t => {
  const { env, domain } = await setup(configured); t.after(() => env.DB.close()); const link = await createLink(env, domain);
  mockFetch(t, async () => Response.json({ data: [{ link_id: link.id, date: previousDate(), clicks: -1 }] }));
  await assert.rejects(() => rollup(env)); assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM daily_stats').get().n, 0);
});
