import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAnalyticsToken } from '../scripts/verify-analytics-token.mjs';
const account = 'a'.repeat(32), token = 'fixture-not-a-real-token';

test('I2 probe validates account and token before contacting the fixed Cloudflare origin', async () => {
  let calls=0; const fetcher=async()=>{calls++;throw new Error('must not run');};
  for(const [a,t] of [['../elsewhere',token],['0'.repeat(32),token],[account,'a\r\nb'],[account,''],[account,undefined]]) await assert.rejects(()=>verifyAnalyticsToken(a,t,fetcher));
  assert.equal(calls,0);
});
test('I2 probe uses a constant SELECT with manual redirects and logs no credentials or row data', async () => {
  let calls=0;
  const r=await verifyAnalyticsToken(account,token,async(url,options)=>{
    calls++;assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`);
    assert.equal(options.redirect,'manual');assert.equal(options.method,'POST');assert.equal(options.body,'SELECT 1 AS ok FORMAT JSON');
    assert.equal(options.headers.Authorization,'Bearer '+token);assert.ok(options.signal instanceof AbortSignal);
    return Response.json({data:[{ok:1}],meta:[{name:'ok'}]});
  });
  assert.equal(r.ok,true);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(r),new RegExp(token));assert.equal(r.reason,'sql_credential_verified_dataset_not_probed');
});
for(const status of [301,302,303,307,308,401,403,429,500,503]) test(`I2 status ${status} cannot be mistaken for valid credentials and never triggers automatic retry or deletion`, async()=>{
  let n=0;const r=await verifyAnalyticsToken(account,token,async()=>{n++;return new Response('{"data":[{"ok":1}]}',{status,headers:{location:'https://evil.example/'}});});
  assert.equal(r.ok,false);assert.equal(r.status,status);assert.equal(n,1);
  if(status===429) assert.equal(r.reason,'rate_limited_inconclusive');
  if(status===401) assert.equal(r.reason,'authentication_failed');
});
test('I2 HTTP 200 requires valid expected query data and bounded actual response bytes', async()=>{
  for(const body of ['null','<html>login</html>','{"data":[]}','{"data":[{"ok":0}]}','{"data":[{"ok":true}]}','x'.repeat(9000)]) {
    assert.equal((await verifyAnalyticsToken(account,token,async()=>new Response(body))).ok,false);
  }
});
test('I2 network errors are inconclusive and never expose an exception containing the token', async()=>{
  const r=await verifyAnalyticsToken(account,token,async()=>{throw new Error('request headers: '+token);});
  assert.equal(r.reason,'network_failure_inconclusive');assert.doesNotMatch(JSON.stringify(r),new RegExp(token));
});
