import { publicIPv6 } from './fixture-addresses.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, createLink, setup } from './harness.mjs';
import { canonicalHost } from '../.build/packages/shared/src/policy.js';

const id = (index) => index.toString(16).padStart(8, '0') + '-0000-4000-a000-000000000000';
const range = (count) => Array.from({ length: count }, (_, i) => i + 1);

test('picker cursor serves only the summary, skips counts and keeps equal-time pages stable during edits', async (t) => {
  const { env, domain } = await setup();
  t.after(() => env.DB.close());
  const seed = env.DB.sqlite.prepare(
    "INSERT INTO links(id,domain_id,slug,target_url,response_mode,text_content,description,created_at,updated_at) VALUES(?,?,?,'about:blank','text',?,'large description',1,1)",
  );
  for (const i of range(31)) seed.run(id(i), domain.id, 'text-' + i, 'é'.repeat(16384));
  const full = await call(env, '/links?page=1&limit=25');
  assert.equal(full.data.total, 31);
  assert.equal(full.data.page, 1);
  assert.equal(full.data.items[0].text_content.length, 16384);
  env.DB.queries = [];
  const paths = '/links?view=picker&pagination=cursor&limit=25';
  const first = await call(env, paths);
  assert.deepEqual(Object.keys(first.data).sort(), ['items', 'limit', 'next_cursor']);
  assert.deepEqual(
    first.data.items,
    full.data.items.map(({ id, hostname, slug }) => ({ id, hostname, slug })),
  );
  const query = env.DB.queries.find((sql) => sql.includes('ORDER BY l.created_at'));
  assert.doesNotMatch(query, /l\.\*|text_content|geo_rules|description|OFFSET/i);
  assert.ok(env.DB.queries.every((sql) => !/COUNT\(\*\)/i.test(sql)));
  const fullBytes = (await full.response.arrayBuffer()).byteLength;
  const pickerBytes = (await first.response.arrayBuffer()).byteLength;
  assert.ok(fullBytes > 800 * 1024);
  assert.ok(pickerBytes < 4 * 1024);
  t.diagnostic(
    '25 maximum-byte text links: full=' + fullBytes + ' bytes, picker=' + pickerBytes + ' bytes',
  );
  const lastId = first.data.items.at(-1).id;
  env.DB.sqlite.prepare('DELETE FROM links WHERE id=?').run(lastId);
  seed.run(id(99), domain.id, 'newer', 'new');
  const second = await call(env, paths + '&include_total=true&cursor=' + first.data.next_cursor);
  assert.equal(second.status, 200);
  assert.equal(second.data.total, 31);
  assert.equal(second.data.next_cursor, null);
  assert.deepEqual(
    second.data.items.map((item) => item.id),
    [6, 5, 4, 3, 2, 1].map(id),
  );
  const filtered = await call(
    env,
    paths + '&domain_id=' + domain.id + '&status=active&q=text-31&include_total=true',
  );
  assert.deepEqual(filtered.data.items, [first.data.items[0]]);
  assert.equal(filtered.data.total, 1);
  env.DB.queries = [];
  const noCount = await call(env, '/links?page=2&limit=2&include_total=false');
  assert.equal(noCount.data.page, 2);
  assert.equal(noCount.data.items.length, 2);
  assert.equal('total' in noCount.data, false);
  assert.ok(env.DB.queries.every((sql) => !/COUNT\(\*\)/i.test(sql)));
});

test('cursor input is bounded and rejected across archive and link sort key types', async (t) => {
  const { env } = await setup();
  t.after(() => env.DB.close());
  const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const path of [
    '/links?pagination=cursor&cursor=!bad',
    '/links?pagination=cursor&cursor=' + encoded(['2026-10-01', id(1)]),
    '/stats/archive?pagination=cursor&cursor=' + encoded([1, id(1)]),
    '/links?pagination=cursor&cursor=' + encoded([1, 'a'.repeat(150)]),
    '/links?pagination=cursor&cursor=' + 'a'.repeat(2000),
    '/links?pagination=cursor&page=2',
    '/stats/archive?page=2&cursor=invalid',
    '/links?include_total=perhaps',
  ])
    assert.equal((await call(env, path)).status, 400, path);
});

