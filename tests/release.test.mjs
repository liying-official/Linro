import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, readFile, writeFile, mkdir, readdir, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { stageSource } from '../scripts/package-source.mjs';
import { configs } from '../scripts/config-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const SKIP = new Set(['node_modules', '.build', '.local', '.wrangler', 'release', 'dist', '.git']);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cf-links-release-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourceRoot = join(dir, 'source');
  await cp(ROOT, sourceRoot, { recursive: true, filter: name => {
    const base = name.split(/[\\/]/).at(-1);
    return !SKIP.has(base) && base !== 'wrangler.jsonc' && base !== 'deployment.json' &&
      !/^\.(?:env|dev\.vars)(?:\.|$)/.test(base) && !/\.(?:db|sqlite|pem|key)(?:-|$)/i.test(base);
  } });
  // Tests must also pass after `configure`: use public fixtures only in this
  // disposable clone. Never restore templates over the operator's real config.
  const templates = configs({ account_id: '1'.repeat(32), database_id: '11111111-1111-4111-8111-111111111111',
    admin_host: 'admin.example.com', redirect_hosts: ['go.example.com'],
    access_issuer: 'https://your-team.cloudflareaccess.com', access_aud: 'a'.repeat(64), owner_email: 'owner@example.com', analytics_enabled: false });
  templates.admin.account_id = templates.redirect.account_id = '0'.repeat(32);
  templates.admin.vars.ACCESS_AUD = 'YOUR_ACCESS_APPLICATION_AUD';
  for (const name of ['admin', 'redirect']) await writeFile(join(sourceRoot, `apps/${name}/wrangler.jsonc`), JSON.stringify(templates[name], null, 2) + '\n');
  return { dir, sourceRoot, outputDir: join(dir, 'out') };
}
async function put(root, name, body = 'test fixture: never a real secret') {
  const path = join(root, name); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, body);
}
async function inventory(output) {
  const content = await readFile(join(output, 'MANIFEST.sha256'), 'utf8');
  return content.trim().split('\n').map(line => {
    assert.match(line, /^[a-f0-9]{64}  [^\\]+$/);
    const [hash, name] = line.split('  '); return { name, hash };
  });
}

test('source release stages every expected source with a fresh verified manifest', async t => {
  const f = await fixture(t); const result = await stageSource(f); const rows = await inventory(result.path);
  const manifest = JSON.parse(await readFile(join(f.sourceRoot, 'package.json'), 'utf8'));
  assert.equal(result.version, manifest.version);
  assert.equal(rows.length, result.manifestEntries); assert.equal(result.totalFiles, rows.length + 1);
  assert.deepEqual(rows.map(row => row.name), rows.map(row => row.name).sort());
  for (const row of rows) assert.equal(digest(await readFile(join(result.path, row.name))), row.hash, row.name);
  for (const name of ['README.md', 'README.en-US.md', 'docs/GUIDE.md', 'docs/GUIDE.en-US.md', 'docs/API.md', 'docs/API.en-US.md', 'apps/admin/src/web/App.tsx', 'apps/admin/src/web/i18n.ts', 'apps/redirect/src/index.ts', '.github/workflows/ci.yml', 'migrations/0001_initial.sql']) assert.ok(rows.some(row => row.name === name));
  assert.ok(!rows.some(row => row.name === 'MANIFEST.sha256'));
});

test('build outputs, dependencies, local state, credentials and backup fixtures never reach the release', async t => {
  const f = await fixture(t);
  const blocked = [
    '.build/apps/admin/src/worker/index.js', 'apps/admin/dist/index.html', 'apps/admin/dist/assets/main.js',
    'node_modules/react/index.js', '.local/state/data.sqlite', '.local/.dev.vars', '.wrangler/state.json',
    '.env', '.env.production', '.dev.vars', '.dev.vars.production', 'deployment.json', 'cf-links-backup.sql',
    'release/old/README.md', 'coverage/coverage.json', 'docs/.env', 'docs/private.key',
    'apps/admin/.dev.vars', 'apps/admin/state.db-wal', 'apps/admin/backup.sqlite-shm',
    'apps/admin/node_modules/pkg/leak.ts', 'tests/test-results/leak.json', 'unlisted-root.txt',
  ];
  for (const name of blocked) await put(f.sourceRoot, name);
  const result = await stageSource(f); const names = (await inventory(result.path)).map(row => row.name);
  for (const name of blocked) { assert.ok(!names.includes(name), name); await assert.rejects(access(join(result.path, name))); }
  // Staging excludes artifacts; it must never clean the original working tree.
  for (const name of blocked) assert.equal(await readFile(join(f.sourceRoot, name), 'utf8'), 'test fixture: never a real secret');
});

test('repeated staging is content-reproducible and ignores an existing stale MANIFEST', async t => {
  const f = await fixture(t); await put(f.sourceRoot, 'MANIFEST.sha256', 'obsolete');
  const a = await stageSource(f); const b = await stageSource({ ...f, outputDir: join(f.dir, 'out2') });
  assert.equal(await readFile(join(a.path, 'MANIFEST.sha256'), 'utf8'), await readFile(join(b.path, 'MANIFEST.sha256'), 'utf8'));
});

