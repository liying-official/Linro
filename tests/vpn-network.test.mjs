import { newTestSecret } from './fixture-credentials.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { radarClassification } from '../.build/packages/shared/src/radar-asn.js';
import { challenge, count, current, fixture, request, send, submit } from './browser-fixture.mjs';
import {
  createBrowserChallenge,
  validateBrowserChallenge,
  issueBrowserCookie,
} from '../.build/packages/shared/src/browser-check.js';
import { radarBody, radarToken, radarURL, testASN, vpnCF } from './vpn-fixture.mjs';
import { scriptHarness } from './browser-script-harness.mjs';
import {
  makePurposeMac,
  base64UrlEncode,
  encodeUTF8,
} from '../.build/packages/shared/src/encoding.js';

test('the page script times one probe, sends no inter-probe data and immediately posts one duration', async () => {
  const durations = [17.5];
  const h = scriptHarness({
    probeDurations: durations,
    fetcher: async (url, options) => {
      if (new URL(url).pathname !== '/__Linro_rtt')
        return Response.json({
          ok: true,
          data: { next: '/docs?utm_source=fixture&_Linro_check=1' },
        });
      assert.equal(new URL(url).search, '?utm_source=fixture');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.mode, 'same-origin');
      assert.deepEqual([...options.body.keys()], ['challenge']);
      return new Response('single-fixture');
    },
  });
  await h.settled();
  assert.deepEqual(h.gaps, []);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(JSON.parse(h.requests[1].options.body.get('latency')), {
    receipt: 'single-fixture',
    elapsed: 17.5,
  });
  assert.equal(h.navigations.length, 1);
  assert.equal(h.forms.length, 0);
});

function edgeCache(t) {
  const entries = new Map();
  let now = 0;
  let matches = 0;
  const cache = {
    async match(key) {
      matches++;
      const hit = entries.get(key);
      if (hit?.expires > now) return new Response(hit.category);
    },
    async put(key, response) {
      const ttl = Number(
        /^public, max-age=(\d+)$/.exec(response.headers.get('cache-control'))?.[1],
      );
      assert.ok(ttl > 0);
      entries.set(key, { category: await response.text(), expires: now + ttl });
    },
  };
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: { open: async () => cache },
  });
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, 'caches', saved);
    else delete globalThis.caches;
  });
  return {
    entries,
    get reads() {
      return matches;
    },
    advance: (seconds) => {
      now += seconds;
    },
  };
}

for (const [category, ttl] of [
  ['ACCESS_ISP', 86400],
  ['HOSTING_CLOUD_CONTENT', 86400],
  ['ORGANIZATION', 86400],
  [null, 300],
]) {
  test('Radar cache reuses and expires the official classification ' + category, async (t) => {
    const cache = edgeCache(t);
    const responses = [category, 'ORGANIZATION'];
    const upstream = t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, radarURL);
      assert.equal(options.redirect, 'manual');
      assert.equal(new Headers(options.headers).get('authorization'), 'Bearer ' + radarToken);
      return Response.json(radarBody(responses.shift()));
    });
    const env = { RADAR_API_TOKEN: radarToken };
    assert.equal(await radarClassification(request(), env), category ?? 'UNCLASSIFIED');
    cache.advance(ttl - 1);
    assert.equal(
      await radarClassification(request('/other?private=1'), env),
      category ?? 'UNCLASSIFIED',
    );
    assert.equal(upstream.mock.callCount(), 1);
    assert.equal(cache.entries.size, 1);
    const [key] = cache.entries.keys();
    assert.match(key, /^https:\/\/go\.example\.com\/__Linro_radar_asn\/v2\/[0-9a-f]{64}\/64496$/);
    assert.ok(!key.includes(radarToken));
    cache.advance(1);
    assert.equal(await radarClassification(request(), env), 'ORGANIZATION');
    assert.equal(upstream.mock.callCount(), 2);
  });
}

