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
  const stderr = [];
  child.stderr.on('data', (d) => stderr.push(String(d)));
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
  return { child, request, raw, notify, call, lines, stderr };
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
  // A large export takes seconds to parse, so the start files load only after the handshake (tools/list).
  assert.doesNotMatch(server.stderr.join(''), /Loaded/);
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

  // Files the page cannot use are named in loaded_files (data check) instead of failing the load; only files that gave rows are listed.
  fs.writeFileSync(path.join(dir, 'notes.pdf'), 'x');
  fs.writeFileSync(path.join(dir, 'junk.csv'), 'a,b\n1,2\n');
  const mixed = await server.call('load_exports', { paths: [FILE_B, path.join(dir, 'notes.pdf'), path.join(dir, 'junk.csv')] });
  assert.equal(mixed.isError, false);
  assert.deepEqual(mixed.data.files.map((f) => [f.name, f.kind]), [['kpi export b.xls', 'SAP KPI export']]);
  assert.match(mixed.data.data_check.examples.join(' '), /Skipped notes\.pdf[\s\S]*Skipped junk\.csv|Skipped junk\.csv[\s\S]*Skipped notes\.pdf/);
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

  // A start file that cannot be read: the tools say why, so the AI can tell the user.
  const missing = start([path.join(dir, 'gone.xls')]);
  assert.match((await missing.call('get_overview')).data.hint, /load_exports[\s\S]*Last load error: Cannot read .*gone\.xls: file not found/);
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

// --- The "Connect an AI" help page in index.html --------------------------------------------------------
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// 2v7: the Connect an AI page moved into Settings ("Connect An AI App" card); setTab('connect') opens Settings there.
test('Connect an AI opens in Settings before any export is loaded: a short card and a working config snippet', () => {
  const page = loadPage();
  const header = () => page.els['app-header'].innerHTML;
  assert.doesNotMatch(header().match(/<button[^>]*id="hdr-gear"[^>]*>/)[0], /disabled/);
  assert.match(header().match(/<button[^>]*data-focus-key="nav-weekly"[^>]*>/)[0], /disabled/);
  page.run("setTab('connect')");
  page.run("setTab('weekly')"); // still no data: other pages stay closed
  assert.equal(page.run('activeTab'), 'settings');
  assert.equal(page.run('stgConnectOpen'), true, 'asked for, its setup steps are open');
  const html = page.els['results-screen'].innerHTML;
  const at = html.indexOf('id="stg-card-connect"');
  assert.ok(at > 0, 'the Connect An AI App card is drawn');
  const card = html.slice(at, html.indexOf('</section>', at));
  assert.match(card, /<h2 class="dz-title sm stg-title" id="stg-h-connect" tabindex="-1">[\s\S]*Connect An AI App<\/h2>/);
  assert.match(card, /<details class="stg-setup" open/);
  assert.doesNotMatch(html, /Share snapshot|Export PDF/);
  // Concise: one intro line, the three steps, one privacy line; the details live in the guide.
  const text = unescape(card.replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  for (const t of ['Use an AI app on your computer to read your exports.', 'Use only an AI app Spyder Controls approves.', "In your AI app's MCP settings, add this server, then restart the app."]) assert.ok(text.includes(t), t);
  assert.doesNotMatch(text, /\bcompan(y|ies)\b/i);
  // No AI product names and no "IT": the steps fit any app that supports MCP.
  assert.doesNotMatch(card, /cl[a]ude|cur[s]or/i);
  assert.doesNotMatch(text, /\bIT\b/);
  assert.ok(text.split(' ').length < 120, `the card stays short (${text.split(' ').length} words)`);
  assert.match(card, /href="docs\/MCP\.md"/);
  assert.match(card, /<span class="misc-code-file">MCP server config<\/span>/);

  const config = JSON.parse(unescape(card.match(/<pre id="connect-desktop"[^>]*>([^<]*)<\/pre>/)[1]));
  assert.deepEqual(config.mcpServers['spyder-kpi'], { command: 'node', args: ['C:\\path\\to\\spyder-kpi-dashboard\\mcp\\spyder-kpi-mcp.mjs', 'C:\\path\\to\\kpi_export.xls'] });
  // The scrolling snippet can be reached with the keyboard.
  assert.match(card, /<pre id="connect-desktop" tabindex="0" aria-label="MCP server config">/);
  // The one Copy button reads the snippet id from data-copy, has its own accessible name and is left out of print.
  const copies = [...card.matchAll(/<div class="misc-code-copy print-hide"><span class="misc-code-status" id="connect-(desktop)-status" role="status"><\/span><button type="button" class="dz-btn" data-copy="connect-\1" data-focus-key="copy-connect-\1" aria-label="(Copy [^"]+)"(?: data-tip="[^"]+")? onclick="copyConnectSnippet\(this\)">Copy<\/button>/g)];
  assert.deepEqual(copies.map((m) => m[2]), ['Copy the MCP server config'], 'the Copy button has its own accessible name');
  // The guide shows the same config as the card, plus the fields for apps that ask for them one by one.
  const guide = fs.readFileSync(path.join(path.dirname(SERVER), '..', 'docs', 'MCP.md'), 'utf8');
  assert.ok(guide.includes(JSON.stringify(config, null, 2)), 'the guide shows the same MCP server config as the card');
  assert.ok(guide.includes('| Command | `node` |'));
  assert.doesNotMatch(guide, /cl[a]ude|cur[s]or/i, 'the guide names no AI product');
});

