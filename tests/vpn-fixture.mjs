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

/** Exercise the page's one HTTP probe with a controlled client duration. */
export async function collectLatency(postProbe, challenge, elapsed = 12) {
  const response = await postProbe(new URLSearchParams({ challenge }).toString());
  assert.equal(response.status, 200, await response.clone().text());
  return JSON.stringify({ receipt: await response.text(), elapsed });
}