for (const [number, reply] of [
  () => new Response(null, { status: 429 }),
  () => new Response(null, { status: 401 }),
  () => new Response(null, { status: 302, headers: { location: 'https://example.org/' } }),
  () => new Response('invalid JSON'),
  () => {
    throw Error('offline');
  },
  () => Response.json({ success: false, result: radarBody().result }),
  () => Response.json(radarBody('ACCESS_ISP', testASN + 1)),
  () => Response.json(radarBody('access_isp')),
  () =>
    Response.json({
      success: true,
      result: { asn: { asn: testASN, related: [{ category: 'ACCESS_ISP' }] } },
    }),
].entries()) {
  test('unusable Radar response denies until its short cooldown expires #' + number, async (t) => {
    const f = await fixture(t, { block_vpn: true });
    f.env.RADAR_API_TOKEN += '-failure-' + number;
    let clock = Date.now();
    t.mock.method(Date, 'now', () => clock);
    const cache = edgeCache(t);
    const upstream = t.mock.method(globalThis, 'fetch', reply);
    const result = await send(f, '/docs');
    assert.equal(result.status, 403);
    assert.equal(result.headers.get('location'), null);
    assert.deepEqual(f.events[0].blobs.slice(9), ['asn_unavailable', 'unknown_blocked']);
    assert.equal(cache.entries.size, 0);
    upstream.mock.mockImplementation(() => Response.json(radarBody()));
    clock += 4999;
    assert.equal((await send(f, '/docs')).status, 403);
    assert.equal(upstream.mock.callCount(), 1);
    clock++;
    assert.equal((await send(f, '/docs')).status, 200);
    assert.equal(upstream.mock.callCount(), 2);
    assert.equal(count(f), 0);
  });
}

test('a timed-out Radar read denies and recovers after cooldown', async (t) => {
  const f = await fixture(t, { block_vpn: true });
  f.env.RADAR_API_TOKEN += '-timeout';
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  edgeCache(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const upstream = t.mock.method(
    globalThis,
    'fetch',
    (_, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(Error('timed out')), { once: true });
        started();
      }),
  );
  const pending = send(f, '/docs');
  await entered;
  t.mock.timers.tick(3000);
  assert.equal((await pending).status, 403);
  upstream.mock.mockImplementation(() => Response.json(radarBody()));
  assert.equal((await send(f, '/docs')).status, 403);
  clock += 5000;
  assert.equal((await send(f, '/docs')).status, 200);
});