test('Connect an AI with an export loaded opens the Settings card; no Data check pill anywhere; Copy uses the clipboard or a fallback', async () => {
  const page = await pageFor(ROWS_A);
  page.run("setTab('connect')");
  assert.equal(page.run('activeTab'), 'settings');
  const html = page.els['results-screen'].innerHTML;
  assert.match(html, /id="stg-card-connect"/);
  assert.match(html, /<pre id="connect-desktop" tabindex="0"/);
  // Share snapshot stays in the export-date popover; the Export PDF icon is gone (2v6.8: print from the browser); the
  // Data check is a Settings card.
  assert.match(page.els['app-header'].innerHTML, /data-focus-key="hdr-share" aria-label="Share snapshot"[^>]*><svg/);
  assert.doesNotMatch(page.els['app-header'].innerHTML, /data-focus-key="export-pdf"/);
  page.run("dataQualityIssues=[{message:'test'}];setTab('weekly')");
  assert.doesNotMatch(page.els['results-screen'].innerHTML, /class="data-check/);
  assert.match(page.els['app-header'].innerHTML, /<span class="hdr-dot red"/);
  page.run("setTab('connect')");
  assert.match(page.els['results-screen'].innerHTML, /id="stg-card-dc"[\s\S]*?<li>test<\/li>/);
  page.run("dataQualityIssues=[];setTab('connect')");

  let copied = '';
  page.ctx.navigator.clipboard = { writeText: async (t) => { copied = t; } };
  const btn = { dataset: { copy: 'connect-desktop' }, focus() {} };
  page.ctx.copyConnectSnippet(btn);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(JSON.parse(copied).mcpServers['spyder-kpi'].command, 'node');
  assert.equal(page.els['connect-desktop-status'].textContent, 'Copied');
  page.els['connect-desktop-status'].textContent = '';

  // No clipboard API (e.g. plain http): a hidden textarea and execCommand('copy').
  delete page.ctx.navigator.clipboard;
  let selected = '';
  page.ctx.document.createElement = () => ({ style: {}, setAttribute() {}, remove() {}, select() { selected = this.value; } });
  page.ctx.document.body.appendChild = (c) => c;
  page.ctx.document.execCommand = (cmd) => cmd === 'copy';
  page.ctx.copyConnectSnippet({ dataset: { copy: 'connect-desktop' }, focus() {} });
  assert.match(selected, /"mcpServers"/);
  assert.equal(page.els['connect-desktop-status'].textContent, 'Copied');
  page.ctx.document.execCommand = () => false;
  page.ctx.copyConnectSnippet({ dataset: { copy: 'connect-desktop' }, focus() {} });
  assert.match(page.els['connect-desktop-status'].textContent, /Select the text/);

  // A snapshot shared from Settings opens on Order Health.
  let payload = '';
  Object.assign(page.ctx, { buildSnapshotHtml: (p) => { payload = p.text; return ''; }, downloadPreparedSnapshot() {}, showSnapshotDownloadLink() {} });
  await page.ctx.exportShareSnapshot();
  assert.equal(JSON.parse(payload).activeTab, 'weekly');
});

await run();
for (const c of children) c.kill();
fs.rmSync(dir, { recursive: true, force: true });
