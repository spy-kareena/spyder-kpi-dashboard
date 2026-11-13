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
  return [...html.matchAll(/<(?:button|div|span|a|th|section|label|select|input|textarea)\b[^>]*>/g)].map((m) => m[0])
    .filter((tag) => { const c = (tag.match(/\sclass="([^"]*)"/) || [])[1]; return c && c.split(/\s+/).some((x) => classes.includes(x)); });
}
const hasTip = (tag) => /\sdata-tip="[^"]+"/.test(tag) || /\stitle="[^"]+"/.test(tag);
// Each page, plus card choices that draw more controls (drill cards, summary tables).
const VIEWS = [
  ['weekly', ''], ['weekly', "setWeeklyTileFilter('otd3mo')"], ['weekly', "setWeeklyTileFilter('reschedhit')"], ['weekly', "setWeeklyTileFilter('fillrate')"],
  ['weekly', "weeklyTileFilter='late';selectAllLinked(true)"],
  ['purchaseorders', ''], ['supplyweekly', ''], ['monthly', ''], ['warehouses', ''], ['metrics', ''], ['supplydemand', ''], ['buildrisk', ''], ['connect', ''],
  ['search', "searchQuery='SPY';applyGlobalSearch()"],
  // The note editor (override, cause, note), the Lagging tab, the open Big picture and the Shipping page.
  ['weekly', 'toggleRowNote(rowKey(parsedRows[0]))'],
  ['weekly', "setWeeklyView('lagging')"], ['weekly', "setWeeklyView('leading');toggleSankey('weekly')"], ['shipping', ''],
];
function eachView(page, fn) {
  for (const [tab, setup] of VIEWS) {
    page.run(`linkedSelection.clear();expandedNoteRows.clear();sankeyOpen.weekly=false;weeklyTileFilter='late';setTab(${JSON.stringify(tab)});${setup}`);
    fn(results(page) + sidebar(page), `${tab} ${setup}`);
  }
}

test('every KPI card, chip, sortable heading and button on every page has a tooltip (data-tip or title)', async () => {
  const page = await loadedAll();
  let checked = 0;
  const drawn = new Set();
  eachView(page, (html, view) => {
    for (const k of ['class="row-override"', 'class="row-note"', 'class="sk-svg', 'class="ship-', '<summary', '<a href']) if (html.includes(k)) drawn.add(k);
    const tags = tagsWithClass(html, ['kpi', 'chip', 'th-sort', 'btn', 'nav-item', 'drill', 'link-btn', 'filter-more', 'select', 'month-card', 'rate-card', 'hint-close', 'row-override', 'row-cause', 'row-note']);
    // About toggles and links explain themselves too.
    tags.push(...[...html.matchAll(/<summary\b[^>]*>|<a\b[^>]*\shref="[^"]*"[^>]*>/g)].map((m) => m[0]));
    checked += tags.length;
    const bare = tags.filter((t) => !hasTip(t));
    assert.deepEqual(bare, [], `${view}: controls without a tooltip`);
    // Every button in the page and the sidebar (tiles, presets, toggles, rows) explains itself too.
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/class="(row-check|note-btn)/.test(t));
    assert.deepEqual(buttons.filter((t) => !hasTip(t)), [], `${view}: buttons without a tooltip`);
  });
  assert.ok(checked > 300, `checked ${checked} controls`);
  assert.equal(drawn.size, 6, `the note editor, Big picture, Shipping, About toggles and links were all checked: ${[...drawn]}`);
  assert.deepEqual(page.errors, []);
});

test('tooltips say what a card counts with the numbers written in full ($1,721,806, not $1.72M)', async () => {
  const page = await loadedAll();
  page.run("setTab('weekly')");
  const html = results(page);
  const atRisk = html.match(/data-focus-key="tile-late"[^>]*data-tip="([^"]+)"/)[1];
  assert.match(atRisk, /^At risk: \$1,72\d,\d{3} open on \d+ orders \(\d+ lines\), \d+ past due with no reschedule; click to list them below\.$/);
  assert.match(html, /data-focus-key="tile-nocommit"[^>]*data-tip="No commit date: \$[\d,]+ open on 1 order \(1 line\) with no valid commit date/);
  assert.match(html, /data-focus-key="sc-Spyder - Lacombe"[^>]*data-tip="Spyder - Lacombe: open \$1,721,806, at risk \$1,721,806,/);
  for (const [, t] of html.matchAll(/data-tip="([^"]+)"/g)) assert.doesNotMatch(t, /\$\d+(\.\d+)?[KM]\b/, `short money in a tip: ${t}`);
  // Sortable headings say what the column is and how sorting works.
  assert.match(html, /class="th-sort" data-focus-key="linked-sort-value" data-col="value" data-tip="Open value for open lines, line value for closed ones\. Click to sort, again to reverse\."/);
  // Column headings of data tables come from one list (COLUMN_TIPS); headings with no entry stay plain.
  page.run("setTab('supplyweekly')");
  assert.match(results(page), /<th class="num" data-tip="Usable supply minus demand for that month; below zero is short\.">Monthly net<\/th>/);
  page.run("setTab('buildrisk')");
  assert.match(results(page), /<th class="num">Sep 24<\/th>/);
});

test('tooltips stay short on every page: about 20 words, never a paragraph', async () => {
  const page = await loadedAll();
  let checked = 0;
  eachView(page, (html, view) => {
    for (const [, raw] of html.matchAll(/data-tip="([^"]+)"/g)) {
      const t = raw.replace(/&[a-z#0-9]+;/gi, ' ');
      checked++;
      // Data tips list a few values with "·"; prose tips are one short sentence.
      assert.ok(t.split(/\s+/).length <= 30, `${view}: long tip (${t.split(/\s+/).length} words): ${t}`);
    }
  });
  assert.ok(checked > 1000, `checked ${checked} tips`);
});

test('section help sits on the section title (no ⓘ buttons): every text is two short sentences on its title; About these numbers is 3-5 short bullets', async () => {
  const page = await loadedAll();
  const info = page.run('Object.fromEntries(Object.keys(SECTION_INFO).map(k=>[k,{...SECTION_INFO[k],tip:sectionTipText(k)}]))');
  const byTip = new Map(Object.entries(info).map(([k, i]) => [i.tip, k]));
  const unesc = (t) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const norm = (t) => t.replace(/[’']/g, "'");
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
      // The tip is on that section's own title (a dated title such as "Shipped and open value by month · 2026" too).
      const text = unesc(inner.replace(/<[^>]+>/g, '')).trim();
      assert.ok(norm(text).startsWith(norm(info[key].title)), `${view}: ${key} is on "${text}"`);
    }
    // Every page's About block is a short list: 3 to 5 bullets of at most 30 words.
    for (const [about] of html.matchAll(/<details class="about[^"]*"><summary[^>]*>About these numbers<\/summary>[\s\S]*?<\/details>/g)) {
      const items = about.match(/<li>[\s\S]*?<\/li>/g) || [];
      assert.ok(items.length >= 3 && items.length <= 5, `${view}: About has ${items.length} bullets`);
      for (const li of items) assert.ok(li.replace(/<[^>]+>/g, '').split(/\s+/).length <= 30, `${view}: ${li}`);
    }
  });
  for (const [key, i] of Object.entries(info)) {
    assert.ok(i.title && i.what && i.click, `${key} has a definition and a click text`);
    // At most two short sentences: what the section shows, what clicking does.
    assert.equal(sentences(i.what) + sentences(i.click), 2, `${key} is two sentences`);
    assert.equal(i.tip, `${i.what} ${i.click}`);
    assert.ok(i.tip.split(/\s+/).length <= 30, `${key} is short`);
  }
  assert.ok(keys.size >= 35, `${keys.size} section titles carry their help`);
  assert.deepEqual(Object.keys(info).filter((k) => !keys.has(k)), [], 'every section text is on a title');
  // The popover, its script and its styles are gone; the help pointer marks a titled heading with a tip.
  assert.doesNotMatch(HTML, /id="info-pop"|class="info-pop|\.info-btn|\.info-pop|\.title-row|function (infoButton|toggleInfo|openInfo|closeInfo|infoPopKey)\b|INFO_ICON|syncInfoPop|queuePlaceInfo/);
  assert.match(CSS, /\nh2\[data-tip\]\{cursor:help\}\n/);
  assert.equal(page.run("sectionTip('')"), '');
  assert.equal(page.run("sectionTip('no-such-section')"), '');
  assert.equal(page.run("sectionTip('oh-scorecard')"), ' data-tip="Open, at-risk and past-due value and delivery rates per warehouse. Click a row to show only that warehouse; click it again for all."');
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

test('first-visit hints stay dismissed (localStorage spyderKpiHints) until Show hints again', async () => {
  const page = loadPage();
  assert.match(page.els['upload-hint'].innerHTML, /data-hint="upload"[\s\S]*Start here:/);
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

test('every column heading on every page explains itself (its own tip or a tipped sort button); report-week columns stay plain', async () => {
  const page = await loadedAll();
  let checked = 0;
  const seen = new Set();
  eachView(page, (html, view) => {
    const bare = [];
    for (const [, tag, inner] of html.matchAll(/(<th\b[^>]*>)([\s\S]*?)<\/th>/g)) {
      const text = inner.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim();
      if (!text) continue;
      checked++;
      seen.add(text);
      if (hasTip(tag) || /\sdata-tip="[^"]+"/.test(inner)) continue;
      // Clear To Build report weeks ("Sep 24") are dates, not columns that need explaining.
      if (/^[A-Z][a-z]{2} \d{1,2}$/.test(text)) continue;
      bare.push(text);
    }
    assert.deepEqual(bare, [], `${view}: column headings without a tooltip`);
  });
  assert.ok(checked > 150, `checked ${checked} headings`);
  for (const h of ['Doc #', 'SO #', 'PO #', 'Customer / vendor', 'Warehouse', 'Item / description', 'Month', 'Type']) assert.ok(seen.has(h), `${h} was drawn and checked`);
  // Headings that mean something else in one table use that table's text.
  assert.equal(page.run("columnTip('metrics-timeline','Month')"), 'Effective due month: the reschedule date, else the due date.');
  assert.match(page.run("columnTip('br-ctb','Month')"), /Clear To Build report row/);
  assert.match(page.run("columnTip('anything','Month')"), /Demand month \(YearMonth\)/);
  assert.deepEqual(page.errors, []);
});

test('first-visit hints say what the Order Health tabs are and where Shipping gets its tracking numbers', async () => {
  const page = await loadedAll();
  page.run("setTab('weekly')");
  const hint = (html, id) => (html.match(new RegExp(`data-hint="${id}">([\\s\\S]*?)</div>`)) || [])[1] || '';
  assert.match(hint(results(page), 'weekly-cards'), /<strong>Leading<\/strong> shows what needs action now[\s\S]*<strong>Lagging<\/strong> shows how we performed/);
  page.run("setTab('shipping')");
  assert.match(hint(results(page), 'shipping'), /an SAP delivery with a tracking number: click <strong>Check<\/strong>/);
  // Every first-visit hint is one short sentence.
  for (const id of ['weekly-cards', 'shipping']) {
    page.run(`setTab(${JSON.stringify(id === 'shipping' ? 'shipping' : 'weekly')})`);
    const text = hint(results(page), id).replace(/<[^>]+>/g, '');
    assert.ok(text.split(/\s+/).length <= 25 && !/[.!?]\s+\S/.test(text.trim()), `${id}: ${text}`);
  }
  assert.deepEqual(page.errors, []);
});

test('page descriptions: listed by page on the load screen, and the tooltip of each page in the sidebar', async () => {
  const page = loadPage();
  page.run('renderSidebar();renderUploadState()');
  const descs = page.run('PAGE_TIPS');
  // 2v2: the load screen lists every page under its sidebar group with its description; the sidebar stays a plain list.
  const pages = page.els['upload-pages'].innerHTML;
  for (const [id, text] of Object.entries(descs)) {
    const label = page.run(`NAV_GROUPS.flatMap(g=>g[1]).find(i=>i[0]===${JSON.stringify(id)})[1]`);
    assert.ok(pages.includes(`<li><strong>${label.replace(/&/g, '&amp;')}</strong><span class="page-desc">${page.run(`esc(PAGE_TIPS[${JSON.stringify(id)}])`)}</span></li>`), id);
    assert.match(sidebar(page), new RegExp(`data-focus-key="nav-${id}"[^>]*data-tip="${page.run(`esc(PAGE_TIPS[${JSON.stringify(id)}])`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), id);
    assert.ok(text.split(/\s+/).length <= 8, `${id}: a few words`);
  }
  assert.match(pages, /<div class="card"><h3>Sales<\/h3><ul><li><strong>Order Health<\/strong>/);
  assert.doesNotMatch(sidebar(page), /nav-desc/);
  await upload(page, [{ name: 'e.xls', bytes: sapExport(MIX) }]);
  assert.doesNotMatch(sidebar(page), /nav-desc/);
  // The badge's meaning is in the button's own tip (keyboard focus shows that one) and hidden text for screen readers.
  assert.match(sidebar(page), new RegExp(`data-focus-key="nav-weekly" onclick="setTab\\('weekly'\\)" aria-current="page" data-tip="${descs.weekly.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+ orders at risk\\."`));
  assert.match(sidebar(page), /<span class="nav-badge" data-tip="\d+ orders at risk">\d+<span class="sr-only"> orders at risk<\/span><\/span>/);
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

test('wide tables and the ship calendar scroll from the keyboard: every scroll box is a named region with tabindex 0', async () => {
  const page = await loadedAll();
  let boxes = 0;
  eachView(page, (html, view) => {
    for (const [tag] of html.matchAll(/<div class="table-scroll"[^>]*>/g)) {
      boxes++;
      assert.match(tag, /^<div class="table-scroll" tabindex="0" role="region" aria-label="[^"<>]+">$/, `${view}: ${tag}`);
    }
  });
  assert.ok(boxes >= 15, `${boxes} table scroll boxes`);
  page.run("weeklyTileFilter='late';setTab('weekly');setWeeklyTileFilter('otd3mo')");
  assert.match(results(page), /<div class="table-scroll" tabindex="0" role="region" aria-label="3 mo OTD by warehouse"><table class="data-table compact">/);
  page.run("setTab('monthly')");
  assert.match(results(page), /<div class="table-scroll" tabindex="0" role="region" aria-label="Monthly delivery summary · \d{4}"><table class="data-table"/);
  // The ship calendar scrolls the same way; its day columns add no tab stops of their own (data-tip-notab).
  assert.match(HTML, /<div class="table-scroll" tabindex="0" role="region" aria-label="Open ship calendar, one column per day"><div class="day-chart" data-tip-notab /);
});

test('Windows high contrast: picked tabs and rows, the shipment strip and the waffle keep their meaning', () => {
  const fc = CSS.slice(CSS.lastIndexOf('@media (forced-colors:active){'));
  // Last in the sheet, so the system colours win over the page's own rules for the same elements.
  assert.ok(CSS.indexOf('.ship-step.exception>i{') < CSS.lastIndexOf('@media (forced-colors:active){'));
  assert.ok(CSS.indexOf('.oh-tab[aria-selected="true"]{') < CSS.lastIndexOf('@media (forced-colors:active){'));
  assert.match(fc, /\.oh-tab\[aria-selected="true"\],\.segmented button\.active,\.segmented button\.pick,\.waffle-row\.selected,\.oh-bar-row\.selected\{border-color:Highlight\}/);
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
  const print = CSS.slice(CSS.lastIndexOf('@media print{', CSS.indexOf('#tip-layer,#toast')));
  assert.match(print, /#tip-layer,#toast,#tip-descs,\.hint-card,\.nav-desc\{display:none!important\}/);
  assert.match(print, /\.grid-lead,\.grid-4,\.grid-5,\.grid-2,\.grid-split,\.month-spot,\.drill-grid,\.grid-split>\.stack\{gap:\.1in\}/);
  assert.match(HTML, /<div id="tip-layer" class="tip-layer" aria-hidden="true" hidden><span class="tip-text"><\/span><span class="tip-arrow"><\/span><\/div>/);
  assert.match(HTML, /<div id="tip-descs" hidden><\/div>/);
});

run();
