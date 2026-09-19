import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, writeFile, mkdir, mkdtemp, rename, rm, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stage only source and documentation. Never archive the working tree directly:
// tests create .build/, Wrangler creates state, and deployment config may be private.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROOT_FILES = [
  '.editorconfig', '.gitignore', 'CHANGELOG.md', 'LICENSE', 'NOTICE', 'README.md', 'docs/.nojekyll',
  'deployment.example.json', 'package.json', 'package-lock.json',
  'tsconfig.web.json', 'tsconfig.worker.json',
];
const ROOT_DIRS = ['.github', 'apps', 'packages', 'migrations', 'scripts', 'tests', 'examples', 'docs', 'LICENSES'];
const OMIT_DIRS = new Set([
  'node_modules', '.build', '.local', '.wrangler', '.git', 'dist', 'release',
  'evidence', 'history', 'previews', 'reports', 'repair-plans', 'coverage', 'test-results', 'playwright-report', '__pycache__',
]);
const EXTENSIONS = new Set([
  '.ts', '.tsx', '.mjs', '.html', '.css', '.json', '.jsonc', '.sql', '.csv',
  '.md', '.txt', '.png', '.yml', '.yaml',
]);
const REQUIRED = [
  'migrations/0004_browser_checks.sql', 'packages/shared/src/browser-check.ts', 'apps/redirect/src/browser-page.ts', 'apps/admin/src/web/VPNStats.tsx',
  'apps/admin/src/worker/index.ts', 'apps/redirect/src/index.ts',
  'apps/admin/src/web/App.tsx', 'apps/admin/src/web/main.tsx',
  'apps/admin/src/web/i18n.ts', 'packages/shared/src/platform.ts',
  'migrations/0003_text_responses.sql', 'packages/shared/src/text-response.ts', 'packages/shared/src/visitor-dimensions.ts', 'apps/admin/src/web/response-ui.ts', 'apps/admin/src/web/AnalyticsSelection.tsx',
  'migrations/0001_initial.sql', 'migrations/0002_link_controls.sql', 'packages/shared/src/redirect-cache.ts', 'packages/shared/src/link-password.ts', 'packages/shared/src/geo.ts', 'scripts/package-source.mjs',
  'docs/RELEASE.md', 'docs/LICENSING.md', 'LICENSES/cf-links-MIT.txt',
  'apps/redirect/src/unlock-origin.ts', 'scripts/runtime-toolchain.mjs',
  'scripts/check-deployment.mjs', 'scripts/verify-analytics-token.mjs',
  'tests/runtime/api-canary.test.mjs', 'tests/runtime/outbound-router.mjs',
  'tests/browser/chromium-cdp.mjs', 'tests/browser/csp-fixture.mjs', 'tests/browser/csp-navigation.test.mjs',
  'tests/browser-f1.test.mjs', 'tests/browser-script-harness.mjs', 'tests/upgrade-migrations.test.mjs', 'tests/unlock-cases.mjs',
];
// These three PUBLIC templates must stay byte-for-byte unchanged in a source
// release. Refuse an initialized checkout instead of distributing real config
// or silently overwriting the operator's working configuration.
const TEMPLATE_SHA256 = {
  'apps/admin/wrangler.jsonc': 'f5057661b5aaf0f9a2ab4d24c8aeb315cdc83297bc001ed36c3456a4452fbdd9',
  'apps/redirect/wrangler.jsonc': '0527d7cc010bae25d22ed149b00a060397c14e50850c76b07a7807e2028d5fe8',
  'deployment.example.json': '39cad600972cb00abdc2554ec566c027befe3c0c558d6f8e1242567af34a0f56',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const posix = name => name.split(sep).join('/');
const exists = async name => {
  try { await lstat(name); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const inside = (root, name) => {
  const r = relative(root, name);
  return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r));
};
function omitFile(name) {
  const base = name.split('/').at(-1);
  return base === 'deployment.json' || base === 'MANIFEST.sha256' ||
    base === '.env' || base.startsWith('.env.') || base === '.dev.vars' || base.startsWith('.dev.vars.') ||
    /(?:\.db|\.sqlite|\.sqlite3)(?:-|$)/i.test(base) ||
    /(?:\.sql\.backup|\.bak|\.pem|\.key|\.p12|\.pfx)$/i.test(base) ||
    (base === 'cf-links-backup.sql' || base === 'Linro-backup.sql' || base === 'linro-backup.sql');
}

/** Stage a clean, manifest-verified source tree. No cloud operations or deletion
 * of an existing output. Both paths can be overridden by isolated unit tests. */
export async function stageSource({ sourceRoot = ROOT, outputDir } = {}) {
  const source = await realpath(sourceRoot);
  const entries = [];
  async function collect(name, required = false) {
    if (omitFile(name)) return;
    const full = resolve(source, name);
    if (!inside(source, full)) throw new Error('Source path escapes project root.');
    if (!(await exists(full))) {
      if (required) throw new Error(`Missing required source: ${name}`);
      return;
    }
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) throw new Error(`Refusing source symlink: ${name}`);
    if (stat.isDirectory()) {
      for (const child of (await readdir(full)).sort()) {
        if (OMIT_DIRS.has(child) || child.startsWith('.')) continue;
        await collect(name + '/' + child);
      }
    } else if (stat.isFile()) {
      if (!ROOT_FILES.includes(name) && !EXTENSIONS.has(extname(name))) return;
      const bytes = await readFile(full);
      entries.push({ name, bytes, hash: sha256(bytes), mode: stat.mode & 0o111 ? 0o755 : 0o644 });
    } else throw new Error(`Unsupported source entry: ${name}`);
  }
  for (const name of ROOT_FILES) await collect(name, name !== 'package-lock.json');
  for (const name of ROOT_DIRS) await collect(name, true);
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  for (const name of REQUIRED) if (!byName.has(name)) throw new Error(`Missing required source: ${name}`);
  for (const [name, hash] of Object.entries(TEMPLATE_SHA256)) {
    if (byName.get(name)?.hash !== hash) throw new Error(`Source release requires the unchanged public template: ${name}. Use a clean checkout; do not replace private working configuration.`);
  }
  const manifest = JSON.parse(byName.get('package.json').bytes);
  if (manifest.name !== 'linro' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version)) throw new Error('Invalid package name or release version.');
  const shared = byName.get('packages/shared/src/platform.ts').bytes.toString('utf8');
  if (!shared.includes(`export const VERSION = '${manifest.version}';`)) throw new Error('Package/shared VERSION mismatch.');
  if (byName.has('package-lock.json')) {
    const lock = JSON.parse(byName.get('package-lock.json').bytes);
    if (lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) throw new Error('Lockfile root version is stale. Preserve the lockfile and synchronize its root package metadata before release.');
    if (lock.name !== manifest.name || (lock.packages[''].name ?? lock.name) !== manifest.name) throw new Error('Lockfile root name is stale. Synchronize Linro root metadata without replacing locked dependencies.');
  }

  const output = resolve(outputDir ?? join(source, 'release', `Linro-v${manifest.version}`));
  // Do not stage into source folders, an ancestor, or a symlinked output parent.
  const checkOutput = path => {
    if (inside(path, source) || (inside(source, path) && !inside(join(source, 'release'), path))) {
      throw new Error('Output must be outside source folders or under the dedicated release/ directory.');
    }
  };
  checkOutput(output);
  let ancestor = dirname(output);
  while (!(await exists(ancestor))) ancestor = dirname(ancestor);
  checkOutput(resolve(await realpath(ancestor), relative(ancestor, output)));
  if (await exists(output)) throw new Error('Output already exists; refusing to overwrite it.');
  await mkdir(dirname(output), { recursive: true });
  const temporary = await mkdtemp(join(dirname(output), '.linro-stage-'));
  try {
    for (const entry of entries) {
      const target = join(temporary, entry.name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.bytes, { mode: entry.mode, flag: 'wx' });
      if (sha256(await readFile(target)) !== entry.hash) throw new Error(`Staged copy failed checksum verification: ${entry.name}`);
    }
    const inventory = entries.map(entry => `${entry.hash}  ${posix(entry.name)}\n`).join('');
    await writeFile(join(temporary, 'MANIFEST.sha256'), inventory, { flag: 'wx' });
    // Recheck output at commit time; a release path is never intentionally replaced.
    if (await exists(output)) throw new Error('Output appeared while staging; refusing to overwrite it.');
    await rename(temporary, output);
    return { version: manifest.version, path: output, manifestEntries: entries.length, totalFiles: entries.length + 1 };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && !(args.length === 2 && args[0] === '--out' && args[1])) throw new Error('Usage: node scripts/package-source.mjs [--out OUTPUT_DIRECTORY]');
    const result = await stageSource({ outputDir: args[1] });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Source release blocked: ' + error.message);
    process.exitCode = 1;
  }
}
