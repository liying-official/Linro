import { readFile, readdir } from 'node:fs/promises';

// These project migrations contain no semicolons inside string values. Preserve
// complete trigger blocks instead of splitting their BEGIN...END body at ';'.
export function migrationStatements(text) {
  const triggers = [];
  const withoutComments = text.replace(/^\s*--.*$/gm, '');
  const flat = withoutComments.replace(
    /CREATE TRIGGER\b[\s\S]*?\bEND\s*;/gi,
    (trigger) => `__TRIGGER_${triggers.push(trigger) - 1}__;`,
  );
  return flat
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^__TRIGGER_\d+__$/.test(s) ? triggers[Number(s.match(/\d+/)[0])] : s));
}

export async function applyMigrations(db, start = 0, end) {
  const dir = new URL('../../migrations/', import.meta.url);
  const names = (await readdir(dir))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .slice(start, end);
  for (const name of names) {
    const sql = await readFile(new URL(name, dir), 'utf8');
    for (const statement of migrationStatements(sql)) await db.prepare(statement).run();
  }
}
