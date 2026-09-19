/** Loopback-only test bridge for REAL Chromium form navigation. This uses Node
 * and SQLite, NOT workerd/D1 cloud. It is never imported by production Workers. */
import http from 'node:http';
import { setup, createLink, call, redirect } from '../harness.mjs';
const port = Number(process.env.CFL_TEST_PORT ?? 8922);
const events = [];
const {env}=await setup({BROWSER_TIMEZONE_ENABLED:'true',BROWSER_CHECK_SECRET:'b'.repeat(43),LINK_PASSWORD_SECRET:'p'.repeat(43),PASSWORD_LIMITER:{limit:async()=>({success:true})},ANALYTICS_ENABLED:'true',ANALYTICS:{writeDataPoint:e=>events.push(e)}});
const d=(await call(env,'/domains','POST',{hostname:'127.0.0.1'})).data;
for(const [slug,fields] of [['match',{block_vpn:true}],['mismatch',{block_vpn:true}],['observed',{}],['unknown-block',{block_vpn:true}],['unknown-allow',{}],['password',{block_vpn:true,password:'test-browser-password-only'}],['tor',{block_vpn:true}]]) {
 await createLink(env,d,{slug,response_mode:'text',text_content:'Browser check final text: '+slug,target_url:'',max_redirects:20,...fields});
}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(421).end();return;}
  if(req.url==='/__test_results'){
   res.setHeader('content-type','application/json');res.end(JSON.stringify({events,rows:env.DB.sqlite.prepare('SELECT slug,redirect_count FROM links WHERE domain_id=?').all(d.id)}));return;
  }
  const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>8192)throw Error('test body too large');chunks.push(part);}
  const headers=new Headers();for(const [key,value] of Object.entries(req.headers)){if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);}
  headers.set('cf-connecting-ip','203.0.113.31');
  const request=new Request(`http://127.0.0.1:${port}`+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  Object.defineProperty(request,'cf',{value:{country:req.url.startsWith('/tor')||req.url.startsWith('/__Linro_browser/tor')?'T1':'JP',timezone:'Asia/Tokyo',continent:'AS'}});
  const r=await redirect.fetch(request,env);res.statusCode=r.status;
  for(const [key,value] of r.headers)if(key!=='set-cookie')res.setHeader(key,value);
  const cookies=r.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);
  res.end(Buffer.from(await r.arrayBuffer()));
 }catch(e){console.error(e.message);res.writeHead(500).end('bridge error');}
});
server.listen(port,'127.0.0.1',()=>console.log('READY '+port));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{env.DB.close();process.exit(0);}));
