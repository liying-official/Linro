import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const web = new URL('../apps/admin/src/web/', import.meta.url);
const compiled = new Map();

// Load complete production modules with the app's real React class, model, messages
// and form handlers. Only the transport, form DOM and React commit are substituted.
export function webController({ state = {}, request, download = () => {} } = {}) {
  const loaded = new Map();
  const calls = [];
  const form = function (values) {
    return values;
  };
  function load(url) {
    if (loaded.has(url.href)) return loaded.get(url.href);
    const filename = fileURLToPath(url);
    let run = compiled.get(filename);
    if (!run) {
      const { outputText } = ts.transpileModule(readFileSync(url, 'utf8'), {
        fileName: filename,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.React,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      });
      run = new Function('exports', 'require', 'FormData', outputText);
      compiled.set(filename, run);
    }
    const exports = {};
    loaded.set(url.href, exports);
    const require = createRequire(url);
    run(
      exports,
      (name) => {
        if (!name.startsWith('.')) return require(name);
        const base = new URL(name.replace(/\.js$/, ''), url);
        try {
          return load(new URL(base.href + '.ts'));
        } catch (error) {
          if (error.code !== 'ENOENT' || error.path !== fileURLToPath(new URL(base.href + '.ts')))
            throw error;
          return load(new URL(base.href + '.tsx'));
        }
      },
      form,
    );
    return exports;
  }
  const client = load(new URL('client.ts', web));
  const productionApi = client.api;
  client.api = async (path, method = 'GET', body, signal) => {
    calls.push([path, method, body, signal]);
    if (request) return request(path, method, body, signal);
    return {};
  };
  client.download = download;
  const module = (name) => load(new URL(name, web));
  const { App } = module('App.tsx');
  const app = new App({});
  app.mounted = true;
  Object.assign(app.state, { locale: 'en', page: 'tokens', directoryLoaded: true }, state);
  app.setState = (patch, callback) => {
    app.state = {
      ...app.state,
      ...(typeof patch === 'function' ? patch(app.state, app.props) : patch),
    };
    callback?.();
  };
  return { app, calls, module, APIError: client.APIError, productionApi };
}

export function formEvent(values = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(key, item);
  }
  return { preventDefault() {}, currentTarget: form };
}

export const settled = () => new Promise((resolve) => setImmediate(resolve));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
