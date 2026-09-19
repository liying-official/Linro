import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditLinks } from '../scripts/security-audit.mjs';
const c = {account_id:'a'.repeat(32), database_id:'11111111-1111-4111-8111-111111111111',admin_host:'admin.example.com',redirect_hosts:['go.example.com'],access_issuer:'https://audit.cloudflareaccess.com',access_aud:'a'.repeat(64),owner_email:'owner@example.com'};
const row = (extra={}) => ({id:'one',domain_id:'d',slug:'docs',target_url:'https://example.org/docs',query_mode:'discard',created_by:'owner',cache_ttl:0,expires_at:null,...extra});
test('offline audit leaves safe data unchanged and uses secure defaults', () => {const data={links:[row()]};const before=JSON.stringify(data);assert.equal(auditLinks(data,c).flagged,0);assert.equal(JSON.stringify(data),before);});
test('offline audit identifies query, private, admin, managed and null ownership without emitting target secrets', () => {
  const data={links:[row({slug:'oauth',target_url:'https://example.org/oauth?token=DO_NOT_LOG',query_mode:'replace',created_by:null}),row({slug:'private',target_url:'http://192.168.1.1/private-secret'}),row({slug:'admin',target_url:'https://admin.example.com/x'}),row({slug:'chain',target_url:'https://go.example.com/y'})]};
  const r=auditLinks(data,c);assert.equal(r.flagged,4);assert.deepEqual(r.findings[0].codes,['sensitive_target_forced_discard','owner_null_or_missing']);assert.ok(r.findings[1].codes.includes('private_target_blocked'));assert.ok(r.findings[2].codes.includes('admin_target_blocked'));assert.ok(r.findings[3].codes.includes('managed_target_blocked'));assert.doesNotMatch(JSON.stringify(r),/DO_NOT_LOG|private-secret|192\.168|token=/);
});
test('offline audit honors exact exceptions but never treats them as an admin/managed bypass', () => {assert.equal(auditLinks([row({target_url:'http://192.168.1.1/'})],{...c,private_target_allowlist:['192.168.1.1']}).flagged,0);assert.throws(()=>auditLinks([], {...c,private_target_allowlist:['admin.example.com']}));});
test('offline audit distinguishes case collisions, caches, expiry and reviewed forwarding', () => {const r=auditLinks([row({slug:'Docs',cache_ttl:30,expires_at:1}),row({slug:'docs',query_mode:'merge'})],c);assert.equal(r.flagged,2);assert.ok(r.findings[0].codes.includes('case_collision_review'));assert.ok(r.findings[0].codes.includes('client_cache_revocation_delay'));assert.ok(r.findings[0].codes.includes('expiry_now_404'));assert.ok(r.findings[1].codes.includes('forward_allowlist_review'));assert.ok(!auditLinks([row({expires_at:1})],{...c,expired_link_status:410}).flagged);});
test('offline audit bounds rows and rejects malformed exports', () => {for(const data of [null,{}, {links:[null]},Array.from({length:10001},()=>row())])assert.throws(()=>auditLinks(data,c));assert.ok(auditLinks([row()], undefined).limitations.includes('Without --config'));});
test('offline CLI returns review-required exit 2 without changing input or creating an output database', async t => {const dir=await mkdtemp(join(tmpdir(),'cfl-audit-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'input.json');const bytes=JSON.stringify({links:[row({query_mode:'merge'})]});await writeFile(file,bytes);const proc=spawnSync(process.execPath,['scripts/security-audit.mjs','--input',file],{encoding:'utf8'});assert.equal(proc.status,2,proc.stderr);assert.equal(JSON.parse(proc.stdout).flagged,1);assert.equal(await readFile(file,'utf8'),bytes);});

test('offline audit reviews regional targets and protected exports without disclosing new secrets', () => {
  const data = [row({geo_rules:[{kind:'country',code:'JP',target_url:'http://192.168.1.8/private?secret=DO_NOT_PRINT'}],password_protected:true}), row({geo_rules:[{kind:'country',code:'CN',target_url:'https://id.example/oauth?token=DO_NOT_PRINT'}],query_mode:'merge'})];
  const r=auditLinks(data,c);assert.equal(r.flagged,2);assert.ok(r.findings[0].codes.includes('geo_private_target_blocked'));assert.ok(r.findings[0].codes.includes('protected_export_requires_new_password_on_import'));assert.ok(r.findings[1].codes.includes('geo_sensitive_target_forced_discard'));assert.doesNotMatch(JSON.stringify(r),/DO_NOT_PRINT|192\.168|token=/);
});
test('offline audit reports malformed geographic rules and invalid limits instead of claiming a clean export',()=>{
  const r=auditLinks([row({geo_rules:'invalid',max_redirects:0})],c);assert.ok(r.findings[0].codes.includes('invalid_geo_rules'));assert.ok(r.findings[0].codes.includes('invalid_redirect_limit'));
});

test('offline audit flags old slugs newly reserved for control endpoints without rewriting them',()=>{const data=[row({slug:'__Linro_legacy'})];assert.ok(auditLinks(data,c).findings[0].codes.includes('reserved_control_namespace'));assert.equal(data[0].slug,'__Linro_legacy');});
