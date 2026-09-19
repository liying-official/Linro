const args = process.argv.slice(2); const value = name => args[args.indexOf(name) + 1];
try {
  if (!args.includes('--short-url') || !args.includes('--expected-location')) throw new Error('Usage: node scripts/smoke.mjs --short-url https://go.example.com/test --expected-location https://example.org/ --code 301');
  const short = new URL(value('--short-url')); const expected = new URL(value('--expected-location')).href;
  const code = args.includes('--code') ? Number(value('--code')) : 301;
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(short, { method, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (response.status !== code || response.headers.get('location') !== expected) throw new Error(`${method}: expected ${code} Location ${expected}; got ${response.status} ${response.headers.get('location')}`);
    if (!response.headers.get('cache-control')?.includes('no-store')) throw new Error(`${method}: no-store header not found (smoke link should use cache_ttl=0).`);
    console.log(`PASS ${method}: ${response.status}, correct Location and no-store`);
  }
  console.log('Remote redirect smoke test passed. Access/GUI/analytics must be verified separately.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