test('25 concurrent cold requests share one Radar fetch; host, ASN and updated credentials stay isolated', async (t) => {
  const cache = edgeCache(t);
  let announce, release;
  const started = new Promise((resolve) => {
    announce = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const upstream = t.mock.method(globalThis, 'fetch', async (url, options) => {
    announce();
    await gate;
    const asn = Number(new URL(url).pathname.split('/').at(-1));
    return Response.json(
      radarBody(
        options.headers.Authorization.endsWith('-rotated') ? 'ORGANIZATION' : 'ACCESS_ISP',
        asn,
      ),
    );
  });
  const env = { RADAR_API_TOKEN: radarToken + '-burst', ADMIN_ORIGIN: 'https://admin.example.com' };
  const results = Promise.all(
    Array.from({ length: 25 }, () => radarClassification(request(), env)),
  );
  await started;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(upstream.mock.callCount(), 1);
  release();
  assert.deepEqual(await results, Array(25).fill('ACCESS_ISP'));
  assert.equal(cache.reads, 1);
  assert.equal(
    await radarClassification(request('/docs', { origin: 'https://other.example' }), env),
    'ACCESS_ISP',
  );
  assert.equal(
    await radarClassification(request('/docs', { cf: { ...vpnCF, asn: testASN + 1 } }), env),
    'ACCESS_ISP',
  );
  assert.equal(
    await radarClassification(request(), {
      ...env,
      RADAR_API_TOKEN: env.RADAR_API_TOKEN + '-rotated',
    }),
    'ORGANIZATION',
  );
  assert.equal(upstream.mock.callCount(), 4);
  assert.equal(cache.entries.size, 4);
  assert.ok([...cache.entries.keys()].every((key) => !key.includes(radarToken)));
});

for (const format of ['seconds', 'http-date', 'excessive', 'invalid'])
  test('Radar 429 cools down 25 sequential requests and recovers for ' + format, async (t) => {
    const env = { RADAR_API_TOKEN: newTestSecret() };
    let clock = Date.UTC(2026, 0, 1);
    t.mock.method(Date, 'now', () => clock);
    const value = {
      seconds: '300',
      'http-date': new Date(clock + 70_000).toUTCString(),
      excessive: '9999999999',
      invalid: 'nonsense',
    }[format];
    const wait = { seconds: 300_000, 'http-date': 70_000, excessive: 300_000, invalid: 5000 }[
      format
    ];
    const upstream = t.mock.method(
      globalThis,
      'fetch',
      () => new Response(null, { status: 429, headers: { 'Retry-After': value } }),
    );
    for (let i = 0; i < 25; i++) assert.equal(await radarClassification(request(), env), null);
    assert.equal(upstream.mock.callCount(), 1);
    upstream.mock.mockImplementation(() => Response.json(radarBody()));
    clock += wait - 1;
    assert.equal(await radarClassification(request(), env), null);
    clock++;
    assert.equal(await radarClassification(request(), env), 'ACCESS_ISP');
    assert.equal(upstream.mock.callCount(), 2);
  });

test('a saturated Radar cooldown map is bounded and admits a new ASN after expired slots are reclaimed', async (t) => {
  const env = { RADAR_API_TOKEN: newTestSecret() };
  let clock = Date.UTC(2040, 0, 1);
  t.mock.method(Date, 'now', () => clock);
  const upstream = t.mock.method(
    globalThis,
    'fetch',
    () => new Response(null, { status: 429, headers: { 'Retry-After': '5' } }),
  );
  const query = (asn) => radarClassification(request('/docs', { cf: { ...vpnCF, asn } }), env);
  for (let asn = 1; asn <= 256; asn++) assert.equal(await query(asn), null);
  assert.equal(upstream.mock.callCount(), 256);
  assert.equal(await query(257), null);
  assert.equal(upstream.mock.callCount(), 256);
  clock += 5000;
  upstream.mock.mockImplementation(() => Response.json(radarBody('ACCESS_ISP', 257)));
  assert.equal(await query(257), 'ACCESS_ISP');
  assert.equal(upstream.mock.callCount(), 257);
});

test('an expired lookup completing after a replacement cannot repopulate the edge cache', async (t) => {
  const env = { RADAR_API_TOKEN: newTestSecret() };
  const cache = edgeCache(t);
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  let release,
    announce,
    calls = 0;
  const started = new Promise((resolve) => {
    announce = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) {
      announce();
      await held;
      return Response.json(radarBody('ACCESS_ISP'));
    }
    return Response.json(radarBody('ORGANIZATION'));
  });
  const first = radarClassification(request(), env);
  await started;
  clock += 4600;
  assert.equal(await radarClassification(request(), env), 'ORGANIZATION');
  release();
  assert.equal(await first, null);
  assert.equal(await radarClassification(request(), env), 'ORGANIZATION');
  assert.equal(cache.entries.size, 1);
  assert.equal(calls, 2);
});

test('only trusted ASN metadata selects the lookup, and unprotected links do not contact Radar', async (t) => {
  const f = await fixture(t, { block_vpn: true });
  const upstream = t.mock.method(globalThis, 'fetch', () => Response.json(radarBody()));
  for (const asn of [undefined, '64496', 0, -1, 1.5, 0x100000000]) {
    const r = await send(f, '/docs?asn=64496', {
      cf: { ...vpnCF, asn },
      headers: { 'CF-ASN': '64496', 'X-ASN': '64496' },
    });
    assert.equal(r.status, 403);
  }
  delete f.env.RADAR_API_TOKEN;
  assert.equal((await send(f, '/docs')).status, 403);
  f.env.DB.sqlite.prepare('UPDATE links SET block_vpn=0 WHERE id=?').run(f.link.id);
  const { html } = await challenge(f);
  assert.ok(!html.includes('name="latency"'));
  assert.equal(upstream.mock.callCount(), 0);
});

for (const category of ['HOSTING_CLOUD_CONTENT', 'ORGANIZATION', null]) {
  test('ASN policy denies ' + category + ' before issuing a page, proof or redirect', async (t) => {
    const f = await fixture(t, { block_vpn: true });
    t.mock.method(globalThis, 'fetch', () => Response.json(radarBody(category)));
    const r = await send(f, '/docs');
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('location'), null);
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal(f.events[0].blobs[9], category === null ? 'asn_unavailable' : 'asn_category');
    assert.equal(count(f), 0);
  });
}

