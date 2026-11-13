// Version 1v6 UI polish: tooltips on every control, section info popovers, first-visit hints, toasts, the CM SFG
// warehouse scorecard groups and the shadcn-style tokens. Run with `node tests/ui-polish.test.js`.
// Fixtures are synthetic (harness.js); no SAP data.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const CSS = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
const results = (page) => page.els['results-screen'].innerHTML;
// The sidebar became the header (app-header): page links, the export date and the gear.
const sidebar = (page) => page.els['app-header'].innerHTML;
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
  // Monthly, Warehouse Timeline and the Supply pages are hidden by default (Settings > Hidden Pages); show them all so
  // every page is checked.
  page.run("stgSet('hiddenPages',[])");
  return page;
}
// Every opening tag whose class list holds one of `classes` (whole words).
function tagsWithClass(html, classes) {
  return [...html.matchAll(/<(?:button|div|span|a|th|section|label|select|input|textarea)\b[^>]*>/g)].map((m) => m[0])
    .filter((tag) => { const c = (tag.match(/\sclass="([^"]*)"/) || [])[1]; return c && c.split(/\s+/).some((x) => classes.includes(x)); });
}
const hasTip = (tag) => /\sdata-tip="[^"]+"/.test(tag) || /\stitle="[^"]+"/.test(tag);
// Each page, plus card choices that draw more controls (drill cards, summary tables).
const VIEWS = [
  ['weekly', ''], ['weekly', "setWeeklyTileFilter('otd3mo')"], ['weekly', "setWeeklyTileFilter('reschedhit')"], ['weekly', "setWeeklyTileFilter('fillrate')"],
  ['weekly', "weeklyTileFilter='late';selectAllLinked(true)"],
  // Leading's "What can we do" card shows one list at a time: Supply to pull in first, Date changes behind its switch.
  ['weekly', "ohlSetDoView('dates')"],
  ['purchaseorders', ''], ['supplyweekly', ''], ['monthly', ''], ['warehouses', ''], ['metrics', ''], ['supplydemand', ''], ['buildrisk', ''], ['settings', ''],
  ['search', "searchQuery='SPY';applyGlobalSearch()"],
  // The note editor (override, cause, note), the Lagging tab and the Shipping page. (The Big picture chart is hidden on
  // Sales Order Health since 2v2.2: BIG_PICTURE_HIDDEN; tests/sankey.test.js covers it.)
  ['weekly', 'toggleRowNote(rowKey(parsedRows[0]))'],
  ['weekly', "setWeeklyView('lagging')"], ['shipping', ''],
];
function eachView(page, fn) {
  for (const [tab, setup] of VIEWS) {
    // Each view starts on Leading (Metrics opens Lagging, and the view is kept across pages).
    page.run(`linkedSelection.clear();expandedNoteRows.clear();sankeyOpen.weekly=false;weeklyTileFilter='late';weeklyView='leading';ohlDoView='pull';setTab(${JSON.stringify(tab)});${setup}`);
    fn(results(page) + sidebar(page), `${tab} ${setup}`);
  }
}

// A button of a pager (dzPager on every page, Shipping's own): a page number or an arrow, named by its aria-label
// ("Page 1 of 2", "Previous page") instead of a tip. Nothing else matches: the whole tag is spelled out.
const PAGER_BTN = /^<button type="button" class="shp-pg(?: arrow| on)?" data-focus-key="(?:ship-)?pg-[^"]+-(?:prev|next|\d+)" aria-label="(?:Previous page|Next page|Page \d+ of \d+)"(?: aria-current="page"| aria-disabled="true")? onclick="(?:dzGoPage|shpGoPage)\([^"]*\)">$/;
// Every pager in the markup is a nav named for its list ("Month by month pages") that takes the arrow keys, and holds
// nothing but named pager buttons; no pager button is drawn outside one. Returns the pagers' ids.
function checkPagers(html, view) {
  const navs = [...html.matchAll(/<nav class="shp-pager[^"]*"[^>]*>[\s\S]*?<\/nav>/g)].map((m) => m[0]);
  let inside = 0;
  for (const nav of navs) {
    assert.match(nav, /^<nav class="shp-pager[^"]*"[^>]*\saria-label="[^"]+ pages"[^>]*\sonkeydown="[^"]+"/, `${view}: a pager is a named nav`);
    const buttons = [...nav.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(buttons.length >= 4, `${view}: a pager has two arrows and at least two pages`);
    assert.deepEqual(buttons.filter((t) => !PAGER_BTN.test(t)), [], `${view}: pager buttons without a name`);
    inside += buttons.length;
  }
  assert.equal([...html.matchAll(/<button\b[^>]*>/g)].filter((m) => PAGER_BTN.test(m[0])).length, inside, `${view}: a pager button outside a pager`);
  return navs.map((nav) => (nav.match(/\sdata-dzpager="([^"]+)"/) || [])[1] || 'shipping');
}

test('every KPI card, chip, sortable heading and button on every page has a tooltip (data-tip or title)', async () => {
  const page = await loadedAll();
  let checked = 0;
  const drawn = new Set();
  const pagers = new Set();
  eachView(page, (html, view) => {
    for (const k of ['class="row-override"', 'class="row-note"', 'class="shp-', '<summary', '<a href']) if (html.includes(k)) drawn.add(k);
    // (2v6: the dz-* buttons, filter pills, pill inputs and header links are checked too.)
    const tags = tagsWithClass(html, ['kpi', 'chip', 'th-sort', 'btn', 'nav-item', 'drill', 'link-btn', 'filter-more', 'select', 'month-card', 'rate-card', 'row-override', 'row-cause', 'row-note', 'dz-btn', 'dz-filter', 'dz-pillinput', 'hdr-link', 'hdr-icon', 'ohl-hero', 'shp-tile']);
    // About toggles and links explain themselves too.
    tags.push(...[...html.matchAll(/<summary\b[^>]*>|<a\b[^>]*\shref="[^"]*"[^>]*>/g)].map((m) => m[0]));
    checked += tags.length;
    // 2v6 controls whose own words are the whole story need no tip: the header logo (a home link named by its
    // aria-label), the choices in a dz menu (Warehouse: All, CM, ...), the plain options of a segmented switch (10 / 20 /
    // 50), a Settings switch named by its aria-label, a menu button that opens a labelled menu (the header's Supply) and
    // a form's submit button; a text or search box says what it takes in its placeholder and aria-label (a tip over a
    // text box is never shown on focus anyway); a Settings field named by its own <label for>.
    const labelled = (t) => { const id = (t.match(/\sid="([^"]+)"/) || [])[1]; return !!id && new RegExp(`<label\\b[^>]*\\sfor="${id}"`).test(html); };
    const selfNamed = (t) => /^<a class="hdr-logo" href="\.\/" aria-label="[^"]+"/.test(t) || /\srole="menuitem(radio)?"/.test(t)
      || /^<input type="(search|text)"[^>]*\splaceholder="[^"]+"[^>]*\saria-label="[^"]+"/.test(t) || (/^<(select|input)\b/.test(t) && labelled(t))
      || /^<button type="button" data-focus-key="[^"]+"(?: class="on")? aria-pressed="(true|false)"/.test(t)
      || (/\srole="switch"/.test(t) && /\saria-label="[^"]+"/.test(t)) || /\saria-haspopup="menu"/.test(t) || /\stype="submit"/.test(t);
    const bare = tags.filter((t) => !hasTip(t) && !selfNamed(t));
    assert.deepEqual(bare, [], `${view}: controls without a tooltip`);
    // Every button in the page and the header (tiles, presets, toggles, rows) explains itself too. The buttons of a
    // pager are named instead (checkPagers below): a page number needs no tip.
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/class="(row-check|note-btn)/.test(t));
    assert.deepEqual(buttons.filter((t) => !hasTip(t) && !selfNamed(t) && !PAGER_BTN.test(t)), [], `${view}: buttons without a tooltip`);
    for (const id of checkPagers(html, view)) pagers.add(id);
  });
  assert.ok(checked > 300, `checked ${checked} controls`);
  assert.equal(drawn.size, 5, `the note editor, Shipping, About toggles and links were all checked: ${[...drawn]}`);
  // Lagging's Month by month table is 12 months, 6 a page, so its pager is always drawn (Metrics opens Lagging too).
  assert.ok(pagers.has('ohg-months'), `pagers checked: ${[...pagers]}`);

  // Lagging, Version 1: the Trend card's metric chips and its Months switch each say what they show.
  page.run("weeklyView='leading';setTab('weekly');setWeeklyView('lagging')");
  const lag = results(page);
  const trend = lag.match(/<section class="dz-card dz-span-6 ohgt-trend" id="ohg-metrics"[\s\S]*?<\/section>/)[0];
  assert.deepEqual([...trend.matchAll(/<button type="button" class="ohgt-chip(?: on)?" data-focus-key="ohg-trend-(\w+)" aria-pressed="(?:true|false)" onclick="ohgSetTrendMetric\('\1'\)" data-tip="([^"]+)">([^<]+)<\/button>/g)].map((x) => [x[1], x[3], x[2]]), [
    ['otd', 'On Time', 'Shipped by the original date.'], ['perfect', 'Perfect Order', 'Shipped complete, on time, never rescheduled.'],
    ['days', 'Avg Days Late', 'Average days late, late deliveries only.'], ['lateOrders', 'Late Orders', 'Orders shipped 1+ days late.'],
    ['orders', 'Orders Shipped', 'Orders shipped in the month.'],
  ]);
  assert.equal((trend.match(/<button\b/g) || []).length, 8, 'the Trend card has the five chips and the three Months choices, nothing else to press');
  assert.match(trend, /<div class="ohgt-chips" role="group" aria-label="Metric">/);
  // (A plain switch choice would pass the check above with no tip, so these are checked by name.)
  assert.match(trend, /<div class="dz-seg sup-seg-sm" role="group" aria-label="Months shown">/);
  assert.deepEqual([...trend.matchAll(/<button type="button" data-focus-key="mwm-range-(\d+)"(?: class="on")? aria-pressed="(?:true|false)" onclick="mwmSetRange\(\1\)" data-tip="([^"]+)">([^<]+)<\/button>/g)].map((x) => [x[1], x[3], x[2]]),
    [['12', '12 months', 'Last 12 months.'], ['6', '6 months', 'Last 6 months.'], ['3', '3 months', 'Last 3 months.']]);
  assert.deepEqual(page.errors, []);

  // The By warehouse and Booked vs shipped tables page too (6 a page): seven warehouses shipped in the report month, on
  // lines first due in seven different months. Every button on Lagging still explains or names itself.
  const WH = ['Spyder - Lacombe', 'CM - Alta', 'CM - Beta', 'CM - DSM', 'CM SFG - Gamma', 'CM SFG - Delta', 'CM - Echo'];
  const wide = loadPage();
  await upload(wide, [{ name: 'kpi.xls', bytes: sapExport(WH.map((w, i) => shipped({ DocumentNumber: String(40 + i), Warehouse: w, ...due(`0${3 + i}/01/2026`), ClosedDate: '09/01/2026', DeliveryDocNumber: String(940 + i) }))) }]);
  wide.run("setTab('weekly');setWeeklyView('lagging')");
  const wideLag = results(wide);
  assert.deepEqual(checkPagers(wideLag, 'Lagging, seven warehouses'), ['ohg-months', 'ohg-wh', 'ohg-orig']);
  for (const [id, label, count] of [['ohg-months', 'Month by month pages', '1–6 of 12 months'], ['ohg-wh', 'By warehouse pages', '1–6 of 7 warehouses'], ['ohg-orig', 'Booked vs shipped pages', '1–6 of 7 months']]) {
    assert.ok(wideLag.includes(`<span class="dz-pagecount">${count}</span><nav class="shp-pager dz-pager print-hide" data-dzpager="${id}" aria-label="${label}" onkeydown="dzPagerKey(event,&quot;${id}&quot;)">`), `${id}: the range and a named pager`);
    assert.deepEqual([...wideLag.matchAll(new RegExp(`<button type="button" class="shp-pg[^"]*" data-focus-key="pg-${id}-[^"]+" aria-label="([^"]+)"`, 'g'))].map((x) => x[1]), ['Previous page', 'Page 1 of 2', 'Page 2 of 2', 'Next page']);
  }
  const wideButtons = [...wideLag.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(wideButtons.filter((t) => !hasTip(t) && !PAGER_BTN.test(t) && !/\srole="menuitem(radio)?"/.test(t) && !/\saria-haspopup="menu"/.test(t)), [], 'Lagging: buttons without a tooltip');
  assert.equal(wideButtons.filter((t) => PAGER_BTN.test(t)).length, 12);
  assert.deepEqual(wide.errors, []);
});

test('tooltips say what a card counts with the numbers written in full ($1,721,806, not $1.72M)', async () => {
  const page = await loadedAll();
  page.run("setTab('weekly')");
  const html = results(page);
  // 2v6 tips are a heading and bullets: what the card is, then its counts and value in full, then the click.
  const atRisk = html.match(/data-focus-key="tile-late"[^>]*data-tip="([^"]+)"/)[1];
  assert.match(atRisk, /^At risk, due by [A-Z][a-z]{2} \d{1,2}\n• \d+ orders?, \d+ lines?\n• \$1,72\d,\d{3} open\nClick to list them\.$/);
  assert.match(html, /data-focus-key="tile-st-nocommit"[^>]*data-tip="No commit\n• 1 order, 1 line\n• \$[\d,]+ open\nClick to list them\."/);
  for (const [, t] of html.matchAll(/data-tip="([^"]+)"/g)) assert.doesNotMatch(t, /\$\d+(\.\d+)?[KM]\b/, `short money in a tip: ${t}`);
  // Sortable headings say what the column is and how sorting works.
  assert.match(html, /class="th-sort" data-focus-key="linked-sort-value" data-col="value" data-tip="Open value; line value if closed\. Click to sort\."/);
  // The warehouse rows (Warehouses to watch, Warehouse Timeline) give the full amounts too.
  page.run("setTab('warehouses')");
  assert.match(results(page), /data-focus-key="sc-Spyder - Lacombe"[^>]*data-tip="Spyder - Lacombe\n• Open \$1,721,806, at risk \$1,721,806\n/);
  for (const [, t] of results(page).matchAll(/data-tip="([^"]+)"/g)) assert.doesNotMatch(t, /\$\d+(\.\d+)?[KM]\b/, `short money in a tip: ${t}`);
  // Column headings of data tables come from one list (COLUMN_TIPS); headings with no entry stay plain.
  assert.equal(page.run("columnTip('sd','Monthly net')"), 'Usable supply minus demand for that month; below zero is short.');
  assert.match(page.run("renderRowsTable(parsedRows.slice(0,1),{key:'t',title:'T'})"), /<th class="num" data-tip="Quantity still to ship\.">Qty open<\/th>/);
  page.run("setTab('buildrisk')");
  assert.match(results(page), /<th class="num">Sep 24<\/th>/);
});

test('tooltips stay short on every page: about 20 words, never a paragraph', async () => {
  const page = await loadedAll();
  let checked = 0;
  eachView(page, (html, view) => {
    for (const mt of html.matchAll(/data-tip="([^"]+)"/g)) {
      const t = mt[1].replace(/&[a-z#0-9]+;/gi, ' ');
      checked++;
      // Prose tips are one short sentence. 2v6 tips may be a heading and a few bullets (one fact a line): then each
      // line is short and there are at most 7 lines. A sparkline's tip lists every period it draws (one short line each).
      const spark = html.slice(html.lastIndexOf('<', mt.index), mt.index).includes('class="dz-spark"');
      if (t.includes('\n')) {
        const lines = t.split('\n');
        assert.ok(lines.length <= (spark ? 16 : 7), `${view}: tip with ${lines.length} lines: ${t}`);
        for (const l of lines) assert.ok(l.trim().split(/\s+/).length <= 20, `${view}: long tip line (${l.trim().split(/\s+/).length} words): ${l}`);
      } else assert.ok(t.split(/\s+/).length <= 30, `${view}: long tip (${t.split(/\s+/).length} words): ${t}`);
    }
  });
  assert.ok(checked > 1000, `checked ${checked} tips`);
});

test('section help sits on the section title (no ⓘ buttons): every text is two short sentences on its title; About these numbers is 3-5 short bullets', async () => {
  const page = await loadedAll();
  const info = page.run('Object.fromEntries(Object.keys(SECTION_INFO).map(k=>[k,{...SECTION_INFO[k],tip:sectionTipText(k)}]))');
  const byTip = new Map(Object.entries(info).map(([k, i]) => [i.tip, k]));
  const unesc = (t) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const sentences = (t) => t.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;
  const keys = new Set();
  eachView(page, (html, view) => {
    // The owner asked for no ⓘ buttons: none is drawn, and no empty title wrapper is left where one sat.
    assert.doesNotMatch(html, /class="info-btn|data-info=|aria-controls="info-pop"|class="title-row"/, `${view}: an ⓘ button is left`);
    for (const [, attrs, inner] of html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/g)) {
      const m = attrs.match(/data-tip="([^"]*)"/);
      const key = m && byTip.get(unesc(m[1]));
      if (!key) continue;
      keys.add(key);
      // The tip sits on a real, visible title. (2v6 renamed many cards, e.g. "Open orders by delivery month", while
      // SECTION_INFO keeps the old names in its title field, which nothing shows; so the heading text is not compared
      // with that field any more.)
      const text = unesc(inner.replace(/<[^>]+>/g, '')).trim();
      assert.ok(text.length > 0, `${view}: ${key} is on an empty heading`);
    }
    // Every page's About block is a short list: 3 to 5 bullets of at most 30 words.
    for (const [about] of html.matchAll(/<details class="about[^"]*"><summary[^>]*>About these numbers<\/summary>[\s\S]*?<\/details>/g)) {
      const items = about.match(/<li>[\s\S]*?<\/li>/g) || [];
      assert.ok(items.length >= 3 && items.length <= 5, `${view}: About has ${items.length} bullets`);
      for (const li of items) assert.ok(li.replace(/<[^>]+>/g, '').split(/\s+/).length <= 30, `${view}: ${li}`);
    }
  });
  for (const [key, i] of Object.entries(info)) {
    // A definition, and a click text only where the click is not obvious (the owner's brevity rule).
    assert.ok(i.title && i.what, `${key} has a definition`);
    // At most two short sentences: what the section shows, what clicking does.
    assert.ok(sentences(i.what) + sentences(i.click || '') <= 2, `${key} is at most two sentences`);
    assert.equal(i.tip, [i.what, i.click].filter(Boolean).join(' '));
    assert.ok(i.tip.split(/\s+/).length <= 30, `${key} is short`);
  }
  // 2v6 pages give many cards a short tip of their own, and some sections left with the old designs (Order Health's
  // At risk / On track groups, the scorecard, the Forecast page when no Logican file is loaded), so fewer titles carry a
  // SECTION_INFO text than before; Metrics' Show more (order quality, by due month, lines to act on) left too (owner).
  assert.ok(keys.size >= 18, `${keys.size} section titles carry their help`);
  // The popover, its script and its styles are gone; the help pointer marks a titled heading with a tip.
  assert.doesNotMatch(HTML, /id="info-pop"|class="info-pop|\.info-btn|\.info-pop|\.title-row|function (infoButton|toggleInfo|openInfo|closeInfo|infoPopKey)\b|INFO_ICON|syncInfoPop|queuePlaceInfo/);
  assert.match(CSS, /\nh2\[data-tip\]\{cursor:help\}\n/);
  assert.equal(page.run("sectionTip('')"), '');
  assert.equal(page.run("sectionTip('no-such-section')"), '');
  assert.equal(page.run("sectionTip('wh-scorecard')"), ' data-tip="Open, at-risk and past-due value and delivery rates per warehouse. Click a row to filter."');
  assert.deepEqual(page.errors, []);
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

// A tiny element tree with the selector forms wireTip uses (tag, [attr], [attr="v"], :not(...), :scope>).
function miniDom() {
  const simple = (el, s) => {
    const m = s.match(/^([a-z0-9]*)((?:\[[^\]]+\])*)(?::not\((\[[^\]]+\])\))?$/i);
    if (!m) throw new Error(`selector ${s}`);
    const attrOk = (a) => { const [, k, v] = a.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/); return v === undefined ? el.hasAttribute(k) : el.getAttribute(k) === v; };
    return (!m[1] || el.tagName === m[1].toUpperCase()) && (m[2].match(/\[[^\]]+\]/g) || []).every(attrOk) && !(m[3] && attrOk(m[3]));
  };
  class El {
    constructor(tag, attrs = {}, text = '', kids = []) { this.tagName = tag.toUpperCase(); this.namespaceURI = 'http://www.w3.org/1999/xhtml'; this.attrs = { ...attrs }; this.own = text; this.kids = []; this.parentElement = null; kids.forEach((k) => this.appendChild(k)); }
    get textContent() { return this.own + this.kids.map((k) => k.textContent).join(''); }
    set textContent(v) { this.own = String(v); this.kids = []; }
    set className(v) { this.attrs.class = v; }
    appendChild(k) { k.parentElement = this; this.kids.push(k); return k; }
    remove() { if (this.parentElement) this.parentElement.kids = this.parentElement.kids.filter((k) => k !== this); this.parentElement = null; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    removeAttribute(k) { delete this.attrs[k]; }
    hasAttribute(k) { return k in this.attrs; }
    matches(sel) { return sel.split(/,(?![^(]*\))/).some((s) => simple(this, s.trim())); }
    closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n; return null; }
    querySelector(sel) {
      if (sel.startsWith(':scope>')) return this.kids.find((k) => k.matches(sel.slice(7))) || null;
      for (const k of this.kids) { if (k.matches(sel)) return k; const f = k.querySelector(sel); if (f) return f; }
      return null;
    }
  }
  return { El, h: (tag, attrs, text, kids) => new El(tag, attrs, text, kids) };
}

test('tipped headings, column headings and static cards become tab stops; table cells, charts and nested tips do not', () => {
  const page = loadPage();
  const { El, h } = miniDom();
  page.ctx.document.createElement = (tag) => new El(tag);
  const th = h('th', { 'data-tip': 'Open sales-order quantity (DemandOpenQty).' }, 'Demand');
  const thSort = h('th', { 'data-tip': 'Sorts the table.' }, '', [h('button', {}, 'Due')]);
  const delta = h('span', { class: 'delta up', 'data-tip': 'Aug: 80% against Jul: 70%.' }, '↑ 10 pts');
  const card = h('div', { class: 'card kpi lag static', 'data-tip': 'On-time receiving, last 3 months: 80%. 4 of 5 receipts.' }, '', [h('span', {}, 'On-time · 3 mo'), delta, h('span', {}, '80%')]);
  const why = h('span', { class: 'oh-why', 'data-tip': 'Cause: Us (SAP: Past due).' }, 'Us · Past due');
  const td = h('td', {}, '', [why]);
  const bar = h('div', { class: 'col-bar', 'data-tip': 'Week of Oct 4: 1 open line · $1,000 due' });
  const seg = h('i', { class: 'pop age-2', 'data-tip': '8–30d past due: $1,722,806 across 2 lines' });
  const tracker = h('div', { class: 'tracker', role: 'img', 'aria-label': 'aging' }, '', [seg]);
  const btn = h('button', { 'data-tip': 'Click to list them.' }, 'At risk');
  const badge = h('span', { class: 'nav-badge', 'data-tip': '4 orders at risk' }, '4');
  const navBtn = h('button', { 'data-tip': 'Order Health. 4 orders at risk.' }, 'Order Health', [badge]);
  const hidden = h('div', { 'aria-hidden': 'true' }, '', [h('div', { class: 'num', 'data-tip': 'Open PO lines.' }, 'Lines')]);
  // All of it inside a table's focusable scroll box (role="region", tabindex 0): that box is not a control, so the
  // tips inside it still get their own tab stops.
  h('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Lines' }, '', [h('table', {}, '', [h('thead', {}, '', [h('tr', {}, '', [th, thSort])]), h('tbody', {}, '', [h('tr', {}, '', [td])])]), card, bar, tracker, btn, navBtn, hidden]);
  // wireTips walks the page in document order: parents before the tips nested in them.
  page.ctx.__els = [th, thSort, card, delta, why, bar, seg, btn, navBtn, badge, hidden.kids[0]];
  page.run('__els.forEach(wireTip)');
  const tab = (el) => [el.getAttribute('tabindex'), el.hasAttribute('data-tip-tab')];
  assert.deepEqual(tab(th), ['0', true], 'a column heading');
  assert.deepEqual(tab(card), ['0', true], 'a static card');
  assert.deepEqual(tab(bar), ['0', true], "a What's due next bar");
  for (const el of [thSort, delta, why, seg, btn, navBtn, badge, hidden.kids[0]]) assert.deepEqual(tab(el), [null, false], el.attrs.class || el.tagName);
  // Screen readers: a column heading is described when focused; a div carries a hidden copy (read in browse mode).
  assert.match(th.getAttribute('aria-describedby'), /^tipd-\d+$/);
  const copy = (el) => el.querySelector(':scope>[data-tip-copy]');
  assert.deepEqual([copy(card).attrs.class, copy(card).textContent], ['sr-only', 'On-time receiving, last 3 months: 80%. 4 of 5 receipts.']);
  assert.equal(card.getAttribute('aria-describedby'), null, 'not read twice');
  assert.equal(copy(bar).textContent, 'Week of Oct 4: 1 open line · $1,000 due');
  assert.equal(copy(th), null);
  // Wiring again changes nothing; a new text updates the copy; no text removes the tab stop and the copy.
  page.run('__els.forEach(wireTip)');
  assert.equal(card.kids.filter((k) => k.hasAttribute('data-tip-copy')).length, 1);
  page.run("tip(__els[2],'On-time receiving: 90%.');0");
  assert.equal(copy(card).textContent, 'On-time receiving: 90%.');
  page.run("tip(__els[2],'');0");
  assert.deepEqual([...tab(card), copy(card)], [null, false, null]);
  // A dense chart series (data-tip-notab: the ship calendar's days) keeps a hidden copy but adds no tab stop.
  const day = h('div', { class: 'day-col', 'data-tip': '2026-10-03: 2 open lines · 40 qty · $1,000' }, '2');
  h('div', { class: 'day-chart', 'data-tip-notab': '' }, '', [day]);
  page.ctx.__day = day;
  page.run('wireTip(__day)');
  assert.deepEqual([day.getAttribute('tabindex'), copy(day) && copy(day).textContent], [null, '2026-10-03: 2 open lines · 40 qty · $1,000']);
  assert.match(HTML, /<div class="day-chart" data-tip-notab /);
  assert.ok(CSS.includes('.sr-only[data-tip-copy]{left:0;top:0}'), 'copies never widen the page');
  assert.ok(CSS.includes('.thead>div:last-of-type,.trow>div:last-of-type{padding-right:24px}'), 'a row\'s copy does not take the last-cell padding');
  // A section title carrying its help (no ⓘ button any more) is a tab stop and is described by its tip.
  const title = h('h2', { class: 'pg-group-title', 'data-tip': 'Open value per warehouse. Click a row to filter.' }, 'By warehouse');
  h('div', { class: 'pg-group-head' }, '', [title]);
  page.ctx.__title = title;
  page.run('wireTip(__title)');
  assert.deepEqual(tab(title), ['0', true], 'a section title');
  assert.match(title.getAttribute('aria-describedby'), /^tipd-\d+$/);
  // An element that sets its own tabindex keeps it.
  const own = h('h2', { 'data-tip': 'x y z', tabindex: '-1' }, 'Title');
  page.ctx.__own = own;
  page.run('wireTip(__own)');
  assert.equal(own.getAttribute('tabindex'), '-1');
  assert.equal(own.hasAttribute('data-tip-tab'), false);
});

test('nested tips reach keyboard users through their control: delta pill text in the card tip', () => {
  const page = loadPage();
  const series = JSON.stringify([{ label: 'Jul', otd: 70 }, { label: 'Aug', otd: 80 }, { label: 'Sep', otd: null }]);
  assert.equal(page.run(`withDeltaText('OTD: 80%; click for late deliveries.',${series},'otd')`), 'OTD: 80% (Aug 80% vs Jul 70%); click for late deliveries.');
  assert.equal(page.run(`withDeltaText('OTD: 80%. Target 90%. Click for late deliveries.',${series},'otd')`), 'OTD: 80%. Target 90% (Aug 80% vs Jul 70%). Click for late deliveries.');
  assert.equal(page.run(`withDeltaText('PO OTD: 80%.',${series},'otd')`), 'PO OTD: 80% (Aug 80% vs Jul 70%).');
  assert.equal(page.run(`withDeltaText('No data.',[{label:'Aug',otd:null}],'otd')`), 'No data.');
  assert.match(page.run(`renderDeltaPill(${series},'otd')`), /data-tip="Aug 80% vs Jul 70%; target 90%\."/);
});

test('tooltip and popover placement: preferred side, flips when there is no room, stays inside the window', () => {
  const page = loadPage();
  page.ctx.innerWidth = 1000; page.ctx.innerHeight = 700;
  const box = (h = 60) => ({ offsetWidth: 300, offsetHeight: h, dataset: {}, vars: {}, style: { setProperty(k, v) { this.owner.vars[k] = v; } } });
  const place = (rect, want, align, h) => {
    const b = box(h); b.style.owner = b;
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
  // A tall popover with room on neither side (an ⓘ low on a phone) stays inside the window instead of running off
  // the bottom, where it could not be scrolled into view.
  const tall = place({ left: 20, top: 369, width: 20, height: 20 }, 'bottom', 'start', 395);
  assert.deepEqual([tall.side, tall.top], ['bottom', 700 - 8 - 395]);
});

// A fake tooltip rig for the document listeners: a body, the #tip-layer, tipped controls (optionally in a dialog).
function tipRig(page) {
  const node = (props) => ({ parentNode: null, kids: [], appendChild(k) { if (k.parentNode) k.parentNode.kids = k.parentNode.kids.filter((x) => x !== k); k.parentNode = this; this.kids.push(k); return k; }, ...props });
  const doc = page.ctx.document;
  const body = node({ tagName: 'BODY' });
  doc.body = body;
  const text = { textContent: '' };
  const classes = new Set();
  const layer = node({ id: 'tip-layer', tagName: 'DIV', hidden: true, offsetWidth: 200, offsetHeight: 40, dataset: {}, style: { setProperty() {} }, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, querySelector: () => text });
  body.appendChild(layer);
  page.els['tip-layer'] = layer;
  page.ctx.innerWidth = 1200; page.ctx.innerHeight = 800;
  const control = (tip, dialog = null) => {
    const el = node({ tagName: 'BUTTON', isConnected: true, attrs: tip ? { 'data-tip': tip } : {} });
    Object.assign(el, {
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      closest(sel) { if (sel === '[data-tip]') return tip ? this : null; if (sel === 'dialog[open]') return dialog; return null; },
      contains(x) { return x === this; },
      matches: (sel) => sel === ':focus-visible',
      getBoundingClientRect: () => ({ left: 100, top: 200, right: 180, bottom: 230, width: 80, height: 30 }),
    });
    (dialog || body).appendChild(el);
    return el;
  };
  const focus = (from, to) => {
    doc.activeElement = to;
    if (from) page.dispatch('focusout', { target: from, relatedTarget: to });
    if (to) page.dispatch('focusin', { target: to });
  };
  return { body, layer, text, control, focus, node, doc };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a tip written as heading and bullets shows one line each; its text reads exactly as the data-tip', () => {
  // The bubble keeps line breaks (pre-line), a bullet's wrapped words hang under its text.
  assert.match(CSS, /\.tip-layer\{[^}]*white-space:pre-line/);
  assert.match(CSS, /\.tip-text \.tip-li\{padding-left:\.85em;text-indent:-\.85em\}/);
  const page = loadPage();
  const mk = (tag) => ({ tagName: tag, className: '', textContent: '', kids: [], appendChild(k) { this.kids.push(k); return k; } });
  page.ctx.document.createElement = mk;
  page.ctx.document.createTextNode = (t) => ({ text: t });
  const read = (n) => (n.kids.length ? n.kids.map((k) => (k.text !== undefined ? k.text : read(k))).join('') : n.textContent);
  const box = mk('SPAN');
  const text = 'Open orders: 12\n• 3 past due\n• 2 with no commit date';
  page.ctx.tipFill(box, text);
  assert.deepEqual(box.kids.map((k) => k.className), ['tip-line tip-head', 'tip-li', 'tip-li']);
  assert.equal(read(box), text, 'the bubble text equals the tip (newlines kept)');
  assert.equal(box.kids[1].kids[0].className, 'tip-dot');
  // A one-line tip stays plain text.
  const one = mk('SPAN');
  page.ctx.tipFill(one, 'Click to sort by Value.');
  assert.equal(one.textContent, 'Click to sort by Value.');
  assert.equal(one.kids.length, 0);
  // tipAttr keeps the line breaks in the attribute.
  assert.equal(page.ctx.tipAttr('A\n• b'), ' data-tip="A\n• b"');
});

test('short tips: the gear lists two kinds of Data check issue as bullets; bulleted section help keeps its click line apart', () => {
  const page = loadPage();
  assert.equal(page.ctx.hdrGearTip(''), 'Settings');
  assert.equal(page.ctx.hdrGearTip('1 row or file needs attention'), 'Settings · Data check: 1 row or file needs attention.');
  assert.equal(page.ctx.hdrGearTip('2 rows or files need attention, 3 items to review'), 'Settings · Data check\n• 2 rows or files need attention\n• 3 items to review');
  page.run(`SECTION_INFO['t3-a']={what:'Open lines\\n• 3 late',click:'Click to list them.'};SECTION_INFO['t3-b']={what:'Open lines.',click:'Click to list them.'}`);
  assert.equal(page.ctx.sectionTipText('t3-a'), 'Open lines\n• 3 late\nClick to list them.');
  assert.equal(page.ctx.sectionTipText('t3-b'), 'Open lines. Click to list them.');
});

test('a tip queued on focus is dropped when focus moves on before it shows (no stray bubble, no swallowed Esc)', async () => {
  const page = loadPage();
  const rig = tipRig(page);
  const noteBtn = rig.control('Set an override status or write a note on this line.');
  const box = rig.control('');
  const sortBtn = rig.control('Click to sort by Value.');
  // Add note -> focus goes back to the button (tip queued), then on to the note box within the 200 ms wait.
  rig.focus(null, noteBtn);
  rig.focus(noteBtn, box);
  await wait(300);
  assert.equal(rig.layer.hidden, true, 'the button\'s tip never pops up beside the note box');
  // Esc then goes to whatever has focus (the dialog, the drawer): nothing swallows it.
  assert.equal(page.dispatch('keydown', { key: 'Escape' }).defaultPrevented, false);
  // Focus that leaves without a new focus target (a redraw, another window) cancels the wait too.
  rig.focus(null, sortBtn);
  page.dispatch('focusout', { target: sortBtn, relatedTarget: null });
  rig.doc.activeElement = rig.body;
  await wait(300);
  assert.equal(rig.layer.hidden, true);
  // A queued tip whose element lost focus without any event (focus moved by script) does not show either.
  rig.focus(null, sortBtn);
  rig.doc.activeElement = box;
  await wait(300);
  assert.equal(rig.layer.hidden, true);
  // Staying on the control shows its tip; Esc then hides only the tip.
  rig.focus(null, sortBtn);
  await wait(300);
  assert.deepEqual([rig.layer.hidden, rig.text.textContent, page.run('tipState.el===document.activeElement')], [false, 'Click to sort by Value.', true]);
  const esc = page.dispatch('keydown', { key: 'Escape' });
  assert.deepEqual([esc.defaultPrevented, rig.layer.hidden], [true, true]);
  // Typing in a tipped box hides its tip.
  rig.focus(null, box);
  box.attrs['data-tip'] = 'A short note.';
  box.closest = (sel) => (sel === '[data-tip]' ? box : null);
  rig.focus(null, box);
  await wait(300);
  assert.equal(rig.layer.hidden, false);
  page.dispatch('input', { target: box });
  assert.equal(rig.layer.hidden, true);
});

test('focus never pops a tip over a text box or a checkbox (a text box is :focus-visible on every click); hover still does', async () => {
  const page = loadPage();
  const rig = tipRig(page);
  const hoverable = (el, tag, type) => Object.assign(el, { tagName: tag, type, hovered: false, matches(sel) { return sel === ':focus-visible' || (sel === ':hover' && this.hovered); } });
  // Ask AI puts focus back in its question box after Send: no bubble repeating the placeholder.
  const box = hoverable(rig.control('Shift+Enter starts a new line.'), 'TEXTAREA');
  rig.focus(null, box);
  await wait(300);
  assert.equal(rig.layer.hidden, true);
  // The consent checkbox (its tip is on the label) and plain text boxes behave the same.
  for (const [tag, type] of [['INPUT', 'checkbox'], ['INPUT', 'text'], ['INPUT', 'search'], ['INPUT', 'date'], ['INPUT', undefined]]) {
    const el = hoverable(rig.control('A tip.'), tag, type);
    rig.focus(null, el);
    await wait(300);
    assert.equal(rig.layer.hidden, true, `${tag} ${type}`);
  }
  assert.equal(page.run("tipFocusVisible({tagName:'INPUT',type:'checkbox',matches:()=>true})"), false);
  assert.equal(page.run("tipFocusVisible({tagName:'INPUT',type:'button',matches:()=>true})"), true);
  assert.equal(page.run("tipFocusVisible({tagName:'BUTTON',matches:()=>true})"), true);
  // Keyboard focus on a button still shows its tip; hovering the text box shows the box's tip.
  const send = rig.control('Send.');
  rig.focus(null, send);
  await wait(300);
  assert.deepEqual([rig.layer.hidden, rig.text.textContent], [false, 'Send.']);
  page.run('hideTip()');
  rig.doc.activeElement = rig.body;
  box.hovered = true;
  page.dispatch('pointerover', { target: box, pointerType: 'mouse' });
  await wait(300);
  assert.deepEqual([rig.layer.hidden, rig.text.textContent], [false, 'Shift+Enter starts a new line.']);
});

test('a tip for a control in the modal Your name dialog is drawn inside the dialog (top layer); one Esc closes both', async () => {
  const page = loadPage();
  const rig = tipRig(page);
  const dialog = rig.node({ tagName: 'DIALOG' });
  rig.body.appendChild(dialog);
  const save = rig.control('Save this name for your notes.', dialog);
  rig.focus(null, save);
  await wait(300);
  assert.equal(rig.layer.hidden, false);
  assert.equal(rig.layer.parentNode, dialog, 'the layer joins the dialog in the top layer, so it shows above the backdrop');
  // Esc hides the tip and still reaches the dialog (no preventDefault), so the dialog closes on the first press.
  const esc = page.dispatch('keydown', { key: 'Escape' });
  assert.deepEqual([esc.defaultPrevented, rig.layer.hidden, rig.layer.parentNode === rig.body], [false, true, true]);
  // A tip outside any dialog goes back to the body as well.
  const pageBtn = rig.control('Page button.');
  rig.focus(save, pageBtn);
  await wait(300);
  assert.equal(rig.layer.parentNode, rig.body);
  // Closing the dialog sends the layer home before the dialog is removed (else every later tip is gone with it).
  assert.match(HTML, /d\.addEventListener\('close',\(\)=>\{[^}]*?hideTip\(\);[\s\S]*?d\.remove\(\);/);
  assert.match(HTML, /<input id="editor-name"[^\n]*\$\{tipAttr\(any\?'Not in the list\? Type your name\.':'Type your name\.'\)\}>/);
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
  assert.equal(toast(), 'Deleted 3 lines. Restore them from Settings → Data check.'); // 2v7: Data check moved into Settings
  page.run('restoreDeletedLines()');
  assert.equal(toast(), 'Restored 3 lines.');
  const key = page.run('rowKey(parsedRows[0])');
  page.run(`toggleRowNote(${JSON.stringify(key)});updateRowOverride(${JSON.stringify(key)},'notes','Called the CM');toggleRowNote(${JSON.stringify(key)})`);
  assert.equal(toast(), 'Note saved.');
  page.run("showToast('<b>escaped</b>')");
  assert.match(page.els.toast.innerHTML, /<span>&lt;b&gt;escaped&lt;\/b&gt;<\/span>/);
});

// The first-visit hint banners (load screen, Order Health, Shipping) and Show hints again were removed on purpose
// (9ce2078); nothing is drawn or stored for them any more.
test('first-visit hints are gone: no hint card on the load screen or any page, no Show hints again, nothing stored', async () => {
  const page = loadPage();
  page.run('renderSidebar();renderUploadState()');
  assert.equal(page.els['upload-hint'], undefined, 'the load screen never fills a hint box');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(MIX) }]);
  for (const tab of ['weekly', 'shipping', 'purchaseorders']) {
    page.run(`setTab(${JSON.stringify(tab)})`);
    assert.doesNotMatch(results(page) + sidebar(page), /hint-card|data-hint=|hints-reset|Show hints again/, tab);
  }
  for (const fn of ['renderHint', 'dismissHint', 'resetHints']) assert.equal(page.run(`typeof ${fn}`), 'undefined', fn);
  assert.equal(page.storage.spyderKpiHints, undefined);
});

// Leading, Version 1 (four questions): the controls that layout added, by name. (The general checks above would pass a
// plain switch choice with no tip, and would not notice a control that is no longer drawn.)
test('Leading\'s new controls each carry a tip: the Status cells, the customer table\'s headings and numbers, the What can we do switch and the two month folds', async () => {
  const page = await loadedAll();
  page.run("weeklyTileFilter='late';weeklyView='leading';ohlDoView='pull';setTab('weekly')");
  const m = results(page);
  const tips = (re) => [...m.matchAll(re)].map((x) => x.slice(1));
  // Status: five cells (5 open orders: 1, 2 and 3 at risk, 4 due next week, 5 on track).
  assert.deepEqual(tips(/<button type="button" class="ohs3-cell[^"]*" data-focus-key="status-st-(\w+)" aria-pressed="false" onclick="[^"]+" data-tip="([^"\n]+)\n• (\d+ orders?, \d+ lines?)\n[^"]{20,}">/g),
    [['ontrack', 'On track', '2 orders, 2 lines'], ['duethisweek', 'Due this week', '0 orders, 0 lines'], ['rescheduled', 'Rescheduled', '1 order, 1 line'], ['pastdue', 'Past due', '1 order, 1 line'], ['nocommit', 'No commit', '1 order, 1 line']]);
  // Customers at risk, with supply data loaded: every heading cell has a tip (the group row, the nine columns, the All
  // Customers row) or holds the customer's tipped button.
  const who = m.match(/<table class="ohc2-tbl ohc3-tbl src">[\s\S]*?<\/table>/)[0];
  const ths = [...who.matchAll(/(<th\b[^>]*>)([\s\S]*?)<\/th>/g)].map((x) => [x[2].replace(/<[^>]*>/g, '').trim(), hasTip(x[1]) || /^<button [^>]*\sdata-tip="[^"]{20,}"/.test(x[2])]);
  assert.deepEqual(ths.map((x) => x[0]), ['Open orders', 'At-risk orders by supply source', 'Customer', 'Past due', 'At risk', 'Open', 'Pull in', 'Late / no commit', 'Stock short', 'Not supply', 'Split', 'FIREFLY - Firefly RV', 'All Customers']);
  assert.deepEqual(ths.filter((x) => !x[1]), []);
  assert.match(who, /<th scope="row" data-tip="Every customer together\. An order counts once, so these can be less than the rows added up\.">All Customers<\/th>/);
  // Its numbers: a tip in full and a name for a screen reader (the digit alone says nothing).
  assert.deepEqual(tips(/<button type="button" class="ohc3-n[^"]*" data-focus-key="(ohl-sup-[^"]+)"(?: data-off="[^"]+")? aria-pressed="false" aria-label="([^"]+)" onclick="[^"]+" data-tip="[^"]{20,}">\d+<\/button>/g), [
    ['ohl-sup-FIREFLY-pull', 'FIREFLY - Firefly RV, Pull in: 1 order'], ['ohl-sup-FIREFLY-po', 'FIREFLY - Firefly RV, Late / no commit: 1 order'], ['ohl-sup-FIREFLY-none', 'FIREFLY - Firefly RV, Not supply: 1 order'],
    ['ohl-sup-src-pull', 'All Customers, Pull in: 1 order'], ['ohl-sup-src-po', 'All Customers, Late / no commit: 1 order'], ['ohl-sup-src-none', 'All Customers, Not supply: 1 order']]);
  assert.match(m, /data-focus-key="ohl-sup-FIREFLY-pull"[^>]*data-tip="Pull in: 1 order, 1 line\n• SO 1 SPY-100: PO 701 ACME - Acme Parts: due Sep 30, needed by Aug 10 \(51d\)\nClick to list them\."/);
  // What can we do: a named switch of two choices, each with a tip; the PO button gives its value in full.
  assert.match(m, /<div class="dz-seg sup-seg-sm" role="group" aria-label="What we can do"><button type="button" data-focus-key="ohl-do-pull" class="on" aria-pressed="true" onclick="ohlSetDoView\(&#39;pull&#39;\)" data-tip="PO lines to ask for earlier\.">Supply to pull in · 1<\/button><button type="button" data-focus-key="ohl-do-dates" aria-pressed="false" onclick="ohlSetDoView\(&#39;dates&#39;\)" data-tip="Customers whose dates moved later\.">Date changes · 1 line<\/button><\/div>/);
  assert.match(m, /<button type="button" class="ohl-pull-po"[^>]*data-tip="PO 701: pull in 51 days\n• 1 at-risk order · \$1,721,806\n• Due Sep 30, needed by Aug 10\nClick to list those lines\.">PO 701<\/button>/);
  page.run("ohlSetDoView('dates')");
  assert.match(results(page), /<button type="button" class="dz-tr ohl-dc-row" data-focus-key="dc-FIREFLY"[^>]*data-tip="FIREFLY - Firefly RV\n• 1 line, \$[\d,]+ moved later\n• Worst: SO 3 SPY-100 due Aug 25, now Sep 20 \(SAP\)\nClick to filter to it\.">/);
  // The Lists card: each fold's summary is a native control with its own tip.
  assert.deepEqual(tips(/<details class="ohl-fold" data-more="[^"]+" ontoggle="ohlFoldToggle\(this\)"><summary data-focus-key="(more-ohl-fold-\w+)" data-tip="([^"]+)">/g),
    [['more-ohl-fold-months', 'Shipped and open value per month, against last year.'], ['more-ohl-fold-items', 'Open lines by original delivery month, oldest first.']]);
  assert.deepEqual(page.errors, []);
});

// 2v6 tables tip the headings that need it and leave a plain, self-explanatory name plain (Item, Customers, Lines, ...).
// Build Risk's Clear To Build table is held to its old tips (COLUMN_TIPS has br-ctb texts for its Month, At risk, Late
// and Notes): only CM is plain there.
const PLAIN_HEADINGS = new Set(['Reason', 'At risk', 'Lines', 'Orders', 'Vendor / CM', 'Item', 'Customers', 'CM', 'Past due', 'Item group']);
// Column headings without a tip (and not a plain name or a report week) on every page, as "page :: heading".
function bareHeadings(page) {
  let checked = 0;
  const seen = new Set();
  const bare = new Set();
  eachView(page, (html, view) => {
    for (const [, tag, inner] of html.matchAll(/(<th\b[^>]*>)([\s\S]*?)<\/th>/g)) {
      // (A sort button's arrow glyph is not part of the heading's name.)
      const text = inner.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/[↕↑↓]/g, '').trim();
      if (!text) continue;
      checked++;
      seen.add(text);
      if (hasTip(tag) || /\sdata-tip="[^"]+"/.test(inner)) continue;
      // Clear To Build report weeks ("Sep 24") are dates, not columns that need explaining.
      if (/^[A-Z][a-z]{2} \d{1,2}$/.test(text)) continue;
      if (PLAIN_HEADINGS.has(text) && (!view.startsWith('buildrisk') || text === 'CM')) continue;
      bare.add(`${view.split(' ')[0]} :: ${text}`);
    }
  });
  return { checked, seen, bare: [...bare] };
}
// The Build Risk Clear To Build table lost its column tips in the 2v6 redesign (see the KNOWN GAP test below).
const brGap = (b) => b.startsWith('buildrisk :: ');

test('every column heading on every page explains itself (its own tip or a tipped sort button); report-week columns stay plain', async () => {
  const page = await loadedAll();
  const { checked, seen, bare } = bareHeadings(page);
  assert.deepEqual(bare.filter((b) => !brGap(b)), [], 'column headings without a tooltip');
  assert.ok(checked > 150, `checked ${checked} headings`);
  for (const h of ['Doc #', 'SO #', 'PO #', 'Customer / vendor', 'Warehouse', 'Item / description', 'Month', 'Type']) assert.ok(seen.has(h), `${h} was drawn and checked`);
  // Headings that mean something else in one table use that table's text.
  assert.equal(page.run("columnTip('metrics-timeline','Month')"), 'Effective due month: the reschedule date, else the due date.');
  assert.match(page.run("columnTip('br-ctb','Month')"), /Clear To Build report row/);
  assert.match(page.run("columnTip('anything','Month')"), /Demand month \(YearMonth\)/);
  assert.deepEqual(page.errors, []);
});

// KNOWN GAP (left failing on purpose): the 2v6 Build Risk "Clear To Build by CM / month" table draws its headings
// plain (supTableCard), so Month, Total, Clear to build, At risk, Late, Matched SO lines, Matched open qty, Matched open
// value and Notes have no tip, although COLUMN_TIPS still holds the br-ctb texts for them (columnTip('br-ctb', ...))
// that nothing uses now.
test('KNOWN GAP: Build Risk Clear To Build table headings explain themselves (they lost their tips in 2v6)', async () => {
  const page = await loadedAll();
  assert.deepEqual(bareHeadings(page).bare.filter(brGap), []);
});

// The hints that explained Leading / Lagging and where Shipping's tracking numbers come from are gone; the tabs say what
// they are in their own tips, and Shipping says where its numbers come from on the page.
test('the Order Health tabs say what they are, and Shipping says where its tracking numbers come from', async () => {
  const page = await loadedAll();
  page.run("setTab('weekly')");
  const tabTip = (id) => (results(page).match(new RegExp(`<button type="button" role="tab" id="oh-tab-${id}"[^>]*data-tip="([^"]+)"`)) || [])[1];
  assert.equal(tabTip('leading'), 'What is at risk now, and why.');
  assert.equal(tabTip('lagging'), 'Last month and quarter, then metrics by month.');
  for (const id of ['leading', 'lagging', 'supply']) {
    const text = tabTip(id) || '';
    assert.ok(text && text.split(/\s+/).length <= 12 && !/[.!?]\s+\S/.test(text.trim()), `${id}: one short sentence: ${text}`);
  }
  page.run("setTab('shipping')");
  assert.match(results(page), /<p class="shp-note">This export has no TrackingNumber column; run the updated KPI query in SAP, or add numbers by hand with Add tracking #\.<\/p>/);
  assert.deepEqual(page.errors, []);
});

// 2v6: the sidebar became the header and the load screen no longer lists the pages (nor badges a link); each visible
// page's header link (or Supply menu item) carries its one-line description, and a hidden page leaves the header.
test('page descriptions: the tooltip of each page link in the header; hidden pages leave the header', async () => {
  const page = loadPage();
  page.run('renderSidebar();renderUploadState()');
  const descs = page.run('PAGE_TIPS');
  for (const [id, text] of Object.entries(descs)) assert.ok(text.split(/\s+/).length <= 8, `${id}: a few words`);
  await upload(page, [{ name: 'e.xls', bytes: sapExport(MIX) }]);
  page.run("stgSet('hiddenPages',[]);renderSidebar()");
  const linked = page.run("NAV_GROUPS.flatMap(g=>g[1]).map(i=>i[0]).filter(id=>id in PAGE_TIPS)");
  assert.ok(linked.length >= 6, linked.join());
  for (const id of linked) {
    assert.match(sidebar(page), new RegExp(`data-focus-key="nav-${id}"[^>]*data-tip="${page.run(`esc(PAGE_TIPS[${JSON.stringify(id)}])`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), id);
  }
  assert.match(sidebar(page), /data-focus-key="nav-weekly" onclick="setTab\('weekly'\)" aria-current="page" data-tip="At-risk orders and on-time delivery\."/);
  assert.doesNotMatch(sidebar(page), /nav-desc|nav-badge/);
  // Monthly is hidden by default (its sections are on Lagging): no header link for it.
  page.run("stgSet('hiddenPages',['monthly']);renderSidebar()");
  assert.doesNotMatch(sidebar(page), /data-focus-key="nav-monthly"/);
  assert.match(sidebar(page), /data-focus-key="nav-warehouses"/);
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
// 2v6: the scorecard left Order Health and became "Warehouses to watch" on the Warehouse Timeline page (hidden by default,
// so the test shows it). Its groups come from the same warehouseScorecardData / scorecardGroups as before.
async function scorecardPage(rows = SC_ROWS) {
  const page = loadPage();
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  page.run("stgSet('hiddenPages',[]);setTab('warehouses')");
  return page;
}
const watchCard = (page) => { const h = results(page); const i = h.indexOf('>Warehouses to watch</h2>'); return i < 0 ? '' : h.slice(h.lastIndexOf('<section', i), h.indexOf('</section>', i)); };
const watchGroups = (page) => page.run('scorecardGroups(warehouseScorecardData(currentMetrics(),mwmFiltered()))');

test('warehouse scorecard: CM SFG and all other warehouses in one card, each with a header and a subtotal that adds up', async () => {
  const page = await scorecardPage();
  const card = watchCard(page);
  assert.ok(card, 'Warehouses to watch is drawn');
  // The other warehouses first, then CM SFG (2v6 order), each under its heading.
  assert.deepEqual([...card.matchAll(/<div class="mwm-ghead" role="heading" aria-level="3">([^<]+)<span>([^<]+)<\/span>/g)].map((m) => m.slice(1)),
    [['Spyder and CM warehouses', '3 warehouses'], ['CM SFG', '2 warehouses']]);
  // Rows sit under their group header; clicking a row still focuses the page on it.
  const sfgPart = card.split('>CM SFG<span>')[1];
  assert.deepEqual([...sfgPart.matchAll(/data-wh="([^"]+)"/g)].map((m) => m[1]).sort(), ['CM SFG - Delta', 'CM SFG - Gamma']);
  assert.equal((card.match(/onclick="setWeeklyScorecardWarehouse\(this\.dataset\.wh\)"/g) || []).length, 5);
  const groups = watchGroups(page);
  for (const g of groups) {
    const sum = (k) => g.rows.reduce((s, r) => s + r[k], 0);
    assert.equal(g.subtotal.openAmt, sum('openAmt'));
    assert.equal(g.subtotal.riskAmt, sum('riskAmt'));
    assert.equal(g.subtotal.pastDue, sum('pastDue'));
  }
  // The subtotals match the open lines themselves, and OTD is scored over the group's deliveries (1 of 2 on time).
  const sfg = groups.find((g) => g.id === 'sfg');
  const other = groups.find((g) => g.id === 'other');
  assert.equal(sfg.subtotal.openAmt, 7000);
  assert.equal(other.subtotal.openAmt, 56000);
  assert.equal(sfg.subtotal.openAmt + other.subtotal.openAmt, page.run('rowOpenAmount(orderHealthData(currentMetrics()).allOrderRows)'));
  assert.equal(sfg.subtotal.riskAmt, 5000);
  assert.equal(sfg.subtotal.pastDue, 2);
  assert.deepEqual([sfg.subtotal.otdN, sfg.subtotal.otdRate], [2, 50]);
  assert.deepEqual([other.subtotal.otdN, other.subtotal.otdRate], [1, 100]);
  // The subtotal row shows and tells the same numbers (full amounts in its tip and its name for screen readers).
  assert.match(card, /<div class="dz-tr mwm-sub" role="group" aria-label="CM SFG subtotal \(2 warehouses\); Open \$7,000, at risk \$5,000; 2 lines past due; OTD 3 mo 50%" data-tip="CM SFG subtotal \(2 warehouses\)\n• Open \$7,000, at risk \$5,000\n• 2 lines past due\n• OTD 3 mo 50%">/);
  assert.match(card, /aria-label="Spyder and CM warehouses subtotal \(3 warehouses\); Open \$56,000, at risk \$40,000; 1 line past due; OTD 3 mo 100%"/);
  assert.ok(sfgPart.indexOf('mwm-sub') > sfgPart.lastIndexOf('data-wh='), 'the subtotal closes its group');
  assert.deepEqual(page.errors, []);
});

test('warehouse scorecard: 10 warehouses a page, the group heading repeats on the next page, a group with no warehouses is left out', async () => {
  const rows = [
    sapRow({ DocumentNumber: '1', Warehouse: 'CM SFG - A', ...due('08/10/2026') }),
    sapRow({ DocumentNumber: '2', Warehouse: 'CM SFG - B', ...due('08/10/2026') }),
    ...Array.from({ length: 11 }, (_, i) => sapRow({ DocumentNumber: String(100 + i), Warehouse: `CM - W${String(i).padStart(2, '0')}`, AmountLocal: String(1000 + i), ...due('08/10/2026') })),
  ];
  const page = await scorecardPage(rows);
  const card = () => watchCard(page);
  const rowsShown = () => (card().match(/class="dz-tr mwm-wrow(?: sel)?" data-focus-key="sc-/g) || []).length;
  const heads = () => [...card().matchAll(/<div class="mwm-ghead"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.equal(rowsShown(), 10);
  assert.deepEqual(heads(), ['Spyder and CM warehouses']);
  assert.match(card(), /<span class="dz-pagecount">1–10 of 13 warehouses<\/span><nav class="shp-pager dz-pager print-hide" data-dzpager="mwm-watch"/);
  assert.doesNotMatch(card(), /scorecard-all|Show top 9|Show all/);
  // Page 2: the rest of the other group under its heading again, its subtotal (the whole group, not the page), then CM SFG.
  page.run('dzGoPage("mwm-watch",2)');
  assert.equal(rowsShown(), 3);
  assert.deepEqual(heads(), ['Spyder and CM warehouses', 'CM SFG']);
  assert.match(card(), /11–13 of 13 warehouses/);
  assert.match(card(), /aria-label="Spyder and CM warehouses subtotal \(11 warehouses\); Open \$11,055,/);
  // Print lists every warehouse.
  page.run('printMode=true;renderResults()');
  assert.equal(rowsShown(), 13);
  page.run('printMode=false;renderResults()');
  const noSfg = await scorecardPage(SC_ROWS.filter((r) => !/SFG/.test(r.Warehouse)));
  assert.deepEqual([...watchCard(noSfg).matchAll(/<div class="mwm-ghead"[^>]*>([^<]+)</g)].map((m) => m[1]), ['Spyder and CM warehouses']);
});

test('wide tables and the ship calendar scroll from the keyboard: every scroll box is a named region with tabindex 0', async () => {
  const page = await loadedAll();
  let boxes = 0;
  eachView(page, (html, view) => {
    for (const [tag] of html.matchAll(/<div class="table-scroll"[^>]*>/g)) {
      boxes++;
      assert.match(tag, /^<div class="table-scroll" tabindex="0" role="region" aria-label="[^"<>]+">$/, `${view}: ${tag}`);
    }
    // The 2v6 supply-style tables scroll the same way; a heat map whose cells with a value are Tab stops needs no stop
    // of its own (focus scrolls it).
    for (const [tag] of html.matchAll(/<div class="sup-scroll[^"]*"[^>]*>/g)) {
      boxes++;
      if (/class="sup-scroll sup-heat"/.test(tag)) continue;
      assert.match(tag, /^<div class="sup-scroll" tabindex="0" role="region" aria-label="[^"<>]+">$/, `${view}: ${tag}`);
    }
  });
  assert.ok(boxes >= 15, `${boxes} table scroll boxes`);
  assert.match(HTML, /class="sup-heat-c" style="background:\$\{bg\};color:\$\{fg\}" data-tip="\$\{esc\(tp\)\}"\$\{n\?' tabindex="0"':''\}/);
  // The Monthly delivery summary sits in the Open orders by delivery month fold of the Lists card on Sales Order Health >
  // Leading now (2v9; Monthly is hidden by default).
  page.run("weeklyTileFilter='late';setTab('weekly');setWeeklyView('leading')");
  assert.match(results(page), /<div class="table-scroll" tabindex="0" role="region" aria-label="Monthly delivery summary · \d{4}"><table class="data-table"/);
  page.run("setTab('monthly')");
  assert.match(results(page), /<div class="table-scroll" tabindex="0" role="region" aria-label="Shipped by warehouse \/ CM · this month">/);
  // The ship calendar scrolls the same way; its day columns add no tab stops of their own (data-tip-notab).
  assert.match(HTML, /<div class="table-scroll" tabindex="0" role="region" aria-label="Open ship calendar, one column per day"><div class="day-chart" data-tip-notab /);
});

// KNOWN BUG (left failing on purpose): the Warehouse Timeline "Late orders by week" / "On-time delivery by week" heat
// map scrolls sideways (min-width = name column + weeks x 40px; 26 weeks or a phone overflows the card), but its scroll
// box (.mwm-scroll) is not a Tab stop and its week cells are data-tip-notab with no tabindex, so a keyboard user can
// neither scroll to the later weeks nor read a cell's tip. The other heat maps make their cells with a value Tab stops.
test('KNOWN BUG: the Warehouse Timeline week heat map cannot be scrolled or read from the keyboard', async () => {
  const page = await loadedAll();
  page.run("setTab('warehouses');mwmSetWeeks(26)");
  const html = results(page);
  const box = (html.match(/<div class="mwm-scroll"[^>]*>/) || [])[0];
  assert.ok(box, 'the week heat map is drawn');
  const cells = [...html.matchAll(/<span class="mwm-heat-cell"[^>]*>/g)].map((m) => m[0]);
  assert.ok(cells.length > 0);
  const boxIsStop = /tabindex="0"/.test(box) && /role="region"/.test(box) && /aria-label="/.test(box);
  const cellsAreStops = cells.some((c) => /tabindex="0"/.test(c));
  assert.ok(boxIsStop || cellsAreStops, `keyboard users cannot scroll or read the heat map: ${box}`);
});

test('Windows high contrast: picked tabs and rows, the shipment strip and the waffle keep their meaning', () => {
  // The 2v6 foundation block: the picked segment (the Leading / Lagging tabs are a dz-seg now), the current header link,
  // the picked menu item and a set filter pill keep a system-colour mark.
  const dzAt = CSS.indexOf('@media (forced-colors:active){\n  .dz-seg button.on');
  const dz = CSS.slice(dzAt);
  assert.match(dz, /^@media \(forced-colors:active\)\{\n  \.dz-seg button\.on\{border:2px solid Highlight\}\n  \.dz-seg button\{border:2px solid Canvas\}\n  \.hdr-link\.active::after\{background:Highlight\}\n  \.dz-menu-item\.sel\{border:1px solid Highlight\}\n  \.dz-filter\.set\{border-color:Highlight\}\n  \.dz-barrow-fill,\.dz-prog-fill,\.dz-chip\{forced-color-adjust:none\}/);
  // After the page's own rules for the same elements, so the system colours win.
  assert.ok(CSS.indexOf('.dz-seg button.on{') < dzAt);
  // The older block still marks picked segmented buttons, waffle and bar rows, the cause pick and the shipment strip.
  const fcAt = CSS.indexOf('@media (forced-colors:active){\n  .segmented button');
  const fc = CSS.slice(fcAt);
  assert.ok(CSS.indexOf('.ship-step.exception>i{') < fcAt);
  assert.match(fc, /\.segmented button\.active,\.segmented button\.pick,\.waffle-row\.selected,\.oh-bar-row\.selected\{border-color:Highlight\}/);
  assert.match(fc, /\.oh-cause-btn\.selected\{border:2px solid Highlight;/);
  assert.match(fc, /\.ship-step>i,\.ship-step::before\{forced-color-adjust:none\}/);
  assert.match(fc, /\.ship-step\.done>i\{background:Highlight;border-color:Highlight\}/);
  assert.match(fc, /\.ship-step\.current>i\{background:Canvas;border-color:Highlight;outline:2px solid Highlight;/);
  assert.match(fc, /\.waffle>i,\.split-bar>i,\.oh-bar-track>i,\.legend \.sw\{forced-color-adjust:none\}/);
  assert.match(CSS, /@media \(forced-colors:active\)\{\.tip-layer,\.toast-item\{border:1px solid CanvasText\}\}/);
});

test('Top offenders: four choices fit a phone card; the waffle blocks stand out from the card (3:1)', () => {
  const phone = CSS.match(/@media \(max-width:640px\)\{\n  \.grid-lead[\s\S]*?\n\}/)[0];
  assert.match(phone, /\.segmented\.full\{max-width:100%;overflow-x:auto;scrollbar-width:none\}/);
  assert.match(phone, /\.segmented\.full button\{padding:4px 6px;font-size:12px\}/);
  // Them blocks use the dark pink (5.9:1 on white); Not set blocks get a grey edge; the legend matches the blocks.
  assert.match(CSS, /\.waffle>i\.wb-them\{background:var\(--cause-them-text\)\}/);
  assert.match(CSS, /\.waffle>i\.wb-rest\{box-shadow:inset 0 0 0 1px var\(--gray-500\)\}/);
  assert.match(CSS, /\.oh-waffle-legend \.cause-them\{background:var\(--cause-them-text\)\}\.oh-waffle-legend \.cause-unknown\{box-shadow:inset 0 0 0 1px var\(--gray-500\)\}/);
  const lum = (hex) => { const c = hex.match(/\w\w/g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const token = (name) => CSS.match(new RegExp(`${name}:(#[0-9a-f]{6})`))[1];
  for (const t of ['--cause-us', '--cause-them-text', '--gray-500']) assert.ok(ratio(token(t), '#ffffff') >= 3, `${t} on white`);
  assert.ok(ratio(token('--cause-them-text'), token('--cause-unknown')) >= 3, 'Them against Not set');
});

// The 2v6 redesign kept the base tokens (12/8/8 radii, one focus ring, motion guard, compact print) and swapped Inter
// for Outfit (the design language); the sidebar-era layout pins (.sidebar-brand, .main gap) went with the sidebar.
test('base look: tokens, 12/8/8 radii, one focus ring, Outfit with a fallback, motion guard, compact print', () => {
  const root = CSS.match(/:root\{([\s\S]*?)\}/)[1];
  for (const t of ['--gray-900:#0c1a2c', '--gray-200:#dde6ee', '--gray-100:#eef4fa', '--gray-50:#f6f9fc', '--r-card:12px', '--r-ctl:8px', '--r-btn:8px', '--ring:var(--accent)', '--dz-r-card:24px', '--dz-r-pill:999px']) assert.ok(root.includes(t), t);
  assert.match(root, /--font:'Outfit',system-ui,/);
  assert.match(HTML, /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">/);
  assert.match(CSS, /:focus-visible\{outline:2px solid var\(--ring\);outline-offset:2px\}/);
  assert.match(CSS, /\.grid-lead\{[^}]*gap:20px\}/);
  assert.match(CSS, /\.card\{[^}]*padding:24px 26px/);
  assert.ok(!/\.(btn|kpi|drill):hover\{[^}]*transform:(?!none)/.test(CSS), 'no movement on hover');
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)\{\s*\*,\*::before,\*::after\{animation-duration:\.01ms!important;[^}]*transition-duration:\.01ms!important\}/);
  // Stream A's print block: the tip bubble, toasts and tip descriptions never print (the hint cards are gone).
  const print = CSS.slice(CSS.lastIndexOf('@media print{', CSS.indexOf('#tip-layer,#toast')));
  assert.match(print, /#tip-layer,#toast,#tip-descs\{display:none!important\}/);
  assert.match(print, /\.grid-lead,\.grid-4,\.grid-5,\.grid-2,\.grid-split,\.month-spot,\.drill-grid,\.grid-split>\.stack\{gap:\.1in\}/);
  assert.match(HTML, /<div id="tip-layer" class="tip-layer" aria-hidden="true" hidden><span class="tip-text"><\/span><span class="tip-arrow"><\/span><\/div>/);
  assert.match(HTML, /<div id="tip-descs" hidden><\/div>/);
});

run();
