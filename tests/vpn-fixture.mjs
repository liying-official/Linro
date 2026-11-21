import { newTestSecret } from './fixture-credentials.mjs';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

export const testASN = 64496;
export const radarToken = newTestSecret();
export const radarURL = 'https://api.cloudflare.com/client/v4/radar/entities/asns/' + testASN;
export const vpnCF = { asn: testASN, clientTcpRtt: 12, country: 'JP', timezone: 'Asia/Tokyo' };
export const radarBody = (category = 'ACCESS_ISP', asn = testASN) => ({
  success: true,
  result: { asn: { asn, category } },
});

export function mockRadar(category = 'ACCESS_ISP') {
  const original = globalThis.fetch;
  const stub = mock.method(globalThis, 'fetch', async (url, options) => {
    if (!String(url).startsWith('https://api.cloudflare.com/client/v4/radar/'))
      return original(url, options);
    assert.equal(url, radarURL);
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer ' + radarToken);
    return Response.json(radarBody(category));
  });
  return () => stub.mock.restore();
}

// Native workerd supplies the upgraded endpoint; this client only echoes challenges.
export async function collectLatency(response, echoDelays = []) {
  assert.equal(response.status, 101);
  assert.equal(response.headers.get('sec-websocket-protocol'), 'linro-rtt-v3');
  const socket = response.webSocket;
  socket.accept();
  const seen = new Set();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(Error('RTT fixture timed out'));
    }, 15000);
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(Error('RTT socket failed'));
    });
    socket.addEventListener('close', () => {
      clearTimeout(timer);
      reject(Error('RTT socket closed early'));
    });
    socket.addEventListener('message', ({ data }) => {
      try {
        if (data.startsWith('receipt.')) {
          assert.equal(seen.size, 5);
          clearTimeout(timer);
          resolve(data.slice(8));
          socket.close();
        } else {
          assert.match(data, /^[A-Za-z0-9_-]{22}$/);
          assert.ok(!seen.has(data));
          const delay = echoDelays[seen.size];
          seen.add(data);
          if (delay) setTimeout(() => socket.send(data), delay);
          else socket.send(data);
        }
      } catch (err) {
        clearTimeout(timer);
        reject(err);
        socket.close();
      }
    });
    socket.send('ready');
  });
}
