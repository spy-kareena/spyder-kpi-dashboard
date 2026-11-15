// 2v9 (owner) Settings: the new settings (on-time goals for sales and vendors, start page, Purchase Order Health's
// opening view), the Live SAP block in Data (last pull, rows, status, Refresh now) and the file controls that only
// Import files shows. Run with `node tests/settings-2v9.test.js`. Fixtures are synthetic.
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const html = (page) => page.els['results-screen'].innerHTML;
const sec = (h, id) => { const at = h.indexOf(`<section class="stg-sec" id="stg-sec-${id}"`); return at < 0 ? '' : h.slice(at, h.indexOf('</section>', at)); };
const store = (o) => ({ spyderKpiSettings: JSON.stringify({ dataSource: 'import', ...o }) });
async function loaded(rows, settings = {}, today) {
  const page = loadPage({ storage: store(settings), ...(today ? { today } : {}) });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
}
// Purchase-order receipts (the po-received fixture, cut down): two lines on time, one late.
const po = (o) => sapRow({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'Purchase Order', ExportDate: '09/24/2026', LineNumber: '0', Warehouse: 'Spyder - Lacombe', DocumentDate: '04/01/2026', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Metals', ...o });
function poRows() {
  const out = [];
  [['100', '09/10/2026', '09/05/2026'], ['101', '09/10/2026', '09/10/2026'], ['102', '09/10/2026', '09/15/2026']].forEach(([doc, orig, recv], i) => {
    const c = { DocumentNumber: doc, 'Internal Number': String(9000 + i), DueDate: orig, HeaderDueDate: orig, LineDueDate: orig, RescheduleFlag: 'No Reschedule' };
    out.push(po({ ...c, Status: 'Closed', KPIStatus: 'Closed', ClosedDate: recv, OpenQuantity: '0', FillStatus: 'Complete' }));
    out.push(po({ ...c, OrderType: 'PO Receipt', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: recv, CloseDateSource: 'Receipt', DeliveryDocNumber: String(7000 + i), OpenQuantity: '0' }));
  });
  return out;
}

test('the four new settings: defaults, checks, stored only when not the default, exported, imported and reset like the others', async () => {
  const page = await loaded([sapRow()]);
  assert.equal(page.run("stgValue('otdGoalSales')"), 90);
  assert.equal(page.run("stgValue('otdGoalVendors')"), 90);
  assert.equal(page.run("stgValue('startPage')"), 'orderhealth');
  assert.equal(page.run("stgValue('poOpeningView')"), 'open');
  for (const bad of ['49', '101', '85.5', "'90'", 'null']) {
    assert.equal(page.run(`stgSet('otdGoalSales',${bad})`), false, bad);
    assert.equal(page.run(`stgSet('otdGoalVendors',${bad})`), false, bad);
  }
  assert.equal(page.run("stgSet('startPage','search')"), false);
  assert.equal(page.run("stgSet('startPage','settings')"), false);
  assert.equal(page.run("stgSet('poOpeningView','late')"), false);
  // A bad value in the store counts as the default.
  const odd = loadPage({ storage: store({ otdGoalSales: 120, otdGoalVendors: 'x', startPage: 'nope', poOpeningView: 1 }) });
  assert.deepEqual(odd.run("['otdGoalSales','otdGoalVendors','startPage','poOpeningView'].map(stgValue)"), [90, 90, 'orderhealth', 'open']);
  // The number boxes take 50 to 100 and say so otherwise.
  page.run("stgNumChange({value:'40'},'otdGoalSales',50,100)");
  assert.match(page.els.toast.innerHTML, /Use a whole number from 50 to 100/);
  page.run("stgNumChange({value:'85'},'otdGoalSales',50,100)");
  page.run("stgSet('otdGoalVendors',80);stgSet('startPage','shipping');stgSet('poOpeningView','received')");
  assert.deepEqual(JSON.parse(page.run("localStorage.getItem('spyderKpiSettings')")), { dataSource: 'import', otdGoalSales: 85, otdGoalVendors: 80, startPage: 'shipping', poOpeningView: 'received' });
  // Export carries them.
  page.run("Blob=class{constructor(p){globalThis.__blob=p[0];}};stgExport()");
  const out = JSON.parse(page.run('__blob')).settings;
  assert.deepEqual([out.otdGoalSales, out.otdGoalVendors, out.startPage, out.poOpeningView], [85, 80, 'shipping', 'received']);
  // Reset puts them back.
  page.run('stgResetAll()');
  assert.deepEqual(page.run("['otdGoalSales','otdGoalVendors','startPage','poOpeningView'].map(stgValue)"), [90, 90, 'orderhealth', 'open']);
  assert.equal(page.run('OTD_GOAL_SALES'), 90);
  // Import takes the good ones and skips the bad.
  page.run("FileReader=class{readAsText(f){this.result=f.text;this.onload();}}");
  page.run(`stgImport({files:[{text:${JSON.stringify(JSON.stringify({ settings: { otdGoalSales: 70, otdGoalVendors: 101, startPage: 'purchaseorders', poOpeningView: 'received' } }))}}],value:''})`);
  assert.deepEqual(page.run("['otdGoalSales','otdGoalVendors','startPage','poOpeningView'].map(stgValue)"), [70, 90, 'purchaseorders', 'received']);
  assert.equal(page.run('OTD_GOAL_SALES'), 70);
  assert.deepEqual(page.errors, []);
});

test('sales on-time goal: the Trend chart\'s dashed line, the green split and the Monthly / By warehouse lines follow it', async () => {
  const page = await loaded([sapRow()]);
  const pts = '[{date:new Date(2026,6,1),otd:60,orders:4,lateOrders:1},{date:new Date(2026,7,1),otd:95,orders:5,lateOrders:0}]';
  const top = () => page.run(`ohgTrendChart(${pts},'otd')`).match(/<i class="mwm-target" style="top:([\d.]+)%"><\/i>/)[1];
  assert.equal(page.run("OHG_TREND.otd.target"), 90);
  assert.equal(top(), '20.00'); // 50 % to 100 %: 90 sits a fifth down
  page.run("stgSet('otdGoalSales',80)");
  assert.equal(page.run('OTD_GOAL_SALES'), 80);
  assert.equal(page.run("OHG_TREND.otd.target"), 80);
  assert.equal(top(), '40.00');
  // Only On Time carries the goal (Perfect Order has none).
  assert.doesNotMatch(page.run(`ohgTrendChart(${pts.replace(/otd/g, 'perfect')},'perfect')`), /mwm-target/);
  // The vendor goal is a separate setting.
  assert.equal(page.run('OTD_GOAL_VENDORS'), 90);
  // Every sales on-time goal line reads the setting.
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(src, /otd:line\(six\.map\(r=>r\.otd\),'On time',\{target:OTD_GOAL_SALES,fmt:pct,color:rate\(last\('otd'\),OTD_GOAL_SALES\)\}\)/);
  assert.match(src, /\{labels:wLabels,target:OTD_GOAL_SALES,/);
  assert.match(src, /const rateTone=v=>v>=OTD_GOAL_SALES\?/);
  assert.deepEqual(page.errors, []);
});

test('vendor on-time goal: Purchase Order Health > Received shows and colours against it; Opening view picks Received', async () => {
  const page = await loaded(poRows(), {}, '2026-09-24');
  page.run("setTab('purchaseorders')");
  assert.match(html(page), /data-focus-key="po-view-open" class="on"/, 'Open by default');
  page.run("supSet('po-view','received')");
  assert.match(html(page), /target <b>90%<\/b>/);
  assert.equal(page.run('poRecvTone(85)'), 'amber');
  page.run("stgSet('otdGoalVendors',80)");
  page.run("setTab('purchaseorders')");
  assert.match(html(page), /target <b>80%<\/b>/);
  assert.doesNotMatch(html(page), /target <b>90%<\/b>/);
  assert.equal(page.run('poRecvTone(85)'), 'teal');
  // Opening view: a new report opens Purchase Order Health on Received; the switch still works after.
  const rec = await loaded(poRows(), { poOpeningView: 'received' }, '2026-09-24');
  rec.run("setTab('purchaseorders')");
  assert.match(html(rec), /data-focus-key="po-view-received" class="on"/);
  assert.match(html(rec), /por-bandcard/);
  rec.run("supSet('po-view','open')");
  assert.match(html(rec), /data-focus-key="po-view-open" class="on"/);
  assert.deepEqual(page.errors.concat(rec.errors), []);
});

test('start page: a load opens the chosen page; a hidden one opens Sales Order Health; the picker offers shown pages only', async () => {
  const p1 = await loaded([sapRow()], { startPage: 'purchaseorders', hiddenPages: [] });
  assert.equal(p1.run('activeTab'), 'purchaseorders');
  const p2 = await loaded([sapRow()], { startPage: 'shipping', hiddenPages: [] });
  assert.equal(p2.run('activeTab'), 'shipping');
  const p3 = await loaded([sapRow()], { startPage: 'shipping', hiddenPages: ['shipping'] });
  assert.equal(p3.run('activeTab'), 'weekly');
  assert.equal(p3.run('stgStartTab()'), 'weekly');
  p3.run("setTab('settings')");
  const g = sec(html(p3), 'general');
  const opts = [...g.matchAll(/<option value="(\w+)"( selected)?>([^<]+)<\/option>/g)].filter((m) => ['orderhealth', 'purchaseorders', 'shipping'].includes(m[1])).map((m) => [m[1], !!m[2], m[3]]);
  assert.deepEqual(opts, [['orderhealth', true, 'Sales Order Health'], ['purchaseorders', false, 'Purchase Order Health']]);
  // The default opens Sales Order Health.
  const p4 = await loaded([sapRow()]);
  assert.equal(p4.run('activeTab'), 'weekly');
  assert.deepEqual([p1, p2, p3, p4].flatMap((p) => p.errors), []);
});

test('Live SAP block: last pull (relative and exact), rows in, status; Refresh now calls the live pull and is off while it runs', async () => {
  const page = loadPage(); // Live SAP is the default
  page.run('isSnapshotView=false');
  page.run("Object.assign(liveState,{on:true,status:'ok',okAt:Date.now()-3*60000,dataAt:Date.now()-3*60000,busy:false});setTab('settings')");
  let d = sec(html(page), 'data');
  assert.match(d, /<div class="stg-block stg-live" id="stg-live" role="group" aria-label="Live SAP">/);
  assert.match(d, /<svg class="live-pulse ok"[\s\S]*?<\/svg><span>Live<\/span>/);
  assert.match(d, /<dt>Last pull<\/dt><dd>3 min ago <span class="stg-when">Thu, Sep 24, 2026, 9:57 AM<\/span><\/dd>/);
  assert.match(d, /<dt>Rows in<\/dt><dd>None yet<\/dd>/);
  assert.match(d, /data-focus-key="stg-ds-refresh" onclick="loadFromSap\(\)"[^>]*>Refresh now<\/button>/);
  // Import-only controls are not shown in live mode.
  assert.doesNotMatch(d, /stg-ds-upload|stg-ds-add|stg-ds-new|stg-importReport|stg-add-files|stg-new-export/);
  // Refresh now: loadFromSap runs the live pull (manual); while it runs the button is off and says so.
  page.run("globalThis.__calls=[];liveRead=function(o){__calls.push(o);liveState.busy=true;liveRender();return new Promise(()=>{});};loadFromSap()");
  assert.deepEqual(page.run('__calls'), [{ manual: true }]);
  d = sec(html(page), 'data');
  assert.match(d, /data-focus-key="stg-ds-refresh" onclick="loadFromSap\(\)" disabled aria-busy="true"[^>]*>Reading…<\/button>/);
  // A failed pull keeps the last good copy and says so, with the reason.
  page.run("Object.assign(liveState,{busy:false,status:'down',message:'the site could not be reached',downSince:Date.now()});allLoadedRows=[{sourceType:'Sales Order'},{sourceType:'Purchase Order'}];liveRender()");
  page.run('renderResults()');
  d = sec(html(page), 'data');
  assert.match(d, /<span>Last pull failed, showing the last good copy<span class="live-why">the site could not be reached<\/span><\/span>/);
  assert.match(d, /<dt>Rows in<\/dt><dd>1 sales · 1 PO · 0 supply \/ demand<\/dd>/);
  assert.match(d, /data-focus-key="stg-ds-refresh" onclick="loadFromSap\(\)" data-tip/, 'on again once the pull is over');
  // Not set up on this site: the message and no button.
  page.run("Object.assign(liveState,{status:'off'});renderResults()");
  d = sec(html(page), 'data');
  assert.match(d, /Live SAP is not set up on this site/);
  assert.doesNotMatch(d, /stg-ds-refresh/);
  assert.deepEqual(page.errors, []);
});

test('Import files: Upload, Add files, Load new export and Import report show in Data; no Live SAP block', async () => {
  const page = await loaded([sapRow()]);
  page.run("setTab('settings')");
  const d = sec(html(page), 'data');
  assert.match(d, /data-focus-key="stg-ds-upload"[\s\S]*data-focus-key="stg-ds-add"[\s\S]*data-focus-key="stg-ds-new"[^>]*>Load new export<\/button>/);
  assert.match(d, /data-focus-key="stg-importReport-problems"/);
  assert.doesNotMatch(d, /id="stg-live"|stg-ds-refresh/);
  assert.deepEqual(page.errors, []);
});

run();
