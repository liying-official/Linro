# Linro v1.0.1 User and Deployment Guide

[简体中文](GUIDE.md) · [README](../README.en-US.md) · [API](https://liying-official.github.io/Linro/?lang=en#api-reference)

<a id="guide"></a>

## 01 · Reading Guide and Version Boundaries

Version scope: this manual describes the supplied Linro v1.0.1 source distribution. Source references are paths within that release, not moving HEAD links. Deployment commands are operator procedures, not claims that an instance has been deployed, passed testing, or met all license obligations.

This manual describes deployment, configuration, permissions, and APIs for Linro v1.0.1. Commands and fields follow the matching source version; release tests do not replace production acceptance of an actual instance.

| What you want to accomplish | Where to read |
| --- | --- |
| Deploy from scratch | [First installation](#install) → [First use](#usage) → [Production acceptance](#acceptance) |
| Upgrade an existing instance while preserving the database and secrets | [Preserving-configuration upgrade](#upgrade); do not directly reuse the first-installation workflow |
| Adjust domains, cache, analytics, or browser checks | [Configuration Reference](#configuration) → [Optional features](#features) |
| Add members, assign permissions, or integrate automation | [Users and permissions](#permissions) → [API conventions](https://liying-official.github.io/Linro/?lang=en#api-conventions) |
| Build a client program | [Data models](https://liying-official.github.io/Linro/?lang=en#models) → [Admin API](https://liying-official.github.io/Linro/?lang=en#api-reference) → [Call examples](#examples) |
| Troubleshoot public access or maintain the database | [Public access protocol](https://liying-official.github.io/Linro/?lang=en#public-api) → [Backup and restore](#operations) → [Troubleshooting](#troubleshooting) |

**All commands assume you are in the extracted project root.** For example, that directory contains `package.json`, `deployment.example.json`, `apps/`, `migrations/`.`admin.example.com`, `go.example.com`, all `YOUR_…`, `<…>`, example UUIDs are placeholders and must be replaced; example keys are not real credentials. Code blocks are labeled Bash or PowerShell—do not mix their line-continuation syntax. On Windows, use `curl.exe`to avoid the legacy PowerShell `curl` alias.

This document does not certify current Cloudflare plan prices, free quotas, the latest dashboard UI, or plan availability; check the actual account for those details. License statements in the project materials are presented only as project labels and operating conventions and are not expanded here into legal conclusions.

<a id="architecture"></a>

## 02 · Project Structure and How It Works

<a id="section-2-1"></a>

### 2.1 Deployment Architecture

Linro is a short-link management platform with a Simplified Chinese / English admin interface. It deploys as two Cloudflare Workers sharing one D1 database. The admin UI is static content built with React + Vite and is served by **the Admin Worker’s Static Assets** ; this release does not require a separate Pages project.

```text
Admin browser / automation client
            │
            ▼
Admin domain → Cloudflare Access → Admin Worker → D1
                                     │           ▲
                                     ├─ ASSETS   │
                                     ├─ AE query │
                                     └─ Cron archive ┘

Public visitor → short-link domain → Redirect Worker → latest D1 state check
                                      │
                                      ├─ optional KV route cache (not an authorization source)
                                      ├─ optional password / browser check
                                      ├─ geo routing → 301 / 302 / 307 / 308
                                      ├─ or direct plain-text 200 response
                                      └─ optional Analytics Engine event write
```

| Component | Responsibility | Does not handle |
| --- | --- | --- |
| Admin Worker | Access JWT revalidation, roles and scopes, API, GUI, audit, analytics queries, and archiving | Does not serve public short links and does not proxy target websites |
| Redirect Worker | Short-code lookup, protection policies, routing, plain-text responses, limits, and event writes | Does not grant admin permissions to visitors and does not fetch target-page content |
| D1 / `DB` | Users, domains, links, token hashes, settings, audit, and daily statistics | Does not store Worker root secrets |
| KV / `REDIRECT_CACHE` | Optional route-data cache; D1 is still read after a hit | Not a backup, strict counter, or database-outage fallback authorization channel |
| Analytics Engine | Sampled events and queries | Not an exact-UV system and not responsible for permissions or quota decisions |
| Cloudflare Access | Outer authentication for the admin domain | Passing Access does not by itself make someone a Linro user |

The admin domain and short-link domains must be separate.**The Cloudflare Custom Domain binding**routes requests to the Redirect Worker;**the Linro domain record**allows business links for that host in D1. Both are required. Adding a domain in the GUI does not automatically create DNS or a Worker Custom Domain.

The current admin UI adapts TailAdmin React MIT layouts and components with Recharts and Tailwind CSS, without ApexCharts dependencies. The palette uses sky blue #87CEEB, white #FFFFFF, and ink #0D394A, with Simplified Chinese and English. License texts are included under LICENSES/.

<a id="section-2-2"></a>

### 2.2 Current Protocol Identifiers

| Object | v1.0.1 identifier |
| --- | --- |
| Admin API prefix | `/Linro/v1` |
| Application token | `Linro_` + 43-character base64url random string |
| CSRF header for browser write requests | `X-Linro-CSRF: 1` |
| Local-development authentication header | `X-Linro-Dev` |
| Password unlock | `/__Linro_unlock/:slug` |
| Browser check | `/__Linro_browser/:slug` |
| Public styles / scripts | `/__Linro_assets/password.css`, `/__Linro_assets/browser.js` |
| Production visitor cookie | `__Host-Linro_unlock_*`, `__Host-Linro_browser_*` |
| Development visitor cookie | `Linro_unlock_*`, `Linro_browser_*` |
| Internal parameter | `_Linro_check`, `_Linro_lang` |
| JSON export format name | `linro` |

URL paths, slugs, tokens, and cookie names are case-sensitive; HTTP header names are case-insensitive. Clients should use the Linro identifiers listed here. Use the complete application token returned on creation; editing a prefix does not migrate a token.

<a id="section-2-3"></a>

### 2.3 Source Code Navigation

| Path | Content |
| --- | --- |
| `apps/admin/src/worker/index.ts` | Admin entry point, same-origin restrictions, authentication, static assets, Cron |
| `apps/admin/src/worker/api.ts` | 25 Admin API method / path combinations |
| `apps/admin/src/worker/auth.ts` | User resolution, RBAC, token scopes, ownership, and CSRF |
| `apps/admin/src/worker/data.ts` | Link input, public return object, and audit |
| `apps/admin/src/worker/analytics.ts` | AE queries, filtering, and D1 daily archive |
| `apps/admin/src/web/` | Admin GUI, import/export, language, and forms |
| `apps/redirect/src/` | Public access, password page, and browser-check page |
| `packages/shared/src/` | Types, validation, passwords, timezone, cache, and security policy |
| `scripts/config-lib.mjs`, `configure.mjs`, `preflight.mjs` | Configuration generation and local prechecks |
| `migrations/0001` through `0004` | data structure and rule-revision triggers |

**Basis:** `package.json`; `apps/admin/src/worker/index.ts`; `apps/redirect/src/index.ts`; `docs/PROTOCOL-v1.0.1.md`.

<a id="install"></a>

## 03 · First Installation: From Source to Cloudflare

<a id="section-3-1"></a>

### 3.1 Prerequisites and Operational Boundaries

Prepare a Cloudflare account, separate domains for the admin and public endpoints, a real email that can sign in through Access, local Node.js / npm, and permissions for the target deployment account. The project declares **Node.js ≥22.16.0**; the source pins Wrangler **4.132.0**. The complete source ZIP includes `package-lock.json`, so prefer `npm ci`and retain the bundled lockfile instead of rebuilding the dependency tree.

| Command category | Modifies cloud resources? |
| --- | --- |
| `npm ci`, `check`, `build`, `test`, `configure`, `preflight` | Does not deploy application code; mainly reads/writes local files, while dependency installation requires network access |
| `deploy:dry-run`, `versions upload --dry-run` | Does not publish production traffic and is not a complete online acceptance test |
| `wrangler login` | Authorizes the local machine; this is not Linro admin login |
| `d1 create`, remote migration / SQL import | Creates or modifies the cloud database |
| `deploy`, `versions deploy`, `secret put` | Changes cloud services; the two Workers are not updated atomically |
| D1 remote export | Reads cloud business data; project material notes that queries may be briefly affected |

The examples use step-by-step execution. Continue only after each step succeeds. Do not combine remote database creation, migrations, secret rotation, and release into an unchecked one-click script.

<a id="section-3-2"></a>

### 3.2 Extract, Verify the Version, and Install Dependencies

Extract the ZIP and enter `Linro-v1.0.1`. Confirm that the root directory is this release:

```bash
node --version
npm --version
node -p "require('./package.json').name + ' ' + require('./package.json').version"
npm ci
npm run toolchain:versions
npm run check
npm run build
```

Expected project metadata: `linro 1.0.1`.`toolchain:versions` Use the project’s Wrangler dependency tree to display Wrangler / Miniflare / workerd versions; it does not silently switch to a global Miniflare or download replacement tooling. If dependency installation fails, check network access, OS-native packages, and the lock file instead of deleting the lock or forcing automatic upgrades.

On Linux (or macOS with GNU coreutils), if `sha256sum` is available, verify the source manifest from the project root:

```bash
sha256sum -c MANIFEST.sha256
```

<a id="section-3-3"></a>

### 3.3 Sign In and Confirm the Deployment Account

```bash
npx wrangler --version
npx wrangler login
npx wrangler whoami
```

Confirm Wrangler is the project-pinned version and that `whoami` its Account ID is the target account. Account ID, Zone ID, Access AUD, and D1 Database ID are different values. Before creating D1, explicitly select the account to avoid deploying into the wrong default account:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = Read-Host "Target Cloudflare Account ID"
```

```bash
read -r -p "Target Cloudflare Account ID: " CLOUDFLARE_ACCOUNT_ID
export CLOUDFLARE_ACCOUNT_ID
```

Do not put deployment credentials in Worker vars, the frontend, or the source repository. Deployment authentication and the Access identity used to enter the Linro admin UI are separate.

<a id="section-3-4"></a>

### 3.4 Create a Production D1 Database

Only create a database for a genuine first installation. Existing databases should go to[Preserving-configuration upgrade](#upgrade).

```bash
npx wrangler d1 list
npx wrangler d1 create linro
npx wrangler d1 info linro
```

Record the real `database_name` and `database_id`. Both Workers must point to the same database; do not create separate databases for the admin and redirect sides. If creation asks whether to modify configuration automatically, decline that rewrite and generate both Worker configs together afterward.

Do not import the entire local-development database into production merely to “preserve the local Owner.” The production Owner must be established by a real Access login.

<a id="section-3-5"></a>

### 3.5 Protect the Entire Admin Domain First

Create a Self-hosted admin application in Cloudflare Zero Trust → Access Applications. Dashboard labels may change over time; the important requirements are the following configuration semantics:

| Access item | Value / check |
| --- | --- |
| Hostname | `admin.example.com`; replace with the real admin domain |
| Path | Leave blank so the entire host is protected, rather than protecting only `/Linro/*` |
| Human sign-in policy | Allow; explicitly specify Owner / member emails or a controlled identity group |
| Sign-in method | Use the email OTP or IdP actually configured for the account |
| Public short-link domains | Do not add them to this admin application; check that wildcard policies do not accidentally cover them |
| Forbidden practice | Do not configure Bypass and do not open the admin area to Everyone |

Save the same application’s `access_issuer`, `access_aud` and the first `owner_email`. The Issuer looks like `https://your-team.cloudflareaccess.com`with no trailing slash; the AUD is not the Application ID or an API token.

The Worker validates `Cf-Access-Jwt-Assertion` again. Admin static assets must remain `assets.run_worker_first: true` so they cannot bypass the Worker’s own authentication.`workers_dev` and `preview_urls` both remain `false`.

Creating an Access application requires Zero Trust administration permissions; Wrangler deployment authorization does not imply Access creation permission. Create the application separately in the dashboard and read its Audience under Additional settings → AUD tag.

<a id="section-3-6"></a>

### 3.6 Fill In the Initial Deployment Configuration

Back up existing files first to avoid overwriting them:

```powershell
if (Test-Path .\deployment.json) { throw "deployment.json already exists; review it instead of overwriting" }
Copy-Item .\deployment.example.json .\deployment.json
```

```bash
test ! -e deployment.json && cp deployment.example.json deployment.json
```

The following is a**recommended baseline example for a first deployment**. It deliberately sets `browser_timezone_enabled` to `false`which differs from the package default `true` so ordinary redirects can be brought up before the browser-check secret is configured. This does not change the source-code default. Existing instances should retain their actual settings rather than adopting this sample.

```json
{
  "account_id": "YOUR_CLOUDFLARE_ACCOUNT_ID",
  "database_id": "YOUR_D1_DATABASE_UUID",
  "database_name": "linro",
  "admin_worker_name": "linro-admin",
  "redirect_worker_name": "linro-redirect",
  "admin_host": "admin.example.com",
  "redirect_hosts": ["go.example.com"],
  "access_issuer": "https://your-team.cloudflareaccess.com",
  "access_aud": "YOUR_ACCESS_APPLICATION_AUD",
  "owner_email": "owner@example.com",
  "analytics_enabled": false,
  "analytics_dataset": "linro_clicks",
  "browser_timezone_enabled": false,
  "cloudflare_device_type_enabled": false,
  "auth_rate_namespace": "21001",
  "write_rate_namespace": "21002",
  "redirect_rate_namespace": "21003",
  "redirect_rate_limit": 300,
  "password_rate_namespace": "21004",
  "password_rate_limit": 5,
  "redirect_cache_namespace_id": "",
  "redirect_cache_ttl": 300,
  "query_forward_allowlist": [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"
  ],
  "private_target_allowlist": [],
  "expired_link_status": 404,
  "source_url": ""
}
```

This JSON still contains placeholders that cannot be deployed as-is.`source_url` Set this to a publicly published source-code URL corresponding to the running version. Leaving it blank triggers a precheck reminder; it does not upload source automatically. Do not pretend the admin or short-link URL is the source location.

Generate and review:

```bash
npm run configure
npm run preflight
```

`configure` **will overwrite** `apps/admin/wrangler.jsonc` and `apps/redirect/wrangler.jsonc`. It does not create Access, D1, business-domain records, or secrets. Do not run it against manually adjusted production configuration without reviewing the diff afterward.

```bash
node -e "const fs=require('node:fs');for(const f of ['apps/admin/wrangler.jsonc','apps/redirect/wrangler.jsonc']){const c=JSON.parse(fs.readFileSync(f,'utf8'));console.log(JSON.stringify({file:f,name:c.name,account:c.account_id,db:c.d1_databases,routes:c.routes,workers_dev:c.workers_dev,preview_urls:c.preview_urls,assets:c.assets},null,2));}"
```

Check names, Account ID, D1 ID, domains, asset directories, and security entry points.`preflight` This is only a local configuration check; it does not prove that remote identity policies, DNS, TLS, secrets, or the database are usable.

<a id="section-3-7"></a>

### 3.7 Apply Migrations and Deploy

First confirm the migration list:

```bash
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
```

This release requires four migrations:

| File | Purpose |
| --- | --- |
| `0001_initial.sql` | Base tables, indexes, and the trigger that preserves the final enabled Owner |
| `0002_link_controls.sql` | Geo rules, password verifier, access limit, counters, and rule revision |
| `0003_text_responses.sql` | Plain-text mode and body, plus trigger extensions |
| `0004_browser_checks.sql` | `block_vpn`and another extension of the rule-revision trigger |

After confirming the target database, apply remote migrations. Existing-data databases must be backed up first:

```bash
npm run db:migrate
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
```

Do not rerun SQL files one-by-one or delete migration records to bypass an error. Stop the release immediately if migration fails.

Run the local release checks:

```bash
npm run check
npm run test
npm run test:runtime
npm run build
npm run test:browser
npm run deploy:dry-run
```

`test:browser` Requires a real Chrome / Chromium executable environment; missing tooling or failed tests do not count as a pass.`test:runtime` Run the project toolchain’s native workerd tests; do not treat ordinary Node simulation as a complete substitute.

Production release:

```bash
npm run deploy
```

**The script’s actual order is:** `preflight → build → test → test:runtime → deploy:admin → deploy:redirect → verify:deployment`. This script**does not automatically run database migrations and does not include `test:browser`**; complete those relevant steps first. For existing installations, also follow Chapter 8 to check and preserve the actual configuration.

Set CFL_CHROMIUM_PATH to an installed browser before browser tests. Use /usr/bin/google-chrome on Linux / GitHub Ubuntu runners, or set $env:CFL_CHROMIUM_PATH to the actual Chrome or Edge executable in Windows PowerShell, then run npm run test:browser. Keep the browser sandbox enabled; a missing browser is not a passing test.

If a deployment has a Version ID but probing returns ENOTFOUND, check the Custom Domain and compare local and public DNS. A new hostname may still be affected by cached NXDOMAIN. After resolution updates, rerun only npm run verify:deployment; do not repeatedly redeploy, unbind the domain, or disable TLS validation.

<a id="section-3-8"></a>

### 3.8 First Sign-In and Basic Acceptance Checks

Open the admin domain and sign in through Access using the real email corresponding to `owner_email` . The system auto-creates the first Owner only when the users table is empty. Once users already exist, changing `owner_email` does not replace the existing Owner.

In “Domains,” add the business record for `go.example.com` then create a dedicated test short link:`slug=install-check`use a normal public target,`query_mode=discard`, `cache_ttl=0`and initially avoid password / limit / VPN checks.

```bash
npm run verify:deployment
curl -sS -D - -o /dev/null https://go.example.com/install-check
curl -sS https://go.example.com/health
```

On Windows, replace `curl` with `curl.exe`and discard output using `-o NUL`. Do not add `-L` to automatically follow the third-party destination as a substitute for first-hop verification. The first hop should have the configured status and the correct `Location`; public `/health` returns `status:ok`, `version:1.0.1`but does not query D1.

Then follow[Production acceptance](#acceptance)to verify permissions, error paths, and optional features. Enable password, browser checks, KV, and analytics one at a time only after the baseline service passes so configuration failures are easier to isolate.

**Basis:** `package.json`; `package-lock.json`; `scripts/configure.mjs`; `scripts/config-lib.mjs`; `scripts/preflight.mjs`; `README.md`; the four migration files.

<a id="configuration"></a>

## 04 · Configuration Reference

<a id="section-4-1"></a>

### 4.1 Three Configuration Layers

| Layer | How it is managed | Example |
| --- | --- | --- |
| Deployment layer | private `deployment.json` → `configure` → Wrangler configuration for both Workers | Domains, D1, Access, rate limits, KV, analytics, browser collection |
| Worker secret layer | Wrangler `secret put` or another controlled secret-management method | `LINK_PASSWORD_SECRET`, `BROWSER_CHECK_SECRET`, `ANALYTICS_API_TOKEN` |
| Application data layer | GUI / Admin API, stored in D1 | Links, users, domain records, domain default status code,`site_name` |

**The Owner role does not make someone a Cloudflare deployment administrator.** The GUI does not expose APIs for changing Worker bindings, root secrets, Access AUD, query-parameter allowlists, analytics switches, or collection switches.`PATCH /settings` Can only write `site_name`.

<a id="section-4-2"></a>

### 4.2 `deployment.json` Complete fields

The defaults below come from the **v1.0.1 configuration generator**; they are not this manual’s recommended first-install values and do not represent the actual configuration of an existing instance.

| Field | Type / default | Constraints and notes |
| --- | --- | --- |
| `account_id` | string, required | Actual 32-character lowercase hexadecimal Account ID; cannot be all zeroes |
| `database_id` | string, required | Actual D1 UUID; shared by both Workers |
| `database_name` | string, `linro` | 1–51 lowercase letters, digits, or hyphens; first character must be a letter or digit |
| `admin_worker_name` | string, `linro-admin` | 1–63 lowercase letters, digits, or hyphens; existing instances should explicitly preserve the current name |
| `redirect_worker_name` | string, `linro-redirect` | Same constraint; must not match the admin Worker name |
| `admin_host` | string, required | Lowercase DNS hostname, ≤253 characters, with no scheme, port, path, or trailing dot; IPv4 literals are not allowed |
| `redirect_hosts` | string[], required | 1–50 unique lowercase DNS hostnames; none may equal the admin host |
| `access_issuer` | string, required | `https://<team>.cloudflareaccess.com`with no trailing slash |
| `access_aud` | string, required | AUD for the same admin Access application, 16–256 letters / digits / `_` / `-`; obvious placeholder values are rejected |
| `owner_email` | string, required | Access email of the first Owner, ≤254 characters; lowercased when variables are generated |
| `analytics_enabled` | boolean, `false` | Analytics switch for both Workers; when enabled, generates write bindings and the Admin Cron |
| `analytics_dataset` | string, `linro_clicks` | 1–64 characters, starting with a letter or `_` and containing only letters / digits / `_`; do not rename an existing dataset merely because the product branding changed |
| `browser_timezone_enabled` | boolean, `true` | Global browser-timezone collection; requires `BROWSER_CHECK_SECRET`and changes the ordinary GET flow |
| `cloudflare_device_type_enabled` | boolean, `false` | Enable only after confirming the platform reliably creates / overwrites the device header; this is not a generic UA classification switch |
| `auth_rate_namespace` | Numeric string,`21001` | `AUTH_LIMITER`; all four namespaces must differ, each a 1–10 digit positive integer representation |
| `write_rate_namespace` | Numeric string,`21002` | `WRITE_LIMITER`; do not accidentally share them with another instance |
| `redirect_rate_namespace` | Numeric string,`21003` | `REDIRECT_LIMITER` |
| `redirect_rate_limit` | integer, `300` | 1–100000; 60-second window; not a daily account quota or globally atomic quota |
| `password_rate_namespace` | Numeric string,`21004` | `PASSWORD_LIMITER`, independent of the other three |
| `password_rate_limit` | integer, `5` | 1–30; 60-second window; the actual key is a source-IP hash, not the short code |
| `redirect_cache_namespace_id` | string, `""` | Empty means no KV binding; enabling requires a real non-zero 32-character lowercase hexadecimal namespace ID |
| `redirect_cache_ttl` | integer, `300` | 60–86400 seconds; KV entry lifetime, not browser cache TTL |
| `query_forward_allowlist` | string[], defaulting to five UTM keys | At most 32 unique exact lowercase keys matching `[a-z][a-z0-9_]{0,63}`; sensitive keys are forbidden |
| `private_target_allowlist` | string[], `[]` | At most 32 canonical exact host / IP literals; JSON ≤4096 characters; no scheme, port, wildcard, or CIDR |
| `expired_link_status` | number, `404` | Only accepts `404` or `410` |
| `source_url` | string, `""` | A public HTTPS source URL ≤2048 characters, with no credentials, query, fragment, whitespace, or backslash; it cannot be this deployment’s admin or short-link host |

The default query-parameter allowlist is `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`. This is not arbitrary `utm_*` wildcard matching.

`admin_worker_name` and `redirect_worker_name` Although not listed in the original `deployment.example.json`it is explicitly supported by the source. When the generator sees existing configuration with the same supplied **Account ID and D1 ID**it attempts to retain the prior Worker name. A public template in a fresh directory does not know real online state, so upgrades should still explicitly supply the original name.

Do not add `default_redirect_code`, `auth_rate_limit`, `write_rate_limit` or other nonexistent deployment fields and expect them to work: domain default status is set via the domain API; the generator fixes AUTH at 300 / 60s and WRITE at 120 / 60s. The generator also does not strictly reject every unknown top-level key, so misspellings may be ignored; rely on this table and generated output.

<a id="section-4-3"></a>

### 4.3 Generated Bindings and Variables

| Name | Admin | Redirect | Purpose |
| --- | --- | --- | --- |
| `DB` | Required? | Required? | Same D1 database; both migration directories point to root `migrations/` |
| `ASSETS` | Required? | None | Admin frontend; directory `apps/admin/dist`; SPA fallback + Worker-first handling |
| `AUTH_LIMITER` | 300 / 60 seconds | None | API and admin `/health` source-IP-hash bucket; executed before authentication |
| `WRITE_LIMITER` | 120 / 60 seconds | None | Non-GET/HEAD API requests limited by user ID + token ID / browser |
| `REDIRECT_LIMITER` | None | Default 300 / 60 seconds | Public-request source-IP bucket; executed before D1 lookup |
| `PASSWORD_LIMITER` | None | Default 5 / 60 seconds | Password verification attempts; same IP bucket shared across short codes |
| `REDIRECT_CACHE` | Optional | Optional | Same KV namespace on both Workers; configure both or neither |
| `ANALYTICS` | None | Generated when analytics is enabled | Analytics Engine write binding |
| Cron | When analytics is enabled `*/15 * * * *` | None | incremental archive, not a real-time snapshot every 15 minutes |

| Runtime variable | Source / explanation |
| --- | --- |
| `ENVIRONMENT` | Production generator fixes `production`; local initialization uses `development` |
| `ADMIN_ORIGIN` | `https://` + `admin_host`, same on both Workers |
| `ACCESS_ISSUER` / `ACCESS_AUD` / `BOOTSTRAP_OWNER_EMAIL` | Admin-only, for Access / first Owner |
| `CLOUDFLARE_ACCOUNT_ID` / `ANALYTICS_DATASET` | Admin AE query target |
| `ANALYTICS_ENABLED` | String on both Workers `"true"` / `"false"` |
| `BROWSER_TIMEZONE_ENABLED` / `CLOUDFLARE_DEVICE_TYPE_ENABLED` | Stringified boolean on both Workers |
| `QUERY_FORWARD_ALLOWLIST` / `PRIVATE_TARGET_ALLOWLIST` | JSON array string on both Workers |
| `EXPIRED_LINK_STATUS` / `REDIRECT_CACHE_TTL` | Numeric string on both Workers |
| `SOURCE_URL` | Public source entry on both Workers; no source Link header when empty |

The generator also fixes `compatibility_date: "2026-09-15"`, `workers_dev: false`, `preview_urls: false`, `observability.enabled: false`. Existing instances may contain additional manual settings; the generator is not a lossless round-trip converter for arbitrary online configuration.

<a id="section-4-4"></a>

### 4.4 Secret Reference and Secure Storage

| Secret / credential | Storage location | Valid format / purpose | Impact of change |
| --- | --- | --- | --- |
| `LINK_PASSWORD_SECRET` | Same Worker secret on both Workers | 43–128 base64url characters; recommended: 32 random bytes encoded as base64url | Losing / changing it affects verification of existing passwords, not merely cookie validity |
| `BROWSER_CHECK_SECRET` | Same value on both sides by deployment convention | 43–128 base64url characters; independent from the password root secret | Changing it invalidates old short-lived browser proofs but does not alter D1 password verifiers |
| `ANALYTICS_API_TOKEN` | Admin Worker secret only | Analytics query credential for the target account | Affects queries and Cron; not authentication for public redirects |
| `LOCAL_DEV_TOKEN` | Only `.local/.dev.vars` | Generated by local initialization; used for loopback development authentication | Must never be copied into production configuration |
| Access Service Token | Private storage on the calling client | Client ID + Client Secret; used to pass the outer Access layer | Does not replace the Linro bearer token |
| Linro application token | Private storage on the calling client | Full `Linro_…`; D1 stores only its hash | Becomes invalid after revocation / expiry / owner-user disablement |

**Generate root secrets for the first time:** Generate once in a private terminal and store in a password manager; do not write generated values into documentation, chat, repositories, or public terminal logs.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

For one purpose, both interactive entries below must match. Generate a different value for the other purpose.

```bash
npx wrangler secret put LINK_PASSWORD_SECRET --config apps/admin/wrangler.jsonc
npx wrangler secret put LINK_PASSWORD_SECRET --config apps/redirect/wrangler.jsonc

npx wrangler secret put BROWSER_CHECK_SECRET --config apps/admin/wrangler.jsonc
npx wrangler secret put BROWSER_CHECK_SECRET --config apps/redirect/wrangler.jsonc
```

Run these commands as needed only after the baseline Workers already exist. The installation material notes that `secret put` creates and deploys a new version and should be tracked as a production change; do not routinely regenerate root secrets on an existing instance.`preflight` and `/session.features.*_configured` Neither can prove that the remote secrets on both Workers are equal.

<a id="section-4-5"></a>

### 4.5 Query Forwarding and Target Security Policies

The target must be an explicit absolute `http://` or `https://` URL, ≤4096 characters, with no URL credentials, whitespace, control characters, or backslashes. The API does not fetch the destination page. The admin host and every registered short-link host are forbidden as targets to prevent internal redirect chains. Local / private targets are rejected by default; only exact hosts reviewed by the deployer can be allowlisted. This validation performs no DNS lookup, so it must not be described as complete DNS-rebinding protection.

| `query_mode` | Behavior |
| --- | --- |
| `discard` | Ignore visitor-supplied query parameters and preserve the target URL’s existing query |
| `merge` | Merge only incoming keys in the allowlist; an existing target value wins on duplicate keys |
| `replace` | Clear the target’s existing query, then apply allowlisted incoming parameters; if filtering leaves nothing, the old query is still cleared |

For example, target `https://example.org/page?a=1&utm_source=fixed` and visitor parameters `utm_source=new&utm_medium=email&token=secret`:

| Mode | Result |
| --- | --- |
| discard | `https://example.org/page?a=1&utm_source=fixed` |
| merge | `https://example.org/page?a=1&utm_source=fixed&utm_medium=email` |
| replace | `https://example.org/page?utm_source=new&utm_medium=email` |

Sensitive authentication / reset / redirect keys are forbidden from the allowlist. Sensitive targets recognized by source must use `discard`; otherwise writes fail with `unsafe_query_mode`. Existing rows of the same kind in an old database are treated as `discard` during public reads and are not automatically rewritten. Internal `_Linro_check` / `_Linro_lang` is never forwarded to the target. The combined redirect URL may be at most 8192 characters.

Public examples leave source_url empty so a repository homepage is not mistaken for the source of the deployed version. Before network use, publish complete Corresponding Source for the running version and set source_url to its publicly accessible revision or release source. Format validation and a nonempty value do not prove accessibility, completeness, or license compliance; verify these separately and retain the license and notices.

<a id="section-4-6"></a>

### 4.6 How to Change Parameters

After changing ordinary deployment settings, follow “back up current config → change controlled inputs → generate and review diff → preflight → build / test / dry-run → deploy → online acceptance.” Prefer the GUI / API for changing short-link content, enablement, passwords, or access limits so version locking and audit are preserved.

Deleting or disabling a link cannot revoke an old redirect response already cached by a visitor. Before enabling any protection, consider old `cache_ttl` and previously issued client cache entries. Fresh D1 verification after a KV hit still cannot force a client to re-request a response it already cached.

**Basis:** `scripts/config-lib.mjs`; `scripts/configure.mjs`; `scripts/preflight.mjs`; `packages/shared/src/policy.ts`, `destination.ts`, `validation.ts`; `link-password.ts`; `browser-check.ts`.

<a id="section-4-7"></a>

### 4.7 Configure multiple short-link domains

Linro supports one admin hostname and 1–50 public short-link hostnames. Public hosts can share one Redirect Worker, the same D1 database as the Admin Worker, and existing secrets. Do not create a Worker or database per hostname. admin_host is a single string; multiple admin origins are not supported.

The example uses go.example.com, a subdomain of a second zone s.example.net, and an apex hostname example.org. Use active zones managed in the same Cloudflare account and deployment credentials authorized for those hosts. Hostnames must be distinct and different from the admin host; use lowercase names without schemes, paths, ports, or wildcards. The 1–50 range is a Linro validation limit, not a Cloudflare plan entitlement.

Step 1: for a new installation, fill deployment.json from the complete example below. For an existing instance, merge only new hosts into its redirect_hosts, retaining existing hosts, Worker names, account, D1, KV, analytics, limits, Access, and feature flags. Do not replace production configuration with this example or regenerate root secrets.

```json
{
  "account_id": "YOUR_CLOUDFLARE_ACCOUNT_ID",
  "database_id": "YOUR_D1_DATABASE_UUID",
  "database_name": "linro",
  "admin_host": "admin.example.com",
  "redirect_hosts": [
    "go.example.com",
    "s.example.net",
    "example.org"
  ],
  "access_issuer": "https://your-team.cloudflareaccess.com",
  "access_aud": "YOUR_ACCESS_APPLICATION_AUD",
  "owner_email": "owner@example.com",
  "analytics_enabled": false,
  "analytics_dataset": "linro_clicks",
  "auth_rate_namespace": "21001",
  "write_rate_namespace": "21002",
  "redirect_rate_namespace": "21003",
  "redirect_rate_limit": 300,
  "query_forward_allowlist": [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content"
  ],
  "private_target_allowlist": [],
  "expired_link_status": 404,
  "password_rate_namespace": "21004",
  "password_rate_limit": 5,
  "redirect_cache_namespace_id": "",
  "redirect_cache_ttl": 300,
  "cloudflare_device_type_enabled": false,
  "browser_timezone_enabled": false,
  "source_url": "",
  "admin_worker_name": "linro-admin",
  "redirect_worker_name": "linro-redirect"
}
```

[Download the multi-domain configuration example (replace all resource placeholders)](examples/deployment.multidomain.example.json)

Step 2: if deployment.json is the complete maintained source of configuration, back up both Worker configurations, run configure and preflight, and review the diff. Redirect routes must include every retained host with custom_domain true; the admin Worker still binds only admin_host. Preserve any custom settings unsupported by the generator in deployment-specific configuration and follow Chapter 08.

```bash
npm run configure
npm run preflight
npm run deploy:dry-run
```

```json
{
  "routes": [
    {
      "pattern": "go.example.com",
      "custom_domain": true
    },
    {
      "pattern": "s.example.net",
      "custom_domain": true
    },
    {
      "pattern": "example.org",
      "custom_domain": true
    }
  ]
}
```

Step 3: deploy these Custom Domains to the existing Redirect Worker. For a first installation, complete migrations, builds, checks, and npm run deploy from Chapter 03. For an existing instance needing no code change, use triggers deploy below with its reviewed production configuration. This synchronizes configured triggers rather than merely appending one hostname: omitted hosts or Cron triggers can affect existing service. versions upload / versions deploy alone do not add domain bindings.

```bash
npx wrangler triggers deploy --config apps/redirect/wrangler.jsonc
```

Cloudflare Custom Domains attach the hostname to the Worker and manage the associated DNS and certificate. Investigate existing CNAME or hostname conflicts before changing records; do not blindly delete records or add a CNAME to workers.dev. Verify HTTPS after certificate issuance.

[Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) · [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)

Step 4: sign in as an interactive Owner or Admin and add all three exact hostnames on the Domains page. This creates D1 business records, which Cloudflare bindings do not create automatically. Likewise, adding a domain in the GUI does not create DNS or a Worker binding. If existing links point to the new hostname, creation may fail with hostname_is_destination; review and resolve those destinations first.

Alternatively, submit POST /Linro/v1/domains through an interactive admin session for each host, using the body below. Use the returned id as the domain_id of a new link. Application tokens cannot receive domains:write and cannot perform this step.

```json
{
  "hostname": "s.example.net",
  "name": "Secondary short domain",
  "enabled": true,
  "default_redirect_code": 302
}
```

Step 5: create a dedicated acceptance link on each host with no password, VPN restriction, or visit limit, and cache_ttl=0. The same slug may exist on different hosts as independent records. Creating welcome on one host does not create it on the others. Existing links are not automatically migrated or aliased.

```bash
curl --silent --show-error https://go.example.com/health
curl --silent --show-error --head https://go.example.com/install-check
curl --silent --show-error https://s.example.net/health
curl --silent --show-error --head https://s.example.net/install-check
curl --silent --show-error https://example.org/health
curl --silent --show-error --head https://example.org/install-check
```

For every host, confirm health returns HTTP 200 and version 1.0.1, and install-check has the expected first-hop status and Location. Do not add -L; use curl.exe on Windows. Health does not query D1, so health 200 with link 404 calls for checking the GUI domain record and slug. HEAD consumes quota on limited links; use only the unlimited acceptance fixtures above. Finally, confirm Access still protects the admin host and does not accidentally cover public hosts.

When removing a hostname later, handle its links first, then separately update D1 domain records and Cloudflare bindings. Do not remove other hosts or the shared database. Disabling a domain in the GUI affects business access but does not detach the platform binding.

<a id="features"></a>

## 05 · Optional Features and Behavior

<a id="section-5-1"></a>

### 5.1 KV Route Cache

If `redirect_cache_namespace_id` is not configured, KV is not used at all; once configured, both sides bind the same `REDIRECT_CACHE`. For first use, you can create a namespace with the project Wrangler and insert the returned real ID into deployment config:

```bash
npx wrangler kv namespace create REDIRECT_CACHE --config apps/redirect/wrangler.jsonc
```

That command creates a cloud resource. Existing instances should reuse the original namespace rather than creating another one. Then regenerate, review, and deploy both Worker configs.

**A KV hit does not mean zero D1 queries.** After a hit, the system still queries the latest link / domain enabled state, version, rule revision, password, access limit, count, mode, VPN flag, and whether the target has become a managed short domain. Expired or mismatched entries fall back to the authoritative D1 path; KV read failure / timeout attempts a D1 fallback, but D1 failure does not authorize using stale cache directly.

KV stores routing fields, not password verifiers, root secrets, counters, user profiles, browser proofs, or plain-text bodies. Plain-text rows are not cached. Business data and audit records commit to D1 first; cache maintenance is best-effort and its failure does not roll back the committed write.

`redirect_cache_ttl` controls KV; per-link `cache_ttl` controls visitor-side client caching. They are different switches. Whether KV reduces overall resource use must be measured; merely binding KV cannot guarantee a higher free-tier capacity.

<a id="section-5-2"></a>

### 5.2 Password Protection

Configure `LINK_PASSWORD_SECRET` only if password protection is used. Each link password is 12–128 UTF-16 code units, at most 512 UTF-8 bytes, contains no control characters, and is not automatically trimmed.

| Edit operation | API semantics |
| --- | --- |
| Keep the existing password | Omit `password` |
| Set / replace the password | `password` with a new valid string |
| Explicitly remove the password | `password: null` |
| Empty string | is not “keep” or “clear”; direct API use fails validation |

An unauthorized GET returns a 200 password page with no target `Location`; a wrong-password POST returns a 401 page; a correct-password POST returns 303 to the same-origin same short code and sets a cookie lasting at most 900 seconds. The password body is never forwarded to the external target, and the following GET rechecks the latest rules. Editing rules invalidates old cookies bound to the previous revision.

Password protection is for public visitor access;**it does not hide the target URL or plain-text body from authorized admin members**. The database stores a verifier, not plaintext; the GUI / API / JSON / CSV do not return the verifier.

The implementation uses PBKDF2-SHA256, a random salt, and an independent HMAC pepper. The configured root secret must be backed up securely and separately from the SQL dump. If the root secret is lost, the password plaintext cannot be recovered from the database.

After setting the password secret for the first time, refresh the admin page to reload session capabilities and confirm that Set a new password is available. Both Workers must use the same root secret; preserve the existing value when upgrading.

<a id="section-5-3"></a>

### 5.3 Browser Timezone Collection and Suspected VPN Checks

| Global `browser_timezone_enabled` | Per-link `block_vpn` | GET behavior |
| --- | --- | --- |
| false | false | Does not perform timezone collection; original password, enablement, expiration, and limit checks still apply |
| true | false | Runs the browser-check flow to collect timezone, but a mismatch / unknown does not itself cause rejection |
| false | true | Still forces browser checking; disabling global collection does not disable this per-link protection |
| true | true | Collects and enforces suspected VPN / unknown rejection policy |

Whenever a check is required and no valid `BROWSER_CHECK_SECRET` is configured, the public side returns 503 rather than silently degrading. When per-link `block_vpn` is enabled, Admin also validates the secret’s format.

The browser reports JavaScript `Intl.DateTimeFormat().resolvedOptions().timeZone` and the server compares it with `request.cf.timezone` after normalization in the same runtime; this compares timezone identifiers, not current UTC offsets. The source treats the platform `request.cf.country === 'T1'` as a Tor signal. Ordinary client-supplied headers are not treated as that trusted platform metadata.

**This feature is not reliable proof of VPN use or identity authentication.** Self-reported timezone is untrusted; travel, manual settings, and IP-geolocation errors can all cause false positives, while matching timezones do not exclude proxies. Missing / invalid timezone is classified as `unknown` and is not automatically considered VPN use, but it is still rejected when the per-link blocking policy is enabled.

Normal browser-check path: 200 check page → same-origin form POST → 200 JSON success plus short-lived cookie → normal navigation to the same short code → fresh D1 checks → final 3xx or text 200. Challenge / proof lasts at most 120 seconds and issuance does not extend it; it is bound to the link, revision, host, query, and current network-metadata digest. The cookie is cleared after completion; for plain text, the final URL carries a completion marker, so refreshing that URL may ask the user to reopen the original short link.

When per-link `block_vpn` is not enabled, HEAD keeps the original direct-response rules and does not run JavaScript merely because global collection is on; when enabled, HEAD without a valid proof returns 403 and no target. Clients without JavaScript / cookies are not guaranteed to complete the check flow. To preserve direct-response compatibility, use “global false + per-link false” rather than bypassing existing protection.

<a id="section-5-4"></a>

### 5.4 Geo Routing, Plain Text, and Access Limits

Geo-routing priority is **country → continent → default target**with source `request.cf`. Each link supports at most 32 rules, and the same `kind+code` cannot repeat. Continent codes are `AF / AN / AS / EU / NA / OC / SA`. Every candidate URL uses the same target-security policy; geo routing is not authentication.

Plain-text mode uses `response_mode: "text"` and `text_content`with a maximum of 16,384 UTF-16 code units and 32,768 UTF-8 bytes, at least one code unit, and is not rendered as HTML. It forces `query_mode=discard`, cannot retain nonempty geo rules, and does not require a target URL. Password, expiration, enablement, access limit, and browser checks still apply. The final GET returns 200 `text/plain; charset=utf-8`; HEAD returns the same status / headers without a body.

`max_redirects: null` means unlimited; integer 1–1,000,000,000 is the limit. Only links with a configured limit increment `redirect_count`; **and each final authorized GET and HEAD consumes one slot**. This is not a person count, complete PV history, or Analytics click count. Password pages, browser-check pages, internal 303s, successful check JSON 200s, and static assets do not consume this quota, though they still consume requests and related rate-limit resources.

Changing the limit does not reset the used count. To reset it, PATCH must simultaneously send the current `version` and `reset_redirect_count: true`. Exhaustion returns 403 plain text with no target; D1 conditional UPDATE controls the final concurrent slot. If the server commits but the connection drops, a slot may conservatively remain consumed; it is not automatically refunded or retried.

<a id="section-5-5"></a>

### 5.5 Analytics Engine and Cron

Bring up the baseline service first. Following the installation material, prepare a read-only Analytics query credential for the target account with Account Analytics Read permission, and store it only as an Admin secret:

```bash
npx wrangler secret put ANALYTICS_API_TOKEN --config apps/admin/wrangler.jsonc
```

Set `analytics_enabled` with `true`while preserving the correct `analytics_dataset`and inspect generated output: Redirect gains `ANALYTICS`and Admin gains `*/15 * * * *` Cron; then deploy and separately verify event writes, actual SQL queries, and daily archive.

Only a truly successful GET records a click: final redirect or final text 200. HEAD, password pages, and intermediate successful check responses do not count. Final policy rejection writes separate VPN / unknown events,`double1=0` and does not increase the successful-click curve. Logs are sampled weighted estimates, not deduplicated people; successful bot GETs may also count.

`/stats` Each call performs eight AE queries sequentially and does not automatically retry upstream 429. If any dimension fails, it does not show partial results as if complete. The GUI request itself has a 20-second wait budget while each upstream query has a 10-second budget, so slow queries may appear as frontend timeouts rather than zero visits.

Cron archives the **previous two complete UTC dates**, processing at most 400 “link / date” groups per run, saving a cursor to continue when needed, with UPSERT and cursor commit together. Today’s events should not immediately appear in the daily archive. This is not a full arbitrary-history backfill job and there is no public “archive now” API.

```bash
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT key,value,updated_at FROM settings WHERE key LIKE 'analytics_rollup_%';"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT link_id,date,clicks,updated_at FROM daily_stats ORDER BY date DESC LIMIT 10;"
```

Disabling analytics does not automatically delete old data. AE write failure does not block an already-authorized public business response; when querying is not configured, `/stats` returns 200 with `available:false`and must not be interpreted as zero clicks. In system health, `configured_not_probed` only means the configuration is present.

The Analytics Engine event layout remains compatible. The IP reference timezone is not the browser timezone. Old events without a browser-timezone field remain none; do not backfill it from IP geography. UTC trend grouping is not a visitor timezone either. blob5 retains the existing browser family and is not used to identify device type or VPN use. The following layout describes event fields, not unique users.

```text
index1: link ID
blob1: hostname
blob2: slug
blob3: Cloudflare country
blob4: referrer hostname only
blob5: legacy browser family
blob6: Cloudflare IP reference timezone
blob7: mobile / pc / none
blob8: redirect / text
blob9: normalized browser timezone / none
blob10: tor / timezone_mismatch / match / unknown
blob11: success / vpn_blocked / unknown_blocked

double1: final successful GET = 1; terminal policy denial = 0
double2: final HTTP status
double3: suspected VPN
double4: suspected VPN blocked
double5: unknown timezone blocked
double6: unknown timezone allowed successfully
double7: Cloudflare Tor marker
```

Each /stats call makes 8 sequential requests: totals, trend, top links, countries, referrers, browser timezones, IP timezones, and devices. They are not one atomic snapshot and 429 responses are not automatically retried. These AE events do not store raw IPs, complete User-Agent strings, challenges, cookies, passwords, target URLs, or text bodies; referrers are reduced to hostnames.

<a id="section-5-6"></a>

### 5.6 Device Type, Source Link, and Outer Rate Limiting

Device type defaults to none. Enable cloudflare_device_type_enabled only after confirming that the platform reliably generates CF-Device-Type and overwrites visitor-supplied values. The mapping is mobile / tablet → mobile, desktop → pc, and all other or missing values → none. Availability depends on the actual account configuration.

`source_url` is used under the project’s licensing documentation to display the corresponding source-code entry point. It affects the footer and response `Link` header on admin / public protection pages, but does not change short-link targets or proxy / fetch source code. Supplying a URL does not prove the source is complete or reachable; verify it separately.

Consider a separate WAF rate limit for POST /__Linro_unlock/ on public hosts where supported, in addition to the Worker PASSWORD_LIMITER. The Worker keys by the source IP SHA-256 hash; its default is 5 calls per key per Cloudflare location per 60 seconds. Platform accounting is best-effort, not connection-based or a strict global quota. Use separate namespaces for the four limiters; reusing a namespace may share counters with other instances in the account. Do not place GET, static assets, admin APIs, or normal browser-check POSTs in the low password-attempt bucket. Verify WAF fields, actions, periods, and costs for the deployment account.

**Basis:** `packages/shared/src/redirect-cache.ts`; `link-password.ts`; `browser-check.ts`; `apps/redirect/src/index.ts`; `apps/admin/src/worker/analytics.ts`; `apps/admin/src/web/client.ts`; `README.md`.

This WAF match example covers password-unlock POSTs on the actual public hostname only. Replace the example host and configure the counting key, threshold, and action using capabilities available to the account; availability on a free plan is not promised. It is not a single global atomic counter, and the project does not automatically create account WAF rules.

```text
(http.host eq "go.example.com" and http.request.method eq "POST" and starts_with(http.request.uri.path, "/__Linro_unlock/"))
```

<a id="permissions"></a>

## 06 · Users, Roles, and Permissions

<a id="section-6-1"></a>

### 6.1 Two-Layer Authentication

Every production admin request is first protected by Cloudflare Access, then the Worker validates the `Cf-Access-Jwt-Assertion` signature, issuer, audience, and time constraints. Forging an email header in the request does not log in. A human allowed by Access must also exist in Linro’s `users` table and be enabled; only the first login matching `BOOTSTRAP_OWNER_EMAIL` can bootstrap an Owner when the users table is empty.

The first valid login binds the Access `sub`. Later, the same email with a different `sub` does not automatically replace that binding. If an identity-provider migration changes the subject, verify identity and back up first, then perform controlled database maintenance; this version has no “rebind identity” or “change user email” API.

Automation uses **valid Access authentication + a Linro application token**, not either one alone. A Service Token passes the outer Access layer;`Authorization: Bearer Linro_…` determines the internal user and scopes. Linro does not use `CF-Access-Client-Id` / `CF-Access-Client-Secret` as its own user identity and does not allow an application token alone to bypass Access JWT verification.

Automation setup: in the same Access application protecting the entire admin host, add a Service Auth policy whose Include rule selects the intended Service Token, while retaining human Allow policies. Creating a token alone does not authorize it for this application. Each automated request sends CF-Access-Client-Id, CF-Access-Client-Secret, and the Linro Bearer token. Do not use Bypass or substitute a human Allow policy for Service Auth. [Cloudflare Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) (2026-09-23)

<a id="section-6-2"></a>

### 6.2 Interactive Session Role Matrix

This table applies to normal interactive Access browser sessions; see Operations for local-development sessions.

| Capability | Viewer | Editor | Admin | Owner |
| --- | --- | --- | --- | --- |
| Read all team links, including targets, plain-text content, and descriptions | ✓ | ✓ | ✓ | ✓ |
| Read all domains and team analytics | ✓ | ✓ | ✓ | ✓ |
| Create links | — | ✓ | ✓ | ✓ |
| Modify, delete, enable, or disable links created by yourself | — | ✓ | ✓ | ✓ |
| Modify, delete, enable, or disable links created by other members | — | — | ✓ | ✓ |
| Manage domain records | — | — | ✓ | ✓ |
| View the audit log | — | — | ✓ | ✓ |
| Create, modify, disable users, and assign roles | — | — | — | ✓ |
| Read / modify site settings and run D1 health checks | — | — | — | ✓ |
| Manage your own application tokens | ✓, limited to scopes available to your own role | ✓ | ✓ | ✓ |
| View other users’ full application tokens or short-link passwords | — | — | — | — |

**This is a shared workspace, not a data-isolated multi-tenant system.** Viewer “read-only” does not mean a member can only see links they created. Admin read permissions can expose other members’ target URLs, plain-text content, titles, and descriptions. Password protection on a public link protects visitor access; it does not hide data from authorized admin readers. Do not place secrets requiring member-to-member isolation in the same workspace.

Owner is not the same as a Cloudflare account administrator. The Linro GUI cannot create Workers, modify DNS, read root secrets, configure Access, or change platform plans.

<a id="section-6-3"></a>

### 6.3 Scopes and Application Tokens

| Scope | Viewer | Editor | Admin | Owner | Can grant application token scopes? |
| --- | --- | --- | --- | --- | --- |
| `links:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `domains:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `analytics:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `links:write` | — | ✓ | ✓ | ✓ | ✓ |
| `links:delete` | — | ✓ | ✓ | ✓ | ✓ |
| `domains:write` | — | — | ✓ | ✓ | — |
| `audit:read` | — | — | ✓ | ✓ | — |
| `users:write` | — | — | — | ✓ | — |
| `settings:write` | — | — | — | ✓ | — |

A token’s effective permissions are **stored token scopes ∩ the five token-eligible scopes ∩ the user’s current role scopes**. After a user is downgraded, an old token cannot retain higher permissions; when the user is disabled, token authentication also fails. Expired or revoked tokens are rejected.

**All application tokens, including those created by Owner / Admin, can modify only links created by the token’s owning user.** Reads remain shared across the team. The constraint is based on `created_by = user.id`, not “which specific token created it”: two write tokens belonging to the same user can operate on the same links created by that user. To isolate CI or integration ownership, create a separate Linro user rather than merely changing the token name.

`created_by = null` Historical links with

are outside normal user ownership; interactive Owner / Admin can still maintain them. New-link ownership is written by the server from the authenticated identity and cannot be supplied manually in POST. Token management itself requires an interactive session: a token cannot create, enumerate, or revoke tokens, including itself. Each user may have at most 50 non-revoked token records; expired-but-not-revoked records still count. This check is not a promise of globally serializable quota enforcement under concurrency. Expiry must be at least 60 seconds and at most 365 days from creation. The complete token is shown only in the create response; D1 stores a SHA-256 hash.

<a id="section-6-4"></a>

### 6.4 Member Management Workflow

In “Users,” an Owner first creates the member email and role, then ensures that member also satisfies the outer Access policy. Missing either side prevents normal admin access. On first sign-in, the member’s identity subject is bound; no separate Linro password is needed.

To disable a member, first read the current user `version` → PATCH `enabled: false`. To change a role, read the latest `version` → PATCH `role`. A database trigger guarantees at least one enabled Owner; disabling or downgrading the final enabled Owner returns 409 `last_owner`. For a handoff, first create and verify that another Owner can sign in, then modify the original Owner.

The application has no user-deletion API, global list of other users’ tokens, password recovery, email invitation sender, organization / project ACLs, or per-link member authorization. Disabling a user does not automatically disable their existing public links; an authorized administrator must handle those links separately if required.

**Basis:** `apps/admin/src/worker/auth.ts`; `packages/shared/src/access.ts`; `apps/admin/src/worker/api.ts`; `migrations/0001_initial.sql` user constraints and Owner trigger.

<a id="usage"></a>

## 07 · Admin UI and Daily Use

<a id="section-7-1"></a>

### 7.1 Navigation and First Link Creation

The current admin interface and public protection pages use #0D394A for normal body and explanatory text; their source styles define the sky-blue/white surfaces and focus indicators. This is a description of the implementation, not a claim of identical rendering or accessibility certification.

The admin interface supports Simplified Chinese / English. Pages include Overview, Links, Domains, Analytics, Users, Application Tokens, Audit, and Settings. Menus are shown according to scope, but the server still checks authorization on every request; hiding a menu is not a security boundary.

For first use, Owner / Admin adds in “Domains” a public host already bound to the Redirect Worker, such as `go.example.com` without scheme, port, or path. When creating a link, choose the domain and enter the target URL. For testing, use 302 and`cache_ttl: 0` to avoid clients permanently remembering an early wrong target. Before selecting 301 / 308 for production, understand that clients may retain permanent redirects; later Worker changes cannot revoke responses already cached by visitors.

After saving, copy `short_url`. A slug is unique and case-sensitive within the same domain; different domains may reuse the same slug. Leaving the slug blank can generate an 8-character random code. There is no public “predict next code” function or enumerable directory.

Disabling a domain makes all links under it unavailable publicly. The default redirect code affects only newly created links that do not explicitly specify one; it does not bulk-update existing links. An existing link’s domain can be changed with link PATCH, but the resulting domain + slug pair must remain unique.

<a id="section-7-2"></a>

### 7.2 Editing, Bulk Actions, and Status

Edit and delete use optimistic locking via `version`. On conflict, refresh and compare the current record before deciding whether to resubmit; do not blindly replace version with the newest number and replay an old form.

Status filters include `all`, `active`, `disabled`, `expired`, `exhausted`. A link can be expired, disabled, and exhausted at the same time, so non-active categories are not mutually exclusive partitions; do not add their counts to infer a total.

Clear a password with `password: null`; omitting password preserves it. When switching a link to plain text, clear `geo_rules: []` and provide `text_content`; when switching from plain text back to redirect mode, provide a valid `target_url`. Do not copy every read-only field from a GET object back into PATCH.

Bulk enable / disable / delete accepts at most 10 items per API call. Each item reports success or failure independently; the whole batch is not guaranteed to succeed or roll back together. If the GUI reports partial failure, inspect failed items’ permissions and versions instead of repeating the entire batch.

<a id="section-7-3"></a>

### 7.3 JSON / CSV Export

GUI export paginates through **the entire shared workspace**, not only current search results or selected rows. It fetches 100 per page, up to 10,000. It checks counts and duplicate IDs, but is not a database transaction snapshot; if many writes occur during export, revalidate the result.

The JSON outer object contains `format: "linro"`, `version: "1.0.1"`, `exported_at`, `domains`, `settings.site_name` and `links`. Links include read-only ID, owner, version, count, and timestamps for inspection, but import does not restore those fields literally. Password hashes and plaintext passwords are never exported.

The 18 CSV columns appear below in source order. _cf_links_csv is the retained export-escaping marker; do not rename it merely because the product is branded Linro.

```text
_cf_links_csv,hostname,slug,target_url,title,description,redirect_code,query_mode,enabled,expires_at,cache_ttl,geo_rules,password_protected,max_redirects,redirect_count,response_mode,text_content,block_vpn
```

Use CSV produced by the project exporter, which includes a BOM, quote escaping, and formula-text protection. Preserve its generated fields and safety markers and parse it with the project importer; do not split quoted or multiline content on commas.

<a id="section-7-4"></a>

### 7.4 Import and Migration

The GUI can read a JSON array, JSON containing a `links` array, or CSV; one file may be at most 2 MiB and 1–5,000 rows. YOURLS compatibility includes `keyword → slug`, `url → target_url`, `title`. This is not a migration tool for arbitrary YOURLS databases, plugin settings, or access logs.

Create the target domains first. A record’s `hostname` is matched to an existing domain when supplied; otherwise the domain selected in the UI is used. The GUI converts textual booleans from files into the boolean / numeric forms required by the API, which does not mean the direct API accepts `"false"` strings.

The importer validates and plans the entire input first, then calls **in chunks of at most 10 records and at most 262,144 serialized JSON bytes** through `/links/import`. Each request commits atomically, but multiple requests are not one transaction. If a later chunk fails, earlier successful links remain. Before retrying, inspect conflicting slugs to avoid duplicate creation.

Records in an export with `password_protected: true` cannot silently be downgraded to passwordless on import; the GUI requires a new password for that record. The old password cannot be restored from an export. A custom integration client must preserve the same security rule and must not simply drop the protection marker and recreate an unprotected link.

Import does not restore users, tokens, complete settings, domain resources, original `created_by`, counts, audit, or daily analytics; new links belong to the current operating user.**JSON / CSV export is not a D1 disaster-recovery backup.**

**Basis:** `apps/admin/src/web/App.tsx` GUI navigation, link forms, and import/export handling;`apps/admin/src/web/csv.ts`; `apps/admin/src/web/client.ts`; `apps/admin/src/worker/api.ts`.

<a id="upgrade"></a>

## 08 · Upgrade an existing instance without replacing configuration

<a id="section-8-1"></a>

### 8.1 Backups and scope

Before upgrading, save configuration, hostnames, version IDs, traffic allocation, Cron, bindings, and secret names, and export D1. Reuse Worker names and resource IDs and preserve root secrets. This guide contains no real account snapshots.

```bash
npx wrangler d1 export DB --remote --config apps/admin/wrangler.jsonc --output pre-upgrade-database.sql
```

Migration check: confirm the account, database, and backup; list all pending migrations; apply the reviewed pending work, then list again. Do not guess state from a filename or version number.

```bash
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
npm run db:migrate
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
```

The following diagnostics are read-only: check migration records, columns, the actual rule-revision trigger, and foreign keys. Apply pending work only; do not reseed or create a replacement database. npm run deploy neither creates a database nor applies migrations, and publishing two Workers is not atomic.

```bash
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT name FROM d1_migrations ORDER BY id;"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT name,type FROM pragma_table_info('links');"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='links_rule_revision';"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "PRAGMA foreign_key_check;"
```

<a id="section-8-2"></a>

### 8.2 Review and upload versions

The configuration paths below must contain reviewed production settings, not release placeholders. Complete the database checks above before building and uploading. This is a manual version-based workflow, not npm run deploy, which deploys Admin then Redirect and runs a public health check. --keep-vars is not lossless preservation of all settings: compare explicit local variables, bindings, assets, and runtime settings against the existing instance. Uploading a version does not itself switch production traffic.

```bash
npm run check
npm run build
npm test
npm run test:runtime
npm run test:browser
npm run deploy:dry-run
npx wrangler versions upload --config apps/admin/wrangler.jsonc --keep-vars --tag v1.0.1
npx wrangler versions upload --config apps/redirect/wrangler.jsonc --keep-vars --tag v1.0.1
```

<a id="section-8-3"></a>

### 8.3 Compare and deploy

Record the new UUID returned for each Worker. Compare bindings, variables, runtime settings, and updated assets before switching traffic. Replace each placeholder below with the matching Worker version UUID. Deploy Redirect and then Admin; the two updates are not atomic.

```bash
npx wrangler versions deploy YOUR_REDIRECT_VERSION_UUID@100 --config apps/redirect/wrangler.jsonc --yes
npx wrangler versions deploy YOUR_ADMIN_VERSION_UUID@100 --config apps/admin/wrangler.jsonc --yes
```

Do not additionally synchronize triggers for a code-only upgrade. For intentional hostname or Cron changes, review the complete list before synchronization as described in section 4.7. This source contains four migrations, 0001–0004; query the actual database to determine pending work rather than inferring it from a version number. Never clear the database or rerun initialization instead of applying migrations. The two Worker updates are not atomic; ensure protocol compatibility during the transition and use a maintenance window when needed.

<a id="section-8-4"></a>

### 8.4 Post-upgrade checks

Check both versions and traffic allocation, the authenticated GUI, admin health, every public host’s health, and dedicated acceptance links. Compare domains, bindings, users, link settings, and migration records, allowing normal counters and activity timestamps to change. Update clients to /Linro/v1, X-Linro-*, and newly issued Linro_ tokens; editing a legacy token prefix is insufficient. Visitors need fresh cookies, while existing link passwords remain valid with the original root secret.

<a id="section-8-5"></a>

### 8.5 Rollback

Confirm the old versions remain compatible with the current database and secrets, then deploy the saved version IDs. A code rollback does not roll back D1; do not overwrite new business data merely to roll back code.

```bash
npx wrangler versions deploy YOUR_OLD_REDIRECT_VERSION_UUID@100 --config apps/redirect/wrangler.jsonc --yes
npx wrangler versions deploy YOUR_OLD_ADMIN_VERSION_UUID@100 --config apps/admin/wrangler.jsonc --yes
```

<a id="api-conventions"></a>

## 09 · API Conventions

<a id="section-9-1"></a>

### 9.1 Addressing, Authentication, and Browser Calls

The Admin API base address is `https://admin.example.com/Linro/v1`. Paths in the following endpoint table are relative to that base. Host, case, and path must match exactly; do not add an extra trailing `/`.`GET /Linro/v1` itself is not a resource index. Unknown endpoints or unsupported methods return 404 `api_not_found`.

| Request header | Use case |
| --- | --- |
| `Accept: application/json` | Recommended on every admin client request; cannot turn an authentication redirect into successful JSON |
| `Content-Type: application/json` | Required on admin writes with a JSON body; can also be sent with `charset=utf-8` |
| `Authorization: Bearer Linro_…` | Automation application token; must be the complete value returned at creation time |
| `Cf-Access-Jwt-Assertion` | Production Worker requires a valid Access JWT; after normal Access authentication it is supplied by the environment—do not forge it |
| `CF-Access-Client-Id`, `CF-Access-Client-Secret` | Credentials for an automation identity to pass outer Access; separate from the Linro token |
| `Origin: https://admin.example.com` | Interactive Access write requests must match exactly; a normal browser sends this itself |
| `X-Linro-CSRF: 1` | Required for interactive Access write requests; not required for reads |
| `X-Linro-Dev` | Only for restricted local-development mode; must not be added to production calls |

Human Access write requests also reject `Sec-Fetch-Site: cross-site`. Application-token and development authentication are not environment-provided cookies and do not use the same CSRF check; however the `/Linro` API entry still rejects an **Origin explicitly supplied and not equal to ADMIN_ORIGIN**including the string `null` and empty values. Server-side token requests may omit Origin; do not fill in an arbitrary third-party website Origin.

This version does not expose permissive cross-origin CORS, a public OPTIONS preflight protocol, or JSONP. Browser scripts on another site cannot use a bearer token to bypass same-origin restrictions. Production automation should run on a trusted server; even a read-only token should not be embedded in public webpage source.

When a browser sends Authorization, it enters the token branch first; malformed or invalid Authorization does not fall back to the human-cookie login path. Therefore do not attach an application token to interactive user-management examples.

<a id="section-9-2"></a>

### 9.2 Success, Errors, and Response Headers

Success defaults to 200; resource creation / successful import uses 201. Admin JSON always uses this envelope:

```json
{"ok":true,"data":{"deleted":true}}
```

Failure example,`request_id` with a different value on each request:

```json
{"ok":false,"error":{"code":"version_conflict","message":"This item changed. Refresh before saving again.","request_id":"example-request-id"}}
```

`data` may be an object, array, or endpoint-specific structure; clients must not assume every response contains `items`. Error bodies `message` use English source-code messages; programs should branch on HTTP status and `error.code` . Every response wrapped by the Worker’s security layer includes `X-Request-Id`; include that value when reporting failures, not tokens or passwords.

The Admin API uses `Cache-Control: no-store`. The security wrapper also sets CSP, nosniff, frame denial, Referrer-Policy, and related headers; HTTPS responses include HSTS. Application rate-limit 429 responses include `Retry-After: 60`. Responses handled earlier by outer Access / the platform may be 302 or HTML and may not contain Linro JSON / request IDs, so inspect status and Content-Type first.

<a id="section-9-3"></a>

### 9.3 Bodies, Pagination, Time, and Concurrency

Admin JSON body limit: **262,144 bytes**based on actual streamed bytes rather than trusting a forged Content-Length. The root must be an object, not an array, null, or invalid UTF-8. Fields are validated per endpoint, and normal write objects reject undeclared fields. Bulk requests must stay within item-count / byte limits.

Numbers should be JSON numbers, not strings. Boolean business fields generally accept `true / false / 1 / 0` but `reset_redirect_count` accepts only booleans. Most string limits use JavaScript string length; password, text, and body fields with explicit UTF-8 byte limits must satisfy both.

Time fields `created_at`, `updated_at`, `expires_at`, `revoked_at` are Unix **seconds**, not milliseconds; export package `exported_at` uses ISO strings, while archive `date` uses UTC calendar dates.`null` The meaning of

depends on the field—for example, never expires, no access limit, or remove password—and must not be interpreted universally as “leave unchanged.” Pagination `page` defaults to 1 and ranges 1–100000;`limit` defaults to 25 and ranges 1–100. Links and audit return `total`; archive has no `total`; domains, users, tokens, and settings return arrays directly and do not use that pagination shape.

PATCH for links, domains, and users requires the current `version`; link / domain DELETE uses `?version=…`. Stale versions return 409; deleting a nonexistent resource generally returns 404. Token revocation does not use version; settings updates have no version and last write wins. Public success counters do not equal admin-edit versions;`rule_revision` is a separate invalidation mechanism for visitor protection credentials and routing rules.

There is no Idempotency-Key implementation. A timed-out POST may already have committed; do not blindly retry—query by business slug / ID and verify. Pagination is not a snapshot, and there is no automatic transaction spanning resources across requests.

<a id="section-9-4"></a>

### 9.4 HEAD and Health Paths

Admin routes match explicit HTTP methods. Although the outer layer strips HEAD response bodies,**`HEAD /Linro/v1/links` HEAD does not automatically equal GET**and can return 404. Admin’s independent `/health` supports GET / HEAD and requires authentication; Owner-only `/Linro/v1/system/health` is GET and queries D1; public Redirect `/health` is a different shallow-health endpoint. Do not conflate the three.

**Basis:** `apps/admin/src/worker/index.ts`; `auth.ts`; `api.ts`; `packages/shared/src/http.ts`.

<a id="models"></a>

## 10 · Data Models and Field Rules

<a id="section-10-1"></a>

### 10.1 Link Write Fields

POST `/links` and each `links` entry in POST `/links/import` accept the 16 business fields below. PATCH `/links/{id}` also accepts `version` and `reset_redirect_count`; fields other than `version` may be omitted to preserve their current values.

| Field | Type / constraints | Create default and update semantics |
| --- | --- | --- |
| `domain_id` | String, max 36 characters; must reference an existing domain ID | Required on create; a disabled domain may be selected but its links will not be publicly available |
| `slug` | 1–64 ASCII letters, digits,`_`, `-` | When omitted or empty on create, an 8-character code is generated; empty string on update does not re-randomize |
| `target_url` | Valid HTTP / HTTPS URL, max 4096 characters | Required when creating redirect mode; not used in text mode |
| `title` | String, max 200 characters | Defaults to empty; omitted PATCH preserves current value |
| `description` | String, max 2000 characters | Defaults to empty; normal multiline text is allowed |
| `redirect_code` | Number `301 / 302 / 307 / 308` | Create defaults to selected domain’s default_redirect_code; omitted update preserves current value |
| `query_mode` | `discard / merge / replace` | Defaults to discard; text mode forces discard |
| `enabled` | Boolean or numeric 0 / 1 | Defaults to 1; API output is numeric |
| `expires_at` | Unix-second integer 1–253402300799, or null | Defaults to null; source allows past times, which behave as expired |
| `cache_ttl` | Integer 0–3600 seconds | Defaults to 0; this is public client caching, not KV TTL |
| `geo_rules` | Array of 0–32 items; serialized length at most 65536 characters | Defaults to empty array; omitted PATCH preserves; send `[]` to clear |
| `password` | null or a 12–128 character string, at most 512 UTF-8 bytes | Omitted: no password on create / preserve on update; null: remove; string: set a new password |
| `max_redirects` | null or integer 1–1000000000 | null means unlimited; changing the limit does not reset redirect_count |
| `response_mode` | `redirect / text` | Defaults to redirect; switching mode must also satisfy target / text / geo-rule constraints |
| `text_content` | Nonempty string, max 16,384 characters and 32,768 UTF-8 bytes | Required in text mode; normalized to empty string in redirect mode |
| `block_vpn` | Boolean or numeric 0 / 1 | Defaults to 0; turning it on for the first time requires a configured browser-check root secret |

Additional PATCH fields:`version` must be the current positive integer version;`reset_redirect_count` is boolean and resets only when true; omitted / false does not reset. Clients should send only fields they intend to change and must not treat null as a universal “leave unchanged.”

URL validation rejects illegal control characters, backslashes, username / password, non-HTTP(S) schemes, and similar input; it also enforces admin-host / managed-short-host loop checks and private-target policy. An allowed target does not mean “the server fetched and verified this site successfully”: the source does not fetch destination pages or perform DNS resolution to prove a hostname can never resolve privately.

Only `health`, `cdn-cgi`, and the `__linro_` prefix are reserved, case-insensitively. `Linro`, `linro`, `admin`, `api`, `assets`, `robots`, and `favicon` are valid business slugs. Business slugs remain case-sensitive and must contain 1–64 ASCII letters, digits, `_`, or `-`; dotted paths such as `.well-known`, `robots.txt`, and `favicon.ico` still fail slug syntax. The `/Linro/v1` API on the separate admin host is unchanged.

Passwords are not trimmed, so leading / trailing spaces are part of the password. Never put passwords in logs or URL query strings. If the root secret is missing or malformed, creating / resetting a password fails; the system does not fall back to storing plaintext. Text content may contain TAB / CR / LF but rejects other restricted control characters and invalid Unicode round-trips; it is not rendered as HTML.

<a id="section-10-2"></a>

### 10.2 GeoRule

```json
[
  {"kind":"country","code":"JP","target_url":"https://www.example.org/ja/"},
  {"kind":"continent","code":"EU","target_url":"https://www.example.org/eu/"}
]
```

Each item only allows `kind`, `code`, `target_url`.`kind` type country or continent; code is two uppercase letters. continent is fixed to `AF / AN / AS / EU / NA / OC / SA`; country validates uppercase form and rejects `XX`but is not a full ISO-country lookup table—do not submit nonexistent country codes. The same `kind:code` cannot repeat. Match priority is country → continent → default target regardless of the order of country / continent entries in the submitted array.

<a id="section-10-3"></a>

### 10.3 PublicLink Read Object

“PublicLink” in the API means a sanitized admin-interface object, not something anonymously readable. It includes the business configuration above but **does not include `password` or `password_hash`**and additionally contains:

| Field | Meaning |
| --- | --- |
| `id` | Link UUID |
| `hostname`, `short_url` | Domain and short-link address; production short_url uses HTTPS |
| `password_protected` | Boolean indicating whether password protection exists |
| `created_by` | Creator user UUID; historical records may be null |
| `created_at`, `updated_at` | Unix seconds |
| `version` | Optimistic-lock version for admin edits |
| `rule_revision` | Link rule revision; used for cache / visitor-proof invalidation and not a substitute for PATCH version |
| `redirect_count` | Controlled count of successful business requests when an access limit exists; not total click analytics |
| `remaining_redirects` | Null when unlimited; otherwise `max(0, max_redirects - redirect_count)` |
| `domain_enabled` | Domain status attached by link-list queries; other read responses do not guarantee this field |

`enabled`, `block_vpn` is 0 / 1;`geo_rules` is already parsed as an array rather than the database JSON string. In text mode the API `target_url` is an empty string; the database-internal compatibility `about:blank` is not used for redirects or outbound fetching.

The following is an **example structure, not an actual online record**; later documentation consistently uses four sample IDs: domain / link / user / token.

```json
{
  "id":"22222222-2222-4222-8222-222222222222",
  "domain_id":"11111111-1111-4111-8111-111111111111",
  "hostname":"go.example.com",
  "slug":"welcome",
  "short_url":"https://go.example.com/welcome",
  "target_url":"https://www.example.org/start",
  "title":"Welcome Page",
  "description":"Deployment acceptance example",
  "redirect_code":302,
  "query_mode":"discard",
  "enabled":1,
  "expires_at":null,
  "cache_ttl":0,
  "geo_rules":[],
  "password_protected":false,
  "max_redirects":null,
  "redirect_count":0,
  "remaining_redirects":null,
  "response_mode":"redirect",
  "text_content":"",
  "block_vpn":0,
  "created_by":"33333333-3333-4333-8333-333333333333",
  "created_at":1789776000,
  "updated_at":1789776000,
  "version":1,
  "rule_revision":1
}
```

<a id="section-10-4"></a>

### 10.4 Domain, User, Token, Setting, and Audit

| Model | API fields and special meaning |
| --- | --- |
| Domain | `id, hostname, name, enabled, default_redirect_code, created_at, updated_at, version`; GET list additionally includes `link_count`. hostname cannot be PATCHed after creation |
| User | `id, email, display_name, role, enabled, created_at, updated_at, version`; does not return `access_sub`; email cannot be PATCHed after creation |
| Token list item | `id, name, prefix, scopes, expires_at, revoked_at, created_at`; **stores scopes as a database JSON string**, such as `"[\"links:read\"]"`, so JSON.parse is required |
| Token create result | `id, token, name, scopes, expires_at, shown_once`; here **scopes is an array**and the full token is returned only once |
| Setting | `key, value, updated_at`; GET returns all settings, including possible archive cursor records; only `site_name` can be changed through PATCH |
| Audit | `id, user_id, actor_email, action, resource_type, resource_id, details, request_id, created_at`; **details is a JSON string**, not a directly nested object |
| DailyStat | `link_id, date, clicks, updated_at`, and list responses additionally include `slug, hostname`; clicks is sampled and weighted and may be non-integer |

Site name is 1–80 characters and cannot be whitespace-only; domain display name may be empty up to 100 characters; user display name may be empty up to 100; token name is 1–100 and cannot be whitespace-only. User role must be lowercase `viewer / editor / admin / owner`. The source token table has no `last_used_at` field and there is no corresponding update endpoint, so do not infer such a feature from generic wording in historical material.

Audit records creation, edit, delete, enable/disable, import, token revocation, and related actions. Sensitive URL query / fragment parts are redacted, text records only length, and password fields record only whether protection exists. Reading audit logs cannot recover passwords or full bodies and must not be treated as a complete platform access log.

**Basis:** `packages/shared/src/platform.ts`; `http.ts`; `validation.ts`; `geo.ts`; `text-response.ts`; `apps/admin/src/worker/data.ts`; `api.ts`; the four D1 migrations.

<a id="api-reference"></a>

## 11 · Complete Admin API Reference

This chapter lists, directly from source, **25 “method + path” combinations**. Every response uses the Chapter 09 JSON envelope; the following `data` structures omit that outer wrapper for brevity.`L` means PublicLink,`D` means Domain,`U` means User.`{id}` must be replaced with a real UUID and must not include braces.

<a id="section-11-1"></a>

### 11.1 GET /session — Current Session

**Permission:** Any authenticated session, including an application token; no additional scope. No parameters.

**200 data:**  `user: U`, `scopes: string[]`, `source_url: string`, `auth_kind: access|token|local`, `site_name: string`, `analytics_configured: boolean`, `link_write_scope: owned|workspace`, `version: "1.0.1"`and also:

```json
{
  "features":{
    "browser_timezone_collection_enabled":false,
    "browser_checks_configured":true,
    "redirect_cache":false,
    "cache_consistency":"d1-guarded",
    "passwords_configured":true,
    "text_responses":true,
    "device_header_enabled":false
  },
  "security":{
    "queryKeys":["utm_source","utm_medium","utm_campaign","utm_term","utm_content"],
    "expiredStatus":404
  }
}
```

This is a field-structure example; switches depend on actual configuration. The session does not expose the private-target allowlist, Access credentials, root secrets, or token plaintext. site_name supplies the displayed workspace name.

<a id="section-11-2"></a>

### 11.2 GET /summary — Overview Counts

**Permission:** `links:read`. No parameters.

**Example 200 data:** `{"links":6,"active":5,"expired":1,"domains":2}`. Reads the entire shared workspace. active simultaneously requires the link and domain to be enabled, not expired, and not exhausted; expired is counted independently by expiration time and is not guaranteed to be mutually exclusive with disabled or other statuses.

<a id="section-11-3"></a>

### 11.3 GET /links — List Links

**Permission:** `links:read`.

| Query parameter | Rule |
| --- | --- |
| `page`, `limit` | Standard pagination, default 1 / 25, limit max 100 |
| `q` | Optional, max 120 characters; matches slug, title, target_url, but not text_content / description |
| `domain_id` | Optional domain ID filter |
| `status` | `all / active / disabled / expired / exhausted`; omitted means no filtering |

**200 data:**  `{"items":[L],"total":6,"page":1,"limit":25}`, ordered by created_at descending, then id descending. Filtering by a nonexistent domain_id generally returns an empty list rather than an automatic resource 404. Errors: 400 `search_too_long / invalid_status / invalid_field`; insufficient permission 403.

```http
GET /Linro/v1/links?status=active&limit=25&page=1&q=welcome
```

<a id="section-11-4"></a>

### 11.4 POST /links — Create Link

**Permission:** `links:write`. Body uses the Chapter 10 Link write fields.

```json
{
  "domain_id":"11111111-1111-4111-8111-111111111111",
  "slug":"welcome",
  "target_url":"https://www.example.org/start",
  "title":"Welcome Page",
  "redirect_code":302,
  "query_mode":"discard",
  "cache_ttl":0,
  "block_vpn":false
}
```

**201 data:**  Full L. created_by is set automatically to the current user; if slug is omitted, random-code uniqueness conflicts are retried up to 5 times. An explicit slug conflict returns 409 `conflict` and the server does not silently substitute another code. Invalid parameters return 400; selected domain missing returns 400 `domain_not_found`; protection root secret not configured returns 503. Business write and success audit are committed in the same D1 batch; KV update is not an authorization condition for write success.

<a id="section-11-5"></a>

### 11.5 GET /links/{id} — Read One Link

**Permission:** `links:read`. No body;**200 data:**  L. Missing resource returns 404 `not_found`. Every authorized admin reader can see this object regardless of created_by; the password verifier is not returned.

<a id="section-11-6"></a>

### 11.6 PATCH /links/{id} — Update Link

**Permission:** `links:write`, and must also satisfy link-ownership rules. Body requires version; other fields are partial updates.

```json
{"version":1,"target_url":"https://www.example.org/new","title":"Updated Entry","cache_ttl":0}
```

Example count reset:`{"version":2,"reset_redirect_count":true}` Example password removal:`{"version":3,"password":null}` The versions above are illustrative only. For each operation, read the current value first; this is not a fixed sequential script.

**200 data:** Updated L. Missing resources return 404; stale versions return 409 version_conflict; ownership violations return 403 link_owner_required; invalid fields return 400. A domain or slug change commits to D1 before best-effort invalidation of the old KV route. This is not an atomic D1/KV transaction; stale KV hits still require the latest D1 authorization. Cached or in-flight responses cannot be recalled instantly.

<a id="section-11-7"></a>

### 11.7 DELETE /links/{id} — Delete Link

**Permission:** `links:delete` + ownership constraint. Required query `version`; no JSON body.

```http
DELETE /Linro/v1/links/22222222-2222-4222-8222-222222222222?version=1
```

**200 data:**  `{"deleted":true}`. Missing resource 404, version conflict 409, cross-owner write 403. D1 daily_stats cascades with the link foreign key; historical AE events already written are not deleted by this route, so deleting a link does not mean every historical record in all storage disappears immediately.

<a id="section-11-8"></a>

### 11.8 POST /links/import — Atomic Small-Batch Import

**Permission:** `links:write`. Top-level body only allows `links`with 1–10 items; each uses create fields and does not accept read-only fields from export objects.

```json
{
  "links":[
    {"domain_id":"11111111-1111-4111-8111-111111111111","slug":"intro","target_url":"https://www.example.org/intro","redirect_code":302},
    {"domain_id":"11111111-1111-4111-8111-111111111111","slug":"notice","response_mode":"text","text_content":"Maintenance completed.","geo_rules":[]}
  ]
}
```

**201 data:**  `{"imported":2,"ids":["22222222-2222-4222-8222-222222222222","55555555-5555-4555-8555-555555555555"]}`. All items are normalized first, then the current batch is committed transactionally; any validation or uniqueness conflict prevents partial import within that request. Errors: 400 `invalid_import` / field error, 409 conflict, 413 oversized. This route is not a CSV-upload endpoint and does not accept multipart or an outer JSON `domains/settings`.

<a id="section-11-9"></a>

### 11.9 POST /links/bulk — Partial-Success Bulk Enable / Disable / Delete

**Permission:** When action is enable / disable, `links:write`; when delete, `links:delete`. Ownership is checked per item. Top level allows only action and items; items is 1–10 objects containing id and version, with duplicate IDs forbidden.

```json
{"action":"disable","items":[{"id":"22222222-2222-4222-8222-222222222222","version":1}]}
```

**Example 200 data:** `{"results":[{"id":"22222222-2222-4222-8222-222222222222","ok":false,"conflict":true}]}`. Successful item: `ok:true`; cross-owner failure includes `forbidden:true`; missing or changed-version items generally include `conflict:true`. HTTP 200 means the bulk request itself completed normally, not that every item succeeded. Invalid action, empty arrays, duplicate IDs, etc. return 400 before execution; per-item success does not share one rollback transaction.

<a id="section-11-10"></a>

### 11.10 GET /domains — Domain List

**Permission:** `domains:read`. No pagination / body;**200 data:**  `D[]`, sorted by hostname, each with `link_count`. Disabled domains are included. There is no separate `GET /domains/{id}`endpoint; find one by listing.

<a id="section-11-11"></a>

### 11.11 POST /domains — Create Domain Record

**Permission:** `domains:write`, and only interactive Admin / Owner currently satisfy that role set.

```json
{"hostname":"go.example.com","name":"Official Short Link","enabled":true,"default_redirect_code":302}
```

Only hostname, name, enabled, default_redirect_code are allowed. hostname is required and hostname-validated; name defaults empty, enabled defaults 1, redirect code defaults 301.**201 data:**  D, not guaranteed to include link_count.

Duplicate domain returns 409 `conflict`; admin host returns 400 `admin_hostname`; if existing link default / geo targets already point to the hostname being added, returns 409 `hostname_is_destination`so targets can be migrated first and managed-short-link loops are avoided. Success creates only the D1 record; it does not create Cloudflare resources.

<a id="section-11-12"></a>

### 11.12 PATCH /domains/{id} — Update Domain Record

**Permission:** `domains:write`. Only version, name, enabled, default_redirect_code are allowed.

```json
{"version":1,"name":"Public Entry","enabled":true,"default_redirect_code":302}
```

**200 data:**  Updated D. hostname is immutable; providing it returns 400 `unknown_field`. Missing 404, version conflict 409. Disabling a domain affects every link under it; changing default redirect code does not rewrite existing links.

<a id="section-11-13"></a>

### 11.13 DELETE /domains/{id} — Delete Domain Record

**Permission:** `domains:write`. Required query `version`; **200 data:**  `{"deleted":true}`. If links still reference the domain, returns 409 `in_use`instead of cascading deletion. Explicitly move / delete links first. This operation does not detach the platform Custom Domain / DNS.

<a id="section-11-14"></a>

### 11.14 GET /stats — Analytics Engine Live Query

**Permission:** `analytics:read`.

| Query parameter | Rule |
| --- | --- |
| `days` | Default 7, integer 1–90; queries the most recent corresponding number of days, output represented in UTC |
| `link_id` | One lowercase canonical UUID; optional |
| `link_ids` | Comma-separated 1–50 lowercase canonical UUIDs; mutually exclusive with link_id |

Repeated link_id or link_ids parameters and mixing both forms are rejected; selection values cannot be empty or end with a comma. The server uses the first days value rather than rejecting duplicates; clients should still send days only once. The 50-item limit is checked before deduplication, then duplicates are removed. Omitting both ID selectors means the entire workspace. If any explicitly selected link does not exist, returns 404 `stats_link_not_found`; it does not silently broaden to all links, even when analytics is not configured, because selection scope is validated first.

When not configured: **200 data**:

```json
{"available":false,"reason":"Analytics Engine is disabled or the Analytics Read secret is not configured.","sampled":true,"link_ids":null}
```

When fully configured and query succeeds, data contains:

| Field | Structure / explanation |
| --- | --- |
| `available, sampled, timezone, days, link_ids` | true, true, UTC, window days, null or actual selected array |
| `clicks` | Sampled weighted total of successful business GETs; not UV |
| `timeline` | `[{date, clicks}]`, by date; dates with no events are not guaranteed to be zero-filled |
| `top` | `[{link_id, hostname, slug, clicks}]`, up to 50 entries |
| `countries` | `[{country, clicks}]`, up to 20 entries |
| `referrers` | `[{referrer, clicks}]`, up to 20 entries, referrer-host dimension only |
| `timezones` | `[{timezone, clicks}]`, browser-reported timezone; missing becomes none |
| `ip_timezones` | `[{timezone, clicks}]`, Cloudflare IP-geolocation timezone |
| `devices` | `[{device, clicks}]`, device is mobile / pc / none |
| `suspected_vpn_visits`, `suspected_vpn_successes` | Estimated suspected events and successful visits among them |
| `blocked_vpn_visits`, `unknown_timezone_blocks` | Estimated VPN-policy rejections and unknown-timezone rejections |
| `unknown_timezone_successes`, `tor_visits` | Estimated unknown-timezone successes and Tor-related events |
| `vpn_scope` | `terminal_successes_and_policy_denials_not_unique_users` |
| `success_scope` | `authorized_get_redirect_or_text` |
| `dimension_sources` | See source fields below; this does not mean browser-reported data is trustworthy |

```json
{
  "dimension_sources":{
    "timezone":"javascript_client_reported",
    "ip_timezone":"cloudflare_ip_geolocation",
    "device":"cloudflare_generated_header",
    "browser_timezone":"javascript_client_reported_untrusted",
    "tor":"cloudflare_request_cf_country_T1",
    "device_header_enabled":false
  }
}
```

Upstream non-success HTTP status, missing valid data array, or invalid count mapping returns 502 `analytics_query_failed`; network / timeout / JSON-decode exceptions can become generic 500. Do not label every failure “not configured.” The eight queries are not automatically retried.

<a id="section-11-15"></a>

### 11.15 GET /stats/archive — D1 Daily Archive

**Permission:** `analytics:read`. Supports page, limit, and the same link_id / link_ids selectors as /stats;**does not implement days date filtering**.

**200 data:**  `{"items":[DailyStat],"sampled":true,"page":1,"limit":25,"link_ids":null,"dimension_detail_available":false}`. No total; ordered by date descending, then link_id. Contains only daily counts already written into D1 and whose links still exist. It contains no country, device, timezone, or VPN historical dimensions and is not an automatic transparent fallback for /stats. Existing archive remains readable after AE is disabled.

<a id="section-11-16"></a>

### 11.16 GET /users — User List

**Permission:** `users:write` + interactive session, meaning Owner. No pagination;**200 data:**  `U[]`, ordered by created_at. There is no GET /users/{id}. Application tokens cannot call it even if owned by an Owner.

<a id="section-11-17"></a>

### 11.17 POST /users — Create User

**Permission:** Owner interactive session.

```json
{"email":"editor@example.com","display_name":"Content Editor","role":"editor"}
```

Only email is required; display_name defaults empty, role defaults viewer, and new users default enabled. enabled, access_sub, version, and id cannot be supplied.**201 data:**  U. Duplicate email 409; invalid role 400 `invalid_role`. This action does not send email and does not create an Access policy; the member must still satisfy outer authentication conditions.

<a id="section-11-18"></a>

### 11.18 PATCH /users/{id} — Modify / Disable User

**Permission:** Owner interactive session. Only version, display_name, role, enabled are allowed.

```json
{"version":1,"role":"viewer","enabled":false}
```

**200 data:** Updated U. email and access_sub cannot be changed. Disabling or demoting the final enabled Owner returns 409 last_owner; a stale version returns 409 version_conflict; a missing user returns 404. There is no DELETE user route. Disabling a user blocks subsequent authentication by that user and their tokens without deleting their public links.

<a id="section-11-19"></a>

### 11.19 GET /tokens — List Your Tokens

**Permission:** Any interactive session, self only; no extra scope required. No pagination.**200 data:**  Array of Token list items ordered by created_at descending, including revoked records.

```json
[{
  "id":"44444444-4444-4444-8444-444444444444",
  "name":"Read-only Inspection",
  "prefix":"Linro_ABCDEF",
  "scopes":"[\"links:read\",\"domains:read\"]",
  "expires_at":1792368000,
  "revoked_at":null,
  "created_at":1789776000
}]
```

prefix is display-only and cannot be used as the full token. Here scopes is a JSON string; token_hash, full token, other user IDs, and last-used time are not returned.

<a id="section-11-20"></a>

### 11.20 POST /tokens — Create Your Application Token

**Permission:** Interactive session; scopes must be among the five non-admin scopes the current role is allowed to grant.

```json
{"name":"Read-only Inspection","scopes":["links:read","domains:read"],"expires_at":1792368000}
```

The example expires_at is illustrative; real calls should dynamically use `Math.floor(Date.now()/1000) + 30*86400` or another valid future time, at least 60 seconds and at most 365 days from creation; out-of-range values return 400 invalid_field. Original scopes array length 1–5; invalid / over-privileged scopes return 403 `invalid_scopes`; valid duplicates are deduplicated. name cannot be blank; creation is rejected with 409 when 50 or more non-revoked records already exist `token_limit`.

**201 data:**  `id, token, name, scopes: string[], expires_at, shown_once: true`. Save the full token securely immediately and never write it into a URL, public page, or log. A later GET list cannot recover it; revoke and create a new token if lost.

<a id="section-11-21"></a>

### 11.21 DELETE /tokens/{id} — Revoke Your Token

**Permission:** Interactive session, and the token must belong to the current user. No version and no body.**200 data:**  `{"revoked":true}`. Already revoked / missing / another user’s token all return 404 `not_found`; this is not an idempotent design that returns 200 on unlimited repeated revocation. A token cannot call this endpoint to revoke itself.

<a id="section-11-22"></a>

### 11.22 GET /audit — Audit Log

**Permission:** `audit:read`, meaning interactive Admin / Owner. Supports page and limit; no server-side user_id, action, or date filters.

**200 data:**  `{"items":[Audit],"total":100,"page":1,"limit":25}`, ordered by created_at descending and id descending. details is a JSON string and must be explicitly parsed; logged details are already redacted and cannot recover passwords, secret URL parameters, or plain-text bodies.

<a id="section-11-23"></a>

### 11.23 GET /settings — All Settings

**Permission:** `settings:write` + interactive session, meaning Owner. No pagination;**200 data:**  Setting array sorted by key. It may include `analytics_rollup_…` internal records; do not blindly PATCH back the entire GET result.

<a id="section-11-24"></a>

### 11.24 PATCH /settings — Change Site Name

**Permission:** Owner interactive session. Accepts only `site_name`:

```json
{"site_name":"Linro team links"}
```

**200 data:**  `{"site_name":"Linro team links"}`. Length 1–80 and not whitespace-only; no version, so concurrent update is last-write-wins. This endpoint cannot change Access, KV, analytics_enabled, timezone switches, root secrets, or Cloudflare resources.

<a id="section-11-25"></a>

### 11.25 GET /system/health — Worker and D1 Health

**Permission:** `settings:write`, effectively available to Owner. No parameters. Runs D1 `SELECT 1` then returns:

```json
{"worker":"ok","database":"ok","analytics":"configured_not_probed","version":"1.0.1"}
```

When analytics is not configured, analytics is `disabled_or_incomplete`.**configured_not_probed means configuration exists; it does not prove an AE SQL query succeeded.** D1 exceptions do not return the success object above; unmapped exceptions become 500 `internal_error`. This endpoint is not a public probe.

**Basis:** This chapter maps directly to `apps/admin/src/worker/api.ts`; field conversion is in `data.ts`; ownership / scopes in `auth.ts`; analytics structures in `analytics.ts`. Do not assume unlisted PUT, user deletion, single-domain read, token refresh, manual archive, ownership transfer, or API bulk-export features exist.

<a id="public-api"></a>

## 12 · Public Redirect, Password, and Browser-Check Protocol

<a id="section-12-1"></a>

### 12.1 Route Overview

The following paths live on the **Redirect Worker’s short-link domains**without `/Linro/v1`. They are not backend admin APIs and do not use application tokens as short-link unlock credentials.

| Method | Path | Normal result and purpose |
| --- | --- | --- |
| GET / HEAD | `/` | 200 plain-text brand message; does not list links or automatically redirect to admin |
| GET / HEAD | `/health` | 200 raw JSON `{"status":"ok","version":"1.0.1"}`; does not query D1 |
| GET / HEAD | `/robots.txt` | 200 text `User-agent: *`, `Disallow: /`; not access control |
| GET / HEAD | `/__Linro_assets/password.css` | Password / check-page styles, no-store |
| GET / HEAD | `/__Linro_assets/browser.js` | Browser-check script, no-store |
| GET / HEAD | `/{slug}` | Returns page, redirect, text, or rejection depending on protection flow |
| POST | `/__Linro_unlock/{slug}` | Same-origin password form; success 303 back to same short code |
| POST | `/__Linro_browser/{slug}` | Same-origin browser-check form; success 200 JSON or 303 back to same short code |

Using other methods on internal POST paths returns 405 `Allow: POST` and is handled uniformly before checking whether the short code exists, so database state is not leaked. Other paths do not support POST / PUT / DELETE and return 405 `Allow: GET, HEAD`. Path case matters; old-brand internal paths are not retained as aliases.

Public REDIRECT_LIMITER runs before health, assets, and business lookup. Missing production rate-limit binding or limiter execution failure can return 503. Therefore public health 200 proves only shallow handling and version for that side; it does not prove the domain is registered in D1, the target works, AE queries work, or the password flow works.

<a id="section-12-2"></a>

### 12.2 Normal Links and HEAD

A valid redirect link finally returns configured 301 / 302 / 307 / 308 with Location; a valid text link finally returns 200 `text/plain; charset=utf-8` with no target Location. Missing, disabled link, or disabled domain returns 404; expiration follows `EXPIRED_LINK_STATUS` and returns 404 or 410; exhausted access limit returns 403 with no target.

Protection order summary: method check → outer Worker limiter → latest link / domain read → enablement / expiry / data validity → exhaustion / Tor precheck → password → browser check → final target and rule revalidation → atomic quota consumption → final business response and optional success analytics. Validation failure never falls back through cache to an unprotected redirect.

**HEAD is not a side-effect-free quota probe.** If it satisfies all protection and reaches the final redirect / text response, both HEAD and GET consume one slot for a limited link. HEAD does not write success-click analytics and the outer layer strips its body. A password-page HEAD neither unlocks nor consumes quota. On a block_vpn link, HEAD without valid proof returns 403; when only global collection is enabled and per-link block_vpn is off, HEAD can skip timezone collection.

Public success responses disable CDN caching by default. Only ordinary redirects with no password, no geo routing, no access limit, and no browser flow may allow private client caching according to link.cache_ttl. Protected redirects are no-store; text is always no-store. Do not add outer “Cache Everything” rules that override these responses.

<a id="section-12-3"></a>

### 12.3 Password Form Protocol

The first GET of a password-protected link returns a 200 HTML password page with no target Location. The form action is same-origin `/__Linro_unlock/{slug}`; POST body Content-Type must be `application/x-www-form-urlencoded`with exactly one password field and a streamed body at most 8192 bytes. Do not send JSON and do not place the password in query parameters or logs.

Origin validation requires proof of same-origin. If Sec-Fetch-Site exists it must be same-origin; an explicit Origin must match the full origin. Missing Origin or literal null is accepted only when Sec-Fetch-Site explicitly proves same-origin. An explicit different origin is rejected even if it also claims same-origin. Normal browser forms provide the expected metadata; a third-party cross-site page cannot use this to obtain an unlock.

Wrong password returns a 401 HTML password page and no target; success returns 303 to the original short code and query parameters and sets `__Host-Linro_unlock_*` Cookie. Lifetime is 900 seconds and it is bound to link, host, and rule version; in production it is Secure, HttpOnly, Path=/, SameSite=Lax. The intermediate 303 consumes no quota and records no success click; the next GET rechecks all conditions. Even when the link itself uses 307 / 308, the password POST body is never forwarded to the target.

Calling password-unlock POST for a link without password does not perform generic login and returns 405. Rule edits, password reset, or password removal can invalidate old cookies; new-protocol cookie names differ from the old release.

<a id="section-12-4"></a>

### 12.4 Browser-Check Protocol

When global `BROWSER_TIMEZONE_ENABLED=true` or per-link `block_vpn=1` is enabled, GET may first return a browser-check page. The page collects browser `Intl` timezone string while IP timezone comes from Cloudflare request.cf; this is a weak signal used for policy, not authoritative VPN identification or device authentication.

The browser submits the challenge and timezone from the page by same-origin POST to `/__Linro_browser/{slug}`. Exactly two form fields are allowed: `challenge` and `timezone`, one each; body type remains `application/x-www-form-urlencoded`with maximum 4096 bytes; challenge must be nonempty and ≤2200 characters; timezone ≤64 characters and may be empty, in which case it is treated as unknown.

The request’s **Accept header only selects the success representation; it does not change body format or authentication**:

| Accept | Success representation |
| --- | --- |
| Explicitly accepts `application/json` with valid q > 0 | 200, `{"ok":true,"data":{"next":"/welcome?_Linro_check=1"}}`; no Location |
| Does not explicitly accept JSON, uses wildcard, or JSON q=0 | 303 with Location pointing to the same-origin next path |

Both successful forms set a short-lived `__Host-Linro_browser_*` Cookie, no-store, `Vary: Accept`and neither consumes quota nor records a success click. next contains only the same-origin short code and cleaned query;**the POST never returns the final target URL**. Built-in JS continues with normal page navigation to avoid CSP `form-action 'self'` issues in a later cross-site form-redirect chain. Legacy form 303 remains, but browsers with JavaScript disabled are not guaranteed to complete every cross-site follow-up behavior.

Challenge lifetime is 120 seconds; issuing proof does not extend the original challenge window. Proof is bound to link rules, host, query, and visitor network context. The resumed GET must have exactly one `_Linro_check=1` marker and a valid cookie. Marker-only, cookie-only, blocked cookie, expired challenge, or a link change during the flow cannot skip checking. The final response clears the proof cookie, but the source has no server-side single-consumption table, so it must not be described as an absolutely non-replayable one-time credential.

When block_vpn is enabled, Tor / timezone mismatch or unknown is rejected. When it is not enabled, global collection mainly records data and may allow unknown. Rejection is 403 with no target and no success cookie. Manually altering the form timezone must not be treated as reliable proof that “no VPN is being used”; the limitations of this feature should remain explicit in user-facing communication.

<a id="section-12-5"></a>

### 12.5 Query Parameters and Public Errors

`_Linro_check` is an internal resume marker,`_Linro_lang` is used for internal language selection and must not be forwarded as an ordinary marketing parameter. Final target query parameters are determined by query_mode and the deployment allowlist; see Configuration. An oversized request URI or final combined URL may return 414.

Public responses may be HTML, plain text, or JSON;**they do not all use the Admin API envelope**. Direct rejections are usually plain text; password errors are HTML; form-parse and similar HttpError paths can return standard JSON error; unhandled public exceptions become 503 plain text with Retry-After. Probes should inspect status and Content-Type first.

| Status | Typical public case |
| --- | --- |
| 200 | Root / health / assets; password or browser-check page; final text; browser POST JSON success |
| 301 / 302 / 307 / 308 | Final redirect; does not mean the target site subsequently succeeds |
| 303 | Unlock / browser-check same-origin intermediate resume, not a final click |
| 400 / 415 | Form / format / HTTPS problem; origin-validation failures may also return 403 |
| 401 | Wrong-password page |
| 403 | Quota exhausted, invalid source, browser-policy rejection / insufficient proof |
| 404 / 410 | Missing, disabled, or expired |
| 405 | Wrong method or internal POST used on an inapplicable link |
| 414 | URI / combined target too long |
| 429 | Rate limited; Retry-After is typically 60 seconds |
| 503 | D1 / root secret / limiter binding / rule-data failure, or rules changed before final validation |
| 508 | Direct redirect loop detected at final validation |

**Basis:** `apps/redirect/src/index.ts`; `public-pages.ts`; `browser-page.ts`; `unlock-origin.ts`; `packages/shared/src/browser-check.ts`; `link-password.ts`.

<a id="examples"></a>

## 13 · Ready-to-Adapt Call Examples

<a id="section-13-1"></a>

### 13.1 Bash: Read Session and Create Link

The following environment variables belong to the **calling client**, not deployment.json. Set the admin origin, Access service credentials, and Linro token in a private terminal / CI secret first. Never commit credentials. Token needs links:read and domains:read; the create example additionally needs links:write. Outer Access must already allow the service identity.

```bash
export LINRO_ADMIN_ORIGIN='https://admin.example.com'
# Inject the following three values through your secret-management tool; this example contains no real credentials:
# CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, LINRO_API_TOKEN
: "${CF_ACCESS_CLIENT_ID:?Set Access Client ID}"
: "${CF_ACCESS_CLIENT_SECRET:?Set Access Client Secret}"
: "${LINRO_API_TOKEN:?Set Linro application token}"

curl --silent --show-error --fail-with-body --max-time 20 \
  --dump-header session-headers.txt \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $LINRO_API_TOKEN" \
  -H 'Accept: application/json' \
  "$LINRO_ADMIN_ORIGIN/Linro/v1/session"
```

Do not add `-L` to automatically follow authenticated requests to unknown redirect hosts. curl `--fail-with-body` mainly treats HTTP 4xx / 5xx as failure; an Access 302 may still exit 0, so inspect response headers and JSON structure.`session-headers.txt` contains session-related response metadata; store it as a private diagnostic file.

```bash
# First obtain the actual domain ID, not the DNS hostname.
curl --silent --show-error --fail-with-body --max-time 20 \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $LINRO_API_TOKEN" \
  -H 'Accept: application/json' \
  "$LINRO_ADMIN_ORIGIN/Linro/v1/domains"

# Edit domain_id and ensure the slug is unused; this command creates a real business record.
cat > create-link.json <<'JSON'
{
  "domain_id":"11111111-1111-4111-8111-111111111111",
  "slug":"docs-example",
  "target_url":"https://www.example.org/docs",
  "redirect_code":302,
  "cache_ttl":0,
  "block_vpn":false
}
JSON

curl --silent --show-error --fail-with-body --max-time 20 \
  -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $LINRO_API_TOKEN" \
  --data-binary @create-link.json \
  "$LINRO_ADMIN_ORIGIN/Linro/v1/links"
```

Updates use `-X PATCH` and JSON containing version; delete uses `-X DELETE` and a version query. Do not send the entire L object from POST back as PATCH body. If create times out, query by slug before retrying; do not resend blindly.

<a id="section-13-2"></a>

### 13.2 PowerShell: Read and Update with Optimistic Locking

Credentials are read from the current environment; the PowerShell example uses Invoke-RestMethod, limits redirect following, and lets errors fail. The example changes the specified link title, so replace the id and verify it is within your writable ownership scope first.

```powershell
$ErrorActionPreference = 'Stop'
$Origin = 'https://admin.example.com'
$Required = 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'LINRO_API_TOKEN'
foreach ($Name in $Required) {
    if (-not [Environment]::GetEnvironmentVariable($Name)) {
        throw "Missing environment variable: $Name"
    }
}
$Headers = @{
    'CF-Access-Client-Id' = $env:CF_ACCESS_CLIENT_ID
    'CF-Access-Client-Secret' = $env:CF_ACCESS_CLIENT_SECRET
    'Authorization' = "Bearer $($env:LINRO_API_TOKEN)"
    'Accept' = 'application/json'
}
$Id = '22222222-2222-4222-8222-222222222222'
$Uri = "$Origin/Linro/v1/links/$Id"
$Current = Invoke-RestMethod -Uri $Uri -Headers $Headers -Method Get `
    -MaximumRedirection 0 -TimeoutSec 20
if ($Current.ok -ne $true -or -not $Current.data.version) {
    throw 'Did not receive a valid Linro link object.'
}
$Body = @{ version = $Current.data.version; title = 'Updated title' } |
    ConvertTo-Json -Compress
$Updated = Invoke-RestMethod -Uri $Uri -Headers $Headers -Method Patch `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($Body)) `
    -MaximumRedirection 0 -TimeoutSec 20
$Updated.data | Select-Object id, slug, title, version
```

Another user may update between read and write and cause 409; that is expected protection and should not be auto-ignored. Client / shell version differences are outside the project code; the example does not claim to have been executed on the user’s machine.

<a id="section-13-3"></a>

### 13.3 Browser: Create Interactive-Only Resources

Run this in the developer console of an already signed-in **admin-domain page**. It uses the current same-origin Access cookie and no application token. The example really creates a 7-day, read-only token for the current user. View the output only in a private environment and save it immediately in a secret-management tool.

```javascript
(async () => {
  const response = await fetch('/Linro/v1/tokens', {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'manual',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Linro-CSRF': '1'
    },
    body: JSON.stringify({
      name: 'docs-readonly',
      scopes: ['links:read', 'domains:read'],
      expires_at: Math.floor(Date.now() / 1000) + 7 * 86400
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    throw new Error('No JSON received: check Access login status and same-origin page.');
  }
  const result = await response.json();
  if (!response.ok || result.ok !== true) {
    throw new Error(result.error?.code || `HTTP ${response.status}`);
  }
  window.prompt('The full token is shown only once; save it securely, then close this dialog.', result.data.token);
})().catch(error => console.error(error.message));
```

User management can use the same fetch structure to call `/users` but requires Owner; replace with `{"email":"editor@example.com","role":"editor"}`. Do not run it in an arbitrary third-party site console and do not copy scripts you do not understand or print full authentication cookies.

<a id="section-13-4"></a>

### 13.4 Node.js: Bounded Read-Only Client

Save as `linro-read.mjs` and run using the project’s required Node 22 environment. It is read-only, does not automatically retry writes, does not follow redirects, and does not print secrets or raw error bodies to logs.

```javascript
const required = name => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

async function main() {
  const origin = new URL(required('LINRO_ADMIN_ORIGIN'));
  if (origin.protocol !== 'https:' || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('LINRO_ADMIN_ORIGIN must be an HTTPS origin only.');
  }
  const token = required('LINRO_API_TOKEN');
  if (!/^Linro_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error('Invalid Linro token format.');
  }
  const headers = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${token}`,
    'CF-Access-Client-Id': required('CF_ACCESS_CLIENT_ID'),
    'CF-Access-Client-Secret': required('CF_ACCESS_CLIENT_SECRET')
  };
  async function get(path) {
    const url = new URL(`/Linro/v1${path}`, origin);
    const response = await fetch(url, {
      headers, redirect: 'manual', signal: AbortSignal.timeout(20000)
    });
    const requestId = response.headers.get('x-request-id') || 'unavailable';
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Authentication redirect (${response.status}); not followed.`);
    }
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
      throw new Error(`Non-JSON response (${response.status}); request_id=${requestId}`);
    }
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      throw new Error(`${result.error?.code || 'http_error'} (${response.status}); request_id=${requestId}`);
    }
    return result.data;
  }
  const session = await get('/session');
  console.log({ version: session.version, scope: session.link_write_scope });
  const links = await get('/links?limit=10&page=1');
  console.log({ total: links.total, displayed: links.items.length });
  // Do not log short-link targets, plain-text content, or any token by default.
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Client failed.');
  process.exitCode = 1;
});
```

These examples are written against this release’s API and must be reviewed before use. Create / update calls modify data; use dedicated acceptance records and never point them directly at existing business links.

<a id="operations"></a>

## 14 · Backup, Local Development, and Operations

<a id="section-14-1"></a>

### 14.1 Backup Set

Complete recovery requires the D1 SQL dump, matching source and lock file, configuration / version / binding / trigger information for both Workers, and securely stored root secrets. A D1 export contains users and business data, token hashes, link password hashes, audit, and analytics, but not LINK_PASSWORD_SECRET, BROWSER_CHECK_SECRET, or ANALYTICS_API_TOKEN. KV is rebuildable cache, not a replacement for D1. AE events are not part of a D1 export.

```bash
# The project wrapper outputs Linro-backup.sql; archive the old file before running again.
npm run backup

# Or choose a new backup filename after confirming the account and database target.
npx wrangler d1 export DB --remote --config apps/admin/wrangler.jsonc --output Linro-backup-before-change.sql
```

Export can affect database queryability; schedule an appropriate window rather than assuming zero impact at all times. After backup, produce verification summaries, encrypt storage, and practice offline restore. Do not put SQL, deployment.json,`.dev.vars` Cloudflare settings snapshots, or sensitive log content into a public docs directory.

<a id="section-14-2"></a>

### 14.2 Restore Discipline

Prefer importing a backup into an **isolated recovery database**to verify schema, business counts, foreign keys, rule triggers, and password capability before touching the live database. The following is a write-impacting recovery-drill template and the database must be a newly created isolated recovery DB; never fill it with the currently serving DB ID.

```bash
# YOUR_ISOLATED_RECOVERY_DB_ID must be an isolated recovery database, not the live production database.
npx wrangler d1 execute YOUR_ISOLATED_RECOVERY_DB_ID --remote --config apps/admin/wrangler.jsonc --file Linro-backup-before-change.sql
```

An actual SQL backup may already contain schema creation and migration records. Inspect it first before deciding whether migrations should be applied separately to avoid duplicate initialization. CSV import cannot restore original identity, tokens, counters, and passwords completely. After recovery validation passes, plan a maintenance window, binding cutover, and rollback; this manual does not execute those steps.

Code rollback, database recovery, and secret rotation are three different operations. If the password root secret is lost, original passwords cannot be recovered from hashes; do not “restore access” by weakening validation or deleting protection fields. For 503 caused by corrupted rule data, repair the data source and verify it instead of degrading to arbitrary redirect behavior.

<a id="section-14-3"></a>

### 14.3 Local Development

Local configuration lives in `.local/` and database state in `.local/state`; both local Workers share that state. Running local migrations does not migrate cloud D1 automatically. Initialization preserves existing local tokens, root secrets, and data; those values must never be copied into production. Turning local KV off/on is not the same as rebuilding local D1.

```bash
npm ci
npm run local:init
# To test the local KV path, use:npm run local:init -- --kv
npm run build:web
npm run db:migrate:local
npm run db:seed:local
npm run dev:admin
# In another terminal, from the same project directory:npm run dev:redirect
```

The admin endpoint is http://127.0.0.1:8787 and the redirect endpoint is http://127.0.0.1:8788. Enter the development token printed during initialization into the local GUI. Development authentication requires explicit development mode and a loopback origin; do not change production ENVIRONMENT to bypass Access.

Local mode can validate UI / data / form behavior, but cannot prove real Cloudflare IP country, IP timezone, trusted device headers, cross-region rate limiting, or production DNS/TLS behavior.

<a id="section-14-4"></a>

### 14.4 Common Script Quick Reference

| Command | Purpose / notes |
| --- | --- |
| `npm run configure -- --config deployment.json` | Generate both Worker configs; preserve and review old configuration first |
| `npm run preflight` | Local config validation; does not verify online secrets / DNS / database tables |
| `npm run check` | TypeScript checks for both Workers and the UI |
| `npm run build` | check, Worker compile, Web build |
| `npm test` | Worker compile plus normal test suite |
| `npm run test:browser` | Worker compile plus serial browser-security regression |
| `npm run test:runtime` | Runtime versions, canary, and workerd regression |
| `npm run deploy:dry-run` | Package both Workers as a dry run; not production acceptance |
| `npm run db:migrate` | After preflight, apply migrations to production D1; remote write |
| `npm run deploy` | preflight → build → test → runtime → Admin deploy → Redirect deploy / health; does not automatically run browser tests or DB migration |
| `npm run verify:deployment` | HTTPS-only public health check for status and version; does not repair DNS or redeploy automatically |
| `npm run audit:links -- --input private-export.json --config deployment.json` | Read-only policy review of a private export; does not modify links or output passwords / text bodies |
| `npm run package:source` | Create a source directory using project scripts; still review configuration and secret exclusions before publishing |
| `npm run backup` | Export production D1 to a fixed filename; pay attention to overwrite and secure storage |

Dedicated redirect smoke check: create an unlimited /docs fixture with no password or VPN restriction, cache_ttl=0, target https://example.org/docs, and status 301. This tool sends GET and HEAD without following the target. With global browser collection enabled, GET enters a check page, so this direct-redirect tool cannot validate that flow. Use an isolated acceptance configuration without collection, or complete the flow in a real browser; do not disable production protections to make a test pass.

```bash
node scripts/smoke.mjs --short-url https://go.example.com/docs --expected-location https://example.org/docs --code 301
```

For analytics credential rotation, verify first and remove the old credential only after successful cutover. Give the replacement minimal query permissions for the target account, validate it using controlled input with scripts/verify-analytics-token.mjs, update the Admin secret, and verify queries and Cron. Identify credentials by explicit ID, never by console row number. verify:deployment does not automatically redeploy; investigate failures using redacted evidence.

<a id="section-14-5"></a>

### 14.5 Day-to-Day Observation and Diagnostic Boundaries

Public health probing can specify host and address family:

```bash
npm run verify:deployment -- --url https://go.example.com/health --expected-version 1.0.1
npm run verify:deployment -- --url https://go.example.com/health --family 4
# To check IPv6 separately when the local machine has IPv6 connectivity:--family 6
```

The script defaults to at most 12 rounds, 5 seconds between rounds, and a 10-second timeout per request. It usually requires two consecutive healthy rounds; if configured for only one attempt, one round is sufficient. It does not follow redirects, disable certificate validation, or fall back to HTTP. On failure, preserve HTTP status, TLS information, time, and request ID first; do not repeatedly deploy or routinely unbind/rebind domains just to “turn the check green.”

Package observability is disabled by default and application errors intentionally avoid logging bodies and secrets. If deeper logging is needed, enable it only in a controlled environment and verify redaction. Never post Authorization, Access JWT, complete cookies, password POST bodies, or private SQL to a public issue. Before database maintenance, review the exact statements and backups; there is no public API for automatic audit / archive cleanup.

**Basis:** `package.json`; `scripts/local-init.mjs`; `scripts/local-wrangler.mjs`; `scripts/check-deployment.mjs`; `scripts/security-audit.mjs`; `README.md`; deployment guidance sections 2, 7, and 9.

<a id="acceptance"></a>

## 15 · Production Acceptance Checklist

The following is an **Acceptance plan executed by the deployer**, not online checks performed on the user’s behalf here. Use dedicated test records for count, create, or delete scenarios; do not destructively probe existing passwords, production limited-count links, or unknown external targets.

| Layer | How to check | Pass standard / what it does not prove |
| --- | --- | --- |
| Configuration | After configure, verify both Worker names, D1, domains, Access, bindings, and secret presence | Real resources point correctly; green preflight does not replace online verification |
| Data | Inspect migration records, required columns, rule revision, and Owner trigger | All four migrations required by the target DB are applied while business data is preserved |
| Deployment versions | Check each Worker’s actual current version, traffic allocation, and resources | Uploading a version is not the same as routing traffic to it; confirm both sides separately |
| Outer entry point | Visit GUI and Admin API while unauthenticated | Should enter Access authentication or be denied, not expose admin data directly |
| First Owner | Sign in to an empty-users-table instance with the designated email | Owner is bootstrapped; other emails cannot seize bootstrap |
| Admin deep health | Owner calls GET /system/health | Worker and D1 are both ok; AE field only reports configuration state |
| Public shallow health | GET /health on every short-link domain | Valid HTTPS, 200, version 1.0.1; does not prove D1 or every business flow works |
| Ordinary redirect | Dedicated 302 link, without automatically following the destination | Location is correct and cache headers are correct; an unprotected link should not unexpectedly return 503 |
| Text mode | Dedicated plain-text link | 200 text/plain, no Location, content is not executed as HTML, no-store |
| Password protection | Dedicated known password: no cookie, wrong password, correct password, then GET again | Protection page has no target; wrong password 401; success same-origin 303, then final response; POST body is not sent to target |
| Browser check | Test combinations of global collection and block_vpn with cookies and JS allowed | Return a check page or business response according to policy; verify the JSON resume path and newly loaded resources |
| Rule update | Change target / protection on a dedicated record and retry an old proof | Old-rule proof must not continue authorizing the old target; this does not promise revocation of responses already issued |
| Access limit | Create a low-limit test link and observe GET / HEAD | Each final authorized request consumes one slot; exhausted returns 403; HEAD is not a free check |
| Member permissions | Viewer / Editor / Admin / Owner plus dedicated test tokens | Must match the Chapter 06 matrix, especially cross-owner write denial and shared reads |
| API protection | Old /api, old token format, cross-origin Origin, wrong version | Verify corresponding 404 / 401 / 403 / 409 behavior; do not substitute hidden GUI controls for security tests |
| Analytics | New test event → /stats → later UTC archive | Verify write, query, and Cron separately; intermediate pages must not increase successful clicks, and sampled data is not exact UV |
| Backup | Isolated restore drill plus companion secret verification | SQL restores successfully and root secrets are usable; CSV is not a complete backup |

Testing “wrong password / wrong proof / unauthorized / rate limit” should use controlled frequency and only your own dedicated records. Actual sampling, distributed rate limiting, and platform-runtime behavior still require real deployment verification; local mocks cannot prove behavior on every edge node.

<a id="troubleshooting"></a>

## 16 · Common Failures and Error Codes

<a id="section-16-1"></a>

### 16.1 Troubleshooting by Symptom

| Symptom | Check first | Do not do this |
| --- | --- | --- |
| GUI opens but shows login expired; API returns HTML / 302 | Access session, full-host protection, Origin, and whether the client is incorrectly following redirects | Do not interpret HTML parse failure as “no links”; do not expose Admin API to bypass Access |
| Access allows the request but Linro returns 403 | Whether the user is enabled, email was preregistered, and access_sub changed | Do not trust a visitor-supplied email header and do not remove Owner protection directly |
| First Owner is not auto-created | Whether the users table is truly empty and whether normalized email case matches bootstrap | Do not clear an existing users table just to force reinitialization |
| A script with a token still returns 401 | Both authentication layers, full token prefix / length, expiry / revocation, and whether the user is disabled | Do not send only Access service credentials and do not manually rewrite an old token prefix |
| An Owner token cannot modify someone else’s link | All tokens are limited to owned writes; use interactive Owner or the corresponding dedicated user | Do not elevate tokens to management scopes or remove created_by checks |
| Page reports a version conflict | Compare the newest version and submitted fields | Do not automatically replay the entire stale object |
| Public-domain health is 200 but a short code is 404 | D1 domain record, slug case, domain / link enabled state, expiration policy | Do not treat health as proof of a DB query and do not rebuild DNS to fix business-record errors |
| Enabling timezone collection causes widespread 503 | Whether Redirect has a valid BROWSER_CHECK_SECRET and whether both sides run matching versions | Do not replace the new root with the password root; do not add source-code fallback to unprotected redirect |
| Passwords worked before upgrade but all now fail | Whether the original LINK_PASSWORD_SECRET was preserved and database hashes are unchanged | Do not generate a random replacement root and do not delete password fields to restore access |
| Browser check repeats or returns 403 | Blocked cookie, expired challenge, duplicate marker, rule change, network-context change, static-resource version mismatch | Do not merely add `_Linro_check=1` to bypass validation; do not call every false positive definitive VPN proof |
| A browser without JavaScript cannot complete the final cross-site redirect | Native form 303 and CSP limitations; validate using the project’s normal JS navigation flow | Do not remove CSP globally just to hide the regression |
| KV is configured but D1 is still queried | That is the intended d1-guarded cache design | Do not claim KV hits avoid D1; do not use cache as an authorization source when D1 is unreachable |
| Analytics says “not configured” / empty / error | Check available, switches, dataset, account ID, Admin query secret, and actual events separately | Do not display available:false or query failure as zero clicks |
| /stats is slow and GUI errors after 20 seconds | Eight sequential queries and a 10-second budget for each upstream query | Do not automatically retry at high frequency and amplify upstream 429s |
| Archive has no data for today / no timezone breakdown | Cron policy for the previous two complete UTC days, cursor, and existing daily_stats | Do not expect archive API to reproduce every AE historical dimension |
| Deleting a domain returns 409 | Links still reference it; move them first or delete them with proper authorization | Do not manually disable foreign-key enforcement |
| TLS / custom-domain problem | Check SNI, DNS, certificate, and platform status while preserving health-check evidence | Do not disable TLS verification and do not routinely unbind/rebind or redeploy in a loop |

<a id="section-16-2"></a>

### 16.2 Admin Error Code Quick Reference

This table lists major actionable errors but does not guarantee every public plain-text response carries error.code; one request usually returns the first authentication / validation failure reached.

| HTTP | error.code | Meaning and handling |
| --- | --- | --- |
| 400 | `invalid_json`, `empty_body` | JSON must be a valid UTF-8 object and body cannot be empty |
| 400 | `unknown_field` | Remove undeclared or read-only fields; do not send a GET object back unchanged |
| 400 | `invalid_field` | Invalid numeric range, type, version, or generic string |
| 400 | `invalid_slug` | Invalid slug syntax / reserved word |
| 400 | `invalid_url`, `invalid_hostname`, `invalid_email` | Submit URL, hostname, and email according to model rules |
| 400 | `invalid_code`, `invalid_query_mode` | Choose a supported numeric redirect code or query enum |
| 400 | `internal_target`, `private_target`, `redirect_chain` | Target is admin, an unapproved private address, or a managed short-link domain; use a reviewed final target |
| 400 | `unsafe_query_mode` | Sensitive auth / reset / redirect targets must use discard |
| 400 | `domain_not_found`, `admin_hostname` | Choose an existing business domain; the admin domain cannot be used |
| 400 | `invalid_geo_rules`, `duplicate_geo_rule` | Invalid geo-rule structure, count, code, or duplicate item |
| 400 | `invalid_response_mode`, `invalid_text_content`, `text_geo_conflict` | Invalid body type / length, or text mode still retains geo rules |
| 400 | `invalid_block_vpn`, `invalid_link_password` | Protection field type or password constraints are not satisfied |
| 400 | `invalid_status`, `search_too_long` | List filter or search term too long |
| 400 | `invalid_link_id` | Analytics selector is empty, malformed, over 50 items, repeated, or mixes both selection parameters |
| 400 | `invalid_import`, `invalid_batch`, `invalid_action`, `duplicate_item` | Invalid import / bulk structure or item count |
| 400 | `invalid_role`, `invalid_name` | Invalid user role or site / token name |
| 400 | `https_required` | Production admin requests must use HTTPS |
| 401 | `access_required` | Worker did not receive a valid Access entry authentication header |
| 401 | `invalid_access_token` | Access JWT signature, algorithm, claims, time, issuer, or audience did not validate |
| 401 | `invalid_token` | Application-token format, existence, expiry / revocation, or user state failed validation |
| 401 | `local_token_required` | Local only: development token missing or wrong |
| 403 | `user_not_allowed`, `human_identity_required` | User is disabled / identity mismatched, or service identity lacks a Linro token |
| 403 | `forbidden`, `invalid_scopes` | Current scope is insufficient, or token creation requests scopes beyond authority |
| 403 | `interactive_only` | A token is calling an interactive-only endpoint |
| 403 | `link_owner_required` | Editor / token is trying to write a link created by another user |
| 403 | `cross_origin`, `csrf` | Origin or CSRF header does not meet requirements |
| 404 | `not_found`, `api_not_found` | Resource does not exist, or route / method is unsupported |
| 404 | `stats_link_not_found` | At least one link selected for analytics no longer exists |
| 409 | `conflict` | Unique conflict on slug, hostname, or email |
| 409 | `version_conflict` | Optimistic-lock conflict; refresh, compare, then resubmit |
| 409 | `in_use` | Resource is still referenced by a foreign key or referenced target no longer exists |
| 409 | `last_owner` | Operation would remove the final enabled Owner |
| 409 | `token_limit` | 50 non-revoked token records already exist; revoke unused ones first |
| 409 | `hostname_is_destination` | New domain is already referenced by an existing default / geo target; migrate target first |
| 413 | `body_too_large` | Body exceeds endpoint limit |
| 414 | `uri_too_long` | Final combined URL is too long |
| 415 | `content_type` | Admin API requires application/json; password POST separately requires form content type |
| 421 | `wrong_host` | Admin request Origin differs from ADMIN_ORIGIN |
| 429 | `rate_limited` | Admin API authentication-stage or write limiter triggered; inspect Retry-After and do not high-frequency retry automatically |
| 500 | `internal_error` | Unmapped Admin exception, including some D1 or upstream-network failures; preserve request_id |
| 502 | `analytics_query_failed` | AE upstream HTTP, shape, or count validation failed |
| 503 | `access_not_configured`, `access_keys_unavailable` | Access configuration invalid or signing public key temporarily unavailable |
| 503 | `link_password_unconfigured`, `invalid_password_record` | Password root secret missing or stored verifier malformed |
| 503 | `browser_check_unconfigured` | Browser-check capability is not configured before enabling the per-link policy |
| 503 | `assets_missing`, `rate_limit_not_configured` | Admin static assets or production write-limiter binding missing; inspect build and bindings |
| 503 | `security_policy_invalid` | Deployment security-policy JSON, fields, or allowed values invalid |

Public browser forms can additionally return `browser_form_type`, `invalid_browser_form` and other dedicated errors. Do not debug a form request using Admin JSON assumptions. Source also has dedicated errors for private targets / managed domains and related checks; use the actual response plus request_id to locate the matching validation function. This table is for troubleshooting, not a reason to ignore unknown errors or treat them as success.

**Basis:** `packages/shared/src/http.ts`, `validation.ts`, `policy.ts`, `destination.ts`, `access.ts`, `link-password.ts`; `apps/admin/src/worker/auth.ts`, `index.ts`, `api.ts`, `analytics.ts`; `apps/redirect/src/browser-page.ts`.
