// Tests for the Ask AI tool layer (KPI_TOOLS) and the Gemini chat in index.html. Run: node tests/ai.test.js
// Fixtures are synthetic; fetch is mocked, so nothing leaves the machine.
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const KEY = 'test-key-not-real-123';
// As of 2026-09-03 (the fixture ExportDate): this week is Aug 30 - Sep 5.
const ROWS = [
  sapRow({ DocumentNumber: '500', LineDueDate: '08/01/2026', DueDate: '08/01/2026', AmountLocal: '1,000.00' }),
  sapRow({ DocumentNumber: '501', CustomerVendorCode: 'AQUHOT', CustomerVendorName: 'Aqua Hot', Warehouse: 'CM - Alta', LineDueDate: '08/15/2026', DueDate: '08/15/2026', LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111', AmountLocal: '700.00' }),
  sapRow({ DocumentNumber: '502', LineDueDate: '08/20/2026', DueDate: '08/20/2026', LineRescheduleDate: '09/20/2026', RescheduleDate: '09/20/2026', AmountLocal: '500.00' }),
  sapRow({ DocumentNumber: '503', Warehouse: 'CM - Alta', LineDueDate: '09/04/2026', DueDate: '09/04/2026', AmountLocal: '300.00' }),
  sapRow({ DocumentNumber: '504', LineDueDate: '09/10/2026', DueDate: '09/10/2026', AmountLocal: '200.00' }),
  sapRow({ DocumentNumber: '505', LineDueDate: '09/25/2026', DueDate: '09/25/2026', AmountLocal: '150.00', ItemDescription: 'Display <panel>' }),
  sapRow({ DocumentNumber: '506', LineDueDate: '08/30/2026', DueDate: '08/30/2026', Status: 'Closed', OpenQuantity: '0', ClosedDate: '09/01/2026', CloseDateSource: 'Delivery', AmountLocal: '0' }),
  sapRow({ DocumentNumber: '506', LineDueDate: '08/30/2026', DueDate: '08/30/2026', Status: 'Closed', OpenQuantity: '0', ClosedDate: '09/01/2026', CloseDateSource: 'Delivery', DeliveryDocNumber: '9001', OrderType: 'Delivery', AmountLocal: '400.00' }),
  sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '700', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Parts', LineDueDate: '08/10/2026', DueDate: '08/10/2026', OpenQuantity: '5.000', Quantity: '5.000', AmountLocal: '250.00', Confirmed: 'N' }),
  sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '701', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Parts', LineDueDate: '08/12/2026', DueDate: '08/12/2026', RescheduleDate: '11/11/1111', AmountLocal: '120.00' }),
  sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '702', CustomerVendorCode: 'BOLT', CustomerVendorName: 'Bolt Co', Warehouse: 'CM - Alta', LineDueDate: '08/25/2026', DueDate: '08/25/2026', RescheduleDate: '09/15/2026', LineRescheduleDate: '09/15/2026', AmountLocal: '90.00' }),
];

async function loaded(opts) {
  const page = loadPage(opts);
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(ROWS) }]);
  return page;
}
const tool = (page, name, args = {}) => page.run(`aiRunTool(${JSON.stringify(name)},${JSON.stringify(args)})`);
const dollars = (s) => Number(String(s).replace(/[$,]/g, ''));
// A KPI card's count and money line, read from the rendered page.
function card(html, label) {
  const m = html.match(new RegExp(`${label}</span>[\\s\\S]*?data-count="(\\d+)"[^>]*>[^<]*</span>[\\s\\S]*?class="kpi-amt">([^<]+)<`));
  assert.ok(m, `card ${label} not found`);
  return { count: Number(m[1]), value: dollars(m[2]) };
}
function mini(html, label, unit) {
  const m = html.match(new RegExp(`${label}</span>[\\s\\S]*?class="ms-big[^"]*">([\\d,]+)${unit}</span><span class="ms-amt">([^<]+)<`));
  assert.ok(m, `mini ${label} not found`);
  return { count: Number(m[1].replace(/,/g, '')), value: dollars(m[2]) };
}
function hero(html) {
  const m = html.match(/data-count="(\d+)" data-fmt="money">[^<]*<\/span><span class="kpi-unit">([\d,]+) (?:orders · ([\d,]+) )?lines/);
  assert.ok(m, 'hero not found');
  return { value: Number(m[1]), first: Number(m[2]), lines: m[3] === undefined ? undefined : Number(m[3]) };
}
function storage() {
  const s = {};
  return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; } };
}
// fetch mock: routes by URL; generateContent answers come from a queue.
function mockFetch(page, answers = []) {
  const calls = [];
  page.ctx.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (/\/models\?pageSize=100$/.test(url)) {
      return { ok: true, status: 200, json: async () => ({ models: [
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
      ] }) };
    }
    const next = answers.shift();
    if (typeof next === 'function') return next(url, init);
    return { ok: next.status === undefined, status: next.status || 200, json: async () => next.body || next };
  };
  page.ctx.sessionStorage = storage();
  page.ctx.AbortController = AbortController;
  return calls;
}
async function connect(page) {
  page.run('aiSetConsent(true)');
  page.ctx.document.getElementById('ai-key').value = KEY;
  page.run('aiSaveKey()');
  await new Promise((r) => setTimeout(r, 20));
}

