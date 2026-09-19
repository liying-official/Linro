import assert from 'node:assert/strict';

/** Test-only router for Miniflare's supported outboundService hook. This runs
 * BELOW workerd's native fetch, never replaces globalThis.fetch, and never
 * contacts the network. An unexpected request returns 599 AND fails teardown.
 * No undici API emulation or legacy Miniflare fetchMock API is used.
 */
export function createOutboundRouter() {
  const rules = [];
  const calls = [];
  const unexpected = [];
  return {
    expect(match, reply, { optional = false, persist = false } = {}) {
      if (typeof match.url !== 'string' || !/^https?:\/\//.test(match.url)) throw new Error('An exact absolute fixture URL is required.');
      rules.push({ match: { method: 'GET', ...match }, reply, optional, persist, hits: 0 });
    },
    calls,
    async outboundService(request) {
      const descriptor = { url: request.url, method: request.method };
      calls.push(descriptor);
      const body = await request.text();
      const rule = rules.find(r => (r.persist || r.hits === 0) && r.match.url === request.url && r.match.method === request.method &&
        (r.match.body === undefined || r.match.body === body) && Object.entries(r.match.headers ?? {}).every(([key, value]) => request.headers.get(key) === value));
      if (!rule) {
        // Never include bodies/authorization values in assertion messages.
        unexpected.push(descriptor);
        return new Response('Unexpected outbound request blocked by test fixture', { status: 599 });
      }
      rule.hits++;
      const reply = typeof rule.reply === 'function' ? await rule.reply() : rule.reply;
      return new Response(reply.body ?? null, { status: reply.status, headers: reply.headers });
    },
    assertComplete() {
      assert.deepEqual(unexpected, [], 'Unexpected outbound request(s) must fail the test, even if production code fails closed.');
      assert.deepEqual(rules.filter(r => !r.optional && r.hits === 0).map(r => ({ url: r.match.url, method: r.match.method })), [], 'An expected outbound request was never made.');
    },
  };
}
