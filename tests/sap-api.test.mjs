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

test('a stale answer (SAP down, the bridge sent its last good result) is passed on with X-Stale and the refresh time', async () => {
  bridge(200, 'ExportDate\tSourceType\r\n2026-11-09\tSales Order\r\n', {
    'content-type': 'text/tab-separated-values', 'x-row-count': '1', 'x-refreshed-at': '2026-11-12T10:42:05-06:00', 'x-stale': '1',
  });
  const res = await call('kpi');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-stale'), '1');
  assert.equal(res.headers.get('x-refreshed-at'), '2026-11-12T10:42:05-06:00');
  bridge(200, 'x', { 'content-type': 'text/tab-separated-values' });
  assert.equal((await call('kpi')).headers.get('x-stale'), '', 'a fresh answer has no X-Stale');
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

// --- Ask AI's SAP lookups (2v6.9): /api/sap/catalog and /api/sap/data/<name> ----------------------------------
const CATALOG = {
  reports: { kpi: { description: 'KPI', cache_seconds: 300 } },
  queries: {
    so_detail: { description: 'Lines of one sales order', params: [{ name: 'docnum', default: null, min: 1, max: 2147483647, required: true }] },
    item_stock: { description: '', params: [{ name: 'item', default: null, min: null, max: 50, required: true }] },
    open_sales_orders: { description: 'Open sales orders with remaining open value (local currency)', params: [] },
    drop_tables: { description: 'not on the allowlist', params: [] },
  },
};
// A fake bridge that answers by path and records every request.
let asked = [];
const fakeBridge = (routes) => {
  asked = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    asked.push({ url: String(url), path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers });
    const r = routes[u.pathname];
    if (!r) return new Response(JSON.stringify({ error: `Unknown query '${u.pathname}'.` }), { status: 404, headers: { 'content-type': 'application/json' } });
    const [status, body, type = 'application/json'] = typeof r === 'function' ? r(u) : r;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
  };
};
let envN = 0;
const freshEnv = () => ({ ...ENV, SAP_BRIDGE_URL: `https://sap-bridge-${++envN}.example.test` }); // the catalog is kept per bridge

test('catalog: only allowlisted queries the bridge lists, with typed params; reports and other queries left out', async () => {
  const env = freshEnv();
  fakeBridge({ '/api/catalog': [200, CATALOG] });
  const res = await call('catalog', { env });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.configured, true);
  assert.deepEqual(Object.keys(body.queries).sort(), ['item_stock', 'open_sales_orders', 'so_detail']);
  assert.ok(!('reports' in body));
  assert.equal(body.queries.open_sales_orders.description, 'Open sales orders with remaining open value (local currency)');
  assert.match(body.queries.item_stock.description, /Stock of one item/, 'an empty bridge description falls back to ours');
  assert.deepEqual(body.queries.so_detail.params, [{ name: 'docnum', type: 'int', required: true, min: 1, max: 2147483647 }]);
  assert.deepEqual(body.queries.item_stock.params, [{ name: 'item', type: 'str', required: true, max: 50 }]);
  assert.equal(asked[0].url, `${env.SAP_BRIDGE_URL}/api/catalog`);
  assert.deepEqual(asked[0].headers, { 'X-API-Key': 'bridge-key', 'CF-Access-Client-Id': 'id.access', 'CF-Access-Client-Secret': 'access-secret' });
  const text = JSON.stringify(body);
  for (const secret of Object.values(env)) assert.ok(!text.includes(secret), secret);
  // Kept for 60 s: a second call does not ask the bridge again.
  await call('catalog', { env });
  assert.equal(asked.length, 1);
});

test('catalog: errors are clear JSON (not set up 503, bridge down 502, old bridge without a catalog 502)', async () => {
  const off = await call('catalog', { env: {} });
  assert.equal(off.status, 503);
  assert.equal((await off.json()).configured, false);
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  let res = await call('catalog', { env: freshEnv() });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /could not be reached/);
  fakeBridge({});
  res = await call('catalog', { env: freshEnv() });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /no catalog/);
  fakeBridge({ '/api/catalog': [200, '<html>Sign in</html>', 'text/html'] });
  assert.match((await (await call('catalog', { env: freshEnv() })).json()).error, /Cloudflare Access refused/);
});