// --- Tool layer ---------------------------------------------------------------------------------------
test('get_overview equals the Order Health tiles with all filters, and leaves page filters alone', async () => {
  const page = await loaded();
  const html = page.els['results-screen'].innerHTML;
  const o = tool(page, 'get_overview');
  assert.equal(o.as_of, '2026-09-03');
  assert.deepEqual(o.files.rows, { sales_order_rows: 8, purchase_order_rows: 3, supply_demand_rows: 0, clear_to_build_rows: 0 });
  const oh = o.order_health;
  const h = hero(html);
  assert.deepEqual([oh.at_risk.open_value, oh.at_risk.orders, oh.at_risk.lines], [h.value, h.first, h.lines]);
  assert.deepEqual([oh.at_risk.past_due_no_reschedule_lines, oh.at_risk.no_commit_lines, oh.at_risk.rescheduled_lines], [1, 1, 1]);
  for (const [label, key] of [['No commit date', 'no_commit'], ['Rescheduled', 'rescheduled'], ['This week focus', 'this_week_focus']]) {
    assert.deepEqual(card(html, label), { count: oh[key].orders, value: oh[key].open_value }, label);
  }
  for (const [label, key] of [['Due next week', 'due_next_week'], ['Due this month', 'due_this_month'], ['All open orders', 'all_open']]) {
    assert.deepEqual(mini(html, label, ' orders'), { count: oh[key].orders, value: oh[key].open_value }, label);
  }
  assert.equal(oh.fill_rate.rate_pct, Number(html.match(/Fill rate<\/span>[\s\S]*?data-count="(\d+)" data-fmt="pct"/)[1]));
  assert.equal(oh.shipped_this_week.lines, Number(html.match(/Shipped this week<\/span>[\s\S]*?data-count="(\d+)"/)[1]));

  // With a warehouse picked on the page, the tool still reports All unless asked, and the page keeps its pick.
  page.run("setWeeklyWarehouseFilter(['CM - Alta'])");
  const filtered = hero(page.els['results-screen'].innerHTML);
  assert.deepEqual(tool(page, 'get_overview').order_health.at_risk, oh.at_risk);
  const f = tool(page, 'get_overview', { warehouse: 'alta' });
  assert.deepEqual(f.filters.warehouse, ['CM - Alta']);
  assert.deepEqual([f.order_health.at_risk.open_value, f.order_health.at_risk.orders], [filtered.value, filtered.first]);
  assert.deepEqual(page.run('weeklyWarehouseFilter'), ['CM - Alta']);
  assert.match(tool(page, 'get_overview', { customer: 'nobody here' }).error, /No customer "nobody here"/);
});

test('get_overview equals the Purchase Orders tiles', async () => {
  const page = await loaded();
  page.run("setPoVendorFilter(['BOLT'])");
  page.run("setTab('purchaseorders')");
  const boltHero = hero(page.els['results-screen'].innerHTML);
  page.run('resetPoFilters()');
  const html = page.els['results-screen'].innerHTML;
  const po = tool(page, 'get_overview').purchase_orders;
  const h = hero(html);
  assert.deepEqual([po.late_missed_commit.open_value, po.late_missed_commit.lines], [h.value, h.first]);
  assert.deepEqual([po.late_missed_commit.lines, po.no_commit.lines, po.future_reschedules.lines], [1, 1, 1]);
  for (const [label, key] of [['No commit date', 'no_commit'], ['Future reschedules', 'future_reschedules'], ['This week focus', 'this_week_focus']]) {
    assert.deepEqual(card(html, label), { count: po[key].lines, value: po[key].open_value }, label);
  }
  for (const [label, key] of [['Due this month', 'due_this_month'], ['Unconfirmed', 'unconfirmed'], ['Missing price', 'missing_price'], ['All open POs', 'all_open']]) {
    assert.deepEqual(mini(html, label, ''), { count: po[key].lines, value: po[key].open_value }, label);
  }
  const bolt = tool(page, 'get_overview', { vendor: 'bolt' }).purchase_orders.late_missed_commit;
  assert.deepEqual([bolt.open_value, bolt.lines], [boltHero.value, boltHero.first]);
  assert.deepEqual(page.run('poVendorFilter'), ['ALL']);
});

