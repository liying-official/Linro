import { newTestSecret } from './fixture-credentials.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { admin, setup, call, createLink } from './harness.mjs';
import { stats, rollup } from '../.build/apps/admin/src/worker/analytics.js';

const configured = { ANALYTICS_ENABLED:'true', ANALYTICS_DATASET:'test_clicks', CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32), ANALYTICS_API_TOKEN:newTestSecret() };
async function environment(t) {
  const state = await setup(configured);
  t.after(() => state.env.DB.close());
  return state;
}

test('dashboard uses one read, validates scope before cache hits and separates credentials, windows and views',async t => {
  const { env, domain } = await environment(t);
  const a = await createLink(env,domain);
  const b = await createLink(env,domain,{slug:'second'});
  const clock = Date.now();
  let now = clock;
  t.mock.method(Date,'now',() => now);
  const upstream = t.mock.method(globalThis,'fetch',async (_,options) => Response.json({data:options.body.includes('GROUP BY date') ? [{date:'2026-11-18',clicks:3},{date:'2026-11-19',clicks:7}] : []}));
  const first = await call(env,`/stats?view=dashboard&link_ids=${a.id},${b.id}`);
  assert.equal(first.status,200); assert.equal(first.data.clicks,10);
  const reverse = await call(env,`/stats?view=dashboard&link_ids=${b.id},${a.id}`);
  assert.deepEqual(reverse.data.link_ids,[b.id,a.id]); assert.equal(upstream.mock.callCount(),1);
  await stats(env,8,[a.id,b.id],'dashboard');
  now += 15001;
  await stats(env,7,[a.id,b.id],'dashboard');
  env.ANALYTICS_API_TOKEN = newTestSecret();
  await stats(env,7,[a.id,b.id],'dashboard');
  assert.equal(upstream.mock.callCount(),4);
  assert.equal((await call(env,'/stats?view=unexpected')).status,400);
  await stats(env,7,[a.id,b.id],'full');
  assert.equal(upstream.mock.callCount(),12);
  env.DB.sqlite.prepare('DELETE FROM links WHERE id=?').run(b.id);
  assert.equal((await call(env,`/stats?view=dashboard&link_ids=${a.id},${b.id}`)).status,404);
  assert.equal(upstream.mock.callCount(),12);
});

test('all outstanding analytics queries share a deadline and a caller cancellation stops further pairs',async t => {
  const { env } = await environment(t);
  let started; let enter;
  const reset = () => {started=0; return new Promise(resolve=>{enter=resolve;});};
  const upstream = t.mock.method(globalThis,'fetch',(_,options) => new Promise((_,reject)=>{
    options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
    if (++started===2) enter();
  }));
  let pair = reset();
  const caller = new AbortController();
  const cancelled = stats(env,1,null,'full',caller.signal);
  await pair; caller.abort();
  await assert.rejects(cancelled,{status:408});
  t.mock.timers.enable({apis:['setTimeout']});
  pair=reset();
  const expired = stats(env,1,null);
  await pair; t.mock.timers.tick(10000);
  await assert.rejects(expired,{status:504});
  assert.equal(upstream.mock.callCount(),4);
});

test('400 archive groups skip the completed window and update only a corrected estimate on recheck',async t => {
  const {env,domain,user}=await environment(t);
  let time=Date.UTC(2026,10,19,1);
  t.mock.method(Date,'now',()=>time);
  const rows=Array.from({length:400},(_,i)=>({link_id:crypto.randomUUID(),date:'2026-11-18',clicks:i+1}));
  const insert=env.DB.sqlite.prepare('INSERT INTO links(id,domain_id,slug,target_url,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,1)');
  rows.forEach((r,i)=>insert.run(r.link_id,domain.id,'a'+i,'https://example.org/',user.id));
  env.DB.sqlite.exec('CREATE TABLE stats_updates(n INTEGER); CREATE TRIGGER count_stats_updates AFTER UPDATE ON daily_stats BEGIN INSERT INTO stats_updates VALUES(1); END;');
  const upstream=t.mock.method(globalThis,'fetch',async()=>Response.json({data:rows}));
  await rollup(env); await rollup(env);
  assert.equal(upstream.mock.callCount(),1);
  const count=()=>env.DB.sqlite.prepare('SELECT count(*) AS n FROM stats_updates').get().n;
  time+=6*3600000; await rollup(env);
  assert.equal(upstream.mock.callCount(),2); assert.equal(count(),0);
  rows[0].clicks=22; time+=6*3600000; await rollup(env);
  assert.equal(count(),1); assert.equal(env.DB.sqlite.prepare('SELECT clicks FROM daily_stats WHERE link_id=?').get(rows[0].link_id).clicks,22);
  env.ANALYTICS_ROLLUP_ENABLED='false'; time+=86400000; await rollup(env);
  assert.equal(upstream.mock.callCount(),3);
});

