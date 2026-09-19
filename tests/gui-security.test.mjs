import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const text = readFileSync(new URL('../apps/admin/src/web/App.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'App');
const selected = ['can', 'canManageLink', 'message'].map(name => app.members.find(n => n.name?.getText(source) === name).getText(source)).join('\n');
const built = ts.transpileModule(`export class Controller { constructor(state) { this.state=state; } ui() { return {common:{operationFailed:'Failed'}}; } ${selected} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
class APIError extends Error { constructor(code) { super('provider message'); this.code=code; this.requestId='request-123'; } }
const exports = {}; new Function('exports','APIError', built.outputText)(exports,APIError);
const C = exports.Controller;
const state = (scope='owned', scopes=['links:write','links:delete']) => ({ locale: 'en', session:{user:{id:'user-1'},link_write_scope:scope,scopes} });
test('GUI ownership controls distinguish own/foreign/null-owned rows and action scopes', () => {
  const c = new C(state()); assert.equal(c.canManageLink({created_by:'user-1'}), true);
  for (const created_by of ['user-2',null]) assert.equal(c.canManageLink({created_by}), false);
  const viewer = new C(state('workspace',['links:read'])); assert.equal(viewer.canManageLink({created_by:'user-1'}), false);
  const admin = new C(state('workspace')); assert.equal(admin.canManageLink({created_by:null},'links:delete'), true);
  const noDelete = new C(state('workspace',['links:write'])); assert.equal(noDelete.canManageLink({created_by:'other'},'links:delete'), false);
});
test('new security error messages are localized while retaining correlation IDs', () => {
  for (const locale of ['zh-CN','en']) {
    const c = new C({...state(),locale});
    for (const code of ['link_owner_required','unsafe_query_mode','private_target','security_policy_invalid']) {
      const text = c.message(new APIError(code)); assert.ok(text.endsWith('[request-123]'));
      assert.equal(/[\u4e00-\u9fff]/.test(text), locale==='zh-CN'); assert.ok(!text.includes('provider message'));
    }
  }
});
test('GUI selection, edit/delete and bulk actions use the same ownership guard', () => {
  assert.match(text, /const writable = rows\.filter\(link => this\.canManageLink\(link\)\)/);
  assert.match(text, /disabled=\{!this\.canManageLink\(link\)\}/);
  assert.match(text, /this\.canManageLink\(link, action === 'delete' \? 'links:delete' : 'links:write'\)/);
  assert.match(text, /this\.canManageLink\(link, 'links:delete'\)/);
});
