import { testPassword } from './fixture-credentials.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { webController, formEvent, deferred } from './web-controller.mjs';
for (const mode of ['redirect', 'text']) {
  test(`real submitLink controller serializes ${mode} including password and quota without field loss`, async () => {
    const { app, calls } = webController({
      state: { modal: { type: 'link', row: { id: 'link', version: 7, redirect_code: 308 } } },
    });
    await app.submitLink(
      formEvent({
        response_mode: mode,
        text_content: 'draft\nbody',
        target_url: 'https://example.net/',
        domain_id: 'domain',
        slug: 'docs',
        title: 'title',
        description: 'note',
        geo_rules_json: '[]',
        redirect_code: '302',
        query_mode: 'merge',
        cache_ttl: '99',
        max_redirects: '8',
        password_action: 'set',
        password: testPassword,
        enabled: 'on',
        reset_redirect_count: 'on',
      }),
    );
    assert.equal(calls.length, 1);
    const [url, verb, body] = calls[0];
    assert.equal(url, '/links/link');
    assert.equal(verb, 'PATCH');
    assert.equal(body.password, testPassword);
    assert.equal(body.max_redirects, 8);
    assert.equal(body.version, 7);
    assert.equal(body.reset_redirect_count, true);
    assert.equal(body.response_mode, mode);
    assert.equal(body.text_content, mode === 'text' ? 'draft\nbody' : '');
    assert.equal(body.target_url, mode === 'text' ? '' : 'https://example.net/');
    assert.equal(body.query_mode, mode === 'text' ? 'discard' : 'merge');
    assert.equal(body.cache_ttl, mode === 'text' ? 0 : 99);
  });
}
test('real loadPage controller sends selected IDs independently of write-selection and preserves page state', async () => {
  const { app, calls } = webController({
    state: {
      page: 'analytics',
      days: 30,
      analyticsIds: ['stat-a', 'stat-b'],
      selected: ['editable-only'],
    },
    request: async () => ({ available: true }),
  });
  await app.loadPage();
  const u = new URL(calls[0][0], 'https://example.org');
  assert.equal(u.searchParams.get('link_ids'), 'stat-a,stat-b');
  assert.equal(u.searchParams.get('days'), '30');
  assert.deepEqual(app.state.selected, ['editable-only']);
  assert.equal(app.state.pageLoading, false);
});
test('empty custom selection is rejected in the controller, never queried as all', async () => {
  const { app, calls } = webController({ state: { page: 'analytics', analyticsIds: [] } });
  await app.loadPage();
  assert.equal(calls.length, 0);
  assert.match(app.state.error, /Select at least one/);
  assert.equal(app.state.pageLoading, false);
});
test('out-of-order statistics responses cannot replace the newest link scope', async () => {
  const first = deferred(),
    second = deferred();
  const { app } = webController({
    state: { page: 'analytics', analyticsIds: ['old'] },
    request: async (path) => (path.includes('old') ? first.promise : second.promise),
  });
  const old = app.loadPage();
  app.state.analyticsIds = ['new'];
  const next = app.loadPage();
  second.resolve({ tag: 'new' });
  await next;
  first.resolve({ tag: 'old' });
  await old;
  assert.equal(app.state.analytics.tag, 'new');
});
for (const [filename, name] of [
  ['response-ui.ts', 'responseLabels'],
  ['AnalyticsSelection.tsx', 'selectionLabels'],
]) {
  test(`${name} has matching complete Chinese/English keys`, () => {
    const labels = webController().module(filename)[name];
    assert.deepEqual(Object.keys(labels['zh-CN']).sort(), Object.keys(labels.en).sort());
    for (const value of Object.values(labels.en))
      assert.ok(typeof value === 'string' && value.length);
  });
}
test('text edit fields render the saved literal draft and the analytics picker is available to read-only users', () => {
  const fixture = webController({
    state: {
      modal: { type: 'link', row: { id: 'row', response_mode: 'text' } },
      responseMode: 'text',
      plainTextDraft: 'a <b>draft</b>',
    },
  });
  assert.match(
    renderToStaticMarkup(fixture.app.renderModal()),
    /a &lt;b&gt;draft&lt;\/b&gt;/,
  );
  const { AnalyticsSelection } = fixture.module('AnalyticsSelection.tsx');
  const html = renderToStaticMarkup(
    React.createElement(AnalyticsSelection, {
      locale: 'en',
      ids: [],
      disabled: false,
      onApply() {},
    }),
  );
  assert.match(html, /Choose links/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Apply filters/);
});