const tcp = { ...vpnCF, httpProtocol: 'HTTP/2', clientTcpRtt: 20 };
const quic = { ...vpnCF, httpProtocol: 'HTTP/3', clientQuicRtt: 100, clientTcpRtt: 0 };
for (const [name, probeCF, elapsed, permit] of [
  ['TCP exceeds the threshold by a fraction of a millisecond', tcp, 70.01, false],
  ['QUIC differs by 51 ms in the other direction', quic, 49, false],
  ['TCP difference is exactly 50 ms', tcp, 70, true],
  ['QUIC difference is exactly 50 ms', quic, 50, true],
  ['QUIC matches the RTT of the probe request', quic, 100, true],
])
  test(name, async (t) => {
    const f = await fixture(t, { block_vpn: true });
    const c = await challenge(f, '/docs', { probeCF, elapsed });
    const p = await submit(f, c.token);
    assert.equal(count(f), 0);
    assert.equal(p.status, permit ? 303 : 403);
    if (permit) {
      const final = await send(f, p.headers.get('location'), {
        headers: { cookie: p.headers.get('set-cookie').split(';')[0] },
      });
      assert.equal(final.status, 301);
      assert.equal(count(f), 1);
    } else {
      assert.equal(p.headers.get('set-cookie'), null);
      assert.deepEqual(f.events[0].blobs.slice(9), ['latency_mismatch', 'vpn_blocked']);
    }
  });

for (const probeCF of [
  { ...vpnCF, httpProtocol: 'HTTP/2', clientTcpRtt: undefined, clientQuicRtt: 12 },
  { ...vpnCF, httpProtocol: 'HTTP/3', clientQuicRtt: undefined, clientTcpRtt: 12 },
  { ...vpnCF, httpProtocol: 'HTTP/2', clientTcpRtt: -1 },
])
  test('missing or invalid trusted RTT fails closed ' + JSON.stringify(probeCF), async (t) => {
    const f = await fixture(t, { block_vpn: true });
    const c = await challenge(f, '/docs', {
      probeCF,
      headers: { 'client-tcp-rtt': '12', 'client-quic-rtt': '12' },
    });
    const p = await submit(f, c.token);
    assert.equal(p.status, 403);
    assert.equal(p.headers.get('set-cookie'), null);
    assert.deepEqual(f.events[0].blobs.slice(9), ['latency_unavailable', 'unknown_blocked']);
    assert.equal(f.events[0].doubles[4], 0);
    assert.equal(count(f), 0);
  });

test('protected proof requires one scalar duration and the receipt issued for this challenge', async (t) => {
  const f = await fixture(t, { block_vpn: true });
  const c = await challenge(f);
  const other = await challenge(f, '/docs', { probe: false });
  const { receipt } = JSON.parse(f.latency.get(c.token));
  for (const [token, evidence] of [
    [c.token, undefined],
    [c.token, '{'],
    [other.token, f.latency.get(c.token)],
    ...[[], [12], [12, 12, 12], null, '12', -1, {}, true, undefined].map((elapsed) => [
      c.token,
      JSON.stringify({ receipt, elapsed }),
    ]),
    [c.token, JSON.stringify({ receipt: 'untrusted', elapsed: 12 })],
  ]) {
    const p = await submit(f, token, 'Asia/Tokyo', '/__Linro_browser/docs', { latency: evidence });
    assert.equal(p.status, 403);
    assert.equal(p.headers.get('set-cookie'), null);
    assert.equal(count(f), 0);
  }
});

