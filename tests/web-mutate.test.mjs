import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

// Exercise the real mutate() source as a controller, not a React/DOM emulation.
const filename = new URL('../apps/admin/src/web/App.tsx', import.meta.url);
const source = ts.createSourceFile(filename.pathname, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'App');
const method = app?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'mutate');
assert.ok(method, 'App.mutate must exist');
const compiled = ts.transpileModule(`export const controller = { ${method.getText(source)} };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length ?? 0, 0, 'mutate source must transpile');

function controller(initial = {}, domainAPI = async () => [{ id: 'domain-refreshed' }]) {
  const exports = {};
  new Function('api', 'exports', compiled.outputText)(domainAPI, exports);
  const instance = {
    state: { busy: false, modal: null, error: 'old page error', modalError: 'old modal error', notice: '', selected: ['link-1'], locale: 'zh-CN', ...initial },
    patches: [], loads: 0, messages: 0,
    setState(patch) { this.patches.push(patch); Object.assign(this.state, patch); },
    message(error) { this.messages++; return error instanceof Error ? error.message : '操作失败。'; },
    ui() { return { common: { saved: '已保存。' } }; },
    async loadPage() { this.loads++; },
    mutate: exports.controller.mutate,
  };
  return instance;
}

test('mutation error updates use separate, explicitly keyed setState branches', () => {
  const statement = method.body.statements.find(ts.isTryStatement);
  const branch = statement?.catchClause?.block.statements.find(ts.isIfStatement);
  assert.ok(branch?.elseStatement, 'Use if/else setState calls, not a conditional object spread (React 19 TS2345).');
  const keys = block => {
    const calls = [];
    const walk = node => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'this.setState') calls.push(node);
      ts.forEachChild(node, walk);
    };
    walk(block);
    assert.equal(calls.length, 1, 'Each error branch must make exactly one update.');
    const argument = calls[0].arguments[0];
    assert.ok(ts.isObjectLiteralExpression(argument));
    assert.ok(argument.properties.every(ts.isPropertyAssignment), 'No spread or cast to suppress the type error.');
    return argument.properties.map(property => property.name.getText(source)).sort();
  };
  assert.deepEqual(keys(branch.thenStatement), ['busy', 'modalError']);
  assert.deepEqual(keys(branch.elseStatement), ['busy', 'error']);
});

test('modal rejection retains the modal, editable row and selection while clearing busy', async () => {
  const modal = { type: 'link', row: { slug: 'docs', target_url: 'https://example.org/docs' } };
  const instance = controller({ modal, importRows: [{ slug: 'pending' }] });
  await instance.mutate(async () => { throw new Error('The hostname, slug, or email already exists.'); });
  assert.equal(instance.state.modal, modal);
  assert.equal(instance.state.modal.row.target_url, 'https://example.org/docs');
  assert.deepEqual(instance.state.selected, ['link-1']);
  assert.deepEqual(instance.state.importRows, [{ slug: 'pending' }]);
  assert.equal(instance.state.modalError, 'The hostname, slug, or email already exists.');
  assert.equal(instance.state.error, '');
  assert.equal(instance.state.busy, false);
  assert.equal(instance.state.notice, '');
  assert.equal(instance.loads, 0);
  assert.equal(instance.messages, 1);
});

test('non-modal rejection appears in the page error rather than modalError', async () => {
  const instance = controller();
  await instance.mutate(async () => { throw new Error('Write failed'); });
  assert.equal(instance.state.error, 'Write failed');
  assert.equal(instance.state.modalError, '');
  assert.equal(instance.state.busy, false);
  assert.equal(instance.state.modal, null);
  assert.equal(instance.messages, 1);
});

test('retry clears errors, retains the form during the request, then closes and refreshes on success', async () => {
  const modal = { type: 'link', row: { slug: 'docs' } };
  const instance = controller({ modal });
  await instance.mutate(async () => { throw new Error('Duplicate'); });
  await instance.mutate(async () => {
    assert.equal(instance.state.busy, true);
    assert.equal(instance.state.modal, modal);
    assert.equal(instance.state.modalError, '');
    assert.equal(instance.state.error, '');
  }, '短链已创建。');
  assert.equal(instance.state.modal, null);
  assert.equal(instance.state.busy, false);
  assert.equal(instance.state.notice, '短链已创建。');
  assert.deepEqual(instance.state.selected, []);
  assert.deepEqual(instance.state.domains, [{ id: 'domain-refreshed' }]);
  assert.equal(instance.loads, 1);
});

test('busy state prevents duplicate writes without changing the active form', async () => {
  const instance = controller({ busy: true, modal: { type: 'link' } });
  let writes = 0;
  await instance.mutate(async () => { writes++; });
  assert.equal(writes, 0);
  assert.equal(instance.patches.length, 0);
});

test('a synchronously thrown task error uses the same modal error path', async () => {
  const instance = controller({ modal: { type: 'link' } });
  await instance.mutate(() => { throw new Error('Synchronous error'); });
  assert.equal(instance.state.modalError, 'Synchronous error');
  assert.equal(instance.state.busy, false);
  assert.equal(instance.messages, 1);
});

test('unknown rejection values are normalized once and leave retry possible', async () => {
  const instance = controller({ modal: { type: 'domain' } });
  await instance.mutate(async () => { throw null; });
  assert.equal(instance.state.modalError, '操作失败。');
  assert.equal(instance.state.busy, false);
  assert.equal(instance.messages, 1);
});

test('a failed domain refresh after a successful write reports a page error without reopening the form', async () => {
  const instance = controller({ modal: { type: 'link' } }, async () => { throw new Error('Refresh unavailable'); });
  await instance.mutate(async () => {}, 'Saved');
  assert.equal(instance.state.modal, null);
  assert.equal(instance.state.notice, 'Saved');
  assert.equal(instance.state.error, 'Refresh unavailable');
  assert.equal(instance.state.modalError, '');
  assert.equal(instance.state.busy, false);
  assert.equal(instance.loads, 0);
});
