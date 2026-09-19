import test from 'node:test';
import assert from 'node:assert/strict';
import { featureFixture, call, createLink, patch, request, row, count, unlock, cookie, PASSWORD, PEPPER, noTarget } from './feature-helpers.mjs';
import { hashLinkPassword, verifyLinkPassword, validPasswordHash, hasUnlockCookie, issueUnlockCookie, UNLOCK_SECONDS } from '../.build/packages/shared/src/link-password.js';
import { publicLocale } from '../.build/apps/redirect/src/public-pages.js';
import { exportCSV, parseCSV } from '../.build/apps/admin/src/web/csv.js';
const EN='This link has reached its request limit. Please contact the administrator.';
const ZH='此链接请求次数已到达上限，请联系管理员';

test('password verifier has a fresh salt, pepper-bound PBKDF2 and no plaintext; wrong passwords/pepper do not verify', async () => {
  const env={LINK_PASSWORD_SECRET:PEPPER}; const a=await hashLinkPassword(PASSWORD,env), b=await hashLinkPassword(PASSWORD,env);
  assert.ok(validPasswordHash(a)); assert.notEqual(a,b); assert.ok(!a.includes(PASSWORD));
  assert.equal(await verifyLinkPassword(PASSWORD,a,env),true);
  assert.equal(await verifyLinkPassword('wrong but long password',a,env),false);
  assert.equal(await verifyLinkPassword(PASSWORD,a,{LINK_PASSWORD_SECRET:'B'.repeat(43)}),false);
  await assert.rejects(verifyLinkPassword(PASSWORD,'v1$pbkdf2-sha256$1$a$b',env),e=>e.code==='invalid_password_record');
});
test('setting passwords needs a secret and 12–128 non-control characters; invalid writes are not audited', async t => {
  const {env,domain}=await featureFixture(t); const before=env.DB.sqlite.prepare('SELECT count(*) AS n FROM audit_logs').get().n;
  for (const password of ['', 'short', 'a'.repeat(129), 'long password\nwrong', 123]) {
    const r=await call(env,'/links','POST',{domain_id:domain.id,slug:'badpwd',target_url:'https://example.org/',password}); assert.equal(r.status,400);
  }
  delete env.LINK_PASSWORD_SECRET;
  const r=await call(env,'/links','POST',{domain_id:domain.id,slug:'badpwd',target_url:'https://example.org/',password:PASSWORD}); assert.equal(r.status,503);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM audit_logs').get().n,before);
  await createLink(env,domain); assert.equal((await request(env)).status,301);
});
test('protected JSON/CSV exports, lists, public pages and audit logs never expose password or verifier', async t => {
  const {env,domain}=await featureFixture(t); const link=await createLink(env,domain,{password:PASSWORD});
  assert.equal(link.password_protected,true); assert.equal(Object.hasOwn(link,'password_hash'),false);
  const stored=row(env,link.id).password_hash;
  const list=await call(env,'/links'), detail=await call(env,'/links/'+link.id), page=await request(env);
  const audit=env.DB.sqlite.prepare('SELECT details FROM audit_logs').all().map(r=>r.details).join('');
  for(const value of [JSON.stringify(link),JSON.stringify(list.body),JSON.stringify(detail.body),exportCSV(list.data.items),audit,await page.text()]) {
    assert.ok(!value.includes(PASSWORD)); assert.ok(!value.includes(stored)); assert.ok(!value.includes('pbkdf2-sha256'));
  }
  assert.equal(parseCSV(exportCSV(list.data.items))[0].password_protected,'true');
});
test('password page is bilingual, escaped, no-store and reveals no target; HEAD has no response body', async t => {
  const {env,domain}=await featureFixture(t); await createLink(env,domain,{password:PASSWORD});
  for(const [lang,text] of [['zh-CN','请输入访问密码'],['en','Enter the access password']]) {
    const r=await request(env,'/docs?_Linro_lang='+lang+'&x=%22%3E%3Cscript%3E'); await noTarget(r,200);
    const body=await r.text(); assert.ok(body.includes(text)); assert.ok(!body.includes('https://example.org/docs')); assert.ok(!body.includes('<script>')); assert.ok(body.includes('/__Linro_assets/password.css'));
    assert.match(r.headers.get('content-security-policy'),/default-src 'self'/);
    assert.doesNotMatch(r.headers.get('content-security-policy'),/unsafe-inline|unsafe-eval/);
  }
  const head=await request(env,'/docs',{method:'HEAD'}); await noTarget(head,200); assert.equal(await head.text(),'');
  const css=await request(env,'/__Linro_assets/password.css'); assert.equal(css.status,200); assert.match(css.headers.get('content-type'),/text\/css/);
});
for(const code of [301,302,307,308]) test(`password POST only redirects locally with 303; authenticated GET uses ${code} and no password body`, async t => {
  const {env,domain}=await featureFixture(t,{kv:true}); const link=await createLink(env,domain,{password:PASSWORD,redirect_code:code,max_redirects:2,cache_ttl:3600});
  const res=await unlock(env); assert.equal(res.status,303); assert.equal(res.headers.get('location'),'/docs'); assert.equal(count(env,link.id),0);
  assert.match(res.headers.get('set-cookie'),/HttpOnly/); assert.match(res.headers.get('set-cookie'),/SameSite=Lax/); assert.match(res.headers.get('set-cookie'),/Max-Age=900/);
  const final=await request(env,'/docs',{headers:{cookie:cookie(res)}}); assert.equal(final.status,code); assert.equal(final.headers.get('location'),'https://example.org/docs'); assert.match(final.headers.get('cache-control'),/no-store/); assert.equal(count(env,link.id),1);
  const head=await request(env,'/docs',{method:'HEAD',headers:{cookie:cookie(res)}}); assert.equal(head.status,code); assert.equal(await head.text(),''); assert.equal(count(env,link.id),2);
});
test('incorrect password, malformed form, wrong origin and oversized body cannot spend quota or reveal Location', async t => {
  const {env,domain}=await featureFixture(t); const link=await createLink(env,domain,{password:PASSWORD,max_redirects:3});
  await noTarget(await unlock(env,'docs','wrong password long enough'),401);
  await noTarget(await unlock(env,'docs',PASSWORD,{origin:'https://external.example'}),403);
  await noTarget(await unlock(env,'docs',PASSWORD,{'sec-fetch-site':'cross-site'}),403);
  for(const [body,contentType,expected] of [['password=x&password=y','application/x-www-form-urlencoded',400],['password=x&extra=x','application/x-www-form-urlencoded',400],['{}','application/json',415],['password='+ 'a'.repeat(8200),'application/x-www-form-urlencoded',413]]) {
    await noTarget(await request(env,'/__Linro_unlock/docs',{method:'POST',headers:{origin:'https://go.example.com','content-type':contentType},body}),expected);
  }
  const missingOrigin=await request(env,'/__Linro_unlock/docs',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'password='+PASSWORD}); await noTarget(missingOrigin,403);
  assert.equal(count(env,link.id),0);
});
test('password rate limit precedes expensive verification and uses one hashed IP bucket across slugs', async t => {
  const {env,domain}=await featureFixture(t); await createLink(env,domain,{password:PASSWORD}); await createLink(env,domain,{slug:'other',password:PASSWORD});
  const keys=[]; env.PASSWORD_LIMITER={limit:async ({key})=>{keys.push(key);return {success:false};}};
  for(const slug of ['docs','other']) await noTarget(await unlock(env,slug,PASSWORD,{'cf-connecting-ip':'192.0.2.25'}),429);
  assert.equal(keys[0],keys[1]); assert.ok(!keys[0].includes('192.0.2.25'));
  env.PASSWORD_LIMITER={limit:async()=>{throw new Error('fixture');}}; await noTarget(await unlock(env),503);
});
test('production missing secret/limiter and HTTP fail closed, secure cookie has host prefix', async t => {
  const {env,domain}=await featureFixture(t); const link=await createLink(env,domain,{password:PASSWORD});
  const prod={...env,ENVIRONMENT:'production',ADMIN_ORIGIN:'https://admin.example.com'};
  const secureCookie=await issueUnlockCookie(row(env,link.id),'go.example.com',prod); assert.match(secureCookie,/^__Host-/); assert.match(secureCookie,/; Secure/);
  delete prod.LINK_PASSWORD_SECRET; await noTarget(await request(prod),503); prod.LINK_PASSWORD_SECRET=PEPPER;
  delete prod.PASSWORD_LIMITER; await noTarget(await unlock(prod),503);
  const {redirect}=await import('./harness.mjs'); await noTarget(await redirect.fetch(new Request('http://go.example.com/docs'),prod),400);
});
test('unlock cookie is bound to host, link, revision, signature and expiry; duplicates are rejected', async t => {
  const {env,domain}=await featureFixture(t); const a=await createLink(env,domain,{password:PASSWORD}), b=await createLink(env,domain,{slug:'other',password:PASSWORD});
  const c=cookie(await unlock(env)); const req=(value,host='go.example.com')=>new Request('https://'+host+'/docs',{headers:{cookie:value}});
  assert.equal(await hasUnlockCookie(req(c),row(env,a.id),env),true);
  assert.equal(await hasUnlockCookie(req(c+'; '+c),row(env,a.id),env),false);
  assert.equal(await hasUnlockCookie(req('malformed cookie header'),row(env,a.id),env),false);
  assert.equal(await hasUnlockCookie(req(c),row(env,b.id),env),false);
  assert.equal(await hasUnlockCookie(req(c,'other.example'),row(env,a.id),env),false);
  assert.equal(await hasUnlockCookie(req(c+'A'),row(env,a.id),env),false);
  const original=Date.now; try { Date.now=()=>original()+ (UNLOCK_SECONDS+1)*1000; assert.equal(await hasUnlockCookie(req(c),row(env,a.id),env),false); } finally {Date.now=original;}
  await patch(env,a,{title:'Changed'}); assert.equal(await hasUnlockCookie(req(c),row(env,a.id),env),false);
});
test('password changes revoke old cookies; removal is explicit and does not affect the limit counter', async t => {
  const {env,domain}=await featureFixture(t,{kv:true}); const link=await createLink(env,domain,{password:PASSWORD,max_redirects:4});
  const c=cookie(await unlock(env)); assert.equal((await request(env,'/docs',{headers:{cookie:c}})).status,301);
  await patch(env,link,{password:'another long fixture password'});
  await noTarget(await request(env,'/docs',{headers:{cookie:c}}),200); await noTarget(await unlock(env),401);
  await patch(env,link,{password:null}); assert.equal((await request(env)).status,301); assert.equal(count(env,link.id),2);
});
test('read-only password metadata and counters cannot be mass-assigned or imported as raw hashes', async t => {
  const {env,domain}=await featureFixture(t); const link=await createLink(env,domain);
  for(const body of [{password_hash:'fake'},{password_protected:true},{redirect_count:0},{rule_revision:1}]) {
    const r=await call(env,'/links/'+link.id,'PATCH',{version:1,...body}); assert.equal(r.status,400);
    const imp=await call(env,'/links/import','POST',{links:[{domain_id:domain.id,slug:'new',target_url:'https://example.org/',...body}]}); assert.equal(imp.status,400);
  }
});

