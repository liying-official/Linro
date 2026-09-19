import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,complete,challenge,submit,send,patch} from './browser-fixture.mjs';
import {createLink} from './harness.mjs';
import {stats,rollup} from '../.build/apps/admin/src/worker/analytics.js';
for(const scope of ['all','single','multi'])test(`VPN counts and browser/IP dimensions respect ${scope} scope without double counting pages`,async t=>{
 const f=await fixture(t);f.env.ANALYTICS_DATASET='cf_links_clicks';f.env.CLOUDFLARE_ACCOUNT_ID='a'.repeat(32);f.env.ANALYTICS_API_TOKEN='only-test-query-token';
 await complete(f);await complete(f,'Europe/London');
 await createLink(f.env,f.domain,{slug:'second'});await complete(f,'Asia/Tokyo',{path:'/second',cf:{timezone:'Asia/Tokyo',country:'T1'}});
 await createLink(f.env,f.domain,{slug:'third'});await complete(f,'',{path:'/third'});
 await patch(f,{block_vpn:true});let c=await challenge(f);assert.equal((await submit(f,c.token,'Europe/London')).status,403);
 c=await challenge(f);assert.equal((await submit(f,c.token,'')).status,403);
 assert.equal((await send(f,'/docs',{cf:{country:'T1',timezone:'UTC'}})).status,403);
 // 4 final successes and 3 denials. Challenge/303 requests are not separate events.
 assert.equal(f.events.length,7);
 const second=f.env.DB.sqlite.prepare("SELECT id FROM links WHERE slug='second'").get().id;
 const ids=scope==='all'?null:scope==='single'?[f.link.id]:[f.link.id,second];
 const rows=f.events.filter(e=>!ids||ids.includes(e.indexes[0]));const chosen=rows.filter(e=>e.doubles[0]>0);
 const q=[];const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old;});
 globalThis.fetch=async(_url,opts)=>{
  const sql=opts.body;q.push(sql);
  if(ids)for(const id of ids)assert.ok(sql.includes(id));
  const sum=index=>rows.reduce((n,e)=>n+e.doubles[index],0);
  if(!sql.includes('GROUP BY'))return Response.json({data:[{clicks:sum(0),suspected_vpn_visits:sum(2),suspected_vpn_successes:rows.reduce((n,e)=>n+e.doubles[0]*e.doubles[2],0),blocked_vpn_visits:sum(3),unknown_timezone_blocks:sum(4),unknown_timezone_successes:sum(5),tor_visits:sum(6)}]});
  assert.match(sql,/AND double1 > 0/);
  const match=sql.match(/SELECT blob(\d+) AS (\w+)/);
  if(match){const counts=new Map();for(const e of chosen){const v=e.blobs[Number(match[1])-1];counts.set(v,(counts.get(v)||0)+1);}return Response.json({data:[...counts].map(([v,clicks])=>({[match[2]]:v,clicks}))});}
  return Response.json({data:[]});
 };
 const r=await stats(f.env,7,ids);assert.equal(q.length,8);
 assert.equal(r.clicks,scope==='all'?4:scope==='single'?2:3);
 assert.equal(r.suspected_vpn_visits,scope==='single'?3:4);assert.equal(r.suspected_vpn_successes,scope==='single'?1:2);
 assert.equal(r.blocked_vpn_visits,2);assert.equal(r.unknown_timezone_blocks,1);assert.equal(r.tor_visits,scope==='single'?1:2);
 assert.equal(r.timezones.find(row=>row.timezone==='Europe/London').clicks,1); // rejected mismatch excluded
 assert.equal(r.ip_timezones.find(row=>row.timezone==='Asia/Tokyo').clicks,r.clicks);
 assert.equal(r.dimension_sources.browser_timezone,'javascript_client_reported_untrusted');assert.equal(r.dimension_sources.tor,'cloudflare_request_cf_country_T1');
 assert.ok(q.every(sql=>sql.includes('_sample_interval')));
});
test('legacy events never substitute IP timezone for browser timezone or invent VPN history',async t=>{
 const f=await fixture(t);Object.assign(f.env,{ANALYTICS_DATASET:'cf_links_clicks',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),ANALYTICS_API_TOKEN:'test-only'});
 const old=fetch;t.after(()=>globalThis.fetch=old);
 globalThis.fetch=async(_url,opts)=>Response.json({data:opts.body.includes('blob9')?[{timezone:'',clicks:12}]:opts.body.includes('blob6')?[{timezone:'Asia/Tokyo',clicks:12}]:!opts.body.includes('GROUP BY')?[{clicks:12}]:[]});
 const r=await stats(f.env,1,null);assert.deepEqual(r.timezones,[{timezone:'none',clicks:12}]);assert.deepEqual(r.ip_timezones,[{timezone:'Asia/Tokyo',clicks:12}]);
 assert.equal(r.suspected_vpn_visits,0);assert.equal(r.unknown_timezone_successes,0);assert.equal(r.tor_visits,0);
});
test('daily archive excludes terminal denial events in its query and stores only success totals',async t=>{
 const f=await fixture(t);Object.assign(f.env,{ANALYTICS_DATASET:'cf_links_clicks',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),ANALYTICS_API_TOKEN:'test-only'});
 const old=fetch;t.after(()=>globalThis.fetch=old);
 globalThis.fetch=async(_u,o)=>{assert.match(o.body,/WHERE double1 > 0/);return Response.json({data:[]});};await rollup(f.env);
 assert.equal(f.env.DB.sqlite.prepare('SELECT count(*) AS n FROM daily_stats').get().n,0);
});
for(const bad of [-1,'oops',Infinity])test(`invalid VPN aggregate ${bad} fails instead of false zero`,async t=>{
 const f=await fixture(t);Object.assign(f.env,{ANALYTICS_DATASET:'cf_links_clicks',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),ANALYTICS_API_TOKEN:'test-only'});
 const old=fetch;t.after(()=>globalThis.fetch=old);globalThis.fetch=async(_u,o)=>Response.json({data:!o.body.includes('GROUP BY')?[{clicks:1,suspected_vpn_visits:String(bad)}]:[]});
 await assert.rejects(stats(f.env,7,null),/Invalid analytics counts/);
});