const ROWS = { query: 'so_detail', params: { docnum: 45126 }, refreshed_at: '2026-11-13T14:14:05-06:00', row_count: 1, stale: false, rows: [{ DocNum: 45126, ItemCode: 'SPY-100', OpenQty: 4 }] };

test('data: an allowlisted lookup is passed through as the bridge sent it, with only its declared params', async () => {
  fakeBridge({ '/api/data/so_detail': [200, ROWS], '/api/data/customer_orders': [200, { ...ROWS, query: 'customer_orders' }], '/api/data/production_orders': [200, { ...ROWS, query: 'production_orders' }] });
  const res = await call('data/so_detail?docnum=45126&refresh=1&sql=DROP%20TABLE&months=3');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), ROWS);
  assert.equal(asked[0].url, 'https://sap-bridge.example.test/api/data/so_detail?docnum=45126');
  assert.equal(asked[0].headers['X-API-Key'], 'bridge-key');
  await call('data/customer_orders?cardcode=%20C1001%20&months=6&docnum=1');
  assert.deepEqual(asked[1].query, { cardcode: 'C1001', months: '6' });
  await call('data/customer_orders?cardcode=C1001');
  assert.deepEqual(asked[2].query, { cardcode: 'C1001' }, 'an optional param left out gets the bridge default');
  await call('data/production_orders?status=ALL&item=SPY-100%2FA');
  assert.deepEqual(asked[3].query, { item: 'SPY-100/A', status: 'all' });
});

test('data: unknown names 404 and bad params 400, before anything reaches the bridge', async () => {
  fakeBridge({ '/api/data/so_detail': [200, ROWS] });
  for (const p of ['data/drop_tables', 'data/kpi', 'data/SO_DETAIL', 'data/so_detail/x', 'data/../catalog', 'data/']) {
    assert.equal((await call(p)).status, 404, p);
  }
  for (const p of ['data/so_detail', 'data/so_detail?docnum=', 'data/so_detail?docnum=abc', 'data/so_detail?docnum=0', 'data/so_detail?docnum=-5',
    'data/so_detail?docnum=1.5', 'data/so_detail?docnum=99999999999', 'data/item_stock?item=', `data/item_stock?item=${'A'.repeat(51)}`,
    "data/item_stock?item=X'%20OR%201%3D1", 'data/item_stock?item=%3Cscript%3E', 'data/customer_orders?cardcode=C1&months=61',
    'data/customer_orders?cardcode=C1234567890123456', 'data/production_orders?status=closed']) {
    const res = await call(p);
    assert.equal(res.status, 400, p);
    assert.ok((await res.json()).error, p);
  }
  assert.equal(asked.length, 0, 'nothing was sent to the bridge');
  assert.equal((await call('data/so_detail?docnum=1', { env: {} })).status, 503);
  assert.equal((await call('data/so_detail?docnum=1', { method: 'POST' })).status, 405);
});

test('data: bridge errors become clear JSON; a stale answer passes with its flag', async () => {
  fakeBridge({ '/api/data/so_detail': [400, { error: "Parameter 'docnum' must be int." }] });
  let res = await call('data/so_detail?docnum=7');
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /must be int/);
  fakeBridge({});
  res = await call('data/item_info?item=SPY-100');
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /update the bridge/);
  fakeBridge({ '/api/data/so_detail': [502, { error: 'SAP HANA could not be reached (bridge log ref ab12cd34)' }] });
  res = await call('data/so_detail?docnum=7');
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /HANA could not be reached/);
  fakeBridge({ '/api/data/so_detail': [200, 'ok', 'text/plain'] });
  assert.equal((await call('data/so_detail?docnum=7')).status, 502);
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  assert.match((await (await call('data/so_detail?docnum=7')).json()).error, /could not be reached/);
  fakeBridge({ '/api/data/so_detail': [200, { ...ROWS, stale: true }] });
  assert.equal((await (await call('data/so_detail?docnum=7')).json()).stale, true);
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
