import test from 'node:test';
import assert from 'node:assert/strict';
import { visitorDimensions } from '../.build/packages/shared/src/visitor-dimensions.js';
import { featureFixture, createLink, request, patch, unlock, PASSWORD } from './feature-helpers.mjs';
function sample(cf, headers = {}, enabled = 'true') {
  const r = new Request('https://go.example.com/', { headers }); if (cf !== undefined) Object.defineProperty(r, 'cf', { value: cf });
  return visitorDimensions(r, { CLOUDFLARE_DEVICE_TYPE_ENABLED: enabled });
}
for (const [header, expected] of [['mobile','mobile'],['tablet','mobile'],['desktop','pc'],['unknown','none'],['','none'],['bot','none'],['mobile, desktop','none'],['PC','none']]) {
  test(`Cloudflare device ${header || '<missing>'} maps to ${expected}`, () => {
    const data = sample({ timezone: 'Asia/Tokyo' }, { 'CF-Device-Type': header }); assert.equal(data.device, expected); assert.equal(data.timezone, 'Asia/Tokyo');
  });
}
test('ordinary device headers are ignored unless the operator explicitly verifies and enables CF origin', () => {
  for (const enabled of [undefined, 'false', '1', 'TRUE']) assert.equal(sample({ timezone:'UTC' }, { 'CF-Device-Type':'desktop' }, enabled === undefined ? '' : enabled).device, 'none');
  assert.equal(sample(undefined, { 'CF-Device-Type':'desktop' }).device, 'none');
});
test('timezone and device never use browser cookies, user-agent or arbitrary timezone headers as fallback', () => {
  const data = sample({}, { 'user-agent':'Mozilla/5.0 (iPhone)', cookie:'timezone=Asia/Tokyo', 'x-timezone':'Asia/Tokyo', 'cf-timezone':'Asia/Tokyo', 'sec-ch-ua-mobile':'?1' });
  assert.deepEqual(data, { timezone:'none', device:'none' });
});
for (const zone of [null, undefined, 12, {}, '', 'x'.repeat(65), '<script>', 'Asia/Tokyo\nmalformed']) {
  test(`unknown/malformed CF timezone is none: ${JSON.stringify(zone)}`, () => { assert.equal(sample({ timezone:zone }).timezone,'none'); });
}
for (const kind of ['redirect','text']) {
  test(`successful ${kind} GET records CF-only dimensions; HEAD/password/error do not`, async t => {
    const events = []; const { env, domain } = await featureFixture(t, { ANALYTICS_ENABLED:'true', ANALYTICS:{writeDataPoint:e=>events.push(e)}, CLOUDFLARE_DEVICE_TYPE_ENABLED:'true' });
    const link = await createLink(env, domain, { response_mode:kind, text_content:kind==='text'?'test body':'', max_redirects:3 });
    const response = await request(env,'/docs',{cf:{timezone:'Europe/Paris',country:'FR'},headers:{'CF-Device-Type':'desktop','user-agent':'Mozilla/5.0 (iPhone)'}}); assert.equal(response.status,kind==='text'?200:301); assert.equal(events.length,1);
    assert.equal(events[0].blobs[5],'Europe/Paris'); assert.equal(events[0].blobs[6],'pc'); assert.equal(events[0].blobs[7],kind); assert.equal(events[0].indexes[0],link.id); assert.deepEqual(events[0].doubles,[1,kind==='text'?200:301,0,0,0,1,0]);
    await request(env,'/docs',{method:'HEAD',cf:{timezone:'Asia/Tokyo'}}); await request(env,'/unknown'); assert.equal(events.length,1);
    await patch(env,link,{password:PASSWORD}); await request(env); await unlock(env,'docs','bad'); await unlock(env); assert.equal(events.length,1);
  });
}
test('missing CF values are recorded as none on successful GET rather than excluding visits', async t=>{
  const events=[];const {env,domain}=await featureFixture(t,{ANALYTICS_ENABLED:'true',ANALYTICS:{writeDataPoint:e=>events.push(e)}}); await createLink(env,domain);await request(env);
  assert.equal(events.length,1);assert.deepEqual(events[0].blobs.slice(5,7),['none','none']);
});
