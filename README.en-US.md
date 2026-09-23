# 🔗 Linro

**Open-source short links and multi-domain management on Cloudflare.**

Current version: **v1.0.1**.

[简体中文](README.md) · [Deployment guide](docs/index.html?lang=en#install) · [Documentation](docs/index.html?lang=en) · [API reference](docs/index.html?lang=en#api-reference)

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](docs/index.html?lang=en#architecture)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](docs/index.html?lang=en#architecture)
[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue)](LICENSE)

Create short links on your own domains and manage links, members, and access rules from one bilingual dashboard. Linro runs in your Cloudflare account, with separate admin and public-redirect Workers and no traditional server to maintain.

## ✨ Why Linro

- **Multiple domains, one dashboard.** Manage up to 50 public short-link domains with custom or generated slugs. The same slug can be used independently on different domains.
- **Access controls for teamwork.** Cloudflare Access protects the admin entry point. Owner, Admin, Editor, and Viewer roles work alongside scoped application tokens for collaboration and automation.
- **More than redirects.** Use 301 / 302 / 307 / 308 redirects or serve plain text directly. Redirect links can select destinations by country or continent.
- **Rules for individual links.** Configure passwords, expiration, enablement, and authorized-request limits—not just a shorter address.
- **Bulk management and data portability.** Enable, disable, or delete links in bulk; import and export JSON / CSV; and review administrative actions in the audit log.
- **Optional services, configured as needed.** Add KV route caching, Analytics Engine statistics, and browser-timezone collection to suit your deployment.

> [!NOTE]
> Linro supports individuals and teams sharing a workspace; it does not isolate data between members. Members with read access can view workspace links. See the [security guide](docs/SECURITY.en-US.md) for permissions and access boundaries.

## 🚀 Get started

**[Open the HTML deployment guide →](docs/index.html?lang=en#install)**

The bilingual HTML documentation covers first installation, Cloudflare resources, multiple domains, and optional services. For an existing instance, follow the [upgrade guide](docs/index.html?lang=en#upgrade).

For offline reading, download the project or documentation package and open `docs/index.html` in a browser. Language switching, search, and printing are available there.

## 📚 Documentation

[Using the dashboard](docs/index.html?lang=en#usage) · [Configuration](docs/index.html?lang=en#configuration) · [Members and permissions](docs/index.html?lang=en#permissions) · [API reference](docs/index.html?lang=en#api-reference) · [Troubleshooting](docs/index.html?lang=en#troubleshooting)

## 🧱 Built with

Cloudflare Workers · D1 · Access · React · TypeScript · Vite · Tailwind CSS · TailAdmin · Recharts. KV and Analytics Engine are optional services.

## 🤝 Contributing

Issues, feature suggestions, and pull requests are welcome. For security findings involving credentials or user data, follow the [security reporting guidance](docs/SECURITY.en-US.md#reporting) rather than including sensitive details in a public issue.

## 📄 License

Linro is licensed under **[AGPL-3.0-only](LICENSE)**. MIT notices for cf-links, TailAdmin, and Recharts are retained in [LICENSES](LICENSES/). See [NOTICE](NOTICE) and the [licensing guide](docs/LICENSING.en-US.md) for attribution and Corresponding Source information.
