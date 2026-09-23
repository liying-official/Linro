import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = rel => readFileSync(new URL('../'+rel,import.meta.url));

test('README describes the explicit Origin exception, exact toolchain pin and non-destructive recovery choices',()=>{
  const doc=read('docs/GUIDE.md').toString();
  assert.match(doc,/显式其他 origin.*拒绝/);assert.match(doc,/X-Linro-CSRF: 1/);assert.match(doc,/显式提供且不等于 ADMIN_ORIGIN 的 Origin/);
  assert.match(doc,/4\.132\.0/);assert.match(doc,/npm ci/);assert.match(doc,/Miniflare/);
  assert.match(doc,/不做自动重部署/);assert.match(doc,/先验证、后删除/);assert.match(doc,/显式 ID/);
  const stage=read('scripts/package-source.mjs').toString();
  for(const rel of ['apps/redirect/src/unlock-origin.ts','scripts/runtime-toolchain.mjs','scripts/check-deployment.mjs','scripts/verify-analytics-token.mjs','tests/runtime/api-canary.test.mjs','tests/runtime/outbound-router.mjs']) assert.ok(stage.includes("'"+rel+"'"));
});
