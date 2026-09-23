# Linro v1.0.1 API Reference

[简体中文](API.md) · [Complete guide](GUIDE.en-US.md) · [Permissions](GUIDE.en-US.md#permissions)

This reference retains chapters 09–13 and 16 from the complete guide and covers 25 admin method/path combinations. Deployment and role details in the guide are part of the same version contract.

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

Slug reserved words are rejected case-insensitively:`admin`, `api`, `linro`, `health`, `assets`, `robots`, `favicon`, `cdn-cgi`, `.well-known` and the `__linro_` prefix; values containing dots also fail ordinary slug syntax. Uniqueness for valid business slugs is case-sensitive.

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
