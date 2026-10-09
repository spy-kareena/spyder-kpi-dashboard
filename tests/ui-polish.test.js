// Version 1v6 UI polish: tooltips on every control, section info popovers, first-visit hints, toasts, the CM SFG
// warehouse scorecard groups and the shadcn-style tokens. Run with `node tests/ui-polish.test.js`.
// Fixtures are synthetic (harness.js); no SAP data.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const CSS = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
const results = (page) => page.els['results-screen'].innerHTML;
const sidebar = (page) => page.els['app-sidebar'].innerHTML;
const due = (d) => ({ DueDate: d, HeaderDueDate: d, LineDueDate: d });
const PO = (o) => sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Parts', ...o });
const shipped = (o) => sapRow({ OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', CloseDateSource: 'Delivery', OpenQuantity: '0', FillStatus: 'Complete', ...o });

// A mix that fills every Order Health card: past due, no commit, rescheduled, due soon, delivered (on time and late),
// plus purchase orders, so every page has its cards, charts and tables.
const MIX = [
  sapRow({ DocumentNumber: '1', Warehouse: 'Spyder - Lacombe', AmountLocal: '1,721,806.00', ...due('08/10/2026') }),
  sapRow({ DocumentNumber: '2', Warehouse: 'CM - Alta', ...due('08/20/2026'), LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111', RescheduleFlag: 'No Commit Date' }),
  sapRow({ DocumentNumber: '3', Warehouse: 'CM SFG - Gamma', ...due('08/25/2026'), LineRescheduleDate: '09/20/2026', RescheduleDate: '09/20/2026', RescheduleFlag: 'Rescheduled Later Than Original Delivery' }),
  sapRow({ DocumentNumber: '4', Warehouse: 'CM SFG - Delta', ...due('09/08/2026') }),
  sapRow({ DocumentNumber: '5', Warehouse: 'CM - Beta', ...due('10/15/2026'), CustomerVendorCode: 'BASSPRO', CustomerVendorName: 'Bass Pro' }),
  shipped({ DocumentNumber: '6', Warehouse: 'CM SFG - Gamma', ...due('08/01/2026'), ClosedDate: '07/30/2026', DeliveryDocNumber: '901' }),
  shipped({ DocumentNumber: '7', Warehouse: 'CM - Alta', ...due('08/01/2026'), ClosedDate: '08/12/2026', DeliveryDocNumber: '902', LineRescheduleDate: '08/10/2026', RescheduleDate: '08/10/2026' }),
  PO({ DocumentNumber: '700', Warehouse: 'CM - Alta', ...due('08/10/2026') }),
  PO({ DocumentNumber: '701', Warehouse: 'Spyder - Lacombe', ...due('09/30/2026'), Confirmed: 'N' }),
  PO({ DocumentNumber: '701', Warehouse: 'Spyder - Lacombe', OrderType: 'PO Receipt', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: '08/14/2026', CloseDateSource: 'Receipt', DeliveryDocNumber: '88', OpenQuantity: '0', ...due('08/15/2026') }),
];
const SD_HEADERS = ['#', 'ExportDate', 'Item No.', 'ItemDescription', 'WarehouseCode', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'DemandOpenValue', 'UsableSupplyQty', 'UnconfirmedSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty', 'RiskSupplyQty', 'SupplyRiskFlag'];
const SD_ROWS = [
  { '#': '1', ExportDate: '09/03/2026', 'Item No.': 'SPY-100', WarehouseCode: '11', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-10', DemandOpenQty: '10', DemandOpenValue: '1000', UsableSupplyQty: '4', MonthlyNetQty: '-6', CumulativeNetQty: '-6', RiskSupplyQty: '0', SupplyRiskFlag: 'OK' },
  { '#': '2', ExportDate: '09/03/2026', 'Item No.': 'SPY-200', WarehouseCode: '12', WarehouseName: 'CM - Alta', YearMonth: '2026-09', DemandOpenQty: '0', DemandOpenValue: '0', UsableSupplyQty: '20', UnconfirmedSupplyQty: '5', MonthlyNetQty: '20', CumulativeNetQty: '20', RiskSupplyQty: '5', SupplyRiskFlag: 'PO Not Confirmed' },
];
// A small Clear To Build workbook built with the page's own SheetJS (two weekly sheets, so the trend table shows).
function ctbWorkbook(page) {
  const head = ['CM ', 'Month', 'Total', 'Clear To Build', 'At Risk', 'Late', 'Closed', '% CTB', '% Late Orders', 'NOTES'];
  const sheets = [
    { name: '0930 - Orders at Risk', aoa: [head, ['Alta', 'September', 10, 8, 2, 0, 0, '80%', '0%', 'Boards short'], [null, 'TOTAL', 10, 8, 2, 0, 0, '80%', '0%']] },
    { name: '0924 - Orders at Risk', aoa: [head, ['Alta', 'September', 10, 5, 5, 0, 0, '50%', '0%'], [null, 'TOTAL', 10, 5, 5, 0, 0, '50%', '0%']] },
  ];
  return new Uint8Array(page.run(`(()=>{const wb=XLSX.utils.book_new();for(const s of ${JSON.stringify(sheets)})XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.aoa),s.name);return Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));})()`));
}
async function loadedAll(storage = {}) {
  const page = loadPage({ storage });
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(MIX) }, { name: 'supply.xls', bytes: utf16Tsv(SD_HEADERS, SD_ROWS) }, { name: 'Orders At Risk - Clear to Build.xlsx', bytes: ctbWorkbook(page) }]);
  return page;
}
// Every opening tag whose class list holds one of `classes` (whole words).
function tagsWithClass(html, classes) {
  return [...html.matchAll(/<(?:button|div|span|a|th|section|label|select|input)\b[^>]*>/g)].map((m) => m[0])
    .filter((tag) => { const c = (tag.match(/\sclass="([^"]*)"/) || [])[1]; return c && c.split(/\s+/).some((x) => classes.includes(x)); });
}
const hasTip = (tag) => /\sdata-tip="[^"]+"/.test(tag) || /\stitle="[^"]+"/.test(tag);
// Each page, plus card choices that draw more controls (drill cards, summary tables).
const VIEWS = [
  ['weekly', ''], ['weekly', "setWeeklyTileFilter('otd3mo')"], ['weekly', "setWeeklyTileFilter('reschedhit')"], ['weekly', "setWeeklyTileFilter('fillrate')"],
  ['weekly', "weeklyTileFilter='late';selectAllLinked(true)"],
  ['purchaseorders', ''], ['supplyweekly', ''], ['monthly', ''], ['warehouses', ''], ['metrics', ''], ['supplydemand', ''], ['buildrisk', ''], ['connect', ''],
  ['search', "searchQuery='SPY';applyGlobalSearch()"],
];
function eachView(page, fn) {
  for (const [tab, setup] of VIEWS) {
    page.run(`linkedSelection.clear();weeklyTileFilter='late';setTab(${JSON.stringify(tab)});${setup}`);
    fn(results(page) + sidebar(page), `${tab} ${setup}`);
  }
}

test('every KPI card, chip, sortable heading and button on every page has a tooltip (data-tip or title)', async () => {
  const page = await loadedAll();
  let checked = 0;
  eachView(page, (html, view) => {
    const tags = tagsWithClass(html, ['kpi', 'chip', 'th-sort', 'btn', 'nav-item', 'drill', 'link-btn', 'filter-more', 'info-btn', 'select', 'month-card', 'rate-card', 'hint-close']);
    checked += tags.length;
    const bare = tags.filter((t) => !hasTip(t));
    assert.deepEqual(bare, [], `${view}: controls without a tooltip`);
    // Every button in the page and the sidebar (tiles, presets, toggles, rows) explains itself too.
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/class="(row-check|note-btn)/.test(t));
    assert.deepEqual(buttons.filter((t) => !hasTip(t)), [], `${view}: buttons without a tooltip`);
  });
  assert.ok(checked > 300, `checked ${checked} controls`);
  assert.deepEqual(page.errors, []);
});

test('tooltips say what a card counts with the numbers written in full ($1,721,806, not $1.72M)', async () => {
  const page = await loadedAll();
  page.run("setTab('weekly')");
  const html = results(page);
  const atRisk = html.match(/data-focus-key="tile-late"[^>]*data-tip="([^"]+)"/)[1];
  assert.match(atRisk, /^At risk: \$1,72\d,\d{3} open on \d+ orders \(\d+ lines\): /);
  assert.match(atRisk, /Click to list them below\.$/);
  assert.match(html, /data-focus-key="tile-nocommit"[^>]*data-tip="No commit date: \$[\d,]+ open on 1 order \(1 line\) with no valid commit date/);
  assert.match(html, /data-focus-key="sc-Spyder - Lacombe"[^>]*data-tip="Spyder - Lacombe: open \$1,721,806, at risk \$1,721,806,/);
  for (const [, t] of html.matchAll(/data-tip="([^"]+)"/g)) assert.doesNotMatch(t, /\$\d+(\.\d+)?[KM]\b/, `short money in a tip: ${t}`);
  // Sortable headings say what the column is and how sorting works.
  assert.match(html, /class="th-sort" data-focus-key="linked-sort-value" data-col="value" data-tip="Open value for open lines, line value for closed ones\. Click to sort by Value; click again to reverse\."/);
  // Column headings of data tables come from one list (COLUMN_TIPS); headings with no entry stay plain.
  page.run("setTab('supplyweekly')");
  assert.match(results(page), /<th class="num" data-tip="Usable supply minus demand for that month alone\. Below zero means short that month\.">Monthly net<\/th>/);
  page.run("setTab('buildrisk')");
  assert.match(results(page), /<th class="num">Sep 24<\/th>/);
});

test('section ⓘ buttons: every key has its texts, opens one shared popover, and About these numbers repeats them', async () => {
  const page = await loadedAll();
  const keys = new Set();
  eachView(page, (html, view) => {
    const pageKeys = [...html.matchAll(/<button type="button" class="info-btn print-hide" data-info="([\w-]+)" data-focus-key="info-\1" aria-haspopup="dialog" aria-expanded="false" aria-controls="info-pop" aria-label="About ([^"]+)"/g)];
    for (const [, key, title] of pageKeys) {
      keys.add(key);
      const info = page.run(`SECTION_INFO[${JSON.stringify(key)}]`);
      assert.ok(info && info.title && info.what && info.source && info.click, `${view}: ${key} has a definition, a source and a click text`);
      assert.equal(title, info.title.replace(/’/g, '’'));
      // The same text is in the page's About these numbers block.
      assert.ok(html.includes(`<strong>${page.run(`esc(SECTION_INFO[${JSON.stringify(key)}].title)`)}.</strong>`), `${view}: About block lists ${key}`);
    }
  });
  assert.ok(keys.size >= 35, `${keys.size} sections have an ⓘ`);
  assert.deepEqual(Object.keys(page.run('SECTION_INFO')).filter((k) => !keys.has(k)), [], 'no unused section texts');
  assert.match(HTML, /<div id="info-pop" class="info-pop" role="dialog" aria-labelledby="info-pop-title" tabindex="-1" hidden onkeydown="infoPopKey\(event\)"><\/div>/);
  // Opening fills the popover with the texts (escaped) and marks the button expanded; closing puts focus back.
  const btn = { dataset: { info: 'oh-scorecard' }, attrs: {}, isConnected: true, focused: false, setAttribute(k, v) { this.attrs[k] = v; }, getBoundingClientRect: () => ({ left: 10, top: 10, right: 30, bottom: 30, width: 20, height: 20 }), contains: () => false, focus() { this.focused = true; } };
  page.ctx.innerWidth = 1200; page.ctx.innerHeight = 800;
  const pop = page.els['info-pop'];
  Object.assign(pop, { hidden: true, offsetWidth: 340, offsetHeight: 200, style: { setProperty() {} }, focus() {}, contains: () => false });
  page.ctx.__btn = btn;
  page.run('toggleInfo(__btn)');
  assert.equal(pop.hidden, false);
  assert.match(pop.innerHTML, /<h3 id="info-pop-title">Warehouse scorecard<\/h3>[\s\S]*<dt>Where the numbers come from<\/dt>[\s\S]*<dt>Clicking<\/dt><dd>Click a row to show only that warehouse/);
  assert.equal(btn.attrs['aria-expanded'], 'true');
  page.run('toggleInfo(__btn)');
  assert.deepEqual([pop.hidden, btn.attrs['aria-expanded'], btn.focused], [true, 'false', true]);
});

test('tip(el,text) sets data-tip and a hidden description for screen readers; empty text removes both', () => {
  const page = loadPage();
  const el = (text = '', attrs = {}) => ({ textContent: text, attrs: { ...attrs }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } });
  const host = page.els['tip-descs'];
  page.ctx.__a = el('Open', { 'aria-describedby': 'other-help' });
  page.run("tip(__a,'Open value: what is still to ship ($1,721,806).')");
  const a = page.ctx.__a;
  assert.equal(a.attrs['data-tip'], 'Open value: what is still to ship ($1,721,806).');
  const id = a.attrs['aria-describedby'].split(' ')[1];
  assert.match(a.attrs['aria-describedby'], /^other-help tipd-\d+$/, 'existing describedby ids are kept');
  assert.equal(host.children.find((n) => n.id === id).textContent, 'Open value: what is still to ship ($1,721,806).');
  // The same text reuses its hidden copy.
  page.ctx.__b = el('Other');
  page.run("tip(__b,'Open value: what is still to ship ($1,721,806).')");
  assert.equal(page.ctx.__b.attrs['aria-describedby'], id);
  // Text the element already shows is not read twice.
  page.ctx.__c = el('Lacombe · Sep 2026: $1 open');
  page.run("tip(__c,'Lacombe · Sep 2026: $1 open')");
  assert.equal(page.ctx.__c.attrs['aria-describedby'], undefined);
  page.run("tip(__a,'')");
  assert.deepEqual(a.attrs, { 'aria-describedby': 'other-help' });
  assert.equal(page.run("tipAttr('<b>\"x\"</b>')"), ' data-tip="&lt;b&gt;&quot;x&quot;&lt;/b&gt;"');
  assert.equal(page.run("tipAttr('  ')"), '');
});

test('tooltip and popover placement: preferred side, flips when there is no room, stays inside the window', () => {
  const page = loadPage();
  page.ctx.innerWidth = 1000; page.ctx.innerHeight = 700;
  const box = () => ({ offsetWidth: 300, offsetHeight: 60, dataset: {}, vars: {}, style: { setProperty(k, v) { this.owner.vars[k] = v; } } });
  const place = (rect, want, align) => {
    const b = box(); b.style.owner = b;
    page.ctx.__box = b; page.ctx.__anchor = { getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) };
    page.run(`placeFloating(__box,__anchor,${JSON.stringify(want)},8,${JSON.stringify(align || 'center')})`);
    return { side: b.dataset.side, left: parseInt(b.style.left, 10), top: parseInt(b.style.top, 10), arrow: parseInt(b.vars['--arrow-x'], 10) };
  };
  assert.deepEqual(place({ left: 400, top: 300, width: 200, height: 40 }, 'top'), { side: 'top', left: 350, top: 232, arrow: 150 });
  // Near the top edge it flips below; near the right edge it is pulled back in and the arrow still points at the anchor.
  const nearTop = place({ left: 400, top: 20, width: 200, height: 40 }, 'top');
  assert.equal(nearTop.side, 'bottom');
  assert.equal(nearTop.top, 68);
  const nearRight = place({ left: 940, top: 300, width: 40, height: 20 }, 'top');
  assert.equal(nearRight.left, 1000 - 8 - 300);
  assert.equal(nearRight.arrow, 960 - 692);
  // A left preference with no room on the left goes right; the info popover lines up with its button's left edge.
  assert.equal(place({ left: 50, top: 300, width: 40, height: 20 }, 'left').side, 'right');
  assert.equal(place({ left: 120, top: 300, width: 20, height: 20 }, 'bottom', 'start').left, 120);
});

test('toasts confirm bulk Apply, Delete and Restore and note saves in the #toast status region', async () => {
  assert.match(HTML, /<div id="toast" class="toast" role="status" aria-live="polite" aria-atomic="true"><\/div>/);
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport([1, 2, 3].map((n) => sapRow({ DocumentNumber: String(n), ...due('08/10/2026') }))) }]);
  const toast = () => page.els.toast.innerHTML.replace(/<[^>]+>/g, '');
  page.run("setTab('weekly');weeklyTileFilter='late';renderResults();selectAllLinked(true);linkedBulkStatus='Hold';applyLinkedOverride()");
  assert.equal(toast(), 'Hold set on 3 lines.');
  page.run("linkedBulkStatus='';applyLinkedOverride()");
  assert.equal(toast(), 'Override cleared on 3 lines.');
  page.run('deleteLinkedSelection()');
  assert.equal(toast(), 'Deleted 3 lines. Restore them from Data check.');
  page.run('restoreDeletedLines()');
  assert.equal(toast(), 'Restored 3 lines.');
  const key = page.run('rowKey(parsedRows[0])');
  page.run(`toggleRowNote(${JSON.stringify(key)});updateRowOverride(${JSON.stringify(key)},'notes','Called the CM');toggleRowNote(${JSON.stringify(key)})`);
  assert.equal(toast(), 'Note saved.');
  page.run("showToast('<b>escaped</b>')");
  assert.match(page.els.toast.innerHTML, /<span>&lt;b&gt;escaped&lt;\/b&gt;<\/span>/);
});

