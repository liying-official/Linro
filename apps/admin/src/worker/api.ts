import type { Context, AdminEnv, Principal } from '../../../../packages/shared/src/platform.js';
import { fail, integer, json } from '../../../../packages/shared/src/http.js';
import { requireScope, requireBrowser } from './auth.js';
import { stats, statsSelection, statsView } from './analytics.js';
import type { ApiContext } from './api-context.js';
import { getUsers, createUser, updateUser } from './user-api.js';
import { getTokens, createToken, revokeToken } from './token-api.js';
import {
  getSession,
  getSummary,
  getSettings,
  updateSettings,
  getSystemHealth,
} from './workspace-api.js';
import { getAudit } from './audit-api.js';
import { bulkLinks, createLink, deleteLink, getLink, importLinks, updateLink } from './link-api.js';
import { createDomain, deleteDomain, getDomains, updateDomain } from './domain-api.js';
import { getLinks } from './link-list.js';
import { getStatsArchive } from './stats-archive.js';

type RouteHandler = (context: ApiContext) => Promise<Response>;
// An array documents action-dependent alternatives; bulkLinks checks the chosen action.
type RouteScope = string | readonly string[];

interface Route {
  name: string;
  method: string;
  pattern: RegExp;
  scope?: RouteScope;
  interactive?: boolean;
  handler: RouteHandler;
}

const ID = '(?<id>[0-9a-f-]{36})';

/** Permission and session requirements stay beside each endpoint definition. */
export const routes: readonly Route[] = [
  { name: 'session.get', method: 'GET', pattern: /^\/session$/, handler: getSession },
  {
    name: 'summary.get',
    method: 'GET',
    pattern: /^\/summary$/,
    scope: 'links:read',
    handler: getSummary,
  },
  {
    name: 'links.list',
    method: 'GET',
    pattern: /^\/links$/,
    scope: 'links:read',
    handler: getLinks,
  },
  {
    name: 'links.create',
    method: 'POST',
    pattern: /^\/links$/,
    scope: 'links:write',
    handler: createLink,
  },
  {
    name: 'links.get',
    method: 'GET',
    pattern: new RegExp(`^/links/${ID}$`),
    scope: 'links:read',
    handler: getLink,
  },
  {
    name: 'links.update',
    method: 'PATCH',
    pattern: new RegExp(`^/links/${ID}$`),
    scope: 'links:write',
    handler: updateLink,
  },
  {
    name: 'links.delete',
    method: 'DELETE',
    pattern: new RegExp(`^/links/${ID}$`),
    scope: 'links:delete',
    handler: deleteLink,
  },
  {
    name: 'links.import',
    method: 'POST',
    pattern: /^\/links\/import$/,
    scope: 'links:write',
    handler: importLinks,
  },
  {
    name: 'links.bulk',
    method: 'POST',
    pattern: /^\/links\/bulk$/,
    scope: ['links:write', 'links:delete'],
    handler: bulkLinks,
  },
  {
    name: 'domains.list',
    method: 'GET',
    pattern: /^\/domains$/,
    scope: 'domains:read',
    handler: getDomains,
  },
  {
    name: 'domains.create',
    method: 'POST',
    pattern: /^\/domains$/,
    scope: 'domains:write',
    handler: createDomain,
  },
  {
    name: 'domains.update',
    method: 'PATCH',
    pattern: new RegExp(`^/domains/${ID}$`),
    scope: 'domains:write',
    handler: updateDomain,
  },
  {
    name: 'domains.delete',
    method: 'DELETE',
    pattern: new RegExp(`^/domains/${ID}$`),
    scope: 'domains:write',
    handler: deleteDomain,
  },
  {
    name: 'stats.get',
    method: 'GET',
    pattern: /^\/stats$/,
    scope: 'analytics:read',
    handler: getStats,
  },
  {
    name: 'stats.archive',
    method: 'GET',
    pattern: /^\/stats\/archive$/,
    scope: 'analytics:read',
    handler: getStatsArchive,
  },
  {
    name: 'users.list',
    method: 'GET',
    pattern: /^\/users$/,
    scope: 'users:write',
    interactive: true,
    handler: getUsers,
  },
  {
    name: 'users.create',
    method: 'POST',
    pattern: /^\/users$/,
    scope: 'users:write',
    interactive: true,
    handler: createUser,
  },
  {
    name: 'users.update',
    method: 'PATCH',
    pattern: new RegExp(`^/users/${ID}$`),
    scope: 'users:write',
    interactive: true,
    handler: updateUser,
  },
  {
    name: 'tokens.list',
    method: 'GET',
    pattern: /^\/tokens$/,
    interactive: true,
    handler: getTokens,
  },
  {
    name: 'tokens.create',
    method: 'POST',
    pattern: /^\/tokens$/,
    interactive: true,
    handler: createToken,
  },
  {
    name: 'tokens.revoke',
    method: 'DELETE',
    pattern: new RegExp(`^/tokens/${ID}$`),
    interactive: true,
    handler: revokeToken,
  },
  {
    name: 'audit.list',
    method: 'GET',
    pattern: /^\/audit$/,
    scope: 'audit:read',
    handler: getAudit,
  },
  {
    name: 'settings.get',
    method: 'GET',
    pattern: /^\/settings$/,
    scope: 'settings:write',
    interactive: true,
    handler: getSettings,
  },
  {
    name: 'settings.update',
    method: 'PATCH',
    pattern: /^\/settings$/,
    scope: 'settings:write',
    interactive: true,
    handler: updateSettings,
  },
  {
    name: 'system.health',
    method: 'GET',
    pattern: /^\/system\/health$/,
    scope: 'settings:write',
    handler: getSystemHealth,
  },
];

export async function api(
  request: Request,
  env: AdminEnv,
  principal: Principal,
  requestId: string,
  executionContext?: Context,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice('/Linro/v1'.length);

  for (const route of routes) {
    if (route.method !== request.method) continue;
    const match = route.pattern.exec(path);
    if (!match) continue;
    if (typeof route.scope === 'string') requireScope(principal, route.scope);
    if (route.interactive) requireBrowser(principal);
    return route.handler({
      request,
      env,
      principal,
      requestId,
      executionContext,
      url,
      params: match.groups ?? {},
    });
  }

  return fail(404, 'api_not_found', 'API endpoint or method not found.');
}

async function getStats({ env, url, request }: ApiContext): Promise<Response> {
  const days = integer(Number(url.searchParams.get('days') ?? 7), 'days', 1, 90);
  return json(await stats(env, days, statsSelection(url), statsView(url), request.signal));
}
