import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {configs,validateConfig} from '../scripts/config-lib.mjs';
const valid={account_id:'a'.repeat(32),database_id:'11111111-1111-4111-8111-111111111111',admin_host:'admin.example.com',redirect_hosts:['go.example.com'],access_issuer:'https://test.cloudflareaccess.com',access_aud:'a'.repeat(64),owner_email:'owner@example.com'};
async function dir(t){const d=await mkdtemp(join(tmpdir(),'cfl-browser-config-'));t.after(()=>rm(d,{recursive:true,force:true}));await cp(new URL('../scripts',import.meta.url),join(d,'scripts'),{recursive:true});return d;}
async function preflight(t,c){const d=await dir(t);for(const n of ['admin','redirect']){await mkdir(join(d,'apps',n),{recursive:true});await writeFile(join(d,'apps',n,'wrangler.jsonc'),JSON.stringify(c[n]));}return spawnSync(process.execPath,['scripts/preflight.mjs'],{cwd:d,encoding:'utf8'});}
for(const value of [undefined,true,false])test(`browser collection defaults true and shares explicit boolean ${value} on both Workers`,async t=>{
 const c=configs({...valid,...(value===undefined?{}:{browser_timezone_enabled:value})});for(const n of ['admin','redirect'])assert.equal(c[n].vars.BROWSER_TIMEZONE_ENABLED,String(value??true));assert.equal((await preflight(t,c)).status,0);
});
for(const value of ['true','false',null,1,[],{}])test(`config rejects truthy browser flag ${JSON.stringify(value)}`,()=>assert.throws(()=>validateConfig({...valid,browser_timezone_enabled:value})));
for(const key of ['BROWSER_CHECK_SECRET','browser_check_secret'])test(`private ${key} cannot enter public deployment.json`,()=>assert.throws(()=>validateConfig({...valid,[key]:'s'.repeat(43)})));
test('preflight rejects missing/mismatched flags or root secret in vars',async t=>{
 for(const change of [c=>delete c.admin.vars.BROWSER_TIMEZONE_ENABLED,c=>c.redirect.vars.BROWSER_TIMEZONE_ENABLED='false',c=>c.admin.vars.BROWSER_CHECK_SECRET='s'.repeat(43),c=>c.redirect.vars.BROWSER_TIMEZONE_ENABLED='yes']){const c=configs(valid);change(c);assert.equal((await preflight(t,c)).status,1);}
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
 const s=await readFile(new URL('../README.md',import.meta.url),'utf8');for(const text of ['Intl.DateTimeFormat().resolvedOptions().timeZone',"request.cf.country === 'T1'",'无法保证拦截全部 VPN 用户，并且会存在错误拦截','BROWSER_CHECK_SECRET','0004_browser_checks.sql','不是服务端消费型一次性凭据','8条顺序请求','browser_timezone_enabled:false'])assert.ok(s.includes(text),text);
 assert.ok(!s.includes('dimension_sources.browser_timezone: "unavailable"'));assert.ok(!s.includes('没有添加浏览器JS'));
});
