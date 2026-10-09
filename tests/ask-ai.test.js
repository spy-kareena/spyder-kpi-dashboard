// Tests for Ask AI in index.html: the tool layer (KPI_TOOLS, shared with the MCP server) and the four-provider chat
// panel that talks to /api/ai. Run: node tests/ask-ai.test.js
// Fixtures are synthetic; fetch is mocked, so nothing leaves the machine.
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite, HTML } = require('./harness');
const { test, run } = createSuite();

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
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
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

// --- The site's /api/ai, mocked ---------------------------------------------------------------------------
const LABELS = { 'claude-opus-5-5': 'Claude Opus 5.5 (most capable)', 'claude-sonnet-5-5': 'Claude Sonnet 5.5 (faster, about half the cost)', 'claude-haiku-5-5': 'Claude Haiku 5.5 (fastest, lowest cost)' };
function siteStatus(configured = ['anthropic', 'groq']) {
  const on = (id) => configured.includes(id);
  const p = (id, name, short, tier, models, extra = {}) => ({ id, name, short, tier, configured: on(id), models: on(id) ? models : [], defaultModel: on(id) ? models[0] : '', modelLabels: {}, dataNotice: `${short} data notice: what is sent and kept.`, termsUrl: `https://${id}.example.test/terms`, secret: `${id.toUpperCase()}_API_KEY`, ...extra });
  return { hosted: true, configured: configured.length > 0, providers: [
    p('anthropic', 'Claude (Anthropic)', 'Claude', 'paid', ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], { modelLabels: LABELS }),
    p('openai', 'ChatGPT (OpenAI)', 'ChatGPT', 'paid', ['gpt-5', 'gpt-5-mini']),
    p('groq', 'Groq', 'Groq', 'free', ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile']),
    p('openrouter', 'OpenRouter (free models)', 'OpenRouter', 'free', ['meta-llama/llama-3.3-70b-instruct:free']),
  ] };
}
// Routes the page's fetch: /api/ai/status answers `status`; /api/ai/chat answers from a queue.
function site(page, { status = siteStatus(), answers = [] } = {}) {
  const calls = [];
  page.ctx.fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    if (url === '/api/ai/status') return typeof status === 'function' ? status() : { ok: true, status: 200, json: async () => status };
    const next = answers.shift();
    if (typeof next === 'function') return next(url, init);
    if (!next) throw new Error(`no answer queued for ${url}`);
    return { ok: next.status === undefined, status: next.status || 200, json: async () => next.body || next };
  };
  page.ctx.location.protocol = 'https:';
  page.ctx.AbortController = AbortController;
  return calls;
}
const chats = (calls) => calls.filter((c) => c.url === '/api/ai/chat');
const consent = (...ids) => ({ spyderKpiAiConsentV2: JSON.stringify(Object.fromEntries(ids.map((id) => [id, '2026-10-09']))) });
// One normalized /api/ai/chat reply in each dialect.
function claudeTurn(content, stop) {
  const toolCalls = content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }));
  return { provider: 'anthropic', model: 'claude-opus-5-5', dialect: 'anthropic', stop: stop || (toolCalls.length ? 'tool_use' : 'end'), text: content.filter((b) => b.type === 'text').map((b) => b.text).join(''), toolCalls, message: { role: 'assistant', content } };
}
function openAiTurn({ text = '', calls = [], stop } = {}) {
  const toolCalls = calls.map((c) => ({ id: c.id, name: c.name, input: c.invalid ? {} : c.args, ...(c.invalid ? { invalid: true } : {}) }));
  const message = calls.length ? { role: 'assistant', content: text || null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.invalid ? '{oops' : JSON.stringify(c.args) } })) } : { role: 'assistant', content: text };
  return { provider: 'groq', model: 'openai/gpt-oss-120b', dialect: 'openai', stop: stop || (calls.length ? 'tool_use' : 'end'), text, toolCalls, message };
}

// --- Tool layer -------------------------------------------------------------------------------------------
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

