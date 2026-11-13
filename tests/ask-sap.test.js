// Tests for Ask AI's SAP lookups (2v6.9): board first, then SAP through the bridge (/api/sap/catalog, /api/sap/data).
// Run: node tests/ask-sap.test.js. Fixtures are synthetic; fetch is mocked, so nothing leaves the machine.
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const ROWS = [
  sapRow({ DocumentNumber: '500', LineDueDate: '08/01/2026', DueDate: '08/01/2026', AmountLocal: '1,000.00' }),
  sapRow({ DocumentNumber: '504', LineDueDate: '09/10/2026', DueDate: '09/10/2026', AmountLocal: '200.00' }),
];
const BOARD = ['get_overview', 'search_lines', 'group_totals', 'get_monthly', 'get_build_risk', 'get_supply_demand'];
const consent = { spyderKpiAiConsentV2: JSON.stringify({ anthropic: '2026-11-13' }) };
const STATUS = { hosted: true, configured: true, providers: [{ id: 'anthropic', name: 'Anthropic', short: 'Anthropic', tier: 'paid', configured: true, models: ['opus-5-5-test'], defaultModel: 'opus-5-5-test', modelLabels: {}, dataNotice: 'Notice.', termsUrl: 'https://anthropic.example.test/terms' }] };
const CATALOG = { configured: true, queries: { so_detail: { description: 'Lines of one sales order', params: [] }, item_stock: { description: 'Stock', params: [] }, not_ours: { description: 'x', params: [] } } };
const SO = (over = {}) => ({ query: 'so_detail', params: { docnum: 45126 }, refreshed_at: '2026-11-13T14:14:05-06:00', row_count: 2, stale: false, truncated: false,
  rows: [{ DocNum: 45126, CardName: 'Aqua <b>Hot</b>', ItemCode: 'SPY-100', OpenQty: 4, OpenSum: 1250.5 }, { DocNum: 45126, CardName: 'Aqua <b>Hot</b>', ItemCode: 'SPY-200', OpenQty: 0, OpenSum: 0 }], ...over });
function turn(content) {
  const toolCalls = content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }));
  return { provider: 'anthropic', model: 'opus-5-5-test', dialect: 'anthropic', stop: toolCalls.length ? 'tool_use' : 'end', text: content.filter((b) => b.type === 'text').map((b) => b.text).join(''), toolCalls, message: { role: 'assistant', content } };
}
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// A page on the hosted site with live SAP set up; fetch is routed by path and every call recorded.
async function sapPage({ data = () => ok(SO()), catalog = () => ok(CATALOG), answers = [], live = true, load = true } = {}) {
  const page = loadPage({ storage: consent });
  if (load) await upload(page, [{ name: 'kpi.xls', bytes: sapExport(ROWS) }]);
  const calls = [];
  page.ctx.location.protocol = 'https:';
  page.ctx.AbortController = AbortController;
  page.ctx.fetch = async (url, init = {}) => {
    const call = { url, init, body: init.body ? JSON.parse(init.body) : undefined, log: page.els['ai-log'] && page.els['ai-log'].innerHTML };
    calls.push(call);
    if (url === '/api/ai/status') return ok(STATUS);
    if (url === '/api/sap/catalog') return catalog();
    if (url.startsWith('/api/sap/data/')) return data(url);
    if (url === '/api/ai/chat') { const next = answers.shift(); if (!next) throw new Error('no answer queued'); return ok(next); }
    throw new Error(`unexpected fetch ${url}`);
  };
  page.run(`sapLive.configured=${live};isSnapshotView=false`); // the harness page without an upload counts as a snapshot
  return { page, calls };
}
const chats = (calls) => calls.filter((c) => c.url === '/api/ai/chat');

test('SAP tools are offered only when live SAP is set up and the catalog lists them', async () => {
  let { page, calls } = await sapPage({ answers: [turn([{ type: 'text', text: 'Hi' }])] });
  await page.run("aiSend('hello')");
  assert.deepEqual(chats(calls)[0].body.tools.map((t) => t.name), [...BOARD, 'sap_so_detail', 'sap_item_stock'], 'only allowlisted queries the catalog lists');
  const so = chats(calls)[0].body.tools.find((t) => t.name === 'sap_so_detail');
  assert.deepEqual(so.parameters.required, ['docnum']);
  assert.equal(so.parameters.properties.docnum.type, 'integer');
  assert.match(so.description, /^SAP live:/);
  ({ page, calls } = await sapPage({ live: false, answers: [turn([{ type: 'text', text: 'Hi' }])] }));
  await page.run("aiSend('hello')");
  assert.deepEqual(chats(calls)[0].body.tools.map((t) => t.name), BOARD);
  assert.ok(!calls.some((c) => c.url === '/api/sap/catalog'), 'no catalog call without live SAP');
  ({ page, calls } = await sapPage({ catalog: () => ok({ error: 'down' }, 502), answers: [turn([{ type: 'text', text: 'Hi' }])] }));
  await page.run("aiSend('hello')");
  assert.deepEqual(chats(calls)[0].body.tools.map((t) => t.name), BOARD, 'a failed catalog offers no SAP tools');
  // The MCP server's tool list (KPI_TOOLS) never carries SAP tools.
  assert.deepEqual(page.run('KPI_TOOLS.map((t)=>t.name)'), BOARD);
});

