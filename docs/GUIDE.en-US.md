# Linro v1.0.2: from first try to a running service

[简体中文](GUIDE.md) · [README](../README.en-US.md) · [API reference](API.en-US.md)

This guide starts with a safe local tryout, then walks through production setup. Run commands from the **project folder containing `package.json`**, unless a step says otherwise. Do one step, check its result, then continue.

All domains, email addresses, IDs, and paths shown as examples are fictional or explicit placeholders. Replace them in your private configuration. Never publish the filled-in copy.

## 1. Understand the four main pieces

A short link works like a signpost: a visitor reads a short address, and Linro tells the browser where to go next.

| Name | Plain-language meaning | In this project |
| --- | --- | --- |
| Worker | A small program Cloudflare runs for a request | One Admin Worker and one Redirect Worker |
| D1 | The shared database, like the office notebook | Links, rules, users, settings, and audit records |
| Access | The login gate before the staff area | Protects the entire admin hostname |
| Binding | A named connection between a Worker and a resource | Both Workers use `DB` for the same D1 database |
| Migration | A numbered change to database tables | Files `0001` through `0006` in `migrations/` |
| Secret | A private value stored separately from public configuration | Password roots and optional API credentials |
| Slug | The short code after a domain | `welcome` in `https://go.example.com/welcome` |

The public Redirect Worker and private Admin Worker have different hostnames. Do not put public short-link hosts behind the admin Access application. KV caching and Analytics Engine are optional; start without them if you only need basic links.

This guide covers application **v1.0.2**. Its API remains `/Linro/v1`, and v1.0.1 credentials/protocols remain compatible. [Protocol identifiers](PROTOCOL-v1.0.2.en-US.md) explains the intentional older compatibility labels.

<a id="local"></a>
<a id="local-setup"></a>

## 2. Try the real application on your computer

For an interface-only practice room, use the [static demo](DEMO.en-US.md). The steps here run the actual Workers locally, with a separate local database.

### 2.1 Install the tools and dependencies

Install Node.js **22.16.0 or newer** and npm. Extract the complete source ZIP and enter its folder. Check the versions:

```bash
node --version
npm --version
node -p "require('./package.json').name + ' ' + require('./package.json').version"
npm ci
```

The project should report `linro 1.0.2`. `npm ci` installs exactly the dependency tree in `package-lock.json`; keep that lockfile. The project pins Wrangler **4.132.0**. To see the resolved Wrangler/Miniflare/workerd toolchain, run `npm run toolchain:versions`.

If your system has `sha256sum`, you can check an untouched source release with `sha256sum -c MANIFEST.sha256` from its root. After your own edits, original manifest differences are expected; release packaging creates a new manifest.

### 2.2 Prepare the local database and dashboard

```bash
npm run local:init
npm run build:web
npm run db:migrate:local
npm run db:seed:local
```

`local:init` prints a **local development token**. Keep it private and enter it when the local dashboard asks. It creates `.local/` settings, preserves valid existing local secrets, and does not erase existing local database state. Local data stays in `.local/state`; both local Workers share it. None of these steps migrates your cloud D1 database.

### 2.3 Start the two local services

In the first terminal:

```bash
npm run dev:admin
```

In a second terminal, in the same project folder:

```bash
npm run dev:redirect
```

