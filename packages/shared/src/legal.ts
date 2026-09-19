// SPDX-License-Identifier: AGPL-3.0-only
/** Operator-provided public source offer. It is never fetched/proxied by a Worker.
 * Deliberately exclude credentials and query strings (no signed/expiring URLs).
 */
export function sourceURL(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s<>"\\]/.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname.includes('.')) return '';
    return url.href;
  } catch { return ''; }
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function legalFooter(value: unknown, zh: boolean): string {
  const source = sourceURL(value);
  return `<footer class="legal"><a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noreferrer">AGPL-3.0-only</a>${source ? `<a href="${escape(source)}" rel="noreferrer">${zh ? '对应源码' : 'Corresponding source'}</a>` : ''}</footer>`;
}
export function addSourceLink(response: Response, value: unknown): Response {
  const source = sourceURL(value);
  if (!source) return response;
  const headers = new Headers(response.headers);
  headers.append('Link', `<${source}>; rel="describedby"; title="Linro Corresponding Source"`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
