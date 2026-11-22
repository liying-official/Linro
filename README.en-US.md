# Linro

**Your own short links, on your own domains, with a Chinese and English dashboard.**

Current release: **v1.0.2** · [简体中文](README.md)

A short link is a small signpost: `https://go.example.com/welcome` points visitors to a longer address. Linro lets you create that signpost, change its destination, and decide who can use it. It runs in your Cloudflare account; you do not maintain a traditional server.

`example.com`, `example.org`, and the other example addresses in this repository are placeholders. They do not identify the project's operator or a working deployment.

## What can it do?

- Manage up to 50 public short-link domains from one dashboard.
- Create readable short codes, or let Linro generate one.
- Redirect visitors with 301, 302, 307, or 308; alternatively, show a small plain-text message.
- Add a password, an expiry time, an enable/disable switch, or a limit on authorized requests.
- Choose different destinations by country or continent.
- Import and export JSON/CSV, manage team roles, and review changes in an audit log.
- Add optional Analytics Engine statistics, KV route caching, and browser checks when you need them.

The dashboard is a **shared team workspace**. A Viewer can read the team's destinations and plain-text content. A password on a public short link does not hide its content from authorized dashboard members. See [security boundaries](docs/SECURITY.en-US.md).

## Pick your starting point

| You want to… | Start here |
| --- | --- |
| Click around without a Cloudflare account | [Static demo instructions](docs/DEMO.en-US.md) |
| Run the real application on your own computer | [Local setup](docs/GUIDE.en-US.md#local-setup) |
| Put Linro on your own domains | [Production setup](docs/GUIDE.en-US.md#production-setup) |
| Update an existing installation | [Backup and upgrade](docs/GUIDE.en-US.md#backup-and-upgrade) |
| Write a script that uses Linro | [API reference](docs/API.en-US.md) |

For local development, install **Node.js 22.16.0 or newer** and npm. From the extracted project folder, start with:

```bash
npm ci
npm run local:init
```

These two commands install the locked dependencies and prepare private local settings. Follow the [remaining local steps](docs/GUIDE.en-US.md#local-setup) to build the dashboard, create local tables, and start both services. They do not deploy Linro to Cloudflare.

For production, you also need a Cloudflare account, domains you control, a D1 database, and a Cloudflare Access application for dashboard login. The guide explains each part before using it.

## How the pieces fit together

Think of Linro as a small office:

| Piece | Its job |
| --- | --- |
| **Admin Worker** | The staff desk: dashboard, users, settings, and API |
| **Redirect Worker** | The signpost: receives public short-link visits |
| **D1** | The shared notebook: stores links, rules, users, and audit records |
| **Access** | The door attendant: checks who can enter the staff area |

KV and Analytics Engine are optional. Public examples start with analytics, global timezone collection, device-header collection, and KV disabled. Basic requests still use Workers and D1; check your account's current limits and usage before choosing optional features.

## Documentation

| Document | What you will learn |
| --- | --- |
| [User and deployment guide](docs/GUIDE.en-US.md) | Install, create links, manage a team, configure features, and troubleshoot |
| [API reference](docs/API.en-US.md) | Authentication, all 25 admin routes, fields, examples, and errors |
| [Demo](docs/DEMO.en-US.md) | Try the interface with fictional data |
| [Security](docs/SECURITY.en-US.md) | What protection does, what it does not do, and how to report a problem |
| [Retention](docs/RETENTION.en-US.md) | Inspect database growth and review bounded cleanup statements |
| [Release guide](docs/RELEASE.en-US.md) | Build the offline docs and prepare a clean source package |
| [Protocol identifiers](docs/PROTOCOL-v1.0.2.en-US.md) | Stable paths, headers, cookies, and upgrade compatibility |
| [Documentation sources](docs/SOURCES.en-US.md) | Find the implementation and official platform references |

GitHub renders the Markdown files above directly. To read everything offline, download the repository and open `docs/index.html` in a browser. The offline page provides language switching, search, and printing. The JavaScript demo needs an HTTP server; see its instructions.

## Contributing

Bug reports and pull requests are welcome. Include the version, what you expected, and a small example using fictional data. For a security problem, follow the [private reporting instructions](docs/SECURITY.en-US.md#reporting); keep credentials and user data out of public issues.

## License

Linro uses [AGPL-3.0-only](LICENSE). See the MIT notices for [TailAdmin](LICENSES/TailAdmin-MIT.txt) and [Recharts](LICENSES/Recharts-MIT.txt), and [NOTICE](NOTICE) for attribution. Read [Licensing and Corresponding Source](docs/LICENSING.en-US.md) before publishing a modified deployment.