test('get_monthly, build risk and supply / demand; no data loaded; tool definitions sent to the site', async () => {
  const page = await loaded();
  const mo = tool(page, 'get_monthly');
  assert.equal(mo.months.find((x) => x.month === '2026-09').shipped_value, 400);
  assert.equal(mo.year, 2026);
  assert.equal(tool(page, 'get_build_risk').loaded, false);
  assert.match(tool(page, 'get_supply_demand').hint, /supply \/ demand/);
  const empty = loadPage();
  assert.equal(empty.run("aiRunTool('get_overview',{}).loaded"), false);
  assert.equal(empty.run("aiRunTool('search_lines',{scope:'open'}).loaded"), false);
  const defs = page.run('aiToolDefs()');
  assert.deepEqual(defs.map((d) => d.name), ['get_overview', 'search_lines', 'group_totals', 'get_monthly', 'get_build_risk', 'get_supply_demand']);
  assert.deepEqual(Object.keys(defs[0]), ['name', 'description', 'parameters'], 'only the JSON parts, never the run function');
  assert.deepEqual(defs[1].parameters.required, ['scope']);
  assert.ok(JSON.stringify(tool(page, 'search_lines', { scope: 'all', limit: 100 })).length < 30000);
});

// --- Status and setup -------------------------------------------------------------------------------------
test('status: providers grouped Paid / Free, unconfigured ones disabled, default model picked, data notice shown', async () => {
  const page = await loaded();
  site(page);
  page.run('aiToggle(true)');
  await page.run('aiPrepare()');
  const picker = page.els['ai-provider'].innerHTML;
  assert.match(picker, /^<optgroup label="Paid"><option value="anthropic" selected>Claude \(Anthropic\)<\/option><option value="openai" disabled>ChatGPT \(OpenAI\) \(not set up\)<\/option><\/optgroup><optgroup label="Free"><option value="groq">Groq<\/option><option value="openrouter" disabled>OpenRouter \(free models\) \(not set up\)<\/option><\/optgroup>$/);
  assert.equal(page.run('aiState.model'), 'claude-opus-5-5');
  assert.match(page.els['ai-model'].innerHTML, /<option value="claude-opus-5-5" selected>Claude Opus 5\.5 \(most capable\)<\/option><option value="claude-sonnet-5-5">/);
  assert.equal(page.els['ai-mode'].textContent, 'Claude · Claude Opus 5.5');
  assert.equal(page.els['ai-tier'].textContent, 'Paid');
  assert.equal(page.els['ai-notice-text'].textContent, 'Claude data notice: what is sent and kept.');
  assert.equal(page.els['ai-terms'].href, 'https://anthropic.example.test/terms');
  assert.match(page.els['ai-consent-text'].textContent, /send my questions and the dashboard data needed to answer them to Claude/);
  // Not yet allowed: the settings view is shown, not the chat.
  assert.deepEqual([page.els['ai-settings'].hidden, page.els['ai-chat'].hidden, page.els['ai-setup'].hidden], [false, true, true]);
  page.run('aiSetConsent(true)');
  page.run('aiBackToChat()');
  assert.deepEqual([page.els['ai-settings'].hidden, page.els['ai-chat'].hidden], [true, false]);
  assert.match(page.els['ai-foot'].textContent, /Answers come from Claude \(claude-opus-5-5\)/);
  // The choice is remembered; a provider that is not set up cannot be picked.
  page.run("aiSetProvider('groq')");
  page.run("aiSetModel('llama-3.3-70b-versatile')");
  assert.deepEqual(JSON.parse(page.storage.spyderKpiAiChoiceV2), { provider: 'groq', model: 'llama-3.3-70b-versatile' });
  assert.equal(page.els['ai-tier'].textContent, 'Free');
  page.run("aiSetProvider('openai')");
  assert.equal(page.run('aiState.provider'), 'groq');
  page.run("aiSetModel('gpt-4o')");
  assert.equal(page.run('aiState.model'), 'llama-3.3-70b-versatile');
});

