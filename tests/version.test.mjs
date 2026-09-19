import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../.build/packages/shared/src/platform.js';
import { environment, call, admin, redirect } from './harness.mjs';
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package, shared constant, both health endpoints, session and system health report one release', async t => {
  assert.equal(VERSION, manifest.version);
  const env = environment();
  t.after(() => env.DB.close());
  for (const [worker, url] of [[admin, env.ADMIN_ORIGIN + '/health'], [redirect, 'https://go.example.com/health']]) {
    const response = await worker.fetch(new Request(url, { headers: { 'X-Linro-Dev': env.LOCAL_DEV_TOKEN } }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal((body.data ?? body).version, VERSION);
  }
  for (const route of ['/session', '/system/health']) {
    const result = await call(env, route);
    assert.equal(result.status, 200);
    assert.equal(result.data.version, VERSION);
  }
});

test('GUI version labels and JSON export metadata use the shared release constant', () => {
  const app = readFileSync(new URL('../apps/admin/src/web/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /import \{ VERSION \} from '\.\.\/\.\.\/\.\.\/\.\.\/packages\/shared\/src\/platform';/);
  assert.ok((app.match(/v\{VERSION\}/g) ?? []).length >= 1);
  assert.match(app, /format: 'linro', version: VERSION/);
  assert.doesNotMatch(app, /v1\.0\.0(?:-fix)?|version: '1\.0\.0(?:-fix)?'/);
});
