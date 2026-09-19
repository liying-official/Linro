import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setup, createLink, redirect } from './harness.mjs';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/smoke.mjs', import.meta.url));

// Loopback HTTP -> actual Redirect Worker -> real SQLite. Not workerd/remote D1.
async function endpoint(t, linkOptions = {}) {
  const { env, domain } = await setup();
  t.after(() => env.DB.close());
  await createLink(env, domain, linkOptions);
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({ method: request.method, path: request.url });
    try {
      const result = await redirect.fetch(new Request('https://go.example.com' + request.url, { method: request.method }), env);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.writeHead(500); response.end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}
async function run(args) {
  try { const result = await execute(process.execPath, [script, ...args], { timeout: 10000 }); return { code: 0, ...result }; }
  catch (error) { if (typeof error.code !== 'number') throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
}

test('README smoke command works when only the public hostname is replaced with the local endpoint', async t => {
  const { origin, requests } = await endpoint(t);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const command = readme.match(/^node scripts\/smoke\.mjs .+$/m)?.[0];
  assert.ok(command, 'README must include a complete smoke command.');
  const args = command.match(/"[^"\n]*"|'[^'\n]*'|\S+/g).slice(2).map(part => part.replace(/^(["'])(.*)\1$/, '$2').replace('https://go.example.com', origin));
  const result = await run(args);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /PASS GET: 301/);
  assert.match(result.stdout, /PASS HEAD: 301/);
  assert.deepEqual(requests, [{ method: 'GET', path: '/docs' }, { method: 'HEAD', path: '/docs' }]);
});

test('named smoke arguments validate 308 and preserve query parameters without following the target', async t => {
  const target = 'https://example.org/docs?a=1&b=two';
  const { origin, requests } = await endpoint(t, { target_url: target, redirect_code: 308 });
  const result = await run(['--short-url', `${origin}/docs`, '--expected-location', target, '--code', '308']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /PASS GET: 308/);
  assert.match(result.stdout, /PASS HEAD: 308/);
  assert.equal(requests.length, 2);
});

test('smoke rejects incorrect status or Location with a nonzero exit code', async t => {
  const { origin } = await endpoint(t);
  const wrongStatus = await run(['--short-url', `${origin}/docs`, '--expected-location', 'https://example.org/docs', '--code', '302']);
  assert.equal(wrongStatus.code, 1);
  assert.match(wrongStatus.stderr, /GET: expected 302/);
  const wrongTarget = await run(['--short-url', `${origin}/docs`, '--expected-location', 'https://example.net/wrong', '--code', '301']);
  assert.equal(wrongTarget.code, 1);
  assert.match(wrongTarget.stderr, /GET: expected 301 Location/);
});

test('smoke rejects cacheable fixtures and the obsolete positional invocation', async t => {
  const { origin } = await endpoint(t, { cache_ttl: 60 });
  const cached = await run(['--short-url', `${origin}/docs`, '--expected-location', 'https://example.org/docs', '--code', '301']);
  assert.equal(cached.code, 1);
  assert.match(cached.stderr, /no-store header not found/);
  const positional = await run([`${origin}/docs`, 'https://example.org/docs', '301']);
  assert.equal(positional.code, 1);
  assert.match(positional.stderr, /Usage:.*--short-url.*--expected-location/);
});
