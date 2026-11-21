# Licensing and sharing the source

[简体中文](LICENSING.md) · [README](../README.en-US.md) · [Release guide](RELEASE.en-US.md)

Think of source code as the recipe for the running application. Linro's license explains when recipients and network users must be able to obtain that recipe, along with the material needed to build it.

## Which license applies?

Linro uses **AGPL-3.0-only**: GNU Affero General Public License version 3, without the “or any later version” option. The full [LICENSE](../LICENSE) is authoritative. This page is a practical explanation, not a replacement for its terms.

| Material | Notice to retain |
| --- | --- |
| Linro as a whole | [AGPL-3.0-only](../LICENSE) and existing file notices |
| Adapted TailAdmin React interface | [TailAdmin MIT notice](../LICENSES/TailAdmin-MIT.txt); upstream revision in [NOTICE](../NOTICE) |
| Recharts | [Recharts MIT notice](../LICENSES/Recharts-MIT.txt) |
| Other dependencies | Their own licenses and applicable notices |

The third-party MIT notices do not make the entire Linro project MIT-licensed. Keep `LICENSE`, `NOTICE`, and `LICENSES/*.txt` intact when redistributing. The provided source and lockfile do not include ApexCharts or TailAdmin Pro; this statement is not a legal audit of every transitive dependency.

## What is “Corresponding Source”?

For a modified version used over a network, AGPL section 13 addresses offering Corresponding Source to the people interacting with it. Review the full license for your use and distribution. In practical terms, publish the source matching the actual running version, together with required build and installation material. A moving default branch may no longer describe the deployed code.

Private deployment credentials and user data are not the recipe. Publish clean templates and the lockfile, while keeping account settings, databases, passwords, and private keys out of the release. See [Security](SECURITY.en-US.md) and [Release](RELEASE.en-US.md).

## Tell Linro where that source lives

Set `source_url` in your private deployment configuration. It becomes `SOURCE_URL` on both Workers. When present, Linro can show a source link in the dashboard and public protection pages and add a `Link` response header with `rel="describedby"`.

Use a public HTTPS URL for the deployed revision or release. It must be at most 2,048 characters, have no credentials, query, fragment, whitespace, or backslashes, and use a host different from this deployment's admin and short-link hosts.

Public templates deliberately leave the value empty. Fill it before production use. `preflight` warns when it is empty; it does not upload source or prove that a nonempty URL is reachable, complete, reproducible, or legally sufficient. Verify the published source yourself. For a specific legal uncertainty, consult a qualified adviser using the complete license and deployment facts.
