// Review fixes for Ask AI, the Gemini proxy / password gate and the MCP server. Run: node tests/review-ai-proxy-mcp.test.js
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

// --- Expired site sign-in in server-key mode -------------------------------------------------------------
const KEY = 'test-key-not-real-123';
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
const memStorage = () => { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; } }; };
// The real password gate, loaded from functions/_middleware.js (an ES module) with fake secrets.
const gate = (async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'functions', '_middleware.js'), 'utf8');
  const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const env = { DASHBOARD_PASSWORD: 'pw', SESSION_SECRET: 's'.repeat(40) };
  return (p, init) => onRequest({ request: new Request('https://kpi.example.test' + p, init), env, next: async () => new Response('{"configured":true}', { headers: { 'content-type': 'application/json' } }) });
})();
// Routes the page's fetch: /api/* to `site`, Google to a recorder that answers with a short text reply.
function route(page, site) {
  const calls = [];
  page.ctx.fetch = async (url, init = {}) => {
    calls.push(url);
    if (url.startsWith('/api/')) return site(url, init);
    return { ok: true, status: 200, json: async () => (/models\?/.test(url) ? { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] } : { candidates: [{ content: { role: 'model', parts: [{ text: 'Own-key answer' }] } }] }) };
  };
  page.ctx.location.protocol = 'https:';
  page.ctx.sessionStorage = memStorage();
  page.ctx.AbortController = AbortController;
  return calls;
}

test('the password gate answers unauthenticated /api/* with a 401 JSON error; page loads still get the form', async () => {
  const call = await gate;
  for (const [p, init] of [['/api/gemini/status'], ['/api/gemini/models?pageSize=100'], ['/api/gemini/models/gemini-2.5-flash:generateContent', { method: 'POST', body: '{}' }]]) {
    const res = await call(p, init);
    assert.equal(res.status, 401, p);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal((await res.json()).error.code, 401);
  }
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /action="\/login"/);
});

test('an expired sign-in never switches Ask AI to a remembered personal key, and says so', async () => {
  const call = await gate;
  // Before any status check: the gate's real 401 for /api/gemini/status.
  const page = await kpiPage({ spyderKpiGeminiKeyV1: KEY, spyderKpiAiConsentV1: '1' });
  const calls = route(page, (url, init) => call(url, init));
  page.run('aiToggle(true)');
  await page.run("aiSend('What is at risk?')");
  assert.deepEqual(calls.filter((u) => !u.startsWith('/api/')), [], 'nothing went to Google under the personal key');
  assert.equal(page.run('aiState.server'), false);
  assert.match(page.els['ai-log'].innerHTML, /sign-in to this site has expired/);
  assert.match(page.els['ai-settings-status'].textContent, /sign-in to this site has expired/);

  // After a good status check, the session expires: an HTML 200 (an old gate) or a 401 both say sign in again.
  for (const expired of [async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }), (url, init) => call(url, init)]) {
    const p2 = await kpiPage({ spyderKpiAiConsentV1: '1' });
    let signedIn = true;
    route(p2, (url, init) => (signedIn ? { ok: true, status: 200, json: async () => (/status$/.test(url) ? { configured: true } : { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) } : expired(url, init)));
    await p2.run('aiPrepare()');
    assert.equal(p2.run('aiState.server'), true);
    signedIn = false;
    await p2.run("aiSend('hello')");
    assert.match(p2.els['ai-log'].innerHTML, /sign-in to this site has expired/);
    assert.doesNotMatch(p2.els['ai-log'].innerHTML, /empty answer/);
  }

  // A site without /api/gemini (404) still uses the personal key.
  const local = await kpiPage({ spyderKpiGeminiKeyV1: KEY, spyderKpiAiConsentV1: '1' });
  const localCalls = route(local, async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('not json'); } }));
  await local.run("aiSend('hello')");
  assert.ok(localCalls.some((u) => u.startsWith('https://generativelanguage.googleapis.com/')));
  assert.match(local.els['ai-log'].innerHTML, /Own-key answer/);
});

run();
