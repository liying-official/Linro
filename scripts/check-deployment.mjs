import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = new URL('..', import.meta.url);
const HELP = `Usage: npm run verify:deployment -- [--url https://go.example.com/health ...]
  [--expected-version VERSION] [--family 4|6] [--attempts 12]
  [--interval-ms 5000] [--timeout-ms 10000]
Without --url, reads custom domains from apps/redirect/wrangler.jsonc.
Requires two consecutive healthy rounds (one with --attempts 1).
Read-only HTTPS probes; never redeploys, changes DNS, follows redirects, or disables TLS checks.`;

export function healthURL(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/health' || url.search || url.hash) {
    throw new Error('Probe URLs must be HTTPS /health endpoints without credentials, query or fragment.');
  }
  return url.href;
}
export function parseOptions(args) {
  const options = { urls: [], attempts: 12, intervalMs: 5000, timeoutMs: 10000, family: undefined, expectedVersion: undefined };
  const integers = { '--attempts': ['attempts', 1, 60], '--interval-ms': ['intervalMs', 0, 60000], '--timeout-ms': ['timeoutMs', 100, 60000] };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') return { help: true };
    if (!['--url', '--expected-version', '--family', ...Object.keys(integers)].includes(flag)) throw new Error('Unknown probe option. Use --help.');
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) throw new Error('Missing probe option value.');
    if (flag === '--url') options.urls.push(healthURL(value));
    else if (flag === '--expected-version') {
      if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,79}$/.test(value)) throw new Error('Invalid expected version.');
      options.expectedVersion = value;
    } else if (flag === '--family') {
      if (!['4', '6'].includes(value)) throw new Error('Address family must be 4 or 6.');
      options.family = Number(value);
    } else {
      const [key, min, max] = integers[flag];
      const n = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) throw new Error('Probe timing/attempt option is out of range.');
      options[key] = n;
    }
  }
  options.urls = [...new Set(options.urls)];
  if (options.urls.length > 100) throw new Error('Too many probe URLs.');
  return options;
}
export function configURLs(config) {
  // Refuse the distributed public template before making any network request.
  if (!/^[a-f0-9]{32}$/.test(config.account_id ?? '') || /^0+$/.test(config.account_id) || config.vars?.ENVIRONMENT !== 'production') throw new Error('Run configure with the real account before deployment verification.');
  if (!Array.isArray(config.routes) || config.routes.length < 1 || config.routes.length > 100) throw new Error('No valid public Custom Domain routes.');
  return [...new Set(config.routes.map(route => {
    if (route.custom_domain !== true || typeof route.pattern !== 'string' || !/^[a-z0-9.-]+$/.test(route.pattern) || !route.pattern.includes('.')) throw new Error('Only exact Custom Domain hostnames may be probed.');
    return healthURL(`https://${route.pattern}/health`);
  }))];
}
export function assessHealth(status, body, expectedVersion) {
  if (status !== 200) return { ok: false, reason: 'http_status', status };
  let data;
  try { data = JSON.parse(body); } catch { return { ok: false, reason: 'invalid_health_json', status }; }
  if (data?.status !== 'ok') return { ok: false, reason: 'invalid_health_payload', status };
  if (typeof expectedVersion !== 'string' || !expectedVersion || data.version !== expectedVersion) return { ok: false, reason: 'version_mismatch', status };
  return { ok: true, reason: 'healthy', status };
}
/** HTTPS itself verifies the peer certificate and hostname; no insecure or
 * HTTP fallback exists. Transport errors do NOT prove a missing certificate.
 * requestImpl is only an isolated unit-test transport seam, not a CLI option.
 */
export function probeHealth(input, { expectedVersion, timeoutMs = 10000, family } = {}, requestImpl = https.request) {
  const target = healthURL(input);
  return new Promise(resolveResult => {
    let settled = false; let req; let timer;
    const finish = result => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolveResult({ url: target, ...result });
    };
    try {
      req = requestImpl(target, { method: 'GET', family, rejectUnauthorized: true, headers: { accept: 'application/json', 'cache-control': 'no-cache', 'user-agent': 'Linro-deployment-check' } }, res => {
        let size = 0; const chunks = [];
        res.on('data', chunk => {
          const bytes = Buffer.from(chunk); size += bytes.length;
          if (size > 8192) { finish({ ok: false, reason: 'health_body_too_large', status: res.statusCode }); res.destroy(); req.destroy(); return; }
          chunks.push(bytes);
        });
        res.on('end', () => finish(assessHealth(res.statusCode, Buffer.concat(chunks).toString('utf8'), expectedVersion)));
        res.on('error', () => finish({ ok: false, reason: 'response_error' }));
        res.on('aborted', () => finish({ ok: false, reason: 'response_aborted' }));
      });
      req.on('error', error => finish({ ok: false, reason: /^ERR_TLS_|CERT_|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code ?? '') ? 'tls_error' : 'network_error', code: String(error.code ?? 'UNKNOWN').replace(/[^A-Z0-9_]/g, '').slice(0, 80) }));
      timer = setTimeout(() => { finish({ ok: false, reason: 'timeout' }); req.destroy(); }, timeoutMs);
      req.end();
    } catch { finish({ ok: false, reason: 'request_error' }); req?.destroy(); }
  });
}
export async function verifyDeployment(options, { probe = probeHealth, sleep = delay, log = console.log } = {}) {
  const required = Math.min(2, options.attempts);
  let consecutive = 0; let results = [];
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    results = await Promise.all(options.urls.map(url => probe(url, options)));
    for (const result of results) log(JSON.stringify({ attempt, ...result }));
    consecutive = results.length > 0 && results.every(result => result.ok) ? consecutive + 1 : 0;
    if (consecutive >= required) return { ok: true, attempts: attempt, results };
    if (attempt < options.attempts) await sleep(options.intervalMs);
  }
  return { ok: false, attempts: options.attempts, results };
}
async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) { console.log(HELP); return; }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Insecure TLS environment is not allowed for deployment verification.');
  options.expectedVersion ??= JSON.parse(await readFile(new URL('package.json', ROOT), 'utf8')).version;
  if (!options.urls.length) options.urls = configURLs(JSON.parse(await readFile(new URL('apps/redirect/wrangler.jsonc', ROOT), 'utf8')));
  const result = await verifyDeployment(options);
  if (!result.ok) {
    console.error('Public deployment NOT verified. Publishing may already have succeeded; no rollback or redeploy was performed. Inspect DNS, TLS/SNI, Worker bindings and version. See README section 7.4.');
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
