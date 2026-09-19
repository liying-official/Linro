import test from 'node:test';
import assert from 'node:assert/strict';
import { configs, validateConfig } from '../scripts/config-lib.mjs';
const valid = { account_id: 'a'.repeat(32), database_id: '12345678-1234-4234-8234-123456789abc', admin_host: 'admin.example.com', redirect_hosts: ['go.example.com'], access_issuer: 'https://example.cloudflareaccess.com', access_aud: 'b'.repeat(64), owner_email: 'OWNER@example.com', analytics_enabled: false };
test('configuration keeps admin/redirect isolated, sharing D1 with no alternate production hostnames', () => {
  const { admin, redirect } = configs(valid);
  assert.equal(admin.assets.run_worker_first, true); assert.equal(admin.assets.binding, 'ASSETS');
  assert.equal(admin.d1_databases[0].database_id, redirect.d1_databases[0].database_id);
  assert.equal(admin.workers_dev, false); assert.equal(admin.preview_urls, false); assert.equal(redirect.workers_dev, false);
  assert.equal(admin.vars.BOOTSTRAP_OWNER_EMAIL, 'owner@example.com');
  assert.equal(admin.triggers, undefined); assert.equal(redirect.analytics_engine_datasets, undefined);
});
test('enabling analytics adds write binding only to redirect and scheduled querying to admin', () => {
  const { admin, redirect } = configs({ ...valid, analytics_enabled: true });
  assert.equal(redirect.analytics_engine_datasets[0].binding, 'ANALYTICS'); assert.equal(admin.analytics_engine_datasets, undefined);
  assert.deepEqual(admin.triggers.crons, ['*/15 * * * *']); assert.equal(admin.vars.ANALYTICS_ENABLED, 'true');
  assert.ok(!JSON.stringify(admin).includes('ANALYTICS_API_TOKEN'));
});
test('configuration validation blocks placeholders, mixed domains, injected identifiers and malformed hosts', () => {
  for (const change of [{ account_id: '0'.repeat(32) }, { database_id: 'invalid' }, { admin_host: 'https://admin.example.com' }, { redirect_hosts: ['admin.example.com'] }, { redirect_hosts: ['go.example.com', 'go.example.com'] }, { access_issuer: 'https://evil.example' }, { access_aud: 'REPLACE_WITH_YOUR_AUD' }, { analytics_dataset: 'a; DROP TABLE links' }, { auth_rate_namespace: '3', write_rate_namespace: '3' }, { analytics_enabled: 'true' }]) assert.throws(() => validateConfig({ ...valid, ...change }));
});
