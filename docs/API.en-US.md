# Linro v1.0.2 API reference

[简体中文](API.md) · [Setup and usage](GUIDE.en-US.md) · [Security](SECURITY.en-US.md)

An API is the dashboard's set of buttons for programs. A **path** chooses the button, an HTTP **method** chooses read/create/change/delete, and a JSON **body** supplies its fields. This reference describes all **25 admin method/path combinations** in v1.0.2, plus the public visitor flow.

Start with authentication and a read-only `/session` call. Then use the endpoint and field tables for your integration. All example domains, email addresses, UUIDs, and records are fictional. Replace IDs with values returned by your own instance; never use documentation examples as credentials.

<a id="conventions"></a>

## 1. Make a valid admin request

### 1.1 Base address and authentication

The example base address is:

```text
https://admin.example.com/Linro/v1
```

All admin paths below are relative to that base. Casing matters. `/Linro/v1` itself is not an index, and an extra trailing slash is not automatically normalized. Unknown method/path combinations return 404 `api_not_found`.

Production authentication has two layers:

1. **Cloudflare Access** admits the identity to the admin hostname. The Worker verifies its Access JWT.
2. **Linro** checks an enabled user and that user's permissions. An automated client supplies a Linro application token as well as Access service credentials.

| Header | When to use it |
| --- | --- |
| `Accept: application/json` | Recommended for admin requests; an Access login page is still not a successful JSON response |
| `Content-Type: application/json` | Required when sending an admin JSON body; `charset=utf-8` is accepted |
| `CF-Access-Client-Id`, `CF-Access-Client-Secret` | A server-side client's Access service credentials |
| `Authorization: Bearer Linro_…` | The complete Linro token returned when it was created |
| `Cf-Access-Jwt-Assertion` | Valid JWT supplied after Access authentication; do not invent one |
| `Origin` | Interactive writes require the exact admin origin; the browser normally supplies it |
| `X-Linro-CSRF: 1` | Required for interactive Access writes, not reads |
| `X-Linro-Dev` | Restricted local loopback development only |

Interactive Access writes also reject `Sec-Fetch-Site: cross-site`. Explicit bearer/local-development credentials use a different CSRF path, but **every admin API request rejects a supplied Origin that differs from `ADMIN_ORIGIN`**, including empty or literal `null` values. A server-side client can omit Origin.

The API does not provide permissive cross-origin CORS, a public OPTIONS preflight contract, or JSONP. Keep automation credentials on a trusted server. A malformed Authorization header selects the token branch and fails; it does not fall back to the browser's human login. Interactive-only routes therefore need the ordinary signed-in session without an application token attached.

### 1.2 Responses and errors

A successful response wraps the endpoint result in `data`:

```json
{"ok":true,"data":{"deleted":true}}
```

An error uses this shape:

```json
{"ok":false,"error":{"code":"version_conflict","message":"This item changed. Refresh before saving again.","request_id":"example-request-id"}}
```

Resource creation/import normally returns 201; other successful admin operations return 200. `data` may be an object or an array. Branch on HTTP status and `error.code`, not the English wording of `message`.

Admin API responses use `Cache-Control: no-store`. Wrapped responses include `X-Request-Id` and the Worker's security headers; HTTPS responses include HSTS. Application rate limits return 429 with `Retry-After: 60`. Access/platform failures handled before Linro can instead be HTML or redirects with no Linro envelope. Check status and `Content-Type` before parsing JSON.

### 1.3 Bodies, types, and edit versions

Admin JSON bodies are limited to **262,144 actual streamed bytes**. The root must be a valid UTF-8 object, not an array or `null`. Undeclared fields in normal top-level write bodies are rejected. Bulk item objects are not a strict unknown-field boundary; send only their documented fields. Use JSON numbers for numeric fields; `"302"` is different from `302`.

Business booleans generally accept `true`, `false`, `1`, or `0`; `reset_redirect_count` accepts only a boolean. Most length limits count JavaScript UTF-16 code units. Password and text fields also have separate UTF-8 byte limits.

Timestamps such as `created_at`, `updated_at`, `expires_at`, and `revoked_at` use Unix **seconds**. Export `exported_at` is ISO text; archive `date` is a UTC `YYYY-MM-DD` string.

Think of `version` as the revision number on a shared document. Link/domain/user PATCH requires the current positive integer version; link/domain DELETE uses `?version=…`. A stale revision returns 409. Settings have no version and use last-write-wins. Token revocation has no version. Public visit counters and `rule_revision` are separate from the admin edit version.

There is no `Idempotency-Key` implementation. A timed-out POST may already have committed. Before retrying a write, query its expected business record and reconcile the outcome.

### 1.4 Pagination

`/links`, `/audit`, and `/stats/archive` support two modes:

| Mode | Request | Response fields |
| --- | --- | --- |
| Page, the default | `page=1&limit=25` | `items`, `page`, `limit`; exact count depends on endpoint |
| Cursor | `pagination=cursor&limit=25` | `items`, `limit`, `next_cursor`; send that cursor for the next page |

`page` defaults to 1 and is 1–100000; `limit` defaults to 25 and is 1–100. A supplied cursor is at most 512 code units. Cursor mode must not include `page`; page mode must not include `cursor`. An invalid mode/mix returns `invalid_pagination`, and malformed cursor data returns `invalid_cursor`. Treat returned cursors as opaque strings and keep the same filters while continuing. A null `next_cursor` means no further page was found. Lists are not transaction snapshots.

For `/links`, `include_total=true|false` controls an exact count in either mode; its default is true for page mode and false for cursor mode. `/audit` includes `total` only in page mode. `/stats/archive` never includes `total`. Domains/users/tokens/settings return arrays without these paging fields.

### 1.5 Three different health checks

| Address | Authentication | What it checks |
| --- | --- | --- |
| Admin `/health`, GET/HEAD | Required | Admin shallow status/version |
| Admin `/Linro/v1/system/health`, GET | Owner-level permission | Worker and D1 `SELECT 1`; analytics configuration only |
| Public Redirect `/health`, GET/HEAD | Public, still rate limited | Redirect shallow status/version, not D1 |

