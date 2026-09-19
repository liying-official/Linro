/** Minimal Chromium/Edge CDP driver using only Node >=22 built-ins. Always starts
 * its own temporary profile; never attaches to the user's existing browser.
 * No CSP, web-security, certificate or network-policy bypass flags are used. */
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

export async function until(probe, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await probe(); if (value) return value; await delay(50); }
  throw Error(message);
}
async function executable() {
  const configured = process.env.CFL_CHROMIUM_PATH;
  if (configured && !isAbsolute(configured)) throw Error('CFL_CHROMIUM_PATH must be an absolute executable path.');
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = configured ? [configured] : [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/opt/google/chrome/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ...roots.flatMap(root => [join(root, 'Google/Chrome/Application/chrome.exe'), join(root, 'Microsoft/Edge/Application/msedge.exe')]),
  ];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch {} }
  throw Error('Chromium/Chrome/Edge is required for the real CSP regression. Set CFL_CHROMIUM_PATH; missing browser is a failure, not a skipped pass.');
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map(); this.listeners = new Set();
    socket.addEventListener('message', event => {
      const value = JSON.parse(event.data);
      if (value.id) {
        const entry = this.pending.get(value.id); if (!entry) return;
        this.pending.delete(value.id); clearTimeout(entry.timer);
        if (value.error) entry.reject(Error(value.error.message)); else entry.resolve(value.result);
      } else for (const listener of this.listeners) listener(value);
    });
    socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(Error('Browser CDP disconnected')); }
      this.pending.clear();
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
}
export async function chromium() {
  const command = await executable(); const profile = await mkdtemp(join(tmpdir(), 'cf-links-chromium-'));
  const args = ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank'];
  // Explicit opt-in for an isolated root CI/container only. This does not turn
  // off CSP/web security or ignore an administrator's blocked-URL policy.
  if (process.env.CFL_CHROMIUM_NO_SANDBOX === '1') args.unshift('--no-sandbox');
  let child, cdp, stderr = '', spawnError;
  const cleanup = async () => {
    if (cdp && cdp.socket.readyState === WebSocket.OPEN) {
      try { await cdp.send('Browser.close'); } catch {} cdp.socket.close();
    }
    if (child && child.exitCode === null) {
      child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await rm(profile, { force: true, recursive: true, maxRetries: 6, retryDelay: 100 });
  };
  try {
    child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    child.on('error', error => { spawnError = error; });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-16384); });
    const info = await until(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw Error('Chromium exited before CDP was ready: ' + stderr);
      try { const lines = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); return lines.length >= 2 ? lines : null; } catch { return null; }
    }, 'Chromium did not expose its temporary CDP endpoint. ' + stderr);
    const socket = new WebSocket('ws://127.0.0.1:' + info[0] + info[1]);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    cdp = new CDP(socket); const version = await cdp.send('Browser.getVersion');
    return {
      version, command, noSandbox: process.env.CFL_CHROMIUM_NO_SANDBOX === '1', close: cleanup,
      async page(allowedOrigins, timezone = 'Asia/Tokyo') {
        const { browserContextId } = await cdp.send('Target.createBrowserContext');
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        const send = (method, params) => cdp.send(method, params, sessionId);
        const log = [], responses = [], blocked = [], failures = [];
        const listener = message => {
          if (message.sessionId !== sessionId) return;
          if (message.method === 'Log.entryAdded') log.push(message.params.entry);
          if (message.method === 'Network.responseReceived') responses.push(message.params.response);
          if (message.method === 'Network.loadingFailed') failures.push(message.params);
          if (message.method === 'Fetch.requestPaused') {
            const { requestId, request } = message.params;
            const allowed = allowedOrigins.includes(new URL(request.url).origin);
            if (!allowed) blocked.push(request.url);
            void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {});
          }
        };
        cdp.listeners.add(listener);
        for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) await send(method);
        await send('Fetch.enable', { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }] });
        await send('Emulation.setTimezoneOverride', { timezoneId: timezone });
        await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__cflCSP=[];document.addEventListener('securitypolicyviolation',e=>window.__cflCSP.push(e.effectiveDirective));" });
        const evaluate = async expression => {
          const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
          if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
          return result.result.value;
        };
        return {
          send, evaluate, log, responses, failures, blocked,
          async navigate(url) {
            if (!allowedOrigins.includes(new URL(url).origin)) throw Error('Test attempted an unapproved origin');
            const result = await send('Page.navigate', { url });
            if (result.errorText) throw Error('Browser navigation failed: ' + result.errorText);
          },
          async close() { cdp.listeners.delete(listener); await cdp.send('Target.disposeBrowserContext', { browserContextId }); },
        };
      },
    };
  } catch (error) { await cleanup(); throw error; }
}