Open the [local dashboard](http://127.0.0.1:8787). The public local endpoint is [http://127.0.0.1:8788](http://127.0.0.1:8788). The seed step creates its local domain record. Create a link with destination `https://example.org/`, use status 302 and browser cache 0, then open the short address.

Stop each process with Ctrl+C. To try the local KV path, run `npm run local:init -- --kv` and restart the local services. Keep `.local/` out of Git and public archives. Its development token is not a production login mechanism.

Local testing can check forms and database behavior. It does not reproduce Cloudflare's real visitor country, ASN, connection RTT, Access policies, DNS, TLS, or distributed rate limiting.

<a id="install"></a>
<a id="production-setup"></a>

## 3. Prepare your Cloudflare resources

You need a Cloudflare account, permission to create resources in it, and domains you control. An example layout is:

| Address | Purpose |
| --- | --- |
| `admin.example.com` | Private dashboard and admin API |
| `go.example.com` | Public short links |

Replace these with your own hostnames. Use an active Cloudflare zone that can host Worker Custom Domains. Existing conflicting DNS records, including a CNAME on the chosen hostname, need review before a Custom Domain can be added. See [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

### 3.1 Sign in to the correct deployment account

```bash
npx wrangler --version
npx wrangler login
npx wrangler whoami
```

Wrangler login authorizes your terminal to manage Cloudflare resources. It is separate from the Access login your dashboard users will use.

Confirm the Account ID. Account ID, Zone ID, D1 database ID, and Access audience are different values. If you have several accounts, set the intended account before resource creation. In Bash:

```bash
read -r -p "Target Cloudflare Account ID: " CLOUDFLARE_ACCOUNT_ID
export CLOUDFLARE_ACCOUNT_ID
```

In PowerShell:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = Read-Host 'Target Cloudflare Account ID'
```

### 3.2 Create one shared D1 database

For a **new installation**:

```bash
npx wrangler d1 list
npx wrangler d1 create linro
npx wrangler d1 info linro
```

Record the returned database name and UUID. Both Workers must use this same database. If Wrangler offers to rewrite one configuration automatically, leave that change to the project's configuration generator so both sides stay consistent.

For an existing installation, reuse its database and follow [Backup and upgrade](#backup-and-upgrade). Do not create a replacement database merely to update the code, and do not upload the local development database to establish a production Owner.

### 3.3 Put Access in front of the whole admin host

In Cloudflare Zero Trust, create a **self-hosted public application** for the admin hostname. The exact dashboard labels can change; the required settings are:

| Setting | What to choose |
| --- | --- |
| Hostname | Your admin hostname |
| Path | Leave blank, so the entire hostname is protected |
| Human policy | Allow specific approved email addresses or an identity group you control |
| Login method | The email OTP or identity provider configured in your account |
| Public short-link hosts | Keep them outside this admin application and check overlapping wildcard applications |

Keep the gate restrictive. Do not add a Bypass policy or an unrestricted Everyone rule to make setup easier. The Worker checks the Access JWT again after the outer gate.

Record the application's issuer and **Audience (AUD)**, and choose the first Owner's Access email. The issuer has the shape `https://YOUR-TEAM.cloudflareaccess.com`, without a trailing slash. The audience is not the application ID and not an API token.

Official instructions: [self-hosted public applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/). Cloudflare deployment permissions do not automatically grant permission to administer Access.

<a id="configuration"></a>

## 4. Configure, migrate, and deploy

There are three places for settings. Keep them separate:

| Place | What belongs there |
| --- | --- |
| Private `deployment.json` | Resource IDs, hostnames, Access settings, feature switches |
| Worker secrets | Private root secrets and optional service API credentials |
| Linro dashboard / D1 | Links, domain records, users, and the displayed site name |

### 4.1 Copy the public example once

In Bash:

```bash
test ! -e deployment.json && cp deployment.example.json deployment.json
```

In PowerShell:

```powershell
if (Test-Path .\deployment.json) { throw 'Review the existing file instead of overwriting it.' }
Copy-Item .\deployment.example.json .\deployment.json
```

Edit the new file with your own values. Fill the account, database, admin host, public hosts, Access issuer/AUD, and Owner email. Keep the optional switches off initially:

```json
{
  "analytics_enabled": false,
  "browser_timezone_enabled": false,
  "cloudflare_device_type_enabled": false,
  "redirect_cache_namespace_id": ""
}
```

This small JSON is a fragment to explain those switches, **not a complete deployment file**. Keep the required fields from `deployment.example.json`. Set `source_url` to the published source matching the code you will run; see [Licensing](LICENSING.en-US.md). The public example leaves it empty so it cannot imply a real source publication.

Generate and check the two Worker configurations:

```bash
npm run configure -- --config deployment.json
npm run preflight
```

`configure` overwrites `apps/admin/wrangler.jsonc` and `apps/redirect/wrangler.jsonc`. Review their Worker names, account/D1 IDs, hostnames, bindings, and switches before deployment. It does not create D1, Access applications, dashboard domain records, or secrets. `preflight` checks local configuration; it cannot prove remote secrets, DNS, certificates, or tables work.

Keep these generated safety settings: `workers_dev: false`, `preview_urls: false`, and Admin `assets.run_worker_first: true`. The Admin Worker also explicitly enables `enable_request_signal` with compatibility date `2026-09-15`. This allows a disconnected statistics request to cancel outstanding provider requests. Preserve the flag; SQL already accepted by the provider can still complete. [Cloudflare compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)

### 4.2 Apply database migrations separately

List the database's recorded migrations:

```bash
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
```

The release contains:

| Migration | What it adds |
| --- | --- |
| `0001_initial.sql` | Base tables, indexes, and protection for the final enabled Owner |
| `0002_link_controls.sql` | Geographic rules, password verifiers, limits, counters, and rule revisions |
| `0003_text_responses.sql` | Plain-text response mode |
| `0004_browser_checks.sql` | Per-link `block_vpn` policy |
| `0005_link_kv_cache.sql` | Per-link KV TTL and rule invalidation |
| `0006_destination_hosts_and_archive.sql` | Canonical destination hosts, race guards, and archive ordering index |

After confirming the target account/database, and backing up any existing data:

```bash
npm run db:migrate
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
```

This is a **remote database write**. Apply only pending migrations. If one fails, stop and investigate; do not delete migration records or rerun initialization to hide the failure. [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)

### 4.3 Build and check before publishing

```bash
npm run check
npm test
npm run test:runtime
npm run build
npm run test:browser
npm run deploy:dry-run
```

The regular tests, native workerd tests, and real browser tests cover different behavior. Browser tests need an installed Chrome/Chromium executable; set `CFL_CHROMIUM_PATH` when automatic discovery is insufficient. Keep the browser sandbox enabled. A browser that cannot start is an uncompleted check, not a passing result.

The dry run packages both Workers without switching live traffic. It does not verify your real Access policies, secrets, or DNS.

### 4.4 Deploy the basic service

```bash
npm run deploy
```

This changes cloud services. Its actual order is:

`preflight → build → test → test:runtime → deploy:admin → deploy:redirect → verify:deployment`

The command **does not run remote migrations or browser tests**. Complete those steps separately. The two Workers are not deployed atomically.

If publishing succeeds but the public health probe fails, first investigate DNS, TLS, and hostname bindings. A new hostname may still have cached NXDOMAIN responses. After fixing the cause, rerun `npm run verify:deployment`; it does not redeploy or repair anything automatically.

### 4.5 Sign in and create a first link

Open your admin hostname and sign in through Access with the configured Owner email. Linro creates the first Owner only when the `users` table is empty. Changing `owner_email` later does not replace an existing Owner.

In **Domains**, add the public hostname already bound to the Redirect Worker. Then create a test link with slug `install-check`, a normal public target, status 302, query mode `discard`, and browser cache 0. Check:

```bash
npm run verify:deployment
curl -sS -D - -o /dev/null https://go.example.com/install-check
curl -sS https://go.example.com/health
```

Replace the hostname first. On Windows use `curl.exe` and `-o NUL`. Do not add `-L`: inspecting the first response tells you what Linro returned without following the destination. The test link should have the expected status and `Location`. Public `/health` reports `status: "ok"` and `version: "1.0.2"`; it does not query D1.

Also check that an unauthenticated admin visit meets the Access gate. The Owner's **Settings → health check** queries D1; its analytics field reports configuration only. Test each optional protection on dedicated records before enabling it on important links.

### 4.6 Add another public hostname

A hostname needs **two registrations**: Cloudflare routes traffic to the Redirect Worker; Linro's D1 domain record tells the application which host it may serve.

1. Add the hostname to `redirect_hosts` in private `deployment.json`.
2. Run `configure`, review the complete generated host list, run `preflight`, and deploy the reviewed change.
3. Add the same hostname in the dashboard's Domains page.
4. Create a dedicated test link and verify that hostname's `/health` and redirect.

The dashboard cannot create DNS or Custom Domains. Conversely, a successful public health response does not prove a D1 domain record exists. Removing a D1 record does not detach Cloudflare routing. Before removing a host, move or delete its links and review both registrations deliberately.

### 4.7 Complete deployment field reference

These are generator defaults, not the settings of a running installation. Use JSON booleans/numbers, not quoted strings, where those types are shown.

| Field | Default / accepted value |
| --- | --- |
| `account_id` | Required real 32-character lowercase hexadecimal account ID; all zeroes rejected |
| `database_id` | Required D1 UUID; the same database for both Workers |
| `database_name` | `linro`; 1–51 lowercase letters/digits/hyphens, starting with a letter/digit |
| `admin_worker_name` | `linro-admin`; 1–63 lowercase letters/digits/hyphens, starting with a letter/digit |
| `redirect_worker_name` | `linro-redirect`; same format and different from the Admin name |
| `admin_host` | Required lowercase DNS hostname, maximum 253 characters; no scheme, port, path, trailing dot, or IPv4 literal |
| `redirect_hosts` | Required 1–50 distinct hostnames, all different from the admin host |
| `access_issuer` | Required `https://YOUR-TEAM.cloudflareaccess.com` using the actual team name, no trailing slash |
| `access_aud` | Required audience of the same Access application; 16–256 letters/digits/underscore/hyphen |
| `owner_email` | Required first Owner email, maximum 254 characters; generated value is lowercased |
| `analytics_enabled` | `false` |
| `analytics_dataset` | `linro_clicks`; 1–64 letters/digits/underscores, starting with a letter/underscore |
| `analytics_rollup_enabled` | `true`, but effective only while analytics is enabled |
| `analytics_rollup_interval_minutes` | `15`; choose 5, 15, 30, 60, 360, or 1440 |
| `analytics_rollup_recheck_hours` | `6`; integer 1–24 |
| `browser_timezone_enabled` | `false`; global collection additionally needs Analytics and its Redirect writer |
| `cloudflare_device_type_enabled` | `false`; enable only with a verified trusted platform header |
| `auth_rate_namespace` | `"21001"`; distinct positive numeric namespace |
| `write_rate_namespace` | `"21002"`; distinct positive numeric namespace |
| `redirect_rate_namespace` | `"21003"`; distinct positive numeric namespace |
| `password_rate_namespace` | `"21004"`; distinct positive numeric namespace |
| `redirect_rate_limit` | `300`; integer 1–100000 per 60 seconds |
| `password_rate_limit` | `5`; integer 1–30 per 60 seconds |
| `redirect_cache_namespace_id` | `""` disables KV; otherwise a real nonzero 32-character lowercase hexadecimal namespace ID |
| `redirect_cache_ttl` | `300`; integer 60–86400 seconds |
| `query_forward_allowlist` | Five exact UTM keys below; at most 32 unique reviewed lowercase keys |
| `private_target_allowlist` | `[]`; at most 32 exact canonical hosts/IP literals and 4096 serialized characters; no ports, wildcard, or CIDR |
| `expired_link_status` | `404`; either 404 or 410 |
| `source_url` | `""`; otherwise public HTTPS source URL, maximum 2048 characters, without credentials/query/fragment/whitespace/backslashes, on a separate host |

The default query keys are `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and `utm_content`; there is no `utm_*` wildcard. Custom keys match `[a-z][a-z0-9_]{0,63}` and cannot be sensitive authentication or redirection keys. All four rate-limit namespaces must differ and contain 1–10 decimal digits with no leading zero.

The generator fixes Admin authentication limiting at 300/60 seconds and writes at 120/60 seconds. Fields such as `auth_rate_limit`, `write_rate_limit`, or `default_redirect_code` are not deployment settings. Unknown top-level keys are not all rejected, so check spelling against this table and inspect generated output. Set a domain's default redirect code in the dashboard.

For upgrades, explicitly retain both Worker names. `configure` can preserve an existing name when account and database match, but a fresh source directory does not know your online resources. It is not a lossless converter for arbitrary hand-edited Wrangler settings.

<a id="usage"></a>

## 5. Use the dashboard day to day

### 5.1 Create and edit links

Select a registered domain, enter a destination, and choose a slug. An empty slug on creation produces an eight-character random code. The same slug can exist on different domains; within one domain it is unique and case-sensitive. Use 1–64 ASCII letters, numbers, underscores, or hyphens. `health`, `cdn-cgi`, and the `__Linro_` prefix are reserved, ignoring case; `Linro` is a valid business slug.

Start with 302 and `cache_ttl=0`. Browsers can remember permanent redirects such as 301/308; later edits cannot recall a response already stored by a visitor. Domain defaults affect future links that omit their own redirect code, not existing links.

Editing uses a `version`, like a revision number on a shared document. If someone changes the link after you opened the form, a 409 conflict asks you to reload and compare changes. Do not blindly replay the old form with a new version number.

Bulk enable/disable/delete handles at most ten items per API call and can partially succeed. Read the individual results. Disabled, expired, and exhausted filters can overlap; they are not separate parts that add up to the total.

### 5.2 Understand destinations and query parameters

Targets are absolute HTTP(S) URLs. The final normalized URL must fit 4096 characters. Credentials, whitespace/control characters, backslashes, the admin hostname, and managed short-link hostnames are rejected. Private/local targets are denied unless the deployer explicitly allows an exact host. Validation does not fetch a destination or resolve its DNS.

A query is the part after `?` in a URL. Forwarding only reviewed keys avoids passing arbitrary visitor data to the destination:

| `query_mode` | Result |
| --- | --- |
| `discard` | Keep the destination's existing query; ignore incoming visitor query keys |
| `merge` | Add allowed incoming keys; existing destination values win on a duplicate key |
| `replace` | Clear the destination query and use only allowed incoming keys, even if none survive filtering |

Sensitive sign-in/reset/redirect destinations must use `discard`. Older unsafe stored combinations are treated as discard on public reads. `_Linro_check` and `_Linro_lang` are internal and never forwarded. The final combined destination can be at most 8192 characters.

### 5.3 Add rules only when needed

| Rule | What it means |
| --- | --- |
| Expiry | Stop serving after a Unix-second timestamp; expired responses use configured 404 or 410 |
| Maximum requests | Count final authorized GET **and HEAD** responses; not unique people |
| Geographic routing | Try country, then continent, then the default target; at most 32 unique rules |
| Plain text | Return a small message with `text/plain`, never execute it as HTML |
| Password | Require visitor unlock; setup is in the next chapter |
| VPN policy | Apply heuristic network/browser checks; legitimate visitors can be denied |

A finite count increases only when the link has a limit. Changing the limit does not reset the count; use the explicit reset operation. Password/check pages and their intermediate responses do not consume the link's finite quota. A lost connection after a committed authorization can still consume one slot.

Plain text accepts 1–16,384 JavaScript string code units and at most 32,768 UTF-8 bytes. It forces `query_mode=discard`, requires empty geographic rules, and always uses `no-store`. Password, expiry, disablement, limits, and browser rules still apply.

<a id="permissions"></a>

### 5.4 Give people the right role

| Capability | Viewer | Editor | Admin | Owner |
| --- | --- | --- | --- | --- |
| Read team links, targets, text, domains, and analytics | Yes | Yes | Yes | Yes |
| Create links and change own links | No | Yes | Yes | Yes |
| Change other members' links | No | No | Yes | Yes |
| Manage domain records and read audit | No | No | Yes | Yes |
| Manage users, site name, and D1 health check | No | No | No | Yes |
| Manage own application tokens within allowed scopes | Yes | Yes | Yes | Yes |

An Owner adds the member's email and role in Linro and allows that identity in Access. Both steps are needed. First sign-in binds the Access subject; later use of the same email with a different subject does not silently replace it. There is no user-email-change or identity-rebinding API.

The last enabled Owner cannot be disabled or demoted. For a handoff, first create another Owner and verify their login. Disabling a user does not disable their old public links. Linro Owner permissions do not grant Cloudflare account administration.

### 5.5 Connect an automated client

Automation needs two keys: Access service credentials for the outer gate, and a Linro token for application permissions. Add an appropriate **Service Auth** policy to the existing admin Access application and retain the human Allow policies. Creating a service token alone does not grant access to that application. See [Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

Create a Linro token in the dashboard. Available scopes are `links:read`, `links:write`, `links:delete`, `domains:read`, and `analytics:read`, limited by the user's role. Management scopes cannot be granted to tokens. All tokens can write only links created by their owning user, even for an Owner; use a separate user when an integration needs separate ownership.

The token is shown once. Save it privately. Expiry must be 60 seconds to 365 days ahead. Up to 50 non-revoked token records count toward the user's limit; expired-but-unrevoked records still count. Tokens cannot manage other tokens. The [API reference](API.en-US.md) explains headers and request examples.

### 5.6 Import and export

GUI export reads the entire shared workspace, not just the visible search or selected rows. It retrieves up to 10,000 links, 100 per page, and checks for duplicate/count inconsistencies. It is not a transaction snapshot while other people are editing.

JSON includes `format: "linro"`, version `1.0.2`, export time, domain data, site name, and links. Neither JSON nor CSV contains password verifiers or original passwords. CSV keeps the `_cf_links_csv` escaping marker for compatibility and includes quoting/formula protection; use the project's importer rather than splitting lines on commas.

Import accepts a JSON array, an object with `links`, or CSV: at most 2 MiB and 1–5,000 rows. YOURLS-style `keyword`, `url`, and `title` are supported. Create domains first; an input `hostname` is matched to an existing domain, otherwise the selected domain is used.

The GUI validates records, then sends batches of at most ten links and 262,144 JSON bytes. Each batch commits independently. A confirmed pre-write `429 rate_limited` is retried once after `Retry-After`; repeated limiting can resume at the current batch. After a timeout or connection loss, reconcile saved records before retrying because the write may already have committed.

An exported `password_protected: true` record needs a new password on import. It cannot silently become unprotected. Import creates new links owned by the current user; it does not restore original users, tokens, ownership, counters, audits, or archive history. **Link export is not a disaster-recovery backup.**

<a id="optional"></a>

## 6. Optional features and their resource cost

Add one optional feature at a time. Check the account's current quotas and bills: “serverless” describes how code runs, not a promise of unlimited free resources.

### 6.1 Keep secrets separate

| Value | Where it belongs | When needed |
| --- | --- | --- |
| `LINK_PASSWORD_SECRET` | Same Worker secret on both Workers | Public link passwords |
| `BROWSER_CHECK_SECRET` | Same independent Worker secret on both Workers | Browser timezone/check flows |
| `RADAR_API_TOKEN` | Redirect Worker secret only | Per-link VPN blocking |
| `ANALYTICS_API_TOKEN` | Admin Worker secret only | Analytics queries and daily archive |
| `LOCAL_DEV_TOKEN` | `.local/.dev.vars` only | Local loopback login |
| Access service and Linro tokens | Private calling-client storage | Automated admin API calls |

For a new root secret, generate 32 random bytes in a private terminal and store the result in a password manager:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

The two root secrets each accept 43–128 base64url characters. Generate a **different value for each purpose**. For password protection, enter the same password-root value at both prompts:

```bash
npx wrangler secret put LINK_PASSWORD_SECRET --config apps/admin/wrangler.jsonc
npx wrangler secret put LINK_PASSWORD_SECRET --config apps/redirect/wrangler.jsonc
```

For browser checks, enter the separate browser-root value at both prompts:

```bash
npx wrangler secret put BROWSER_CHECK_SECRET --config apps/admin/wrangler.jsonc
npx wrangler secret put BROWSER_CHECK_SECRET --config apps/redirect/wrangler.jsonc
```

These commands change cloud secrets. `wrangler secret put` creates **and immediately deploys** a new Worker version. Use it deliberately after the baseline Workers exist, and track both updates. Do not regenerate existing roots as part of a routine upgrade. `preflight` cannot compare remote secret values. [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

### 6.2 Password protection

After storing the password root on both Workers, refresh the dashboard. A link password needs 12–128 JavaScript string code units, at most 512 UTF-8 bytes, and no control characters. It is not trimmed; surrounding spaces are part of it.

In API updates, omit `password` to keep it, provide a string to replace it, or send `null` to remove it. Empty text is not a valid password or a universal “keep” command.

A permitted visitor sees the password page. A wrong password returns 401. A correct one sets a 900-second unlock cookie and resumes with a same-origin GET. The password body stays on the short-link site. Store the root secret separately from backups: the database contains a verifier, not recoverable plaintext.

### 6.3 KV route caching

Leave `redirect_cache_namespace_id` empty to use D1 directly. To enable KV, create a namespace:

```bash
npx wrangler kv namespace create REDIRECT_CACHE --config apps/redirect/wrangler.jsonc
```

Put the returned ID in private `deployment.json`, then regenerate, review, check, and deploy both Worker configurations. Both must bind the same `REDIRECT_CACHE`. Existing installations should reuse their namespace.

`redirect_cache_ttl` defaults to 300 seconds. Per-link `kv_cache_ttl` is `null` to inherit, 0 to bypass, or 60–86400 to override. This is different from `cache_ttl`, which controls allowed private browser caching.

Only eligible ordinary redirects use KV. Passwords, active global browser collection, per-link VPN checks, finite limits, expiry, geographic rules, text mode, disabled/missing links, and explicit opt-outs bypass it. A KV hit still requires current D1 authorization. A hot in-instance snapshot can reduce repeated KV access; a cold instance adds KV I/O and revalidation. Therefore KV does not automatically make every workload cheaper or faster.

Refill attempts are suppressed for unchanged versions within a bounded Worker instance for their TTL, including failed attempts. This is not an account-wide write cap. As a simple budgeting example, one continuously active link refreshed every 300 seconds would imply 288 refills/day in a single-refill model; at 3600 seconds, 24. Real edge instances and propagation can add writes. Measure KV operations, D1 `rows_read`, and latency separately. [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

### 6.4 Analytics and daily archives

Set `analytics_enabled: true` only when you want event statistics. The Redirect Worker gets the `ANALYTICS` writer binding; the Admin Worker queries the same account and dataset with a private token granting **Account → Account Analytics → Read**:

```bash
npx wrangler secret put ANALYTICS_API_TOKEN --config apps/admin/wrangler.jsonc
```

Review the generated configurations and deploy them. To verify only the SQL credential, provide `CLOUDFLARE_ACCOUNT_ID` and `ANALYTICS_API_TOKEN` through a private process environment and run:

```bash
node scripts/verify-analytics-token.mjs
```

It runs a bounded read-only `SELECT 1`, without printing the token. Success does not prove the dataset has events. Do not place the credential in a command argument or tracked file. [Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)

A successful final business GET records a click; HEAD, password pages, browser pages, and intermediate verification responses do not. Policy rejections have separate counters. Counts are sampled weighted estimates, not unique people. Events omit raw IPs, full user agents, target URLs, text bodies, cookies, and passwords; referrers are reduced to hostnames.

The dashboard uses one AE query. Full statistics use eight queries, at most two concurrently, within a shared ten-second deadline. Completed results may be reused for 15 seconds within one instance; permissions and selected-link existence are still checked. Frequent full-dashboard polling is unnecessary work.

Daily archiving runs only when analytics and `analytics_rollup_enabled` are both on. Cron defaults to every 15 minutes; supported intervals are 5, 15, 30, 60, 360, and 1440 minutes. It initially archives the two most recent complete UTC days, processes up to 400 link/day groups per batch, saves progress, and catches up from the completed watermark. A completed window is normally rechecked after six hours; unchanged estimates do not rewrite daily rows.

The D1 archive keeps daily click totals, not all live country/timezone/device dimensions. Disabling analytics leaves old archive rows readable. To inspect growth or choose retention periods, see [Retention](RETENTION.en-US.md). `available:false` and a query failure are different from zero clicks.

### 6.5 Browser timezone collection and VPN checks

Global collection defaults off. Its effective public flow needs `browser_timezone_enabled: true`, Analytics enabled, a working writer binding, and a valid browser-check root. An individual link's `block_vpn` runs independently of the global collection switch.

| Global collection | Per-link `block_vpn` | Result |
| --- | --- | --- |
| Off | Off | Direct ordinary handling, with other configured protections still active |
| On | Off | Collect timezone only when Analytics/writer prerequisites exist; mismatch or unknown does not itself deny access |
| Off | On | Still enforce the link's browser/network policy |
| On | On | Collect and enforce the link's browser/network policy |

Before enabling `block_vpn`, give Redirect a read-only Radar token with **Account → Radar → Read**:

```bash
npx wrangler secret put RADAR_API_TOKEN --config apps/redirect/wrangler.jsonc
```

The Worker checks Tor and the visitor ASN before the password page; only ASNs in the Radar categories `ACCESS_ISP` and `ORGANIZATION` proceed. Classification lookups have bounded caching, concurrency sharing, and failure cooldowns. A browser challenge sends one same-origin RTT probe and compares its elapsed time with the platform TCP/QUIC RTT; a difference above 50 ms denies access. Missing/unverifiable RTT also denies it. [Radar setup](https://developers.cloudflare.com/radar/get-started/first-request/)

The browser reports `Intl.DateTimeFormat().resolvedOptions().timeZone`. The server compares normalized timezone identifiers with `request.cf.timezone`, not just today's UTC offset. `request.cf.country === 'T1'` is the Tor signal. Self-reported timezone is untrusted. Travel, system settings, shared networks, device load, and geolocation mistakes can cause false positives. Unknown timezone is not proof of VPN use, but `block_vpn` rejects it.

A check page leads to a same-origin POST, a short-lived proof cookie, and a fresh GET with current D1 checks. Proof expires within the original 120-second challenge window. There is no server-side one-use consumption table; do not describe it as absolutely replay-proof. JavaScript/cookies are needed for the intended flow. HEAD skips collection-only JavaScript, but a VPN-protected HEAD without valid proof returns 403.

Browser checking adds requests and latency. Use it where its policy is useful, not simply because it is available. A pre-challenge network denial returns a 403 result page and sends no RTT probe.

### 6.6 Device headers and rate limits

Device type defaults to `none`. Turn on `cloudflare_device_type_enabled` only when your platform configuration reliably generates and overwrites `CF-Device-Type`. The mapping is mobile/tablet → `mobile`, desktop → `pc`, otherwise `none`. A visitor-supplied header is not trustworthy device detection.

Rate limits use application-defined keys per Cloudflare location, not strict global or daily quotas. Password attempts default to five per hashed-IP key per 60 seconds; shared exits can share a bucket. Keep all four namespaces distinct, including from other installations. A separately reviewed WAF rule for password POSTs can supplement the application limiter, subject to your account's features and cost; the project does not create WAF rules.

<a id="backup"></a>
<a id="upgrade"></a>
<a id="backup-and-upgrade"></a>

## 7. Back up, upgrade, and recover

### 7.1 Keep a recoverable set

A full recovery set includes matching source and lockfile, D1 SQL export, private deployment/Worker configuration, active version IDs/traffic/bindings/triggers, and root secrets stored separately. A D1 export contains users, business data, token hashes, password verifiers, audits, and D1 archive rows. It does not contain Worker secrets or raw Analytics Engine events. KV is rebuildable cache.

After confirming the account and database, use a fresh private output filename:

```bash
npx wrangler d1 export DB --remote --config apps/admin/wrangler.jsonc --output Linro-backup-before-change.sql
```

`npm run backup` is a shorter wrapper with the fixed output name `Linro-backup.sql`; preserve an older backup before using that name again. Export can affect database availability while it runs, so schedule appropriately. Encrypt/protect the backup and practice restoring it. [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

### 7.2 Upgrade an existing instance

Keep the old working copy available. Merge the new source into a separate working directory with your reviewed private settings. Preserve both Worker names, the account and D1 IDs, hostnames, Access settings, optional resource bindings, dataset, and existing root secrets. Do not replace them with public templates.

Check all six migrations against the actual database. If all are already applied, this v1.0.2 patch needs no additional migration. Otherwise back up and apply pending migrations with the normal commands. Re-run checks, build, regular/runtime/browser tests, and dry run. `npm run deploy` does not create or migrate D1.

For a normal reviewed deployment, use `npm run deploy` and verify both active Workers. Operators who need a separate upload/review/traffic-switch step can use Wrangler versions:

```bash
npx wrangler versions upload --config apps/admin/wrangler.jsonc --keep-vars --tag v1.0.2
npx wrangler versions upload --config apps/redirect/wrangler.jsonc --keep-vars --tag v1.0.2
```

Record each returned version UUID and compare its resources. `--keep-vars` is not lossless preservation of every setting; review explicit vars, bindings, assets, and runtime options. Uploading alone does not switch traffic. After review, use the matching IDs:

```bash
npx wrangler versions deploy YOUR_REDIRECT_VERSION_UUID@100 --config apps/redirect/wrangler.jsonc
npx wrangler versions deploy YOUR_ADMIN_VERSION_UUID@100 --config apps/admin/wrangler.jsonc
```

Answer Wrangler's prompts only after checking the target. The two switches are separate. A version-based code update does not by itself reconcile every hostname or Cron change; use the appropriate reviewed deployment workflow when intentionally changing those settings. Do not run trigger synchronization merely as a routine code-upgrade step. [Wrangler Worker commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)

Afterward, check public HTTPS health on every host, Owner/D1 health, ordinary redirects, roles, and any enabled password/browser/analytics flows. v1.0.1 API paths, token hashes, cookies, KV keys, and CSV markers stay compatible in v1.0.2.

### 7.3 Restore or roll back deliberately

Test SQL backups in a new isolated SQLite file or recovery D1 database before touching production. Validate tables, counts, foreign keys, migrations, rule triggers, and password capability with the matching root secrets. The SQL export may already contain schema and migration records; inspect it before adding a separate initialization step.

A code rollback routes traffic to a prior compatible Worker version. It does not undo database changes or secret rotation. Never overwrite new business data merely to roll back code. A missing password-root secret cannot be reconstructed from stored verifiers; keep secure copies before an incident.

Use the [read-only retention report](RETENTION.en-US.md) to measure audit/archive/token growth. Generated cleanup SQL is for review and a controlled maintenance action, not an automatic background job.

<a id="troubleshooting"></a>

## 8. Troubleshoot one layer at a time

| What you see | First useful check |
| --- | --- |
| Local dashboard asks for a token | Use the private token printed by `local:init`; keep both local processes running |
| API returns HTML or 302 instead of JSON | Access login/service policy and whether the client followed redirects |
| Access allows login but Linro returns 403 | User is registered/enabled and the Access subject still matches |
| First Owner is not created | Correct bootstrap email and an actually empty users table; do not clear existing users |
| Public health works but a link is 404 | D1 domain record, exact slug case, enabled flags, and expiry |
| An Owner's application token cannot edit another person's link | All token writes are user-owned; use an appropriate interactive session |
| A save returns 409 | Reload the current version and compare changes |
| Passwords stop working after an update | Original password-root secret and stored verifiers were preserved |
| Browser check repeats or rejects visitors | Cookie/JavaScript availability, challenge expiry, changed rules/network, Radar/RTT/timezone policy |
| KV is enabled but D1 reads remain | Expected: D1 guards every authorization; measure before changing caching |
| Statistics are unavailable, empty, or erroring | Distinguish disabled/incomplete setup, actual no-event data, and provider failures |
| Archive lacks today's data or detailed dimensions | It stores complete-day totals, not live dimension breakdowns |
| Domain deletion returns `in_use` | Move/delete its links first |
| Deploy produced a version but health fails | Custom Domain, DNS, TLS/SNI, bindings, and expected version; rerun verification after correction |

For a focused read-only health check:

```bash
npm run verify:deployment -- --url https://go.example.com/health --expected-version 1.0.2
npm run verify:deployment -- --url https://go.example.com/health --family 4
```

Use `--family 6` only from a machine with IPv6 connectivity. The default probe makes at most 12 rounds, waits five seconds between rounds, and times out each request after ten seconds. Normally it needs two consecutive healthy rounds. It keeps HTTPS certificate validation enabled and does not follow redirects or redeploy.

A dedicated unprotected test link can use the redirect smoke tool:

```bash
node scripts/smoke.mjs --short-url https://go.example.com/docs --expected-location https://example.org/docs --code 301
```

Create that dedicated fixture with the matching status/target, no password/VPN/limit, and browser cache 0. Global timezone collection changes its GET into a check page; test that flow with a real browser instead of weakening production protection to satisfy a direct-redirect test.

When reporting problems, include version, redacted request ID, HTTP status, and the failed step. Keep Authorization headers, Access JWTs, cookies, form passwords, SQL dumps, and real account snapshots private. Detailed codes are in the [API error reference](API.en-US.md#errors).

## Appendix: commands at a glance

| Command | Purpose | Cloud effect |
| --- | --- | --- |
| `npm ci` | Install the locked dependency tree | Downloads dependencies; no application deployment |
| `npm run configure` | Generate both local Worker configs | None |
| `npm run preflight` | Validate local deployment configuration | None |
| `npm run check` | Type-check Workers, dashboard, and demo | None |
| `npm run build` | Type-check, compile Workers, build dashboard | None |
| `npm test` | Compile Workers and run ordinary tests | None |
| `npm run test:runtime` | Pinned native workerd canary and regressions | None |
| `npm run test:browser` | Real-browser regressions | None |
| `npm run test:disconnect` | Loopback disconnect regression on Linux/WSL | None |
| `npm run build:demo` | Regenerate static demo | None |
| `npm run build:docs` | Regenerate offline HTML from Markdown | None |
| `npm run db:migrate:local` | Apply local migrations | None |
| `npm run db:migrate` | Preflight and apply remote D1 migrations | Database write |
| `npm run deploy:dry-run` | Package both Workers | No production traffic switch |
| `npm run deploy` | Check/build/test/runtime/deploy both Workers/verify | Changes live services |
| `npm run verify:deployment` | Read public health/status/version | Read-only network requests |
| `npm run backup` | Export remote D1 to `Linro-backup.sql` | Reads production data |
| `npm run audit:links -- --input PRIVATE_EXPORT.json --config deployment.json` | Inspect private link export for policy problems | None; does not modify links |
| `npm run retention -- --database PRIVATE_SNAPSHOT.sqlite` | Read-only snapshot capacity/retention report | None |
| `npm run package:source` | Stage public source and its manifest | None |

For reproducible public packaging, use [Release](RELEASE.en-US.md). For precise request and field contracts, use [API](API.en-US.md). Both are maintained alongside this guide for the same release.
