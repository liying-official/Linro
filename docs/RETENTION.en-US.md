# Keep database growth under control

[简体中文](RETENTION.md) · [Backup and upgrade](GUIDE.en-US.md#backup-and-upgrade)

Imagine keeping every receipt forever: the drawer gradually fills up. Linro similarly keeps audit logs, daily statistics, and revoked-token records indefinitely by default. The retention script helps you measure that drawer and prepare a small cleanup step. It does not connect to Cloudflare or delete data automatically.

## 1. Make a private, consistent snapshot

Use a full D1 SQL export from the [backup instructions](GUIDE.en-US.md#backup-and-upgrade). Restore that trusted export into a **new local SQLite file**, separate from any live database. For example, in a private backup directory with an unused filename:

```bash
sqlite3 review.sqlite
```

At the SQLite prompt:

```sql
.read Linro-backup.sql
PRAGMA quick_check;
.quit
```

Use the resulting binary `review.sqlite` file for the report. The script cannot read a plain SQL export as if it were a database. Record which database the snapshot came from and when it was exported. It contains account-related records, token verifiers, and audit details, so protect it like the original backup.

## 2. Read the report

From the project root, using Node.js 22.16.0 or newer:

```bash
node scripts/retention.mjs --database /PRIVATE_BACKUP_DIR/review.sqlite
```

Replace `/PRIVATE_BACKUP_DIR/review.sqlite` with your private snapshot path. The path is an obvious placeholder, not a directory to create on a production server.

By default, the report treats no rows as eligible for cleanup. To explore a policy, add independent retention periods:

```bash
node scripts/retention.mjs --database /PRIVATE_BACKUP_DIR/review.sqlite --as-of 2026-11-21 --audit-days 180 --archive-days 365 --revoked-token-days 90 --limit 100
```

The date and day counts are examples. Choose them for your own operational needs.

| Option | Which timestamp it checks |
| --- | --- |
| `--audit-days` | `audit_logs.created_at`, in Unix seconds |
| `--archive-days` | `daily_stats.date`, the UTC date represented by the row |
| `--revoked-token-days` | `api_tokens.revoked_at`, in Unix seconds |

A missing period appears as `null` and selects zero rows. An unrevoked token is always retained, even if it has expired. Each cutoff is midnight UTC on the reference date minus the number of days. Rows exactly at the cutoff are kept. With zero days, the reference day and later dates are kept. Without `--as-of`, the script uses the current UTC day.

The JSON report shows total rows, eligible rows, the next batch size, allocated database bytes, and reusable pages. Per-table/index sizes are `null` when that SQLite build has no `dbstat` support. These are measurements of the local snapshot, not your live D1 account. Deleted rows can free reusable space without making the physical file smaller.

## 3. Generate one small cleanup statement

For example, after reviewing the matching report:

```bash
node scripts/retention.mjs --emit-cleanup-sql audit_logs --as-of 2026-11-21 --audit-days 180 --limit 100
```

This prints SQL only. It opens no database and needs no credentials. Choose `audit_logs`, `daily_stats`, or `api_tokens` and supply the corresponding period. Keep the reference date and policy identical to the report you reviewed. Use `node` directly when redirecting the output into a SQL file so npm's extra output does not enter that file.

The statement selects the oldest eligible primary keys and deletes one bounded batch atomically. The default cap is 100 rows; the allowed range is 1–1,000. Finding those rows may read more rows than it deletes. Running the statement again can delete the **next** batch.

First test it on a disposable restored copy and rerun the report. Before any live execution, confirm the database and a current restorable backup. Each additional batch is a separate maintenance decision. For short archive retention, remember that rollup reconciles complete two-day windows and can write a recently deleted day again. No scheduled cleanup is installed by this tool.
