// Review fixes for Ask AI, the password gate and the MCP server. Run: node tests/review-ai-proxy-mcp.test.js
// (The Gemini-only checks left with the Gemini panel in 1v9; the four-provider panel is covered by tests/ask-ai.test.js.)
// Fixtures are synthetic; fetch is mocked, so nothing leaves the machine.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const SERVER = path.join(__dirname, '..', 'mcp', 'spyder-kpi-mcp.mjs');
const tool = (page, name, args = {}) => page.run(`aiRunTool(${JSON.stringify(name)},${JSON.stringify(args)})`);

// --- get_build_risk with a Clear To Build workbook ------------------------------------------------------
const HEAD = ['CM ', 'Month', 'Total', 'Clear To Build', 'At Risk', 'Late', 'Closed', '% CTB', '% Late Orders', 'NOTES'];
const CTB_SHEETS = [
  { name: '0930 - Orders at Risk', aoa: [HEAD, ['DSM', 'September', 10, 8, 2, 1, 0, '80%', '10%', 'Waiting on boards'], [null, 'October', 6, 6, 0, 0, 0, '100%', '0%'], [null, 'TOTAL', 16, 14, 2, 1, 0, '88%', '6%']] },
  { name: '0924 - Orders at Risk', aoa: [HEAD, ['DSM', 'September', 20, 5, 15, 3, 0, '25%', '15%']] },
];
const CTB_KPI = sapExport([
  sapRow({ DocumentNumber: '71001', Warehouse: 'CM - DSM', DueDate: '09/15/2026', HeaderDueDate: '09/15/2026', LineDueDate: '09/15/2026' }),
]);
function ctbWorkbook(page) {
  return new Uint8Array(page.run(`(()=>{
    const wb=XLSX.utils.book_new();
    for(const s of ${JSON.stringify(CTB_SHEETS)})XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.aoa),s.name);
    return Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));
  })()`));
}

test('get_build_risk reports the picked (default newest) report week instead of failing', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'kpi.xls', bytes: CTB_KPI }, { name: 'Orders At Risk - Clear to Build.xlsx', bytes: ctbWorkbook(page) }]);
  const br = tool(page, 'get_build_risk');
  assert.equal(br.error, undefined, br.error);
  assert.equal(br.loaded, true);
  assert.deepEqual([br.report_week, br.report_weeks], ['Sep 30', ['Sep 30', 'Sep 24']]);
  assert.deepEqual([br.ctb_rows, br.total_orders, br.clear_to_build, br.at_risk, br.late, br.clear_to_build_pct], [2, 16, 14, 2, 1, 88]);
  assert.deepEqual(br.buckets.map((b) => [b.cm, b.month, b.matched_so_lines]), [['DSM', '2026-09', 1], ['DSM', '2026-10', 0]]);
  // The week picked on the Build Risk page is the one reported.
  page.run("setBuildRiskSnapshot('2026-09-24')");
  const older = tool(page, 'get_build_risk');
  assert.deepEqual([older.report_week, older.total_orders, older.at_risk, older.late], ['Sep 24', 20, 15, 3]);
  // A CTB report alone (no KPI export) still answers.
  const alone = loadPage();
  await upload(alone, [{ name: 'Orders At Risk - Clear to Build.xlsx', bytes: ctbWorkbook(alone) }]);
  assert.deepEqual([tool(alone, 'get_build_risk').loaded, tool(alone, 'get_build_risk').total_orders], [true, 16]);
});

