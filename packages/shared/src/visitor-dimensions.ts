import type { Env } from './platform.js';
export type DeviceClass = 'mobile' | 'pc' | 'none';
/** Cloudflare IP-geolocation timezone, NOT the browser's configured timezone.
 * Kept as the original blob6 for historical continuity. Browser timezone is
 * collected separately by browser-check.ts; never backfill it from this value. */
export function visitorDimensions(request: Request, env: Env): { timezone: string; device: DeviceClass } {
  const cf = (request as Request & { cf?: { timezone?: unknown } }).cf;
  const zone = cf?.timezone;
  const timezone = typeof zone === 'string' && zone.length <= 64 &&
    /^[A-Za-z][A-Za-z0-9._+\-]*(?:\/[A-Za-z0-9._+\-]+){0,3}$/.test(zone) ? zone : 'none';
  // This opt-in requires the administrator to enable Cloudflare's generated
  // CF-Device-Type header and verify that incoming values are overwritten.
  // A header alone is not evidence of origin; default to none without opt-in.
  const raw = env.CLOUDFLARE_DEVICE_TYPE_ENABLED === 'true' && cf ? request.headers.get('cf-device-type') : null;
  const device: DeviceClass = raw === 'mobile' || raw === 'tablet' ? 'mobile' : raw === 'desktop' ? 'pc' : 'none';
  return { timezone, device };
}
