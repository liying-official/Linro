import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import {fixture,send,challenge,submit,current,count,patch} from './browser-fixture.mjs';
import {call,createLink} from './harness.mjs';
import {parseCSV,exportCSV} from '../.build/apps/admin/src/web/csv.js';
import {BROWSER_JS} from '../.build/apps/redirect/src/browser-page.js';
import { scriptHarness } from './browser-script-harness.mjs';
const ts=createRequire(import.meta.url)('typescript');
for(const value of ['true','false','1',2,-1,[],{},null])test(`API rejects ambiguous block_vpn=${JSON.stringify(value)}`,async t=>{
 const f=await fixture(t);const r=await call(f.env,'/links/'+f.link.id,'PATCH',{version:current(f).version,block_vpn:value});assert.equal(r.status,400);assert.equal(current(f).block_vpn,0);
});
test('new block requires secret; existing block cannot silently disappear if the secret is missing',async t=>{
 const f=await fixture(t,{block_vpn:true});delete f.env.BROWSER_CHECK_SECRET;
 await patch(f,{title:'keep on without secret'});assert.equal(current(f).block_vpn,1);assert.equal((await send(f,'/docs')).status,503);
 await patch(f,{block_vpn:false});const r=await call(f.env,'/links/'+f.link.id,'PATCH',{version:current(f).version,block_vpn:true});assert.equal(r.status,503);assert.equal(current(f).block_vpn,0);
});
test('partial PATCH, SQL trigger and CSV/JSON export preserve and audit the policy flag',async t=>{
 const f=await fixture(t,{block_vpn:true});const original=current(f);await patch(f,{title:'changed'});assert.equal(current(f).block_vpn,1);
 const csv=exportCSV([(await call(f.env,'/links/'+f.link.id)).data]);const parsed=parseCSV(csv);assert.equal(String(parsed[0].block_vpn),'1');
 const prev=current(f).rule_revision;f.env.DB.sqlite.prepare('UPDATE links SET block_vpn=0 WHERE id=?').run(f.link.id);assert.equal(current(f).rule_revision,prev+1);
 f.env.DB.sqlite.prepare('UPDATE links SET redirect_count=redirect_count+1 WHERE id=?').run(f.link.id);assert.equal(current(f).rule_revision,prev+1);
 assert.equal(current(f).password_hash,original.password_hash);
 const logs=(await call(f.env,'/audit')).data.items;assert.ok(logs.some(r=>r.details.includes('block_vpn')));
});
test('CSV roundtrip and API import do not drop block_vpn',async t=>{
 const f=await fixture(t);const result=await call(f.env,'/links/import','POST',{links:[{domain_id:f.domain.id,slug:'imported',target_url:'https://example.org/',block_vpn:true}]});assert.equal(result.status,201);
 const row=f.env.DB.sqlite.prepare("SELECT * FROM links WHERE slug='imported'").get();assert.equal(row.block_vpn,1);
});
test('cross-user application token still cannot change another owner VPN policy',async t=>{
 const f=await fixture(t);const u=(await call(f.env,'/users','POST',{email:'other@example.com',role:'editor'})).data;
 const own=await call(f.env,'/tokens','POST',{name:'own token',scopes:['links:write'],expires_at:Math.floor(Date.now()/1000)+3600});
 const other=await createLink(f.env,f.domain,{slug:'other'});f.env.DB.sqlite.prepare('UPDATE links SET created_by=? WHERE id=?').run(u.id,other.id);
 const r=await call(f.env,'/links/'+other.id,'PATCH',{version:other.version,block_vpn:true},{headers:{Authorization:'Bearer '+own.data.token}});
 assert.equal(r.status,403);assert.equal(f.env.DB.sqlite.prepare('SELECT block_vpn FROM links WHERE id=?').get(other.id).block_vpn,0);
});
test('fresh final D1 check rejects a policy change occurring after proof validation',async t=>{
 const f=await fixture(t,{max_redirects:null});const c=await challenge(f);const p=await submit(f,c.token);
 const original=f.env.DB.prepare.bind(f.env.DB);let fired=false;
 f.env.DB.prepare=(sql)=>{if(sql.includes('SELECT id FROM links WHERE id=? AND version=? AND rule_revision=?')){fired=true;f.env.DB.sqlite.prepare('UPDATE links SET block_vpn=1 WHERE id=?').run(f.link.id);}return original(sql);};
 const r=await send(f,p.headers.get('location'),{headers:{cookie:p.headers.get('set-cookie').split(';')[0]}});assert.equal(r.status,503);assert.equal(fired,true);assert.equal(r.headers.get('location'),null);assert.equal(f.events.length,0);assert.equal(count(f),0);
});
for(const outcome of ['timezone','Intl unavailable'])test(`public JavaScript reports only browser Intl result: ${outcome}`,async()=>{
 const h=scriptHarness({intlThrows:outcome==='Intl unavailable'});await h.settled();
 assert.equal(h.intlCalls,1);assert.equal(h.input.value,outcome==='timezone'?'Europe/Paris':'');
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,h.form.action);
 const o=h.requests[0].options;assert.equal(o.method,'POST');assert.equal(o.credentials,'same-origin');assert.equal(o.mode,'same-origin');assert.equal(o.redirect,'manual');assert.equal(o.cache,'no-store');
 assert.deepEqual({...o.headers}, { 'content-type':'application/x-www-form-urlencoded',accept:'application/json' });
 assert.deepEqual([...o.body.keys()].sort(),['challenge','timezone']);assert.equal(o.body.get('timezone'),h.input.value);assert.equal(o.body.get('challenge'),h.challenge.value);
 assert.deepEqual(h.navigations,['/docs?utm_source=fixture&_Linro_check=1']);assert.equal(h.forms.length,0);assert.equal(h.timers.size,0);
 assert.doesNotMatch(BROWSER_JS,/request\.cf|getTimezoneOffset|localStorage|sessionStorage|userAgent|eval\(/);
});
test('GUI warnings, bilingual labels, submission and stats use distinct browser/IP sources',()=>{
 const p=new URL('../apps/admin/src/web/VPNStats.tsx',import.meta.url),source=ts.createSourceFile(p.pathname,readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const stmt=source.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(source)==='vpnLabels'));
 const js=ts.transpileModule(stmt.getText(source),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const exports={};new Function('exports',js)(exports);
 const {vpnLabels}=exports;assert.deepEqual(Object.keys(vpnLabels['zh-CN']).sort(),Object.keys(vpnLabels.en).sort());
 assert.match(vpnLabels['zh-CN'].hint,/无法保证拦截全部 VPN 用户，并且会存在错误拦截/);assert.match(vpnLabels.en.hint,/cannot block all VPNs.*incorrectly block/);
 const app=readFileSync(new URL('../apps/admin/src/web/App.tsx',import.meta.url),'utf8');assert.match(app,/block_vpn: values.get\('block_vpn'\) === 'on'/);assert.match(app,/<VPNStats locale=\{s.locale\} data=\{s.analytics\}/);assert.match(app,/ip_timezones/);
 const options=readFileSync(new URL('../apps/admin/src/web/LinkOptions.tsx',import.meta.url),'utf8');assert.match(options,/defaultChecked=\{!!link\?\.block_vpn\}/);assert.match(options,/vpnLabels\[locale\].hint/);
});
