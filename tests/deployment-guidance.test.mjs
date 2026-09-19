import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = rel => readFileSync(new URL('../'+rel,import.meta.url));

test('README describes the explicit Origin exception, exact toolchain pin and non-destructive recovery choices',()=>{
  const doc=read('README.md').toString();
  assert.ok(doc.includes('显式外站/错端口/错协议 Origin 永远拒绝'));assert.match(doc,/后台.*CSRF.*没有改变/);
  assert.match(doc,/4\.132\.0/);assert.match(doc,/package-lock-only/);assert.match(doc,/Miniflare 5/);
  assert.match(doc,/不做自动重部署/);assert.match(doc,/先验证、后删除/);assert.match(doc,/显式 ID/);
  const stage=read('scripts/package-source.mjs').toString();
  for(const rel of ['apps/redirect/src/unlock-origin.ts','scripts/runtime-toolchain.mjs','scripts/check-deployment.mjs','scripts/verify-analytics-token.mjs','tests/runtime/api-canary.test.mjs','tests/runtime/outbound-router.mjs']) assert.ok(stage.includes("'"+rel+"'"));
});