HEAD is not automatically mapped to GET for admin API routes. For example, `HEAD /Linro/v1/links` can return 404 even though GET exists.

<a id="models"></a>

## 2. Fields and returned objects

### 2.1 Link write fields

POST `/links` and each entry in POST `/links/import` accept the following **17 fields**. PATCH `/links/{id}` also accepts `version` and `reset_redirect_count`.

| Field | Type and limit | Creation / update behavior |
| --- | --- | --- |
| `domain_id` | String, maximum 36 code units; existing domain ID | Required on create; a disabled domain can hold links, but they will not serve publicly |
| `slug` | 1–64 ASCII letters, digits, `_`, `-` | Omit or send empty on create for an eight-character random code; an empty PATCH slug is invalid |
| `target_url` | Absolute HTTP(S), raw and final normalized URL each within 4096 code units | Required for redirect mode; unused in text mode |
| `title` | String, maximum 200 | Default empty; omitted PATCH preserves it |
| `description` | String, maximum 2000; ordinary multiline text allowed | Default empty; omitted PATCH preserves it |
| `redirect_code` | Numeric 301, 302, 307, or 308 | Defaults to the selected domain's default; omission on update preserves it |
| `query_mode` | `discard`, `merge`, or `replace` | Default discard; text mode forces discard |
| `enabled` | Boolean or 0/1 | Default 1; read objects use 0/1 |
| `expires_at` | Unix-second integer 1–253402300799, or null | Default null; null means no expiry, and past times are accepted as expired |
| `cache_ttl` | Integer 0–3600 seconds | Default 0; private browser caching, not KV TTL |
| `kv_cache_ttl` | null, 0, or integer 60–86400 seconds | Null inherits global TTL; 0 bypasses KV; omitted PATCH preserves; protected links bypass regardless |
| `geo_rules` | 0–32 rules, maximum 65536 serialized code units | Default empty; omit to preserve, `[]` to clear |
| `password` | null or string of 12–128 code units, at most 512 UTF-8 bytes, no control characters, including TAB/CR/LF | Omit for no password on create / preserve on update; string sets it; null removes it |
| `max_redirects` | null or integer 1–1000000000 | Null is unlimited; changing the limit does not reset the count |
| `response_mode` | `redirect` or `text` | Default redirect; the other fields must satisfy the selected mode |
| `text_content` | String, 1–16384 code units and at most 32768 UTF-8 bytes | Required in text mode; normalized to empty in redirect mode |
| `block_vpn` | Boolean or 0/1 | Default 0; enabling a new policy requires a valid browser-check root secret |

For PATCH, `version` is required. `reset_redirect_count: true` resets the finite-request counter; omitted/false leaves it unchanged. Do not treat `null` as a general “keep existing value” instruction.

Only `health`, `cdn-cgi`, and the `__linro_` prefix are reserved as slugs, ignoring case. `Linro`, `admin`, and `api` are valid business slugs on the separate public host. Dotted names such as `robots.txt` fail the normal slug syntax.

Target validation rejects credentials, whitespace/control characters, backslashes, non-HTTP(S) schemes, forbidden local/private targets, the admin hostname, and registered short-link hosts. It does not fetch the target or resolve DNS. Sensitive authentication/reset/redirect destinations require `query_mode=discard`.

Query behavior is exact: discard retains the saved target query; merge adds only allowed visitor keys absent from the target; replace clears the complete saved query and inserts only allowed visitor keys, even if the result is empty. Internal `_Linro_check` and `_Linro_lang` are never forwarded. A combined final URL over 8192 code units is rejected.

Passwords are not trimmed. Text allows TAB/CR/LF but rejects restricted controls and invalid Unicode round-trips. Text mode cannot retain geographic rules and is never interpreted as HTML.

### 2.2 Geographic rules

```json
[
  {"kind":"country","code":"JP","target_url":"https://example.org/ja/"},
  {"kind":"continent","code":"EU","target_url":"https://example.org/eu/"}
]
```

Each rule allows only `kind`, `code`, and `target_url`. Country codes use two uppercase letters and reject `XX`; this is format validation, not a full country-code lookup. Continent codes are `AF`, `AN`, `AS`, `EU`, `NA`, `OC`, `SA`. Duplicate `kind:code` pairs are rejected. Match order is **country → continent → default target**, regardless of array order. Every target follows the same security rules.

### 2.3 Link read object

The source calls this `PublicLink`, meaning a sanitized **admin** object, not an anonymous endpoint. It returns the link configuration without `password` or `password_hash`, plus:

| Field | Meaning |
| --- | --- |
| `id` | Link UUID |
| `hostname`, `short_url` | Public host and short address; production uses HTTPS |
| `password_protected` | Whether a password verifier exists |
| `created_by` | User UUID; legacy rows may be null |
| `created_at`, `updated_at` | Unix seconds |
| `version` | Admin edit revision |
| `rule_revision` | Policy/cache/proof revision; not a substitute for PATCH version |
| `redirect_count` | Authorized-request count for a link with a finite limit |
| `remaining_redirects` | Null if unlimited, otherwise `max(0, max_redirects - redirect_count)` |
| `domain_enabled` | Included by list queries; do not require it in every link response |

`enabled` and `block_vpn` are numeric 0/1. `geo_rules` is a parsed array. In text mode, `target_url` is empty; the internal database sentinel `about:blank` is not a redirect target.

Example fictional link:

```json
{
  "id":"22222222-2222-4222-8222-222222222222",
  "domain_id":"11111111-1111-4111-8111-111111111111",
  "hostname":"go.example.com",
  "slug":"welcome",
  "short_url":"https://go.example.com/welcome",
  "target_url":"https://example.org/start",
  "title":"Welcome",
  "description":"A fictional example",
  "redirect_code":302,
  "query_mode":"discard",
  "enabled":1,
  "expires_at":null,
  "cache_ttl":0,
  "kv_cache_ttl":null,
  "geo_rules":[],
  "password_protected":false,
  "max_redirects":null,
  "redirect_count":0,
  "remaining_redirects":null,
  "response_mode":"redirect",
  "text_content":"",
  "block_vpn":0,
  "created_by":"33333333-3333-4333-8333-333333333333",
  "created_at":1795219200,
  "updated_at":1795219200,
  "version":1,
  "rule_revision":1
}
```

