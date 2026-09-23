# Linro v1.0.1 Security Boundaries

[简体中文](SECURITY.md) · [README](../README.en-US.md) · [Complete guide](GUIDE.en-US.md)

## Administration and trust

Production requires HTTPS, the correct admin host, and a verified Cloudflare Access JWT, including signature, issuer, audience, and time constraints. Static admin assets also pass authentication. Interactive writes require strict same-origin checks and `X-Linro-CSRF: 1`; the narrow public password-form origin exception does not relax admin CSRF.

Automation requires both Access and an application token. Roles and scopes are checked on each request; every token can write only links created by its owning user. Read-only workspace members can see targets and plain-text content. This is not tenant isolation or confidential document storage.

D1 is authoritative for current authorization. KV contains allowlisted routing fields, not password verifiers, text bodies, counters, or root secrets, and every hit still needs a D1 guard. A D1 failure cannot authorize stale-cache access.

Production deployments must pass `preflight` with all required rate-limit bindings. The current Admin entry point invokes its pre-authentication limiter only when `AUTH_LIMITER` exists; bypassing preflight and manually removing it does not automatically make every admin request return 503. This is not permission to omit the binding. Authentication and write-rate checks have their own independent behavior.

## Public access

Password verification uses an independent root secret, an HMAC pepper, random salts, and PBKDF2-SHA256. Keep `LINK_PASSWORD_SECRET` identical on both Workers; do not regenerate it during upgrades. A successful password POST returns to the same-origin short code and never forwards the password body to the target.

Browser timezone is untrusted client input; IP timezone and Tor signals use platform metadata. Travel, system settings, and geolocation errors can cause false positives. `block_vpn` rejects unknown timezones too, and disabling global collection does not disable a per-link policy. The 120-second challenge/proof is not consumed in a server-side one-time store; do not claim absolute replay prevention within the same valid context.

Finite counts measure server-authorized requests, not people; an authorized HEAD also uses a slot. A committed D1 update followed by a lost response can conservatively consume a slot without automatic refund. The server cannot recall redirects already cached by visitors.

Worker rate limits count code-defined keys at platform locations, not connections or a strict global quota. The password bucket uses an IP hash and defaults to five calls per 60 seconds. Shared exits can share a bucket; use independent namespaces for separate instances. WAF protection supplements, not replaces, application authentication and validation.

Targets must be validated HTTP(S) URLs. Private/local hosts and managed short-link loops are rejected by default, but validation **does not resolve DNS** and is not complete DNS-rebinding protection. `source_url` format validation likewise does not establish actual reachability.

## Privacy before publication

Do not commit `deployment.json`, generated real Wrangler settings, `.env*`, `.dev.vars*`, `.local/`, databases, SQL backups, authentication responses, logs, cookies, or keys. Inspect Markdown, hidden HTML content, examples, attachments, and screenshots. `.gitignore` does not remove prior commits, and release exclusion rules are not a general secret scanner.

Documentation uses `example.com`, `example.net`, `example.org`, explicit resource placeholders, and local loopback addresses. Retained upstream links and license attribution are not test-machine information. If a real credential was exposed, revoke or rotate it and assess access records before addressing affected history; removing the current file does not revoke a secret.

<a id="reporting"></a>
## Reporting a security issue

Do not post usable credentials, private hostname snapshots, or business data in public issues. Use a private reporting channel actually enabled by the repository. If none is enabled, ask the maintainer for a private channel without guessing an email address. Include the version, impact, and a minimal redacted reproduction, and test only instances you are authorized to assess.

These statements describe implementation boundaries. They are not a guarantee of no vulnerabilities, a completed penetration test, or a compliance certification.
