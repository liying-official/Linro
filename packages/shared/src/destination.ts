import type { Database, Env } from './platform.js';
import { fail } from './http.js';
import { canonicalHost, isPrivateTarget, securityPolicy } from './policy.js';
/** Shared static policy, also applied on every KV hit. No DNS/network fetch. */
export function validateDestinationHost(target: string, env: Env): string {
  const host = canonicalHost(new URL(target).hostname);
  let adminHost: string;
  try { adminHost = canonicalHost(new URL(env.ADMIN_ORIGIN).hostname); }
  catch { return fail(503, 'security_policy_invalid', 'ADMIN_ORIGIN must be configured on both Workers.'); }
  const policy = securityPolicy(env);
  if (host === adminHost) fail(400, 'internal_target', 'The administration host cannot be a redirect target.');
  if (isPrivateTarget(host) && !policy.privateTargets.includes(host)) fail(400, 'private_target', 'Private, local and special-use destinations require an exact deployment-level exception.');
  return host;
}
export async function validateDestination(db: Database, target: string, env: Env): Promise<void> {
  const host = validateDestinationHost(target, env);
  const managed = await db.prepare('SELECT id FROM domains WHERE hostname=? LIMIT 1').bind(host).first();
  if (managed) fail(400, 'redirect_chain', 'Managed short-link domains cannot be redirect destinations. Use the final destination.');
}
/** One indexed host-set check per link, including all geo destinations. This
 * keeps a 10-link import batch below D1's per-invocation statement budget. */
export async function validateDestinations(db: Database, targets: string[], env: Env): Promise<void> {
  const hosts = [...new Set(targets.map(t => validateDestinationHost(t, env)))];
  const found = await db.prepare(`SELECT id FROM domains WHERE hostname IN (${hosts.map(() => '?').join(',')}) LIMIT 1`).bind(...hosts).first();
  if (found) fail(400, 'redirect_chain', 'Managed short-link domains cannot be redirect destinations. Use the final destination.');
}
