# Linro v1.0.1 Licensing and Corresponding Source

[简体中文](LICENSING.md) · [README](../README.en-US.md)

## Overall and inherited licenses

Linro as a whole uses **AGPL-3.0-only**, the GNU Affero General Public License version 3, without “or any later version.” The authoritative text is [LICENSE](../LICENSE). This page explains the project; it does not replace the license or legal advice about a particular deployment.

| Material | License and location |
| --- | --- |
| Inherited cf-links contributions | [cf-links MIT notice](../LICENSES/cf-links-MIT.txt) |
| TailAdmin React adaptations | `apps/admin/src/web/tailadmin/` retains [TailAdmin MIT](../LICENSES/TailAdmin-MIT.txt); see [NOTICE](../NOTICE) for the fixed upstream revision |
| Recharts | [Recharts MIT](../LICENSES/Recharts-MIT.txt) |
| Linro as a whole and other existing files | Their AGPL-3.0-only licensing and existing file notices remain applicable |

The MIT notices do not license Linro as a whole under MIT or revoke rights in previously received MIT versions. The supplied source and lockfile do not include ApexCharts or TailAdmin Pro; this is not a completed legal audit of every transitive dependency. Third-party dependencies retain their own licenses.

Keep `LICENSE`, `NOTICE`, and `LICENSES/*.txt` unchanged. Bilingual explanations do not replace attribution or invent authors, ownership claims, or exceptions.

## Network use and source_url

AGPL section 13 addresses offering Corresponding Source to users interacting with modified versions over a network. Review the complete terms applicable to your use and distribution, and provide complete source for the running version together with required build and installation materials.

Deployment `source_url` maps to `SOURCE_URL` on both Workers. The application can display a source entry in the admin interface and public protection pages and attach a `Link` header with the `describedby` relation to wrapped responses. It does not upload, mirror, or verify the source.

The URL must use HTTPS, be at most 2048 characters, omit credentials, query, fragment, whitespace, and backslashes, and not use the deployment's admin or short-link host. Public examples leave it empty; fill in the actual public source entry before production. `preflight` only warns on an empty value and does not establish publication, completeness, buildability, or legal compliance.

Prefer the source of the actual deployed commit or release tag to a moving default branch. Publishing source does not require leaking account configuration, user data, databases, passwords, or private keys; retain the public templates and lockfile required for reproducible builds. Seek qualified advice about specific legal uncertainties.