test('archive cursors handle date changes, tied IDs and a fifty-link selection', async (t) => {
  const { env, domain } = await setup();
  t.after(() => env.DB.close());
  const seedLink = env.DB.sqlite.prepare(
    "INSERT INTO links(id,domain_id,slug,target_url,created_at,updated_at) VALUES(?,?,?,'https://example.org/',0,0)",
  );
  const seedStat = env.DB.sqlite.prepare(
    'INSERT INTO daily_stats(link_id,date,clicks,updated_at) VALUES(?,?,1,0)',
  );
  for (const i of range(52)) {
    seedLink.run(id(i), domain.id, 's' + i);
    for (const date of ['2026-01-01', '2026-01-02']) seedStat.run(id(i), date);
  }
  const selected = range(50).map(id).join(',');
  const base = '/stats/archive?link_ids=' + selected;
  const legacy = await call(env, base + '&limit=100&page=1');
  assert.equal(legacy.status, 200);
  assert.equal(legacy.data.items.length, 100);
  let cursor = null;
  const rows = [];
  do {
    const page = await call(
      env,
      base + '&pagination=cursor&limit=17' + (cursor ? '&cursor=' + cursor : ''),
    );
    assert.equal(page.status, 200);
    assert.deepEqual(page.data.link_ids, selected.split(','));
    assert.equal(page.data.sampled, true);
    assert.equal(page.data.dimension_detail_available, false);
    assert.ok(!('page' in page.data));
    assert.ok(page.data.items.length > 0);
    rows.push(...page.data.items);
    cursor = page.data.next_cursor;
  } while (cursor);
  assert.deepEqual(rows, legacy.data.items);
});

