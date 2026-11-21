/** Local HTTP fixture: actual compiled Worker and real SQLite; platform cf/rate
 * bindings are controlled inputs, NOT real Cloudflare geolocation or workerd. */
import { testPassword } from '../fixture-credentials.mjs';
import http from 'node:http';
import { setup, createLink, call, redirect } from '../harness.mjs';
import { BROWSER_JS } from '../../.build/apps/redirect/src/browser-page.js';
import { PUBLIC_ASSETS } from '../../.build/apps/redirect/src/public-asset-paths.js';
import { randomBytes } from 'node:crypto';
import { mockRadar, radarToken, vpnCF } from '../vpn-fixture.mjs';
import {listenOnLoopback} from '../loopback-port.mjs';
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
export const TEST_PASSWORD = testPassword;
export async function cspFixture({ legacyScript = false, legacyPassword = false, block = true, password = false, code = 302, text = false, tor = false, global = false, category, probeDelay = 0 } = {}) {
  const visits = [], targetVisits = [], events = [];
  const target = http.createServer((req, res) => {
    if (!/^localhost:\d+$/.test(req.headers.host ?? '')) { res.writeHead(421).end(); return; }
    targetVisits.push({ path: req.url, method: req.method });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('<!doctype html><link rel="icon" href="data:,"><title>Linro test target</title><body>LINRO TEST TARGET</body>');
  });
  let env, bridge;
  const restoreRadar = mockRadar(category);
  try {
    const targetPort = await listenOnLoopback(target); const targetOrigin = 'http://localhost:' + targetPort;
    ({ env } = await setup({ BROWSER_TIMEZONE_ENABLED: String(global), BROWSER_CHECK_SECRET: randomBytes(32).toString('base64url'), RADAR_API_TOKEN: radarToken,
      LINK_PASSWORD_SECRET: randomBytes(32).toString('base64url'), PRIVATE_TARGET_ALLOWLIST: '["localhost"]',
      PASSWORD_LIMITER: { limit: async () => ({ success: true }) }, ANALYTICS_ENABLED: 'true', ANALYTICS: { writeDataPoint: event => events.push(event) } }));
    const domain = (await call(env, '/domains', 'POST', { hostname: '127.0.0.1' })).data;
    const link = await createLink(env, domain, { slug: 'csp-check', target_url: targetOrigin + '/done', redirect_code: code,
      block_vpn: block, max_redirects: 10, ...(password ? { password: TEST_PASSWORD } : {}),
      ...(text ? { response_mode: 'text', target_url: '', text_content: '<script>not executed</script>\nLINRO TEXT RESULT' } : {}) });
    let shortOrigin;
    bridge = http.createServer(async (req, res) => {
      try {
        if (req.headers.host !== new URL(shortOrigin).host) { res.writeHead(421).end(); return; }
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > 8192) { res.writeHead(413).end(); return; } chunks.push(chunk); }
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
        headers.set('cf-connecting-ip', '203.0.113.31');
        const request = new Request(shortOrigin + req.url, { method: req.method, headers,
          ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
        Object.defineProperty(request, 'cf', { value: { ...vpnCF, country: tor ? 'T1' : 'JP', continent: 'AS' } });
        if (probeDelay && req.url.startsWith('/__Linro_rtt')) await new Promise(resolve => setTimeout(resolve, probeDelay));
        let response = await redirect.fetch(request, env);
        if (legacyPassword && new URL(request.url).pathname === PUBLIC_ASSETS['password.js']) {
          response = new Response('', { status: 200, headers: response.headers });
        }
        if (legacyScript && new URL(request.url).pathname === PUBLIC_ASSETS['browser.js']) {
          // Negative control reproduces the original navigation mechanism while
          // keeping the same production CSP and all server-side verification.
          const old = "const f=document.getElementById('browser-check');f.elements.namedItem('timezone').value=Intl.DateTimeFormat().resolvedOptions().timeZone;f.requestSubmit();";
          response = new Response(old, { status: 200, headers: response.headers });
        }
        visits.push({ method: req.method, path: req.url, status: response.status, accept: req.headers.accept ?? null,
          origin: req.headers.origin ?? null, site: req.headers['sec-fetch-site'] ?? null,
          csp: response.headers.get('content-security-policy') }); // no password, challenge or cookie values
        res.statusCode = response.status;
        for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value);
        const cookies = response.headers.getSetCookie(); if (cookies.length) res.setHeader('set-cookie', cookies);
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch { res.writeHead(500).end('Test fixture error'); }
    });
    const port = await listenOnLoopback(bridge); shortOrigin = 'http://127.0.0.1:' + port;
    return { shortOrigin, targetOrigin, link, visits, targetVisits, events, actualBrowserJS: BROWSER_JS,
      count: () => env.DB.sqlite.prepare('SELECT redirect_count FROM links WHERE id=?').get(link.id).redirect_count,
      async close() { restoreRadar(); await close(bridge); await close(target); env.DB.close(); } };
  } catch (error) { restoreRadar(); if (bridge) await close(bridge); await close(target); if (env) env.DB.close(); throw error; }
}