test('not set up: no keys on the site, a host without /api/ai, or a file copy show the setup view', async () => {
  const none = await loaded();
  const calls = site(none, { status: siteStatus([]) });
  none.run('aiToggle(true)');
  await none.run('aiPrepare()');
  assert.deepEqual([none.els['ai-setup'].hidden, none.els['ai-settings'].hidden, none.els['ai-chat'].hidden], [false, true, true]);
  assert.match(none.els['ai-setup-why'].textContent, /None of the four AI providers has a key set up/);
  assert.equal(none.els['ai-mode'].textContent, 'Not set up');
  await none.run("aiSend('hello')");
  assert.equal(chats(calls).length, 0, 'nothing is sent');

  const iis = await loaded();
  site(iis, { status: () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('html'); } }) });
  iis.run('aiToggle(true)');
  await iis.run('aiPrepare()');
  assert.equal(iis.els['ai-setup'].hidden, false);
  assert.match(iis.els['ai-setup-why'].textContent, /needs the hosted dashboard/);

  const file = await loaded();
  let fetched = 0;
  file.ctx.fetch = async () => { fetched++; throw new Error('no network'); };
  file.run('aiToggle(true)');
  await file.run('aiPrepare()');
  assert.equal(fetched, 0, 'a file copy does not call the network');
  assert.equal(file.els['ai-setup'].hidden, false);

  // A shared snapshot never asks the site it is opened from, even over https.
  const snap = await loaded({ storage: consent('anthropic') });
  const snapCalls = site(snap);
  snap.run('isSnapshotView=true');
  snap.run('aiToggle(true)');
  await snap.run('aiPrepare()');
  await snap.run("aiSend('hello')");
  assert.equal(snapCalls.length, 0, 'a snapshot sends nothing anywhere');
  assert.equal(snap.els['ai-setup'].hidden, false);
  assert.match(snap.els['ai-setup-why'].textContent, /shared snapshot/);
  // The markup lists every secret with plain instructions and a link to the guide.
  for (const s of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY']) assert.match(HTML, new RegExp(`<li><code>${s}</code>`));
  assert.match(HTML, /id="ai-setup"[\s\S]*?href="docs\/AI_ASSISTANT\.md"/);
});

test('consent is per provider: nothing is sent to a provider until its box is ticked', async () => {
  const page = await loaded({ storage: consent('anthropic') });
  const calls = site(page, { answers: [claudeTurn([{ type: 'text', text: 'Hi from Claude' }])] });
  page.run("aiSetProvider('groq')"); // before status: not known yet, ignored
  await page.run('aiPrepare()');
  page.run("aiSetProvider('groq')");
  await page.run("aiSend('hello')");
  assert.equal(chats(calls).length, 0, 'Groq was not allowed, so nothing went out');
  assert.equal(page.els['ai-settings'].hidden, false);
  assert.match(page.els['ai-settings-status'].textContent, /Tick the box above to allow sending data to Groq/);
  page.run("aiSetProvider('anthropic')");
  await page.run("aiSend('hello')");
  assert.equal(chats(calls).length, 1);
  assert.match(page.els['ai-log'].innerHTML, /Hi from Claude/);
  // Unticking stops it again.
  page.run('aiSetConsent(false)');
  assert.deepEqual(JSON.parse(page.storage.spyderKpiAiConsentV2 || '{}'), {});
  await page.run("aiSend('again')");
  assert.equal(chats(calls).length, 1);
});

