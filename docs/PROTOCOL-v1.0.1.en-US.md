# Linro v1.0.1 Protocol Identifiers

[简体中文](PROTOCOL-v1.0.1.md) · [API](https://liying-official.github.io/Linro/?lang=en#api-reference) · [Upgrade](GUIDE.en-US.md#upgrade)

| Interface or data | v1.0.1 identifier |
| --- | --- |
| Admin API | `/Linro/v1`, case-sensitive |
| Application Bearer token | `Linro_` plus 43 base64url characters; use the complete creation response |
| Interactive CSRF / local development headers | `X-Linro-CSRF` / `X-Linro-Dev` |
| Public password / browser POST | `/__Linro_unlock/:slug` / `/__Linro_browser/:slug` |
| Same-origin assets | `/__Linro_assets/password.css`, `/__Linro_assets/browser.js` |
| Internal query parameters | `_Linro_check`, `_Linro_lang`; never forwarded to targets |
| Production cookies | `__Host-Linro_unlock_*`, `__Host-Linro_browser_*` |
| JSON export | `format: "linro"`, `version: "1.0.1"` |

Legacy admin paths, token prefixes, and internal paths have no compatibility aliases. The database hashes the complete token; editing its prefix does not produce a valid new token. Issue replacements through a normal interactive session and update automation clients. Old cookies do not automatically migrate to new ones.

These are public protocol changes, not instructions to recreate cloud resources. Preserve Worker, D1, KV, and dataset names and the original root secrets. Do not recreate the database for a branding change. Internal password-purpose labels, the KV `cf-links:route:v1:` prefix, CSV `_cf_links_csv` safety marker, and local identity keys can retain historical names without supporting the old public API.

This source contains migrations 0001–0004. Apply the pending work reported by the target database rather than inferring completeness from its version label. Retain `LINK_PASSWORD_SECRET` to continue verifying stored password records. Browser checks use a separate independent secret.

Admin and Redirect publication is not atomic. Plan ordering, protocol compatibility, and a maintenance window, then separately verify the active versions, clients, assets, authentication, migrations, and dedicated acceptance links. Code rollback does not roll back the database or restore a rotated secret.

Only `health`, `cdn-cgi`, and the `__Linro_` prefix are reserved on the public redirect host, ignoring case. `Linro` is a normal slug. Update Admin and Redirect together; rolling back to code that still reserves these names makes the affected short links unavailable. No new database migration is required.
