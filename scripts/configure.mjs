import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { configs, outputPaths, ROOT } from './config-lib.mjs';
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('Usage: npm run configure -- --config deployment.json\nCopy deployment.example.json and fill in your account, D1, domains and Access settings. No secrets belong in this file.'); process.exit(0); }
  const idx = args.indexOf('--config'); const file = idx >= 0 ? args[idx + 1] : 'deployment.json';
  if (!file) throw new Error('--config requires a filename.');
  const config = JSON.parse(await readFile(resolve(ROOT, file), 'utf8'));
  // Rebranding must not implicitly create new Workers and lose their secrets.
  // Explicit input names win. Only inherit from the same account and D1.
  for (const side of ['admin', 'redirect']) {
    let old;
    try { old = JSON.parse(await readFile(outputPaths[side], 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (old?.account_id === config.account_id && old?.d1_databases?.[0]?.database_id === config.database_id) {
      config[side + '_worker_name'] ??= old.name;
      config.database_name ??= old.d1_databases[0].database_name;
      if (side === 'admin') config.analytics_dataset ??= old.vars?.ANALYTICS_DATASET;
    }
  }
  const generated = configs(config);
  for (const name of ['admin', 'redirect']) await writeFile(outputPaths[name], JSON.stringify(generated[name], null, 2) + '\n');
  console.log(`Workers: ${generated.admin.name}, ${generated.redirect.name} (verify these are the intended resources)`);
  console.log('Generated both production Wrangler configurations. workers.dev and preview URLs are disabled.');
  console.log('Next: create the Access application/policies, set ANALYTICS_API_TOKEN when analytics is enabled, apply remote migrations, build, test and deploy.');
} catch (error) { console.error('Configuration failed:', error.message); process.exitCode = 1; }
