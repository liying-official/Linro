import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, createLink, call } from './harness.mjs';
import { stats, statsSelection, validateStatsIds } from '../.build/apps/admin/src/worker/analytics.js';
const configured = { ANALYTICS_ENABLED: 'true', ANALYTICS_DATASET: 'cf_links_clicks', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), ANALYTICS_API_TOKEN: 'test-only-analytics-token' };
function mockFetch(t, fn) { const old = globalThis.fetch; globalThis.fetch = fn; t.after(() => { globalThis.fetch = old; }); }
const id = '11111111-1111-4111-8111-111111111111';
for (const query of ['link_id=', 'link_ids=', 'link_ids=' + id + ',', 'link_id=' + id + '&link_ids=' + id, 'link_id=' + id + '&link_id=' + id, 'link_ids=' + id + '&link_ids=' + id, "link_ids=' OR 1=1 --", 'link_id=' + 'a'.repeat(36), 'link_ids=' + Array.from({ length: 51 }, () => crypto.randomUUID()).join(',')]) {
  test(`analytics refuses invalid explicit scope ${query.slice(0, 72)}`, async t => {
    const { env } = await setup(configured); t.after(() => env.DB.close()); let reads = 0; mockFetch(t, async () => { reads++; return Response.json({ data: [] }); });
    for (const endpoint of ['/stats', '/stats/archive']) { const r = await call(env, endpoint + '?' + query); assert.equal(r.status, 400); }
    assert.equal(reads, 0);
  });
}
test('selection distinguishes all, single, multiple, and duplicate IDs', () => {
  const other = crypto.randomUUID(); assert.equal(statsSelection(new URL('https://example.org/')), null);
  assert.deepEqual(statsSelection(new URL('https://example.org/?link_id=' + id)), [id]);
  assert.deepEqual(statsSelection(new URL(`https://example.org/?link_ids=${id},${other},${id}`)), [id, other]);
  assert.throws(() => validateStatsIds([])); assert.deepEqual(validateStatsIds([id]), [id]);
});
test('unknown/deleted selected IDs fail before querying AE, even when AE is disabled', async t => {
  const { env, domain } = await setup(configured); t.after(() => env.DB.close()); const link = await createLink(env, domain); let calls = 0; mockFetch(t, () => { calls++; throw new Error('must not query'); });
  for (const enabled of ['true', 'false']) {
    env.ANALYTICS_ENABLED = enabled;
    const result = await call(env, `/stats?link_ids=${link.id},${id}`); assert.equal(result.status, 404); assert.equal(result.error.code, 'stats_link_not_found');
  }
  assert.equal(calls, 0);
});
for (const mode of ['all', 'single', 'multi']) {
  test(`all eight statistics queries consistently aggregate ${mode} scope and sample weights`, async t => {
    const { env, domain } = await setup(configured); t.after(() => env.DB.close());
    const links = await Promise.all(['one', 'two', 'unselected'].map(slug => createLink(env, domain, { slug })));
    // Distinct fixture events. We evaluate the exact validated index predicate
    // against these rows; this is an AE protocol/aggregation fixture, not AE SQL.
    const events = [
      { link: links[0], n: 2, zone: 'Asia/Tokyo', device: 'mobile' },
      { link: links[1], n: 3, zone: 'Europe/Paris', device: 'pc' },
      { link: links[1], n: 1, zone: '', device: '' },
      { link: links[2], n: 90, zone: 'America/New_York', device: 'none' },
    ];
    const selection = mode === 'all' ? null : mode === 'single' ? [links[0].id] : links.slice(0, 2).map(l => l.id); const sqls = []; let running = 0, peak = 0;
    mockFetch(t, async (url, options) => {
      running++; peak = Math.max(peak, running); sqls.push(options.body); const sql = options.body;
      assert.equal(options.redirect, 'manual'); assert.match(sql, /sum\(_sample_interval \* double1\)/);
      const filter = /index1='([^']+)'/.exec(sql)?.[1]; const multi = /index1 IN \(([^)]+)\)/.exec(sql)?.[1];
      const parsed = filter ? [filter] : multi ? [...multi.matchAll(/'([^']+)'/g)].map(m => m[1]) : null; assert.deepEqual(parsed, selection);
      const rows = events.filter(e => parsed === null || parsed.includes(e.link.id)); const sum = rows.reduce((n, e) => n + e.n, 0);
      await new Promise(resolve => setTimeout(resolve, 1)); running--;
      if ((sql.includes('blob6 AS timezone') || sql.includes('blob9 AS timezone'))) return Response.json({ data: rows.map(e => ({ timezone: e.zone, clicks: e.n })) });
      if (sql.includes('blob7 AS device')) return Response.json({ data: rows.map(e => ({ device: e.device, clicks: e.n })) });
      if (sql.includes('GROUP BY link_id')) return Response.json({ data: rows.map(e => ({ link_id: e.link.id, hostname: e.link.hostname, slug: e.link.slug, clicks: e.n })) });
      if (sql.includes('GROUP BY date')) return Response.json({ data: [{ date: '2026-09-16', clicks: sum }] });
      if (sql.includes('GROUP BY country')) return Response.json({ data: [{ country: 'XX', clicks: sum }] });
      if (sql.includes('GROUP BY referrer')) return Response.json({ data: [{ referrer: '', clicks: sum }] });
      return Response.json({ data: [{ clicks: sum }] });
    });
    const result = await stats(env, 7, selection); const expected = mode === 'all' ? 96 : mode === 'single' ? 2 : 6;
    assert.equal(result.clicks, expected); assert.equal(result.timeline[0].clicks, expected); assert.equal(sqls.length, 8); assert.equal(peak, 1);
    assert.equal(result.devices.reduce((n, r) => n + r.clicks, 0), expected); assert.equal(result.timezones.reduce((n, r) => n + r.clicks, 0), expected);
    assert.deepEqual(result.link_ids, selection); assert.equal(result.dimension_sources.browser_timezone, 'javascript_client_reported_untrusted'); assert.equal(result.dimension_sources.timezone, 'javascript_client_reported'); assert.equal(result.timezone, 'UTC');
    if (mode !== 'all') assert.ok(result.top.every(r => r.link_id !== links[2].id));
    if (mode === 'multi') assert.equal(result.devices.find(r => r.device === 'none').clicks, 1);
  });
}
test('legacy empty dimensions combine with none without fabricating device or timezone', async t => {
  const { env } = await setup(configured); t.after(() => env.DB.close());
  mockFetch(t, async (_url, opts) => Response.json({ data: (opts.body.includes('blob6') || opts.body.includes('blob9')) ? [{ timezone: '', clicks: 2 }, { timezone: 'none', clicks: 3 }] : opts.body.includes('blob7') ? [{ device: '', clicks: 2 }, { device: 'none', clicks: 3 }, { device: 'unexpected', clicks: 4 }] : [] }));
  const data = await stats(env, 1, null); assert.deepEqual(data.timezones, [{ timezone: 'none', clicks: 5 }]); assert.deepEqual(data.devices, [{ device: 'none', clicks: 9 }]);
});
test('provider failure after one dimension is not shown as a complete successful dashboard', async t => {
  const { env } = await setup(configured); t.after(() => env.DB.close()); let reads = 0;
  mockFetch(t, async () => ++reads === 6 ? new Response('fixture throttle', { status: 429 }) : Response.json({ data: [] }));
  const r = await call(env, '/stats?days=7'); assert.equal(r.status, 502); assert.equal(reads, 6); assert.equal(r.data, undefined);
});
test('archive filtering uses actual parameterized SQLite and never reports invented dimension detail', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const links = [];
  for (const slug of ['a', 'b', 'c']) { const l = await createLink(env, domain, { slug }); links.push(l); env.DB.sqlite.prepare('INSERT INTO daily_stats(link_id,date,clicks,updated_at) VALUES(?,?,?,?)').run(l.id, '2026-09-15', links.length, 1); }
  for (const ids of [[links[0].id], [links[0].id, links[2].id]]) {
    const r = await call(env, '/stats/archive?link_ids=' + ids.join(',')); assert.equal(r.status, 200); assert.deepEqual(r.data.items.map(i => i.link_id).sort(), [...ids].sort()); assert.equal(r.data.dimension_detail_available, false);
  }
  assert.equal((await call(env, '/stats/archive')).data.items.length, 3);
});
test('disabled analytics does not fabricate zero counts for an explicit valid selection', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close()); const l = await createLink(env, domain);
  const r = await call(env, '/stats?link_ids=' + l.id); assert.equal(r.status, 200); assert.equal(r.data.available, false); assert.deepEqual(r.data.link_ids, [l.id]); assert.equal(r.data.clicks, undefined);
});
test('single/multiple statistics still require authentication and analytics read scope', async t => {
  const { env, domain } = await setup(configured); t.after(() => env.DB.close()); const l = await createLink(env, domain);
  assert.equal((await call(env, '/stats?link_ids=' + l.id, 'GET', undefined, { noDev: true })).status, 401);
  const token = (await call(env, '/tokens', 'POST', { name: 'no analytics', scopes: ['links:read'], expires_at: Math.floor(Date.now() / 1000) + 1000 })).data.token;
  const r = await call(env, '/stats?link_ids=' + l.id, 'GET', undefined, { headers: { Authorization: 'Bearer ' + token } }); assert.equal(r.status, 403);
});
