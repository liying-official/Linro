import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, until } from './chromium-cdp.mjs';
import { listenOnLoopback } from '../loopback-port.mjs';

async function demoServer() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://fixture.invalid').pathname;
    requests.push(path);
    if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const file = path === '/demo/' ? 'index.html'
      : /^\/demo\/assets\/[A-Za-z0-9_.-]+$/.test(path) ? path.slice('/demo/'.length) : null;
    if (!file) { response.writeHead(404); response.end(); return; }
    try {
      const bytes = await readFile(new URL('../../docs/demo/' + file, import.meta.url));
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      response.writeHead(200, { 'content-type': type + '; charset=utf-8' }); response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await listenOnLoopback(server);
  return {
    origin: 'http://127.0.0.1:' + server.address().port, requests,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
  };
}

test('split admin pages and forms work in the isolated real-browser demo', { timeout: 120000 }, async t => {
  const fixture = await demoServer();
  let browser, page;
  t.after(async () => {
    try { await page?.close(); }
    finally {
      try { await browser?.close(); }
      finally { await fixture.close(); }
    }
  });
  browser = await chromium();
  page = await browser.page([fixture.origin]);
  console.log(JSON.stringify({ browser: browser.version, fixture: 'Built static demo; fictional in-memory data' }));
  await page.navigate(fixture.origin + '/demo/');
  await until(() => page.evaluate("!!document.querySelector('.demo-login input[name=code]')"), 'Demo login missing');
  await page.evaluate("[...document.querySelectorAll('.demo-languages button')].find(button => button.textContent === 'English').click();document.querySelector('input[name=code]').value=document.querySelector('#demo-access-code').textContent;document.querySelector('.demo-login form').requestSubmit();");
  const ready = name => until(() => page.evaluate(`document.querySelector('.page-heading h1')?.textContent === ${JSON.stringify(name)} && !!document.querySelector('[aria-busy="false"]')`), 'Page did not become ready: ' + name);
  await ready('Dashboard');
  const pages = {
    dashboard: 'Dashboard', links: 'Links', domains: 'Domains', analytics: 'Analytics',
    tokens: 'API Tokens', users: 'Users & Roles', audit: 'Audit Log', settings: 'Settings & Backups',
  };
  for (const [id, title] of Object.entries(pages)) await t.test('renders ' + id, async () => {
    await page.evaluate(`location.hash=${JSON.stringify(id)}`);
    await ready(title);
    assert.equal(await page.evaluate("document.querySelector('.alert.error')?.textContent ?? ''"), '');
    assert.equal(await page.evaluate("document.querySelector('#main-content')?.innerText.length > 30"), true);
  });
  await t.test('analytics picker preserves a selection across searches and applies it to the chart', async () => {
    await page.evaluate("location.hash='analytics'"); await ready('Analytics');
    await page.evaluate("document.querySelectorAll('input[name=stats-scope]')[1].click()");
    await until(() => page.evaluate("document.querySelectorAll('.link-picker input').length > 0"), 'Picker did not load');
    await page.evaluate("document.querySelector('.link-picker input').click();document.querySelector('.analytics-selection .search-form input').focus()");
    await page.send('Input.insertText', { text: 'definitely-absent-slug' });
    await page.evaluate("document.querySelector('.analytics-selection .search-form').requestSubmit()");
    await until(() => page.evaluate("document.querySelector('.link-picker p')?.textContent==='No matching links.'"), 'Search did not update results');
    assert.equal(await page.evaluate("document.querySelectorAll('.selected-links button').length"), 1);
    await page.evaluate("document.querySelector('.analytics-selection button.primary').click()");
    await until(() => page.evaluate("document.querySelector('.analytics-selection [role=status]')?.textContent.includes('Links currently viewed: 1')"), 'The selected link was not applied');
  });
  await t.test('create/edit text modal preserves its draft and handles Escape', async () => {
    await page.evaluate("location.hash='links'"); await ready('Links');
    await page.evaluate("document.querySelector('.heading-actions .primary').click();");
    await until(() => page.evaluate("!!document.querySelector('.modal input[name=slug]')"), 'Link modal missing');
    await page.evaluate("document.querySelector('input[name=slug]').value='quality-smoke';const select=document.querySelector('select[name=response_mode]');select.value='text';select.dispatchEvent(new Event('change',{bubbles:true}));");
    await until(() => page.evaluate("!!document.querySelector('textarea[name=text_content]')"), 'Text mode missing');
    await page.evaluate("document.querySelector('textarea[name=text_content]').focus();");
    await page.send('Input.insertText', { text: 'Quality smoke\n<script>literal</script>' });
    await page.evaluate("document.querySelector('.modal form').requestSubmit();");
    await until(() => page.evaluate("!document.querySelector('.modal') && [...document.querySelectorAll('.links-table tr')].some(row => row.innerText.includes('quality-smoke'))"), 'Created text link missing');
    await page.evaluate("[...document.querySelectorAll('.links-table tr')].find(row => row.innerText.includes('quality-smoke')).querySelector('button.text-button').click();");
    await until(() => page.evaluate("document.querySelector('textarea[name=text_content]')?.value === 'Quality smoke\\n<script>literal</script>'"), 'Saved text draft changed');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(() => page.evaluate("!document.querySelector('.modal')"), 'Escape failed to close the modal');
  });
  await t.test('the shared dialog contains keyboard focus and restores it to the opener on Escape', async () => {
    await page.evaluate("location.hash='links'"); await ready('Links');
    await page.evaluate("const trigger=document.querySelector('.heading-actions .primary');trigger.focus();trigger.click()");
    await until(()=>page.evaluate("document.querySelector('.modal')?.contains(document.activeElement)"),'Dialog did not receive focus');
    await page.evaluate("document.querySelector('.modal-header button').focus()");
    const key = async (name,code,modifiers=0) => {
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,windowsVirtualKeyCode:code,modifiers});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:code,modifiers});
    };
    await key('Tab',9,8);
    assert.equal(await page.evaluate("document.activeElement===document.querySelector('.modal-footer .primary')"),true);
    await key('Tab',9);
    assert.equal(await page.evaluate("document.activeElement===document.querySelector('.modal-header button')"),true);
    await key('Escape',27);
    await until(()=>page.evaluate("!document.querySelector('.modal') && document.activeElement===document.querySelector('.heading-actions .primary')"),'Focus did not return to the original button');
  });
  await t.test('nested settings page saves through demo transport and remains bilingual', async () => {
    await page.evaluate("location.hash='settings'"); await ready('Settings & Backups');
    await page.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Check service health').click()");
    await until(() => page.evaluate("document.querySelector('pre[role=status]')?.textContent.includes('not_connected')"), 'Health details missing');
    await page.evaluate("const input=document.querySelector('input[name=site_name]');input.value='Quality workspace';input.form.requestSubmit();");
    await until(() => page.evaluate("document.querySelector('.ta-breadcrumb')?.textContent.includes('Quality workspace') && !!document.querySelector('[aria-busy=\"false\"]')"), 'Settings save failed');
    assert.equal(await page.evaluate("JSON.parse(document.querySelector('pre[role=status]').textContent).database"), 'not_connected');
    await page.evaluate("[...document.querySelectorAll('.lang-switch button')].find(button => button.textContent === '简体中文').click();");
    await ready('设置与备份');
    assert.equal(await page.evaluate('document.documentElement.lang'), 'zh-CN');
  });
  assert.deepEqual(fixture.requests.filter(path => path.startsWith('/Linro/v1')), []);
  assert.deepEqual(page.blocked, []);
  assert.deepEqual(await page.evaluate('window.__cflCSP'), []);
  assert.deepEqual(page.exceptions, []);
});
