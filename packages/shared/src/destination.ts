import type { Database, SharedEnv } from './platform.js';
import { fail } from './http.js';
import { canonicalHost, isPrivateTarget, securityPolicy } from './policy.js';
export type DestinationSettings = Pick<
  SharedEnv,
  'ADMIN_ORIGIN' | 'QUERY_FORWARD_ALLOWLIST' | 'PRIVATE_TARGET_ALLOWLIST' | 'EXPIRED_LINK_STATUS'
>;
/** Shared static policy, also applied on every KV hit. No DNS/network fetch. */
export function validateDestinationHost(target: string, env: DestinationSettings): string {
  const host = canonicalHost(new URL(target).hostname);
  let adminHost: string;
  try {
    adminHost = canonicalHost(new URL(env.ADMIN_ORIGIN).hostname);
  } catch {
    return fail(503, 'security_policy_invalid', 'ADMIN_ORIGIN must be configured on both Workers.');
  }
  const policy = securityPolicy(env);
  if (host === adminHost)
    fail(400, 'internal_target', 'The administration host cannot be a redirect target.');
  if (isPrivateTarget(host) && !policy.privateTargets.includes(host))
    fail(
      400,
      'private_target',
      'Private, local and special-use destinations require an exact deployment-level exception.',
    );
  return host;
}
export async function validateDestination(
  db: Database,
  target: string,
  env: SharedEnv,
): Promise<void> {
  const host = validateDestinationHost(target, env);
  const managed = await db
    .prepare('SELECT id FROM domains WHERE hostname=? LIMIT 1')
    .bind(host)
    .first();
  if (managed)
    fail(
      400,
      'redirect_chain',
      'Managed short-link domains cannot be redirect destinations. Use the final destination.',
    );
}