test('every SAP lookup has a tool, and the board and SAP tools together fit the site AI service limit', async () => {
  const all = ['so_detail', 'po_detail', 'item_stock', 'customer_orders', 'order_deliveries', 'item_info', 'production_orders', 'open_sales_orders', 'sales_by_month', 'stock_by_warehouse', 'open_purchase_orders'];
  const queries = Object.fromEntries(all.map((n) => [n, { description: n, params: [] }]));
  const { page, calls } = await sapPage({ catalog: () => ok({ configured: true, queries }), answers: [turn([{ type: 'text', text: 'Hi' }])] });
  await page.run("aiSend('hello')");
  const tools = chats(calls)[0].body.tools;
  assert.deepEqual(tools.map((t) => t.name), [...BOARD, ...all.map((n) => `sap_${n}`)]);
  const proxy = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'functions', 'api', 'ai', '[[path]].js'), 'utf8');
  assert.ok(tools.length <= Number(proxy.match(/const MAX_TOOLS = (\d+)/)[1]), 'the site AI service accepts them all');
  // The proxy's allowlist and the page's tools name the same lookups.
  const sap = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'functions', 'api', 'sap', '[[path]].js'), 'utf8');
  for (const n of all) assert.match(sap, new RegExp(`\\n  ${n}: \\{`), n);
});

test('the system prompt says board first, SAP only when the board does not hold it, never guess, name the source', async () => {
  const { page } = await sapPage();
  const system = page.run('aiSystemPrompt()');
  assert.match(system, /Board first: answer from the board tools when they hold the answer/);
  assert.match(system, /sap_ tool[\s\S]*only when the board does not[\s\S]*stock on hand, deliveries, invoices, prices, lead times, production orders/);
  assert.match(system, /Never guess/);
  assert.match(system, /Say which source the answer comes from \(the board or SAP\)/);
});

