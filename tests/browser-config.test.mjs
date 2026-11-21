import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {configs,validateConfig} from '../scripts/config-lib.mjs';
const valid={account_id:'a'.repeat(32),database_id:'11111111-1111-4111-8111-111111111111',admin_host:'admin.example.com',redirect_hosts:['go.example.com'],access_issuer:'https://test.cloudflareaccess.com',access_aud:'a'.repeat(64),owner_email:'owner@example.com'};
async function dir(t){const d=await mkdtemp(join(tmpdir(),'cfl-browser-config-'));t.after(()=>rm(d,{recursive:true,force:true}));await cp(new URL('../scripts',import.meta.url),join(d,'scripts'),{recursive:true});return d;}
async function preflight(t,c){const d=await dir(t);for(const n of ['admin','redirect']){await mkdir(join(d,'apps',n),{recursive:true});await writeFile(join(d,'apps',n,'wrangler.jsonc'),JSON.stringify(c[n]));}return spawnSync(process.execPath,['scripts/preflight.mjs'],{cwd:d,encoding:'utf8'});}
for(const value of [undefined,true,false])test(`browser collection defaults off and shares explicit boolean ${value} on both Workers`,async t=>{
 const c=configs({...valid,...(value===undefined?{}:{browser_timezone_enabled:value})});for(const n of ['admin','redirect'])assert.equal(c[n].vars.BROWSER_TIMEZONE_ENABLED,String(value??false));assert.equal((await preflight(t,c)).status,0);
});
for(const value of ['true','false',null,1,[],{}])test(`config rejects truthy browser flag ${JSON.stringify(value)}`,()=>assert.throws(()=>validateConfig({...valid,browser_timezone_enabled:value})));
test('Admin stats receives disconnects in production and local configurations, including after regeneration',async t=>{
 const {admin,redirect}=configs(valid);
 assert.equal(admin.compatibility_date,'2026-09-15');
 assert.deepEqual(admin.compatibility_flags,['enable_request_signal']);
 assert.equal(redirect.compatibility_flags,undefined);
 const local=await dir(t);
 const init=()=>spawnSync(process.execPath,['scripts/local-init.mjs'],{cwd:local,encoding:'utf8'});
 assert.equal(init().status,0);
 const path=join(local,'.local','admin.jsonc');
 const cfg=JSON.parse(await readFile(path,'utf8'));
 assert.deepEqual(cfg.compatibility_flags,admin.compatibility_flags);
 cfg.compatibility_flags=['nodejs_compat','disable_request_signal'];
 await writeFile(path,JSON.stringify(cfg));
 assert.equal(init().status,0);
 assert.deepEqual(JSON.parse(await readFile(path,'utf8')).compatibility_flags,['nodejs_compat','enable_request_signal']);
 assert.equal(JSON.parse(await readFile(join(local,'.local','redirect.jsonc'),'utf8')).compatibility_flags,undefined);
});
for(const [date,flags,ok] of [
 ['2026-09-15',undefined,false],['2026-11-16',[],false],['2026-09-15',['enable_request_signal'],true],
 ['2026-09-15',['request_signal_passthrough'],false],['2026-11-17',undefined,true],
 ['2026-11-18',['disable_request_signal'],false],['2026-11-17',['disable_request_signal','enable_request_signal'],false],
 ['2026-11-17','enable_request_signal',false],['2026-11-17',null,false],['2026-11-17',[42],false],['2026-02-31',['enable_request_signal'],false],
]) test(`preflight checks incoming Request.signal at ${date} with ${JSON.stringify(flags)}`,async t=>{
 const pair=configs(valid);pair.admin.compatibility_date=date;pair.admin.compatibility_flags=flags;
 const result=await preflight(t,pair);assert.equal(result.status,ok?0:1,result.stderr);
 if(!ok)assert.match(result.stderr,/enable_request_signal|compatibility_date/);
});
for(const key of ['BROWSER_CHECK_SECRET','browser_check_secret','RADAR_API_TOKEN','radar_api_token'])test(`private ${key} cannot enter public deployment.json`,()=>assert.throws(()=>validateConfig({...valid,[key]:'s'.repeat(43)})));
test('preflight rejects missing/mismatched flags or root secret in vars',async t=>{
 for(const change of [c=>delete c.admin.vars.BROWSER_TIMEZONE_ENABLED,c=>c.redirect.vars.BROWSER_TIMEZONE_ENABLED='true',c=>c.admin.vars.BROWSER_CHECK_SECRET='s'.repeat(43),c=>c.redirect.vars.BROWSER_TIMEZONE_ENABLED='yes']){const c=configs(valid);change(c);assert.equal((await preflight(t,c)).status,1);}
});
test('preflight rejects account, binding, dataset, Cron and disabled-service drift with field diagnostics',async t=>{
 const bad=[
   [c=>c.redirect.account_id='f'.repeat(32),/account_id/i],
   [c=>c.admin.vars.CLOUDFLARE_ACCOUNT_ID='f'.repeat(32),/CLOUDFLARE_ACCOUNT_ID/],
   [c=>c.redirect.d1_databases[0].binding='OTHER',/DB binding/],
   [c=>c.redirect.d1_databases[0].database_name='other',/database_name/],
   [c=>delete c.redirect.analytics_engine_datasets,/ANALYTICS binding/],
   [c=>c.redirect.analytics_engine_datasets[0].dataset='another',/dataset/i],
   [c=>delete c.admin.triggers,/crons/],
   [c=>c.redirect.triggers={crons:['0 * * * *']},/Redirect triggers/],
 ];
 for(const [edit,message] of bad){
   const c=configs({...valid,analytics_enabled:true});edit(c);const result=await preflight(t,c);
   assert.equal(result.status,1);assert.match(result.stderr,message);
 }
 const disabled=configs(valid);disabled.admin.triggers={crons:['*/15 * * * *']};
 assert.match((await preflight(t,disabled)).stderr,/crons/);
 for(const flag of [false,true]){
   const c=configs({...valid,analytics_enabled:true,analytics_rollup_enabled:flag,analytics_rollup_interval_minutes:60,analytics_rollup_recheck_hours:12});
   assert.deepEqual(c.admin.triggers?.crons,flag?['0 * * * *']:undefined);
   assert.equal((await preflight(t,c)).status,0);
 }
});
test('local init adds one browser root while preserving password root, local token and local database state',async t=>{
 const d=await dir(t);await mkdir(join(d,'.local','state'),{recursive:true});await writeFile(join(d,'.local','state','keep'),'old state');
 const old=`LOCAL_DEV_TOKEN="${'a'.repeat(43)}"\nLINK_PASSWORD_SECRET="${'p'.repeat(43)}"\n`;
 await writeFile(join(d,'.local','.dev.vars'),old);let saved;
 for(let i=0;i<2;i++){const r=spawnSync(process.execPath,['scripts/local-init.mjs'],{cwd:d,encoding:'utf8'});assert.equal(r.status,0);const s=await readFile(join(d,'.local','.dev.vars'),'utf8');assert.ok(s.startsWith(old));assert.match(s,/BROWSER_CHECK_SECRET="[A-Za-z0-9_-]{43}"/);if(saved)assert.equal(s,saved);saved=s;}
 assert.equal(await readFile(join(d,'.local','state','keep'),'utf8'),'old state');
});
test('malformed browser root in existing local file is never silently rotated',async t=>{
 const d=await dir(t);await mkdir(join(d,'.local'));const saved='BROWSER_CHECK_SECRET="bad"\n';await writeFile(join(d,'.local','.dev.vars'),saved);
 const r=spawnSync(process.execPath,['scripts/local-init.mjs'],{cwd:d,encoding:'utf8'});assert.equal(r.status,1);assert.equal(await readFile(join(d,'.local','.dev.vars'),'utf8'),saved);
});
test('README specifies actual browser source, Cloudflare T1, unknown policy, replay boundary and safe rollout',async()=>{
 const s=await readFile(new URL('../docs/GUIDE.md',import.meta.url),'utf8');for(const text of ['Intl.DateTimeFormat().resolvedOptions().timeZone',"request.cf.country === 'T1'",'自报时区不可信','BROWSER_CHECK_SECRET','0004_browser_checks.sql','源码没有服务端一次性消费表','"browser_timezone_enabled": false'])assert.ok(s.includes(text),text);
 assert.ok(!s.includes('dimension_sources.browser_timezone: "unavailable"'));assert.ok(!s.includes('没有添加浏览器JS'));
});
