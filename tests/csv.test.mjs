import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, exportCSV } from '../.build/apps/admin/src/web/csv.js';
test('CSV parses BOM, quoted commas, escaped quotes and embedded newlines', () => {
  const rows = parseCSV('\uFEFFslug,target_url,title\r\na,https://example.org/,"hello, ""world""\nnext"\r\n');
  assert.equal(rows[0].slug, 'a'); assert.equal(rows[0].title, 'hello, "world"\nnext');
});
test('CSV formula mitigation is reversible with an explicit cf-links marker', () => {
  for (const title of ['=1+1', '+1', '-2', '@SUM(A1)', '  =2', '\tvalue', "'leading-quote", 'normal']) {
    const exported = exportCSV([{ slug: 'a', target_url: 'https://example.org/', title }]);
    assert.equal(parseCSV(exported)[0].title, title);
    if (title !== 'normal') assert.ok(exported.includes('"\''));
  }
  assert.equal(parseCSV('title\n\'=1+1\n')[0].title, "'=1+1");
});
test('malformed columns, duplicate headings and incomplete quoting are rejected', () => {
  for (const source of ['slug,slug\na,b', 'slug,title\na', 'slug\n"open', 'slug\n"closed"junk', ',title\na,b']) assert.throws(() => parseCSV(source));
  assert.deepEqual(parseCSV(''), []);
});
test('CSV parser bounds rows and content size', () => {
  assert.throws(() => parseCSV('a'.repeat(2 * 1024 * 1024 + 1)));
  assert.throws(() => parseCSV('slug\n' + 'a\n'.repeat(5001)));
});