### 2.4 Other read objects

| Object | Fields / special behavior |
| --- | --- |
| Domain | `id, hostname, name, enabled, default_redirect_code, created_at, updated_at, version`; full list adds `link_count` |
| User | `id, email, display_name, role, enabled, created_at, updated_at, version`; omits Access subject |
| Token list item | `id, name, prefix, scopes, expires_at, revoked_at, created_at`; `scopes` is a **JSON string**, requiring parsing |
| Token creation result | `id, token, name, scopes, expires_at, shown_once`; here `scopes` is an **array** and the full token appears only once |
| Setting | `key, value, updated_at`; internal archive settings can appear in the list |
| Audit | `id, user_id, actor_email, action, resource_type, resource_id, details, request_id, created_at`; `details` is a **JSON string** |
| DailyStat | `link_id, date, clicks, updated_at`; archive list adds `slug, hostname`; sampled weighted `clicks` may be non-integer |

Domain/user display names allow empty strings up to 100 code units. Token names require non-whitespace text up to 100; site name up to 80. Roles are lowercase `viewer`, `editor`, `admin`, `owner`. Token list items have no `last_used_at` field.

Audit URL query/fragment values are redacted; text is represented by length and passwords by protection state. An audit record is not a complete platform access log and cannot reconstruct a password or text body.

<a id="admin-endpoints"></a>

## 3. Admin endpoints

All results below describe the inner `data`, without repeating `{ "ok": true, "data": ... }`. Replace `{id}` with the resource UUID and omit braces.

### Endpoint map

| Method and path | Required scope | Interactive only? |
| --- | --- | --- |
| `GET /session` | Any authenticated session | No |
| `GET /summary` | `links:read` | No |
| `GET /links` | `links:read` | No |
| `POST /links` | `links:write` | No |
| `GET /links/{id}` | `links:read` | No |
| `PATCH /links/{id}` | `links:write` and ownership rule | No |
| `DELETE /links/{id}` | `links:delete` and ownership rule | No |
| `POST /links/import` | `links:write` | No |
| `POST /links/bulk` | `links:write` or `links:delete`, by action | No |
| `GET /domains` | `domains:read` | No |
| `POST /domains` | `domains:write` | Scope is not token-grantable |
| `PATCH /domains/{id}` | `domains:write` | Scope is not token-grantable |
| `DELETE /domains/{id}` | `domains:write` | Scope is not token-grantable |
| `GET /stats` | `analytics:read` | No |
| `GET /stats/archive` | `analytics:read` | No |
| `GET /users` | `users:write` | Yes |
| `POST /users` | `users:write` | Yes |
| `PATCH /users/{id}` | `users:write` | Yes |
| `GET /tokens` | Current user's own tokens | Yes |
| `POST /tokens` | Current user's grantable scopes | Yes |
| `DELETE /tokens/{id}` | Current user's own token | Yes |
| `GET /audit` | `audit:read` | Scope is not token-grantable |
| `GET /settings` | `settings:write` | Yes |
| `PATCH /settings` | `settings:write` | Yes |
| `GET /system/health` | `settings:write` | Scope is not token-grantable |

