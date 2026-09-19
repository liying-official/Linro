import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { validateConfig } from './config-lib.mjs';
import { geoRules } from '../.build/packages/shared/src/geo.js';
import { plainText, responseMode } from '../.build/packages/shared/src/text-response.js';
import { targetURL } from '../.build/packages/shared/src/validation.js';
import { canonicalHost, isPrivateTarget, sensitiveTarget, securityPolicy } from '../.build/packages/shared/src/policy.js';

/** Offline, read-only upgrade review of a GUI JSON export. No network, SQL
 * writes, credentials, URL query strings or destination paths are emitted. */
export function auditLinks(data, config = undefined) {
  if (config !== undefined) validateConfig(config);
  const links = Array.isArray(data) ? data : data?.links;
  if (!Array.isArray(links) || links.length > 10000 || links.some(l => !l || typeof l !== 'object' || Array.isArray(l))) throw new Error('Expected a JSON links array with at most 10000 rows.');
  const env = config ? {
    QUERY_FORWARD_ALLOWLIST: JSON.stringify(config.query_forward_allowlist ?? ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']),
    PRIVATE_TARGET_ALLOWLIST: JSON.stringify(config.private_target_allowlist ?? []),
    EXPIRED_LINK_STATUS: String(config.expired_link_status ?? 404),
  } : {};
  const policy = securityPolicy(env);
  const managed = new Set((config?.redirect_hosts ?? []).map(canonicalHost));
  if (Array.isArray(data?.domains)) for (const d of data.domains) if (typeof d?.hostname === 'string') managed.add(canonicalHost(d.hostname));
  const groups = new Map();
  const rows = links.map((link, index) => {
    const codes = [];
    if (typeof link.slug === 'string' && link.slug.toLowerCase().startsWith('__linro_')) codes.push('reserved_control_namespace');
    const key = `${String(link.domain_id ?? link.hostname ?? '')}\0${String(link.slug ?? '').toLowerCase()}`;
    const group = groups.get(key) ?? []; group.push(index); groups.set(key, group);
    let output;
    try { output = responseMode(link.response_mode ?? 'redirect'); } catch { codes.push('invalid_response_mode'); }
    let target;
    if (output === 'text') {
      try { plainText(link.text_content); } catch { codes.push('invalid_text_content'); }
      if (link.query_mode !== 'discard') codes.push('invalid_query_mode');
      codes.push('plain_text_export_contains_content'); // Review privacy, never print the content.
    } else if (output === 'redirect') {
      try { target = new URL(targetURL(link.target_url)); } catch { codes.push('invalid_target'); }
    }
    if (target) {
      const host = canonicalHost(target.hostname);
      if (config && host === config.admin_host) codes.push('admin_target_blocked');
      if (managed.has(host)) codes.push('managed_target_blocked');
      if (isPrivateTarget(host) && !policy.privateTargets.includes(host)) codes.push('private_target_blocked');
      if (link.query_mode === 'merge' || link.query_mode === 'replace') codes.push(sensitiveTarget(target.href) ? 'sensitive_target_forced_discard' : 'forward_allowlist_review');
      else if (link.query_mode !== 'discard') codes.push('invalid_query_mode');
    }
    if (link.geo_rules !== undefined) {
      try {
        const rules = geoRules(typeof link.geo_rules === 'string' ? JSON.parse(link.geo_rules) : link.geo_rules);
        if (output === 'text' && rules.length) codes.push('text_geo_conflict');
        for (const rule of rules) {
          const destination = new URL(rule.target_url), host = canonicalHost(destination.hostname);
          if (config && host === config.admin_host) codes.push('geo_admin_target_blocked');
          if (managed.has(host)) codes.push('geo_managed_target_blocked');
          if (isPrivateTarget(host) && !policy.privateTargets.includes(host)) codes.push('geo_private_target_blocked');
          if (link.query_mode !== 'discard' && sensitiveTarget(destination.href)) codes.push('geo_sensitive_target_forced_discard');
        }
      } catch { codes.push('invalid_geo_rules'); }
    }
    if (link.password_protected === true || link.password_protected === 'true') codes.push('protected_export_requires_new_password_on_import');
    if (link.max_redirects != null && (!Number.isSafeInteger(link.max_redirects) || link.max_redirects < 1 || link.max_redirects > 1000000000)) codes.push('invalid_redirect_limit');
    if (!link.created_by) codes.push('owner_null_or_missing');
    if (Number(link.cache_ttl) > 0) codes.push('client_cache_revocation_delay');
    if (link.expires_at !== null && link.expires_at !== undefined && policy.expiredStatus === 404) codes.push('expiry_now_404');
    return { row: index + 1, id: String(link.id ?? ''), slug: String(link.slug ?? ''), codes };
  });
  for (const group of groups.values()) if (group.length > 1 && new Set(group.map(i => String(links[i].slug))).size > 1) for (const i of group) rows[i].codes.push('case_collision_review');
  return {
    format_version: 1, total: links.length, flagged: rows.filter(row => row.codes.length).length,
    policy: { queryKeys: policy.queryKeys, expiredStatus: policy.expiredStatus },
    configured: config !== undefined, findings: rows.filter(row => row.codes.length),
    limitations: 'Offline export only, not a database snapshot, DNS check or cloud audit. Without --config the admin host and custom exceptions cannot be checked. Missing created_by in external exports does not prove a null database owner. No changes were made.',
  };
}
async function smallJSON(path) {
  if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error('Input exceeds 16 MiB.');
  return JSON.parse(await readFile(path, 'utf8'));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2); const opts = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      if (!['--input', '--config'].includes(key) || !args[i + 1] || opts[key]) throw new Error('Usage: npm run audit:links -- --input EXPORT.json [--config deployment.json]');
      opts[key] = args[i + 1];
    }
    if (!opts['--input']) throw new Error('--input EXPORT.json is required.');
    const result = auditLinks(await smallJSON(opts['--input']), opts['--config'] ? await smallJSON(opts['--config']) : undefined);
    console.log(JSON.stringify(result, null, 2));
    if (result.flagged) process.exitCode = 2; // review required, NOT auto-repaired
  } catch (error) { console.error('Security review failed: ' + error.message); process.exitCode = 1; }
}
