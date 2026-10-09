// "Big picture" Sankey charts (Order Health, Build Risk, Supply Mix). Run with `node tests/sankey.test.js`.
// Fixtures are synthetic (no SAP data). Covers the pure layout (sankeyLayout), that each page's flows add up to the
// numbers on its cards, that clicking a box applies the page's own filter, the markup (focusable boxes with full
// values, escaping), share-snapshot state, and the open animation's reduced-motion / print guards.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const EPS = 1e-6;
const due = (d) => ({ DueDate: d, HeaderDueDate: d, LineDueDate: d });
const html = (page) => page.els['results-screen'].innerHTML;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

// --- Layout ---------------------------------------------------------------------------------------------------
function checkLayout(L, { pad = 12, minH = 4 } = {}) {
  const byId = new Map(L.nodes.map((n) => [n.id, n]));
  for (const n of L.nodes) {
    assert.ok(n.y1 - n.y0 >= minH - EPS, `${n.id} is at least ${minH}px tall`);
    const out = L.links.filter((l) => l.source === n.id), inn = L.links.filter((l) => l.target === n.id);
    // Link ends are stacked inside the box and add up to its height (in == out for every flow drawn here).
    if (out.length) {
      assert.ok(Math.abs(sum(out.map((l) => l.sy1 - l.sy0)) - (n.y1 - n.y0)) < EPS, `${n.id}: outgoing widths = height`);
      out.forEach((l) => assert.ok(l.sy0 >= n.y0 - EPS && l.sy1 <= n.y1 + EPS));
    }
    if (inn.length) {
      assert.ok(Math.abs(sum(inn.map((l) => l.ty1 - l.ty0)) - (n.y1 - n.y0)) < EPS, `${n.id}: incoming widths = height`);
      inn.forEach((l) => assert.ok(l.ty0 >= n.y0 - EPS && l.ty1 <= n.y1 + EPS));
    }
  }
  L.columns.forEach((col, ci) => {
    const nodes = col.map((id) => byId.get(id));
    nodes.forEach((n) => assert.equal(n.column, ci));
    for (let i = 1; i < nodes.length; i++) assert.ok(nodes[i - 1].y1 + pad <= nodes[i].y0 + EPS, `column ${ci}: ${nodes[i - 1].id} and ${nodes[i].id} do not overlap`);
    nodes.forEach((n) => assert.ok(n.y0 >= -EPS && n.y1 <= L.height + EPS, `${n.id} inside the chart`));
  });
  for (let ci = 1; ci < L.columns.length; ci++) {
    if (L.columns[ci].length && L.columns[ci - 1].length) assert.ok(byId.get(L.columns[ci][0]).x0 > byId.get(L.columns[ci - 1][0]).x0, 'columns run left to right');
  }
  L.links.forEach((l) => assert.match(l.path, /^M[\d.,-]+C[\d., -]+L[\d.,-]+C[\d., -]+Z$/, 'a band bounded by two cubic béziers'));
}

test('sankeyLayout: link ends add up to each box, boxes never overlap, columns sorted by value with "Other" last', () => {
  const page = loadPage();
  assert.equal(typeof page.ctx.sankeyLayout, 'function', 'a page global the tests and the MCP vm can call');
  const nodes = [
    { id: 'a', level: 0 }, { id: 'b', level: 0 }, { id: 'tiny', level: 0 }, { id: 'other', level: 0, last: true },
    { id: 'x', level: 1 }, { id: 'y', level: 1 }, { id: 'z', level: 1 },
    { id: 'm9', level: 2, order: 202609 }, { id: 'm10', level: 2, order: 202610 }, { id: 'm11', level: 2, order: 202611 },
  ];
  const links = [
    { source: 'a', target: 'x', value: 30 }, { source: 'a', target: 'y', value: 10 }, { source: 'b', target: 'x', value: 5 },
    { source: 'b', target: 'y', value: 20 }, { source: 'tiny', target: 'z', value: 0.01 }, { source: 'other', target: 'y', value: 90 },
    { source: 'x', target: 'm11', value: 35 }, { source: 'y', target: 'm9', value: 100 }, { source: 'y', target: 'm10', value: 20 }, { source: 'z', target: 'm10', value: 0.01 },
  ];
  const L = page.run(`sankeyLayout(${JSON.stringify(nodes)},${JSON.stringify(links)},{width:900,height:300,marginLeft:150,marginRight:150,format:v=>'$'+Math.round(v)})`);
  checkLayout(L);
  // Value order (largest first), "Other" at the bottom; months keep their explicit order whatever their value.
  assert.deepEqual(L.columns, [['a', 'b', 'tiny', 'other'], ['y', 'x', 'z'], ['m9', 'm10', 'm11']]);
  const n = Object.fromEntries(L.nodes.map((x) => [x.id, x]));
  assert.equal(n.tiny.y1 - n.tiny.y0, 4, 'tiny boxes get the 4px minimum');
  assert.equal(n.a.x1 - n.a.x0, 8, '8px boxes');
  assert.equal(n.y.value, 120);
  // Heights follow value: y carries 120, x 35 (one scale for the whole chart).
  assert.ok(Math.abs((n.y.y1 - n.y.y0) / (n.x.y1 - n.x.y0) - 120 / 35) < 1e-6);
  // Labels: first column on the left of its box, the others on the right; value labels use the formatter.
  assert.deepEqual([n.a.anchor, n.a.labelX, n.y.anchor, n.y.labelX], ['end', n.a.x0 - 6, 'start', n.y.x1 + 6]);
  assert.equal(n.y.valueLabel, '$120');
  // The fullest column fills the height.
  assert.ok(Math.abs(L.height - 300) < EPS);
});

