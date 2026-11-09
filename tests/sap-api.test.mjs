// Tests for functions/api/sap/[[path]].js (Live SAP, 2v6.7). The SAP bridge is a stand-in; no network.
// Run: node tests/sap-api.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'functions', 'api', 'sap', '[[path]].js'), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const ORIGIN = 'https://kpi.example.test';
const ENV = { SAP_BRIDGE_URL: 'https://sap-bridge.example.test', SAP_BRIDGE_KEY: 'bridge-key', CF_ACCESS_CLIENT_ID: 'id.access', CF_ACCESS_CLIENT_SECRET: 'access-secret' };
const call = (path, { env = ENV, method = 'GET' } = {}) => {
  const [p] = path.split('?');
  return onRequest({ request: new Request(`${ORIGIN}/api/sap/${path}`, { method }), env, params: { path: p.split('/') } });
};
let seen;
const bridge = (status, body, headers = {}) => {
  seen = null;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), headers: init.headers, redirect: init.redirect }; return new Response(body, { status, headers }); };
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('status says whether the site has a bridge, and never shows the address or keys', async () => {
  const on = await call('status');
  assert.equal(on.status, 200);
  assert.deepEqual(await on.json(), { configured: true });
  assert.deepEqual(await (await call('status', { env: { SAP_BRIDGE_URL: 'https://x.test' } })).json(), { configured: false });
  assert.deepEqual(await (await call('status', { env: {} })).json(), { configured: false });
  const text = await (await call('status')).text();
  for (const secret of Object.values(ENV)) assert.ok(!text.includes(secret), secret);
});

test('a report is passed through as the bridge sent it; the keys go only to the bridge', async () => {
  bridge(200, 'ExportDate\tSourceType\r\n2026-11-09\tSales Order\r\n', {
    'content-type': 'text/tab-separated-values', 'content-disposition': 'attachment; filename="SAP_live_KPI_2026-11-09.txt"', 'x-row-count': '1', 'x-refreshed-at': '2026-11-09T08:00:00',
  });
  const res = await call('kpi?refresh=1');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ExportDate\tSourceType\r\n2026-11-09\tSales Order\r\n');
  assert.match(res.headers.get('content-type'), /tab-separated-values/);
  assert.match(res.headers.get('content-disposition'), /SAP_live_KPI_2026-11-09\.txt/);
  assert.equal(res.headers.get('x-row-count'), '1');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(seen.url, 'https://sap-bridge.example.test/api/reports/kpi?refresh=1');
  assert.equal(seen.redirect, 'manual');
  assert.deepEqual(seen.headers, { 'X-API-Key': 'bridge-key', 'CF-Access-Client-Id': 'id.access', 'CF-Access-Client-Secret': 'access-secret' });
  await call('supply-demand');
  assert.equal(seen.url, 'https://sap-bridge.example.test/api/reports/supply-demand');
});

test('only the two reports, only GET; without a bridge a clear 503', async () => {
  bridge(200, 'x');
  for (const p of ['../report', 'kpi/extra', 'drop', '']) assert.equal((await call(p)).status, 404, p);
  assert.equal(seen, null, 'nothing was sent to the bridge');
  const post = await call('kpi', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  const off = await call('kpi', { env: {} });
  assert.equal(off.status, 503);
  assert.match((await off.json()).error, /not set up/);
  assert.equal((await call('kpi', { env: { ...ENV, SAP_BRIDGE_URL: 'not a url' } })).status, 503);
});

test('bridge errors, Access refusals and an unreachable bridge become short messages', async () => {
  bridge(502, JSON.stringify({ error: "SAP report 'kpi' failed: invalid column name" }), { 'content-type': 'application/json' });
  let res = await call('kpi');
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /invalid column name/);
  bridge(401, 'nope');
  assert.match((await (await call('kpi')).json()).error, /answered 401/);
  bridge(302, '', { location: 'https://team.cloudflareaccess.com/login' });
  assert.match((await (await call('kpi')).json()).error, /Cloudflare Access refused/);
  bridge(200, '<html>Sign in</html>', { 'content-type': 'text/html' });
  assert.match((await (await call('kpi')).json()).error, /Cloudflare Access refused/);
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  res = await call('kpi');
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /could not be reached/);
});

test('the sign-in gate covers /api/sap (no public path added)', async () => {
  const mw = readFileSync(join(here, '..', 'functions', '_middleware.js'), 'utf8');
  assert.ok(!/api\/sap/.test(mw), 'the middleware has no exception for /api/sap');
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
