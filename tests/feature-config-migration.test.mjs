import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { configs, validateConfig } from '../scripts/config-lib.mjs';
import { SQLiteD1 } from './harness.mjs';
import { featureFixture, call, createLink, patch, row, request, PASSWORD } from './feature-helpers.mjs';
import { exportCSV, parseCSV } from '../.build/apps/admin/src/web/csv.js';
const require=createRequire(import.meta.url),ts=require('typescript');
const valid={account_id:'c'.repeat(32),database_id:'11111111-1111-4111-8111-111111111111',admin_host:'admin.example.com',redirect_hosts:['go.example.com'],access_issuer:'https://test.cloudflareaccess.com',access_aud:'d'.repeat(64),owner_email:'owner@example.com'};
async function temp(t){const dir=await mkdtemp(join(tmpdir(),'cf-links-feature-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));await cp(new URL('../scripts/',import.meta.url),join(dir,'scripts'),{recursive:true});return dir;}
async function preflight(t,pair){const dir=await temp(t);for(const name of ['admin','redirect']){await mkdir(join(dir,'apps',name),{recursive:true});await writeFile(join(dir,'apps',name,'wrangler.jsonc'),JSON.stringify(pair[name]));}return spawnSync(process.execPath,['scripts/preflight.mjs'],{cwd:dir,encoding:'utf8'});}

test('optional KV disabled by omission/empty ID; present ID binds the same namespace on both Workers',async t=>{
  for(const delta of [{},{redirect_cache_namespace_id:''},{redirect_cache_namespace_id:'e'.repeat(32),redirect_cache_ttl:600}]){
    const pair=configs({...valid,...delta});
    if(delta.redirect_cache_namespace_id){assert.deepEqual(pair.admin.kv_namespaces,pair.redirect.kv_namespaces);assert.equal(pair.admin.kv_namespaces[0].binding,'REDIRECT_CACHE');assert.equal(pair.admin.vars.REDIRECT_CACHE_TTL,'600');}
    else{assert.equal(pair.admin.kv_namespaces,undefined);assert.equal(pair.redirect.kv_namespaces,undefined);}
    assert.equal(pair.redirect.ratelimits.find(r=>r.name==='PASSWORD_LIMITER').simple.limit,5);assert.equal((await preflight(t,pair)).status,0);
  }
});
test('malformed cache TTL/IDs, unsafe password rates and colliding limiter namespaces are rejected',()=>{
  for(const delta of [{redirect_cache_namespace_id:'0'.repeat(32)},{redirect_cache_namespace_id:'bad'},{redirect_cache_namespace_id:null},{redirect_cache_ttl:59},{redirect_cache_ttl:86401},{redirect_cache_ttl:'300'},{password_rate_limit:0},{password_rate_limit:31},{password_rate_limit:1.5},{password_rate_namespace:'21003'},{link_password_secret:'do not store me'},{LINK_PASSWORD_SECRET:'do not store me'}])assert.throws(()=>validateConfig({...valid,...delta}),JSON.stringify(delta));
});
test('preflight rejects a half-bound/mismatched KV layer, TTL drift, missing password limiter and plaintext secrets',async t=>{
  for(const change of [p=>{delete p.admin.kv_namespaces;},p=>{p.redirect.kv_namespaces[0].id='f'.repeat(32);},p=>{p.redirect.vars.REDIRECT_CACHE_TTL='60';},p=>{p.redirect.ratelimits=p.redirect.ratelimits.filter(r=>r.name!=='PASSWORD_LIMITER');},p=>{p.admin.vars.LINK_PASSWORD_SECRET='not-in-vars';}]){
    const pair=configs({...valid,redirect_cache_namespace_id:'e'.repeat(32)});change(pair);const r=await preflight(t,pair);assert.equal(r.status,1,r.stdout);assert.match(r.stderr,/Preflight blocked/);
  }
});
test('local:init preserves both secrets and unrelated values, optionally binds local KV, never touches state',async t=>{
  const dir=await temp(t);await mkdir(join(dir,'.local','state'),{recursive:true});await writeFile(join(dir,'.local','state','keep'),'database-marker');
  const existing=`LOCAL_DEV_TOKEN="${'a'.repeat(43)}"\nLINK_PASSWORD_SECRET="${'b'.repeat(43)}"\nOTHER_LOCAL_VALUE="keep this"\n`;
  await writeFile(join(dir,'.local','.dev.vars'),existing);
  const init=kv=>spawnSync(process.execPath,['scripts/local-init.mjs',...(kv?['--kv']:[])],{cwd:dir,encoding:'utf8'});
  for(const kv of [true,false,true]){const r=init(kv);assert.equal(r.status,0,r.stderr);assert.ok(!r.stdout.includes('b'.repeat(43)));assert.equal((await readFile(join(dir,'.local','.dev.vars'),'utf8')).replace(/^BROWSER_CHECK_SECRET=.+\n/gm,''),existing);const config=JSON.parse(await readFile(join(dir,'.local','redirect.jsonc'),'utf8'));assert.equal(!!config.kv_namespaces,kv);}
  assert.equal(await readFile(join(dir,'.local','state','keep'),'utf8'),'database-marker');
});
test('local:init adds a password secret to an old file without rotating the local login token',async t=>{
  const dir=await temp(t);await mkdir(join(dir,'.local'));await writeFile(join(dir,'.local','.dev.vars'),`LOCAL_DEV_TOKEN="${'c'.repeat(43)}"\n`);
  const r=spawnSync(process.execPath,['scripts/local-init.mjs'],{cwd:dir,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const value=await readFile(join(dir,'.local','.dev.vars'),'utf8');assert.match(value,/LINK_PASSWORD_SECRET="[A-Za-z0-9_-]{43}"/);assert.ok(value.includes('c'.repeat(43)));
});
test('malformed existing password secrets are refused rather than silently regenerated',async t=>{
  const dir=await temp(t);await mkdir(join(dir,'.local'));const value='LINK_PASSWORD_SECRET="short"\n';await writeFile(join(dir,'.local','.dev.vars'),value);
  const r=spawnSync(process.execPath,['scripts/local-init.mjs'],{cwd:dir,encoding:'utf8'});assert.equal(r.status,1);assert.equal(await readFile(join(dir,'.local','.dev.vars'),'utf8'),value);
});
test('0002 migration preserves old links/users/domains/default codes and adds safe opt-out defaults',()=>{
  const db=new SQLiteD1(':memory:',false);try{
    db.sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
    db.sqlite.exec("INSERT INTO users(id,email,role,created_at,updated_at) VALUES('owner','owner@example.com','owner',1,1); INSERT INTO domains(id,hostname,default_redirect_code,created_at,updated_at) VALUES('domain','go.example.com',302,1,1); INSERT INTO links(id,domain_id,slug,target_url,created_by,created_at,updated_at,redirect_code) VALUES('link','domain','docs','https://example.org/','owner',1,1,301);");
    const old={...db.sqlite.prepare('SELECT * FROM links').get()};db.sqlite.exec(readFileSync(new URL('../migrations/0002_link_controls.sql',import.meta.url),'utf8'));const migrated=db.sqlite.prepare('SELECT * FROM links').get();
    for(const key of Object.keys(old))assert.equal(migrated[key],old[key],key);
    assert.equal(migrated.geo_rules,'[]');assert.equal(migrated.password_hash,null);assert.equal(migrated.max_redirects,null);assert.equal(migrated.redirect_count,0);assert.equal(migrated.rule_revision,1);
    assert.equal(db.sqlite.prepare('SELECT default_redirect_code AS c FROM domains').get().c,302);
    assert.throws(()=>db.sqlite.prepare("UPDATE users SET role='viewer'").run(),/last_enabled_owner/);
  }finally{db.close();}
});
test('schema constraints reject negative/invalid counters and trigger revisions do not change on quota writes',async t=>{
  const {env,domain}=await featureFixture(t);const link=await createLink(env,domain,{max_redirects:2});
  for(const sql of ["UPDATE links SET geo_rules='{}'","UPDATE links SET geo_rules='not-json'","UPDATE links SET max_redirects=0","UPDATE links SET redirect_count=-1","UPDATE links SET redirect_count=1.5","UPDATE links SET rule_revision=0"])assert.throws(()=>env.DB.sqlite.exec(sql));
  const revision=row(env,link.id).rule_revision;await request(env);assert.equal(row(env,link.id).rule_revision,revision);await patch(env,link,{max_redirects:4});assert.equal(row(env,link.id).rule_revision,revision+1);
});
test('new controls are subject to existing Editor ownership checks, including reset and password removal',async t=>{
  const {env,domain,user}=await featureFixture(t);const link=await createLink(env,domain,{password:PASSWORD,max_redirects:2});
  const second=(await call(env,'/users','POST',{email:'second@example.com',role:'owner'})).data;
  env.DB.sqlite.prepare('UPDATE links SET created_by=? WHERE id=?').run(second.id,link.id);
  assert.equal((await call(env,'/users/'+user.id,'PATCH',{version:user.version,role:'editor'})).status,200);
  for(const delta of [{password:null},{max_redirects:null},{reset_redirect_count:true},{geo_rules:[]}]){const r=await call(env,'/links/'+link.id,'PATCH',{version:row(env,link.id).version,...delta});assert.equal(r.status,403);assert.equal(r.error.code,'link_owner_required');}
});
test('CSV retains geo arrays and read-only control metadata but excludes any password field/hash',async t=>{
  const {env,domain}=await featureFixture(t);const rules=[{kind:'country',code:'JP',target_url:'https://japan.example.org/?x=1,2'}];
  const link=await createLink(env,domain,{geo_rules:rules,password:PASSWORD,max_redirects:10});
  const csv=exportCSV([{...link,password:'should never export',password_hash:row(env,link.id).password_hash}]);assert.ok(!csv.includes('should never export'));assert.ok(!csv.includes('pbkdf2'));
  const parsed=parseCSV(csv)[0];assert.deepEqual(JSON.parse(parsed.geo_rules),rules);assert.equal(parsed.password_protected,'true');assert.equal(parsed.max_redirects,'10');
});
test('all new GUI option keys exist in both dictionaries with the same shape',()=>{
  const filename=new URL('../apps/admin/src/web/LinkOptions.tsx',import.meta.url),text=readFileSync(filename,'utf8');const sf=ts.createSourceFile(filename.pathname,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declaration=sf.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations[0].name.getText(sf)==='optionLabels');assert.ok(declaration);
  const compiled=ts.transpileModule(declaration.getText(sf),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const exports={};new Function('exports',compiled)(exports);
  function shape(value){return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typeof v==='object'?shape(v):typeof v]));}
  assert.deepEqual(shape(exports.optionLabels['zh-CN']),shape(exports.optionLabels.en));for(const key of ['geo','regions','password','secretHint','limit','limitHint','count','reset','cache']) assert.ok(Object.hasOwn(exports.optionLabels.en,key),key);
});
test('new GUI fields are wired to FormData, protected imports cannot silently downgrade, and passwords never use storage',()=>{
  const app=readFileSync(new URL('../apps/admin/src/web/App.tsx',import.meta.url),'utf8');const options=readFileSync(new URL('../apps/admin/src/web/LinkOptions.tsx',import.meta.url),'utf8');
  assert.match(app,/<LinkOptions key=/);for(const key of ['geo_rules_json','max_redirects','password_action','reset_redirect_count'])assert.ok(app.includes(`values.get('${key}')`),key);
  assert.match(app,/protectedExport && !row\.password/);assert.doesNotMatch(options,/localStorage|sessionStorage|dangerouslySetInnerHTML/);
  assert.match(options,/type="password" name="password"/);assert.match(options,/value=\{JSON\.stringify\(textMode \? \[\] : rules\)\}/);
});
