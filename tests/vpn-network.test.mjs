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
import { collectLatency, radarBody, radarToken, radarURL, testASN, vpnCF } from './vpn-fixture.mjs';
import { measureSocket } from '../.build/apps/redirect/src/rtt-socket.js';
import { edgeRtt, latencyResult } from '../.build/packages/shared/src/vpn-latency.js';
import { installSocketRuntime } from './browser/socket-bridge.mjs';
import { scriptHarness } from './browser-script-harness.mjs';
import {
  makePurposeMac,
  base64UrlEncode,
  encodeUTF8,
} from '../.build/packages/shared/src/encoding.js';

for (const complete of [true, false])
  test('browser echoes server frames on one socket, complete=' + complete, async () => {
    const challenges = Array.from({ length: 5 }, (_, i) => String(i).padStart(22, 'A'));
    const sent = [],
      connections = [];
    class ClientSocket {
      constructor(url, protocols) {
        connections.push([url, protocols]);
        this.protocol = protocols[0];
        queueMicrotask(() => this.onopen());
      }
      send(text) {
        sent.push(text);
        const data = challenges[sent.length - 1] ?? 'receipt.sealed_verdict';
        queueMicrotask(() => {
          if (!complete && sent.length === 2) this.onclose();
          else this.onmessage({ data });
        });
      }
      close() {}
    }
    const h = scriptHarness({ socketClass: ClientSocket });
    await h.settled();
    assert.deepEqual(
      connections.map((c) => c[0]),
      ['wss://go.example.com/__Linro_rtt?utm_source=fixture'],
    );
    assert.deepEqual(Array.from(connections[0][1]), ['linro-rtt-v3', h.challenge.value]);
    assert.deepEqual(sent, ['ready', ...(complete ? challenges : challenges.slice(0, 1))]);
    assert.equal(h.requests.length, complete ? 1 : 0);
    if (complete) assert.equal(h.requests[0].options.body.get('latency'), 'sealed_verdict');
    assert.equal(h.navigations.length, complete ? 1 : 0);
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

for (const category of ['HOSTING_CLOUD_CONTENT', 'UNKNOWN_CATEGORY', null]) {
  test('ASN policy denies ' + category + ' before issuing a page, proof or redirect', async (t) => {
    const f = await fixture(t, { block_vpn: true }, { env: { RADAR_API_TOKEN: newTestSecret() } });
    t.mock.method(globalThis, 'fetch', () => Response.json(radarBody(category)));
    const r = await send(f, '/docs');
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('location'), null);
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal(
      f.events[0].blobs[9],
      category === 'HOSTING_CLOUD_CONTENT' ? 'asn_category' : 'asn_unavailable',
    );
    assert.equal(count(f), 0);
  });
}

// Drive the actual Worker state machine with deterministic I/O timestamps.
function session(t, reference, secret, token) {
  let time = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(performance, 'now', () => time);
  const wire = new EventTarget(),
    sent = [],
    codes = [];
  let done;
  const receipt = new Promise((resolve) => {
    done = resolve;
  });
  wire.send = (data) => {
    if (data.startsWith('receipt.')) done(data.slice(8));
    sent.push(data);
  };
  wire.close = (code) => codes.push(code);
  const input = (data) => wire.dispatchEvent(new MessageEvent('message', { data }));
  measureSocket(wire, reference, secret, token, Date.now() + 120_000);
  input('ready');
  return {
    sent,
    codes,
    input,
    receipt,
    disconnect: () => wire.dispatchEvent(new Event('close')),
    advance(ms) {
      time += ms;
      t.mock.timers.tick(ms);
    },
  };
}

for (const [name, ref, samples, expected] of [
  ['only the first round qualifies', 10, [64.99, 80, 80, 80, 80], 'match'],
  ['only the fifth qualifies', 100, [0, 40, 45, 160, 46], 'match'],
  [
    'exactly 55 in either direction is outside tolerance',
    100,
    [45, 155, 45, 155, 45],
    'latency_mismatch',
  ],
  ['all differences above 55', 20, [76, 80, 100, 90, 85], 'latency_mismatch'],
  ['missing connection metadata', null, [0, 1, 2, 3, 4], 'latency_unavailable'],
])
  test('five server-timed echoes: ' + name, async (t) => {
    const secret = newTestSecret(),
      token = 'fixture-challenge',
      ws = session(t, ref, secret, token);
    const seen = new Set();
    samples.forEach((ms, i) => {
      if (i) {
        ws.advance(399);
        assert.equal(ws.sent.length, i);
        ws.advance(1);
      }
      const nonce = ws.sent[i];
      assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
      assert.ok(!seen.has(nonce));
      seen.add(nonce);
      // Advance the measurement clock by a fractional amount; timers run on integral ticks.
      ws.advance(ms);
      ws.input(nonce);
    });
    assert.equal(await latencyResult(secret, token, await ws.receipt), expected);
    assert.equal(seen.size, 5);
    assert.deepEqual(ws.codes, [1000]);
  });
for (const [kind, interrupt] of [
  [
    'wrong echo',
    (ws) => {
      ws.advance(400);
      ws.input('wrong');
    },
  ],
  ['duplicate', (ws, first) => ws.input(first)],
  [
    'out of order',
    (ws, first) => {
      ws.advance(400);
      ws.input(first);
    },
  ],
  [
    'binary',
    (ws) => {
      ws.advance(400);
      ws.input(new ArrayBuffer(16));
    },
  ],
  [
    'client timing',
    (ws) => {
      ws.advance(400);
      ws.input('{"elapsed":1}');
    },
  ],
  ['timeout', (ws) => ws.advance(30_001)],
  ['disconnect', (ws) => ws.disconnect()],
])
  test('no RTT receipt on ' + kind, async (t) => {
    const ws = session(t, 12, newTestSecret(), 'test-challenge');
    const first = ws.sent[0];
    ws.input(first);
    interrupt(ws, first);
    const n = ws.sent.length;
    ws.advance(60_000);
    assert.equal(ws.sent.length, n);
    assert.ok(!ws.sent.some((s) => s.startsWith('receipt.')));
    assert.equal(ws.codes.length, 1);
  });

test('connection reference uses trusted RTT for the upgrade transport', () => {
  for (const [protocol, tcp, quic, value] of [
    ['HTTP/2', 20, 90, 20],
    ['HTTP/3', 20, 90, 90],
    ['HTTP/2', undefined, 12, null],
    ['HTTP/3', 12, undefined, null],
    ['HTTP/2', -1, 12, null],
    ['HTTP/3', 12, NaN, null],
    [undefined, undefined, 25, 25],
  ])
    assert.equal(
      edgeRtt(
        request('/__Linro_rtt', {
          cf: { httpProtocol: protocol, clientTcpRtt: tcp, clientQuicRtt: quic },
          headers: { 'client-tcp-rtt': '10', 'client-quic-rtt': '10' },
        }),
      ),
      value,
    );
});

test('proof accepts only an authentic receipt for the same challenge', async (t) => {
  const f = await fixture(t, { block_vpn: true }),
    c = await challenge(f),
    other = await challenge(f, '/docs', { probe: false });
  const receipt = f.latency.get(c.token);
  for (const [token, evidence] of [
    [c.token, undefined],
    [other.token, receipt],
    [c.token, receipt.slice(1)],
    [c.token, '{'],
    [c.token, JSON.stringify({ receipt, elapsed: 0 })],
  ]) {
    const p = await submit(f, token, 'Asia/Tokyo', '/__Linro_browser/docs', { latency: evidence });
    assert.equal(p.status, 403);
    assert.equal(p.headers.get('set-cookie'), null);
    assert.equal(count(f), 0);
  }
});

test('WebSocket upgrade validates the signed VPN challenge, origin, query and network before accepting; no D1 read', async (t) => {
  const f = await fixture(
    t,
    { block_vpn: true },
    { env: { SOURCE_URL: 'https://source.example.org/release' } },
  );
  const c = await challenge(f, '/docs?ref=demo', { probe: false });
  t.after(installSocketRuntime());
  const headers = {
    upgrade: 'websocket',
    origin: 'https://go.example.com',
    'sec-websocket-protocol': 'linro-rtt-v3, ' + c.token,
  };
  const path = '/__Linro_rtt?ref=demo';
  f.env.DB.queries.length = 0;
  assert.equal((await send(f, path)).status, 426);
  assert.equal((await send(f, path, { method: 'POST' })).status, 405);
  for (const opts of [
    { headers: { ...headers, origin: 'https://other.example' } },
    { headers: { ...headers, origin: 'null' } },
    { headers: { ...headers, 'sec-websocket-protocol': 'linro-rtt-v3, invalid' } },
    { headers, cf: { ...vpnCF, asn: testASN + 1 } },
  ])
    assert.equal((await send(f, path, opts)).status, 403);
  assert.equal((await send(f, '/__Linro_rtt', { headers })).status, 403);
  const good = await send(f, path, { headers });
  assert.ok(good.headers.get('Link'));
  assert.ok(good.headers.get('x-request-id'));
  assert.equal(
    await latencyResult(f.env.BROWSER_CHECK_SECRET, c.token, await collectLatency(good)),
    'match',
  );
  assert.equal(f.env.DB.queries.length, 0);
  assert.equal(f.events.length, 0);
});

test('previous protocol challenges, authenticated three-probe receipts and signed proofs cannot authorize', async (t) => {
  const f = await fixture(t, { block_vpn: true });
  const c = await challenge(f);
  const { BROWSER_CHECK_SECRET: secret } = f.env;
  const oldSignature = async (token, purpose = 'browser-token-v1') => {
    const data = token.split('.')[0];
    return data + '.' + base64UrlEncode(await makePurposeMac(secret, purpose, data));
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
  // Even a genuine single-probe receipt cannot attest to the WebSocket exchange.
  const oldKey = await crypto.subtle.importKey(
    'raw',
    await makePurposeMac(secret, 'browser-rtt-single-v2', ''),
    'AES-GCM',
    false,
    ['encrypt'],
  );
  const oldIv = crypto.getRandomValues(new Uint8Array(12));
  const oldCiphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: oldIv, additionalData: encodeUTF8(c.token) },
    oldKey,
    encodeUTF8('12'),
  );
  const oldReceipt = base64UrlEncode(new Uint8Array([...oldIv, ...new Uint8Array(oldCiphertext)]));
  for (const evidence of [oldReceipt, JSON.stringify({ receipt: oldReceipt, elapsed: 12 })]) {
    const blocked = await submit(f, c.token, 'Asia/Tokyo', '/__Linro_browser/docs', {
      latency: evidence,
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get('set-cookie'), null);
  }
  const modern = await submit(f, c.token);
  const [name, proof] = modern.headers.get('set-cookie').split(';')[0].split('=');
  const denied = await send(f, modern.headers.get('location'), {
    headers: { cookie: name + '=' + (await oldSignature(proof)) },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('location'), null);
  const clientTimedProof = await oldSignature(proof, 'browser-token-v2');
  assert.equal(
    (
      await send(f, modern.headers.get('location'), {
        headers: { cookie: name + '=' + clientTimedProof },
      })
    ).status,
    403,
  );
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
  upstream.mock.mockImplementation(() => Response.json(radarBody('HOSTING_CLOUD_CONTENT')));
  assert.equal((await send(f, resume, { headers })).status, 403);
  assert.equal(count(f), 0);
  upstream.mock.mockImplementation(() => Response.json(radarBody('ORGANIZATION')));
  assert.equal((await send(f, resume, { headers })).status, 301);
  assert.equal(count(f), 1);
});
