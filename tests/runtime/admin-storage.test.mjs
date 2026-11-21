import {startLocalRuntime} from '../loopback-port.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadRuntimeToolchain } from '../../scripts/runtime-toolchain.mjs';
import { createOutboundRouter } from './outbound-router.mjs';
import { applyMigrations } from './migrations.mjs';

const { Miniflare, convertV4MiniflareOptions, build } = loadRuntimeToolchain();
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('./admin-storage-worker.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
});
const origin = 'http://127.0.0.1:8787';
const dev = 'local-test-token-for-native-d1-queries-and-migrations';
const domain = '11111111-1111-4111-8111-111111111111';

async function fixture(t, beforeUpgrade) {
  const router = createOutboundRouter();
  const mf = await startLocalRuntime(port => new Miniflare(
    convertV4MiniflareOptions({host:'127.0.0.1',port,
      modules: true,
      script: compiled.outputFiles[0].text,
      cf: false,
      compatibilityDate: '2026-09-15',
      compatibilityFlags: ['enable_request_signal'],
      d1Databases: { DB: 'admin-storage' },
      outboundService: router.outboundService,
      bindings: {
        ENVIRONMENT: 'development',
        ADMIN_ORIGIN: origin,
        LOCAL_DEV_TOKEN: dev,
        BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
        BROWSER_TIMEZONE_ENABLED: 'false',
        ANALYTICS_ENABLED: 'false',
      },
    }),
  ));
  t.after(async () => {
    try {
      await mf.dispose();
    } finally {
      router.assertComplete();
    }
  });
  const db = await mf.getD1Database('DB');
  await applyMigrations(db, 0, 5);
  await db
    .prepare('INSERT INTO domains(id,hostname,created_at,updated_at) VALUES(?,?,0,0)')
    .bind(domain, 'go.example.com')
    .run();
  if (beforeUpgrade) await beforeUpgrade(db);
  await applyMigrations(db, 5);
  async function api(path, method = 'GET', body, measure = false) {
    const response = await mf.dispatchFetch(origin + '/Linro/v1' + path, {
      redirect: 'manual',
      method,
      headers: {
        'x-linro-dev': dev,
        'content-type': 'application/json',
        ...(measure ? { 'x-fixture-d1': '1' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();
    return {
      status: response.status,
      ...payload,
      measures: JSON.parse(response.headers.get('x-fixture-d1') ?? '[]'),
    };
  }
  assert.equal((await api('/session')).status, 200);
  return { db, api, mf };
}

test('native D1 checks the escaped LIKE pattern at the UTF-8 byte limit', async (t) => {
  const { api, db } = await fixture(t);
  const q = (input) => api('/links?' + new URLSearchParams({ q: input }));
  const title = [
    'a'.repeat(48),
    '界'.repeat(16),
    '%'.repeat(24),
    '_'.repeat(24),
    '\\'.repeat(24),
  ].join(' ');
  assert.equal(
    (
      await api('/links', 'POST', {
        domain_id: domain,
        slug: 'search',
        title,
        target_url: 'https://example.org/',
      })
    ).status,
    201,
  );
  for (const input of [
    'a'.repeat(48),
    '界'.repeat(16),
    '%'.repeat(24),
    '_'.repeat(24),
    '\\'.repeat(24),
  ]) {
    const response = await q(input);
    assert.equal(response.status, 200);
    assert.equal(response.data.total, 1);
  }
  for (const input of [
    'a'.repeat(49),
    '界'.repeat(17),
    '%'.repeat(24) + 'a',
    '_'.repeat(25),
    '\\'.repeat(25),
  ]) {
    const response = await q(input);
    assert.equal(response.status, 400);
    assert.equal(response.error.code, 'search_too_long');
  }
  // Exercise the underlying runtime limit independently of the API validation.
  await assert.rejects(
    db
      .prepare('SELECT slug FROM links WHERE slug LIKE ?')
      .bind('%' + 'a'.repeat(49) + '%')
      .all(),
    /pattern too complex/i,
  );
});

test('native D1 backfills canonical main and geo hosts, enforces conflicts and preserves redirects', async (t) => {
  const legacy = '22222222-2222-4222-8222-222222222222';
  const long = 'a'.repeat(60) + '.dest.example.com';
  const geo = [{ kind: 'country', code: 'JP', target_url: 'http://REGION.example.com.:8090/path' }];
  const { api, db, mf } = await fixture(t, (db) =>
    db
      .prepare(
        'INSERT INTO links(id,domain_id,slug,target_url,geo_rules,created_at,updated_at) VALUES(?,?,?,?,?,1,1)',
      )
      .bind(
        legacy,
        domain,
        'legacy',
        'https://' + long.toUpperCase() + '.:8443/a',
        JSON.stringify(geo),
      )
      .run(),
  );
  const rows = () =>
    db
      .prepare(
        'SELECT position,hostname FROM link_destination_hosts WHERE link_id=? ORDER BY position',
      )
      .bind(legacy)
      .all();
  assert.deepEqual((await rows()).results, [
    { position: -1, hostname: long },
    { position: 0, hostname: 'region.example.com' },
  ]);
  const domainsBefore = await db
    .prepare("SELECT COUNT(*) n FROM audit_logs WHERE resource_type='domain'")
    .first('n');
  for (const hostname of [long, 'region.example.com']) {
    const conflict = await api('/domains', 'POST', { hostname });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.error.code, 'hostname_is_destination');
  }
  assert.equal(
    await db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE resource_type='domain'").first('n'),
    domainsBefore,
  );
  const visit = await mf.dispatchFetch('https://go.example.com/legacy', {
    redirect: 'manual',
    cf: { country: 'JP' },
  });
  assert.equal(visit.status, 301);
  assert.equal(new URL(visit.headers.get('location')).hostname, 'region.example.com.');
  const noConflict = 'b'.repeat(61) + '.' + long;
  assert.equal((await api('/domains', 'POST', { hostname: noConflict })).status, 201);
  // Editing/deleting a link releases its old primary and regional targets.
  const edit = await api('/links/' + legacy, 'PATCH', {
    version: 1,
    target_url: 'https://new.example.com/',
    geo_rules: [],
  });
  assert.equal(edit.status, 200);
  assert.deepEqual((await rows()).results, [{ position: -1, hostname: 'new.example.com' }]);
  assert.equal((await api('/domains', 'POST', { hostname: long })).status, 201);
  assert.equal((await api('/links/' + legacy + '?version=2', 'DELETE')).status, 200);
  assert.deepEqual((await rows()).results, []);
  assert.equal((await api('/domains', 'POST', { hostname: 'new.example.com' })).status, 201);
});

test('native API rejects URL expansion in main/geo creates, patches and atomic imports without side effects', async (t) => {
  const { db, api } = await fixture(t);
  const base = 'https://example.org/';
  const exact = base + 'a'.repeat(4096 - base.length - 9) + '界';
  const valid = await api('/links', 'POST', {
    domain_id: domain,
    slug: 'original',
    target_url: exact,
  });
  assert.equal(valid.status, 201);
  assert.equal(valid.data.target_url.length, 4096);
  const count = async () =>
    db
      .prepare(
        'SELECT (SELECT COUNT(*) FROM links) links,(SELECT COUNT(*) FROM audit_logs) audits,(SELECT COUNT(*) FROM link_destination_hosts) hosts',
      )
      .first();
  const original = await count();
  const bad = base + '界'.repeat(500);
  for (const fields of [
    { target_url: bad },
    { geo_rules: [{ kind: 'country', code: 'JP', target_url: bad }] },
  ]) {
    const draft = { domain_id: domain, slug: 'new', target_url: base, ...fields };
    for (const result of [
      await api('/links', 'POST', draft),
      await api('/links/' + valid.data.id, 'PATCH', { version: 1, ...fields }),
      await api('/links/import', 'POST', {
        links: [{ ...draft, slug: 'first', target_url: base, geo_rules: [] }, draft],
      }),
    ]) {
      assert.equal(result.status, 400);
      assert.equal(result.error.code, 'invalid_url');
    }
  }
  assert.deepEqual(await count(), original);
  const untouched = await api('/links/' + valid.data.id);
  assert.equal(untouched.data.version, 1);
  assert.equal(untouched.data.target_url, valid.data.target_url);
});

test('native D1 serializes concurrent link/domain changes and rolls back all import audits on a conflict', async (t) => {
  const { api, db } = await fixture(t);
  for (let i = 0; i < 6; i++) {
    const hostname = 'race' + i + '.example.com';
    const create = () =>
      api('/links', 'POST', {
        domain_id: domain,
        slug: 'race' + i,
        target_url: 'https://example.org/',
        geo_rules: [
          { kind: 'country', code: 'FR', target_url: 'https://' + hostname + '.:8443/path' },
        ],
      });
    const register = () => api('/domains', 'POST', { hostname });
    const results =
      i % 2
        ? await Promise.all([create(), register()])
        : (await Promise.all([register(), create()])).reverse();
    const [link, managed] = results;
    if (link.status === 201) {
      assert.equal(managed.status, 409);
      assert.equal(managed.error.code, 'hostname_is_destination');
    } else {
      assert.equal(link.status, 400);
      assert.equal(link.error.code, 'redirect_chain');
      assert.equal(managed.status, 201);
    }
  }
  const conflict = await api('/links/import', 'POST', {
    links: [
      { domain_id: domain, slug: 'rollback', target_url: 'https://free.example.org/' },
      { domain_id: domain, slug: 'blocked', target_url: 'https://GO.EXAMPLE.COM.:8443/path' },
    ],
  });
  assert.equal(conflict.status, 400);
  assert.equal(conflict.error.code, 'redirect_chain');
  assert.equal(
    await db
      .prepare("SELECT COUNT(*) FROM links WHERE slug IN ('rollback','blocked')")
      .first('COUNT(*)'),
    0,
  );
  assert.equal(
    await db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='import'").first('n'),
    0,
  );
});

test('native D1 measures rows read and query plans for deep link, archive and audit cursors', async (t) => {
  const { api, db } = await fixture(t);
  await db
    .prepare(
      "WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1200) INSERT INTO links(id,domain_id,slug,target_url,response_mode,created_at,updated_at) SELECT printf('%08x-0000-4000-a000-000000000000',i),?,'item'||i,'about:blank','text',1,1 FROM n",
    )
    .bind(domain)
    .run();
  await db
    .prepare(
      "INSERT INTO daily_stats(link_id,date,clicks,updated_at) SELECT id,'2026-01-01',1,1 FROM links",
    )
    .run();
  const cases = [
    ['/links', '&view=picker&include_total=false', 1201 - 1000, 1, 'idx_links_created'],
    ['/stats/archive', '', 1000, '2026-01-01', 'idx_daily_stats_date_link'],
    ['/audit','',1201-1000,253402300799,'idx_audit_created'],
  ];
  await db.prepare("INSERT INTO audit_logs(id,actor_email,action,resource_type,resource_id,request_id,created_at) SELECT id,'test@example.com','test','link',id,'fixture',253402300799 FROM links").run();
  for (const [path, extra, last, sort, index] of cases) {
    const id = last.toString(16).padStart(8, '0') + '-0000-4000-a000-000000000000';
    const token = Buffer.from(JSON.stringify([sort, id])).toString('base64url');
    const offset = await api(path + '?limit=25&page=41' + extra, 'GET', undefined, true);
    const cursor = await api(
      path + '?limit=25&pagination=cursor&cursor=' + token + extra,
      'GET',
      undefined,
      true,
    );
    assert.equal(offset.status, 200);
    assert.equal(cursor.status, 200);
    assert.deepEqual(cursor.data.items, offset.data.items);
    if(path==='/audit'){assert.equal(offset.measures.length,2); assert.equal(cursor.measures.length,1);assert.ok(!Object.hasOwn(cursor.data,'total'));}
    const [old] = offset.measures,
      [current] = cursor.measures;
    assert.ok(
      current.plan.some((detail) => detail.includes('SEARCH') && detail.includes(index)),
      JSON.stringify(current.plan),
    );
    assert.ok(
      !current.plan.some((detail) => detail.includes('TEMP B-TREE')),
      JSON.stringify(current.plan),
    );
    // workerd exposes SQLite rows_read on the query actually used by the API.
    assert.ok(old.rows_read >= 1000, JSON.stringify(old));
    assert.ok(current.rows_read < old.rows_read / 3, JSON.stringify(current));
    t.diagnostic(
      path +
        ' offset rows_read=' +
        old.rows_read +
        ', cursor rows_read=' +
        current.rows_read +
        '; ' +
        current.plan.join(' | '),
    );
  }
});
