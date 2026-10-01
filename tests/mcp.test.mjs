// Tests for the MCP server (mcp/spyder-kpi-mcp.mjs): spawns it over stdio with synthetic exports in a temp
// folder whose name has spaces. Run: node tests/mcp.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const { loadPage, upload, sapRow, sapExport, createSuite } = createRequire(import.meta.url)('./harness.js');
const { test, run } = createSuite();
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'spyder-kpi-mcp.mjs');

const ROWS_A = [
  sapRow({ DocumentNumber: '500', LineDueDate: '08/01/2026', DueDate: '08/01/2026', AmountLocal: '1,000.00' }),
  sapRow({ DocumentNumber: '501', CustomerVendorCode: 'AQUHOT', CustomerVendorName: 'Aqua Hot', Warehouse: 'CM - Alta', LineDueDate: '08/15/2026', DueDate: '08/15/2026', LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111', AmountLocal: '700.00' }),
  sapRow({ DocumentNumber: '502', LineDueDate: '08/20/2026', DueDate: '08/20/2026', LineRescheduleDate: '09/20/2026', RescheduleDate: '09/20/2026', AmountLocal: '500.00' }),
  sapRow({ DocumentNumber: '503', LineDueDate: '09/25/2026', DueDate: '09/25/2026', AmountLocal: '150.00' }),
  sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '700', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Parts', LineDueDate: '08/10/2026', DueDate: '08/10/2026', AmountLocal: '250.00' }),
];
const ROWS_B = [
  sapRow({ DocumentNumber: '900', CustomerVendorName: 'Bayliner', LineDueDate: '07/01/2026', DueDate: '07/01/2026', AmountLocal: '42.00' }),
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spyder kpi mcp '));
const FILE_A = path.join(dir, 'kpi export a.xls');
const FILE_B = path.join(dir, 'kpi export b.xls');
fs.writeFileSync(FILE_A, sapExport(ROWS_A));
fs.writeFileSync(FILE_B, sapExport(ROWS_B));

// A tiny MCP client: one JSON message per line each way; every stdout line must be a JSON-RPC message.
const children = [];
function start(args = [], env = {}) {
  const child = spawn(process.execPath, [SERVER, ...args], { env: { ...process.env, SPYDER_KPI_FILES: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  const waiting = new Map();
  const nullIds = [];
  const lines = [];
  child.stderr.resume();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    assert.equal(msg.jsonrpc, '2.0', `stdout line is not JSON-RPC: ${line.slice(0, 80)}`);
    lines.push(msg);
    if (msg.id === null) nullIds.shift()(msg);
    else waiting.get(msg.id)(msg);
  });
  let id = 0;
  const send = (text, waiter) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no reply to ${text.slice(0, 60)}`)), 30000);
    waiter((msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(`${text}\n`);
  });
  const request = (method, params) => { const n = ++id; return send(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }), (r) => waiting.set(n, r)); };
  const raw = (text) => send(text, (r) => nullIds.push(r));
  const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  const call = async (name, args = {}) => {
    const { result } = await request('tools/call', { name, arguments: args });
    return { isError: !!result.isError, data: JSON.parse(result.content[0].text) };
  };
  return { child, request, raw, notify, call, lines };
}

async function pageFor(rows) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const page = loadPage({ today });
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(rows) }]);
  return page;
}
const AT_RISK = '(()=>{const r=orderHealthData(currentMetrics()).lateTileRows;return {orders:rowDocCount(r),lines:r.length,open_value:Math.round(rowOpenAmount(r)*100)/100}})()';
const atRisk = ({ orders, lines, open_value }) => ({ orders, lines, open_value });

const server = start([FILE_A]);

test('initialize echoes a supported protocol version, falls back to the newest, and notifications get no reply', async () => {
  const init = await server.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(init.result.serverInfo.name, 'spyder-kpi');
  assert.ok(init.result.serverInfo.version);
  for (const v of ['2025-11-25', '2025-03-26', '2024-11-05']) assert.equal((await server.request('initialize', { protocolVersion: v })).result.protocolVersion, v);
  assert.equal((await server.request('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-11-25');
  const before = server.lines.length;
  server.notify('notifications/initialized');
  assert.deepEqual((await server.request('ping')).result, {});
  assert.equal(server.lines.length, before + 1, 'the notification got a reply');
});

test('tools/list has every KPI tool plus load_exports and loaded_files', async () => {
  const { tools } = (await server.request('tools/list', {})).result;
  const page = loadPage();
  const kpi = page.run('KPI_TOOLS.map(t=>t.name)');
  assert.deepEqual(tools.map((t) => t.name), [...kpi, 'load_exports', 'loaded_files']);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.ok(t.description.length > 20, t.name);
  }
  assert.deepEqual(tools.find((t) => t.name === 'search_lines').inputSchema, page.run("KPI_TOOLS.find(t=>t.name==='search_lines').parameters"));
});

test('get_overview gives the At Risk numbers the page computes; search_lines returns the rows', async () => {
  const page = await pageFor(ROWS_A);
  const expected = page.run(AT_RISK);
  assert.equal(expected.lines, 3);
  const o = await server.call('get_overview');
  assert.equal(o.isError, false);
  assert.equal(o.data.as_of, '2026-09-03');
  assert.deepEqual(atRisk(o.data.order_health.at_risk), expected);
  assert.deepEqual(o.data.order_health, page.run("aiRunTool('get_overview',{})").order_health);

  const s = await server.call('search_lines', { scope: 'at_risk' });
  assert.equal(s.isError, false);
  assert.equal(s.data.total_matches, 3);
  assert.deepEqual(s.data.rows.map((r) => r.doc).sort(), ['500', '501', '502']);
  const one = await server.call('search_lines', { scope: 'open', customer: 'aqua' });
  assert.deepEqual(one.data.rows.map((r) => [r.doc, r.customer]), [['501', 'Aqua Hot']]);

  const f = await server.call('loaded_files');
  assert.equal(f.data.loaded, true);
  assert.equal(f.data.as_of, '2026-09-03');
  assert.deepEqual(f.data.files, [{ name: 'kpi export a.xls', path: FILE_A, kind: 'SAP KPI export', rows_read: 5 }]);
  assert.deepEqual(f.data.rows, { sales_order_rows: 4, purchase_order_rows: 1, supply_demand_rows: 0, clear_to_build_rows: 0 });
});

test('tool errors come back as isError; protocol errors as JSON-RPC errors', async () => {
  const unknown = await server.call('drop_tables');
  assert.equal(unknown.isError, true);
  assert.match(unknown.data.error, /Unknown tool drop_tables/);
  const badScope = await server.call('search_lines', { scope: 'everything' });
  assert.equal(badScope.isError, true);
  assert.match(badScope.data.error, /scope must be one of/);
  const notLoaded = await server.call('get_build_risk');
  assert.equal(notLoaded.isError, false);
  assert.match(notLoaded.data.hint, /load_exports/);

  assert.equal((await server.request('resources/list', {})).error.code, -32601);
  assert.equal((await server.request('tools/call', { arguments: {} })).error.code, -32602);
  assert.equal((await server.request('tools/call', { name: 'get_overview', arguments: 'x' })).error.code, -32602);
  const parse = await server.raw('{"jsonrpc":"2.0","id":7,"method":');
  assert.deepEqual(parse.error.code, -32700);
  assert.equal((await server.raw('[]')).error.code, -32600);
  assert.deepEqual((await server.request('ping')).result, {}, 'server still answers after errors');
});

test('load_exports switches files; a bad path changes nothing', async () => {
  const bad = await server.call('load_exports', { paths: [path.join(dir, 'missing.xls')] });
  assert.equal(bad.isError, true);
  assert.match(bad.data.error, /file not found/);
  assert.deepEqual(bad.data.still_loaded, ['kpi export a.xls']);
  assert.equal((await server.call('load_exports', { paths: 'nope' })).isError, true);

  const b = await server.call('load_exports', { paths: [`"${FILE_B}"`] });
  assert.equal(b.isError, false);
  assert.deepEqual(b.data.files.map((f) => f.name), ['kpi export b.xls']);
  const expected = (await pageFor(ROWS_B)).run(AT_RISK);
  assert.deepEqual(atRisk((await server.call('get_overview')).data.order_health.at_risk), expected);
  assert.deepEqual((await server.call('search_lines', { scope: 'at_risk' })).data.rows.map((r) => r.customer), ['Bayliner']);
});

test('with no files it still starts and tools say how to load; SPYDER_KPI_FILES is read', async () => {
  const empty = start();
  assert.equal((await empty.request('initialize', { protocolVersion: '2025-11-25' })).result.protocolVersion, '2025-11-25');
  const o = await empty.call('get_overview');
  assert.equal(o.data.loaded, false);
  assert.match(o.data.hint, /load_exports/);
  assert.equal((await empty.call('loaded_files')).data.loaded, false);

  const fromEnv = start([], { SPYDER_KPI_FILES: `"${FILE_B}";` });
  assert.deepEqual((await fromEnv.call('loaded_files')).data.files.map((f) => f.name), ['kpi export b.xls']);
});

test('--check prints the overview and exits; exits 1 without files', () => {
  const ok = spawnSync(process.execPath, [SERVER, '--check', FILE_A], { encoding: 'utf8', env: { ...process.env, SPYDER_KPI_FILES: '' } });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).order_health.at_risk.lines, 3);
  const none = spawnSync(process.execPath, [SERVER, '--check'], { encoding: 'utf8', env: { ...process.env, SPYDER_KPI_FILES: '' } });
  assert.equal(none.status, 1);
  assert.equal(none.stdout, '');
  assert.match(none.stderr, /No export files given/);
});

await run();
for (const c of children) c.kill();
fs.rmSync(dir, { recursive: true, force: true });
