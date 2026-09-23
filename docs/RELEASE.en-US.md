# Linro v1.0.1 Source and Documentation Releases

[简体中文](RELEASE.md) · [Licensing](LICENSING.en-US.md) · [Security](SECURITY.en-US.md)

## Stage from clean source

In the complete source directory with unchanged public placeholder templates, run:

```bash
npm run package:source
# Or specify an output directory that does not yet exist:
npm run package:source -- --out release/Linro-v1.0.1-public
```

The default output is `release/Linro-v1.0.1/`. The script uses only Node built-ins; it does not install dependencies, build, contact Cloudflare, or overwrite an existing output. Release checks still include check, test, test:runtime, test:browser, build, and deploy:dry-run. Successful packaging is not successful runtime testing.

The packager selects explicit root files and allowed types in controlled directories. It excludes generated directories, `.local/`, `.wrangler/`, `node_modules/`, `dist/`, `deployment.json`, common environment files, databases, keys, and backups, and rejects symlinks in selected paths. Secrets manually embedded in source or Markdown can still be packaged; content review remains necessary.

The two public Wrangler templates and root `deployment.example.json` must match fixed SHA-256 values in the source. Do not restore placeholders in a configured production working copy to bypass this check; publish from a clean copy. This documentation revision leaves those three templates and the lockfile unchanged.

## Bilingual documentation

The source allowlist includes `README.md`, `README.en-US.md`, and the bilingual guides, API references, and public examples under `docs/`. Before release, verify that both languages are packaged and run the documentation link, configuration, and command checks.

## Documentation archives and manifests

A documentation-only archive contains Markdown, offline HTML, public examples, and notices, not application source or build output. Its `MANIFEST.sha256` covers that documentation archive only. **Do not overwrite a full source manifest with the documentation manifest.**

After changing README or `docs/`, regenerate the complete source manifest using the packager. A manifest covers every release file except itself; it is not an author signature.

```bash
sha256sum -c MANIFEST.sha256
```

Run the command at the root of the corresponding archive. On Windows use a compatible manifest verifier, or compare every entry with `Get-FileHash -Algorithm SHA256`; a single file hash does not validate the full manifest.

Archive only the reviewed output directory, not the working tree. Keep review reports, execution logs, evidence, repair plans, and historical archives separate from user-facing public documentation. Retain `LICENSE`, `NOTICE`, and inherited license texts; bilingual explanations do not replace authoritative license wording.
