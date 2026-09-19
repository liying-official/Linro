import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createOutboundRouter } from './runtime/outbound-router.mjs';
const require=createRequire(import.meta.url); const ts=require('typescript');
const read=rel=>readFileSync(new URL('../'+rel,import.meta.url),'utf8');

test('D1 outbound router checks exact host, path, method, headers and body without external networking', async()=>{
  const r=createOutboundRouter();
  r.expect({url:'https://api.example/valid',method:'POST',headers:{authorization:'Bearer fake-fixture'},body:'SELECT 1'}, {status:200,body:'{"ok":true}'});
  const response=await r.outboundService(new Request('https://api.example/valid',{method:'POST',headers:{authorization:'Bearer fake-fixture'},body:'SELECT 1'}));
  assert.equal(response.status,200); r.assertComplete(); assert.equal(r.calls.length,1);
});
test('D1 unmatched outbound returns 599 AND teardown fails even when the handler swallows it', async()=>{
  for(const url of ['https://typo.example/valid','https://api.example/wrong']) {
    const r=createOutboundRouter(); r.expect({url:'https://api.example/valid'},{status:200});
    assert.equal((await r.outboundService(new Request(url))).status,599);
    assert.throws(()=>r.assertComplete(),/Unexpected outbound/);
  }
});
test('D1 expected-but-unused and exhausted intercepts cannot silently pass', async()=>{
  const r=createOutboundRouter();r.expect({url:'https://fixture.example/ping'},{status:200});
  assert.throws(()=>r.assertComplete(),/never made/);
  assert.equal((await r.outboundService(new Request('https://fixture.example/ping'))).status,200);r.assertComplete();
  assert.equal((await r.outboundService(new Request('https://fixture.example/ping'))).status,599);assert.throws(()=>r.assertComplete());
});
test('D1 deliberately optional redirect targets expose a follow regression through observed hits', async()=>{
  const r=createOutboundRouter();let followed=0;
  r.expect({url:'https://fixture.example/first'},{status:302,headers:{location:'https://elsewhere.invalid/target'}});
  r.expect({url:'https://elsewhere.invalid/target'},()=>{followed++;return {status:200,body:'must-not-be-used'};},{optional:true,persist:true});
  assert.equal((await r.outboundService(new Request('https://fixture.example/first'))).status,302);r.assertComplete();assert.equal(followed,0);
  await r.outboundService(new Request('https://elsewhere.invalid/target'));r.assertComplete();assert.equal(followed,1);
  // Unit test of the router's negative-control observability, not a native fetch run.
});
test('D1 body and credential values are not included in unexpected-request diagnostics', async()=>{
  const r=createOutboundRouter();await r.outboundService(new Request('https://fixture.example/',{method:'POST',headers:{authorization:'Bearer private-fixture'},body:'private-body'}));
  try{r.assertComplete();assert.fail('must fail');}catch(error){assert.doesNotMatch(String(error),/private-fixture|private-body/);}
});
test('D1 runtime loader is pinned, uses only Wrangler resolution and fails on missing or incompatible APIs',()=>{
  const pkg=JSON.parse(read('package.json'));assert.equal(pkg.devDependencies.wrangler,'4.132.0');
  const src=read('scripts/runtime-toolchain.mjs');
  assert.match(src,/createRequire/);assert.match(src,/fromWrangler\('miniflare'\)/);assert.match(src,/convertV4MiniflareOptions/);
  assert.doesNotMatch(src,/\.skip\(|globalThis\.fetch\s*=|createFetchMock/);
  const workflow=read('.github/workflows/ci.yml');assert.match(workflow,/npm run toolchain:versions/);assert.match(workflow,/npm run test:runtime/);
});
test('D1 canary must complete before semantic tests and none can skip on missing tools',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:runtime'],'npm run toolchain:versions && npm run test:runtime:canary && node --test tests/runtime/fetch-security.test.mjs tests/runtime/link-controls.test.mjs');
  for(const file of ['api-canary','fetch-security','link-controls']){
    const src=read(`tests/runtime/${file}.test.mjs`);
    assert.match(src,/new Miniflare\(convertV4MiniflareOptions\(/);
    assert.match(src,/outboundService/);assert.match(src,/assertComplete/);
    assert.doesNotMatch(src,/test\.skip|\bskip\s*:|globalThis\.fetch\s*=|createFetchMock\(/);
  }
});
test('D1 every native dispatch explicitly requests manual redirects, preserving original 3xx responses',()=>{
  let calls=0;
  for(const file of ['api-canary','fetch-security','link-controls']) {
    const source=ts.createSourceFile(file,read(`tests/runtime/${file}.test.mjs`),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const walk=node=>{
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='dispatchFetch') {
        calls++;const options=node.arguments[1];assert.ok(options&&ts.isObjectLiteralExpression(options),file);
        const redirect=options.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='redirect');
        assert.ok(redirect&&ts.isStringLiteral(redirect.initializer)&&redirect.initializer.text==='manual',file);
      }
      ts.forEachChild(node,walk);
    };walk(source);
  }
  assert.ok(calls>=18,'all native dispatches must be audited');
});
