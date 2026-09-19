import vm from 'node:vm';
import { BROWSER_JS } from '../.build/apps/redirect/src/browser-page.js';

/** Controller-only DOM surface. This does NOT execute CSP; the Chromium suite
 * separately tests real navigation and browser-generated request headers. */
export function scriptHarness({ timezone = 'Europe/Paris', intlThrows = false, action = 'https://go.example.com/__Linro_browser/docs?utm_source=fixture', fetcher } = {}) {
  const requests = [], navigations = [], forms = [], tasks = [], timers = new Map();
  const error = { hidden: true }; let calls = 0, timerId = 0, requestSubmits = 0;
  class HTMLInputElement { constructor(value = '') { this.value = value; } }
  const input = new HTMLInputElement(), challenge = new HTMLInputElement('signed-fixture-challenge');
  class HTMLFormElement {
    action = action;
    attributes = new Map();
    elements = { namedItem: name => name === 'timezone' ? input : name === 'challenge' ? challenge : null };
    listeners = [];
    addEventListener(type, callback) { if (type !== 'submit') throw Error('Unexpected listener'); this.listeners.push(callback); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    requestSubmit() {
      requestSubmits++;
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const listener of this.listeners) tasks.push(Promise.resolve(listener(event)));
      if (!event.defaultPrevented) forms.push({ action: this.action, timezone: input.value, challenge: challenge.value });
    }
  }
  const form = new HTMLFormElement();
  const document = { getElementById: name => name === 'browser-check' ? form : name === 'browser-error' ? error : null };
  Object.defineProperty(document, 'cookie', { get() { throw Error('The script must not read cookies'); } });
  const location = { origin: 'https://go.example.com', href: 'https://go.example.com/docs?utm_source=fixture', assign: next => navigations.push(next) };
  const context = {
    HTMLInputElement, HTMLFormElement, document, location, URL, URLSearchParams, AbortController,
    Intl: { DateTimeFormat() { calls++; if (intlThrows) throw Error('Intl unavailable'); return { resolvedOptions: () => ({ timeZone: timezone }) }; } },
    fetch: async (url, options) => { requests.push({ url, options }); return fetcher ? fetcher(url, options) : Response.json({ ok: true, data: { next: '/docs?utm_source=fixture&_Linro_check=1' } }); },
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  for (const name of ['navigator', 'localStorage', 'sessionStorage']) Object.defineProperty(context, name, { get() { throw Error('Unexpected client data source: ' + name); } });
  vm.runInNewContext(BROWSER_JS, context, { timeout: 1000 });
  return {
    form, input, challenge, error, requests, navigations, forms, timers,
    get intlCalls() { return calls; }, get submitCalls() { return requestSubmits; },
    async settled() { while (tasks.length) await Promise.all(tasks.splice(0)); },
  };
}
