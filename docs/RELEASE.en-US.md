# Prepare a public Linro release

[简体中文](RELEASE.md) · [Security](SECURITY.en-US.md) · [Licensing](LICENSING.en-US.md)

A release is a clean copy for other people to download. Keep it separate from the folder that contains your real account settings and local development data. This guide describes **v1.0.2**.

## 1. Start with public templates

Use the source folder with its unchanged placeholder `deployment.example.json` and both placeholder Wrangler configurations. A configured operator checkout contains real account identifiers and is not a suitable public source package.

Review all intended release files, including examples, tests, comments, Markdown, generated HTML, and demo JavaScript. Do not include real credentials, business domains, user data, private instructions, logs, backups, or historical working archives. Required public upstream links and copyright notices stay with the code.

## 2. Rebuild and check

From the folder containing `package.json`:

```bash
npm ci
npm run check
npm test
npm run test:runtime
npm run build
npm run test:browser
npm run build:demo
npm run build:docs
npm run deploy:dry-run
```

`build:docs` regenerates `docs/index.html` from Markdown and copies `LICENSE`, `NOTICE` and both MIT notices byte for byte into `docs/licenses/`. Distribute the `licenses/` directory alongside `index.html` for offline reading. `build:demo` regenerates `docs/demo/` from the shared interface and the demo simulator. Include these refreshed files when committing the release. CI checks generated documentation/demo synchronization; do not edit generated HTML as a separate version of the manual.

Browser tests need a working Chrome/Chromium environment; set `CFL_CHROMIUM_PATH` to the installed executable if needed. Keep its sandbox enabled. An unavailable browser is an uncompleted check, not a pass. On Linux/WSL, `npm run test:disconnect` additionally checks real loopback disconnect behavior for Admin statistics.

The runtime suite uses the toolchain pinned in the project's dependency tree. `npm run toolchain:versions` displays it. A dry run packages Workers without switching production traffic; it does not prove real DNS, Access, secrets, or database behavior.

## 3. Stage the files to publish

```bash
npm run package:source
```

The default output is `release/Linro-v1.0.2/`. To choose another new output directory:

```bash
npm run package:source -- --out release/Linro-v1.0.2-public
```

The directory must not already exist. The script uses Node built-ins and does not install dependencies, build the application, or contact Cloudflare. It selects explicit root files and permitted file types in controlled directories, rejects selected symlinks, and excludes local state, dependencies, deployment configuration, common secret files, database files, keys, recognized backup names and extensions, and ordinary generated build directories. The reviewed demo and offline docs are intentional publication assets.

The packager verifies the known hashes of the three public configuration templates. After staging, run a separate credential scan over the release directory and review the text, generated files, images, and commit history intended for publication.

## 4. Verify and archive the staged output

Each staged file except the manifest itself is listed in `MANIFEST.sha256`. From the staged directory, on a system with `sha256sum`:

```bash
sha256sum -c MANIFEST.sha256
```

On Windows, use a compatible manifest verifier or compare **every** entry with `Get-FileHash -Algorithm SHA256`. One file hash does not verify the complete archive. A manifest detects changed bytes; it is not an author's signature.

Archive only this reviewed staged directory. After any file changes, stage again so its manifest is fresh. Keep internal review notes and execution logs outside the public package. Preserve `LICENSE`, `NOTICE`, and all inherited license texts.

If you also publish a documentation-only ZIP, give it its own manifest covering only that ZIP's files. Do not replace the full source manifest with a documentation manifest. A documentation-only archive cannot substitute for the complete source offered for the running application.
