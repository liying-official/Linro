import { testPassword } from './fixture-credentials.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SQLiteD1 } from './harness.mjs';
import { migrationStatements } from './runtime/migrations.mjs';
import { webController } from './web-controller.mjs';
function controller(method, rows = [], existing = null) {
  const { app, calls } = webController({ state: { page: 'tokens', modal: method === 'submitImport' ? { type: 'import' } : { type: 'link', row: existing }, importRows: rows, domains: [{id: 'domain', hostname: 'go.example.com'}] } });
  app.calls = calls;
  return app;
}
function event(delta={}){const data=new FormData();for(const [key,value]of Object.entries({domain_id:'domain',slug:'docs',target_url:'https://example.org/',title:'Title',description:'Notes',redirect_code:'301',query_mode:'discard',cache_ttl:'0',enabled:'on',geo_rules_json:'[]',...delta}))data.set(key,value);return {preventDefault(){},currentTarget:data};}
for(const action of ['keep','set','remove'])test(`link submit ${action} sends the intended secret action without a verifier or stale count`,async()=>{
  const c=controller('submitLink',[],{id:'link',version:4,password_protected:true,redirect_count:9});
  await c.submitLink(event({password_action:action,password:testPassword,max_redirects:'12',reset_redirect_count:'on',geo_rules_json:JSON.stringify([{kind:'country',code:'JP',target_url:'https://jp.example.org/'}])}));
  const [path,method,body]=c.calls[0];assert.equal(path,'/links/link');assert.equal(method,'PATCH');assert.equal(body.version,4);assert.equal(body.max_redirects,12);assert.equal(body.reset_redirect_count,true);assert.equal(body.geo_rules[0].code,'JP');
  if(action==='keep')assert.equal(Object.hasOwn(body,'password'),false);else assert.equal(body.password,action==='remove'?null:testPassword);
  assert.equal(Object.hasOwn(body,'password_hash'),false);assert.equal(Object.hasOwn(body,'redirect_count'),false);
});
test('new form leaves caps unlimited, omits reset/password and invalid JSON fails before writing',async()=>{
  const c=controller('submitLink');await c.submitLink(event());const body=c.calls[0][2];assert.equal(body.max_redirects,null);assert.equal(Object.hasOwn(body,'reset_redirect_count'),false);assert.equal(Object.hasOwn(body,'password'),false);
  const bad=controller('submitLink');await bad.submitLink(event({geo_rules_json:'bad'}));assert.equal(bad.calls.length,0);assert.match(bad.state.modalError,/Invalid geographic/);
});

test('GUI preserves independent KV cache values through forms and import',async()=>{
  for(const [value,expected] of [['',null],['0',0],['3600',3600]]){
    const c=controller('submitLink');await c.submitLink(event({kv_cache_ttl:value,cache_ttl:'30'}));
    assert.equal(c.calls[0][2].kv_cache_ttl,expected);assert.equal(c.calls[0][2].cache_ttl,30);
  }
  const c=controller('submitImport',[{target_url:'https://example.org/',kv_cache_ttl:'3600',cache_ttl:'30'},{target_url:'https://example.org/other',slug:'other',kv_cache_ttl:'0'}]);
  await c.submitImport(event());assert.deepEqual(c.calls[0][2].links.map(l=>l.kv_cache_ttl),[3600,0]);
  for(const value of ['bad',false,1,59,86401]){
    const bad=controller('submitImport',[{target_url:'https://example.org/',kv_cache_ttl:value}]);await bad.submitImport(event());assert.equal(bad.calls.length,0);assert.match(bad.state.modalError,/KV cache time/);
  }
});
for(const locale of ['en','zh-CN'])test(`protected export without a replacement password is refused before any import batch (${locale})`,async()=>{
  const c=controller('submitImport',[{target_url:'https://example.org/',password_protected:true}]);c.state.locale=locale;await c.submitImport(event());assert.equal(c.calls.length,0);assert.equal(c.state.mutationPending,false);assert.match(c.state.modalError,locale==='en'?/password protected/:/密码保护/);
});
test('import handler retains regional/cap settings and new password, never source counter, owner or verifier',async()=>{
  const c=controller('submitImport',[{hostname:'go.example.com',slug:'regional',target_url:'https://example.org/',geo_rules:'[{"kind":"continent","code":"AS","target_url":"https://asia.example.org/"}]',password_protected:'true',password:testPassword,max_redirects:'40',redirect_count:39,rule_revision:123,password_hash:'forbidden',created_by:'someone'}]);
  await c.submitImport(event());const [path,method,body]=c.calls[0];assert.equal(path,'/links/import');assert.equal(method,'POST');const link=body.links[0];assert.equal(link.password,testPassword);assert.equal(link.max_redirects,40);assert.equal(link.geo_rules[0].kind,'continent');for(const field of ['redirect_count','rule_revision','password_hash','created_by','password_protected'])assert.equal(Object.hasOwn(link,field),false);assert.equal(c.state.importDone,1);
});
test('native fixture SQL statement splitting executes all three real migrations without splitting triggers',()=>{
  const db=new SQLiteD1(':memory:',false);
  try{for(const name of ['0001_initial.sql','0002_link_controls.sql','0003_text_responses.sql'])for(const sql of migrationStatements(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8')))db.sqlite.prepare(sql).run();
    assert.ok(db.sqlite.prepare('PRAGMA table_info(links)').all().some(c=>c.name==='max_redirects'));assert.ok(db.sqlite.prepare('PRAGMA table_info(links)').all().some(c=>c.name==='response_mode'));assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger'").get().n,3);
  }finally{db.close();}
});

test('GUI import byte-packs ten maximum-length text rows below the unchanged API limit', async()=>{
  const rows=Array.from({length:10},(_,i)=>({slug:'long'+i,response_mode:'text',text_content:'é'.repeat(16384),geo_rules:[],query_mode:'discard'}));
  const c=controller('submitImport',rows);await c.submitImport(event());
  assert.equal(c.calls.length,2);assert.equal(c.state.importDone,10);
  const result=[];for(const [path,verb,body] of c.calls){assert.equal(path,'/links/import');assert.equal(verb,'POST');assert.ok(new TextEncoder().encode(JSON.stringify(body)).length<=262144);assert.ok(body.links.length<=10);result.push(...body.links);}
  assert.equal(result.length,10);assert.deepEqual(result.map(x=>x.slug),rows.map(x=>x.slug));assert.ok(result.every(x=>x.text_content==='é'.repeat(16384)));
});
test('one oversized import row is rejected before committing any preceding valid batch',async()=>{
  const c=controller('submitImport',[{slug:'safe',response_mode:'text',text_content:'safe'}, {slug:'oversized',response_mode:'text',text_content:'x'.repeat(262144)}]);
  await c.submitImport(event());assert.equal(c.calls.length,0);assert.match(c.state.modalError,/256 KiB/);assert.equal(c.state.mutationPending,false);assert.equal(c.state.importDone,0);
});