Interactive Admin/Owner sessions may write all links; Editors and **every application token** may write only links whose `created_by` matches their user. Reads remain workspace-wide. Full role rules are in the [guide](GUIDE.en-US.md#permissions).

### 3.1 GET /session

No parameters. Returns the current session, including:

- `user` as the User object, `scopes` as an array, and `auth_kind` as `access`, `token`, or `local`.
- `version: "1.0.2"`, `site_name`, `source_url`, and `analytics_configured`.
- `link_write_scope: "owned" | "workspace"`.
- `features` and `security`, illustrated below.

```json
{
  "features":{
    "browser_timezone_collection_enabled":false,
    "browser_checks_configured":true,
    "redirect_cache":false,
    "cache_consistency":"d1-guarded",
    "redirect_cache_default_ttl":300,
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

These values are illustrative. The collection flag reports the configured global/Analytics switches on Admin; the public flow additionally requires the Redirect writer. Configured secret flags validate local secret format, not equality between Workers. No root secret, Access credential, private-target allowlist, or token plaintext is included.

### 3.2 GET /summary

Requires `links:read`. No parameters. Example:

```json
{"links":6,"active":5,"expired":1,"domains":2}
```

Counts cover the shared workspace. Active requires enabled link/domain, unexpired time, and unexhausted quota. Expired is counted independently and may overlap other inactive states.

### 3.3 GET /links

Requires `links:read`. Supports the paging rules above and:

| Parameter | Rule |
| --- | --- |
| `q` | Substring search of slug/title/target; escaped SQL LIKE pattern including its two `%` delimiters must fit **50 UTF-8 bytes** |
| `domain_id` | Optional exact domain ID filter; an unknown ID normally yields an empty list |
| `status` | `all`, `active`, `disabled`, `expired`, or `exhausted` |
| `view` | `full` by default, or `picker` |
| `include_total` | Exact string `true` or `false`; defaults by paging mode |

Full items are Link read objects. Picker items contain only `id`, `hostname`, `slug`, reducing data and work for selection controls. Ordering is descending `created_at`, then descending `id`.

Page-mode example shape:

```json
{"items":[],"total":0,"page":1,"limit":25}
```

Cursor-mode example shape without a count:

```json
{"items":[],"limit":25,"next_cursor":null}
```

Use `pagination=cursor&limit=25&view=picker` for a lightweight first selection page. Pass `cursor` on the next call. Invalid search/filter/view/paging returns 400 with a corresponding code.

### 3.4 POST /links

Requires `links:write`. Uses the link write fields:

```json
{
  "domain_id":"11111111-1111-4111-8111-111111111111",
  "slug":"welcome",
  "target_url":"https://example.org/start",
  "title":"Welcome",
  "redirect_code":302,
  "query_mode":"discard",
  "cache_ttl":0,
  "kv_cache_ttl":null,
  "block_vpn":false
}
```

Returns **201** and the new Link read object. The server sets ownership to the authenticated user. A generated slug retries uniqueness conflicts up to five times; an explicitly conflicting slug returns 409 `conflict` without silently changing it. A missing domain returns 400 `domain_not_found`; missing protection prerequisites can return 503.

The business write and success audit commit together in D1. KV update success is not an authorization requirement for the write.

### 3.5 GET /links/{id}

Requires `links:read`. Returns one Link read object or 404 `not_found`. Any workspace reader can read it regardless of creator, without receiving its password verifier.

### 3.6 PATCH /links/{id}

Requires `links:write` and the ownership rule. Send the current `version` and only intended changes:

```json
{"version":1,"title":"Updated welcome page","target_url":"https://example.org/new"}
```

To remove a password, send `password: null`; to reset the finite count, send `reset_redirect_count: true`, each with the actual current version. Returns the updated Link object. Missing resource is 404, stale revision is 409 `version_conflict`, and forbidden ownership is 403 `link_owner_required`.

Changing domain/slug commits D1 before best-effort old-route KV invalidation. It is not a distributed D1/KV transaction. Fresh D1 guards still apply to stale snapshots, and already-issued browser responses cannot be recalled.

### 3.7 DELETE /links/{id}

Requires `links:delete`, ownership, and query `version`. No JSON body.

```http
DELETE /Linro/v1/links/22222222-2222-4222-8222-222222222222?version=1
```

Returns `{"deleted":true}`. Missing/stale/ownership failures use 404/409/403. Associated D1 daily archive rows cascade with the link; historical Analytics Engine events are not deleted by this route.

### 3.8 POST /links/import

Requires `links:write`. The only top-level field is `links`, containing **1–10** create-field objects:

```json
{
  "links":[
    {"domain_id":"11111111-1111-4111-8111-111111111111","slug":"intro","target_url":"https://example.org/intro","redirect_code":302},
    {"domain_id":"11111111-1111-4111-8111-111111111111","slug":"notice","response_mode":"text","text_content":"Maintenance completed.","geo_rules":[]}
  ]
}
```

Returns **201** with `{"imported":2,"ids":["…","…"]}`. The current request is atomic: validation/uniqueness failure prevents partial import within that request. Separate requests are separate commits. This is not a CSV or multipart upload route and does not restore exported read-only fields, users, counters, or settings.

The GUI handles larger files and protection markers before using this endpoint. A custom importer must not silently discard an exported `password_protected` marker and create an unprotected record.

### 3.9 POST /links/bulk

Action `enable` or `disable` requires `links:write`; `delete` requires `links:delete`. Each item also checks ownership. Only `action` and `items` are allowed. Items contain `id` and current `version`, with 1–10 entries and no duplicate ID.

```json
{"action":"disable","items":[{"id":"22222222-2222-4222-8222-222222222222","version":1}]}
```

Returns 200 with `results`. Each result has its ID and `ok`; failures can include `forbidden:true` or `conflict:true`. HTTP 200 means the request was processed, not that every item succeeded. Items do not share one all-or-nothing transaction. Invalid action/shape/duplicates fail before execution.

### 3.10 GET /domains

Requires `domains:read`. No pagination. Default `view=full` returns all Domain objects, including disabled ones, with `link_count`, ordered by hostname. `view=directory` returns only `id`, `hostname`, `enabled`, `default_redirect_code` and avoids per-domain link counts. Other views return 400 `invalid_view`.

There is no `GET /domains/{id}` route; select from the list.

### 3.11 POST /domains

Requires `domains:write`, available to interactive Admin/Owner roles rather than token scopes.

```json
{"hostname":"go.example.com","name":"Public links","enabled":true,"default_redirect_code":302}
```

Only those four fields are accepted. Hostname is required, limited to 253 code units, converted to lowercase, and must be a valid ASCII/punycode DNS hostname without scheme/port/path/trailing dot; normal production creation rejects IPv4 literals. `name` defaults empty, `enabled` to 1, and default redirect code to **301**.

Returns **201** with the Domain object. Duplicate hostname is 409 `conflict`; admin hostname is 400 `admin_hostname`. A hostname already used by a saved default/geographic destination returns 409 `hostname_is_destination`; migrate those targets first. This creates only a D1 record, not DNS or a Cloudflare Custom Domain.

### 3.12 PATCH /domains/{id}

Requires `domains:write`. Accepts `version`, `name`, `enabled`, and `default_redirect_code`:

```json
{"version":1,"name":"Public entry","enabled":true,"default_redirect_code":302}
```

Returns the updated Domain. Hostname is immutable; supplying it is an unknown-field error. Disabling the domain stops public serving for all its links. Changing its default code affects future link creation, not existing link codes. Missing/stale responses are 404/409.

### 3.13 DELETE /domains/{id}

Requires `domains:write` and query `version`; no body. Returns `{"deleted":true}`. A domain with links returns 409 `in_use`; move/delete those links first. This does not detach Cloudflare routing or DNS.

### 3.14 GET /stats

Requires `analytics:read`.

| Parameter | Rule |
| --- | --- |
| `days` | Integer 1–90, default 7; current rolling window grouped in UTC |
| `view` | `full` by default, or `dashboard`; one value only |
| `link_id` | One lowercase canonical UUID |
| `link_ids` | Comma-separated 1–50 lowercase canonical UUIDs |

Use either selector or neither, never both. Repeated selectors, empty values, trailing commas, malformed IDs, and more than 50 supplied items are rejected. Deduplication happens after the 50-item check. No selector means the whole workspace. An explicitly selected missing link returns 404 `stats_link_not_found` **before** configuration/cache checks; it never silently broadens the query. Send `days` once; the source uses the first value rather than rejecting duplicates.

If disabled/incomplete, the response is 200 with:

```json
{"available":false,"reason":"Analytics Engine is disabled or the Analytics Read secret is not configured.","sampled":true,"link_ids":null}
```

A successful dashboard view contains `available:true`, `sampled:true`, `timezone:"UTC"`, `days`, `link_ids`, `clicks`, and `timeline`. It uses one provider query. Full view additionally contains:

| Field | Shape / meaning |
| --- | --- |
| `timeline` | `[{date, clicks}]`; missing dates need not be zero-filled |
| `top` | Up to 50 `{link_id, hostname, slug, clicks}` rows |
| `countries` | Up to 20 `{country, clicks}` rows |
| `referrers` | Up to 20 `{referrer, clicks}` rows; hostnames only |
| `timezones` | `{timezone, clicks}` rows for browser-reported zones; missing is `none` |
| `ip_timezones` | `{timezone, clicks}` rows for Cloudflare IP geolocation |
| `devices` | `{device, clicks}` rows with `mobile`, `pc`, or `none` |
| `suspected_vpn_visits` | Estimated suspected terminal events |
| `suspected_vpn_successes` | Estimated successful visits among suspected events |
| `blocked_vpn_visits` | Estimated suspected-policy denials |
| `unknown_timezone_blocks` | Estimated missing/invalid-timezone denials |
| `unverifiable_blocks` | Estimated unverifiable ASN/timezone/latency denials, including unknown-timezone blocks |
| `unknown_timezone_successes` | Estimated successful events with unknown timezone |
| `tor_visits` | Estimated events carrying the platform Tor signal |
| `vpn_scope` | `terminal_successes_and_policy_denials_not_unique_users` |
| `success_scope` | `authorized_get_redirect_or_text` |
| `dimension_sources` | Describes the fields below |

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

`clicks` counts sampled weighted successful business GETs, not unique people. Final redirects and final text count; HEAD and intermediate pages do not. Browser-reported timezone remains untrusted even when included in statistics.

Full view runs eight queries in pairs, at most two at once, under one ten-second deadline. Completed results are cached for 15 seconds within an instance, capped at 16 selections; every caller still passes authentication and selected-ID checks. Provider HTTP/JSON/count failure returns 502 `analytics_query_failed`; deadline returns 504 `analytics_timeout`; caller cancellation can produce 408 `request_aborted` and stop later queries.

### 3.15 GET /stats/archive

Requires `analytics:read`. Supports page/cursor pagination and the same ID selection rules as `/stats`. It has **no `days` date filter** and no total count.

Page-mode example:

```json
{"items":[],"sampled":true,"page":1,"limit":25,"link_ids":null,"dimension_detail_available":false}
```

Cursor mode replaces `page` with `next_cursor`. Rows are ordered by descending `date`, then ascending `link_id`. Items are DailyStat objects for links that still exist. The archive contains D1 daily totals already written by rollup, not live country/device/timezone/VPN dimensions. It remains readable after Analytics is disabled and is not an automatic fallback for `/stats`.

### 3.16 GET /users

Requires `users:write` and an interactive session: effectively Owner. Returns User objects ordered by `created_at`, with no pagination and no Access subject. There is no single-user GET route. Owner-owned application tokens cannot call it.

### 3.17 POST /users

Requires interactive Owner.

```json
{"email":"editor@example.com","display_name":"Example editor","role":"editor"}
```

Accepts only `email`, `display_name`, `role`. Email is required, trimmed/lowercased, and limited to 254 code units. Name defaults empty, role defaults viewer, and the user starts enabled. `id`, `enabled`, `version`, and Access subject cannot be supplied.

Returns **201** with User. Duplicate email is 409 `conflict`; unsupported role is 400 `invalid_role`. It does not send an invitation or create an Access policy. The user must also pass Access.

### 3.18 PATCH /users/{id}

Requires interactive Owner. Accepts current `version`, `display_name`, `role`, `enabled`:

```json
{"version":1,"role":"viewer","enabled":false}
```

Returns updated User. Email and Access subject are immutable through this API. Removing/demoting the final enabled Owner returns 409 `last_owner`; stale revision is 409, missing user 404. There is no DELETE route. Disabling a user blocks their later login and token use without deleting their public links.

### 3.19 GET /tokens

Any interactive user may list their own tokens. No pagination; includes revoked records, ordered by descending creation time. Fields are the Token list item model above. The `prefix` is display-only; `scopes` is a JSON string. No full token, token hash, other-user identity, or last-used time is returned.

### 3.20 POST /tokens

Any interactive user may create a token with scopes their current role can grant:

```json
{"name":"Example read client","scopes":["links:read","domains:read"],"expires_at":1795824000}
```

The timestamp is a fictional structural example. Compute a future time for a real call, such as `Math.floor(Date.now()/1000) + 7*86400`. Allowed expiry is at least 60 seconds and at most 365 days ahead.

Only `name`, `scopes`, `expires_at` are allowed. Supply 1–5 scopes from `links:read`, `links:write`, `links:delete`, `domains:read`, `analytics:read`, limited by the user's role. Valid duplicates are removed; invalid/over-privileged scopes return 403 `invalid_scopes`. Fifty non-revoked records, including expired ones, cause 409 `token_limit`; revoke unused records first.

Returns **201** with `id`, full `token`, `name`, `scopes` array, `expires_at`, `shown_once:true`. Save the token immediately in private secret storage. It cannot be recovered from a later list; if lost, revoke and recreate it.

### 3.21 DELETE /tokens/{id}

Interactive user, own token only. No body/version. Returns `{"revoked":true}`. Already-revoked, missing, or someone else's tokens all return 404 `not_found`; repeated revocation is not an always-200 operation. A token cannot call this route to revoke itself.

### 3.22 GET /audit

Requires `audit:read`, available to interactive Admin/Owner roles rather than token scopes. Page mode returns `items`, exact `total`, `page`, `limit`. Cursor mode returns `items`, `limit`, `next_cursor` without a count query. Order is descending `created_at`, then descending `id`.

No server-side user/action/date filters are implemented. Parse each item's `details` JSON string if needed; sensitive fields have already been reduced/redacted.

### 3.23 GET /settings

Requires `settings:write` and interactive Owner. Returns all Setting objects sorted by key, including possible `analytics_rollup_…` internal records. Do not send the list back as a write body.

### 3.24 PATCH /settings

Requires interactive Owner. The only accepted field is:

```json
{"site_name":"Example team links"}
```

Returns the saved `site_name`. It must be non-whitespace text of 1–80 code units. There is no version; the last write wins. This route cannot change Access, bindings, feature switches, secrets, or Cloudflare resources.

### 3.25 GET /system/health

Requires `settings:write`, effectively Owner. It runs D1 `SELECT 1`, then returns:

```json
{"worker":"ok","database":"ok","analytics":"configured_not_probed","version":"1.0.2"}
```

When analytics is incomplete/off, that field is `disabled_or_incomplete`. `configured_not_probed` does not prove an Analytics SQL query succeeded. A D1 error does not return this success object; unmapped errors become 500 `internal_error`.

There are no unlisted PUT, user-delete, token-refresh, manual-rollup, ownership-transfer, single-domain GET, or bulk-export API routes in this release.

<a id="public-protocol"></a>

## 4. Public visitor requests

These paths use the **Redirect Worker's public hostname**, without `/Linro/v1`. An application token is not a password-unlock credential.

### 4.1 Route table

| Method | Path | Result |
| --- | --- | --- |
| GET/HEAD | `/` | Plain-text brand response, no link directory |
| GET/HEAD | `/health` | Raw JSON `{"status":"ok","version":"1.0.2"}`, no D1 probe |
| GET/HEAD | `/robots.txt` | `User-agent: *` / `Disallow: /`; crawler advice, not authorization |
| GET/HEAD | `/__Linro_assets/{fingerprinted-file}` | Current fingerprinted password CSS/JS and browser JS; immutable one-year caching |
| GET/HEAD | `/__Linro_assets/password.css`, `/__Linro_assets/password.js`, `/__Linro_assets/browser.js` | Current legacy asset content with `no-store` |
| GET/HEAD | `/{slug}` | Redirect, text, protection page, or denial according to current rules |
| POST | `/__Linro_unlock/{slug}` | Password verification |
| POST | `/__Linro_browser/{slug}` | Browser verification |
| POST | `/__Linro_rtt` | One authenticated encrypted latency receipt for a VPN challenge |

Internal POST routes reject other methods with 405 and `Allow: POST` before checking link existence. Normal public routes reject unsupported methods with `Allow: GET, HEAD`. The public rate limiter runs before health, assets, and business lookup; missing production binding/limiter failure can return 503.

### 4.2 Final responses and finite counts

A valid redirect returns its 301/302/307/308 and `Location`. A valid text link returns 200 `text/plain; charset=utf-8`, with no destination Location. Missing/disabled link or domain returns 404; expired uses configured 404/410; exhausted quota returns 403 without revealing the target.

The Worker checks current link/domain state, protection prerequisites, and remaining quota. For `block_vpn`, Tor/ASN policy precedes the password/browser flow. Final destination/rule validation and finite-quota authorization happen before serving the business response.

An authorized **HEAD consumes one finite slot just like GET**, but has no body and records no successful-click event. A HEAD of a password page does not unlock or consume quota. A VPN-protected HEAD without proof returns 403; collection-only HEAD can skip JavaScript.

Ordinary redirects can use `cache_ttl` for private client caching. Password, geographic, finite-limit, and browser flows use `no-store`; text always uses `no-store`. Do not override these with an outer Cache Everything rule. Already-issued cached redirects cannot be recalled.

### 4.3 Password POST

A GET without a valid password cookie receives a 200 password page when other policies permit. The form sends exactly one `password` to the same-origin unlock path using `application/x-www-form-urlencoded`, with a maximum body of 8192 bytes.

If `Sec-Fetch-Site` is supplied it must be `same-origin`. An explicit real Origin must match the full public origin. Missing Origin or literal `null` is accepted only with explicit `Sec-Fetch-Site: same-origin`. Contradictory foreign Origin is always rejected. These headers are browser-origin protection, not authentication of arbitrary HTTP clients; the password and current rules still apply.

Wrong password returns 401. Success sets a 900-second production `__Host-Linro_unlock_*` cookie with Secure, HttpOnly, Path=/, SameSite=Lax, bound to host/link/rule revision. The built-in script requests JSON, receives 200, and starts a fresh same-origin GET. A regular form gets 303 to that same short code. The password body is never forwarded to the destination.

The POST itself consumes no link quota and records no successful click. A link without a password rejects unlock POST with 405. Protected-rule/password changes invalidate cookies issued under the old revision.

### 4.4 Browser POST and latency probe

A GET may show the browser page when effective global collection is active or the link has `block_vpn`. Effective global collection needs both switches and the Redirect Analytics writer. A valid root secret is needed to issue/verify challenges.

The same-origin form sends `challenge` and `timezone` once each to `/__Linro_browser/{slug}`. For `block_vpn`, it also sends `latency`, a JSON string with numeric `elapsed` milliseconds and the Worker's authenticated encrypted `receipt` from one same-origin `/__Linro_rtt` probe. Form size is at most 4096 bytes, challenge 2200 code units, and timezone 64.

The RTT endpoint itself takes `application/x-www-form-urlencoded` with exactly one `challenge`, applies the same-origin check, and accepts at most 4096 body bytes. Success returns the authenticated encrypted receipt as text, not JSON. Its receipt is bound to the challenge.

Browser timezone comes from `Intl.DateTimeFormat().resolvedOptions().timeZone`; IP timezone comes from platform metadata. It is an untrusted client signal, not VPN or identity attestation. With VPN blocking, only ASNs classified as `ACCESS_ISP` or `ORGANIZATION` by Radar proceed; a browser/edge RTT difference above 50 ms, unknown timezones, or unverifiable data denies access. A pre-challenge denial sends no probe.

The `Accept` header changes only the **success representation**, not the form body or authorization:

| Accept | Success |
| --- | --- |
| Explicit `application/json` with valid `q > 0` | 200 JSON such as `{"ok":true,"data":{"next":"/welcome?_Linro_check=1"}}`, no Location |
| Wildcard, absent, or JSON `q=0` | 303 to the same-origin resume path |

Both forms set the short-lived proof cookie, `no-store`, and `Vary: Accept`; neither consumes quota or records a successful click. The POST never returns the final destination. Built-in JavaScript uses a fresh ordinary navigation so CSP `form-action 'self'` does not turn the eventual cross-site redirect into a blocked form chain. No-JavaScript completion is not guaranteed.

Challenge/proof lasts at most the original 120-second window and is bound to host, link/revision, query, and network context, including ASN for VPN policy. Resumption requires exactly one `_Linro_check=1` plus valid proof. Marker-only or cookie-only requests cannot skip the flow. The final response clears the proof cookie, but there is no server-side single-use consumption table: do not promise absolute replay prevention within a still-valid context.

Chinese/English switching preserves the password field or current check state. A blocked normal browser navigation receives a bilingual 403 result page; protocol clients may receive plain text. Read status and Content-Type rather than assuming all public errors are JSON.

### 4.5 Public status codes

| Status | Common meaning |
| --- | --- |
| 200 | Shallow health/assets/root, protection page, final text, or intermediate JSON success |
| 301/302/307/308 | Final redirect; does not establish that the target later succeeds |
| 303 | Same-origin resume after verification, not a final click |
| 400/415 | Invalid form/format/HTTPS requirement |
| 401 | Wrong password |
| 403 | Origin/policy/proof/quota denial |
| 404/410 | Missing, disabled, or expired |
| 405 | Unsupported method or inapplicable internal operation |
| 414 | Request or combined destination URL too long |
| 429 | Rate limited; inspect `Retry-After` |
| 503 | Database, secret, limiter, rule-data, or final-state failure |
| 508 | Direct redirect loop found at final validation |

<a id="examples"></a>

## 5. Small client examples

### 5.1 Bash: read your session

Use a private terminal or CI secret store to supply `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, and `LINRO_API_TOKEN`. Set your own origin. This example makes one read-only call and contains no usable credentials:

```bash
export LINRO_ADMIN_ORIGIN='https://admin.example.com'
: "${CF_ACCESS_CLIENT_ID:?Set the Access client ID privately}"
: "${CF_ACCESS_CLIENT_SECRET:?Set the Access client secret privately}"
: "${LINRO_API_TOKEN:?Set the full Linro token privately}"

curl --silent --show-error --fail-with-body --max-time 20 \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $LINRO_API_TOKEN" \
  -H 'Accept: application/json' \
  "$LINRO_ADMIN_ORIGIN/Linro/v1/session"
```

Do not add redirect-following `-L` to authenticated calls. `--fail-with-body` catches 4xx/5xx but an Access 302 can still exit successfully; inspect the HTTP result and verify a JSON `ok:true` response. Session output contains user metadata, so keep terminal transcripts private.

For creation, first GET `/domains` and choose the real domain ID. Save only the intended create fields from section 3.4 to a private `create-link.json`, then use the same headers with `-X POST`, `Content-Type: application/json`, and `--data-binary @create-link.json` at `/links`. This writes a real record. Do not retry a timeout blindly.

### 5.2 PowerShell: update one link with its current version

This example changes a title. Replace the hostname and link ID with a dedicated test record you may edit. Credentials remain in the private process environment.

```powershell
$ErrorActionPreference = 'Stop'
$Origin = 'https://admin.example.com'
foreach ($Name in 'CF_ACCESS_CLIENT_ID','CF_ACCESS_CLIENT_SECRET','LINRO_API_TOKEN') {
  if (-not [Environment]::GetEnvironmentVariable($Name)) { throw "Missing $Name" }
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
if ($Current.ok -ne $true -or -not $Current.data.version) { throw 'No valid link received.' }
$Body = @{ version = $Current.data.version; title = 'Updated example title' } | ConvertTo-Json -Compress
$Updated = Invoke-RestMethod -Uri $Uri -Headers $Headers -Method Patch `
  -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($Body)) `
  -MaximumRedirection 0 -TimeoutSec 20
$Updated.data | Select-Object id,slug,title,version
```

