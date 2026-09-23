import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configs, validateConfig } from '../scripts/config-lib.mjs';
import { SQLiteD1, setup, call, createLink, visit } from './harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const blocks = [...readme.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)];
const commands = blocks.filter(m => /^(?:bash|powershell)$/.test(m[1])).map(m => m[2]).join('\n');
// These tests inspect documented commands without contacting Cloudflare.

test('requested fix release version and README match the shared package version', () => {
  assert.equal(pkg.version, '1.0.1'); // User-requested release name; no version-ordering logic.
  assert.ok(readme.startsWith(`# Linro v${pkg.version}\n`));
  assert.ok(readme.includes(`version: "${pkg.version}"`));
  assert.ok(readme.includes(`release/Linro-v${pkg.version}/`));
});

test('README deployment JSON remains the real template contract, not a fabricated schema', async () => {
  const example = JSON.parse(await readFile(join(ROOT, 'deployment.example.json'), 'utf8'));
  const documented = JSON.parse(blocks.find(m => m[1] === 'json' && m[2].includes('"account_id"'))[2]);
  assert.deepEqual(documented, example);
  assert.throws(() => validateConfig(documented), /real 32-character/);
  const c = { ...documented, account_id: 'a'.repeat(32), database_id: '11111111-1111-4111-8111-111111111111',
    access_issuer: 'https://test.cloudflareaccess.com', access_aud: 'b'.repeat(64) };
  assert.equal(validateConfig(c), c);
});

test('all runnable npm commands in README exist and remote migration is explicitly separate from deploy', () => {
  const referenced = [...commands.matchAll(/\bnpm run ([a-z0-9:_-]+)/g)].map(m => m[1]);
  assert.ok(referenced.length > 15);
  for (const name of referenced) assert.ok(Object.hasOwn(pkg.scripts, name), name);
  assert.ok(pkg.scripts['db:migrate'].includes('--remote'));
  assert.ok(pkg.scripts['db:migrate'].includes('--config apps/admin/wrangler.jsonc'));
  assert.ok(!pkg.scripts.deploy.includes('db:migrate'));
  assert.match(readme, /不自动创建数据库，也不自动执行迁移/);
  assert.match(readme, /不是原子操作/);
});

test('documented names, isolation, static gate, shared database, and optional analytics match the generator', () => {
  const c = { account_id: 'c'.repeat(32), database_id: '11111111-1111-4111-8111-111111111111',
    database_name: 'cf-links', admin_host: 'admin.example.com', redirect_hosts: ['go.example.com'],
    access_issuer: 'https://test.cloudflareaccess.com', access_aud: 'd'.repeat(64), owner_email: 'owner@example.com' };
  for (const enabled of [false, true]) {
    const { admin, redirect } = configs({ ...c, analytics_enabled: enabled });
    assert.equal(admin.name, 'linro-admin'); assert.equal(redirect.name, 'linro-redirect');
    assert.equal(admin.assets.run_worker_first, true); assert.equal(admin.assets.binding, 'ASSETS');
    assert.equal(admin.d1_databases[0].database_id, redirect.d1_databases[0].database_id);
    for (const worker of [admin, redirect]) {
      assert.equal(worker.workers_dev, false); assert.equal(worker.preview_urls, false);
      assert.equal(worker.vars.ENVIRONMENT, 'production');
      assert.equal(worker.vars.ANALYTICS_ENABLED, String(enabled));
    }
    if (enabled) {
      assert.deepEqual(admin.triggers.crons, ['*/15 * * * *']);
      assert.equal(redirect.analytics_engine_datasets[0].binding, 'ANALYTICS');
    } else { assert.equal(admin.triggers, undefined); assert.equal(redirect.analytics_engine_datasets, undefined); }
  }
});

test('all documented diagnostic SQL executes as read-only against the actual schema', () => {
  const db = new SQLiteD1();
  try {
    const sqls = [...commands.matchAll(/--command "([^"\n]+)"/g)].map(m => m[1]);
    assert.ok(sqls.length >= 6);
    const before = db.sqlite.prepare('SELECT total_changes() AS n').get().n;
    for (const sql of sqls) {
      assert.match(sql, /^(?:SELECT |PRAGMA foreign_key_check;)/i);
      assert.doesNotThrow(() => db.sqlite.prepare(sql).all(), sql);
    }
    assert.equal(db.sqlite.prepare('SELECT total_changes() AS n').get().n, before);
  } finally { db.close(); }
});

test('README internal links and explicit navigation anchors resolve in the release', async () => {
  for (const m of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^https?:/.test(target)) continue;
    if (target.startsWith('#')) { assert.ok(readme.includes(`<a id="${target.slice(1)}"></a>`), target); }
    else { await access(join(ROOT, target.split('#')[0])); }
  }
  assert.match(readme, /Windows/); assert.match(readme, /PowerShell/); assert.match(readme, /Bash/);
});



test('README installs committed dependencies without rewriting or resolving the lockfile', () => {
  assert.match(commands, /npm ci\s*\n(?:npm run toolchain:versions)/);
  assert.doesNotMatch(commands, /package-lock-only|npm update|npm install wrangler|writeFileSync\('package-lock/);
});

test('committed dependency lock matches the published package metadata and direct dependencies', async () => {
  const lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.name, pkg.name); assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].name, pkg.name); assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
});

test('documented domain default 302 preserves existing 301 links and governs newly created links', async t => {
  const { env, domain } = await setup(); t.after(() => env.DB.close());
  const old = await createLink(env, domain, { slug: 'before-change', redirect_code: 301 });
  const updated = await call(env, '/domains/' + domain.id, 'PATCH', { version: domain.version, default_redirect_code: 302 });
  assert.equal(updated.status, 200);
  const next = await createLink(env, domain, { slug: 'after-change' });
  assert.equal(next.redirect_code, 302);
  assert.equal((await call(env, '/links/' + old.id)).data.redirect_code, 301);
  assert.equal((await visit(env, '/before-change')).status, 301);
  assert.equal((await visit(env, '/after-change')).status, 302);
  const stored = await call(env, '/domains');
  assert.equal(stored.data.find(d => d.id === domain.id).default_redirect_code, 302);
});
