import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { webController } from './web-controller.mjs';

test('a visible local sign-in error follows the selected language without another session request', async (t) => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { hostname: '127.0.0.1' },
  });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, 'location', old);
    else delete globalThis.location;
  });
  let failure;
  const { app, calls, APIError } = webController({
    state: { locale: 'zh-CN', session: null },
    request: async () => {
      throw failure;
    },
  });
  failure = new APIError('Raw English response', 401, 'local_token_required', 'test-request');
  await app.start();
  assert.match(app.render().props.error, /请输入.*本地开发令牌。 \[test-request\]/);
  app.setLocale('en');
  assert.match(app.render().props.error, /Enter the local development token.*\[test-request\]/);
  assert.equal(calls.length, 1);
});
test('language switch updates the selected button, document language and next login render', (t) => {
  const { app, module } = webController({ state: { locale: 'en', session: null } });
  const saved = new Map();
  for (const [key, value] of [
    ['location', { hostname: 'localhost' }],
    ['document', { documentElement: { lang: 'en' } }],
    ['localStorage', { setItem: (k, v) => saved.set(k, v), getItem: (k) => saved.get(k) ?? null }],
  ]) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  const { LanguageSwitch } = module('login-component.tsx');
  const login = app.render();
  const buttons = React.Children.toArray(LanguageSwitch(login.props).props.children);
  assert.deepEqual(
    buttons.map((b) => b.props['aria-pressed']),
    [false, true],
  );
  buttons[0].props.onClick();
  assert.equal(app.state.locale, 'zh-CN');
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(saved.get('cf-links-locale'), 'zh-CN');
  const refreshed = app.render();
  assert.equal(module('i18n.ts').detectLocale(), 'zh-CN');
  assert.deepEqual(
    React.Children.toArray(LanguageSwitch(refreshed.props).props.children).map(
      (b) => b.props['aria-pressed'],
    ),
    [true, false],
  );
  assert.ok(renderToStaticMarkup(refreshed).includes(app.ui().login.title));
});
test('the dashboard sidebar renders the workspace navigation without the retired promotional panel', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { innerWidth: 1440 } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  });
  const { app } = webController({
    state: {
      page: 'dashboard',
      locale: 'zh-CN',
      session: {
        user: { email: 'viewer@example.com', role: 'viewer', id: 'u' },
        scopes: ['links:read'],
        site_name: 'Fixture',
        auth_kind: 'access',
      },
    },
  });
  const html = renderToStaticMarkup(app.render());
  assert.ok(html.includes('Fixture'));
  assert.ok(html.includes(app.ui().pages.dashboard));
  for (const retired of [
    'Cloudflare 原生部署',
    '轻量跳转，',
    '永久跳转不等于永久缓存',
    'workspace-lock',
    'guide-panel',
  ])
    assert.ok(!html.includes(retired));
});