test('domain directory omits counted links, preserves sort order and enforces the domains scope', async (t) => {
  const { env, domain } = await setup();
  t.after(() => env.DB.close());
  const other = await call(env, '/domains', 'POST', {
    hostname: 'alpha.example.net',
    enabled: false,
    default_redirect_code: 308,
  });
  await createLink(env, domain);
  env.DB.queries = [];
  const light = await call(env, '/domains?view=directory');
  assert.deepEqual(
    light.data,
    [other.data, domain].map(({ id, hostname, enabled, default_redirect_code }) => ({
      id,
      hostname,
      enabled,
      default_redirect_code,
    })),
  );
  assert.ok(env.DB.queries.every((sql) => !/\blinks\b|COUNT\(/i.test(sql)));
  const full = await call(env, '/domains');
  assert.deepEqual(
    full.data.map((row) => row.link_count),
    [0, 1],
  );
  const token = await call(env, '/tokens', 'POST', {
    name: 'analytics only',
    scopes: ['analytics:read'],
    expires_at: Math.floor(Date.now() / 1000) + 600,
  });
  const opts = { noDev: true, headers: { Authorization: 'Bearer ' + token.data.token } };
  for (const path of ['/domains?view=directory', '/links?view=picker&pagination=cursor']) {
    assert.equal((await call(env, path, 'GET', undefined, opts)).status, 403);
  }
});

test('an import resolves ten source domains together and checks up to 330 hosts in the same bounded batch', async (t) => {
  const { env, domain } = await setup();
  t.after(() => env.DB.close());
  const domains = [domain];
  for (const i of range(9))
    domains.push(
      (await call(env, '/domains', 'POST', { hostname: 'source' + i + '.example.org' })).data,
    );
  const drafts = domains.map((d, i) => ({
    domain_id: d.id,
    slug: 'regional',
    target_url: 'https://default' + i + '.example.org/',
    geo_rules: range(32).map((n) => ({
      kind: 'country',
      code: String.fromCharCode(65 + Math.floor((n - 1) / 26), 65 + ((n - 1) % 26)),
      target_url: 'https://region' + i + '-' + n + '.example.org./path',
    })),
  }));
  const original = env.DB.batch.bind(env.DB);
  const batches = [];
  env.DB.batch = async (statements) => {
    batches.push(statements);
    return original(statements);
  };
  env.DB.queries = [];
  const response = await call(env, '/links/import', 'POST', { links: drafts });
  assert.equal(response.status, 201);
  assert.equal(response.data.imported, 10);
  const sql = env.DB.queries;
  assert.equal(sql.filter((q) => q.includes('FROM domains WHERE id IN')).length, 1);
  assert.equal(batches.length, 1);
  const [batch] = batches;
  assert.equal(batch.length, 21);
  assert.ok(batch.every((statement) => statement.values.length <= 100));
  assert.equal(sql.length - batch.length + 1, 3);
  assert.equal(
    env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM link_destination_hosts').get().n,
    330,
  );
  assert.equal(
    env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='import'").get().n,
    10,
  );
  t.diagnostic(
    '10-source / 330-host import: ' +
      sql.length +
      ' SQL statements incl. authentication, 3 binding calls',
  );
});

test('derived host records follow WHATWG serialization, direct edits and output-mode changes', async (t) => {
  const { env, domain } = await setup();
  t.after(() => env.DB.close());
  const main = 'https://BÜCHER.Example.NET.:8443/path';
  const targets = [
    'http://PORT.example.org.:80/#fragment',
    'https://' + publicIPv6 + ':8443/path',
    'https://Upper.Example.ORG./?x',
  ];
  const link = await createLink(env, domain, {
    target_url: main,
    geo_rules: targets.map((target_url, i) => ({
      kind: 'country',
      code: ['JP', 'FR', 'US'][i],
      target_url,
    })),
  });
  const hosts = () =>
    env.DB.sqlite
      .prepare(
        'SELECT position,hostname FROM link_destination_hosts WHERE link_id=? ORDER BY position',
      )
      .all(link.id)
      .map((row) => ({ ...row }));
  assert.deepEqual(
    hosts(),
    [main, ...targets].map((target, i) => ({
      position: i - 1,
      hostname: canonicalHost(new URL(target).hostname),
    })),
  );
  const reverse = await call(env, '/domains', 'POST', { hostname: 'xn--bcher-kva.example.net' });
  assert.equal(reverse.status, 409);
  assert.equal(reverse.error.code, 'hostname_is_destination');
  const plan = env.DB.sqlite
    .prepare('EXPLAIN QUERY PLAN SELECT * FROM parsed_link_destinations WHERE link_id=?')
    .all(link.id)
    .map((row) => row.detail);
  assert.ok(
    plan.some((detail) => /SEARCH links .*id=\?/.test(detail)),
    JSON.stringify(plan),
  );
  assert.ok(
    plan.every((detail) => !/^SCAN (?:links|l)(?:\s|$)/.test(detail)),
    JSON.stringify(plan),
  );
  env.DB.sqlite
    .prepare(
      "UPDATE links SET target_url='https://EdIt.Ed.Example.org.:8199?query',geo_rules='[]' WHERE id=?",
    )
    .run(link.id);
  assert.deepEqual(hosts(), [{ position: -1, hostname: 'edit.ed.example.org' }]);
  await call(env, '/links/' + link.id, 'PATCH', {
    version: 1,
    response_mode: 'text',
    text_content: 'message',
    geo_rules: [],
  });
  assert.deepEqual(hosts(), []);
  assert.equal(
    (await call(env, '/domains', 'POST', { hostname: 'edit.ed.example.org' })).status,
    201,
  );
});

test('domain registration committed immediately before patch/import cannot invalidate an existing link', async (t) => {
  const { env, domain } = await setup();
  t.after(() => env.DB.close());
  const original = await createLink(env, domain);
  for (const op of ['patch', 'import']) {
    const hostname = op + '.example.org';
    const batch = env.DB.batch.bind(env.DB);
    let interleaved = false;
    env.DB.batch = async (statements) => {
      if (
        !interleaved &&
        statements.some((statement) =>
          statement.sql.includes('INSERT INTO check_link_destinations'),
        )
      ) {
        interleaved = true;
        assert.equal((await call(env, '/domains', 'POST', { hostname })).status, 201);
      }
      return batch(statements);
    };
    const rule = { kind: 'country', code: 'JP', target_url: 'https://' + hostname + '.:8443/' };
    const response =
      op === 'patch'
        ? await call(env, '/links/' + original.id, 'PATCH', { version: 1, geo_rules: [rule] })
        : await call(env, '/links/import', 'POST', {
            links: [
              { domain_id: domain.id, slug: 'first', target_url: 'https://free.example.org/' },
              {
                domain_id: domain.id,
                slug: 'second',
                target_url: 'https://example.net/',
                geo_rules: [rule],
              },
            ],
          });
    assert.ok(interleaved);
    assert.equal(response.status, 400);
    assert.equal(response.error.code, 'redirect_chain');
    env.DB.batch = batch;
  }
  const unchanged = await call(env, '/links/' + original.id);
  assert.equal(unchanged.data.version, 1);
  assert.deepEqual(unchanged.data.geo_rules, []);
  assert.equal(
    env.DB.sqlite
      .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('update','import')")
      .get().n,
    0,
  );
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM links').get().n, 1);
});
