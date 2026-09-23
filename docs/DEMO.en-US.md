# Linro WebGUI Demo

[简体中文](DEMO.md) · [Open demo](https://liying-official.github.io/Linro/demo/) · [API documentation](https://liying-official.github.io/Linro/?lang=en#api-reference)

The public, case-sensitive demo password is **`Linro`**. This is a login workflow demonstration on a static page, not secure authentication or a way to protect secrets.

The demo reuses the current TailAdmin React / Recharts interface, with Chinese and English, sample link/domain management, role switching, fictional analytics, simulated tokens, and import/export. Data lives only in the current page's memory. Refreshing, signing out, or resetting restores the fictional examples. Exported filenames begin with `DEMO-`.

It never connects to Workers, D1, KV, Access, or a live API. Clicking a sample short link opens a preview, not the destination website. New hostnames, target URLs, and email addresses must use reserved `.example`, `example.com`, `example.net`, or `example.org` names. Do not enter real personal information, passwords, or secrets. Password protection, geographic routing, and request limits demonstrate management controls only; the demo does not provide live redirects or visitor authentication.

## Build and publish

From the full source root:

```bash
npm ci
npm run build:demo
```

Source lives in `apps/demo/`; generated static files live in `docs/demo/`. Commit that output for GitHub Pages publishing from `main` and `/docs`. Rebuild after changing the shared UI or demo source; CI checks that committed assets match the build. Never store deployment credentials, logs, or database backups in `docs/`.

Only the demo build replaces the API client with the memory simulator. Production keeps its normal client and security checks. The demo CSP blocks network connections and form navigation; page assets load from the same site.