test('the lightweight route accepts only the current challenge and network, without a previous receipt or D1', async (t) => {
  const f = await fixture(t, { block_vpn: true });
  const c = await challenge(f, '/docs', { probe: false });
  const probe = (extra = {}, options = {}) =>
    send(f, '/__Linro_rtt', {
      method: 'POST',
      headers: {
        origin: 'https://go.example.com',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ challenge: c.token, ...extra }).toString(),
      ...options,
    });
  f.env.DB.queries.length = 0;
  const stamp = Date.now();
  t.mock.method(Date, 'now', () => stamp);
  const first = await probe();
  const receipt = await first.text();
  assert.equal(first.status, 200);
  assert.match(first.headers.get('cache-control'), /no-store/);
  assert.equal((await probe({ receipt })).status, 403);
  assert.equal((await probe({ receipt: '' })).status, 403);
  assert.equal((await probe({}, { cf: { ...vpnCF, asn: testASN + 1 } })).status, 403);
  assert.equal((await probe({}, { headers: { origin: 'https://other.example' } })).status, 403);
  assert.equal((await send(f, '/__Linro_rtt')).status, 405);
  assert.equal(f.env.DB.queries.length, 0);
  assert.equal(f.events.length, 0);
  const partial = await submit(f, c.token, 'Asia/Tokyo', '/__Linro_browser/docs', {
    latency: JSON.stringify({ receipt, elapsed: [12, 12, 12] }),
  });
  assert.equal(partial.status, 403);
  assert.equal(count(f), 0);
});

test('previous protocol challenges, authenticated three-probe receipts and signed proofs cannot authorize', async (t) => {
  const f = await fixture(t, { block_vpn: true });
  const c = await challenge(f);
  const { BROWSER_CHECK_SECRET: secret } = f.env;
  const oldSignature = async (token) => {
    const data = token.split('.')[0];
    return data + '.' + base64UrlEncode(await makePurposeMac(secret, 'browser-token-v1', data));
  };
  const oldChallenge = await oldSignature(c.token);
  assert.equal(
    (
      await submit(f, oldChallenge, 'Asia/Tokyo', '/__Linro_browser/docs', {
        latency: f.latency.get(c.token),
      })
    ).status,
    403,
  );
  const bytes = await makePurposeMac(secret, 'browser-rtt-key-v1', '');
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encodeUTF8(c.token) },
    key,
    encodeUTF8(JSON.stringify({ at: Date.now(), rtts: [12, 12, 12] })),
  );
  const receipt = base64UrlEncode(new Uint8Array([...iv, ...new Uint8Array(sealed)]));
  for (const elapsed of [[12, 12, 12], 12]) {
    const denied = await submit(f, c.token, 'Asia/Tokyo', '/__Linro_browser/docs', {
      latency: JSON.stringify({ receipt, elapsed }),
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('set-cookie'), null);
  }
  const modern = await submit(f, c.token);
  const [name, proof] = modern.headers.get('set-cookie').split(';')[0].split('=');
  const denied = await send(f, modern.headers.get('location'), {
    headers: { cookie: name + '=' + (await oldSignature(proof)) },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('location'), null);
  assert.equal(count(f), 0);
});

test('the final protected request rechecks its ASN and rejects a timezone-only proof', async (t) => {
  const f = await fixture(t, { block_vpn: true });
  const c = await challenge(f);
  const p = await submit(f, c.token);
  const resume = p.headers.get('location');
  const headers = { cookie: p.headers.get('set-cookie').split(';')[0] };
  const upstream = t.mock.method(globalThis, 'fetch', (url) =>
    Response.json(radarBody('ACCESS_ISP', Number(url.split('/').at(-1)))),
  );
  assert.equal(
    (await send(f, resume, { cf: { ...vpnCF, asn: testASN + 1 }, headers })).status,
    403,
  );
  const oldLink = { ...current(f), block_vpn: 0 };
  const token = await createBrowserChallenge(request(), oldLink, f.env);
  const claims = await validateBrowserChallenge(token, request(), oldLink, f.env);
  const oldCookie = (await issueBrowserCookie(claims, 'Asia/Tokyo', oldLink, f.env)).split(';')[0];
  assert.equal((await send(f, resume, { headers: { cookie: oldCookie } })).status, 403);
  upstream.mock.mockImplementation(() => Response.json(radarBody('ORGANIZATION')));
  assert.equal((await send(f, resume, { headers })).status, 403);
  assert.equal(count(f), 0);
});
