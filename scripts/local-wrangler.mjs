import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config-lib.mjs';
const script = resolve(ROOT, 'node_modules/wrangler/bin/wrangler.js');
if (!existsSync(script)) { console.error('Wrangler is not installed. Run npm install first.'); process.exit(1); }
const config = name => ['--config', resolve(ROOT, `.local/${name}.jsonc`)];
const persist = ['--persist-to', resolve(ROOT, '.local/state')];
const commands = {
  admin: ['dev', ...config('admin'), ...persist, '--port', '8787', '--ip', '127.0.0.1'],
  redirect: ['dev', ...config('redirect'), ...persist, '--port', '8788', '--ip', '127.0.0.1'],
  migrate: ['d1', 'migrations', 'apply', 'DB', '--local', ...config('admin'), ...persist],
  seed: ['d1', 'execute', 'DB', '--local', '--file', resolve(ROOT, '.local/seed.sql'), ...config('admin'), ...persist],
};
const args = commands[process.argv[2]];
if (!args) { console.error('Use admin, redirect, migrate or seed.'); process.exit(1); }
const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