test('sankeyLayout: bad links are dropped, missing levels come from the flow, crowded columns grow instead of overlapping', () => {
  const page = loadPage();
  const L = page.run(`sankeyLayout([{id:'s'},{id:'t'},{id:'u'},{id:'lonely'}],[
    {source:'s',target:'t',value:4},{source:'t',target:'u',value:4},{source:'s',target:'u',value:1},
    {source:'s',target:'nope',value:3},{source:'t',target:'t',value:2},{source:'u',target:'s',value:2},{source:'s',target:'t',value:0},{source:'s',target:'u',value:-5},{source:'s',target:'u',value:'x'}
  ],{width:600,height:200})`);
  assert.deepEqual(L.columns, [['s'], ['t'], ['u']], 'levels from the longest path; a box with no links is left out');
  assert.equal(L.links.length, 3, 'unknown ends, self links, a backwards link and zero / negative / non-numbers are dropped');
  checkLayout(L);
  assert.deepEqual(page.run('sankeyLayout([],[])'), { width: 960, height: 300, ky: 0, nodeWidth: 8, nodePadding: 12, columns: [], nodes: [], links: [] });
  // 40 tiny boxes in 120px: the chart grows taller rather than stacking boxes on top of each other.
  const many = page.run(`(()=>{const n=[{id:'src',level:0}],l=[];for(let i=0;i<40;i++){n.push({id:'t'+i,level:1});l.push({source:'src',target:'t'+i,value:i+1});}return sankeyLayout(n,l,{height:120});})()`);
  assert.ok(many.height > 120);
  checkLayout(many);
});