test('first-visit hints stay dismissed (localStorage spyderKpiHints) until Show hints again', async () => {
  const page = loadPage();
  assert.match(page.els['upload-hint'].innerHTML, /data-hint="upload"[\s\S]*Start here\./);
  await upload(page, [{ name: 'e.xls', bytes: sapExport(MIX) }]);
  page.run("setTab('weekly')");
  assert.match(results(page), /<div class="hint-card print-hide" role="note" aria-label="Hint" data-hint="weekly-cards">/);
  assert.match(sidebar(page), /<button type="button" class="nav-item nav-plain" data-focus-key="hints-reset" onclick="resetHints\(\)"/);
  page.run("dismissHint('weekly-cards');renderResults()");
  assert.doesNotMatch(results(page), /data-hint="weekly-cards"/);
  assert.deepEqual(Object.keys(JSON.parse(page.storage.spyderKpiHints)), ['weekly-cards']);
  page.run('resetHints()');
  assert.equal(page.storage.spyderKpiHints, undefined);
  assert.match(results(page), /data-hint="weekly-cards"/);
  // Blocked or broken storage never breaks a page: the hint just shows.
  page.storage.spyderKpiHints = '{not json';
  assert.match(page.run("renderHint('x','Hi')"), /data-hint="x"/);
  page.ctx.localStorage.getItem = () => { throw new Error('blocked'); };
  page.ctx.localStorage.setItem = () => { throw new Error('blocked'); };
  assert.match(page.run("renderHint('x','Hi')"), /data-hint="x"/);
  page.run("dismissHint('x')");
});