test('search_lines: most overdue first, text filters, notes, limit and total', async () => {
  const page = await loaded();
  const key = page.run("rowKey(parsedRows.find(r=>r.documentNumber==='500'))");
  page.run(`updateRowOverride(${JSON.stringify(key)},'notes','Waiting on board rev B')`);
  const r = tool(page, 'search_lines', { scope: 'at_risk' });
  assert.equal(r.total_matches, 3);
  assert.deepEqual(r.rows.map((x) => x.doc), ['500', '501', '502']);
  assert.deepEqual(r.rows.map((x) => x.status), ['Past due', 'No commit date', 'Rescheduled']);
  const first = r.rows[0];
  assert.equal(first.customer, 'Firefly RV');
  assert.equal(first.original_due, '2026-08-01');
  assert.equal(first.days_past_original_due, 33);
  assert.equal(first.open_value, 1000);
  assert.equal(first.notes, 'Waiting on board rev B');
  assert.equal(r.rows[1].reschedule, 'no commit date');
  assert.equal(r.rows[2].reschedule, '2026-09-20');
  assert.deepEqual(tool(page, 'search_lines', { scope: 'at_risk', query: 'BOARD rev' }).rows.map((x) => x.doc), ['500']);
  assert.deepEqual(tool(page, 'search_lines', { scope: 'open', warehouse: 'alta' }).rows.map((x) => x.doc), ['501', '503']);
  const lim = tool(page, 'search_lines', { scope: 'open', limit: 2 });
  assert.deepEqual([lim.total_matches, lim.returned, lim.rows.length], [6, 2, 2]);
  const po = tool(page, 'search_lines', { scope: 'po_late', vendor: 'acme' });
  assert.deepEqual([po.rows[0].doc, po.rows[0].vendor, po.rows[0].type], ['700', 'Acme Parts', 'Purchase Order']);
  assert.ok(tool(page, 'search_lines', { scope: 'all', query: '9001' }).rows.some((x) => x.type === 'Sales Order delivery' && x.status === 'Shipped' && x.closed === '2026-09-01'));
  assert.match(tool(page, 'search_lines', { scope: 'nope' }).error, /scope must be one of/);
});

test('group_totals: groups add up to the scope, largest value first', async () => {
  const page = await loaded();
  const g = tool(page, 'group_totals', { scope: 'open', by: 'warehouse' });
  assert.deepEqual(g.groups.map((x) => x.key), ['Spyder - Lacombe', 'CM - Alta']);
  assert.equal(g.groups.reduce((s, x) => s + x.open_value, 0), g.totals.open_value);
  assert.equal(g.totals.open_value, tool(page, 'get_overview').order_health.all_open.open_value);
  const v = tool(page, 'group_totals', { scope: 'po_open', by: 'vendor' });
  assert.deepEqual(v.groups[0], { key: 'ACME - Acme Parts', orders: 2, lines: 2, open_value: 370 });
  assert.match(tool(page, 'group_totals', { scope: 'open', by: 'colour' }).error, /by must be one of/);
});

test('get_monthly, build risk and supply / demand; no data loaded', async () => {
  const page = await loaded();
  const mo = tool(page, 'get_monthly');
  const sep = mo.months.find((x) => x.month === '2026-09');
  assert.equal(sep.shipped_value, 400);
  assert.equal(mo.year, 2026);
  assert.equal(tool(page, 'get_build_risk').loaded, false);
  assert.match(tool(page, 'get_supply_demand').hint, /supply \/ demand/);
  const empty = loadPage();
  assert.equal(empty.run("aiRunTool('get_overview',{}).loaded"), false);
  assert.equal(empty.run("aiRunTool('search_lines',{scope:'open'}).loaded"), false);
  // Tools without arguments are declared without parameters (Gemini rejects an empty OBJECT schema).
  const decl = page.run('aiDeclarations()');
  assert.deepEqual(decl.map((d) => d.name), ['get_overview', 'search_lines', 'group_totals', 'get_monthly', 'get_build_risk', 'get_supply_demand']);
  assert.equal(decl[3].parameters, undefined);
  assert.deepEqual(decl[1].parameters.required, ['scope']);
  assert.ok(JSON.stringify(tool(page, 'search_lines', { scope: 'all', limit: 100 })).length < 30000);
});

