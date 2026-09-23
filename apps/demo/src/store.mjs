// Public, fictional, memory-only simulator. No fetch, server, persistent data,
// credential storage, or production authentication is used by this module.
export class APIError extends Error {
  constructor(message, status = 400, code = 'demo_validation') { super(message); this.status = status; this.code = code; }
}
const scopes = {
  viewer: ['links:read', 'domains:read', 'analytics:read'],
  editor: ['links:read', 'domains:read', 'analytics:read', 'links:write', 'links:delete'],
  admin: ['links:read', 'domains:read', 'analytics:read', 'links:write', 'links:delete', 'domains:write', 'audit:read'],
  owner: ['links:read', 'domains:read', 'analytics:read', 'links:write', 'links:delete', 'domains:write', 'audit:read', 'users:write', 'settings:write'],
};
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = () => Math.floor(Date.now() / 1000);
let state, authenticated = false, role = 'owner', serial = 100;
function seed() {
  const stamp = now();
  const users = Object.keys(scopes).map((r, i) => ({ id: uid(i + 1), email: `${r}@workspace.example`, display_name: `Demo ${r}`, role: r, enabled: 1, version: 1, created_at: stamp - 86400 * 20, updated_at: stamp }));
  const domains = ['go.linro.example', 's.linro.example'].map((hostname, i) => ({ id: uid(10 + i), hostname, name: i ? 'Demo secondary' : 'Demo primary', enabled: 1, default_redirect_code: 302, version: 1, created_at: stamp - 86400 * 15, updated_at: stamp }));
  const links = ['welcome', 'release-notes', 'guide', 'protected', 'regional', 'archived', 'limited'].map((slug, i) => ({
    id: uid(20 + i), domain_id: domains[i % 2].id, slug, title: ['Welcome / 欢迎', 'Release notes / 更新说明', 'User guide / 使用指南', 'Password preview / 密码示例', 'Regional content / 地区内容', 'Expired example / 到期示例', 'Request limit / 次数示例'][i],
    description: 'Fictional demo data / 虚构演示数据', target_url: i === 1 ? '' : `https://content.example/${slug}`, response_mode: i === 1 ? 'text' : 'redirect', text_content: i === 1 ? 'Linro demo\nThis text is fictional. / 此内容为虚构演示。' : '',
    redirect_code: 302, query_mode: 'discard', enabled: 1, expires_at: i === 5 ? stamp - 86400 : null, cache_ttl: 0,
    geo_rules: i === 4 ? [{ kind: 'country', code: 'JP', target_url: 'https://content.example/jp' }] : [], password_protected: i === 3,
    max_redirects: i === 6 ? 100 : null, redirect_count: i === 6 ? 36 : 0, block_vpn: i === 4 ? 1 : 0,
    created_by: users[i % 4].id, created_at: stamp - i * 86400, updated_at: stamp - i * 3600, version: 1, rule_revision: 1,
  }));
  return { users, domains, links, tokens: [], site_name: 'Linro Demo', audit: [{ id: uid(90), actor_email: 'owner@workspace.example', action: 'demo_initialized', resource_type: 'workspace', resource_id: 'fictional', details: '{}', request_id: 'demo-only', created_at: stamp }] };
}
export function resetDemo() { state = seed(); authenticated = false; role = 'owner'; serial = 100; }
resetDemo();
export function enterDemo(password) { authenticated = password === 'Linro'; return authenticated; }
export function leaveDemo() { resetDemo(); }
export function setDemoRole(value) { if (!authenticated || !Object.hasOwn(scopes, value)) throw new APIError('Invalid demo role'); role = value; }
const user = () => state.users.find(u => u.role === role && u.enabled) ?? { id: uid(99), email: `${role}@workspace.example`, role, enabled: 1 };
const deny = (message, status = 400, code) => { throw new APIError(message, status, code); };
const requireScope = scope => { if (!scopes[role].includes(scope)) deny('当前演示角色无此权限 / Permission denied for this demo role', 403, 'forbidden'); };
const safeHost = value => typeof value === 'string' && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value) && (/\.example$/.test(value) || /(?:^|\.)example\.(?:com|net|org)$/.test(value));
function safeTarget(value) {
  let url; try { url = new URL(value); } catch { deny('请使用 https://content.example/path / Use a fictional example URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !safeHost(url.hostname)) deny('演示仅接受 .example 或 example.com/net/org 地址 / Only reserved example hosts are accepted');
  return url.href;
}
function publicLink(row) { const d = state.domains.find(d => d.id === row.domain_id); return { ...row, hostname: d?.hostname, domain_enabled: d?.enabled ?? 0, short_url: `https://${d?.hostname}/${row.slug}`, remaining_redirects: row.max_redirects === null ? null : Math.max(0, row.max_redirects - row.redirect_count) }; }
const active = row => row.enabled && state.domains.find(d => d.id === row.domain_id)?.enabled && (!row.expires_at || row.expires_at > now()) && (row.max_redirects === null || row.redirect_count < row.max_redirects);
function page(rows, query) { const p = Math.max(1, Number(query.get('page')) || 1), limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 25)); return { items: rows.slice((p - 1) * limit, p * limit), total: rows.length, page: p, limit }; }
function find(rows, id, version) { const row = rows.find(r => r.id === id); if (!row) deny('Demo record not found', 404, 'not_found'); if (version !== undefined && row.version !== Number(version)) deny('版本已变化，请刷新 / Refresh the changed version', 409, 'version_conflict'); return row; }
function owner(row) { if (!['owner', 'admin'].includes(role) && row.created_by !== user().id) deny('只能修改自己创建的演示链接 / Only your own demo links may be modified', 403, 'link_owner_required'); }
function audit(action, resource_type, id) { state.audit.unshift({ id: uid(++serial), actor_email: user().email, action, resource_type, resource_id: id, details: '{"demo":true}', request_id: 'demo-only', created_at: now() }); }
function normalize(body, old) {
  const row = { id: uid(++serial), domain_id: state.domains[0]?.id, slug: `demo-${serial}`, title: '', description: '', response_mode: 'redirect', target_url: '', text_content: '', redirect_code: 302, query_mode: 'discard', enabled: 1, expires_at: null, cache_ttl: 0, geo_rules: [], password_protected: false, max_redirects: null, redirect_count: 0, block_vpn: 0, created_by: user().id, created_at: now(), updated_at: now(), version: 1, rule_revision: 1, ...old };
  for (const field of ['domain_id','slug','title','description','response_mode','target_url','text_content','redirect_code','query_mode','enabled','expires_at','cache_ttl','geo_rules','max_redirects','block_vpn']) if (body[field] !== undefined) row[field] = body[field];
  if (!row.slug) row.slug = `demo-${serial}`;
  if (typeof row.slug !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.slug) || ['health','cdn-cgi'].includes(row.slug.toLowerCase()) || row.slug.toLowerCase().startsWith('__linro_')) deny('Invalid or reserved demo slug',400,'invalid_slug');
  find(state.domains, row.domain_id);
  if (state.links.some(l => l.id !== row.id && l.domain_id === row.domain_id && l.slug === row.slug)) deny('Duplicate demo slug', 409, 'conflict');
  if (!['redirect','text'].includes(row.response_mode)) deny('Invalid response mode');
  if (row.response_mode === 'text') { if (!row.text_content || row.text_content.length > 16384) deny('Invalid demo text'); row.target_url = ''; row.query_mode = 'discard'; row.geo_rules = []; }
  else row.target_url = safeTarget(row.target_url);
  if (!Array.isArray(row.geo_rules) || row.geo_rules.length > 32) deny('Invalid demo rules');
  row.geo_rules = row.geo_rules.map(r => ({ kind: r.kind, code: r.code, target_url: safeTarget(r.target_url) }));
  if (body.password !== undefined) { if (body.password !== null && (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128)) deny('密码至少 12 字符 / Password requires 12 characters'); row.password_protected = body.password !== null; }
  if (row.max_redirects !== null && (!Number.isSafeInteger(row.max_redirects) || row.max_redirects < 1)) deny('Invalid request limit');
  if (body.reset_redirect_count === true) row.redirect_count = 0;
  row.enabled = Number(!!row.enabled); row.block_vpn = Number(!!row.block_vpn);
  if (old) { row.version++; row.rule_revision++; }
  return row;
}
function stats(query) {
  const selected = query.get('link_ids')?.split(',') ?? (query.get('link_id') ? [query.get('link_id')] : null);
  const rows = selected ? selected.map(id => find(state.links, id)) : state.links;
  const days = Math.min(90, Math.max(1, Number(query.get('days')) || 7));
  const timeline = Array.from({ length: days }, (_, i) => ({ date: new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10), clicks: rows.length * (12 + (i * 7) % 23) }));
  const clicks = timeline.reduce((n, r) => n + r.clicks, 0);
  return { available: true, sampled: true, demo: true, days, timezone: 'UTC', link_ids: selected, clicks, timeline, top: rows.map((l, i) => ({ link_id: l.id, slug: l.slug, hostname: publicLink(l).hostname, clicks: Math.round(clicks / Math.max(rows.length, 1)) - i })), countries: [{ country: 'JP', clicks: Math.round(clicks * .45) }, { country: 'SG', clicks: Math.round(clicks * .35) }, { country: 'DE', clicks: Math.round(clicks * .2) }], referrers: [{ referrer: 'news.example', clicks: Math.round(clicks * .6) }, { referrer: 'none', clicks: Math.round(clicks * .4) }], timezones: [{ timezone: 'Asia/Tokyo', clicks: Math.round(clicks * .6) }, { timezone: 'Europe/Berlin', clicks: Math.round(clicks * .4) }], ip_timezones: [{ timezone: 'Asia/Tokyo', clicks }], devices: [{ device: 'pc', clicks: Math.round(clicks * .7) }, { device: 'mobile', clicks: Math.round(clicks * .3) }], suspected_vpn_visits: 12, suspected_vpn_successes: 7, blocked_vpn_visits: 5, unknown_timezone_blocks: 2, unknown_timezone_successes: 3, tor_visits: 1, dimension_sources: { device_header_enabled: true, browser_timezone: 'fictional_demo' }, success_scope: 'fictional_demo' };
}
function dispatch(path, method, body) {
  const [pathname, search = ''] = path.split('?'), query = new URLSearchParams(search);
  if (pathname === '/session' && method === 'GET') return { version: '1.0.1', auth_kind: 'demo', user: user(), scopes: scopes[role], site_name: state.site_name, source_url: 'https://github.com/liying-official/Linro', link_write_scope: ['owner', 'admin'].includes(role) ? 'workspace' : 'owned', analytics_configured: true, security: { queryKeys: ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'], expiredStatus: 404 }, features: { passwords_configured: true, browser_checks_configured: true, browser_timezone_collection_enabled: true, redirect_cache: true, cache_consistency: 'demo', text_responses: true, device_header_enabled: true } };
  if (pathname === '/summary' && method === 'GET') { requireScope('links:read'); return { links: state.links.length, active: state.links.filter(active).length, expired: state.links.filter(l => l.expires_at && l.expires_at <= now()).length, domains: state.domains.length }; }
  if (pathname === '/stats' && method === 'GET') { requireScope('analytics:read'); return stats(query); }
  if (pathname === '/links' && method === 'GET') {
    requireScope('links:read'); const q = (query.get('q') || '').toLowerCase(), domain = query.get('domain_id'), status = query.get('status');
    const rows = state.links.filter(l => (!q || [l.slug,l.title,l.target_url].some(v => v.toLowerCase().includes(q))) && (!domain || l.domain_id === domain) && (!status || status === 'all' || (status === 'active' ? active(l) : status === 'disabled' ? !l.enabled || !publicLink(l).domain_enabled : status === 'expired' ? l.expires_at && l.expires_at <= now() : status === 'exhausted' ? l.max_redirects !== null && l.redirect_count >= l.max_redirects : false))).map(publicLink);
    return page(rows, query);
  }
  if (pathname === '/links/import' && method === 'POST') { requireScope('links:write'); if (!Array.isArray(body.links) || !body.links.length || body.links.length > 10) deny('Demo import needs 1–10 links'); const rows = body.links.map(b => normalize(b)); if (new Set(rows.map(r => r.domain_id+'/'+r.slug)).size !== rows.length) deny('Duplicate demo slug',409); state.links.unshift(...rows); audit('import','link','demo-batch'); return { imported: rows.length, ids: rows.map(r => r.id) }; }
  if (pathname === '/links/bulk' && method === 'POST') {
    if (!['enable','disable','delete'].includes(body.action) || !Array.isArray(body.items) || body.items.length > 10) deny('Invalid demo batch'); requireScope(body.action === 'delete' ? 'links:delete' : 'links:write');
    return { results: body.items.map(item => { try { const r = find(state.links,item.id,item.version); owner(r); if (body.action === 'delete') state.links = state.links.filter(l => l.id !== r.id); else { r.enabled = Number(body.action === 'enable'); r.version++; r.rule_revision++; } audit(body.action,'link',r.id); return { id:r.id,ok:true }; } catch (e) { return { id:item.id,ok:false,...(e.code==='link_owner_required'?{forbidden:true}:{conflict:true}) }; } }) };
  }
  if (pathname === '/links' && method === 'POST') { requireScope('links:write'); const row = normalize(body); state.links.unshift(row); audit('create','link',row.id); return publicLink(row); }
  if (pathname.startsWith('/links/')) { const id = pathname.slice(7), old = find(state.links,id); requireScope(method === 'DELETE' ? 'links:delete' : method === 'PATCH' ? 'links:write' : 'links:read'); if (method === 'GET') return publicLink(old); owner(old); find(state.links,id,method === 'DELETE' ? query.get('version') : body.version); if (method === 'DELETE') { state.links=state.links.filter(l=>l.id!==id); audit('delete','link',id); return {deleted:true}; } if (method === 'PATCH') { const row=normalize(body,old);state.links[state.links.indexOf(old)]=row;audit('update','link',id);return publicLink(row); } }
  if (pathname === '/domains' && method === 'GET') { requireScope('domains:read'); return state.domains.map(d=>({...d,link_count:state.links.filter(l=>l.domain_id===d.id).length})); }
  if (pathname === '/domains' && method === 'POST') { requireScope('domains:write'); if (!safeHost(body.hostname)) deny('请使用 go.example 等保留示例域名 / Use a reserved example hostname');if(state.domains.some(d=>d.hostname===body.hostname))deny('Duplicate demo hostname',409);const row={id:uid(++serial),hostname:body.hostname,name:body.name||'',enabled:Number(body.enabled!==false),default_redirect_code:body.default_redirect_code||302,version:1,created_at:now(),updated_at:now()};state.domains.push(row);audit('create','domain',row.id);return row; }
  if (pathname.startsWith('/domains/')) {requireScope('domains:write');const row=find(state.domains,pathname.slice(9),method==='DELETE'?query.get('version'):body.version);if(method==='DELETE'){if(state.links.some(l=>l.domain_id===row.id))deny('Domain still has demo links',409,'in_use');state.domains=state.domains.filter(d=>d.id!==row.id);audit('delete','domain',row.id);return {deleted:true};}if(method==='PATCH'){for(const k of ['name','enabled','default_redirect_code'])if(body[k]!==undefined)row[k]=body[k];row.version++;audit('update','domain',row.id);return row;}}
  if (pathname === '/users') {requireScope('users:write');if(method==='GET')return state.users;if(method==='POST'){const email=String(body.email||'');if(!safeHost(email.split('@')[1])||!email.includes('@'))deny('只使用虚构示例邮箱 / Use an example email');if(state.users.some(u=>u.email===email))deny('Duplicate demo email',409);if(!Object.hasOwn(scopes,body.role||'viewer'))deny('Invalid role');const row={id:uid(++serial),email,display_name:body.display_name||'',role:body.role||'viewer',enabled:1,version:1,created_at:now(),updated_at:now()};state.users.push(row);audit('create','user',row.id);return row;}}
  if (pathname.startsWith('/users/')&&method==='PATCH') {requireScope('users:write');const row=find(state.users,pathname.slice(7),body.version);if(row.role==='owner'&&(body.enabled===false||body.role&&body.role!=='owner')&&state.users.filter(u=>u.role==='owner'&&u.enabled).length===1)deny('Keep one demo Owner',409,'last_owner');for(const k of ['display_name','role','enabled'])if(body[k]!==undefined)row[k]=body[k];row.version++;audit('update','user',row.id);return row;}
  if (pathname === '/tokens') {if(method==='GET')return state.tokens.filter(t=>t.user_id===user().id).map(({user_id,...t})=>t);if(method==='POST'){if(!Array.isArray(body.scopes)||!body.scopes.length||body.scopes.some(s=>!['links:read','links:write','links:delete','domains:read','analytics:read'].includes(s)||!scopes[role].includes(s)))deny('Invalid demo scopes',403);const id=uid(++serial),row={id,user_id:user().id,name:body.name,scopes:JSON.stringify(body.scopes),prefix:'DEMO_ONLY',expires_at:body.expires_at,revoked_at:null,created_at:now()};state.tokens.push(row);audit('create','token',id);return {id,name:body.name,token:`DEMO_ONLY_NOT_A_REAL_TOKEN_${serial}`,shown_once:true};}}
  if (pathname.startsWith('/tokens/')&&method==='DELETE') {const row=find(state.tokens.filter(t=>t.user_id===user().id&&!t.revoked_at),pathname.slice(8));row.revoked_at=now();audit('revoke','token',row.id);return {revoked:true};}
  if (pathname === '/audit'&&method==='GET') {requireScope('audit:read');return page(state.audit,query);}
  if (pathname === '/settings') {requireScope('settings:write');if(method==='GET')return [{key:'site_name',value:state.site_name},{key:'analytics_rollup_last_success',value:now()}];if(method==='PATCH'){if(typeof body.site_name!=='string'||!body.site_name.trim()||body.site_name.length>80)deny('Invalid demo workspace name');state.site_name=body.site_name;audit('update','settings','site_name');return {site_name:state.site_name};}}
  if (pathname === '/system/health'&&method==='GET') {requireScope('settings:write');return {demo:'memory_only',worker:'not_connected',database:'not_connected',analytics:'fictional',version:'1.0.1'};}
  deny('该演示未实现此操作 / Unsupported demo operation',404,'demo_not_found');
}
export async function api(path, method = 'GET', body = {}) {
  if (!authenticated) deny('Enter the public demo password',401,'demo_locked');
  return structuredClone(dispatch(path, method, body ?? {}));
}
export function previewLink(href) { try { const u=new URL(href);const row=state.links.map(publicLink).find(l=>l.hostname===u.hostname&&'/'+l.slug===u.pathname);return row?structuredClone(row):null; } catch { return null; } }
