import { fail, rejectUnknown } from './http.js';
import { targetURL } from './validation.js';
export const CONTINENTS = ['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA'] as const;
export interface GeoRule { kind: 'country' | 'continent'; code: string; target_url: string }
export const MAX_GEO_RULES = 32;
/** Used for both API input and persisted/cache data. Codes are exact, not regexes.
 * Country codes use the Cloudflare/ISO alpha-2 form; XX/T1 never select a rule. */
export function geoRules(value: unknown): GeoRule[] {
  if (!Array.isArray(value) || value.length > MAX_GEO_RULES) fail(400, 'invalid_geo_rules', 'Choose at most 32 geographic rules.');
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(400, 'invalid_geo_rules', 'Each geographic rule must be an object.');
    const row = item as Record<string, unknown>;
    rejectUnknown(row, ['kind', 'code', 'target_url']);
    const { kind, code } = row;
    if (kind !== 'country' && kind !== 'continent') fail(400, 'invalid_geo_rules', 'Geographic rule kind must be country or continent.');
    if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code) || code === 'XX' || (kind === 'continent' && !(CONTINENTS as readonly string[]).includes(code))) fail(400, 'invalid_geo_rules', 'Use an uppercase two-letter country or continent code.');
    const key = `${kind}:${code}`;
    if (seen.has(key)) fail(400, 'duplicate_geo_rule', 'A region can occur only once per rule type.');
    seen.add(key);
    return { kind, code, target_url: targetURL(row.target_url) };
  });
}
export function storedGeoRules(value: unknown): GeoRule[] {
  if (typeof value !== 'string' || value.length > 65536) fail(503, 'invalid_geo_rules', 'Invalid stored geographic rules.');
  try { return geoRules(JSON.parse(value)); }
  catch { return fail(503, 'invalid_geo_rules', 'Invalid stored geographic rules.'); }
}
/** Trust only Worker-provided request.cf. Never use IPCountry/XFF/query inputs. */
export function chooseGeoTarget(rules: GeoRule[], fallback: string, request: Request): string {
  const cf = (request as Request & { cf?: { country?: unknown; continent?: unknown } }).cf;
  const country = typeof cf?.country === 'string' && /^[A-Z]{2}$/.test(cf.country) && cf.country !== 'XX' ? cf.country : '';
  const continent = typeof cf?.continent === 'string' && (CONTINENTS as readonly string[]).includes(cf.continent) ? cf.continent : '';
  return rules.find(r => r.kind === 'country' && r.code === country)?.target_url
    ?? rules.find(r => r.kind === 'continent' && r.code === continent)?.target_url
    ?? fallback;
}