test('page descriptions: under each page name on the load screen, as the tooltip once a report is open', async () => {
  const page = loadPage();
  page.run('renderSidebar()');
  const descs = page.run('PAGE_TIPS');
  for (const [id, text] of Object.entries(descs)) {
    assert.match(sidebar(page), new RegExp(`data-focus-key="nav-${id}"[^>]*>[^]*?<span class="nav-desc">${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`), id);
  }
  await upload(page, [{ name: 'e.xls', bytes: sapExport(MIX) }]);
  assert.doesNotMatch(sidebar(page), /nav-desc/);
  assert.match(sidebar(page), new RegExp(`data-focus-key="nav-weekly" onclick="setTab\\('weekly'\\)" aria-current="page" data-tip="${descs.weekly}"`));
  assert.match(sidebar(page), /<span class="nav-badge" data-tip="\d+ orders at risk \(same count as the At risk card\)">/);
});

// Warehouse scorecard: two CM SFG and three other warehouses, with open, at-risk, past-due lines and deliveries.
const SC_ROWS = [
  sapRow({ DocumentNumber: '11', Warehouse: 'CM SFG - Gamma', AmountLocal: '1,000.00', ...due('08/10/2026') }),
  sapRow({ DocumentNumber: '12', Warehouse: 'CM SFG - Gamma', AmountLocal: '2,000.00', ...due('10/10/2026') }),
  sapRow({ DocumentNumber: '13', Warehouse: 'CM SFG - Delta', AmountLocal: '4,000.00', ...due('08/20/2026'), LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111' }),
  shipped({ DocumentNumber: '14', Warehouse: 'CM SFG - Delta', ...due('08/01/2026'), ClosedDate: '07/31/2026', DeliveryDocNumber: '801' }),
  shipped({ DocumentNumber: '15', Warehouse: 'CM SFG - Gamma', ...due('08/01/2026'), ClosedDate: '08/09/2026', DeliveryDocNumber: '802' }),
  sapRow({ DocumentNumber: '21', Warehouse: 'Spyder - Lacombe', AmountLocal: '8,000.00', ...due('08/15/2026') }),
  sapRow({ DocumentNumber: '22', Warehouse: 'CM - Alta', AmountLocal: '16,000.00', ...due('10/20/2026') }),
  sapRow({ DocumentNumber: '23', Warehouse: 'CM - Beta', AmountLocal: '32,000.00', ...due('08/25/2026'), LineRescheduleDate: '09/30/2026', RescheduleDate: '09/30/2026' }),
  shipped({ DocumentNumber: '24', Warehouse: 'CM - Beta', ...due('08/01/2026'), ClosedDate: '08/01/2026', DeliveryDocNumber: '803' }),
];
async function scorecardPage(rows = SC_ROWS) {
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  page.run("setTab('weekly')");
  return page;
}
const scorecardData = (page) => page.run("filterCache.entries.get(`oh|${weeklyFilterKey()}|scorecard`)");

test('warehouse scorecard: CM SFG and all other warehouses in one card, each with a header and a subtotal that adds up', async () => {
  const page = await scorecardPage();
  const html = results(page);
  const card = html.match(/<section class="table" aria-label="Warehouse scorecard">[\s\S]*?<\/section>/)[0];
  assert.deepEqual([...card.matchAll(/<div class="sc-group-head" role="heading" aria-level="3" data-group="(\w+)">([^<]+)<span class="muted">([^<]+)<\/span>/g)].map((m) => m.slice(1)),
    [['sfg', 'CM SFG', '2 warehouses'], ['other', 'All other warehouses', '3 warehouses']]);
  // Rows sit under their group header; clicking a row still focuses the page on it.
  const sfgPart = card.split('data-group="other"')[0];
  assert.deepEqual([...sfgPart.matchAll(/data-wh="([^"]+)"/g)].map((m) => m[1]).sort(), ['CM SFG - Delta', 'CM SFG - Gamma']);
  assert.equal((card.match(/onclick="setWeeklyScorecardWarehouse\(this\.dataset\.wh\)"/g) || []).length, 5);
  const groups = page.run(`scorecardGroups(filterCache.entries.get(\`oh|\${weeklyFilterKey()}|scorecard\`),false)`);
  for (const g of groups) {
    const sum = (k) => g.rows.reduce((s, r) => s + r[k], 0);
    assert.equal(g.subtotal.openAmt, sum('openAmt'));
    assert.equal(g.subtotal.riskAmt, sum('riskAmt'));
    assert.equal(g.subtotal.pastDue, sum('pastDue'));
  }
  // The subtotals match the open lines themselves, and OTD is scored over the group's deliveries (1 of 2 on time).
  const [sfg, other] = groups;
  assert.equal(sfg.subtotal.openAmt, 7000);
  assert.equal(other.subtotal.openAmt, 56000);
  assert.equal(sfg.subtotal.openAmt + other.subtotal.openAmt, page.run('rowOpenAmount(orderHealthData(currentMetrics()).allOrderRows)'));
  assert.equal(sfg.subtotal.riskAmt, 5000);
  assert.equal(sfg.subtotal.pastDue, 2);
  assert.deepEqual([sfg.subtotal.otdN, sfg.subtotal.otdRate], [2, 50]);
  assert.deepEqual([other.subtotal.otdN, other.subtotal.otdRate], [1, 100]);
  // The subtotal row shows and tells the same numbers (full amounts for screen readers and the tooltip).
  assert.match(card, /<div class="trow sc-cols sc-subtotal" data-group="sfg" data-tip="CM SFG subtotal \(2 warehouses\): open \$7,000, at risk \$5,000, 2 lines past due, OTD 3 mo 50%">/);
  assert.match(card, /<span class="sr-only">All other warehouses subtotal \(3 warehouses\): open \$56,000, at risk \$40,000, 1 line past due, OTD 3 mo 100%<\/span>/);
  assert.ok(sfgPart.indexOf('sc-subtotal') > sfgPart.lastIndexOf('data-wh='), 'the subtotal closes its group');
});

test('warehouse scorecard: the top 9 show per group, Show all lists every warehouse, a group with no warehouses is left out', async () => {
  const rows = [
    sapRow({ DocumentNumber: '1', Warehouse: 'CM SFG - A', ...due('08/10/2026') }),
    sapRow({ DocumentNumber: '2', Warehouse: 'CM SFG - B', ...due('08/10/2026') }),
    ...Array.from({ length: 11 }, (_, i) => sapRow({ DocumentNumber: String(100 + i), Warehouse: `CM - W${String(i).padStart(2, '0')}`, AmountLocal: String(1000 + i), ...due('08/10/2026') })),
  ];
  const page = await scorecardPage(rows);
  const rowsShown = () => (results(page).match(/class="trow sc-cols(?: selected)?" data-focus-key="sc-/g) || []).length;
  assert.equal(rowsShown(), 11);
  assert.match(results(page), /<div class="tfoot"><span>Showing 11 of 13 warehouses<\/span><button type="button" class="link-btn" data-focus-key="scorecard-all"/);
  page.run('toggleWeeklyScorecardAll()');
  assert.equal(rowsShown(), 13);
  assert.match(results(page), />Show top 9<\/button>/);
  // Subtotals always cover the whole group, not just the rows shown.
  page.run('toggleWeeklyScorecardAll()');
  assert.match(results(page), /data-group="other" data-tip="All other warehouses subtotal \(11 warehouses\): open \$11,055,/);
  const noSfg = await scorecardPage(SC_ROWS.filter((r) => !/SFG/.test(r.Warehouse)));
  assert.deepEqual([...results(noSfg).matchAll(/class="sc-group-head"[^>]*data-group="(\w+)"/g)].map((m) => m[1]), ['other']);
  assert.ok(Array.isArray(scorecardData(noSfg)));
});

test('shadcn look: zinc tokens, 12/8/8 radii, one focus ring, Inter with a fallback, motion guard, compact print', () => {
  const root = CSS.match(/:root\{([\s\S]*?)\}/)[1];
  for (const t of ['--gray-900:#18181b', '--gray-200:#e4e4e7', '--gray-100:#f4f4f5', '--gray-50:#fafafa', '--r-card:12px', '--r-ctl:8px', '--r-btn:8px', '--ring:var(--accent)']) assert.ok(root.includes(t), t);
  assert.match(root, /--font:'Inter',ui-sans-serif,system-ui,/);
  assert.match(HTML, /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">/);
  assert.match(CSS, /:focus-visible\{outline:2px solid var\(--ring\);outline-offset:2px\}/);
  assert.match(CSS, /\.sidebar-brand\{padding:20px 10px 0;display:grid;gap:14px;/);
  assert.match(CSS, /\.sidebar-brand\{padding:0;display:flex;align-items:center;gap:20px\}/);
  assert.match(CSS, /\.main\{[^}]*gap:32px/);
  assert.match(CSS, /\.grid-lead\{[^}]*gap:20px\}/);
  assert.match(CSS, /\.card\{[^}]*padding:24px 26px/);
  assert.ok(!/\.(btn|kpi|drill):hover\{[^}]*transform:(?!none)/.test(CSS), 'no movement on hover');
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)\{\s*\*,\*::before,\*::after\{animation-duration:\.01ms!important;[^}]*transition-duration:\.01ms!important\}/);
  // Stream A's print block (other blocks may follow it in the stylesheet)
  const print = CSS.slice(CSS.lastIndexOf('@media print{', CSS.indexOf('#tip-layer,#info-pop,#toast')));
  assert.match(print, /#tip-layer,#info-pop,#toast,#tip-descs,\.info-btn,\.hint-card,\.nav-desc\{display:none!important\}/);
  assert.match(print, /\.grid-lead,\.grid-4,\.grid-5,\.grid-2,\.grid-split,\.month-spot,\.drill-grid,\.grid-split>\.stack\{gap:\.1in\}/);
  assert.match(HTML, /<div id="tip-layer" class="tip-layer" aria-hidden="true" hidden><span class="tip-text"><\/span><span class="tip-arrow"><\/span><\/div>/);
  assert.match(HTML, /<div id="tip-descs" hidden><\/div>/);
});

run();
