import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY_MS = 86_400_000;
const TABLES = {
  audit_logs: {
    flag: '--audit-days',
    stamp: 'created_at',
    keys: 'id',
    order: 'created_at ASC, id ASC',
  },
  daily_stats: {
    flag: '--archive-days',
    stamp: 'date',
    keys: 'link_id, date',
    order: 'date ASC, link_id DESC',
  },
  api_tokens: {
    flag: '--revoked-token-days',
    stamp: 'revoked_at',
    keys: 'id',
    order: 'revoked_at ASC, id ASC',
  },
};

const HELP = [
  'Read a local SQLite snapshot and print a JSON capacity report',
  '  node scripts/retention.mjs --database SNAPSHOT.sqlite [options]',
  'Print one atomic cleanup statement for a single table',
  '  node scripts/retention.mjs --emit-cleanup-sql audit_logs|daily_stats|api_tokens [options]',
  '  --audit-days N        Audit log age in UTC days',
  '  --archive-days N      Daily archive age in UTC days',
  '  --revoked-token-days N  Revocation age in UTC days',
  '  --as-of YYYY-MM-DD    UTC reference day (default today)',
  '  --limit N             Row limit for a single batch (1–1000, default 100)',
  'Omit a day option to retain all rows of that table. SQL output requires the selected table’s day option.',
].join('\n');

function nonnegative(value, flag) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number))
    throw new Error('Expected a nonnegative whole number for ' + flag);
  return number;
}

function utcDay(value) {
  const date = new Date(value + 'T00:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error('--as-of requires a valid UTC date in YYYY-MM-DD format.');
  return date.getTime();
}

function options(args) {
  const values = new Map();
  const flags = [
    '--database',
    '--emit-cleanup-sql',
    '--as-of',
    '--limit',
    ...Object.values(TABLES).map((t) => t.flag),
  ];
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!flags.includes(flag) || values.has(flag) || !value || value.startsWith('--'))
      throw new Error('Invalid or repeated option. Use --help.');
    values.set(flag, value);
  }
  const database = values.get('--database');
  const table = values.get('--emit-cleanup-sql');
  if (values.has('--database') === values.has('--emit-cleanup-sql'))
    throw new Error('Choose --database SNAPSHOT.sqlite or --emit-cleanup-sql TABLE.');
  if (table && !Object.hasOwn(TABLES, table))
    throw new Error('Choose audit_logs, daily_stats, or api_tokens.');
  const limit = nonnegative(values.get('--limit') ?? '100', '--limit');
  if (limit < 1 || limit > 1000) throw new Error('--limit must be between 1 and 1000.');
  const asOf = values.get('--as-of') ?? new Date().toISOString().slice(0, 10);
  const asOfMs = utcDay(asOf);
  const policies = {};
  for (const [name, { flag }] of Object.entries(TABLES)) {
    if (!values.has(flag)) {
      policies[name] = null;
      continue;
    }
    const days = nonnegative(values.get(flag), flag);
    const date = new Date(asOfMs - days * DAY_MS);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 0)
      throw new Error('The retention period extends beyond the supported calendar.');
    policies[name] = {
      days,
      cutoff: date.toISOString().slice(0, 10),
      seconds: date.getTime() / 1000,
    };
  }
  if (table && !policies[table])
    throw new Error('Set ' + TABLES[table].flag + ' to generate cleanup SQL for ' + table + '.');
  return { database, table, asOf, policies, limit };
}

function predicate(table, policy) {
  const { stamp } = TABLES[table];
  if (table === 'daily_stats') {
    // The archive stores YYYY-MM-DD. Also retain malformed legacy dates for review.
    return `date < '${policy.cutoff}' AND date(date, '+0 days') = date`;
  }
  const revoked = table === 'api_tokens' ? 'revoked_at IS NOT NULL AND ' : '';
  return `${revoked}typeof(${stamp}) = 'integer' AND ${stamp} < ${policy.seconds}`;
}

function cleanupSQL({ table, policies, limit }) {
  const { keys, order } = TABLES[table];
  // The subquery chooses a bounded set of primary keys inside the DELETE itself.
  return `DELETE FROM ${table}
WHERE (${keys}) IN (
  SELECT ${keys} FROM ${table}
  WHERE ${predicate(table, policies[table])}
  ORDER BY ${order}
  LIMIT ${limit}
);`;
}

async function capacityReport({ database, asOf, policies, limit }) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(resolve(database), { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN');
    const { page_count } = db.prepare('PRAGMA page_count').get();
    const { page_size } = db.prepare('PRAGMA page_size').get();
    const { freelist_count } = db.prepare('PRAGMA freelist_count').get();
    const sizes = db.prepare("SELECT 1 FROM pragma_module_list WHERE name='dbstat'").get()
      ? db
          .prepare(
            `SELECT m.tbl_name, SUM(s.pgsize) AS bytes
           FROM sqlite_schema AS m JOIN dbstat('main',1) AS s ON s.name=m.name
           WHERE m.tbl_name IN ('audit_logs','daily_stats','api_tokens') AND m.type IN ('table','index')
           GROUP BY m.tbl_name`,
          )
          .all()
      : [];
    const tableBytes = new Map(sizes.map((row) => [row.tbl_name, row.bytes]));
    const tables = {};
    for (const table of Object.keys(TABLES)) {
      const policy = policies[table];
      const eligible = policy ? `COUNT(*) FILTER (WHERE ${predicate(table, policy)})` : '0';
      const { total_rows, eligible_rows } = db
        .prepare(`SELECT COUNT(*) AS total_rows, ${eligible} AS eligible_rows FROM ${table}`)
        .get();
      tables[table] = {
        retention_days: policy?.days ?? null,
        cutoff_utc: policy?.cutoff ?? null,
        total_rows,
        eligible_rows,
        next_batch_rows: Math.min(eligible_rows, limit),
        table_and_index_bytes: tableBytes.get(table) ?? null,
      };
    }
    db.exec('COMMIT');
    return {
      as_of_utc: asOf,
      batch_limit: limit,
      database: {
        page_size,
        page_count,
        free_pages: freelist_count,
        allocated_bytes: page_size * page_count,
        reusable_bytes: page_size * freelist_count,
      },
      tables,
    };
  } finally {
    db.close();
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(HELP);
    return;
  }
  const config = options(args);
  if (config.table) console.log(cleanupSQL(config));
  else console.log(JSON.stringify(await capacityReport(config), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
