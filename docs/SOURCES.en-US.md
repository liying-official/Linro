# Linro v1.0.1 Documentation Sources

[简体中文](SOURCES.md) · [Guide](GUIDE.en-US.md)

Application behavior is grounded in the supplied v1.0.1 source, not a moving default-branch HEAD or an unverified online instance.

| Topic | Path relative to the source archive |
| --- | --- |
| Version and commands | `package.json`, `package-lock.json`, `packages/shared/src/platform.ts` |
| Deployment and public configuration | `scripts/config-lib.mjs`, `configure.mjs`, `preflight.mjs`, `apps/*/wrangler.jsonc` |
| Admin routes, data, roles, analytics | `apps/admin/src/worker/{index,api,data,auth,analytics}.ts` |
| JWT, responses, fields, policies | `packages/shared/src/{access,http,validation,policy,destination}.ts` |
| Public access and protection | `apps/redirect/src/`, `packages/shared/src/{browser-check,link-password,redirect-cache,geo,text-response}.ts` |
| Interface, import/export, languages | `apps/admin/src/web/` |
| Schema and upgrades | `migrations/0001_initial.sql` through `0004_browser_checks.sql` |
| Packaging and verification | `scripts/package-source.mjs`, `runtime-toolchain.mjs`, `check-deployment.mjs`, `tests/` |

Official references below explain platform semantics, not the complete application contract or proof of a successful deployment. Platform guidance changes; recheck it before release.

[Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) · [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [Wrangler Worker commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/) · [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) · [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) · [Access Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)

The authoritative AGPL text is included as [LICENSE](../LICENSE). See [NOTICE](../NOTICE) and [Licensing](LICENSING.en-US.md) for attribution. Verify historical compatibility against the relevant source version and migration records.