test('MCP get_build_risk answers with a Clear To Build workbook loaded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spyder kpi ctb '));
  try {
    const kpi = path.join(dir, 'kpi export.xls');
    const ctb = path.join(dir, 'Orders At Risk - Clear to Build.xlsx');
    fs.writeFileSync(kpi, CTB_KPI);
    fs.writeFileSync(ctb, ctbWorkbook(loadPage()));
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_build_risk', arguments: {} } },
    ].map((m) => JSON.stringify(m)).join('\n') + '\n';
    const r = spawnSync(process.execPath, [SERVER, kpi, ctb], { input, encoding: 'utf8', timeout: 60000, env: { ...process.env, SPYDER_KPI_FILES: '' } });
    const reply = r.stdout.trim().split('\n').map((l) => JSON.parse(l)).find((m) => m.id === 2);
    assert.ok(reply, r.stderr);
    assert.equal(reply.result.isError, undefined, reply.result.content[0].text);
    const data = JSON.parse(reply.result.content[0].text);
    assert.deepEqual([data.loaded, data.report_week, data.total_orders, data.clear_to_build, data.at_risk, data.late], [true, 'Sep 30', 16, 14, 2, 1]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Password gate for the page's background calls -----------------------------------------------------
const KPI_ROWS = [
  sapRow({ DocumentNumber: '500', LineDueDate: '08/01/2026', DueDate: '08/01/2026' }),
  sapRow({ DocumentNumber: '501', Warehouse: 'CM - Alta', CustomerVendorCode: 'AQUHOT', CustomerVendorName: 'Aqua Hot', LineDueDate: '08/15/2026', DueDate: '08/15/2026', AmountLocal: '700.00' }),
  sapRow({ DocumentNumber: '502', Warehouse: 'CM - Bravo', CustomerVendorCode: 'AQUMAR', CustomerVendorName: 'Aqua Marine', LineDueDate: '08/20/2026', DueDate: '08/20/2026', AmountLocal: '500.00' }),
  sapRow({ DocumentNumber: '503', Warehouse: 'Spyder - Lacombe', LineDueDate: '09/25/2026', DueDate: '09/25/2026', AmountLocal: '150.00' }),
];
async function kpiPage(storage = {}) {
  const page = loadPage({ storage });
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(KPI_ROWS) }]);
  return page;
}
// The real password gate, loaded from functions/_middleware.js (an ES module) with fake secrets.
const gate = (async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'functions', '_middleware.js'), 'utf8');
  const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const env = { DASHBOARD_PASSWORD: 'pw', SESSION_SECRET: 's'.repeat(40) };
  return (p, init) => onRequest({ request: new Request('https://kpi.example.test' + p, init), env, next: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) });
})();

test('the password gate answers unauthenticated /api/* with a 401 JSON error; page loads still get the form', async () => {
  const call = await gate;
  for (const [p, init] of [['/api/ai/status'], ['/api/ai/chat', { method: 'POST', body: '{}' }], ['/api/report']]) {
    const res = await call(p, init);
    assert.equal(res.status, 401, p);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal((await res.json()).error.code, 401);
  }
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /action="\/login"/);
});

// --- get_overview filters by part of a name ---------------------------------------------------------------
test('get_overview with part of a name covers every match, like search_lines', async () => {
  const page = await kpiPage();
  for (const [arg, q, names] of [['warehouse', 'CM', ['CM - Alta', 'CM - Bravo']], ['customer', 'aqua', ['AQUHOT - Aqua Hot', 'AQUMAR - Aqua Marine']]]) {
    const o = tool(page, 'get_overview', { [arg]: q });
    const s = tool(page, 'search_lines', { scope: 'at_risk', [arg]: q });
    assert.equal(s.total_matches, 2);
    assert.deepEqual([o.order_health.at_risk.lines, o.order_health.at_risk.open_value], [s.total_matches, s.open_value_of_matches], `${arg} ${q}`);
    assert.deepEqual(o.filters[arg], names);
  }
  // An exact code or name picks that one alone.
  const exact = tool(page, 'get_overview', { customer: 'AQUHOT' });
  assert.deepEqual([exact.filters.customer, exact.order_health.at_risk.lines], [['AQUHOT - Aqua Hot'], 1]);
  assert.equal(tool(page, 'get_overview').filters.warehouse, 'All');
  assert.deepEqual(page.run('weeklyWarehouseFilter'), ['ALL'], 'the page filters are left alone');
});

// --- Chat reset on a new export ----------------------------------------------------------------------------
test('loading an export clears the chat at once and drops an answer still pending from the old data', async () => {
  const page = await kpiPage({ spyderKpiAiConsentV2: JSON.stringify({ anthropic: '2026-10-09' }) });
  const status = { hosted: true, providers: [{ id: 'anthropic', name: 'Anthropic', short: 'Anthropic', tier: 'paid', configured: true, models: ['claude-opus-5-5'], defaultModel: 'claude-opus-5-5' }] };
  const answer = (t) => ({ ok: true, status: 200, json: async () => ({ stop: 'end', text: t, toolCalls: [], message: { role: 'assistant', content: [{ type: 'text', text: t }] } }) });
  let next = async () => answer('At risk lines: 3');
  page.ctx.fetch = async (url, init = {}) => (/\/status$/.test(url) ? { ok: true, status: 200, json: async () => status } : next(url, init));
  page.ctx.location.protocol = 'https:';
  page.ctx.AbortController = AbortController;
  page.run('aiToggle(true)');
  await page.run("aiSend('What is at risk?')");
  assert.match(page.els['ai-log'].innerHTML, /At risk lines: 3/);

  // New file with only part of the data: the old answer leaves the screen without another question being sent.
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(KPI_ROWS.slice(0, 1)) }]);
  assert.doesNotMatch(page.els['ai-log'].innerHTML, /At risk lines/);
  assert.deepEqual([page.run('aiState.messages.length'), page.run('aiState.history.length')], [0, 0]);

  // A question pending while another export loads is stopped, and nothing from it lands in the new chat.
  let release;
  next = (url, init) => new Promise((resolve, reject) => {
    release = () => resolve(answer('Late answer from the old data'));
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const pending = page.run("aiSend('Second question')");
  await new Promise((r) => setTimeout(r, 20));
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(KPI_ROWS) }]);
  release();
  await pending;
  assert.deepEqual([page.run('aiState.messages.length'), page.run('aiState.history.length'), page.run('aiState.busy')], [0, 0, false]);
  assert.doesNotMatch(page.els['ai-log'].innerHTML, /Second question|Late answer|Stopped/);
});

