import test from 'node:test';
import assert from 'node:assert/strict';
import { webController, formEvent, settled } from './web-controller.mjs';

const state = () => ({
  modal: { type: 'import' },
  domains: [{ id: 'd', hostname: 'go.example' }],
  importRows: Array.from({ length: 22 }, (_, i) => ({
    slug: 'i' + i,
    target_url: 'https://content.example/' + i,
  })),
});
const form = () => formEvent({ domain_id: 'd' });

test('only a pre-write rate limit is retried after Retry-After, and manual resume starts at the saved batch', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const groups = [];
  let blocked = 0;
  const { app, APIError } = webController({
    state: state(),
    request: (_path, _method, { links }) => {
      groups.push(links.map((l) => l.slug));
      if (links[0].slug === 'i10' && blocked++ < 2)
        throw new APIError('Slow down', 429, 'rate_limited', 'request', 60000);
      return {};
    },
  });
  await app.submitImport(form());
  assert.equal(app.state.importDone, 10);
  assert.equal(app.state.importStatus, 'retrying');
  await app.submitImport(form());
  assert.equal(groups.length, 2);
  t.mock.timers.tick(59999);
  await settled();
  assert.equal(groups.length, 2);
  t.mock.timers.tick(1);
  await settled();
  assert.equal(groups.length, 3);
  assert.equal(app.state.importStatus, 'waiting');
  t.mock.timers.tick(60000);
  await settled();
  assert.equal(groups.length, 3);
  assert.equal(app.state.importStatus, 'resume');
  await app.submitImport(form());
  assert.deepEqual(
    groups.map((group) => group[0]),
    ['i0', 'i10', 'i10', 'i10', 'i20'],
  );
  assert.equal(app.state.importDone, 22);
  assert.equal(app.state.modal, null);
});

test('closing a rate-limited import cancels the scheduled retry', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const { app, APIError, calls } = webController({
    state: state(),
    request: () => {
      throw new APIError('Too many requests', 429, 'rate_limited', undefined, 1000);
    },
  });
  await app.submitImport(form());
  app.closeModal();
  t.mock.timers.tick(2000);
  await settled();
  assert.equal(calls.length, 1);
  assert.equal(app.state.modal, null);
});

for (const kind of ['connection lost', 'unexpected 429', 'timeout', 'transaction error'])
  test('import requires reconciliation after ' + kind, async () => {
    let writes = 0;
    const { app, APIError } = webController({
      state: state(),
      request: () => {
        if (++writes === 1) return {};
        if (kind === 'unexpected 429')
          throw new APIError('provider throttled', 429, 'provider_error', undefined, 0);
        if (kind === 'transaction error') throw new APIError('failed', 500, 'internal_error');
        throw new Error(kind);
      },
    });
    await app.submitImport(form());
    assert.equal(app.state.importStatus, 'review');
    assert.equal(app.state.importDone, 10);
    assert.match(app.state.modalError, /Confirmed imports: 10/);
    await app.submitImport(form());
    assert.equal(writes, 2);
  });
