import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../apps/admin/src/web/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'App');
function method(name, injected = {}) {
  const member = app.members.find(n => n.name?.getText(source) === name); assert.ok(member, name);
  const code = ts.isMethodDeclaration(member) ? `const c = { ${member.getText(source)} }; exports.f = c.${name};` : `exports.f = ${member.initializer.getText(source)};`;
  const exports = {}; const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  new Function('exports', ...Object.keys(injected), compiled)(exports, ...Object.values(injected)); return exports.f;
}
class Form { constructor(values) { this.values = values; } get(key) { return this.values[key] ?? null; } }
for (const mode of ['redirect','text']) {
  test(`real submitLink controller serializes ${mode} including password and quota without field loss`, async () => {
    const calls=[];const submit=method('submitLink',{FormData:Form,api:async(...args)=>calls.push(args)});
    const instance={state:{locale:'en',modal:{row:{id:'link',version:7,redirect_code:308}}}, async mutate(task){await task();},setState(patch){Object.assign(this.state,patch);}};
    await submit.call(instance,{preventDefault(){},currentTarget:{response_mode:mode,text_content:'draft\nbody',target_url:'https://example.net/',domain_id:'domain',slug:'docs',title:'title',description:'note',geo_rules_json:'[]',redirect_code:'302',query_mode:'merge',cache_ttl:'99',max_redirects:'8',password_action:'set',password:'test-password',enabled:'on',reset_redirect_count:'on'}});
    assert.equal(calls.length,1);const [url,verb,body]=calls[0];assert.equal(url,'/links/link');assert.equal(verb,'PATCH');assert.equal(body.password,'test-password');assert.equal(body.max_redirects,8);assert.equal(body.version,7);assert.equal(body.reset_redirect_count,true);
    assert.equal(body.response_mode,mode);assert.equal(body.text_content,mode==='text'?'draft\nbody':'');assert.equal(body.target_url,mode==='text'?'':'https://example.net/');assert.equal(body.query_mode,mode==='text'?'discard':'merge');assert.equal(body.cache_ttl,mode==='text'?0:99);
  });
}
test('real loadPage controller sends selected IDs independently of write-selection and preserves page state', async()=>{
  const calls=[];const load=method('loadPage',{api:async url=>{calls.push(url);return {available:true,link_ids:['stat-a','stat-b']};}});
  const instance={mounted:true,sequence:0,state:{page:'analytics',days:30,pageNo:1,auditPage:1,analyticsIds:['stat-a','stat-b'],selected:['editable-only']},setState(p){Object.assign(this.state,p);},message:e=>e.message};
  await load.call(instance);const u=new URL(calls[0],'https://example.org');assert.equal(u.searchParams.get('link_ids'),'stat-a,stat-b');assert.equal(u.searchParams.get('days'),'30');assert.deepEqual(instance.state.selected,['editable-only']);assert.equal(instance.state.busy,false);
});
test('empty custom selection is rejected in the controller, never queried as all',async()=>{
  let calls=0;const load=method('loadPage',{api:async()=>{calls++;}});const instance={mounted:true,sequence:0,state:{page:'analytics',days:7,analyticsIds:[],locale:'en'},setState(p){Object.assign(this.state,p);},message:e=>e.message};
  await load.call(instance);assert.equal(calls,0);assert.match(instance.state.error,/Select at least one/);assert.equal(instance.state.busy,false);
});
test('out-of-order statistics responses cannot replace the newest link scope',async()=>{
  const pending=[];const load=method('loadPage',{api:url=>new Promise(resolve=>pending.push({url,resolve}))});
  const instance={mounted:true,sequence:0,state:{page:'analytics',days:7,analyticsIds:['old']},setState(p){Object.assign(this.state,p);},message:e=>e.message};
  const old=load.call(instance);instance.state.analyticsIds=['new'];const next=load.call(instance);pending[1].resolve({tag:'new'});await next;pending[0].resolve({tag:'old'});await old;assert.equal(instance.state.analytics.tag,'new');
});
for(const [filename,name] of [['response-ui.ts','responseLabels'],['AnalyticsSelection.tsx','selectionLabels']]){
  test(`${name} has matching complete Chinese/English keys`,()=>{
    const sf=ts.createSourceFile(filename,readFileSync(new URL('../apps/admin/src/web/'+filename,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,filename.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    const declaration=sf.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(sf)===name));const compiled=ts.transpileModule(declaration.getText(sf),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const exports={};new Function('exports',compiled)(exports);
    const labels=exports[name];assert.deepEqual(Object.keys(labels['zh-CN']).sort(),Object.keys(labels.en).sort());for(const value of Object.values(labels.en))assert.ok(typeof value==='string'&&value.length);
  });
}
test('GUI text fields and optional geo controls have the correct source wiring and draft persistence',()=>{
  const text=source.getFullText();assert.match(text,/<LinkOptions key=.*?textMode=\{s\.responseMode === 'text'\}/);
  assert.match(text,/name="text_content"[^>]+value=\{s\.plainTextDraft\}/);assert.match(text,/plainTextDraft: row\?\.text_content \?\? ''/);
  assert.match(text,/onApply=\{this\.viewAnalytics\}/);assert.match(text,/this\.viewAnalytics\(\[link\.id\]\)/);assert.match(text,/analyticsIds: ids, analytics: null/);
  const selection=readFileSync(new URL('../apps/admin/src/web/AnalyticsSelection.tsx',import.meta.url),'utf8');
  assert.match(selection,/current\.length >= 50/);assert.match(selection,/mode === 'chosen' && !selected\.length/);assert.match(selection,/if \(stale\) return/);
  assert.doesNotMatch(selection,/canManageLink|links:write/);
});