// --- Ask AI drawer keyboard -------------------------------------------------------------------------------
// A fake focusable control; hidden ones have no client rects, like display:none in a browser.
function control(doc, name, { hidden = false, disabled = false, attrs = {} } = {}) {
  return { name, disabled, dataset: {}, attrs, getClientRects: () => (hidden ? [] : [{}]), focus() { doc.activeElement = this; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; } };
}
const key = (k, shiftKey = false) => ({ key: k, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

test('below 1600px Tab and Shift+Tab stay inside the open drawer; Esc closes it from anywhere', async () => {
  const page = await kpiPage();
  const doc = page.ctx.document;
  const [first, hiddenOne, last] = [control(doc, 'first'), control(doc, 'hidden', { hidden: true }), control(doc, 'last')];
  doc.getElementById('ai-panel').querySelectorAll = () => [first, hiddenOne, last];
  let wide = false;
  page.ctx.matchMedia = (q) => ({ matches: wide && /min-width:1600px/.test(q) });
  page.run('aiToggle(true)');
  assert.equal(page.els['ai-panel'].hidden, false);

  first.focus();
  const back = key('Tab', true);
  page.ctx.aiPanelKey(back);
  assert.deepEqual([doc.activeElement.name, back.defaultPrevented], ['last', true], 'Shift+Tab on the first control wraps to the last');
  const fwd = key('Tab');
  page.ctx.aiPanelKey(fwd);
  assert.deepEqual([doc.activeElement.name, fwd.defaultPrevented], ['first', true], 'Tab on the last visible control wraps to the first');
  wide = true; // page space is kept for the drawer, so focus may leave it
  const free = key('Tab', true);
  page.ctx.aiPanelKey(free);
  assert.deepEqual([doc.activeElement.name, free.defaultPrevented], ['first', false]);

  // Esc with focus on the page (outside the drawer) still closes it; Esc already used by the search box does not.
  const used = key('Escape');
  used.preventDefault();
  page.ctx.aiDocKey(used);
  assert.equal(page.els['ai-panel'].hidden, false);
  page.ctx.aiDocKey(key('Escape'));
  assert.equal(page.els['ai-panel'].hidden, true);
  assert.match(require('./harness').HTML, /document\.addEventListener\('keydown',aiDocKey\)/);
});

test('closing Ask AI returns focus to the button that opened it; every Ask AI button reports aria-expanded', async () => {
  const page = await kpiPage();
  // 2v7: the Connect page moved into Settings ('connect' opens Settings at its card); the header's Ask AI button and
  // Settings' Open Ask AI settings button (hosted site) both control the panel.
  page.run("setTab('connect')");
  assert.equal(page.run('activeTab'), 'settings');
  assert.match(page.els['app-header'].innerHTML, /data-focus-key="ask-ai" aria-label="Ask AI" aria-controls="ai-panel" aria-expanded="false"/);
  page.run("aiState.status={hosted:true,providers:[]};renderResults()");
  assert.match(page.els['results-screen'].innerHTML, /data-focus-key="stg-open-ai" aria-controls="ai-panel" aria-expanded="false"/);
  const doc = page.ctx.document;
  // The header's button comes first in the document, as in the real page.
  const header = control(doc, 'header'), connect = control(doc, 'connect');
  header.dataset.focusKey = 'ask-ai';
  connect.dataset.focusKey = 'stg-open-ai';
  doc.querySelectorAll = (sel) => (sel === '[aria-controls="ai-panel"]' ? [header, connect] : []);
  connect.focus();
  page.run('aiToggle(true)');
  assert.deepEqual([header.attrs['aria-expanded'], connect.attrs['aria-expanded']], ['true', 'true']);
  page.ctx.aiDocKey(key('Escape'));
  assert.equal(doc.activeElement.name, 'connect', 'focus goes back to Open Ask AI settings, not the header button');
  assert.deepEqual([header.attrs['aria-expanded'], connect.attrs['aria-expanded']], ['false', 'false']);
  // Opened from the header: focus returns there.
  header.focus();
  page.run('aiToggle()');
  page.run('aiToggle()');
  assert.equal(doc.activeElement.name, 'header');
});

run();
