import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read-only SQL credential probe. The URL and SQL cannot be supplied by users.
 * Credentials come only from the invoking operator's temporary environment.
 * Never print the token, upstream body or HTTP request headers.
 */
export async function verifyAnalyticsToken(account, token, fetcher = fetch) {
  if (!/^[a-f0-9]{32}$/.test(account ?? '') || /^0+$/.test(account)) throw new Error('Set a real CLOUDFLARE_ACCOUNT_ID (32 lowercase hexadecimal characters).');
  if (typeof token !== 'string' || !token || token.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(token)) throw new Error('Set ANALYTICS_API_TOKEN in the private process environment.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'text/plain', Accept: 'application/json' },
      body: 'SELECT 1 AS ok FORMAT JSON',
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      const reason = response.status === 401 ? 'authentication_failed' : response.status === 403 ? 'permission_denied' : response.status === 429 ? 'rate_limited_inconclusive' : 'upstream_failure_inconclusive';
      return { ok: false, status: response.status, reason };
    }
    if (!response.body) return { ok: false, status: 200, reason: 'invalid_query_result' };
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 8192) { await reader.cancel(); return { ok: false, status: 200, reason: 'query_result_too_large' }; }
        chunks.push(Buffer.from(part.value));
      }
    } finally { reader.releaseLock(); }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return { ok: false, status: 200, reason: 'invalid_query_result' }; }
    if (!Array.isArray(data?.data) || data.data.length !== 1 || ![1, '1'].includes(data.data[0]?.ok)) return { ok: false, status: 200, reason: 'invalid_query_result' };
    return { ok: true, status: 200, reason: 'sql_credential_verified_dataset_not_probed' };
  } catch { return { ok: false, reason: controller.signal.aborted ? 'timeout_inconclusive' : 'network_failure_inconclusive' }; }
  finally { clearTimeout(timer); }
}
async function main() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Insecure TLS environment is not allowed.');
  const result = await verifyAnalyticsToken(process.env.CLOUDFLARE_ACCOUNT_ID, process.env.ANALYTICS_API_TOKEN);
  console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
