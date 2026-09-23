import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter(n => n.endsWith('.sql')).sort();
const asObjects = rows => rows.map(row => ({ ...row }));
function seed(t, applied = 2) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);');
  for (const name of migrations.slice(0, applied)) {
    db.exec(read('migrations/' + name)); db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
  }
  db.exec(`INSERT INTO users(id,email,role,access_sub,created_at,updated_at) VALUES('owner','owner@example.com','owner','existing-sub',1,1);
    INSERT INTO domains(id,hostname,default_redirect_code,created_at,updated_at) VALUES('domain','go.example.com',302,1,1);
    INSERT INTO links(id,domain_id,slug,target_url,created_by,created_at,updated_at,redirect_code,password_hash,max_redirects,redirect_count)
      VALUES('link','domain','docs','https://example.org/docs','owner',1,1,302,'opaque-existing-password-verifier',20,3);
    INSERT INTO api_tokens(id,user_id,name,token_hash,prefix,scopes,expires_at,created_at)
      VALUES('token','owner','original','opaque-token-hash','test','["links:read"]',2000000000,1);
    INSERT INTO audit_logs(id,actor_email,action,resource_type,resource_id,request_id,created_at) VALUES('audit','owner@example.com','create','link','link','original-request',1);`);
  return db;
}
// This models a migration ledger against real SQLite, not the Wrangler CLI or
// remote D1. The deployment instructions require the actual remote list/apply.
function pending(db) {
  const names = new Set(db.prepare('SELECT name FROM d1_migrations').all().map(row => row.name));
  return migrations.filter(name => !names.has(name));
}
function applyPending(db) {
  const names = pending(db);
  for (const name of names) {
    db.exec('BEGIN');
    try { db.exec(read('migrations/' + name)); db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return names;
}

test('I3 a database with only 0001/0002 requires both intermediate migrations in order', t => {
  const db = seed(t); assert.deepEqual(pending(db), ['0003_text_responses.sql', '0004_browser_checks.sql']);
  const before = {};
  for (const name of ['users','domains','links','api_tokens','audit_logs','settings']) before[name] = asObjects(db.prepare('SELECT * FROM ' + name).all());
  assert.deepEqual(applyPending(db), ['0003_text_responses.sql', '0004_browser_checks.sql']);
  assert.deepEqual(pending(db), []);
  for (const name of ['users','domains','api_tokens','audit_logs','settings']) assert.deepEqual(asObjects(db.prepare('SELECT * FROM ' + name).all()), before[name]);
  const row = { ...db.prepare('SELECT * FROM links').get() };
  assert.deepEqual(row, { ...before.links[0], response_mode: 'redirect', text_content: '', block_vpn: 0 });
  assert.equal(row.rule_revision, 1); assert.equal(row.redirect_count, 3);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('I3 all pending migrations extend the existing revision trigger without double increments', t => {
  const db = seed(t); applyPending(db);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name='links_rule_revision'").get().n, 1);
  let revision = db.prepare('SELECT rule_revision FROM links').get().rule_revision;
  for (const sql of ["UPDATE links SET response_mode='text'", "UPDATE links SET text_content='changed text'", 'UPDATE links SET block_vpn=1']) {
    db.exec(sql); assert.equal(db.prepare('SELECT rule_revision FROM links').get().rule_revision, ++revision);
  }
  db.exec('UPDATE links SET redirect_count=redirect_count+1');
  assert.equal(db.prepare('SELECT rule_revision FROM links').get().rule_revision, revision);
  assert.equal(db.prepare('SELECT redirect_count FROM links').get().redirect_count, 4);
});

test('I3 a fully migrated database has no pending work and must not be seeded or cleared', t => {
  const db = seed(t, 4); const before = asObjects(db.prepare('SELECT * FROM links').all());
  assert.deepEqual(applyPending(db), []); assert.deepEqual(asObjects(db.prepare('SELECT * FROM links').all()), before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM d1_migrations').get().n, 4);
});

test('I3 audit steps include remote list before and after applying all pending migrations', () => {
  const md = read('docs/GUIDE.md');
  const section = md.slice(md.indexOf('### 8.1 '), md.indexOf('### 8.2 '));
  assert.match(section, /全部待应用迁移/);
  assert.match(section, /migrations list DB --remote[\s\S]*npm run db:migrate[\s\S]*migrations list DB --remote/);
  assert.match(md, /pragma_table_info\('links'\)/); assert.match(md, /type='trigger' AND name='links_rule_revision'/);
  assert.match(md, /不能据版本号推断/); assert.match(md, /test:browser/);
});



test('F1 keeps the existing CSP, narrow origin policy and actual Chromium CI regression', () => {
  const http = read('packages/shared/src/http.ts');
  assert.match(http, /form-action 'self'/); assert.match(http, /connect-src 'self'/);
  assert.doesNotMatch(http, /unsafe-inline|unsafe-eval|form-action \*/);
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['test:browser'], /node --test/);
  assert.match(read('.github/workflows/ci.yml'), /npm run test:browser/);
  const browser = read('tests/browser/csp-navigation.test.mjs');
  assert.match(browser, /negative control/); assert.match(browser, /cspErrors/); assert.match(browser, /targetVisits/);
  assert.doesNotMatch(browser, /\.skip\(|skip:/);
  const cdp = read('tests/browser/chromium-cdp.mjs');
  assert.doesNotMatch(cdp, /--disable-web-security|--disable-features=BlockInsecurePrivateNetworkRequests|--ignore-certificate-errors|setBypassCSP/);
});
