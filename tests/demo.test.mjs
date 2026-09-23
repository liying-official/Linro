import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { api, enterDemo, leaveDemo, resetDemo, setDemoRole, previewLink } from '../apps/demo/src/store.mjs';

test('demo login is case-sensitive and resets all simulated changes on leaving', async () => {
  resetDemo();
  await assert.rejects(api('/session'), e => e.status === 401);
  assert.equal(enterDemo('linro'), false);
  assert.equal(enterDemo('Linro'), true);
  const domains = await api('/domains');
  const row = await api('/links', 'POST', { domain_id: domains[0].id, slug: 'local-change', target_url: 'https://content.example/test' });
  assert.equal(previewLink(row.short_url).slug, 'local-change');
  leaveDemo(); enterDemo('Linro');
  assert.equal((await api('/links?q=local-change')).total, 0);
});

test('demo rejects real hostnames, IP literals, email domains, and unsafe regional destinations', async () => {
  resetDemo(); enterDemo('Linro'); const [domain] = await api('/domains');
  for (const hostname of ['github.com', '192.0.2.1', 'localhost']) await assert.rejects(api('/domains','POST',{hostname}));
  await assert.rejects(api('/users','POST',{email:'person@github.com'}));
  await assert.rejects(api('/links','POST',{domain_id:domain.id,target_url:'https://192.0.2.1/test'}));
  await assert.rejects(api('/links','POST',{domain_id:domain.id,target_url:'https://content.example/test',geo_rules:[{kind:'country',code:'JP',target_url:'https://github.com/'}]}));
  assert.equal((await api('/domains','POST',{hostname:'third.example'})).hostname,'third.example');
});

test('demo roles, version conflicts, import atomicity, and domain references work without a network', async () => {
  resetDemo(); enterDemo('Linro');
  const realFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('Unexpected network access'); };
  try {
    const [domain] = await api('/domains');
    const row = await api('/links','POST',{domain_id:domain.id,slug:'new',target_url:'https://content.example/new'});
    const changed = await api('/links/'+row.id,'PATCH',{version:row.version,title:'Changed'});
    assert.equal(changed.version,2);
    await assert.rejects(api('/links/'+row.id,'PATCH',{version:1,title:'Stale'}),e=>e.status===409);
    await assert.rejects(api('/domains/'+domain.id+'?version=1','DELETE'),e=>e.status===409);
    const count=(await api('/summary')).links;
    await assert.rejects(api('/links/import','POST',{links:[{domain_id:domain.id,slug:'atomic',target_url:'https://content.example/ok'},{domain_id:domain.id,slug:'bad',target_url:'https://github.com'}]}));
    assert.equal((await api('/summary')).links,count);
    setDemoRole('viewer');
    await assert.rejects(api('/links','POST',{domain_id:domain.id,target_url:'https://content.example/x'}),e=>e.status===403);
    setDemoRole('editor');
    await assert.rejects(api('/links/'+row.id+'?version=2','DELETE'),e=>e.code==='link_owner_required');
    setDemoRole('owner');
    const token=await api('/tokens','POST',{name:'Demo',scopes:['links:read'],expires_at:2000000000});
    assert.match(token.token,/^DEMO_ONLY_NOT_A_REAL_TOKEN_/);
    assert.doesNotMatch(token.token,/^Linro_/);
    assert.equal((await api('/stats?days=7')).timeline.length,7);
  } finally { globalThis.fetch=realFetch; }
});

test('static demo uses isolated transport, restrictive connections, and a relative asset base', async () => {
  const read = f => readFile(new URL('../'+f,import.meta.url),'utf8');
  assert.match(await read('apps/demo/index.html'), /connect-src 'none'/);
  assert.match(await read('apps/demo/index.html'), /form-action 'none'/);
  const config = await read('apps/demo/vite.config.ts');
  assert.match(config,/base: '\.\/'/); assert.match(config,/src\/client\.ts/);
  assert.doesNotMatch(await read('apps/admin/vite.config.ts'),/demo|store\.mjs/);
  assert.match(await read('apps/admin/src/web/client.ts'),/\/Linro\/v1/);
});
