import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { webController } from './web-controller.mjs';
const state = (scope = 'owned', scopes = ['links:write', 'links:delete']) => ({
  locale: 'en',
  session: { user: { id: 'user-1' }, link_write_scope: scope, scopes },
});
test('GUI ownership controls distinguish own/foreign/null-owned rows and action scopes', () => {
  const c = webController({ state: state() }).app;
  assert.equal(c.canManageLink({ created_by: 'user-1' }), true);
  for (const created_by of ['user-2', null]) assert.equal(c.canManageLink({ created_by }), false);
  const viewer = webController({ state: state('workspace', ['links:read']) }).app;
  assert.equal(viewer.canManageLink({ created_by: 'user-1' }), false);
  const admin = webController({ state: state('workspace') }).app;
  assert.equal(admin.canManageLink({ created_by: null }, 'links:delete'), true);
  const noDelete = webController({ state: state('workspace', ['links:write']) }).app;
  assert.equal(noDelete.canManageLink({ created_by: 'other' }, 'links:delete'), false);
});
test('new security error messages are localized while retaining correlation IDs', () => {
  for (const locale of ['zh-CN', 'en']) {
    const { app: c, APIError } = webController({ state: { ...state(), locale } });
    for (const code of [
      'link_owner_required',
      'unsafe_query_mode',
      'private_target',
      'security_policy_invalid',
    ]) {
      const text = c.message(new APIError('provider message', 400, code, 'request-123'));
      assert.ok(text.endsWith('[request-123]'));
      assert.equal(/[\u4e00-\u9fff]/.test(text), locale === 'zh-CN');
      assert.ok(!text.includes('provider message'));
    }
  }
});
test('the rendered link table limits selection, edit and delete to owned rows and bulk filters the submitted IDs', async (t) => {
  const rows = ['user-1', 'user-2', null].map((created_by, i) => ({
    id: 'id-' + i,
    slug: 's' + i,
    created_by,
    hostname: 'go.example.com',
    short_url: 'https://go.example.com/s' + i,
    target_url: 'https://example.org/',
    redirect_code: 301,
    enabled: 1,
    domain_enabled: 1,
    version: 1,
    geo_rules: [],
    max_redirects: null,
  }));
  const { app, calls } = webController({
    state: { ...state(), page: 'links', links: rows },
    request: (path, method) =>
      method === 'POST' ? { results: [{ ok: true }] } : { items: [], next_cursor: null },
  });
  const table = app.renderPage().props.children;
  const html = renderToStaticMarkup(table);
  assert.equal((html.match(/>Edit<\/button>/g) ?? []).length, 1);
  assert.equal((html.match(/>Delete<\/button>/g) ?? []).length, 1);
  const inputs = [];
  function visit(node) {
    if (!React.isValidElement(node)) return;
    if (node.type === 'input' && node.props.type === 'checkbox') inputs.push(node);
    React.Children.forEach(node.props.children, visit);
  }
  visit(table.type(table.props));
  assert.deepEqual(
    inputs.slice(1).map((e) => e.props.disabled),
    [false, true, true],
  );
  inputs[0].props.onChange({ target: { checked: true } });
  assert.deepEqual(app.state.selected, ['id-0']);
  await app.deleteLink(rows[1]);
  assert.equal(calls.length, 0);
  const old = globalThis.window;
  globalThis.window = { confirm: () => true };
  t.after(() => {
    if (old === undefined) delete globalThis.window;
    else globalThis.window = old;
  });
  app.state.selected = rows.map((r) => r.id);
  await app.bulk('delete');
  assert.deepEqual(calls.find(([p]) => p === '/links/bulk')[2].items, [{ id: 'id-0', version: 1 }]);
});
