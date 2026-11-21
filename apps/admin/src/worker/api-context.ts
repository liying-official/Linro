import type { Context, AdminEnv, Principal } from '../../../../packages/shared/src/platform.js';
import { fail, integer } from '../../../../packages/shared/src/http.js';

export interface ApiContext {
  request: Request;
  env: AdminEnv;
  principal: Principal;
  requestId: string;
  executionContext?: Context;
  url: URL;
  params: Readonly<Record<string, string | undefined>>;
}

export function routeId(context: ApiContext): string {
  return context.params.id ?? fail(500, 'route_parameter_missing', 'Route parameter is missing.');
}

export function needVersion(body: Record<string, unknown>): number {
  return integer(body.version, 'version', 1, Number.MAX_SAFE_INTEGER);
}
