import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Load ONLY the project-local, pinned Wrangler dependency graph. No globals,
 * auto-installation, Node-fetch substitute, swallowed errors or skipped tests.
 */
export function loadRuntimeToolchain() {
  const require = createRequire(new URL('../package.json', import.meta.url));
  const declared = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  try {
    const wrangler = require('wrangler/package.json');
    if (!/^\d+\.\d+\.\d+$/.test(declared.devDependencies.wrangler) || wrangler.version !== declared.devDependencies.wrangler) {
      throw new Error('Installed Wrangler does not match the exact package.json pin. Reconcile package-lock.json and run npm ci.');
    }
    const fromWrangler = createRequire(require.resolve('wrangler'));
    const miniflare = fromWrangler('miniflare/package.json');
    const workerd = fromWrangler('workerd/package.json');
    const esbuild = fromWrangler('esbuild/package.json');
    const { Miniflare, convertV4MiniflareOptions } = fromWrangler('miniflare');
    const { build } = fromWrangler('esbuild');
    if (!miniflare.version.startsWith('5.') || typeof Miniflare !== 'function' || typeof convertV4MiniflareOptions !== 'function' || typeof build !== 'function') {
      throw new Error('Expected Miniflare 5 with the official options converter and esbuild. API drift must be investigated, not skipped.');
    }
    return { Miniflare, convertV4MiniflareOptions, build, versions: {
      node: process.version, wrangler: wrangler.version, miniflare: miniflare.version, workerd: workerd.version, esbuild: esbuild.version,
    } };
  } catch (cause) {
    throw new Error('Native workerd tests require the pinned project-local Wrangler/Miniflare 5/workerd/esbuild toolchain. Run npm ci/install; no fallback or skipped pass is allowed.', { cause });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(loadRuntimeToolchain().versions, null, 2)); }
  catch (error) { console.error(error.message); console.error(error.cause?.message ?? ''); process.exitCode = 1; }
}