// --- Tool loop ---------------------------------------------------------------------------------------------
test('Claude dialect: tool_use round, tool_result back, thinking kept, answer rendered', async () => {
  const page = await loaded({ storage: consent('anthropic') });
  const first = [{ type: 'thinking', thinking: '', signature: 'sig-1' }, { type: 'tool_use', id: 'toolu_1', name: 'get_overview', input: {} }, { type: 'tool_use', id: 'toolu_2', name: 'search_lines', input: { scope: 'nope' } }];
  const calls = site(page, { answers: [claudeTurn(first), claudeTurn([{ type: 'text', text: 'At risk: **$2,200** across 3 lines as of 2026-09-03.\n- Past due: 1' }])] });
  await page.run("aiSend('What is at risk?')");
  const [c1, c2] = chats(calls);
  assert.equal(chats(calls).length, 2);
  assert.equal(c1.init.method, 'POST');
  assert.equal(c1.init.headers['content-type'], 'application/json');
  assert.deepEqual([c1.body.provider, c1.body.model, c1.body.final], ['anthropic', 'claude-opus-5-5', false]);
  assert.match(c1.body.system, /Spyder Controls[\s\S]*2026-09-03[\s\S]*\$1,721,806/);
  assert.deepEqual(c1.body.tools.map((t) => t.name), ['get_overview', 'search_lines', 'group_totals', 'get_monthly', 'get_build_risk', 'get_supply_demand']);
  assert.deepEqual(c1.body.messages, [{ role: 'user', content: 'What is at risk?' }]);
  assert.deepEqual(c2.body.messages[1], { role: 'assistant', content: first }, 'the assistant turn goes back unchanged');
  const results = c2.body.messages[2];
  assert.equal(results.role, 'user');
  assert.deepEqual(results.content.map((b) => [b.type, b.tool_use_id, !!b.is_error]), [['tool_result', 'toolu_1', false], ['tool_result', 'toolu_2', true]], 'one user turn with every result; a failed tool is marked');
  assert.equal(JSON.parse(results.content[0].content).order_health.at_risk.lines, 3);
  assert.equal(c2.body.system, c1.body.system, 'the system prompt stays the same through the conversation');
  const log = page.els['ai-log'].innerHTML;
  assert.match(log, /<strong>\$2,200<\/strong>/);
  assert.match(log, /<li>Past due: 1<\/li>/);
  assert.match(log, /Claude Opus 5\.5 · Looked up: get_overview, search_lines/);
  assert.match(page.els['ai-announce'].textContent, /^At risk: \$2,200 across 3 lines/, 'announced once, without markdown');
  assert.equal(page.run('aiState.history.length'), 4);
  assert.deepEqual(page.errors, []);
  // A follow-up carries the earlier exchange.
  const more = site(page, { answers: [claudeTurn([{ type: 'text', text: 'Follow-up answer' }])] });
  await page.run("aiSend('And next week?')");
  assert.equal(chats(more)[0].body.messages.length, 5);
});

test('OpenAI dialect (Groq): tool_calls answered with role "tool" messages; bad arguments and long results handled', async () => {
  const page = loadPage({ storage: { ...consent('groq'), spyderKpiAiChoiceV2: JSON.stringify({ provider: 'groq', model: 'llama-3.3-70b-versatile' }) } });
  // 120 open lines, so a full search result is far over the free tier's 8,000-character cap.
  const many = Array.from({ length: 120 }, (_, i) => sapRow({ DocumentNumber: String(8000 + i), LineDueDate: '08/01/2026', DueDate: '08/01/2026', ItemDescription: `Wire harness assembly ${i}` }));
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(many) }]);
  const calls = site(page, { answers: [
    openAiTurn({ calls: [{ id: 'call_1', name: 'search_lines', args: { scope: 'all', limit: 100 } }, { id: 'call_2', name: 'get_overview', invalid: true }] }),
    openAiTurn({ text: 'Six open lines.' }),
  ] });
  await page.run("aiSend('List everything')");
  const [c1, c2] = chats(calls);
  assert.deepEqual([c1.body.provider, c1.body.model], ['groq', 'llama-3.3-70b-versatile']);
  assert.equal(c2.body.messages[1].tool_calls.length, 2);
  const [t1, t2] = c2.body.messages.slice(2);
  assert.deepEqual([t1.role, t1.tool_call_id, t2.role, t2.tool_call_id], ['tool', 'call_1', 'tool', 'call_2']);
  assert.ok(t1.content.length <= 8000, `free tier results are cut to fit (${t1.content.length})`);
  const r1 = JSON.parse(t1.content);
  assert.equal(r1.truncated, true);
  assert.equal(r1.total_matches, 120, 'the total still counts every match');
  assert.ok(r1.rows.length > 5 && r1.rows.length < 100);
  assert.equal(r1.returned, r1.rows.length);
  assert.match(JSON.parse(t2.content).error, /not valid JSON/);
  assert.match(page.els['ai-log'].innerHTML, /Six open lines\./);
  // Paid providers keep the 30,000-character results the tools already produce.
  assert.equal(page.run("JSON.stringify(aiFitResult(aiRunTool('search_lines',{scope:'all',limit:100}),30000)).length<=30000"), true);
  assert.match(page.els['ai-log'].innerHTML, /openai\/gpt-oss-120b · Looked up: search_lines, get_overview/);
});