A concurrent edit can still produce 409 between the GET and PATCH. Reload and compare; do not automatically overwrite it.

### 5.3 Browser: call the API from your signed-in admin page

This small read-only example uses the current same-origin human session:

```javascript
const response = await fetch('/Linro/v1/session', {
  credentials: 'same-origin',
  redirect: 'manual',
  headers: { Accept: 'application/json' },
  signal: AbortSignal.timeout(20000)
});
if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
  throw new Error('Check your Access login and admin origin.');
}
const result = await response.json();
if (result.ok !== true) throw new Error(result.error?.code || 'Request failed');
console.log({ version: result.data.version, writeScope: result.data.link_write_scope });
```

For a deliberate interactive write, use its POST/PATCH/DELETE method, JSON body when required, and `X-Linro-CSRF: 1`; keep it on the admin origin. Do not attach a Linro bearer token to interactive-only user/token/settings calls. Prefer the dashboard for creating tokens so the one-time value can be saved directly and privately.

### 5.4 Node.js: bounded read-only client

Save this as `linro-read.mjs` outside the public release if it will hold private operational changes. With the same private environment variables and Node.js 22.16.0 or newer:

```javascript
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
async function main() {
  const origin = new URL(required('LINRO_ADMIN_ORIGIN'));
  if (origin.protocol !== 'https:' || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Use an HTTPS admin origin, without a path or credentials.');
  }
  const token = required('LINRO_API_TOKEN');
  if (!/^Linro_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid token format.');
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'CF-Access-Client-Id': required('CF_ACCESS_CLIENT_ID'),
    'CF-Access-Client-Secret': required('CF_ACCESS_CLIENT_SECRET')
  };
  async function get(path) {
    const response = await fetch(new URL(`/Linro/v1${path}`, origin), {
      headers, redirect: 'manual', signal: AbortSignal.timeout(20000)
    });
    const requestId = response.headers.get('x-request-id') || 'unavailable';
    if (response.status >= 300 && response.status < 400) throw new Error('Authentication redirect; not followed.');
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error(`Non-JSON HTTP ${response.status}; request_id=${requestId}`);
    }
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      throw new Error(`${result.error?.code || 'http_error'}; request_id=${requestId}`);
    }
    return result.data;
  }
  const session = await get('/session');
  const links = await get('/links?pagination=cursor&view=picker&limit=10');
  console.log({ version: session.version, displayed: links.items.length, hasMore: links.next_cursor !== null });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
```