test('an older concurrent archive response cannot overwrite a completed window',async t=>{
  const {env,domain}=await environment(t);
  const link=await createLink(env,domain);
  const date=new Date(Date.now()-86400000).toISOString().slice(0,10);
  let release, entered; const first=new Promise(resolve=>{entered=resolve;});
  const response=clicks=>Response.json({data:[{link_id:link.id,date,clicks}]});
  let n=0;
  t.mock.method(globalThis,'fetch',async()=>{
    if (++n===1){entered();return new Promise(resolve=>{release=()=>resolve(response(1));});}
    return response(7);
  });
  const slow=rollup(env); await first; await rollup(env); release(); await slow;
  assert.equal(env.DB.sqlite.prepare('SELECT clicks FROM daily_stats WHERE link_id=?').get(link.id).clicks,7);
});

test('a legacy archive cursor resumes its original window, then the watermark catches up across missed days',async t=>{
  const {env}=await environment(t);
  const day=86400;
  const midnight=Date.UTC(2026,10,19)/1000;
  t.mock.method(Date,'now',()=>(midnight+3600)*1000);
  const oldEnd=midnight-5*day;
  const old={start:oldEnd-2*day,end:oldEnd,date:'2026-11-13',link_id:crypto.randomUUID()};
  env.DB.sqlite.prepare('INSERT INTO settings VALUES(?,?,?)').run('analytics_rollup_cursor',JSON.stringify(old),oldEnd);
  const queries=[];
  t.mock.method(globalThis,'fetch',async(_,options)=>{queries.push(options.body);return Response.json({data:[]});});
  for(let i=0;i<5;i++)await rollup(env);
  const ends=queries.map(sql=>Number(/timestamp < toDateTime\((\d+)\)/.exec(sql)[1]));
  assert.deepEqual(ends,[oldEnd,oldEnd+2*day,oldEnd+4*day,midnight]);
  assert.ok(queries[0].includes(old.link_id)); assert.ok(!queries[1].includes(old.link_id));
  const row=env.DB.sqlite.prepare("SELECT value FROM settings WHERE key='analytics_rollup_watermark'").get();
  assert.equal(JSON.parse(row.value).end,midnight);
});

test('only hashed JS and CSS assets get private immutable caching behind the Admin gate',async t=>{
  const {env}=await environment(t);
  let type='application/javascript';
  let status=200;
  let served=0;
  env.ASSETS={fetch:async()=>{served++;return new Response('fixture',{status,headers:{'content-type':type}});}};
  const get=path=>admin.fetch(new Request(env.ADMIN_ORIGIN+path),env);
  assert.match((await get('/assets/index-AbcD1234.js')).headers.get('cache-control'),/^private,.*immutable$/);
  type='text/css'; assert.match((await get('/assets/index-AbcD1234.css')).headers.get('cache-control'),/^private,/);
  assert.equal((await get('/assets/plain.css')).headers.get('cache-control'),'no-store');
  type='text/html'; assert.equal((await get('/assets/index-AbcD1234.js')).headers.get('cache-control'),'no-store');
  status=404; type='text/css'; assert.equal((await get('/assets/index-AbcD1234.css')).headers.get('cache-control'),'no-store');
  assert.equal((await get('/')).headers.get('cache-control'),'no-store');
  env.ENVIRONMENT='production'; env.ADMIN_ORIGIN='https://admin.example.com'; const before=served;
  const denied=await get('/assets/index-AbcD1234.js');
  assert.equal(denied.status,401); assert.equal(denied.headers.get('cache-control'),'no-store'); assert.equal(served,before);
});
