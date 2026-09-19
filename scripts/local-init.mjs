import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { ROOT } from './config-lib.mjs';
const dir = resolve(ROOT, '.local');
try {
  await mkdir(dir, { recursive: true });
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--kv')) throw new Error('Usage: npm run local:init [-- --kv]');
  let vars = '';
  try { vars = await readFile(resolve(dir, '.dev.vars'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const ensureSecret = name => {
    const lines = vars.split(/\r?\n/).filter(line => new RegExp('^' + name + '=').test(line));
    if (lines.length > 1) throw new Error('Duplicate ' + name + ' in local secret file.');
    if (lines.length) {
      const value = lines[0].slice(name.length + 1).replace(/^"|"$/g, '');
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) throw new Error('Invalid existing ' + name + '; refusing to rotate it silently.');
      return value;
    }
    const value = randomBytes(32).toString('base64url');
    vars += (vars && !vars.endsWith('\n') ? '\n' : '') + name + '="' + value + '"\n';
    return value;
  };
  const secret = ensureSecret('LOCAL_DEV_TOKEN');
  ensureSecret('LINK_PASSWORD_SECRET');
  let previous;
  try { previous = JSON.parse(await readFile(resolve(dir, 'admin.jsonc'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const db = { binding: 'DB', database_name: previous?.d1_databases?.[0]?.database_name ?? 'linro-local', database_id: '11111111-1111-4111-8111-111111111111', migrations_dir: '../migrations' };
  ensureSecret('BROWSER_CHECK_SECRET');
  const security = { BROWSER_TIMEZONE_ENABLED: 'true', CLOUDFLARE_DEVICE_TYPE_ENABLED: 'false', REDIRECT_CACHE_TTL: '300', QUERY_FORWARD_ALLOWLIST: JSON.stringify(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']), PRIVATE_TARGET_ALLOWLIST: '[]', EXPIRED_LINK_STATUS: '404' };
  const common = { compatibility_date: '2026-09-15', workers_dev: false, preview_urls: false, d1_databases: [db], ...(args.includes('--kv') ? { kv_namespaces: [{ binding: 'REDIRECT_CACHE', id: '33333333333333333333333333333333' }] } : {}) };
  const admin = { ...common, name: previous?.name ?? 'linro-admin-local', main: '../apps/admin/src/worker/index.ts', assets: { directory: '../apps/admin/dist', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: true }, vars: { ...security, ENVIRONMENT: 'development', ADMIN_ORIGIN: 'http://127.0.0.1:8787', BOOTSTRAP_OWNER_EMAIL: 'owner@localhost.test', ACCESS_ISSUER: '', ACCESS_AUD: '', ANALYTICS_ENABLED: 'false' } };
  let previousRedirect;
  try { previousRedirect = JSON.parse(await readFile(resolve(dir, 'redirect.jsonc'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const redirect = { ...common, name: previousRedirect?.name ?? 'linro-redirect-local', main: '../apps/redirect/src/index.ts', vars: { ...security, ENVIRONMENT: 'development', ADMIN_ORIGIN: 'http://127.0.0.1:8787', ANALYTICS_ENABLED: 'false' }, ratelimits: [{ name: 'REDIRECT_LIMITER', namespace_id: '21003', simple: { limit: 300, period: 60 } }, { name: 'PASSWORD_LIMITER', namespace_id: '21004', simple: { limit: 5, period: 60 } }] };
  await writeFile(resolve(dir, 'admin.jsonc'), JSON.stringify(admin, null, 2) + '\n');
  await writeFile(resolve(dir, 'redirect.jsonc'), JSON.stringify(redirect, null, 2) + '\n');
  await writeFile(resolve(dir, '.dev.vars'), vars, { mode: 0o600 });
  await writeFile(resolve(dir, 'seed.sql'), `INSERT OR IGNORE INTO domains(id,hostname,name,created_at,updated_at) VALUES('22222222-2222-4222-8222-222222222222','127.0.0.1','Local redirect',unixepoch(),unixepoch());\n`);
  console.log(`Local development token (never deploy or commit): ${secret}\n\nRun:\n  npm run build:web\n  npm run db:migrate:local\n  npm run db:seed:local\n  npm run dev:admin\n  npm run dev:redirect   (second terminal)\n\nAdmin: http://127.0.0.1:8787\nRedirect: http://127.0.0.1:8788\nLocal data is separate from your Cloudflare D1 account.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
