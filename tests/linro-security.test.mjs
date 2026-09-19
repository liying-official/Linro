// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, setup, createLink, call, visit, admin, redirect } from './harness.mjs';
import { secure } from '../.build/packages/shared/src/http.js';
import { sourceURL } from '../.build/packages/shared/src/legal.js';

for (const method of ['GET','HEAD','POST','PATCH','DELETE','OPTIONS']) {
  for (const origin of ['https://evil.example','null','','https://admin.example.com:444']) {
    test(`F1 ${method} origin=${JSON.stringify(origin)} rejected before DB/JWKS`, async t=>{
      const env=environment({ENVIRONMENT:'production', ADMIN_ORIGIN:'https://admin.example.com'});t.after(()=>env.DB.close());
      for(const path of ['/Linro/v1/links','/Linro/v1/session','/Linro/v1/audit','/Linro']) {
        const response=await admin.fetch(new Request(env.ADMIN_ORIGIN+path,{method,headers:{origin,'cf-access-jwt-assertion':'not-a-jwt','sec-fetch-site':'same-origin'}}),env);
        assert.equal(response.status,403);
        assert.equal(response.headers.get('access-control-allow-origin'),null);
        assert.equal(response.headers.get('access-control-allow-credentials'),null);
        assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000; includeSubDomains');
        if(method==='HEAD')assert.equal(await response.text(),'');else assert.equal((await response.json()).error.code,'cross_origin');
      }
      assert.equal(env.DB.queries.length,0);
    });
  }
}
for(const origin of [undefined,'https://admin.example.com'])test(`F1 allowed origin ${origin??'absent'} still needs authentication`,async t=>{
 const env=environment({ENVIRONMENT:'production',ADMIN_ORIGIN:'https://admin.example.com'});t.after(()=>env.DB.close());
 const response=await admin.fetch(new Request(env.ADMIN_ORIGIN+'/Linro/v1/links',{headers:origin?{origin}:{}}),env);
 assert.equal(response.status,401);assert.equal(env.DB.queries.length,0);
});
test('F1 real signed Access GET / write and no-Origin token continue to work; static routes are still gated',async t=>{
 const env=environment({ENVIRONMENT:'production',ADMIN_ORIGIN:'https://admin.example.com',ACCESS_ISSUER:'https://linro-test.cloudflareaccess.com'});t.after(()=>env.DB.close());
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'linro-test',alg:'RS256',use:'sig'};
 const nativeFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({keys:[jwk]});};t.after(()=>globalThis.fetch=nativeFetch);
 const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 async function jwt(changes={}){const body=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({iss:env.ACCESS_ISSUER,aud:env.ACCESS_AUD,type:'app',sub:'linro-owner',email:env.BOOTSTRAP_OWNER_EMAIL,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...changes});return body+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,Buffer.from(body))).toString('base64url');}
 const signed=await jwt();
 const opts={noDev:true,headers:{'cf-access-jwt-assertion':signed}};
 const session=await call(env,'/session','GET',undefined,opts);assert.equal(session.status,200);assert.equal(session.data.site_name,'Linro');
 assert.equal((await call(env,'/domains','POST',{hostname:'go.example.com'},opts)).status,201);
 // Original CSRF still rejects a same-origin write without the custom header.
 assert.equal((await call(env,'/domains','POST',{hostname:'no.example.com'},{...opts,headers:{...opts.headers,'X-Linro-CSRF':''}})).status,403);
 const token=await call(env,'/tokens','POST',{name:'Linro protocol token',scopes:['links:read'],expires_at:Math.floor(Date.now()/1000)+3600},opts);assert.equal(token.status,201);assert.match(token.data.token,/^Linro_/);
 const service=await jwt({sub:'',email:undefined,common_name:'automation.access'});
 const res=await admin.fetch(new Request(env.ADMIN_ORIGIN+'/Linro/v1/links',{headers:{Authorization:'Bearer '+token.data.token,'cf-access-jwt-assertion':service}}),env);assert.equal(res.status,200);
 const staticResponse=await admin.fetch(new Request(env.ADMIN_ORIGIN+'/assets/index.js',{headers:{Origin:'https://evil.example'}}),env);assert.equal(staticResponse.status,401);
 assert.ok(calls>=1);
});
for(const method of ['GET','HEAD'])test(`F2 HSTS on redirect, unknown, quota, text, password and health (${method})`,async t=>{
 const {env,domain}=await setup({LINK_PASSWORD_SECRET:'p'.repeat(43)});t.after(()=>env.DB.close());
 await createLink(env,domain,{slug:'docs'});
 await createLink(env,domain,{slug:'text',response_mode:'text',text_content:'<b>Linro</b>',target_url:''});
 await createLink(env,domain,{slug:'password',password:'test-password-long'});
 await createLink(env,domain,{slug:'cap',max_redirects:1}); await visit(env,'/cap');
 for(const [path,status]of [['/docs',301],['/text',200],['/password',200],['/health',200],['/absent',404],['/cap',403],['/__Linro_assets/password.css',200],['/__Linro_assets/browser.js',200]]){
   const r=await visit(env,path,method);assert.equal(r.status,status,path);
   assert.equal(r.headers.get('strict-transport-security'),'max-age=31536000; includeSubDomains');assert.ok(r.headers.get('content-security-policy').includes("form-action 'self'"));
   if(method==='HEAD')assert.equal(await r.text(),'');
 }
});
test('F2 HTTPS failures are hardened, HTTP local responses do not set HSTS',async t=>{
 const env=environment();t.after(()=>env.DB.close());
 for(const method of ['GET','HEAD']){const res=await admin.fetch(new Request(env.ADMIN_ORIGIN+'/health',{method,headers:{'X-Linro-Dev':env.LOCAL_DEV_TOKEN}}),env);assert.equal(res.status,200);assert.equal(res.headers.get('strict-transport-security'),null);}
 const broken={...env,DB:{prepare(){throw Error('offline');}}};
 const r=await redirect.fetch(new Request('https://go.example.com/docs'),broken);assert.equal(r.status,503);assert.ok(r.headers.get('strict-transport-security'));
 const h=secure(new Response('x',{headers:{'Strict-Transport-Security':'max-age=10','Set-Cookie':'keep=value'}}),'id',new Request('http://localhost/'));
 assert.equal(h.headers.get('strict-transport-security'),null);assert.equal(h.headers.get('set-cookie'),'keep=value');
});
test('branding old default is display-only; custom workspace names are preserved',async t=>{
 const env=environment();t.after(()=>env.DB.close());
 assert.equal((await call(env,'/session')).data.site_name,'Linro');
 assert.equal(env.DB.sqlite.prepare("SELECT value FROM settings WHERE key='site_name'").get().value,'cf-links');
 assert.equal((await call(env,'/settings','PATCH',{site_name:'Team example'})).status,200);
 assert.equal((await call(env,'/session')).data.site_name,'Team example');
});
for(const value of ['javascript:alert(1)','http://example.com/source','https://user:pw@example.com/source','https://example.com/file?token=secret','https://example.com/file#x','https://example.com/<bad>','https://example.com/"bad',null])test(`source offer rejects invalid address ${String(value)}`,()=>assert.equal(sourceURL(value),''));
test('source offer is public configured metadata, not a proxy or a user-supplied target',async t=>{
 const {env,domain}=await setup({SOURCE_URL:'https://source.example.org/releases/Linro-v1.0.0.tar.gz',LINK_PASSWORD_SECRET:'p'.repeat(43)});t.after(()=>env.DB.close());
 await createLink(env,domain,{password:'long-testing-password'});
 const r=await visit(env);const text=await r.text();assert.ok(text.includes('Corresponding source'));assert.ok(text.includes(env.SOURCE_URL));assert.ok(text.includes('Linro'));
 assert.doesNotMatch(text,/cf-links|example\.org\/docs/);assert.equal(r.headers.get('location'),null);assert.ok(r.headers.get('link').includes(env.SOURCE_URL));
 assert.equal((await call(env,'/session')).data.source_url,env.SOURCE_URL);
});
