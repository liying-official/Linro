/** Origin check for the password page's navigation POST, not for the Admin API.
 * With Referrer-Policy: no-referrer, browsers may serialize its Origin as null.
 * Fetch Metadata is browser-controlled, but is NOT authentication for arbitrary
 * HTTP clients: the password, rate limits and current D1 rule still apply.
 */
export function isSameOriginUnlock(request: Request): boolean {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  // Reject cross-site, same-site (a sibling origin), none and malformed metadata.
  // Legacy clients without Fetch Metadata must supply the exact real Origin.
  if (site !== null && site !== 'same-origin') return false;
  if (origin === new URL(request.url).origin) return true;
  // Only an opaque/missing Origin can use the same-origin metadata fallback.
  // A contradictory explicit foreign Origin is NEVER excused by this header.
  return (origin === null || origin === 'null') && site === 'same-origin';
}
