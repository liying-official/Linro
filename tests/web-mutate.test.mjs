import { newTestSecret } from './fixture-credentials.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { webController, deferred, settled, formEvent } from './web-controller.mjs';

const sampleToken = newTestSecret();
test('a token is visible and copyable before list refresh, after failure, and after retrying the read', async () => {
  const refresh = deferred();
  let reads = 0;
  const { app, calls } = webController({
    state: { modal: { type: 'token' } },
    request: (_, method) =>
      method === 'POST'
        ? { token: sampleToken }
        : ++reads === 1
          ? refresh.promise
          : [{ id: 'created' }],
  });
  const form = formEvent({ name: 'tool', scopes: ['links:read'], days: '7' });
  await app.submitToken(form);
  assert.equal(app.state.mutationPending, false);
  assert.deepEqual(app.state.modal, { type: 'secret', token: sampleToken });
  const markup = () => renderToStaticMarkup(app.renderModal());
  assert.match(markup(), new RegExp(`readonly=""[^>]*>${sampleToken}</textarea>`, 'i'));
  assert.match(markup(), /Copy token/i);
  refresh.reject(new Error('List unavailable'));
  await settled();
  assert.equal(app.state.error, 'List unavailable');
  await app.submitToken(form);
  await app.loadPage();
  assert.ok(markup().includes(sampleToken));
  assert.deepEqual(app.state.tokens, [{ id: 'created' }]);
  assert.deepEqual(
    calls.map(([path, method]) => [path, method]),
    [
      ['/tokens', 'POST'],
      ['/tokens', 'GET'],
      ['/tokens', 'GET'],
    ],
  );
  app.closeModal();
  assert.equal(app.state.modal, null);
});

test('navigation, canceled reads and closing a dialog cannot release a pending write', async () => {
  const write = deferred(),
    summary = deferred(),
    users = deferred();
  const { app, calls } = webController({
    state: { page: 'dashboard', modal: { type: 'link' }, session: { scopes: ['users:write'] } },
    request: (path) =>
      path === '/summary' ? summary.promise : path === '/users' ? users.promise : [],
  });
  const old = app.loadPage(),
    pending = app.mutate('links', () => write.promise);
  let duplicates = 0;
  const another = () =>
    app.mutate('tokens', async () => {
      duplicates++;
    });
  await another();
  app.closeModal();
  assert.equal(app.state.modal.type, 'link');
  await app.navigate('users', false);
  assert.equal(calls[0][3].aborted, true);
  users.resolve([]);
  await settled();
  assert.equal(app.state.pageLoading, false);
  assert.equal(app.state.mutationPending, true);
  await another();
  app.closeModal();
  summary.resolve({ links: 9 });
  await old;
  assert.equal(app.state.mutationPending, true);
  assert.deepEqual(
    calls.map(([path]) => path),
    ['/summary', '/users'],
  );
  write.resolve();
  await pending;
  assert.equal(app.state.mutationPending, false);
  await another();
  assert.equal(duplicates, 1);
});

test('same-tick writes are guarded even before React commits its state', async () => {
  const { app } = webController(),
    updates = [],
    write = deferred(),
    commit = app.setState;
  app.setState = (patch, cb) => updates.push(() => commit(patch, cb));
  let writes = 0;
  const submit = () =>
    app.mutate('links', () => {
      writes++;
      return write.promise;
    });
  const first = submit();
  await submit();
  assert.equal(writes, 1);
  assert.equal(app.state.mutationPending, false);
  write.resolve();
  await first;
  await submit();
  assert.equal(writes, 1);
  while (updates.length) updates.shift()();
  await submit();
  assert.equal(writes, 2);
});

test('failed mutations preserve editable forms and selection, and page failures stay visible', async () => {
  const modal = { type: 'link', row: { slug: 'docs' } };
  const { app, calls } = webController({
    state: { modal, selected: ['docs'], importRows: [{ slug: 'pending' }] },
  });
  await app.mutate('links', () => {
    throw new Error('Conflict');
  });
  assert.equal(app.state.modal, modal);
  assert.deepEqual(app.state.selected, ['docs']);
  assert.equal(app.state.modalError, 'Conflict');
  assert.equal(app.state.mutationPending, false);
  assert.equal(app.state.error, '');
  app.closeModal();
  await app.mutate('links', () => Promise.reject(new Error('Failed')));
  assert.equal(app.state.error, 'Failed');
  assert.equal(app.state.modalError, '');
  assert.equal(calls.length, 0);
});

for (const [resource, page, expected] of [
  ['links', 'links', ['/links']],
  ['domains', 'domains', ['/domains']],
  ['settings', 'settings', ['/settings']],
  ['tokens', 'tokens', ['/tokens']],
  ['users', 'users', ['/users']],
  ['links', 'tokens', []],
  ['domains', 'tokens', []],
  ['links', 'dashboard', ['/summary', '/links']],
])
  test(`${resource} mutation on ${page} refreshes only affected resources`, async () => {
    const { app, calls } = webController({
      state: { page, analytics: { available: true } },
      request: (path) => (path.startsWith('/links?') ? { items: [], next_cursor: null } : []),
    });
    await app.mutate(resource, async () => {}, 'Saved');
    await settled();
    assert.equal(app.state.notice, 'Saved');
    assert.deepEqual(
      calls.map(([url]) => url.split('?')[0]),
      expected,
    );
    if (resource === 'domains' && page === 'tokens') {
      assert.equal(app.state.directoryLoaded, false);
      await app.navigate('links', false);
      await settled();
      assert.equal(calls[0][0], '/domains?view=directory');
    }
  });

test('failed refresh preserves a successful write and read retries cannot replay it', async () => {
  const { app, calls } = webController({
    state: { page: 'domains', modal: { type: 'domain' } },
    request: () => Promise.reject(new Error('List unavailable')),
  });
  let writes = 0;
  await app.mutate(
    'domains',
    async () => {
      writes++;
    },
    'Saved',
  );
  await settled();
  assert.equal(app.state.modal, null);
  assert.equal(app.state.error, 'List unavailable');
  assert.equal(app.state.notice, 'Saved');
  await app.loadPage();
  assert.equal(writes, 1);
  assert.equal(calls.length, 2);
});

test('dashboard skips stats when canceled after recent links and otherwise requests the reduced view', async () => {
  const links = deferred();
  const { app, calls } = webController({
    state: { page: 'dashboard' },
    request: (path) => (path.startsWith('/links?') ? links.promise : {}),
  });
  const old = app.loadPage();
  await settled();
  await app.navigate('tokens', false);
  links.resolve({ items: [] });
  await old;
  assert.ok(!calls.some(([path]) => path.startsWith('/stats')));
  await app.navigate('dashboard', false);
  await settled();
  assert.ok(calls.some(([path]) => path === '/stats?days=7&view=dashboard'));
});
