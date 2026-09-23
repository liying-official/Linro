// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { configs, validateConfig } from '../scripts/config-lib.mjs';
const ts=createRequire(import.meta.url)('typescript');
const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>readFileSync(join(root,name),'utf8');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const valid={account_id:'a'.repeat(32),database_id:'12345678-1234-4234-8234-123456789abc',admin_host:'admin.example.com',redirect_hosts:['go.example.com'],access_issuer:'https://example.cloudflareaccess.com',access_aud:'b'.repeat(64),owner_email:'owner@example.com'};
function sandbox(t){const dir=mkdtempSync(join(tmpdir(),'linro-rebrand-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));cpSync(join(root,'scripts'),join(dir,'scripts'),{recursive:true});mkdirSync(join(dir,'apps/admin'),{recursive:true});mkdirSync(join(dir,'apps/redirect'),{recursive:true});return dir;}
function run(dir,script,args=[]){return spawnSync(process.execPath,['scripts/'+script,...args],{cwd:dir,encoding:'utf8',timeout:15000});}

test('Linro release declares AGPL-3.0-only and retains its included third-party notices',()=>{
 const p=JSON.parse(read('package.json'));assert.equal(p.name,'linro');assert.equal(p.version,'1.0.1');assert.equal(p.license,'AGPL-3.0-only');
 const license=read('LICENSE');assert.ok(license.length>33000);assert.match(license,/GNU AFFERO GENERAL PUBLIC LICENSE/);assert.match(license,/13\. Remote Network Interaction/);
 assert.match(read('NOTICE'),/AGPL-3\.0-only/);
 for(const file of ['LICENSES/TailAdmin-MIT.txt','LICENSES/Recharts-MIT.txt'])assert.match(read(file),/MIT License/);
 assert.match(read('docs/LICENSING.md'),/source_url/);assert.match(read('docs/LICENSING.md'),/对应源码/);
});
test('both live UI dictionaries show Linro and the expired metric uses the X path',()=>{
 const source=ts.createSourceFile('App.tsx',read('apps/admin/src/web/App.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const stmt=source.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(source)==='UI'));
 const code=ts.transpileModule(stmt.getText(source)+'\nexports.UI=UI;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const ctx={exports:{},VERSION:'1.0.0'};vm.runInNewContext(code,ctx);
 for(const locale of ['zh-CN','en']){const ui=ctx.exports.UI[locale];assert.ok(ui.login.title.includes('Linro'));assert.equal(ui.dashboard.metrics[2][2],'close');}
 assert.match(read('apps/admin/src/web/components.tsx'),/close: <path d="m6 6 12 12M6 18 18 6"/);
 assert.match(read('apps/admin/index.html'),/<title>Linro/);
 assert.doesNotMatch(read('apps/admin/src/web/App.tsx'),/>cf-links</i);
});
test('theme contains requested sky/white/ink/body tokens and primary text does not use white on sky',()=>{
 const css=read('apps/admin/src/web/styles.css');for(const color of ['#87CEEB','#FFFFFF','#0D394A'])assert.ok(css.toUpperCase().includes(color));
 assert.match(css,/--accent:\s*#87CEEB/i);assert.match(css,/--sidebar:\s*#87CEEB/i);
 assert.match(css,/\.primary[^}]*color:\s*#0D394A/i);
 const publicCSS=read('apps/redirect/src/public-pages.ts');for(const color of ['#87CEEB','#FFFFFF','#0D394A'])assert.ok(publicCSS.toUpperCase().includes(color));
});
test('fresh deployment defaults are Linro and explicit old resource names remain supported',()=>{
 const fresh=configs(valid);assert.equal(fresh.admin.name,'linro-admin');assert.equal(fresh.redirect.name,'linro-redirect');assert.equal(fresh.admin.d1_databases[0].database_name,'linro');assert.equal(fresh.admin.vars.ANALYTICS_DATASET,'linro_clicks');
 const old=configs({...valid,admin_worker_name:'cf-links-admin',redirect_worker_name:'cf-links-redirect',database_name:'cf-links',analytics_dataset:'cf_links_clicks',analytics_enabled:true});
 assert.equal(old.admin.name,'cf-links-admin');assert.equal(old.redirect.name,'cf-links-redirect');assert.equal(old.admin.d1_databases[0].database_name,'cf-links');assert.equal(old.redirect.analytics_engine_datasets[0].dataset,'cf_links_clicks');
 assert.equal(old.admin.d1_databases[0].database_id,valid.database_id);
});
test('resource-name configuration refuses collisions and malformed names',()=>{
 for(const patch of [{admin_worker_name:'shared',redirect_worker_name:'shared'},{admin_worker_name:'../wrong'},{redirect_worker_name:'UPPER'},{admin_worker_name:''},{redirect_worker_name:42}])assert.throws(()=>validateConfig({...valid,...patch}));
});
test('configure inherits existing same-account same-database Worker names without creating new targets',t=>{
 const dir=sandbox(t),old=configs({...valid,admin_worker_name:'cf-links-admin',redirect_worker_name:'cf-links-redirect',database_name:'cf-links',analytics_dataset:'cf_links_clicks'});
 for(const side of ['admin','redirect'])writeFileSync(join(dir,'apps',side,'wrangler.jsonc'),JSON.stringify(old[side]));
 writeFileSync(join(dir,'deployment.json'),JSON.stringify(valid));const r=run(dir,'configure.mjs');assert.equal(r.status,0,r.stderr);
 const a=JSON.parse(readFileSync(join(dir,'apps/admin/wrangler.jsonc'))),b=JSON.parse(readFileSync(join(dir,'apps/redirect/wrangler.jsonc')));
 assert.equal(a.name,old.admin.name);assert.equal(b.name,old.redirect.name);assert.equal(a.d1_databases[0].database_name,'cf-links');assert.equal(a.vars.ANALYTICS_DATASET,'cf_links_clicks');
 assert.deepEqual(JSON.parse(readFileSync(join(dir,'deployment.json'))),valid);
});
test('configure does not inherit from other accounts and explicit names win for same resources',t=>{
 const dir=sandbox(t),old=configs({...valid,account_id:'c'.repeat(32),admin_worker_name:'old-admin',redirect_worker_name:'old-redirect'});
 for(const side of ['admin','redirect'])writeFileSync(join(dir,'apps',side,'wrangler.jsonc'),JSON.stringify(old[side]));
 writeFileSync(join(dir,'deployment.json'),JSON.stringify(valid));assert.equal(run(dir,'configure.mjs').status,0);
 assert.equal(JSON.parse(readFileSync(join(dir,'apps/admin/wrangler.jsonc'))).name,'linro-admin');
 writeFileSync(join(dir,'deployment.json'),JSON.stringify({...valid,admin_worker_name:'chosen-admin',redirect_worker_name:'chosen-redirect'}));assert.equal(run(dir,'configure.mjs').status,0);
 assert.equal(JSON.parse(readFileSync(join(dir,'apps/admin/wrangler.jsonc'))).name,'chosen-admin');
});
test('local init preserves legacy D1 identity, Worker names, secret bytes and data state',t=>{
 const dir=sandbox(t);mkdirSync(join(dir,'.local/state'),{recursive:true});
 const secret=['LOCAL_DEV_TOKEN','LINK_PASSWORD_SECRET','BROWSER_CHECK_SECRET'].map((name,i)=>`${name}="${String(i+1).repeat(43)}"`).join('\n')+'\n';writeFileSync(join(dir,'.local/.dev.vars'),secret);writeFileSync(join(dir,'.local/state/keep.txt'),'keep database marker');
 writeFileSync(join(dir,'.local/admin.jsonc'),JSON.stringify({name:'cf-links-admin-local',d1_databases:[{database_name:'cf-links-local'}]}));writeFileSync(join(dir,'.local/redirect.jsonc'),JSON.stringify({name:'cf-links-redirect-local'}));
 for(let i=0;i<2;i++){const r=run(dir,'local-init.mjs',['--kv']);assert.equal(r.status,0,r.stderr);}
 const a=JSON.parse(readFileSync(join(dir,'.local/admin.jsonc'))),b=JSON.parse(readFileSync(join(dir,'.local/redirect.jsonc')));
 assert.equal(a.name,'cf-links-admin-local');assert.equal(b.name,'cf-links-redirect-local');assert.equal(a.d1_databases[0].database_name,'cf-links-local');assert.equal(a.d1_databases[0].database_id,'11111111-1111-4111-8111-111111111111');
 assert.equal(readFileSync(join(dir,'.local/.dev.vars'),'utf8'),secret);assert.equal(readFileSync(join(dir,'.local/state/keep.txt'),'utf8'),'keep database marker');
});
test('source URL is optional but consistent and invalid source settings fail configuration',()=>{
 const source='https://source.example.org/Linro/v1.0.0';const {admin,redirect}=configs({...valid,source_url:source});assert.equal(admin.vars.SOURCE_URL,source);assert.equal(redirect.vars.SOURCE_URL,source);
 assert.equal(configs(valid).admin.vars.SOURCE_URL,'');
 for(const source_url of ['https://admin.example.com/source','https://go.example.com/source','http://source.example.org','https://u:p@source.example.org','https://source.example.org/?token=a','https://source.example.org/#hash','https://source.example.org/<bad>'])assert.throws(()=>configs({...valid,source_url}));
});

test('existing database migration bytes remain unchanged',()=>{
 const baselineHashes={
  "migrations/0001_initial.sql": "8ef46432d57d930c683b2b20843a63eb216fa650eec606218f422a1077ab9813",
  "migrations/0002_link_controls.sql": "8c5fd88db2bca10e19f9e147cb71a8d471b10a72c1e6fc4ba19b6849a1cc9434",
  "migrations/0003_text_responses.sql": "c168bbc72a1ec434c53ae9143299c931b5fd87adeca937316c5ab1bfe49228bc",
  "migrations/0004_browser_checks.sql": "b479638a2ca36c313f7d0f1c420485bda4f582de932e23b1dd920380393278cc",
};
 for(const [path,hash] of Object.entries(baselineHashes)) assert.equal(sha(readFileSync(join(root,path))),hash,path);
});
