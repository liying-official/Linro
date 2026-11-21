# Try the Linro demo

[简体中文](DEMO.md) · [README](../README.en-US.md) · [Full setup guide](GUIDE.en-US.md)

The demo is a practice room. You can click the real dashboard controls without creating a Cloudflare account or changing a live service.

[Open the GitHub Pages demo](https://liying-official.github.io/Linro/demo/) and enter the six-digit code shown on the page.

## Open it locally

Download and extract the project. In a terminal, enter the project folder that contains `package.json`. With Python installed, run:

```bash
python -m http.server 8000 --bind 127.0.0.1 --directory docs
```

Then open [the local demo](http://127.0.0.1:8000/demo/) and enter the six-digit code shown on the page. On systems where Python is called `python3`, use `python3` in the command. Stop the server with Ctrl+C when finished.

The code is generated for the current page. It is an experience gate, not a production password. Opening the demo HTML directly from disk may prevent JavaScript modules from loading, which is why the small local HTTP server is used.

## Things to try

1. Switch between Chinese and English.
2. Create a fictional link or edit a sample title.
3. Try the role selector to see which controls each role receives.
4. Explore the sample charts, domains, tokens, and import/export controls.
5. Refresh, sign out, or reset to restore the sample data.

Everything is kept in the current page's memory. It does not contact Workers, D1, KV, Access, or a live admin API. Clicking a sample short link shows a preview instead of visiting its target. Exports begin with `DEMO-` so they are easy to recognize.

Use fictional information only. New hosts, targets, and email addresses must use reserved `.example`, `example.com`, `example.net`, or `example.org` names. Password, geographic-routing, and request-limit controls demonstrate editing; they do not provide real visitor authentication or real redirects in this simulator.

## Rebuild the demo after changing the interface

From the complete source folder:

```bash
npm ci
npm run build:demo
```

The source is in `apps/demo/`. The generated website is in `docs/demo/`. The demo build substitutes an in-memory client for the production API client; production builds keep their normal authentication and API behavior.

GitHub Pages publishes the `/docs` directory from the `main` branch. Commit the refreshed demo files when publishing the repository. CI rebuilds them and checks for differences. The demo's Content Security Policy blocks network connections and form navigation; its own assets load from the same site. Keep private configuration, backups, and logs outside `docs/`.