test('the step cap: the last round asks for an answer without tools; too many lookups is explained', async () => {
  const page = await loaded({ storage: consent('anthropic') });
  const lookup = (i) => claudeTurn([{ type: 'tool_use', id: `toolu_${i}`, name: 'get_monthly', input: {} }]);
  const calls = site(page, { answers: Array.from({ length: 8 }, (_, i) => lookup(i)) });
  await page.run("aiSend('Loop forever')");
  const sent = chats(calls);
  assert.equal(sent.length, 8);
  assert.deepEqual(sent.map((c) => c.body.final), [false, false, false, false, false, false, false, true]);
  assert.match(page.els['ai-log'].innerHTML, /needed too many lookups/);
  assert.equal(page.run('aiState.history.length'), 0, 'a failed question leaves no half turns behind');
});

test('a long question stays under the site\'s 1 MB limit: results are cut further and the model answers with what it has', async () => {
  const page = await loaded({ storage: consent('anthropic') });
  // Big lookups with non-ASCII text (2 to 3 bytes a character), and turns with long thinking, as a real long question.
  page.run("aiRunTool=(name,input)=>({total_matches:3000,returned:3000,rows:Array.from({length:3000},(_,i)=>({doc:'SO '+i,customer:'Client Québec – 供应商延迟供应商延迟',value:i}))})");
  let n = 0;
  const lookups = () => claudeTurn([{ type: 'thinking', thinking: 't'.repeat(100000), signature: 'sig' }, ...[0, 1, 2].map((k) => ({ type: 'tool_use', id: `toolu_${n}_${k}`, name: 'search_lines', input: {} }))]);
  const answer = (url, init) => {
    const body = JSON.parse(init.body);
    n++;
    const turn = body.final ? claudeTurn([{ type: 'text', text: 'Answer from the lookups so far.' }]) : lookups();
    return { ok: true, status: 200, json: async () => turn };
  };
  const calls = site(page, { answers: [() => ({ ok: true, status: 200, json: async () => claudeTurn([{ type: 'text', text: 'Warm' }]) }), ...Array.from({ length: 8 }, () => answer)] });
  await page.run("aiSend('warm up')");
  // An earlier exchange that nearly fills the history budget (300,000 bytes) before the question starts.
  page.run("aiState.history[1]={role:'assistant',content:[{type:'text',text:'w'.repeat(250000)}]}");
  const earlier = page.run('JSON.stringify(aiState.history.slice(0,2))');
  await page.run("aiSend('Everything about every customer, week by week')");
  const sent = chats(calls).slice(1);
  const bytes = sent.map((c) => Buffer.byteLength(c.init.body));
  assert.ok(bytes.every((b) => b <= 800 * 1024), `every request under the budget: ${bytes.join(', ')}`);
  const finals = sent.map((c) => c.body.final);
  assert.ok(finals.length < 8 && finals.at(-1) === true && finals.slice(0, -1).every((f) => f === false), `the cut request is the last round: ${finals}`);
  assert.match(page.els['ai-log'].innerHTML, /Answer from the lookups so far\./);
  assert.doesNotMatch(page.els['ai-log'].innerHTML, /too many lookups|too large/);
  // Results are sized in bytes as sent; the cut ones are a quarter of that or less and say they were cut.
  const results = (c) => c.body.messages.filter((m) => m.role === 'user' && Array.isArray(m.content)).flatMap((m) => m.content.map((b) => b.content));
  assert.ok(results(sent[1]).every((t) => Buffer.byteLength(t) <= 30000), 'a full result is at most 30,000 bytes');
  const last = results(sent.at(-1));
  assert.ok(last.some((t) => Buffer.byteLength(t) <= 7500 && JSON.parse(t).truncated === true), 'the newest results were cut further');
  // The earlier exchange is sent as it was, and the question with its answer stays in the chat.
  assert.equal(JSON.stringify(sent.at(-1).body.messages.slice(0, 2)), earlier);
  assert.equal(page.run('aiState.history.at(-1).content[0].text'), 'Answer from the lookups so far.');
});

