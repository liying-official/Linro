import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/retention.mjs', import.meta.url));
const asOf = '2026-06-15';
const cutoff = Date.parse('2026-06-13T00:00:00Z') / 1000;
const policy = [
  '--as-of',
  asOf,
  '--audit-days',
  '2',
  '--archive-days',
  '2',
  '--revoked-token-days',
  '2',
];
function cli(args) {
  const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  assert.ifError(run.error);
  return run;
}
function output(args) {
  const run = cli(args);
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'linro-retention-')),
    path = join(dir, 'snapshot.sqlite');
  const db = new DatabaseSync(path);
  t.after(() => {
    db.close();
    unlinkSync(path);
    rmdirSync(dir);
  });
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((n) => n.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(new URL(name, migrations), 'utf8'));
  db.exec(
    "INSERT INTO users(id,email,role,created_at,updated_at) VALUES('u','fixture@example.com','owner',1,1); INSERT INTO domains(id,hostname,created_at,updated_at) VALUES('d','go.example.com',1,1);",
  );
  const link = db.prepare(
    "INSERT INTO links(id,domain_id,slug,target_url,created_at,updated_at) VALUES(?,'d',?,'https://example.org/',1,1)",
  );
  for (const key of ['a', 'b', 'c']) link.run(key, key);
  const audit = db.prepare(
    "INSERT INTO audit_logs(id,actor_email,action,resource_type,resource_id,details,request_id,created_at) VALUES(?,'private@example.com','edit','link','k','private audit fixture','r',?)",
  );
  for (const [key, time] of [
    ['a', cutoff - 20],
    ['b', cutoff - 10],
    ['c', cutoff],
    ['d', cutoff + 1],
    ['e', 'unknown'],
  ])
    audit.run(key, time);
  const stat = db.prepare(
    'INSERT INTO daily_stats(link_id,date,clicks,updated_at) VALUES(?,?,1,?)',
  );
  for (const [key, date] of [
    ['a', '2026-06-12'],
    ['b', '2026-06-12'],
    ['c', '2026-06-11'],
    ['a', '2026-06-13'],
    ['b', '0000-not-a-date'],
  ])
    stat.run(key, date, cutoff + 1);
  const token = db.prepare(
    "INSERT INTO api_tokens(id,user_id,name,token_hash,prefix,scopes,created_at,expires_at,revoked_at) VALUES(?,'u','fixture',?,'private-prefix','[]',1,?,?)",
  );
  for (const [key, expires, revoked] of [
    ['old', cutoff - 2, cutoff - 1],
    ['older', cutoff + 1, cutoff - 20],
    ['edge', cutoff - 1, cutoff],
    ['current', cutoff + 900000, null],
    ['expired', 1, null],
    ['malformed', 1, 'unknown'],
  ])
    token.run(key, 'private-verifier-' + key, expires, revoked);
  const report = (opts = []) => JSON.parse(output(['--database', path, ...opts]));
  const selected = (table, limit = '100') =>
    output(['--emit-cleanup-sql', table, ...policy, '--limit', limit]);
  return { dir, path, db, report, selected };
}

test('retention report opens a snapshot read-only, defaults to permanent retention and discloses aggregate capacity', (t) => {
  const { path, report } = fixture(t);
  const before = readFileSync(path);
  const base = report(['--as-of', asOf]);
  assert.equal(base.as_of_utc, asOf);
  assert.equal(base.batch_limit, 100);
  assert.deepEqual(Object.keys(base.tables).sort(), ['api_tokens', 'audit_logs', 'daily_stats']);
  assert.equal(base.database.allocated_bytes, base.database.page_count * base.database.page_size);
  assert.equal(base.database.reusable_bytes, base.database.free_pages * base.database.page_size);
  assert.ok(base.database.allocated_bytes > 0);
  for (const [table, total] of [
    ['audit_logs', 5],
    ['daily_stats', 5],
    ['api_tokens', 6],
  ]) {
    const row = base.tables[table];
    assert.equal(row.total_rows, total);
    assert.equal(row.retention_days, null);
    assert.equal(row.cutoff_utc, null);
    assert.equal(row.eligible_rows, 0);
    assert.equal(row.next_batch_rows, 0);
    assert.ok(row.table_and_index_bytes === null || row.table_and_index_bytes > 0);
  }
  assert.doesNotMatch(
    JSON.stringify(base),
    /private@example|private-verifier|private audit fixture|private-prefix/,
  );
  assert.deepEqual(readFileSync(path), before);
});

