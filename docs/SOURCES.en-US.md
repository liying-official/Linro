# Where the documentation comes from

[简体中文](SOURCES.md) · [Guide](GUIDE.en-US.md) · [API](API.en-US.md)

This documentation describes the packaged **Linro v1.0.2** source. A website's current default branch or a running deployment can differ. When checking a statement, start with the matching file below.

## Find the right implementation

| You are checking… | Look in… |
| --- | --- |
| Version, dependencies, available commands | `package.json`, `package-lock.json`, `packages/shared/src/platform.ts` |
| Deployment fields, defaults, validation | `scripts/config-lib.mjs`, `scripts/configure.mjs`, `scripts/preflight.mjs` |
| Worker entry points and public templates | `apps/admin/wrangler.jsonc`, `apps/redirect/wrangler.jsonc`, each Worker's `index.ts` |
| API paths and required scopes | `apps/admin/src/worker/api.ts` and the adjacent `*-api.ts` modules |
| Roles, token permissions, ownership | `apps/admin/src/worker/auth.ts` |
| Field normalization and destination policy | `apps/admin/src/worker/link-fields.ts`, `packages/shared/src/validation.ts`, `policy.ts`, `destination.ts` |
| Lists, cursor paging, archived counts | `apps/admin/src/worker/link-list.ts`, `list-pagination.ts`, `audit-api.ts`, `stats-archive.ts` |
| Live statistics and rollup checkpoints | `apps/admin/src/worker/analytics.ts`, `analytics-provider.ts`, `analytics-rollup.ts` |
| Passwords, browser checks, and route caching | `apps/redirect/src/`, `packages/shared/src/link-password.ts`, `browser-check.ts`, `radar-asn.ts`, `vpn-latency.ts`, `redirect-cache.ts` |
| Dashboard, import/export, language strings | `apps/admin/src/web/` |
| Static practice demo | `apps/demo/` and generated `docs/demo/` |
| Database schema and upgrades | All six files in `migrations/`, from `0001_initial.sql` through `0006_destination_hosts_and_archive.sql` |
| Offline documentation and source packaging | `scripts/build-docs.mjs`, `scripts/package-source.mjs` |
| Verification | `tests/`, `scripts/runtime-toolchain.mjs`, `scripts/check-deployment.mjs` |

The interface uses sky-blue `#87CEEB`, white `#FFFFFF`, and dark text `#0D394A`. See `apps/admin/src/web/styles.css`, `tailadmin/theme.css`, and `apps/redirect/src/public-pages.ts`. If you change colors, check contrast and keyboard focus visibility; the color list alone is not an accessibility certification.

## Cloudflare's own references

These links explain the platform. Linro's source determines which platform features this application actually uses. Platform pages and account capabilities can change, so check the current page before changing production settings.

- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)
- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 pricing and row metrics](https://developers.cloudflare.com/d1/platform/pricing/)
- [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)
- [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Radar token setup](https://developers.cloudflare.com/radar/get-started/first-request/)
- [Request metadata, including connection RTT](https://developers.cloudflare.com/workers/runtime-apis/request/)
- [Wrangler Worker commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)

These references do not certify that a particular account, DNS record, secret, or deployment works. Use the [guide's verification steps](GUIDE.en-US.md) for the instance you operate.

## License sources

The authoritative project license is [LICENSE](../LICENSE). Attribution and fixed upstream references are in [NOTICE](../NOTICE) and [LICENSES](../LICENSES/). The beginner explanation in [Licensing](LICENSING.en-US.md) does not replace those texts.