// --- Chat ---------------------------------------------------------------------------------------------
test('tool loop: a functionCall round, then text; thoughtSignature kept; key only in a header', async () => {
  const page = await loaded();
  const modelTurn = { role: 'model', parts: [{ functionCall: { id: 'call-1', name: 'get_overview', args: {} }, thoughtSignature: 'c2lnLTEyMw==' }] };
  const calls = mockFetch(page, [
    { candidates: [{ content: modelTurn, finishReason: 'STOP' }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: 'At risk: **$2,200** across 3 lines as of 2026-09-03.\n- Past due: 1' }] }, finishReason: 'STOP' }] },
  ]);
  await connect(page);
  assert.equal(page.run('aiState.model'), 'gemini-3.5-flash');
  await page.run("aiSend('What is at risk?')");
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => !c.url.includes(KEY)), 'the key is never in a URL');
  const [gen1, gen2] = calls.slice(1);
  assert.equal(gen1.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
  assert.equal(gen1.init.headers['x-goog-api-key'], KEY);
  const body1 = JSON.parse(gen1.init.body);
  assert.match(body1.systemInstruction.parts[0].text, /Spyder Controls/);
  assert.equal(body1.tools[0].functionDeclarations.length, 6);
  const body2 = JSON.parse(gen2.init.body);
  assert.deepEqual(body2.contents[0], { role: 'user', parts: [{ text: 'What is at risk?' }] });
  assert.deepEqual(body2.contents[1], modelTurn);
  const fr = body2.contents[2].parts[0].functionResponse;
  assert.deepEqual([body2.contents[2].role, fr.name, fr.id], ['user', 'get_overview', 'call-1']);
  assert.equal(fr.response.order_health.at_risk.lines, 3);
  const log = page.els['ai-log'].innerHTML;
  assert.match(log, /<strong>\$2,200<\/strong>/);
  assert.match(log, /<li>Past due: 1<\/li>/);
  assert.match(log, /Looked up: get_overview/);
  assert.match(page.els['ai-announce'].textContent, /^At risk: \$2,200 across 3 lines/, 'the answer is announced once, without markdown');
  assert.equal(page.run('aiState.history.length'), 4);
  assert.deepEqual(page.errors, []);
  for (const el of Object.values(page.els)) {
    assert.ok(![el.innerHTML, el.textContent, el.value].some((v) => String(v).includes(KEY)), `key rendered in #${el.id}`);
  }
});

test('consent is required before any request; no data and HTTP errors give friendly messages', async () => {
  const page = await loaded({ storage: { spyderKpiGeminiKeyV1: KEY } });
  const calls = mockFetch(page, [{ status: 429, body: { error: { code: 429, message: 'Resource exhausted' } } }, { status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } }]);
  page.run('aiToggle(true)');
  await page.run("aiSend('hello')");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 0, 'nothing is sent before consent');
  assert.equal(page.els['ai-settings'].hidden, false);
  assert.match(page.els['ai-settings-status'].textContent, /Tick the box/);

  page.run('aiSetConsent(true)');
  await new Promise((r) => setTimeout(r, 10));
  await page.run("aiSend('hello')");
  assert.match(page.els['ai-log'].innerHTML, /free-tier limit/);
  await page.run("aiSend('hello again')");
  assert.match(page.els['ai-log'].innerHTML, /did not accept this API key/);
  assert.equal(page.run('aiState.history.length'), 0, 'failed questions leave no half turns behind');

  const empty = loadPage({ storage: { spyderKpiGeminiKeyV1: KEY, spyderKpiAiConsentV1: '1' } });
  const none = mockFetch(empty);
  await empty.run("aiSend('hello')");
  assert.equal(none.length, 0);
  assert.match(empty.els['ai-log'].innerHTML, /Load a KPI export first/);
});

