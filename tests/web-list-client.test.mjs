import test from 'node:test';
import assert from 'node:assert/strict';
import { webController, settled } from './web-controller.mjs';

test('link browsing moves forward and back, and new filters clear the old cursor', async () => {
  const { app, calls } = webController({
    state: { page: 'links' },
    request: (path) => {
      const cursor = new URL(path, 'https://fixture.test').searchParams.get('cursor');
      return { items: [{ id: cursor || 'first' }], next_cursor: cursor ? null : 'opaque/+=cursor' };
    },
  });
  await app.loadPage();
  app.changeLinkPage(true);
  await settled();
  assert.equal(app.state.links[0].id, 'opaque/+=cursor');
  app.changeLinkPage(false);
  await settled();
  assert.equal(app.state.links[0].id, 'first');
  app.changeLinkPage(true);
  await settled();
  app.setLinkFilters({ searchQuery: 'docs' });
  await settled();
  const params = new URL(calls.at(-1)[0], 'https://fixture.test').searchParams;
  assert.equal(params.get('q'), 'docs');
  assert.equal(params.has('cursor'), false);
  assert.equal(params.get('pagination'), 'cursor');
  assert.equal(params.has('include_total'), false);
});

test('the picker retains only a projection of the visible page and at most 50 selected links', () => {
  const { module } = webController();
  const { pickerRows, selectedRows, toggleRow } = module('link-list.ts');
  let selected = [],
    page = [];
  for (let i = 0; i < 120; i++) {
    page = pickerRows(
      Array.from({ length: 25 }, (_, j) => ({
        id: String(i * 25 + j),
        hostname: 'go.example',
        slug: 'item-' + j,
        text_content: 'x'.repeat(32768),
        description: 'large',
      })),
    );
    selected = selectedRows(
      selected.map((r) => r.id),
      selected,
      page,
    );
    selected = toggleRow(selected, page[0], true);
    assert.ok(selected.length + page.length <= 75);
  }
  assert.equal(selected.length, 50);
  assert.equal(selected[0].id, '0');
  assert.deepEqual(Object.keys(selected[0]).sort(), ['hostname', 'id', 'slug']);
  assert.deepEqual(Object.keys(page[24]).sort(), ['hostname', 'id', 'slug']);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 3000);
  assert.equal(toggleRow(selected, selected[0], false).length, 49);
});

test('large JSON export uses keyset pages, compares first and final counts, and includes full domain metadata', async () => {
  const useTotal = [],
    files = [];
  const { app, calls } = webController({
    download: (name, bytes) => files.push([name, JSON.parse(bytes)]),
    state: { domains: [{ id: 'directory-only' }] },
    request: (path) => {
      if (path === '/domains')
        return [{ id: 'domain', version: 9, link_count: 240, name: 'Full domain' }];
      const p = new URL(path, 'https://fixture.test').searchParams,
        start = Number(p.get('cursor') ?? 0);
      assert.equal(p.get('pagination'), 'cursor');
      assert.equal(p.has('page'), false);
      const counted = p.get('include_total') === 'true';
      useTotal.push(counted);
      return {
        items: Array.from({ length: Math.min(100, 240 - start) }, (_, i) => ({
          id: String(start + i),
        })),
        next_cursor: start + 100 < 240 ? String(start + 100) : null,
        ...(counted ? { total: 240 } : {}),
      };
    },
  });
  await app.exportLinks('json');
  assert.deepEqual(useTotal, [true, false, true]);
  assert.equal(calls.length, 4);
  assert.match(files[0][0], /\.json$/);
  assert.equal(files[0][1].links.length, 240);
  assert.equal(files[0][1].domains[0].link_count, 240);
  assert.equal(app.state.exporting, false);
});

for (const kind of ['changed total', 'duplicate', 'over limit'])
  test('export rejects ' + kind + ' without a download', async () => {
    let pages = 0,
      downloads = 0;
    const { app } = webController({
      download: () => {
        downloads++;
      },
      request: () => {
        if (kind === 'over limit') return { items: [], next_cursor: null, total: 10001 };
        if (pages++ === 0)
          return {
            items: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })),
            next_cursor: 'next',
            total: 101,
          };
        return {
          items: [{ id: kind === 'duplicate' ? '0' : '100' }],
          next_cursor: null,
          total: kind === 'changed total' ? 102 : 101,
        };
      },
    });
    await app.exportLinks('csv');
    assert.equal(downloads, 0);
    assert.ok(app.state.error);
  });

test('the browser transport combines the page signal with its deadline and preserves Retry-After', async (t) => {
  const { productionApi, APIError, app } = webController();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { hostname: 'console.fixture.test' },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'location', original);
    else delete globalThis.location;
  });
  const request = new AbortController();
  const fake = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/Linro/v1/summary');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.headers['X-Linro-CSRF'], '1');
    assert.ok(init.signal);
    assert.notEqual(init.signal, request.signal);
    return new Promise((_, reject) =>
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }),
    );
  });
  const pending = productionApi('/summary', 'GET', undefined, request.signal);
  request.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  fake.mock.mockImplementation(async () =>
    Response.json(
      { ok: false, error: { code: 'rate_limited', message: 'limit', request_id: 'req1' } },
      { status: 429, headers: { 'Retry-After': '60' } },
    ),
  );
  await assert.rejects(
    productionApi('/links/import', 'POST', { links: [] }),
    (e) =>
      e instanceof APIError &&
      e.code === 'rate_limited' &&
      e.retryAfterMs === 60000 &&
      app.message(e) === 'Too many requests. [req1]',
  );
  fake.mock.mockImplementation(
    async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
  );
  await assert.rejects(
    productionApi('/session'),
    (e) => app.message(e).includes('Cloudflare Access') && !/[\u4e00-\u9fff]/.test(app.message(e)),
  );
  app.state.locale = 'zh-CN';
  await assert.rejects(productionApi('/session'), (e) => app.message(e).includes('登录'));
});

test('CSV input errors carry stable codes and localize their exact row in both languages', () => {
  const { app, module } = webController();
  const { parseCSV } = module('csv.ts');
  for (const [csv, code] of [
    ['slug,slug\na,b', 'csv_invalid_headers'],
    ['slug\n"open', 'csv_unclosed_quote'],
    ['slug,title\na,one\nb', 'csv_column_count'],
  ]) {
    let failure;
    try {
      parseCSV(csv);
    } catch (e) {
      failure = e;
    }
    assert.equal(failure.code, code);
    app.state.locale = 'en';
    const en = app.message(failure);
    assert.ok(!/[\u4e00-\u9fff]/.test(en));
    app.state.locale = 'zh-CN';
    const zh = app.message(failure);
    assert.match(zh, /[\u4e00-\u9fff]/);
    if (code === 'csv_column_count') {
      assert.match(en, /Row 3/);
      assert.match(zh, /第 3 行/);
    }
  }
});
