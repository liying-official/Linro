import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { healthURL, parseOptions, configURLs, assessHealth, probeHealth, verifyDeployment } from '../scripts/check-deployment.mjs';
const url = 'https://go.example.com/health';
const version = '1.1.0-fix';
const ok = JSON.stringify({ status: 'ok', version });

// Transport seam tests do not contact example hosts or simulate real TLS.
function transport({ status = 200, body = ok, error, stalled = false, responseEvent } = {}) {
  const calls = []; let destroyed = 0;
  const request = (target, options, callback) => {
    calls.push({ target, options });
    const req = new EventEmitter(); req.destroy = () => { destroyed++; };
    req.end = () => queueMicrotask(() => {
      if (error) { req.emit('error', error); return; }
      const res = new EventEmitter(); res.statusCode = status; res.destroy = () => { destroyed++; };
      callback(res);
      if (responseEvent) { res.emit(responseEvent, new Error('hidden-response-detail')); return; }
      if (stalled) return;
      res.emit('data', Buffer.from(body)); res.emit('end');
    });
    return req;
  };
  return { request, calls, destroyed: () => destroyed };
}

test('deployment probes accept only credential-free HTTPS /health URLs', () => {
  assert.equal(healthURL(url), url);
  for (const bad of ['http://go.example.com/health', 'https://u:p@go.example.com/health', 'https://go.example.com/docs', url + '?token=secret', url + '#fragment']) assert.throws(() => healthURL(bad));
});
test('probe CLI validates bounds, family, versions, duplicate URLs and unknown arguments', () => {
  const opts = parseOptions(['--url', url, '--url', url, '--expected-version', version, '--family', '6', '--attempts', '3', '--interval-ms', '0', '--timeout-ms', '500']);
  assert.deepEqual(opts, { urls: [url], expectedVersion: version, family: 6, attempts: 3, intervalMs: 0, timeoutMs: 500 });
  for (const args of [['--family','5'], ['--attempts','0'], ['--attempts','61'], ['--timeout-ms','99'], ['--interval-ms','-1'], ['--url'], ['--unknown'], ['--expected-version','a\nb'], ['--attempts','1.5']]) assert.throws(() => parseOptions(args));
  assert.deepEqual(parseOptions(['--help']), { help: true });
});
test('default probe discovery requires generated production Custom Domains, not public templates', () => {
  const c = { account_id: 'a'.repeat(32), vars: { ENVIRONMENT: 'production' }, routes: [{ pattern: 'go.example.com', custom_domain: true }] };
  assert.deepEqual(configURLs(c), [url]);
  for (const bad of [{ ...c, account_id: '0'.repeat(32) }, { ...c, vars: { ENVIRONMENT: 'development' } }, { ...c, routes: [] }, { ...c, routes: [{ pattern: 'go.example.com/*', custom_domain: false }] }, { ...c, routes: [{ pattern: 'https://go.example.com', custom_domain: true }] }]) assert.throws(() => configURLs(bad));
});
test('HTTP success alone is insufficient: JSON, status and expected version must agree', () => {
  assert.equal(assessHealth(200, ok, version).ok, true);
  assert.equal(assessHealth(200, '{"status":"ok"}', undefined).ok, false);
  for (const [status, body, reason] of [[302, ok, 'http_status'], [503, ok, 'http_status'], [200,'<html>Access</html>','invalid_health_json'], [200,'null','invalid_health_payload'], [200,'{"status":"error"}','invalid_health_payload'], [200,'{"status":"ok","version":"old"}','version_mismatch']]) {
    assert.deepEqual(assessHealth(status, body, version), { ok: false, status, reason });
  }
});
test('HTTPS probe never follows a 302 and always verifies peer certificate and hostname', async () => {
  const f = transport({ status: 302, body: 'redirect elsewhere' });
  const result = await probeHealth(url, { expectedVersion: version, family: 4 }, f.request);
  assert.equal(result.reason, 'http_status'); assert.equal(result.status, 302); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.rejectUnauthorized, true); assert.equal(f.calls[0].options.family, 4);
  assert.equal(f.calls[0].options.method, 'GET'); assert.equal(f.calls[0].options.headers.authorization, undefined);
});
test('health probe bounds response size and does not report raw body data', async () => {
  const f = transport({ body: 'private-response-data'.repeat(600) });
  const result = await probeHealth(url, { expectedVersion: version }, f.request);
  assert.equal(result.ok, false); assert.equal(result.reason, 'health_body_too_large'); assert.ok(f.destroyed() > 0);
  assert.doesNotMatch(JSON.stringify(result), /private-response-data/);
});
test('health probe has an end-to-end deadline even after receiving response headers', async () => {
  const f = transport({ stalled: true });
  const result = await probeHealth(url, { expectedVersion: version, timeoutMs: 20 }, f.request);
  assert.equal(result.reason, 'timeout'); assert.ok(f.destroyed() > 0);
});
test('transport failures are bounded classifications, not fabricated missing-certificate diagnoses', async () => {
  for (const [code, reason] of [['ERR_TLS_CERT_ALTNAME_INVALID','tls_error'], ['CERT_HAS_EXPIRED','tls_error'], ['ECONNRESET','network_error'], ['EAI_AGAIN','network_error']]) {
    const f = transport({ error: Object.assign(new Error('secret value should not appear'), { code }) });
    const r = await probeHealth(url, { expectedVersion: version }, f.request);
    assert.equal(r.reason, reason); assert.equal(r.code, code); assert.doesNotMatch(JSON.stringify(r), /secret value/);
  }
});
test('response errors and aborts fail rather than accepting a partial healthy JSON body', async () => {
  for (const event of ['error','aborted']) {
    const f = transport({ responseEvent: event });
    assert.equal((await probeHealth(url, { expectedVersion: version }, f.request)).ok, false);
  }
});
test('deployment verification requires two consecutive healthy rounds for every configured hostname', async () => {
  let hits = 0; let sleeps = 0; const logs=[];
  const urls = [url, 'https://s.example.com/health'];
  const options = { urls, expectedVersion: version, attempts: 5, intervalMs: 0 };
  const result = await verifyDeployment(options, { probe: async target => ({ url: target, ok: ++hits > 2 }), sleep: async () => { sleeps++; }, log: value => logs.push(JSON.parse(value)) });
  assert.equal(result.ok, true); assert.equal(result.attempts, 3); assert.equal(hits, 6); assert.equal(sleeps, 2); assert.equal(logs.length, 6);
});
test('flapping and empty deployment results cannot pass; retries are bounded', async () => {
  let n = 0; const options = { urls: [url], attempts: 4, intervalMs: 0 };
  const r = await verifyDeployment(options, { probe: async () => ({ ok: ++n % 2 === 0 }), sleep: async () => {}, log: () => {} });
  assert.equal(r.ok, false); assert.equal(n, 4);
  assert.equal((await verifyDeployment({ ...options, urls: [] }, { sleep: async () => {}, log: () => {} })).ok, false);
});
test('explicit single-attempt mode is available for a one-shot manual diagnostic', async () => {
  const r = await verifyDeployment({ urls: [url], attempts: 1 }, { probe: async () => ({ ok: true }), log: () => {} });
  assert.equal(r.ok, true); assert.equal(r.attempts, 1);
});
test('probe CLI is read-only, help works and insecure TLS environment is rejected before networking', () => {
  assert.match(execFileSync(process.execPath, ['scripts/check-deployment.mjs','--help'], { encoding: 'utf8' }), /Read-only HTTPS probes/);
  const r = spawnSync(process.execPath, ['scripts/check-deployment.mjs','--url',url], { env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /Insecure TLS environment/);
  const source=readFileSync(new URL('../scripts/check-deployment.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source, /from ['"]node:child_process|rejectUnauthorized:\s*false|fetch\(/);
});
test('redirect publish is followed by the read-only verifier without bypassing preflight or native gates', () => {
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts['deploy:redirect'], 'npm run preflight && wrangler deploy --config apps/redirect/wrangler.jsonc && npm run verify:deployment');
  assert.match(pkg.scripts.deploy, /npm run test:runtime && npm run deploy:admin && npm run deploy:redirect/);
});