test('per-table UTC policies use strict cutoffs, exclude malformed dates and keep unrevoked tokens', (t) => {
  const { report } = fixture(t);
  const mixed = report(['--as-of', asOf, '--archive-days', '2', '--limit', '1']);
  assert.equal(mixed.tables.daily_stats.eligible_rows, 3);
  assert.equal(mixed.tables.daily_stats.next_batch_rows, 1);
  assert.equal(mixed.tables.audit_logs.eligible_rows, 0);
  assert.equal(mixed.tables.api_tokens.eligible_rows, 0);
  const all = report(policy);
  assert.equal(all.tables.audit_logs.eligible_rows, 2);
  assert.equal(all.tables.api_tokens.eligible_rows, 2);
  for (const row of Object.values(all.tables)) assert.equal(row.cutoff_utc, '2026-06-13');
  assert.equal(
    report(['--as-of', asOf, '--revoked-token-days', '0']).tables.api_tokens.eligible_rows,
    3,
  );
});

test('explicit SQL deletes one bounded oldest batch and rechecks eligibility at execution', (t) => {
  const { db, report, selected } = fixture(t);
  const run = cli(['--emit-cleanup-sql', 'audit_logs', ...policy, '--limit', '1']);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  assert.match(run.stdout, /^DELETE FROM audit_logs\b/);
  assert.equal(run.stdout.split(';').filter((part) => part.trim()).length, 1);
  db.exec(run.stdout);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE id='a'").get().n, 0);
  assert.equal(report(policy).tables.audit_logs.eligible_rows, 1);
  db.exec(run.stdout);
  assert.equal(report(policy).tables.audit_logs.eligible_rows, 0);
  assert.deepEqual(
    db
      .prepare('SELECT id FROM audit_logs ORDER BY id')
      .all()
      .map((r) => r.id),
    ['c', 'd', 'e'],
  );
  const archive = selected('daily_stats', '1');
  db.exec(archive);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM daily_stats WHERE date='2026-06-11'").get().n, 0);
  db.exec(archive);
  assert.equal(report(policy).tables.daily_stats.eligible_rows, 1);
  db.exec(archive);
  assert.equal(report(policy).tables.daily_stats.eligible_rows, 0);
  assert.deepEqual(
    db
      .prepare('SELECT date FROM daily_stats ORDER BY date')
      .all()
      .map((r) => r.date),
    ['0000-not-a-date', '2026-06-13'],
  );
  const token = selected('api_tokens', '2');
  db.exec("UPDATE api_tokens SET revoked_at=NULL WHERE id='older'");
  db.exec(token);
  assert.deepEqual(
    db
      .prepare('SELECT id FROM api_tokens ORDER BY id')
      .all()
      .map((r) => r.id),
    ['current', 'edge', 'expired', 'malformed', 'older'],
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM links').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
});

test('single SQL statement rolls back an entire batch if a trigger rejects the second row', (t) => {
  const { db, selected } = fixture(t);
  db.exec(
    "CREATE TRIGGER stop_second AFTER DELETE ON audit_logs WHEN (SELECT COUNT(*) FROM audit_logs)=3 BEGIN SELECT RAISE(ABORT,'fixture_stop'); END;",
  );
  assert.throws(() => db.exec(selected('audit_logs', '2')), /fixture_stop/);
  assert.deepEqual(
    db
      .prepare('SELECT id FROM audit_logs ORDER BY id')
      .all()
      .map((row) => row.id),
    ['a', 'b', 'c', 'd', 'e'],
  );
});

test('retention rejects ambiguous modes, missing input, malformed options and unconfigured cleanup', (t) => {
  const { dir, path } = fixture(t);
  const missing = join(dir, 'missing.sqlite');
  const invalid = [
    ['--database', missing],
    [],
    ['--database', path, '--emit-cleanup-sql', 'audit_logs', '--audit-days', '2'],
    ['--emit-cleanup-sql', 'audit_logs', '--archive-days', '1'],
    ['--emit-cleanup-sql', 'api_tokens;DROP TABLE settings', '--revoked-token-days', '0'],
    ['--emit-cleanup-sql', 'toString', '--audit-days', '2'],
    ['--database', path, '--as-of', '2026-02-30'],
    ['--database', path, '--audit-days', '-1'],
    ['--database', path, '--audit-days', '999999999999999999'],
    ['--database', path, '--archive-days', '2;DELETE FROM links'],
    ['--database', path, '--limit', '0'],
    ['--database', path, '--limit', '1001'],
    ['--database', path, '--as-of', asOf, '--as-of', asOf],
    ['--database', path, '--apply', 'yes'],
  ];
  for (const args of invalid) {
    const run = cli(args);
    assert.equal(run.status, 1, JSON.stringify(args));
    assert.equal(run.stdout, '');
  }
  assert.equal(existsSync(missing), false);
});