test('errors: refusal, cut-off answer, proxy messages, expired sign-in, unreachable site', async () => {
  const page = await loaded({ storage: consent('anthropic') });
  site(page, { answers: [
    claudeTurn([], 'refusal'),
    claudeTurn([{ type: 'text', text: 'Half an ans' }], 'max_tokens'),
    { status: 429, body: { error: { code: 'rate_limited', message: 'Claude is getting too many requests right now. Wait a minute and try again.' } } },
    { status: 401, body: { error: { code: 401, message: 'x' } } },
    () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }),
    () => { throw new TypeError('Failed to fetch'); },
  ] });
  const say = async (q) => { await page.run(`aiSend(${JSON.stringify(q)})`); return page.run('aiState.messages[aiState.messages.length-1].text'); };
  assert.match(await say('a'), /Claude declined to answer this one/);
  assert.match(await say('b'), /Half an ans\n\n_\(The answer was cut off\.\)_/);
  assert.match(await say('c'), /too many requests/);
  assert.match(await say('d'), /sign-in to this site has expired/);
  assert.match(await say('e'), /sign-in to this site has expired/, 'a sign-in page instead of JSON');
  assert.match(await say('f'), /Could not reach this site's AI service/);
  assert.equal(page.run('aiState.history.length'), 2, 'only the answered question stays in the history');

  // The status check itself: a gate 401 is explained, and asked again on the next try.
  const expired = await loaded({ storage: consent('anthropic') });
  let signedIn = false;
  const calls = site(expired, { status: () => (signedIn ? { ok: true, status: 200, json: async () => siteStatus() } : { ok: false, status: 401, json: async () => ({ error: { code: 401, message: 'expired' } }) }), answers: [claudeTurn([{ type: 'text', text: 'Back again' }])] });
  expired.run('aiToggle(true)');
  await expired.run('aiPrepare()');
  assert.match(expired.els['ai-settings-status'].textContent, /sign-in to this site has expired/);
  assert.equal(expired.els['ai-mode'].textContent, 'Needs attention');
  await expired.run("aiSend('hello')");
  assert.match(expired.els['ai-log'].innerHTML, /sign-in to this site has expired/);
  signedIn = true;
  await expired.run("aiSend('hello')");
  assert.match(expired.els['ai-log'].innerHTML, /Back again/);
  assert.equal(calls.filter((c) => c.url === '/api/ai/status').length, 3);
  assert.deepEqual(expired.errors, []);
});

test('Stop aborts the request and Clear chat empties it', async () => {
  const page = await loaded({ storage: consent('anthropic') });
  const hang = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  site(page, { answers: [hang] });
  const pending = page.run("aiSend('slow question')");
  await tick(20);
  assert.equal(page.els['ai-stop'].hidden, false);
  assert.equal(page.els['ai-send'].disabled, true);
  page.run('aiStop()');
  await pending;
  assert.match(page.els['ai-log'].innerHTML, /Stopped\./);
  assert.equal(page.run('aiState.history.length'), 0);
  page.run('aiClear()');
  assert.equal(page.run('aiState.messages.length'), 0);
  // Clear chat while a question is pending: the request stops and nothing comes back into the cleared chat.
  site(page, { answers: [hang] });
  const again = page.run("aiSend('another slow one')");
  await tick(20);
  page.run('aiClear()');
  await again;
  assert.deepEqual([page.run('aiState.messages.length'), page.run('aiState.history.length'), page.run('aiState.busy')], [0, 0, false]);
});

