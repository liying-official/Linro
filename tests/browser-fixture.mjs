import { newTestSecret } from './fixture-credentials.mjs';
import assert from 'node:assert/strict';
import { setup, createLink, redirect, call } from './harness.mjs';
import { createLatencyReceipt } from '../.build/packages/shared/src/vpn-latency.js';
import { mockRadar, vpnCF, radarToken } from './vpn-fixture.mjs';
export const browserSecret = newTestSecret();
export const defaultCF = { ...vpnCF, continent: 'AS' };
export class MemoryKV {
  map = new Map(); gets = 0; puts = 0;
  async get(key) { this.gets++; return this.map.get(key) ?? null; }
  async put(key, value) { this.puts++; this.map.set(key, value); }
  async delete(key) { this.map.delete(key); }
}
export async function fixture(t, fields = {}, options = {}) {
  t.after(mockRadar());
  const events = []; const kv = options.kv ? new MemoryKV() : undefined;
  const state = await setup({ BROWSER_TIMEZONE_ENABLED: 'true', BROWSER_CHECK_SECRET: browserSecret, RADAR_API_TOKEN: radarToken,
    LINK_PASSWORD_SECRET: newTestSecret(), PASSWORD_LIMITER: { limit: async () => ({success: true}) },
    ANALYTICS_ENABLED: 'true', ANALYTICS: { writeDataPoint: event => events.push(event) },
    ...(kv ? { REDIRECT_CACHE: kv } : {}), ...options.env });
  t.after(() => state.env.DB.close());
  const link = await createLink(state.env, state.domain, { max_redirects: 10, ...fields });
  return { ...state, link, events, kv, latency: new Map() };
}
export function request(path = '/docs', { cf = defaultCF, method = 'GET', headers = {}, body, origin = 'https://go.example.com' } = {}) {
  const r = new Request(origin + path, { method, headers: { 'cf-connecting-ip': '203.0.113.31', 'accept-language': 'en', ...headers }, body });
  if (cf !== null) Object.defineProperty(r, 'cf', { value: cf });
  return r;
}
export const send = (f, path, options) => redirect.fetch(request(path, options), f.env);
export const count = f => f.env.DB.sqlite.prepare('SELECT redirect_count FROM links WHERE id=?').get(f.link.id).redirect_count;
export const current = f => ({...f.env.DB.sqlite.prepare('SELECT * FROM links WHERE id=?').get(f.link.id), hostname:'go.example.com'});
export async function patch(f, values) {
  const r = await call(f.env, '/links/' + f.link.id, 'PATCH', { version: current(f).version, ...values });
  assert.equal(r.status, 200, JSON.stringify(r.body)); f.link = r.data; return r;
}
export async function challenge(f, path = '/docs', options = {}) {
  const response = await send(f, path, options); assert.equal(response.status, 200);
  const html = await response.text(); const token = html.match(/name="challenge" value="([A-Za-z0-9_.-]+)"/)?.[1];
  assert.ok(token, html);
  if (html.includes('name="latency"') && options.probe !== false) {
    // Routing tests start with a server-issued verdict. Transport and timing are
    // exercised separately by the WebSocket, native workerd and Chromium suites.
    f.latency.set(token, await createLatencyReceipt(f.env.BROWSER_CHECK_SECRET, token, 'match'));
  }
  return { token, html, response };
}
export async function submit(f, token, timezone = 'Asia/Tokyo', path = '/__Linro_browser/docs', options = {}) {
  const body = new URLSearchParams({ challenge: token, timezone });
  const evidence = Object.hasOwn(options, 'latency') ? options.latency : f.latency.get(token);
  if (evidence !== undefined) body.set('latency', evidence);
  return send(f, path, { ...options, method: 'POST', headers: { origin: 'null', 'sec-fetch-site':'same-origin', 'content-type':'application/x-www-form-urlencoded', ...options.headers }, body: body.toString() });
}
export async function complete(f, timezone = 'Asia/Tokyo', options = {}) {
  const path = options.path ?? '/docs'; const c = await challenge(f, path, options);
  const probePath = '/__Linro_browser' + path;
  const p = await submit(f, c.token, timezone, probePath, options);
  assert.equal(p.status, 303, await p.clone().text());
  const cookie = p.headers.get('set-cookie').split(';')[0]; const resume = p.headers.get('location');
  const response = await send(f, resume, { ...options, headers: { ...options.headers, cookie: [options.headers?.cookie, cookie].filter(Boolean).join('; ') } });
  return { response, cookie, resume, challenge: c, post: p };
}
