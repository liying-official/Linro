import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { configs, validateConfig } from '../scripts/config-lib.mjs';
import { auditLinks } from '../scripts/security-audit.mjs';
const valid = { account_id: 'b'.repeat(32), database_id: '11111111-1111-4111-8111-111111111111', admin_host: 'admin.example.com', redirect_hosts: ['go.example.com'], access_issuer: 'https://test.cloudflareaccess.com', access_aud: 'a'.repeat(64), owner_email: 'owner@example.com' };
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
async function isolated(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cf-links-v111-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(new URL('scripts/', root), join(dir, 'scripts'), { recursive: true });
  return dir;
}
async function preflight(t, pair) {
  const dir = await isolated(t);
  for (const name of ['admin', 'redirect']) { await mkdir(join(dir, 'apps', name), { recursive: true }); await writeFile(join(dir, 'apps', name, 'wrangler.jsonc'), JSON.stringify(pair[name])); }
  return spawnSync(process.execPath, ['scripts/preflight.mjs'], { cwd: dir, encoding: 'utf8' });
}
for (const enabled of [undefined, false, true]) test(`device trust configuration is explicit on both Workers: input ${enabled}`, async t => {
  const pair = configs({ ...valid, ...(enabled === undefined ? {} : { cloudflare_device_type_enabled: enabled }) });
  for (const worker of [pair.admin, pair.redirect]) assert.equal(worker.vars.CLOUDFLARE_DEVICE_TYPE_ENABLED, String(enabled === true));
  assert.equal((await preflight(t, pair)).status, 0);
});
test('device trust requires a boolean, not a truthy string or object', () => {
  for (const value of ['true', 'false', 1, null, [], {}]) assert.throws(() => validateConfig({ ...valid, cloudflare_device_type_enabled: value }));
});
test('preflight refuses missing, malformed or inconsistent device trust vars', async t => {
  for (const change of [p => delete p.redirect.vars.CLOUDFLARE_DEVICE_TYPE_ENABLED, p => p.admin.vars.CLOUDFLARE_DEVICE_TYPE_ENABLED = 'true', p => p.redirect.vars.CLOUDFLARE_DEVICE_TYPE_ENABLED = 'yes']) {
    const pair = configs(valid); change(pair); assert.equal((await preflight(t, pair)).status, 1);
  }
});
test('local initializer defaults device data to none and preserves both secrets and existing local state', async t => {
  const dir = await isolated(t); await mkdir(join(dir,'.local','state'), { recursive: true });
  const saved = 'LOCAL_DEV_TOKEN="' + 'a'.repeat(43) + '"\nLINK_PASSWORD_SECRET="' + 'b'.repeat(43) + '"\n';
  await writeFile(join(dir,'.local','.dev.vars'), saved); await writeFile(join(dir,'.local','state','keep.txt'), 'existing state');
  for (let i=0;i<2;i++) { const run = spawnSync(process.execPath, ['scripts/local-init.mjs','--kv'], { cwd: dir, encoding: 'utf8' }); assert.equal(run.status,0,run.stderr); }
  assert.equal((await readFile(join(dir,'.local','.dev.vars'),'utf8')).replace(/^BROWSER_CHECK_SECRET=.+\n/gm,''), saved);
  assert.equal(await readFile(join(dir,'.local','state','keep.txt'),'utf8'), 'existing state');
  for (const name of ['admin','redirect']) { const cfg = JSON.parse(await readFile(join(dir,'.local',name+'.jsonc'),'utf8')); assert.equal(cfg.vars.CLOUDFLARE_DEVICE_TYPE_ENABLED,'false'); assert.equal(cfg.kv_namespaces[0].binding,'REDIRECT_CACHE'); }
});
test('current WAF documentation describes code-defined IP buckets and narrows protection to unlock POSTs', async () => {
  const doc = await read('docs/GUIDE.md');
  assert.match(doc,/来源 IP 的 SHA-256 哈希/);assert.match(doc,/不是连接级计数/);
  assert.match(doc,/http\.request\.method eq "POST"/);
  assert.match(doc,/starts_with\(http\.request\.uri\.path, "\/__Linro_unlock\/"\)/);
  assert.match(doc,/每个 key、每个 Cloudflare 位置 5 次 \/ 60 秒/);
  assert.match(doc,/不是全球单一原子计数器/);
  assert.match(doc,/不能承诺免费计划支持/);
  assert.match(doc,/不自动调用 Cloudflare 账户创建规则/);
  assert.doesNotMatch(doc,/默认每 IP\/位置每 60 秒 5 次/);
});
test('current analytics docs distinguish browser and IP timezones and do not promise a device value by default', async () => {
  const doc = await read('docs/GUIDE.md');
  assert.match(doc,/不是浏览器/); assert.match(doc,/CF-Device-Type/);
  assert.match(doc,/"cloudflare_device_type_enabled": false/);
  assert.match(doc,/none/); assert.match(doc,/blob6/); assert.match(doc,/blob7/);
  assert.match(doc,/8.*顺序|八.*顺序/); assert.match(doc,/link_ids/);
});
test('text audit accepts the stored sentinel and public empty target without exposing content', () => {
  for (const target_url of ['about:blank','']) {
    const input = { links: [{ id:'fixture', slug:'docs', response_mode:'text', text_content:'DO_NOT_LOG_BODY\n正文', target_url, query_mode:'discard', created_by:'owner', geo_rules:[], cache_ttl:0 }] };
    const before = JSON.stringify(input); const result = auditLinks(input,valid);
    assert.deepEqual(result.findings[0].codes,['plain_text_export_contains_content']);
    assert.doesNotMatch(JSON.stringify(result),/DO_NOT_LOG_BODY|正文|about:blank/); assert.equal(JSON.stringify(input),before);
  }
});
test('text audit does not call invalid content or text-plus-geo a clean record', () => {
  const result = auditLinks([{slug:'bad',response_mode:'text',text_content:'',query_mode:'discard',created_by:'owner',geo_rules:[{kind:'country',code:'JP',target_url:'https://example.net/'}]}],valid);
  assert.ok(result.findings[0].codes.includes('invalid_text_content')); assert.ok(result.findings[0].codes.includes('text_geo_conflict'));
});
test('release requirements cover new migration, server validators and both GUI modules', async () => {
  const src = await read('scripts/package-source.mjs');
  for (const name of ['migrations/0003_text_responses.sql','packages/shared/src/text-response.ts','packages/shared/src/visitor-dimensions.ts','apps/admin/src/web/response-ui.ts','apps/admin/src/web/AnalyticsSelection.tsx']) assert.ok(src.includes(name),name);
  // Never compare the operator's configured files with public template hashes.
  // Build reviewed public fixtures in memory, as the release tests do.
  const templates = configs({ account_id: '1'.repeat(32), database_id: '11111111-1111-4111-8111-111111111111', admin_host: 'admin.example.com', redirect_hosts: ['go.example.com'], access_issuer: 'https://your-team.cloudflareaccess.com', access_aud: 'a'.repeat(64), owner_email: 'owner@example.com', analytics_enabled: false });
  templates.admin.account_id = templates.redirect.account_id = '0'.repeat(32);
  templates.admin.vars.ACCESS_AUD = 'YOUR_ACCESS_APPLICATION_AUD';
  for (const [path, bytes] of [
    ['apps/admin/wrangler.jsonc', JSON.stringify(templates.admin,null,2)+'\n'],
    ['apps/redirect/wrangler.jsonc', JSON.stringify(templates.redirect,null,2)+'\n'],
    ['deployment.example.json', await read('deployment.example.json')],
  ]) {
    const hash=createHash('sha256').update(bytes).digest('hex'); assert.ok(src.includes(hash),path);
  }
});
