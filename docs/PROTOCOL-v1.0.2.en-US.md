# Linro v1.0.2: stable names for clients

[简体中文](PROTOCOL-v1.0.2.md) · [API reference](API.en-US.md) · [Upgrade](GUIDE.en-US.md#backup-and-upgrade)

These names are the labels on Linro's doors. Scripts and browsers must use them exactly. The application version is **v1.0.2**; the API path remains **v1**. A patch release does not require renaming that API.

| Item | Current identifier |
| --- | --- |
| Admin API prefix | `/Linro/v1` — case-sensitive |
| Application token | `Linro_` followed by 43 base64url characters; use the complete value returned on creation |
| Interactive write header | `X-Linro-CSRF: 1` |
| Local development header | `X-Linro-Dev`; loopback development only |
| Password unlock POST | `/__Linro_unlock/{slug}` |
| Browser verification POST | `/__Linro_browser/{slug}` |
| VPN WebSocket upgrade GET | `/__Linro_rtt` |
| Public asset prefix | `/__Linro_assets/` |
| Internal query parameters | `_Linro_check`, `_Linro_lang`; never forwarded to destinations |
| Production cookies | `__Host-Linro_unlock_*`, `__Host-Linro_browser_*` |
| JSON export marker | `format: "linro"`, `version: "1.0.2"` |
| CSV escaping marker | `_cf_links_csv` — intentionally retained for compatibility |

The public pages use fingerprinted `password.css`, `password.js`, and `browser.js` asset URLs. A matching fingerprint can be cached for a year. Unversioned forms of those paths return the current content with `Cache-Control: no-store`.

## Follow the visitor flow

Password unlock and browser verification return 200 JSON to the built-in same-origin page script, or 303 to a regular form. Both return to the same short-link site. The resumed GET performs current checks before returning a destination or text. Their successful intermediate responses are not successful-click events and do not consume the link's finite request quota.

For a VPN-protected link, Tor and Radar ASN checks run before the password page. Only ASNs classified as `ACCESS_ISP` or `ORGANIZATION` proceed. The Worker sends five random challenges over one same-origin WebSocket. The browser echoes each one unchanged. After each valid echo the Worker waits 400 ms before starting the next round. It times each round against the TCP or QUIC RTT of that connection. All five must complete and at least one absolute difference must be strictly below 55 ms. Exactly 55 ms does not qualify. A network denial before the challenge produces a 403 result page without a probe. Both protection pages support Chinese and English.

## Upgrade without renaming working resources

v1.0.2 preserves v1.0.1 API paths, token hashes, visitor-cookie names, KV keys, CSV markers, and database structure. Existing passwords and application tokens remain subject to normal expiry and revocation. Old client-timed receipts and VPN proof cookies are invalid; reopen the short link to start a new challenge. Keep Worker names, bindings, and root-secret values unchanged unless you are deliberately migrating them.

All six database migrations, `0001` through `0006`, are included. Check the target database and apply only its pending migrations. A database already containing all six needs no extra migration solely for this patch release.

Older internal compatibility labels such as `cf-links` can remain in stored identity, cryptographic-purpose, or export-format handling. They are not instructions to rename your database or rotate secrets. The user-facing product and active API are Linro.

On public short-link hosts, only `health`, `cdn-cgi`, and the `__Linro_` prefix are reserved, ignoring case. The business slug `Linro` is allowed. Normal business slugs are case-sensitive and contain 1–64 ASCII letters, digits, underscores, or hyphens.
