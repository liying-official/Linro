# Linro security: what each lock protects

[简体中文](SECURITY.md) · [README](../README.en-US.md) · [Guide](GUIDE.en-US.md)

This page describes **v1.0.2**. Think of security as several locks with different jobs: a dashboard login lock, permissions inside the dashboard, and optional locks on individual public links.

## The dashboard door

Production requires the correct HTTPS admin origin and a valid Cloudflare Access JWT. The Worker verifies the JWT's signature, issuer, audience, and time limits itself. Keep Access protection on the **whole admin hostname**, keep `workers_dev` and `preview_urls` disabled, and keep `assets.run_worker_first: true` so dashboard files also pass authentication.

A human must pass Access and be an enabled Linro user. Interactive writes require the exact same origin and `X-Linro-CSRF: 1`; cross-site browser writes are rejected. The narrow origin exception used by the public password form does not change admin CSRF rules.

An automated client needs both Access credentials and a Linro application token. Its effective permissions are checked against its user's current role on every request. Token writes are restricted to links created by that user, even if the user is an Owner. Two tokens owned by one user share that ownership boundary.

## What team members can see

Linro is a shared workspace. Every authorized reader can see team link targets, descriptions, and plain-text content. Public password protection does not hide those fields from dashboard members. Passwords and stored password verifiers are not returned by the normal GUI, API, or exports.

Editors can change their own links. Interactive Admins and Owners can maintain all links. Owners alone manage users and site settings. Disabling a user blocks later logins and token authentication, but does not automatically disable that user's existing public links. See the [role table](GUIDE.en-US.md#permissions).

## Passwords and browser checks

A link password is stored as a salted PBKDF2-SHA256 verifier with an HMAC pepper. The separate root secret, `LINK_PASSWORD_SECRET`, must match on both Workers. Preserve it during upgrades: replacing it affects verification of existing passwords. A successful unlock submits only to the short-link site and returns to the same-origin short code; it does not forward the password body to the destination.

Browser timezone is self-reported and can be changed by the visitor. IP timezone, ASN, and the Tor marker come from Cloudflare metadata. Per-link `block_vpn` requires Radar to classify the ASN as `ACCESS_ISP` or `ORGANIZATION` and requires an authenticated single-probe RTT check. Unknown or unverifiable information is denied under that policy. Travel, system settings, corporate networks, campus networks, geolocation mistakes, and network delays can all cause legitimate visitors to be rejected. This is a heuristic access policy, not proof of a person's identity or reliable proof of VPN use.

Challenges and proofs last at most 120 seconds and are bound to the link rules, host, query, and network context. The final response clears the proof cookie. There is no server-side single-consumption table, so the valid context must not be described as absolutely replay-proof. Turning off global timezone collection does not turn off `block_vpn` on an individual link.

## Database, cache, and counters

D1 decides whether a request is authorized now. KV stores an allowlist of ordinary routing fields; it does not store password verifiers, text bodies, counters, or root secrets. Every cache hit still needs a D1 guard. If D1 fails, an old cache entry cannot grant access.

A finite link limit counts server-authorized GET and HEAD requests, not people. A database update followed by a lost response can consume a slot without an automatic refund. Browser-cached redirects that were already issued cannot be recalled by changing a link later.

Worker rate limits are best-effort counters for the code's chosen keys at Cloudflare locations. They are not strict global quotas or connection counters. Password attempts use a hashed-IP key, defaulting to five calls per 60 seconds; people sharing an exit address can share that bucket. Use distinct namespaces for separate installations.

`preflight` requires the expected rate-limit bindings. Manually removing `AUTH_LIMITER` does not guarantee every admin request will fail closed: the Admin entry point invokes that limiter only when it exists. Preserve the generated configuration and independent authentication checks. WAF rules can provide another layer, but cannot replace application permissions or validation.

## Destination rules

Targets must be validated HTTP(S) URLs. Credentials in URLs, unapproved local/private targets, the admin host, and registered short-link domains are rejected. Only reviewed query keys may be forwarded. The code does **not** resolve DNS while validating destinations, so hostname checks alone are not complete DNS-rebinding protection. A valid `source_url` is also not proof that its website is reachable or complete.

## Keep private material out of a public repository

Keep these in private storage: real `deployment.json` and generated account-specific Wrangler files; `.env*`, `.dev.vars*`, `.local/`, `.wrangler/`; database files and SQL backups; tokens, cookies, authentication responses, private keys, logs, and screenshots containing user data.

Review source comments, tests, Markdown, examples, offline HTML, and generated demo assets as well as obvious configuration files. `.gitignore` does not erase old commits. Packaging exclusions reduce accidental inclusion but are not a general secret scanner. Public documentation uses reserved example addresses, loopback addresses for local development, and explicit resource placeholders. Necessary upstream URLs and legal attributions are retained.

If a usable credential was exposed, revoke or rotate it and review access records. Removing a string from the latest source file does not invalidate that credential or remove copies from history.

<a id="reporting"></a>

## Report a security problem privately

Use the private security-reporting channel actually enabled by the repository owner. If there is none, ask for a private channel without posting the exploit or guessing a maintainer email. Include the release version, impact, and a small reproduction containing fictional data. Do not include usable credentials, real user information, or private infrastructure snapshots in a public issue.

These are implementation boundaries, not a penetration-test certificate or a promise that vulnerabilities cannot exist.