for(const kv of [false,true]) test(`100 concurrent requests respect an exact 7-redirect D1 cap (${kv?'KV-first':'D1-only'})`,async t=>{
  const {env,domain}=await featureFixture(t,{kv}); const link=await createLink(env,domain,{max_redirects:7});
  const responses=await Promise.all(Array.from({length:100},()=>request(env)));
  assert.equal(responses.filter(r=>r.status===301).length,7); assert.equal(responses.filter(r=>r.status===403).length,93); assert.equal(count(env,link.id),7);
  for(const res of responses) if(res.status===403) {assert.equal(res.headers.get('location'),null);assert.equal(await res.text(),EN);}
  assert.equal(row(env,link.id).rule_revision,1); // no invalidation storm on every count
});
test('only final authorized redirects count: HEAD counts once; internal unlock, challenge, unknown, expired and disabled do not',async t=>{
  const {env,domain}=await featureFixture(t); const link=await createLink(env,domain,{password:PASSWORD,max_redirects:5});
  await request(env); await request(env,'/health'); await request(env,'/__Linro_assets/password.css'); await request(env,'/missing');
  const c=cookie(await unlock(env)); assert.equal(count(env,link.id),0);
  assert.equal((await request(env,'/docs',{method:'HEAD',headers:{cookie:c}})).status,301); assert.equal(count(env,link.id),1);
  await patch(env,link,{enabled:false}); await request(env); assert.equal(count(env,link.id),1);
  await patch(env,link,{enabled:true,expires_at:Math.floor(Date.now()/1000)+60});
  env.DB.sqlite.prepare('UPDATE links SET expires_at=? WHERE id=?').run(Math.floor(Date.now()/1000)-1,link.id);
  await request(env); assert.equal(count(env,link.id),1);
});
test('quota exhaustion returns exact Chinese/English text, no Location, no cache; HEAD has no body',async t=>{
  const {env,domain}=await featureFixture(t); await createLink(env,domain,{max_redirects:1,cache_ttl:3600});
  assert.match((await request(env)).headers.get('cache-control'),/no-store/);
  for(const [path,headers,text,language] of [['/docs',{'accept-language':'zh-CN, en;q=0.5'},ZH,'zh-CN'],['/docs',{'accept-language':'zh;q=0.2,en-US;q=0.9'},EN,'en'],['/docs?_Linro_lang=zh-CN',{'accept-language':'en'},ZH,'zh-CN'],['/docs?_Linro_lang=en',{'accept-language':'zh'},EN,'en']]) {
    const r=await request(env,path,{headers}); await noTarget(r,403); assert.equal(await r.text(),text); assert.equal(r.headers.get('content-language'),language);
  }
  const head=await request(env,'/docs',{method:'HEAD'}); await noTarget(head,403); assert.equal(await head.text(),'');
});
test('cap changes preserve use, unlimited pauses counting, reset is explicit, and exhausted filter agrees with summary',async t=>{
  const {env,domain}=await featureFixture(t); const link=await createLink(env,domain,{max_redirects:3});
  await request(env); await request(env); await patch(env,link,{title:'edit',max_redirects:1}); await noTarget(await request(env),403); assert.equal(count(env,link.id),2);
  assert.equal((await call(env,'/links?status=exhausted')).data.total,1); assert.equal((await call(env,'/summary')).data.active,0);
  await patch(env,link,{max_redirects:null}); await request(env); assert.equal(count(env,link.id),2);
  await patch(env,link,{max_redirects:2}); await noTarget(await request(env),403);
  await patch(env,link,{reset_redirect_count:true}); assert.equal(count(env,link.id),0); assert.equal((await request(env)).status,301);
  const audit=env.DB.sqlite.prepare("SELECT details FROM audit_logs WHERE action='update'").all().map(r=>JSON.parse(r.details)); assert.ok(audit.some(r=>r.reset_redirect_count===true));
});
test('invalid zero, fractional and excessive caps are rejected rather than accidentally treated as unlimited',async t=>{
  const {env,domain}=await featureFixture(t);
  for(const max of [0,-1,1.5,1000000001,'2',true]) {const r=await call(env,'/links','POST',{domain_id:domain.id,slug:'bad',target_url:'https://example.org/',max_redirects:max}); assert.equal(r.status,400,JSON.stringify(max));}
});
test('quota conditional write refuses configuration changes racing an authorized snapshot',async t=>{
  const {env,domain}=await featureFixture(t); const link=await createLink(env,domain,{max_redirects:2}); const original=env.DB.prepare.bind(env.DB); let fired=false;
  env.DB.prepare=sql=>{if(sql.startsWith('UPDATE links SET redirect_count=')&&!fired){fired=true;env.DB.sqlite.prepare('UPDATE links SET enabled=0 WHERE id=?').run(link.id);}return original(sql);};
  await noTarget(await request(env),503); assert.equal(count(env,link.id),0);
});
test('an ordinary PATCH never replaces a concurrently advanced counter with its earlier snapshot',async t=>{
  const {env,domain}=await featureFixture(t); const link=await createLink(env,domain,{max_redirects:4}); const original=env.DB.batch.bind(env.DB); let fired=false;
  env.DB.batch=async statements=>{if(!fired && statements[0].sql?.startsWith('UPDATE links SET domain_id=')){fired=true;env.DB.sqlite.prepare('UPDATE links SET redirect_count=redirect_count+1 WHERE id=?').run(link.id);}return original(statements);};
  await patch(env,link,{title:'simultaneous edit'}); assert.equal(count(env,link.id),1);
});
test('counter commit ambiguity is never retried or allowed fail-open; consumption is conservative',async t=>{
  const {env,domain}=await featureFixture(t); const link=await createLink(env,domain,{max_redirects:1}); const original=env.DB.prepare.bind(env.DB); let writes=0;
  env.DB.prepare=sql=>{
    const statement=original(sql);
    if(!sql.startsWith('UPDATE links SET redirect_count='))return statement;
    const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values); const first=bound.first.bind(bound);bound.first=async()=>{writes++;await first();throw new Error('simulated lost commit acknowledgement');};return bound;};return statement;
  };
  await noTarget(await request(env),503); assert.equal(writes,1); assert.equal(count(env,link.id),1); await noTarget(await request(env),403);
});
test('rate denial and destination-validation errors precede quota reservation',async t=>{
  const {env,domain}=await featureFixture(t); const link=await createLink(env,domain,{max_redirects:2});
  env.REDIRECT_LIMITER={limit:async()=>({success:false})}; await noTarget(await request(env),429); assert.equal(count(env,link.id),0);
  env.REDIRECT_LIMITER={limit:async()=>({success:true})}; env.DB.sqlite.prepare('UPDATE links SET target_url=? WHERE id=?').run('http://127.0.0.1/',link.id); await noTarget(await request(env),503); assert.equal(count(env,link.id),0);
});
test('Analytics errors after a permitted redirect do not erase quota usage or turn the response into failure',async t=>{
  let events=0;const {env,domain}=await featureFixture(t,{ANALYTICS_ENABLED:'true',ANALYTICS:{writeDataPoint(){events++;throw new Error('fixture');}}});
  const link=await createLink(env,domain,{max_redirects:2}); assert.equal((await request(env)).status,301); assert.equal((await request(env,'/docs',{method:'HEAD'})).status,301); assert.equal(count(env,link.id),2); assert.equal(events,1);
});
test('public language negotiation handles q=0, unsupported and malformed preferences safely',()=>{
  for(const [header,expected] of [['zh;q=0,en;q=1','en'],['en;q=0,zh;q=0.5','zh-CN'],['fr,de','en'],['zh;q=bogus,en','en'],['zh-Hant','zh-CN']]) assert.equal(publicLocale(new Request('https://go.example/docs',{headers:{'accept-language':header}})),expected);
});