test('a different provider or model starts a new conversation; long histories are trimmed without old thinking', async () => {
  const page = await loaded({ storage: consent('anthropic', 'groq') });
  site(page, { answers: [claudeTurn([{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'One' }])] });
  await page.run("aiSend('first')");
  assert.equal(page.run('aiState.history.length'), 2);
  page.run("aiSetModel('claude-sonnet-5-5')");
  assert.equal(page.run('aiState.history.length'), 0);
  assert.match(page.els['ai-log'].innerHTML, /<div class="ai-msg note">Now asking Claude Sonnet 5\.5 \(faster, about half the cost\)\. Earlier questions are not sent to it\.<\/div>/);
  page.run("aiSetModel('claude-haiku-5-5')");
  page.run("aiSetModel('claude-sonnet-5-5')");
  assert.equal(page.run("aiState.messages.filter(m=>m.role==='note').length"), 1, 'stepping through models leaves one note');
  const calls = site(page, { answers: [claudeTurn([{ type: 'text', text: 'Two' }])] });
  await page.run("aiSend('second')");
  assert.deepEqual(chats(calls)[0].body.messages, [{ role: 'user', content: 'second' }]);
  assert.equal(chats(calls)[0].body.model, 'claude-sonnet-5-5');

  // Over the budget: the oldest exchange goes, and the thinking blocks left in older turns are dropped with it.
  page.run(`aiState.history.length=0;aiState.history.push(
    {role:'user',content:'old'},{role:'assistant',content:[{type:'thinking',thinking:'',signature:'s1'},{type:'text',text:'x'.repeat(310000)}]},
    {role:'user',content:'newer'},{role:'assistant',content:[{type:'thinking',thinking:'',signature:'s2'},{type:'text',text:'y'}]})`);
  page.run("aiTrimHistory({tier:'paid',dialect:'anthropic'})");
  assert.deepEqual(page.run('aiState.history'), [{ role: 'user', content: 'newer' }, { role: 'assistant', content: [{ type: 'text', text: 'y' }] }]);
  // Free tiers keep a much smaller history.
  page.run(`aiState.history.length=0;aiState.history.push({role:'user',content:'a'},{role:'assistant',content:'z'.repeat(30000)},{role:'user',content:'b'},{role:'assistant',content:'ok'})`);
  page.run("aiTrimHistory({tier:'free',dialect:'openai'})");
  assert.equal(page.run('aiState.history.length'), 2);
});

test('a newly loaded export starts a new chat', async () => {
  const page = await loaded({ storage: consent('anthropic') });
  const text = (t) => claudeTurn([{ type: 'text', text: t }]);
  const calls = site(page, { answers: [text('First answer'), text('Second answer'), text('Third answer')] });
  await page.run("aiSend('first')");
  await page.run("aiSend('second')");
  assert.equal(chats(calls)[1].body.messages.length, 3, 'same data: the follow-up carries the earlier turn');
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(ROWS) }]);
  await page.run("aiSend('third')");
  assert.deepEqual(chats(calls)[2].body.messages, [{ role: 'user', content: 'third' }]);
  assert.deepEqual(page.run('aiState.messages.map(m=>m.text)'), ['third', 'Third answer']);
});

test('no data loaded: Ask AI says so and sends nothing', async () => {
  const empty = loadPage({ storage: consent('anthropic') });
  await tick(); // the stub DOM's empty embedded snapshot finishes "loading" (a load clears the chat)
  empty.run('isSnapshotView=false'); // a real page only has embedded snapshot data when it is a snapshot file
  const calls = site(empty);
  await empty.run("aiSend('hello')");
  assert.equal(chats(calls).length, 0);
  assert.match(empty.els['ai-log'].innerHTML, /Load a KPI export first/);
});

// --- Rendering, snapshots, storage --------------------------------------------------------------------------
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