test('an SAP tool call fetches /api/sap/data with only its params, shows "Asking SAP: order 45126", and ends "From SAP · live at"', async () => {
  const { page, calls } = await sapPage({ answers: [
    turn([{ type: 'tool_use', id: 't1', name: 'sap_so_detail', input: { docnum: '45126', sql: 'DROP' } }]),
    turn([{ type: 'text', text: 'Order 45126 (SAP):\n\n| Item | Open qty | Open value |\n|---|---:|---:|\n| SPY-100 | 4 | $1,250.50 |\n| <img src=x onerror=alert(1)> | 0 | $0 |' }]),
  ] });
  await page.run("aiSend('What is on order 45126?')");
  const data = calls.find((c) => c.url.startsWith('/api/sap/data/'));
  assert.equal(data.url, '/api/sap/data/so_detail?docnum=45126');
  assert.equal(data.init.cache, 'no-store');
  assert.match(data.log, /class="ai-msg model pending sap"[\s\S]*Asking SAP: order 45126…/, 'shown while SAP answers');
  const result = JSON.parse(chats(calls)[1].body.messages[2].content[0].content);
  assert.equal(result.source, 'SAP (live)');
  assert.equal(result.row_count, 2);
  assert.equal(result.returned, 2);
  assert.equal(result.rows[0].ItemCode, 'SPY-100');
  const log = page.els['ai-log'].innerHTML;
  assert.doesNotMatch(log, /<img|<b>Hot/, 'nothing from the model or SAP becomes markup');
  assert.match(log, /<th class="num">Open value<\/th>[\s\S]*<td class="num">\$1,250\.50<\/td>/);
  assert.match(log, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const time = new Date(Date.parse('2026-11-13T14:14:05-06:00')).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  assert.match(log, new RegExp(`<p class="ai-src sap">[\\s\\S]*From SAP · live at (Nov 13, )?${time.replace(/\s/g, '\\s')}</span></p></div>$`), 'the source line ends the answer');
  assert.doesNotMatch(log, /Asking SAP/, 'the progress line is gone once answered');
});

test('a stale SAP read says "last good read"; board-only answers say "From the board"; both say both', async () => {
  let { page } = await sapPage({ data: () => ok(SO({ stale: true })), answers: [
    turn([{ type: 'tool_use', id: 't1', name: 'sap_item_stock', input: { item: 'SPY-100' } }]), turn([{ type: 'text', text: 'Stock' }]),
  ] });
  await page.run("aiSend('Stock of SPY-100?')");
  assert.match(page.els['ai-log'].innerHTML, /<p class="ai-src sap stale">[\s\S]*From SAP · last good read at /);
  ({ page } = await sapPage({ answers: [turn([{ type: 'tool_use', id: 't1', name: 'get_overview', input: {} }]), turn([{ type: 'text', text: 'At risk' }])] }));
  await page.run("aiSend('At risk?')");
  assert.match(page.els['ai-log'].innerHTML, /<p class="ai-src">[\s\S]*<span>From the board<\/span><\/p>/);
  ({ page } = await sapPage({ answers: [
    turn([{ type: 'tool_use', id: 't1', name: 'get_overview', input: {} }, { type: 'tool_use', id: 't2', name: 'sap_so_detail', input: { docnum: 45126 } }]), turn([{ type: 'text', text: 'Both' }]),
  ] }));
  await page.run("aiSend('Both?')");
  assert.match(page.els['ai-log'].innerHTML, /From the board and SAP · live at /);
  assert.equal(page.run("aiSourceText(null)"), '', 'no lookups, no source line');
});

test('SAP rows are capped at 50 for the model, with counts and truncated; errors go back to the model', async () => {
  const many = Array.from({ length: 180 }, (_, i) => ({ DocNum: i + 1, Note: 'x'.repeat(400) }));
  let { page, calls } = await sapPage({ data: () => ok(SO({ rows: many, row_count: 180 })), answers: [
    turn([{ type: 'tool_use', id: 't1', name: 'sap_so_detail', input: { docnum: 1 } }]), turn([{ type: 'text', text: 'Cut' }]),
  ] });
  await page.run("aiSend('All?')");
  let result = JSON.parse(chats(calls)[1].body.messages[2].content[0].content);
  assert.equal(result.row_count, 180);
  assert.ok(result.rows.length <= 50);
  assert.equal(result.truncated, true);
  assert.match(result.note, /say the list is cut/);
  assert.ok(result.rows[0].Note.length <= 161, 'long text is cut');
  ({ page, calls } = await sapPage({ data: () => ok({ error: "'docnum' must be a whole number from 1 to 2147483647." }, 400), answers: [
    turn([{ type: 'tool_use', id: 't1', name: 'sap_so_detail', input: { docnum: 'abc' } }]), turn([{ type: 'text', text: 'Could not read SAP' }]),
  ] }));
  await page.run("aiSend('Order abc?')");
  const block = chats(calls)[1].body.messages[2].content[0];
  assert.equal(block.is_error, true);
  assert.match(JSON.parse(block.content).error, /whole number/);
  assert.doesNotMatch(page.els['ai-log'].innerHTML, /From SAP/, 'a failed lookup is not named as the source');
  // A tool the catalog did not list is refused here, without a request.
  ({ page, calls } = await sapPage({ answers: [turn([{ type: 'tool_use', id: 't1', name: 'sap_po_detail', input: { docnum: 1 } }]), turn([{ type: 'text', text: 'No' }])] }));
  await page.run("aiSend('PO 1?')");
  assert.ok(!calls.some((c) => c.url.startsWith('/api/sap/data/')));
  assert.match(JSON.parse(chats(calls)[1].body.messages[2].content[0].content).error, /not available/);
});

test('with live SAP a question works before an export is loaded; without it, the load hint stays', async () => {
  let { page, calls } = await sapPage({ load: false, answers: [turn([{ type: 'text', text: 'From SAP' }])] });
  await page.run("aiSend('Order 45126?')");
  assert.equal(chats(calls).length, 1);
  ({ page, calls } = await sapPage({ load: false, live: false }));
  await page.run("aiSend('Order 45126?')");
  assert.equal(chats(calls).length, 0);
  assert.match(page.els['ai-log'].innerHTML, /Load a KPI export first/);
});

test('the consent area says SAP lookups go to the provider too, only when live SAP is set up', async () => {
  const { page } = await sapPage();
  await page.run('aiCheckStatus()');
  page.run('aiSyncSettings()');
  assert.equal(page.els['ai-sap-note'].hidden, false);
  assert.equal(page.els['ai-sap-note'].textContent, 'SAP lookups are sent to Anthropic too.');
  page.run('sapLive.configured=false;aiSyncSettings()');
  assert.equal(page.els['ai-sap-note'].hidden, true);
  assert.match(require('./harness').HTML, /id="ai-sap-note"[^>]*hidden>SAP lookups are sent to this provider too\.</);
});

run();