test('Stop aborts the request and Clear chat empties it', async () => {
  const page = await loaded({ storage: { spyderKpiGeminiKeyV1: KEY, spyderKpiAiConsentV1: '1' } });
  mockFetch(page, [(url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })]);
  const pending = page.run("aiSend('slow question')");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(page.els['ai-stop'].hidden, false);
  page.run('aiStop()');
  await pending;
  assert.match(page.els['ai-log'].innerHTML, /Stopped\./);
  assert.equal(page.run('aiState.history.length'), 0);
  page.run('aiClear()');
  assert.equal(page.run('aiState.messages.length'), 0);
  // Clear chat while a question is pending: the request stops and nothing comes back into the cleared chat.
  mockFetch(page, [(url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })]);
  const again = page.run("aiSend('another slow one')");
  await new Promise((r) => setTimeout(r, 20));
  page.run('aiClear()');
  await again;
  assert.deepEqual([page.run('aiState.messages.length'), page.run('aiState.history.length'), page.run('aiState.busy')], [0, 0, false]);
});

test('a newly loaded export starts a new chat', async () => {
  const page = await loaded({ storage: { spyderKpiGeminiKeyV1: KEY, spyderKpiAiConsentV1: '1' } });
  const text = (t) => ({ candidates: [{ content: { role: 'model', parts: [{ text: t }] }, finishReason: 'STOP' }] });
  const calls = mockFetch(page, [text('First answer'), text('Second answer'), text('Third answer')]);
  await page.run("aiSend('first')");
  await page.run("aiSend('second')");
  assert.equal(JSON.parse(calls[calls.length - 1].init.body).contents.length, 3, 'same data: the follow-up carries the earlier turn');
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(ROWS) }]);
  await page.run("aiSend('third')");
  assert.deepEqual(JSON.parse(calls[calls.length - 1].init.body).contents, [{ role: 'user', parts: [{ text: 'third' }] }]);
  assert.deepEqual(page.run('aiState.messages.map(m=>m.text)'), ['third', 'Third answer']);
});

test('server-key mode: requests go through /api/gemini without a key; an expired sign-in is explained', async () => {
  const page = await loaded({ storage: { spyderKpiAiConsentV1: '1' } });
  page.ctx.location.protocol = 'https:';
  const calls = mockFetch(page, [{ configured: true }, { status: 401, body: {} }]);
  await page.run("aiSend('hello')");
  assert.deepEqual(calls.map((c) => c.url), ['/api/gemini/status', '/api/gemini/models?pageSize=100', '/api/gemini/models/gemini-3.5-flash:generateContent']);
  assert.ok(calls.every((c) => !(c.init.headers || {})['x-goog-api-key']));
  assert.match(page.els['ai-log'].innerHTML, /sign-in to this site has expired/);
});

test('markdown renderer escapes HTML and renders the small markdown subset', () => {
  const page = loadPage();
  const md = '<img src=x onerror=alert(1)> **Bold** and *it* `<b>code</b>`\n- one\n- two\n\n1. first\n\n| Warehouse | Value |\n|---|---:|\n| <script>x</script> | $1 |';
  const html = page.run(`aiMarkdown(${JSON.stringify(md)})`);
  assert.doesNotMatch(html, /<img|<script|<b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<strong>Bold<\/strong> and <em>it<\/em> <code>&lt;b&gt;code&lt;\/b&gt;<\/code>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul><ol><li>first<\/li><\/ol>/);
  assert.match(html, /<th>Warehouse<\/th><th>Value<\/th>[\s\S]*<td>&lt;script&gt;x&lt;\/script&gt;<\/td><td>\$1<\/td>/);
});

test('a shared snapshot copy drops the chat, model list and typed values', () => {
  const page = loadPage();
  const node = (html) => ({ innerHTML: html, textContent: 'typed', attrs: { value: 'v', checked: '' }, removeAttribute(a) { delete this.attrs[a]; } });
  const log = node('<div class="ai-msg user">secret question</div>');
  const input = node('');
  const seen = [];
  const panel = { hidden: false, querySelectorAll: (sel) => (seen.push(sel), sel.startsWith('#ai-log') ? [log] : [input]) };
  const body = { removed: [], classList: { remove(c) { body.removed.push(c); } } };
  page.ctx.aiResetClone({ querySelector: (sel) => (sel === '#ai-panel' ? panel : sel === 'body' ? body : null) });
  assert.equal(panel.hidden, true);
  assert.deepEqual(body.removed, ['ai-open'], 'the copy does not keep the open-drawer page padding');
  assert.equal(log.innerHTML, '');
  for (const id of ['ai-log', 'ai-announce', 'ai-model', 'ai-mode', 'ai-settings-status']) assert.ok(seen[0].split(',').includes(`#${id}`), `#${id} is emptied in the copy`);
  assert.deepEqual([input.attrs, input.textContent], [{}, '']);
  assert.match(require('./harness').HTML, /aiResetClone\(root\);/);
});

run();