// --- Order Health -----------------------------------------------------------------------------------------------
const ATRISK = [
  sapRow({ DocumentNumber: '1', 'Internal Number': '1', Warehouse: 'CM - DSM', AmountLocal: '1,000.00', ...due('08/20/2026') }), // past due
  sapRow({ DocumentNumber: '2', 'Internal Number': '2', Warehouse: 'CM - DSM', AmountLocal: '2,500.00', LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111', RescheduleFlag: 'No Commit Date', ...due('10/20/2026') }),
  sapRow({ DocumentNumber: '3', 'Internal Number': '3', Warehouse: 'Spyder - Lacombe', CustomerVendorCode: 'MAR1', CustomerVendorName: 'Marine <b>Co</b>', 'Group Code': '104', AmountLocal: '4,000.00', LineRescheduleDate: '09/20/2026', RescheduleDate: '09/20/2026', RescheduleFlag: 'Rescheduled Later Than Original Delivery', ...due('08/25/2026') }),
  sapRow({ DocumentNumber: '4', 'Internal Number': '4', Warehouse: 'Spyder - Lacombe', CustomerVendorCode: 'APP1', CustomerVendorName: 'Appliance Inc', 'Group Code': '111', AmountLocal: '1,721,806.00', ...due('10/25/2026') }), // marked urgent below
];
// Eleven more warehouses with one healthy line each: the chart keeps the 8 largest and groups the rest.
const SPREAD = Array.from({ length: 11 }, (_, i) => sapRow({ DocumentNumber: String(100 + i), 'Internal Number': String(100 + i), Warehouse: `WH ${String(i + 1).padStart(2, '0')}`, AmountLocal: `${(i + 1) * 100}.00`, ...due('10/20/2026') }));

async function orderHealth(rows = [...ATRISK, ...SPREAD]) {
  const page = loadPage();
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false;rowOverrides=loadRowOverrides()');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  page.run(`updateRowOverride(rowKey(allLoadedRows.find(r=>r.documentNumber==='4')),'status','Urgent')`);
  page.run("setTab('weekly')");
  return page;
}
const flows = (page, tab) => page.run(`sankeyFlows(${JSON.stringify(tab)})`);
const colSums = (f) => [0, 1, 2].map((lv) => sum(f.nodes.filter((n) => n.level === lv).map((n) => n.value)));

test('Order Health flows add up to the cards: open value, at-risk statuses and the At Risk total', async () => {
  const page = await orderHealth();
  const oh = page.run('(()=>{const d=orderHealthData(currentMetrics());return {all:d.allOrdersAmt,late:d.lateAmt,lines:d.lateTileRows.length}})()');
  const [open, risk] = flows(page, 'weekly');
  assert.equal(open.total, oh.all);
  assert.deepEqual(colSums(open), [oh.all, oh.all, oh.all], 'every column adds up to All open orders');
  const status = Object.fromEntries(open.nodes.filter((n) => n.level === 1).map((n) => [n.key, n.value]));
  assert.deepEqual(status, { pastdue: 1000, nocommit: 2500, resched: 4000, urgent: 1721806, ok: sum(SPREAD.map((_, i) => (i + 1) * 100)) });
  assert.equal(status.pastdue + status.nocommit + status.resched + status.urgent, oh.late, 'the at-risk statuses equal the At Risk card');
  assert.equal(risk.total, oh.late);
  assert.deepEqual(colSums(risk), [oh.late, oh.late, oh.late]);
  // 13 warehouses: the 8 largest plus "Other warehouses (5)".
  const wh = open.nodes.filter((n) => n.level === 0);
  assert.equal(wh.length, 9);
  const other = wh.find((n) => n.other);
  assert.equal(other.label, 'Other warehouses (5)');
  assert.deepEqual(other.members, ['WH 01', 'WH 02', 'WH 03', 'WH 04', 'WH 05']);
  // Middle boxes pass on exactly what they receive.
  for (const f of [open, risk]) {
    for (const n of f.nodes.filter((x) => x.level === 1)) {
      assert.equal(sum(f.links.filter((l) => l.target === n.id).map((l) => l.value)), sum(f.links.filter((l) => l.source === n.id).map((l) => l.value)));
    }
  }
  // The same flows lay out cleanly.
  for (const f of [open, risk]) checkLayout(page.run(`(()=>{const f=sankeyFlows('weekly').find(f=>f.id===${JSON.stringify(f.id)});return sankeyLayout(f.nodes,f.links,{width:960,height:300,marginLeft:210,marginRight:210});})()`));
});

test('clicking a box applies the Order Health filter (again = show all); status boxes pick the card; others pin a highlight', async () => {
  const page = await orderHealth();
  page.run("toggleSankey('weekly')");
  const click = (flow, node) => page.run(`sankeyNodeClick('weekly',${JSON.stringify(flow)},${JSON.stringify(node)})`);
  click('open', '0:CM - DSM');
  assert.deepEqual(page.run('weeklyWarehouseFilter'), ['CM - DSM']);
  assert.match(html(page), /<g class="sk-node sk-plain sk-sel" role="button" tabindex="0" aria-pressed="true" aria-label="CM - DSM: \$3,500 open sales-order value, 2 orders, 2 lines \(100% of \$3,500\)\. Click to show every warehouse again\./);
  click('open', '0:CM - DSM');
  assert.deepEqual(page.run('weeklyWarehouseFilter'), ['ALL']);
  click('open', '0#other');
  assert.deepEqual(page.run('weeklyWarehouseFilter'), ['WH 01', 'WH 02', 'WH 03', 'WH 04', 'WH 05']);
  assert.match(html(page), /5 warehouses ×/, 'the filter bar shows the picked warehouses');
  page.run("setWeeklyWarehousePreset('ALL')");
  click('open', '2:Marine');
  assert.deepEqual(page.run('weeklySegmentFilter'), ['Marine']);
  page.run('resetWeeklyFilters()');
  // "Past due" feeds the whole At Risk card: it picks that card and never unpicks it, and does not show pressed.
  assert.equal(page.run('weeklyTileFilter'), 'late');
  click('open', '1:pastdue');
  assert.equal(page.run('weeklyTileFilter'), 'late');
  assert.match(html(page), /<g class="sk-node sk-crit" role="button" tabindex="0" aria-pressed="false" aria-label="Past due, no reschedule: \$1,000 open sales-order value, 1 order, 1 line \([\d.]+% of \$[\d,]+\)\. Click to list these lines under Linked lines\."/);
  click('open', '1:nocommit');
  assert.equal(page.run('weeklyTileFilter'), 'nocommit');
  assert.match(html(page), /<g class="sk-node sk-crit sk-sel" role="button" tabindex="0" aria-pressed="true" aria-label="No commit date: /);
  assert.match(html(page), /Linked lines — No Commit Date/);
  click('open', '1:nocommit');
  assert.equal(page.run('weeklyTileFilter'), 'nocommit', 'a second click keeps the list open');
  // With Needs attention hidden, picking a card from the chart shows the section again so its lines are listed.
  page.run('toggleLeadingIndicators()');
  assert.equal(page.run('weeklyLeadingCollapsed'), true);
  click('open', '1:resched');
  assert.deepEqual(page.run('[weeklyLeadingCollapsed,weeklyTileFilter]'), [false, 'active']);
  assert.match(html(page), /Linked lines — Rescheduled/);
  click('risk', '2:MAR1');
  assert.deepEqual(page.run('weeklyCustomerFilter'), ['MAR1']);
  page.run('resetWeeklyFilters()');
  // "Not at risk" has no filter of its own: it stays highlighted until clicked again.
  click('open', '1:ok');
  assert.equal(page.run('sankeyPinned.weekly'), 'open|1:ok');
  assert.match(html(page), /<svg class="sk-svg sk-hl"[^>]* data-pinned="1:ok">/);
  assert.match(html(page), /class="sk-node sk-calm sk-sel sk-on" role="button" tabindex="0" aria-pressed="true"/);
  click('open', '1:ok');
  assert.equal(page.run('sankeyPinned.weekly'), '');
  // A pinned box that a filter takes out of the chart leaves nothing dimmed.
  click('open', '1:ok');
  page.run("setWeeklyWarehouseFilter(['CM - DSM'])");
  assert.doesNotMatch(html(page), /data-pinned|sk-svg sk-hl/);
  page.run("setWeeklyWarehouseFilter(['ALL'])");
  assert.match(html(page), /data-pinned="1:ok"/, 'and it comes back with the box');
  click('open', '1:ok');
  // Keyboard: Enter and Space activate, other keys do nothing.
  let prevented = 0;
  page.ctx.__ev = (key) => ({ key, preventDefault() { prevented++; } });
  page.ctx.__el = { dataset: { skTab: 'weekly', skFlow: 'open', skNode: '2:RV' } };
  page.run("sankeyNodeKey(__ev('a'),__el)");
  assert.deepEqual(page.run('weeklySegmentFilter'), ['ALL']);
  page.run("sankeyNodeKey(__ev('Enter'),__el)");
  assert.deepEqual(page.run('weeklySegmentFilter'), ['RV']);
  page.run("sankeyNodeKey(__ev(' '),__el)");
  assert.deepEqual(page.run('weeklySegmentFilter'), ['ALL']);
  assert.equal(prevented, 2);
  // A box that is no longer drawn (stale click) changes nothing.
  click('open', '0:Nowhere');
  assert.deepEqual(page.run('[weeklyWarehouseFilter,sankeyPinned.weekly]'), [['ALL'], '']);
  assert.deepEqual(page.errors, []);
});

test('credit lines (negative open value) are left out of the bands and the sub-title says how much', async () => {
  const page = await orderHealth([...ATRISK, sapRow({ DocumentNumber: '77', 'Internal Number': '77', Warehouse: 'CM - DSM', AmountLocal: '-300.00', ...due('08/10/2026') })]);
  const oh = page.run('(()=>{const d=orderHealthData(currentMetrics());return {all:d.allOrdersAmt,late:d.lateAmt}})()');
  const [open, risk] = flows(page, 'weekly');
  assert.equal(open.total, oh.all + 300);
  assert.equal(risk.total, oh.late + 300);
  assert.match(open.sub, / · \$300 of credit lines not drawn$/);
  assert.match(risk.sub, / · \$300 of credit lines not drawn$/);
  assert.doesNotMatch(flows(await orderHealth(ATRISK), 'weekly')[0].sub, /not drawn/);
});

test('markup: the toggle and every box carry plain-English tips with full numbers; SAP text is escaped; tags balance', async () => {
  const page = await orderHealth();
  const closed = html(page);
  assert.match(closed, /<button type="button" class="btn sk-toggle" data-focus-key="sankey-toggle-weekly" aria-expanded="false" data-tip="Show the big picture chart\. [^"]+"[^>]*>[\s\S]*?Big picture<\/button>/);
  assert.doesNotMatch(closed, /<svg class="sk-svg/, 'nothing is drawn while the card is closed');
  page.run("toggleSankey('weekly')");
  const h = html(page);
  assert.match(h, /<section class="card sk-card rise" id="sankey-weekly" aria-labelledby="sankey-weekly-title">/);
  assert.match(h, /data-focus-key="sankey-toggle-weekly" aria-expanded="true" aria-controls="sankey-weekly" data-tip="[^"]+"[^>]*>[\s\S]*?Hide big picture</);
  const boxes = [...h.matchAll(/<g class="sk-node[^"]*" role="button" tabindex="0" aria-pressed="(?:true|false)" aria-label="([^"]+)" data-tip="([^"]+)" data-focus-key="sk-weekly-(?:open|risk)-[0-9a-z]+"/g)];
  assert.equal(boxes.length, (h.match(/class="sk-node /g) || []).length, 'every box is a focusable button with a tip and a focus key');
  assert.ok(boxes.length >= 20);
  boxes.forEach((b) => assert.equal(b[1], b[2]));
  assert.ok(boxes.some((b) => /Appliance Inc \(APP1\): \$1,721,806 at risk, 1 order, 1 line/.test(b[1])), 'full dollar values in tips');
  assert.match(h, /<text x="218" y="14" text-anchor="end" data-tip="Warehouse or contract manufacturer [^"]+">Warehouse \/ CM<\/text>/, 'column headings line up with the boxes and explain themselves');
  // One tooltip per element: boxes and headings use the dashboard's tip bubble (#tip-layer, placed by script, so it
  // works on SVG), so they carry no SVG <title> (the browser would show its own tooltip on top). The chart is named
  // by aria-label rather than a root <title> for the same reason; only the bands (no data-tip) keep a <title>.
  assert.doesNotMatch(h, /<g class="sk-node[^>]*><title>/, 'boxes have no native SVG title tooltip');
  assert.doesNotMatch(h, /<svg class="sk-svg[^>]*><title/, 'the chart has no root SVG title tooltip');
  assert.match(h, /<svg class="sk-svg[^"]*" role="group" aria-label="[^"]+" aria-describedby="sankey-weekly-[^"]+-desc"/);
  assert.match(h, /<path class="sk-link[^>]*><title>[^<]+ → [^<]+<\/title><\/path>/, 'bands keep a native title');
  assert.match(h, /<details class="about sk-about"><summary>About this chart<\/summary>/);
  assert.match(h, /Marine &lt;b&gt;Co&lt;\/b&gt;/);
  assert.doesNotMatch(h, /<b>Co|undefined|NaN/);
  // Self-closing SVG shapes (<path …/>, <rect …/>) need no closing tag.
  const opens = (tag) => (h.match(new RegExp(`<${tag}(?:\\s[^>]*[^/]|)>`, 'g')) || []).length;
  for (const tag of ['div', 'section', 'button', 'span', 'details', 'p', 'svg', 'g', 'text', 'title', 'path', 'tspan']) {
    assert.equal(opens(tag), h.split(`</${tag}>`).length - 1, `balanced <${tag}>`);
  }
  // The chart keeps readable 12px text on phones by scrolling inside the card; print scales it to the page.
  assert.match(HTML, /\.sk-scroll\{overflow-x:auto;overflow-y:hidden;max-width:100%/);
  assert.match(HTML, /@media print\{\n  \.sk-bar,\.sk-toggle,\.sk-detail\{display:none!important\}[\s\S]*?\.sk-svg\{width:100%!important;height:auto!important\}/);
  assert.match(HTML, /\.sk-node:focus-visible \.sk-hit\{stroke:var\(--accent\)\}/);
  assert.match(h, /viewBox="0 0 960 \d+(\.\d)?" width="960"/, 'a fixed 960px chart when the window width is unknown (tests, print)');
});

test('Us / Them and reasons: fallback rules, and the Order Health cause engine is used when it is on the page', async () => {
  const page = await orderHealth(ATRISK);
  page.run(`rowOverrides[rowKey(allLoadedRows.find(r=>r.documentNumber==='1'))]={cause:'them'}`);
  page.run(`updateRowOverride(rowKey(allLoadedRows.find(r=>r.documentNumber==='2')),'status','Waiting on PO')`);
  const risk = () => flows(page, 'weekly')[1];
  const byLevel = (f, lv) => Object.fromEntries(f.nodes.filter((n) => n.level === lv).map((n) => [n.label, n.value]));
  // Past due line marked Them by hand; Waiting on PO is ours; a reschedule says nothing about whose side; Urgent is theirs.
  assert.deepEqual(byLevel(risk(), 1), { Them: 1000 + 1721806, Us: 2500, 'Not set': 4000 });
  assert.deepEqual(byLevel(risk(), 0), { 'Past due, no reschedule': 1000, 'Waiting on PO': 2500, 'Rescheduled later': 4000, 'Marked urgent': 1721806 });
  // Reason boxes from SAP signals open the matching card; a picked override reason only highlights.
  const actions = Object.fromEntries(risk().nodes.filter((n) => n.level === 0).map((n) => [n.label, n.action]));
  assert.deepEqual(actions['Rescheduled later'], { type: 'tile', value: 'active' });
  assert.equal(actions['Waiting on PO'], null);
  // With the cause engine and reason list on the page (Order Health v2), the chart uses them and its filters.
  page.run("var causeCalls=[];function lineCause(r){return r.documentNumber==='3'?'US':'them'}function lineReasons(r){return [{label:'Reason '+r.documentNumber}]}function setWeeklyCauseFilter(v){causeCalls.push(v)}function setWeeklyReasonFilter(v){causeCalls.push('reason:'+v)}");
  assert.deepEqual(byLevel(risk(), 1), { Them: 1000 + 2500 + 1721806, Us: 4000 });
  assert.deepEqual(Object.keys(byLevel(risk(), 0)).sort(), ['Reason 1', 'Reason 2', 'Reason 3', 'Reason 4']);
  page.run("sankeyNodeClick('weekly','risk','1:us');sankeyNodeClick('weekly','risk','0:Reason 3')");
  assert.deepEqual(page.run('causeCalls'), ['us', 'reason:Reason 3']);
});

// --- Build Risk -------------------------------------------------------------------------------------------------
const HEAD = ['CM ', 'Month', 'Total', 'Clear To Build', 'At Risk', 'Late', 'Closed', '% CTB', '% Late Orders', 'Notes'];
const _ = null;
const SEP30 = { name: '0930 - Orders at Risk', merges: ['A2:A3', 'A4:A5'], aoa: [HEAD,
  ['DSM', 'September', 10, 8, 2, _, 0, '80%', '0%'], [_, 'October', 6, 5, 0, 1, 0, '83%', '17%'],
  ['Price <i>x</i>', 'September', 4, 1, 1, 2, 0, '25%', '50%'], [_, 'October', 28, 26, 2, _, 0, '93%', '0%']] };
const SEP24 = { name: '0924 - Orders at Risk', aoa: [HEAD, ['Price <i>x</i>', 'September', 9, 9, 0, 0, 0, '100%', '0%']] };
function workbook(page, sheets) {
  return new Uint8Array(page.run(`(()=>{const wb=XLSX.utils.book_new();for(const s of ${JSON.stringify(sheets)}){const ws=XLSX.utils.aoa_to_sheet(s.aoa);if(s.merges)ws['!merges']=s.merges.map(r=>XLSX.utils.decode_range(r));XLSX.utils.book_append_sheet(wb,ws,s.name);}return Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));})()`));
}
const stat = (h, label) => Number((h.match(new RegExp(`${label}</span><span class="kpi-value[^"]*">([\\d,]+)<`)) || [])[1].replace(/,/g, ''));

test('Build Risk: the flow matches the cards; clicking a CM narrows the page to it and the week picker still works', async () => {
  const page = loadPage();
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  const kpi = sapExport([sapRow({ DocumentNumber: '71001', Warehouse: 'CM - DSM', ...due('09/15/2026') }), sapRow({ DocumentNumber: '71002', Warehouse: 'CM - Price', ...due('10/10/2026') })]);
  await upload(page, [{ name: 'kpi.xls', bytes: kpi }, { name: 'ctb.xlsx', bytes: workbook(page, [SEP30, SEP24]) }]);
  page.run("setTab('buildrisk');toggleSankey('buildrisk')");
  let h = html(page);
  const [f] = flows(page, 'buildrisk');
  const mid = Object.fromEntries(f.nodes.filter((n) => n.level === 1).map((n) => [n.label, n.value]));
  assert.deepEqual(mid, { 'Clear to build': stat(h, 'Clear to build'), 'At risk': stat(h, 'At risk'), Late: stat(h, 'Late') });
  assert.deepEqual(mid, { 'Clear to build': 40, 'At risk': 5, Late: 3 });
  assert.deepEqual(colSums(f), [48, 48, 48]);
  // Months in calendar order whatever their size.
  const L = page.run("(()=>{const f=sankeyFlows('buildrisk')[0];return sankeyLayout(f.nodes,f.links,{height:200});})()");
  assert.deepEqual(L.columns[2], ['2:2026-09', '2:2026-10']);
  checkLayout(L);
  assert.match(h, /aria-label="DSM: 16 orders in the Sep 30 report \(13 clear to build, 2 at risk, 1 late\)\. Click to show only this CM on Build Risk\."/);
  assert.match(h, /Price &lt;i&gt;x&lt;\/i&gt;/);
  assert.doesNotMatch(h, /<i>x/);

  page.run("sankeyNodeClick('buildrisk','ctb','0:DSM')");
  assert.equal(page.run('buildRiskCmFilter'), 'DSM');
  h = html(page);
  assert.equal(stat(h, 'Clear to build'), 13);
  assert.equal(stat(h, 'CTB report rows'), 2);
  assert.match(h, /<div class="sk-filter"><span>Showing CM <strong>DSM<\/strong> only, picked in the Big picture\.<\/span><button type="button" class="link-btn print-hide" data-focus-key="sankey-cm-clear" data-tip="[^"]+" onclick="setBuildRiskCm\(''\)">Show every CM<\/button><\/div>/);
  assert.match(h, /<option value="2026-09-30" selected>Sep 30<\/option>/);
  assert.deepEqual(flows(page, 'buildrisk')[0].nodes.filter((n) => n.level === 0).map((n) => n.label), ['DSM']);
  // A week without that CM shows every CM and says so; the pick comes back on a week that has it.
  page.run('setBuildRiskSnapshot("2026-09-24")');
  h = html(page);
  assert.equal(stat(h, 'Clear to build'), 9);
  assert.match(h, /CM <strong>DSM<\/strong> is not in this report week, so every CM is shown\./);
  page.run('setBuildRiskSnapshot("2026-09-30")');
  assert.equal(stat(html(page), 'Clear to build'), 13);
  // The note stays (and prints) with the chart closed; Show every CM, or the CM box again, undoes it.
  page.run("toggleSankey('buildrisk')");
  assert.match(html(page), /Showing CM <strong>DSM<\/strong> only/);
  page.run("setBuildRiskCm('')");
  assert.equal(page.run('buildRiskCmFilter'), '');
  assert.equal(stat(html(page), 'Clear to build'), 40);
  // Month and status boxes highlight only.
  page.run("toggleSankey('buildrisk');sankeyNodeClick('buildrisk','ctb','2:2026-10')");
  assert.deepEqual(page.run('[buildRiskCmFilter,sankeyPinned.buildrisk]'), ['', 'ctb|2:2026-10']);
  assert.deepEqual(page.errors, []);
});

// --- Supply Mix -------------------------------------------------------------------------------------------------
const SD_HEAD = ['ExportDate', 'ItemCode', 'ItemGroupName', 'WarehouseCode', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'DemandOpenValue', 'UsableSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty', 'UnconfirmedSupplyQty', 'RiskSupplyQty'];
const SD = [
  { ExportDate: '09/03/2026', ItemCode: 'A', ItemGroupName: 'Electronics', WarehouseCode: '01', WarehouseName: 'CM - DSM', YearMonth: '2026-09', DemandOpenQty: '10', DemandOpenValue: '1000', UsableSupplyQty: '4', MonthlyNetQty: '-6', CumulativeNetQty: '-6', RiskSupplyQty: '0' },
  { ExportDate: '09/03/2026', ItemCode: 'B', ItemGroupName: 'Cables', WarehouseCode: '02', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-10', DemandOpenQty: '5', DemandOpenValue: '500', UsableSupplyQty: '5', MonthlyNetQty: '0', CumulativeNetQty: '0', UnconfirmedSupplyQty: '3', RiskSupplyQty: '3' },
  { ExportDate: '09/03/2026', ItemCode: 'C', ItemGroupName: 'Cables', WarehouseCode: '02', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-09', DemandOpenQty: '2', DemandOpenValue: '250', UsableSupplyQty: '9', MonthlyNetQty: '7', CumulativeNetQty: '7', RiskSupplyQty: '0' },
  { ExportDate: '09/03/2026', ItemCode: 'D', ItemGroupName: 'Cables', WarehouseCode: '02', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-11', DemandOpenQty: '0', DemandOpenValue: '0', UsableSupplyQty: '9', MonthlyNetQty: '9', CumulativeNetQty: '16', RiskSupplyQty: '0' },
];
async function supplyPage(rows = SD) {
  const page = loadPage();
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport([sapRow({})]) }, { name: 'sd.xls', bytes: utf16Tsv(SD_HEAD, rows) }]);
  page.run("setTab('supplydemand');toggleSankey('supplydemand')");
  return page;
}

test('Supply Mix: open demand value adds up, bands are coloured by coverage, a warehouse click narrows the chart', async () => {
  const page = await supplyPage();
  let [f] = flows(page, 'supplydemand');
  assert.equal(f.total, page.run('currentMetrics().supplyDemand.demandValue'));
  assert.deepEqual(colSums(f), [1750, 1750, 1750]);
  // Lacombe → Cables is split by colour: $500 covered only by risky supply (amber), $250 covered (blue).
  assert.deepEqual(f.links.filter((l) => l.source === '0:Spyder - Lacombe').map((l) => [l.tone, l.value]), [['warn', 500], ['calm', 250]]);
  assert.deepEqual(f.links.filter((l) => l.source === '0:CM - DSM').map((l) => [l.tone, l.value]), [['crit', 1000]]);
  assert.match(html(page), /The Big picture shows|Open demand value/);
  page.run("sankeyNodeClick('supplydemand','demand','0:CM - DSM')");
  assert.deepEqual(page.run('supplyWarehouseFilter'), ['CM - DSM']);
  [f] = flows(page, 'supplydemand');
  assert.equal(f.total, 1000);
  const h = html(page);
  assert.match(h, /The Big picture shows <strong>CM - DSM<\/strong> only \(the same warehouse filter as Supply \/ Demand\)\./);
  assert.match(h, /onclick="setTab\('supplyweekly'\)">Open Supply \/ Demand<\/button>/);
  // The page's own cards are not narrowed (Supply Mix has no warehouse filter of its own).
  assert.match(h, /Demand qty<\/span><span class="kpi-value">17</);
  page.run("setTab('supplyweekly')");
  assert.match(html(page), /<option value="CM - DSM" selected>CM - DSM<\/option>/, 'Supply / Demand opens on the same warehouse');
  page.run("setTab('supplydemand');sankeyNodeClick('supplydemand','demand','0:CM - DSM')");
  assert.deepEqual(page.run('supplyWarehouseFilter'), ['ALL']);
  // A snapshot without demand values falls back to open quantity.
  const qty = await supplyPage(SD.map((r) => ({ ...r, DemandOpenValue: '' })));
  [f] = flows(qty, 'supplydemand');
  assert.equal(f.unit, 'qty');
  assert.equal(f.total, 17);
  assert.match(html(qty), /Open demand quantity/);
});

// --- State ------------------------------------------------------------------------------------------------------
async function saveSnapshot(page) {
  let payload = '';
  Object.assign(page.ctx, { buildSnapshotHtml: (p) => { payload = p.text; return ''; }, downloadPreparedSnapshot() {}, showSnapshotDownloadLink() {} });
  await page.ctx.exportShareSnapshot();
  return payload;
}
async function openSnapshot(payload) {
  const snap = loadPage();
  snap.els['embedded-snapshot-data'].dataset.encoding = 'json';
  snap.els['embedded-snapshot-data'].textContent = payload;
  await snap.run('loadEmbeddedSnapshot()');
  return snap;
}

test('open cards and the Build Risk CM travel in share snapshots; a new report resets them, Add file keeps them', async () => {
  const page = await orderHealth();
  page.run("toggleSankey('weekly');sankeyOpen.buildrisk=true;buildRiskCmFilter='dsm';sankeyNodeClick('weekly','open','1:ok')");
  const STATE = '({sankeyOpen,buildRiskCmFilter})';
  const saved = await saveSnapshot(page);
  assert.deepEqual(JSON.parse(saved).sankeyOpen, { weekly: true, buildrisk: true });
  const viewer = await openSnapshot(saved);
  assert.deepEqual(viewer.run(STATE), { sankeyOpen: { weekly: true, buildrisk: true }, buildRiskCmFilter: 'dsm' });
  assert.match(html(viewer), /<section class="card sk-card rise" id="sankey-weekly"/);
  // Older snapshots, and unknown or non-boolean entries, open with every card closed.
  const old = await openSnapshot(viewer.run('JSON.stringify({parsedRows:allLoadedRows})'));
  assert.deepEqual(old.run(STATE), { sankeyOpen: {}, buildRiskCmFilter: '' });
  const odd = await openSnapshot(viewer.run('JSON.stringify({parsedRows:allLoadedRows,sankeyOpen:{weekly:"yes",search:true,supplydemand:true}})'));
  assert.deepEqual(odd.run('sankeyOpen'), { supplydemand: true });
  // Add file keeps the view; a replacement report starts closed.
  page.ctx.__more = [{ name: 'more.xls', bytes: sapExport([sapRow({ DocumentNumber: '9001', 'Internal Number': '9001' })]) }];
  await page.run('handleFiles([...loadedFiles,...__more],{adding:true})');
  assert.deepEqual(page.run(STATE), { sankeyOpen: { weekly: true, buildrisk: true }, buildRiskCmFilter: 'dsm' });
  await upload(page, [{ name: 'new.xls', bytes: sapExport(ATRISK) }]);
  assert.deepEqual(page.run(`(${STATE.slice(1, -1).replace('}', ',sankeyPinned}')})`), { sankeyOpen: {}, buildRiskCmFilter: '', sankeyPinned: {} });
});

// --- Motion and pointer helpers (fake DOM) ----------------------------------------------------------------------
test('opening animates with the Web Animations API only when motion is allowed, never with reduced motion or in print', async () => {
  const page = await orderHealth();
  const calls = [];
  const fake = (kind) => ({ animate: (frames, opts) => calls.push([kind, Object.keys(frames[0]).join(), opts.duration]) });
  page.els['sankey-weekly'] = { querySelectorAll: (sel) => (sel === '.sk-svg' ? [fake('svg')] : sel === '.sk-rect' ? [fake('rect'), fake('rect')] : []) };
  const open = (reduce, print = false) => {
    calls.length = 0;
    page.ctx.requestAnimationFrame = () => 0;
    page.ctx.matchMedia = (q) => ({ matches: /no-preference/.test(q) ? !reduce : reduce });
    page.run(`printMode=${print};sankeyOpen={};toggleSankey('weekly')`);
    return calls.slice();
  };
  assert.deepEqual(open(false), [['svg', 'clipPath', 650], ['rect', 'opacity,transform', 380], ['rect', 'opacity,transform', 380]]);
  assert.deepEqual(open(true), []);
  assert.deepEqual(open(false, true), []);
  page.run('printMode=false');
  // Closing never animates.
  calls.length = 0;
  page.run("toggleSankey('weekly')");
  assert.deepEqual(calls, []);
});

test('hover / focus light up the bands touching a box (both ways, not further on); arrow keys move between boxes', async () => {
  const page = loadPage();
  const conn = (id) => page.run(`(()=>{const c=sankeyConnected([{source:'a',target:'x'},{source:'b',target:'x'},{source:'x',target:'m'},{source:'b',target:'y'},{source:'y',target:'n'}],${JSON.stringify(id)});return {links:[...c.links].sort(),nodes:[...c.nodes].sort()};})()`);
  assert.deepEqual(conn('x'), { links: [0, 1, 2], nodes: ['a', 'b', 'm', 'x'] });
  // x → m also carries b's value, so it is not lit for a.
  assert.deepEqual(conn('a'), { links: [0], nodes: ['a', 'x'] });
  // A tiny fake SVG: classList.toggle records what would be lit up.
  const cls = () => { const on = new Set(); return { on, toggle: (c, v) => (v ? on.add(c) : on.delete(c)) }; };
  const paths = [['a', 'x'], ['x', 'm'], ['b', 'y']].map(([s, t]) => ({ dataset: { s, t }, classList: cls() }));
  const nodes = ['a', 'x', 'm', 'b', 'y'].map((id, i) => ({ dataset: { skNode: id, col: String(['a', 'b'].includes(id) ? 0 : ['x', 'y'].includes(id) ? 1 : 2), row: String(id === 'b' || id === 'y' ? 1 : 0), cy: String(id === 'b' || id === 'y' ? 80 : 20), tip: `${id} tip` }, classList: cls(), focus() { focused.push(id); } }));
  const focused = [];
  const detail = { textContent: '' };
  const svg = { dataset: { pinned: 'b' }, classList: cls(), querySelectorAll: (s) => (s === '.sk-link' ? paths : nodes), closest: () => ({ querySelector: () => detail }) };
  nodes.forEach((n) => { n.closest = () => svg; });
  page.ctx.__n = nodes;
  page.run('sankeyHover(__n[1])');
  assert.deepEqual(paths.map((p) => p.classList.on.has('sk-on')), [true, true, false]);
  assert.deepEqual(nodes.filter((n) => n.classList.on.has('sk-on')).map((n) => n.dataset.skNode), ['a', 'x', 'm']);
  assert.equal(detail.textContent, 'x tip');
  assert.ok(svg.classList.on.has('sk-hl'));
  page.run('sankeyHover(__n[1],true)'); // leaving goes back to the pinned box (b)
  assert.deepEqual(paths.map((p) => p.classList.on.has('sk-on')), [false, false, true]);
  const key = (k, i) => page.run(`sankeyNodeKey({key:${JSON.stringify(k)},preventDefault(){}},__n[${i}])`);
  key('ArrowDown', 0); key('ArrowRight', 3); key('ArrowLeft', 1); key('ArrowUp', 3); key('ArrowUp', 0);
  assert.deepEqual(focused, ['b', 'y', 'a', 'a']);
});

run();