test('a real/generated Wrangler configuration blocks source publication without modifying it', async t => {
  const f = await fixture(t); const path = join(f.sourceRoot, 'apps/admin/wrangler.jsonc');
  const config = JSON.parse(await readFile(path, 'utf8')); config.account_id = 'f'.repeat(32);
  const changed = JSON.stringify(config, null, 2); await writeFile(path, changed);
  await assert.rejects(stageSource(f), /unchanged public template/);
  assert.equal(await readFile(path, 'utf8'), changed); await assert.rejects(access(f.outputDir));
});

test('unapproved changes to redirect or example templates also block publication', async t => {
  for (const name of ['apps/redirect/wrangler.jsonc', 'deployment.example.json']) {
    const f = await fixture(t); await writeFile(join(f.sourceRoot, name), '{}');
    await assert.rejects(stageSource(f), /unchanged public template/);
  }
});

test('source package includes an existing version-aligned lockfile without rewriting it', async t => {
  const f = await fixture(t); const pkg = JSON.parse(await readFile(join(f.sourceRoot, 'package.json'), 'utf8'));
  // Synthetic metadata tests packaging only; this is NOT an installable lockfile.
  const bytes = JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': { name: pkg.name, version: pkg.version } } });
  await writeFile(join(f.sourceRoot, 'package-lock.json'), bytes);
  const result = await stageSource(f);
  assert.equal(await readFile(join(result.path, 'package-lock.json'), 'utf8'), bytes);
  const old = await fixture(t);
  await writeFile(join(old.sourceRoot, 'package-lock.json'), JSON.stringify({ name:'cf-links', version:pkg.version, packages:{'':{name:'cf-links',version:pkg.version}} }));
  await assert.rejects(stageSource(old), /Lockfile root name is stale/);
});

test('stale lockfile metadata fails explicitly rather than deleting or upgrading the lockfile', async t => {
  const f = await fixture(t); const bytes = '{"version":"0.0.0","packages":{"":{"version":"0.0.0"}}}';
  await writeFile(join(f.sourceRoot, 'package-lock.json'), bytes);
  await assert.rejects(stageSource(f), /Lockfile root version is stale/);
  assert.equal(await readFile(join(f.sourceRoot, 'package-lock.json'), 'utf8'), bytes);
});

test('shared/package version mismatch and unsafe version text are rejected', async t => {
  const f = await fixture(t); const path = join(f.sourceRoot, 'package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  pkg.version = '1.9.9'; await writeFile(path, JSON.stringify(pkg));
  await assert.rejects(stageSource(f), /VERSION mismatch/);
  pkg.version = '../outside'; await writeFile(path, JSON.stringify(pkg));
  await assert.rejects(stageSource(f), /Invalid package name or release version/);
});

test('missing runtime source fails instead of creating a partial project', async t => {
  const f = await fixture(t); await rm(join(f.sourceRoot, 'apps/redirect/src/index.ts'));
  await assert.rejects(stageSource(f), /Missing required source/); await assert.rejects(access(f.outputDir));
});

test('existing output is never overwritten', async t => {
  const f = await fixture(t); await put(f.outputDir, 'keep.txt', 'keep');
  await assert.rejects(stageSource(f), /Output already exists/);
  assert.equal(await readFile(join(f.outputDir, 'keep.txt'), 'utf8'), 'keep');
});

test('source root, source subfolders and source ancestor are invalid output destinations', async t => {
  const f = await fixture(t);
  for (const outputDir of [f.sourceRoot, join(f.sourceRoot, 'apps/out'), f.dir]) await assert.rejects(stageSource({ ...f, outputDir }), /Output must be outside/);
});

test('default output lives under excluded release directory and cannot recursively include itself', async t => {
  const f = await fixture(t); const first = await stageSource({ sourceRoot: f.sourceRoot });
  assert.ok(first.path.includes(join('release', 'Linro-v')));
  const next = await stageSource(f); const names = (await inventory(next.path)).map(row => row.name);
  assert.ok(!names.some(name => name.startsWith('release/')));
});

test('unsupported CLI arguments fail before producing output', () => {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts/package-source.mjs'), '--unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /Usage:/);
});







test('selected source symlinks/junctions are refused even when they point to otherwise allowed files', async t => {
  const f = await fixture(t); await put(join(f.dir, 'outside'), 'secret.md', 'not source');
  await symlink(join(f.dir, 'outside'), join(f.sourceRoot, 'docs/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageSource(f), /Refusing source symlink/);
  await assert.rejects(access(f.outputDir));
});

test('output-parent symlinks cannot redirect staging into a source directory', async t => {
  const f = await fixture(t);
  await symlink(join(f.sourceRoot, 'apps'), join(f.dir, 'out-link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageSource({ ...f, outputDir: join(f.dir, 'out-link/release') }), /Output must be outside/);
});
