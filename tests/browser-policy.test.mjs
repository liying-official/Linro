import test from 'node:test'; import assert from 'node:assert/strict';
import { canonicalTimezone, observeBrowser, isTorRequest, createBrowserChallenge, validateBrowserChallenge, issueBrowserCookie, readBrowserCookie, browserCookieName } from '../.build/packages/shared/src/browser-check.js';
import { fixture, request, current, defaultCF } from './browser-fixture.mjs';
for (const [a,b,reason] of [
 ['Asia/Tokyo','Asia/Tokyo','match'],['Asia/Tokyo','Europe/London','timezone_mismatch'],
 ['America/New_York','America/Toronto','timezone_mismatch'],['Asia/Calcutta','Asia/Kolkata','match'],
 ['UTC','Etc/UTC','match'],['Etc/GMT','UTC','match'],['US/Eastern','America/New_York','match'],
 ['No/Such_Zone','Asia/Tokyo','unknown'],['Asia/Tokyo','No/Such_Zone','unknown'],
 [undefined,'Asia/Tokyo','unknown'],['Asia/Tokyo',undefined,'unknown'],['','', 'unknown'],
 ]) test(`zone comparison ${a}/${b} = ${reason}`,()=>{
  const value=observeBrowser(request('/docs',{cf:{country:'JP',timezone:a}}),b);
  assert.equal(value.reason,reason);assert.equal(value.suspected,reason==='timezone_mismatch');
 });
for (const value of [null,{},42,'none','<script>','Asia/Tokyo\n',' Asia/Tokyo','+09:00','a'.repeat(65)])
 test(`invalid timezone ${JSON.stringify(value)} is unknown, never falsely a match`,()=>assert.equal(canonicalTimezone(value),null));
test('Tor is only the trusted Cloudflare T1 field, never a header, UA or browser timezone',()=>{
 assert.equal(isTorRequest(request('/docs',{cf:{country:'T1'}})),true);
 for(const cf of [null,{country:'JP'},{country:'XX'}]) {
  const r=request('/docs',{cf,headers:{'CF-IPCountry':'T1','X-Country':'T1','user-agent':'Tor Browser'}});
  assert.equal(isTorRequest(r),false);assert.equal(observeBrowser(r,'Asia/Tokyo').tor,false);
 }
 assert.equal(observeBrowser(request('/docs',{cf:{country:'T1',timezone:'Asia/Tokyo'}}),'Asia/Tokyo').reason,'tor');
});
test('signed challenge does not contain raw IP, expected IP zone, target, password, UA or secret',async t=>{
 const f=await fixture(t);const token=await createBrowserChallenge(request('/docs',{headers:{referer:'https://ref.example/path?private=1'}}),current(f),f.env);
 const data=JSON.parse(Buffer.from(token.split('.')[0],'base64url')); const text=JSON.stringify(data);
 for(const item of ['203.0.113.31','Asia/Tokyo','example.org','private=1','/path','b'.repeat(43)])assert.ok(!text.includes(item),item);
 assert.equal(data.referrer,'ref.example');assert.equal(data.timezone,undefined);assert.equal(data.phase,'challenge');
});
for(const variation of ['signature','network','cf_zone','cf_country','query','host','id','revision','secret','phase','expired','oversized','duplicate_cookie','missing_marker'])
 test(`browser proof rejects ${variation}`,async t=>{
  const f=await fixture(t);const link=current(f), initial=request('/docs?utm_source=x');
  const token=await createBrowserChallenge(initial,link,f.env);const claims=await validateBrowserChallenge(token,initial,link,f.env);assert.ok(claims);
  if(variation==='expired')claims.exp=Math.floor(Date.now()/1000)-1;
  let cookie=(await issueBrowserCookie(claims,'Asia/Tokyo',link,f.env)).split(';')[0];
  let path='/docs?utm_source=x&_Linro_check=1';let cf=defaultCF, origin='https://go.example.com',headers={};let changedLink=link;
  if(variation==='signature')cookie=cookie.slice(0,-4)+'AAAA';
  if(variation==='network')headers['cf-connecting-ip']='203.0.113.32';
  if(variation==='cf_zone')cf={...cf,timezone:'Europe/London'};
  if(variation==='cf_country')cf={...cf,country:'US'};
  if(variation==='query')path='/docs?utm_source=changed&_Linro_check=1';
  if(variation==='host')origin='https://other.example.com';
  if(variation==='id')changedLink={...link,id:crypto.randomUUID()};
  if(variation==='revision')changedLink={...link,rule_revision:link.rule_revision+1};
  if(variation==='secret')f.env.BROWSER_CHECK_SECRET='c'.repeat(43);
  if(variation==='phase')cookie=browserCookieName(link,f.env)+'='+token;
  if(variation==='oversized')cookie+='a'.repeat(17000);
  if(variation==='duplicate_cookie')cookie+='; '+cookie;
  if(variation==='missing_marker')path='/docs?utm_source=x';
  const proof=await readBrowserCookie(request(path,{cf,origin,headers:{...headers,cookie}}),changedLink,f.env);assert.equal(proof,null);
 });
test('proof cannot extend the initial challenge expiry and remains bound to canonical query',async t=>{
 const f=await fixture(t);const r=request('/docs?utm_source=x%20y');const l=current(f);
 const token=await createBrowserChallenge(r,l,f.env);const c=await validateBrowserChallenge(token,r,l,f.env);
 const cookie=(await issueBrowserCookie(c,'Asia/Tokyo',l,f.env)).split(';')[0];
 const payload=JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[0],'base64url'));
 assert.equal(payload.exp,c.exp);assert.equal(payload.nonce,c.nonce);
 assert.equal((await readBrowserCookie(request('/docs?utm_source=x+y&_Linro_check=1',{headers:{cookie}}),l,f.env)).reason,'match');
});