test('provider names, notices and model labels from the site are escaped', async () => {
  const page = await loaded({ storage: consent('anthropic') });
  const status = siteStatus(['anthropic']);
  status.providers[0].name = 'Claude <img src=x onerror=alert(1)>';
  status.providers[0].modelLabels = { 'claude-opus-5-5': '<b>Opus</b>' };
  status.providers[0].termsUrl = 'javascript:alert(1)';
  site(page, { status });
  page.run('aiToggle(true)');
  await page.run('aiPrepare()');
  assert.doesNotMatch(page.els['ai-provider'].innerHTML + page.els['ai-model'].innerHTML, /<img|<b>/);
  assert.equal(page.els['ai-terms'].hidden, true, 'only https links are used');
});

test('a shared snapshot copy drops the chat, provider lists, notices and typed values', () => {
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
  for (const id of ['ai-log', 'ai-announce', 'ai-provider', 'ai-model', 'ai-mode', 'ai-settings-status', 'ai-notice-text', 'ai-foot']) assert.ok(seen[0].split(',').includes(`#${id}`), `#${id} is emptied in the copy`);
  assert.deepEqual([input.attrs, input.textContent], [{}, '']);
  assert.match(HTML, /aiResetClone\(root\);/);
});

test('the old Gemini key and consent are removed from the browser; no Gemini code or text is left', () => {
  const storage = { spyderKpiGeminiKeyV1: 'old-key', spyderKpiAiConsentV1: '1', spyderKpiAiModelV1: 'gemini-2.5-flash', other: 'kept' };
  loadPage({ storage });
  assert.deepEqual(storage, { other: 'kept' });
  const app = HTML.slice(HTML.indexOf('<script id="kpi-app">'));
  assert.doesNotMatch(app.replace(/spyderKpiGeminiKeyV1|personal Gemini key/g, ''), /gemini|generativelanguage/i);
  assert.doesNotMatch(HTML.slice(0, HTML.indexOf('<script id="kpi-app">')).replace(/<script id="sheetjs-lib">[\s\S]*?<\/script>/, ''), /gemini/i);
});

test('every Ask AI control carries a plain-English tooltip', () => {
  const panel = HTML.slice(HTML.indexOf('<aside id="ai-panel"'), HTML.indexOf('</aside>', HTML.indexOf('<aside id="ai-panel"')));
  const controls = panel.match(/<(button|select|textarea|a|input)\b[^>]*>/g);
  assert.ok(controls.length >= 14);
  for (const c of controls) {
    if (/type="checkbox"/.test(c)) continue; // its label carries the tip
    assert.match(c, /data-tip="[A-Z][^"]{15,}"/, c);
  }
  assert.match(panel, /<label class="ai-check" data-tip="Nothing is sent/);
});

test('the Ask AI button in the page header names the four providers and says nothing is sent until one is allowed', async () => {
  const page = await loaded();
  const head = page.els['results-screen'].innerHTML.match(/<button [^>]*data-focus-key="ask-ai"[^>]*>/)[0];
  assert.match(head, /data-tip="Ask Claude, ChatGPT, Groq or OpenRouter about the loaded export\. Nothing is sent until you allow a provider in Settings\."/);
  assert.match(head, /aria-controls="ai-panel"/);
});

test('Connect an AI describes the four providers and opens the panel', () => {
  const page = loadPage();
  page.run("setTab('connect')");
  const html = page.els['results-screen'].innerHTML;
  assert.match(html, /Option 1: Ask AI in this dashboard<\/h2><span class="section-sub">Claude, ChatGPT, Groq or OpenRouter/);
  assert.match(html, /<strong>Paid:<\/strong> Claude \(Anthropic\) and ChatGPT \(OpenAI\)/);
  assert.match(html, /<strong>Free:<\/strong> Groq and OpenRouter/);
  assert.match(html, /data-focus-key="connect-ask-ai"[^>]*data-tip="Opens the Ask AI panel/);
  assert.doesNotMatch(html, /Gemini|Google AI Studio/);
});

run();