This example does not follow authentication redirects, retry writes, or log targets, text bodies, or credentials. It demonstrates one page; continue with returned cursors only if your task requires more.

<a id="errors"></a>

## 6. Error reference

The first failed authentication/validation step usually determines the error. This table covers actionable admin codes; public form responses do not always use the same JSON envelope.

| HTTP | Code | What to check |
| --- | --- | --- |
| 400 | `invalid_json`, `empty_body` | A nonempty valid UTF-8 JSON object |
| 400 | `unknown_field` | Remove undeclared/read-only fields |
| 400 | `invalid_field` | Type, numeric range, required version, or string limit |
| 400 | `invalid_slug` | Syntax or reserved namespace |
| 400 | `invalid_url`, `invalid_hostname`, `invalid_email` | Use the relevant field's exact format |
| 400 | `invalid_code`, `invalid_query_mode` | Supported numeric status or query enum |
| 400 | `internal_target`, `private_target`, `redirect_chain` | Use an allowed final destination |
| 400 | `unsafe_query_mode` | Sensitive destinations require discard |
| 400 | `domain_not_found`, `admin_hostname` | Existing public domain, separate from admin |
| 400 | `invalid_geo_rules`, `duplicate_geo_rule` | Rule structure, count, code, uniqueness |
| 400 | `invalid_response_mode`, `invalid_text_content`, `text_geo_conflict` | Correct text/redirect fields and empty text-mode geo rules |
| 400 | `invalid_block_vpn`, `invalid_link_password` | Protection field type and bounds |
| 400 | `invalid_status`, `search_too_long` | List filter or final escaped 50-byte LIKE pattern |
| 400 | `invalid_view`, `invalid_stats_view` | Supported list/statistics view; one stats view value |
| 400 | `invalid_pagination`, `invalid_cursor` | Paging mode/mix and opaque cursor |
| 400 | `invalid_link_id` | Analytics selector syntax, count, repetition, or mixed forms |
| 400 | `invalid_import`, `invalid_batch`, `invalid_action`, `duplicate_item` | Batch shape/action/count/uniqueness |
| 400 | `invalid_role`, `invalid_name` | Role or nonblank name requirements |
| 400 | `https_required` | Production HTTPS origin |
| 401 | `access_required` | Access JWT missing |
| 401 | `invalid_access_token` | JWT signature, algorithm, issuer/audience, or time validation |
| 401 | `invalid_token` | Full Linro token, expiry/revocation, and enabled owner user |
| 401 | `local_token_required` | Local development token |
| 403 | `user_not_allowed`, `human_identity_required` | Enabled/bound human identity, or service client with Linro token |
| 403 | `forbidden`, `invalid_scopes` | Role/token permission and grantable scopes |
| 403 | `interactive_only` | Use the signed-in human session, not a token |
| 403 | `link_owner_required` | Editor/token writes are limited to its user-owned links |
| 403 | `cross_origin`, `csrf` | Exact admin Origin and interactive CSRF header |
| 404 | `not_found`, `api_not_found` | Resource ID or method/path |
| 404 | `stats_link_not_found` | Refresh the explicit analytics selection |
| 408 | `request_aborted` | Caller cancelled; request may no longer have a recipient |
| 409 | `conflict` | Duplicate slug/domain/email |
| 409 | `version_conflict` | Reload and compare before resubmitting |
| 409 | `in_use` | Referenced resource or domain still containing links |
| 409 | `last_owner` | Keep at least one enabled Owner |
| 409 | `token_limit` | Revoke unused non-revoked token records |
| 409 | `hostname_is_destination` | Migrate saved targets before registering that short-link host |
| 413 | `body_too_large` | Actual body size limit |
| 414 | `uri_too_long` | Request/combined destination length |
| 415 | `content_type` | Admin JSON versus public form content type |
| 421 | `wrong_host` | Request URL origin differs from configured admin origin |
| 429 | `rate_limited` | Respect Retry-After and distinguish confirmed pre-write rejection from uncertain writes |
| 500 | `internal_error` | Preserve a redacted request ID; investigate server-side failure |
| 502 | `analytics_query_failed` | Provider HTTP/JSON/count failure |
| 503 | `access_not_configured`, `access_keys_unavailable` | Access configuration or signing-key availability |
| 503 | `link_password_unconfigured`, `invalid_password_record` | Password root or stored verifier |
| 503 | `browser_check_unconfigured` | Browser root/configuration before enabling protection |
| 503 | `assets_missing`, `rate_limit_not_configured` | Dashboard build or production limiter bindings |
| 503 | `security_policy_invalid` | Deployment policy values/JSON |
| 503 | `analytics_not_configured` | Analytics query prerequisites |
| 504 | `analytics_timeout` | Shared provider deadline |

Public browser parsing can additionally return `browser_form_type`, `invalid_browser_form`, and other form-specific codes. Use the actual response and the corresponding module; never interpret an unknown error as success.

## 7. Implementation map

Routes/scopes are in `apps/admin/src/worker/api.ts`; each `*-api.ts` owns its resource handlers. Link fields are normalized in `link-fields.ts`; list paging is in `list-pagination.ts`, `link-list.ts`, `stats-archive.ts`, and `audit-api.ts`. Permissions are in `auth.ts`, statistics in `analytics*.ts`, and public flows in `apps/redirect/src/` plus shared password/browser/policy modules.

See [Documentation sources](SOURCES.en-US.md) for platform references and [Protocol identifiers](PROTOCOL-v1.0.2.en-US.md) for intentional version compatibility. The setup guide is the place for deployment instructions; this reference is the single maintained home of detailed API contracts.
