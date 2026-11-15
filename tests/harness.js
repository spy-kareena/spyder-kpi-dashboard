// Shared test harness: loads index.html in a Node vm with a small DOM stub and builds synthetic SAP exports.
// Fixtures are synthetic (no SAP data). Used by every tests/*.test.js file.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX = process.env.DASHBOARD_INDEX || path.join(__dirname, '..', 'index.html');
const HTML = fs.readFileSync(INDEX, 'utf8');

function pageScripts(html) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (/type=["']application\/json/.test(m[1] || '')) continue;
    out.push(m[2]);
  }
  return out;
}

function stubElement(id) {
  return {
    id, style: {}, innerHTML: '', textContent: '', value: '', dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { return c; }, remove() {},
    addEventListener() {}, setAttribute() {}, click() {}, parentNode: null,
  };
}

// Builds a fresh page context. `today` pins the viewer clock (YYYY-MM-DD) so date KPIs are reproducible.
function loadPage({ html = HTML, today = '2026-09-24', storage = {} } = {}) {
  const els = {};
  const alerts = [];
  const errors = [];
  const RealDate = Date;
  const fixed = new RealDate(`${today}T10:00:00`).getTime();
  class PinnedDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(fixed); else super(...a); }
    static now() { return fixed; }
  }
  class FileReaderStub {
    readAsArrayBuffer(f) { setImmediate(() => this.onload({ target: { result: f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) } })); }
    readAsText(f) { setImmediate(() => this.onload({ target: { result: Buffer.from(f.bytes).toString('utf8') } })); }
  }
  // Listeners the page adds to document are kept (page.listeners) so a test can send it a made-up event.
  const listeners = [];
  const document = {
    getElementById: (id) => els[id] || (els[id] = stubElement(id)),
    querySelector: () => null, querySelectorAll: () => [], createElement: stubElement,
    body: stubElement('body'), documentElement: { get outerHTML() { return html; } }, title: '',
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture: !!capture }); },
  };
  const blobs = [];
  const ctx = {
    console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) },
    document, alert: (m) => alerts.push(m), confirm: () => true,
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: (k) => { delete storage[k]; } },
    FileReader: FileReaderStub, Blob: class { constructor(parts) { this.parts = parts; blobs.push(this); } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    // Timers of 30 s or more (the shared-notes re-read a minute after a save, retries) never keep a test file
    // running after its last test; tests that need one call its function directly.
    setTimeout: (fn, ms, ...a) => { const t = setTimeout(fn, ms, ...a); if (ms >= 30000) t.unref(); return t; },
    clearTimeout, Date: PinnedDate, Intl, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer,
    navigator: {}, location: { href: 'http://localhost/' }, print() {}, addEventListener() {},
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const s of pageScripts(html)) vm.runInContext(s, ctx, { filename: 'index.html' });
  // Objects from the vm have that realm's prototypes; return plain copies so deepEqual compares values.
  const plain = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
  const run = (expr) => {
    const v = vm.runInContext(expr, ctx);
    return v && typeof v.then === 'function' ? v.then(plain) : plain(v);
  };
  // Sends a made-up event to the page's document listeners of that type (capture ones first, as a browser does).
  const dispatch = (type, event) => {
    const e = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...event };
    for (const l of [...listeners.filter((x) => x.type === type && x.capture), ...listeners.filter((x) => x.type === type && !x.capture)]) l.fn(e);
    return e;
  };
  return { ctx, els, run, alerts, errors, storage, blobs, listeners, dispatch };
}

async function upload(page, files) {
  await page.ctx.handleFiles(files.map((f) => ({ name: f.name, bytes: f.bytes })));
  await new Promise((r) => setTimeout(r, 10));
}

// --- Fixtures ---------------------------------------------------------------------------------------
const SAP_HEADERS = ['#', 'ExportDate', 'SourceType', 'Internal Number', 'DocumentNumber', 'LineNumber', 'CustomerPONumber', 'DocumentDate', 'ClosedDate', 'CloseDateSource', 'DeliveryDocNumber', 'DueDate', 'HeaderDueDate', 'LineDueDate', 'CustomerVendorCode', 'CustomerVendorName', 'Group Code', 'CustomerVendorGroup', 'DocumentOwner', 'OrderType', 'Department', 'Project Code', 'Item No.', 'ItemDescription', 'ItemGroupName', 'Warehouse', 'Quantity', 'OpenQuantity', 'AmountLocal', 'AmountForeign', 'Currency', 'Status', 'DaysPastDue', 'KPIStatus', 'KPIArea', 'LineRescheduleDate', 'RescheduleDate', 'RescheduleFlag', 'DueDateRiskFlag', 'Confirmed', 'FillStatus', 'OnTimeStatus', 'PriceFlag', 'PerfectOrder', 'CoverageType'];

function sapRow(o) {
  const base = {
    ExportDate: '09/03/2026', SourceType: 'Sales Order', 'Internal Number': '1', DocumentNumber: '500', LineNumber: '', CustomerPONumber: '',
    DocumentDate: '07/01/2026', ClosedDate: '', CloseDateSource: '', DeliveryDocNumber: '', DueDate: '08/01/2026', HeaderDueDate: '08/01/2026', LineDueDate: '08/01/2026',
    CustomerVendorCode: 'FIREFLY', CustomerVendorName: 'Firefly RV', 'Group Code': '102', CustomerVendorGroup: 'RV', DocumentOwner: 'Jamie Cole', OrderType: 'Sales Order',
    Department: 'Production', 'Project Code': '', 'Item No.': 'SPY-100', ItemDescription: 'Controller board', ItemGroupName: 'Electronics', Warehouse: 'Spyder - Lacombe',
    Quantity: '10.000', OpenQuantity: '10.000', AmountLocal: '1,000.00', AmountForeign: '1,000.00', Currency: 'CAD', Status: 'Open', DaysPastDue: '', KPIStatus: 'Open', KPIArea: 'Sales Orders',
    LineRescheduleDate: '', RescheduleDate: '', RescheduleFlag: 'No Reschedule', DueDateRiskFlag: 'OK', Confirmed: 'Y', FillStatus: 'Not Shipped', OnTimeStatus: 'Pending', PriceFlag: 'OK', PerfectOrder: 'Not Perfect', CoverageType: 'Uncovered',
  };
  return { ...base, ...o };
}

// SAP B1 "Export to Excel": UTF-16LE with BOM, tab separated, CRLF, never quoted.
function sapExport(rows) {
  const lines = [SAP_HEADERS.join('\t'), ...rows.map((r, i) => SAP_HEADERS.map((h) => (h === '#' ? String(i + 1) : r[h] ?? '')).join('\t'))];
  const text = lines.join('\r\n') + '\r\n';
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
}

function utf16Tsv(headers, rows) {
  const text = [headers.join('\t'), ...rows.map((r) => headers.map((h) => r[h] ?? '').join('\t'))].join('\r\n') + '\r\n';
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
}

// Tiny runner: register with test(name, fn), then call run() at the end of the file.
function createSuite() {
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  const run = async () => {
    let failed = 0;
    for (const t of tests) {
      try { await t.fn(); console.log(`ok   ${t.name}`); }
      catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
    }
    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    process.exitCode = failed ? 1 : 0;
  };
  return { test, run };
}

// 2v9 (owner): phone sort menus. A table shown as cards on a phone has no heading row, so its card carries a Sort select
// (psortHtml, or the PO / Sales Order Health lines' own select) and an arrow button (psortDir). This checks one table:
// the select lists every sortable heading (a psort menu: the same columns in the same order, the same labels), and each
// choice, then the arrow, leaves the page exactly as one click, then a second click, on that heading does.
// marker: text inside the card (e.g. the select's data-focus-key); prefix: the headings' data-focus-key before the
// column id; dirKey: the arrow's key (data-focus-key "psort-<dirKey>-dir"); colOf: a choice's value => its column id
// (null: a choice that sorts no column); legacy(value): an older choice that keeps its own sort (only its arrow is checked);
// rows(card html): the rows' order, to show the sort does something. Returns {heads, options}.
function checkPhoneSort(page, { marker, prefix, dirKey, colOf = (v) => v, legacy = () => false, rows }) {
  const assert = require('node:assert/strict');
  const html = () => page.els['results-screen'].innerHTML;
  const dec = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? dec(m[1]) : undefined; };
  const card = (h) => {
    const i = h.indexOf(marker);
    assert.ok(i >= 0, `${marker}: the phone sort control is drawn`);
    const a = h.lastIndexOf('<section', i), b = h.indexOf('</section>', i);
    return h.slice(a, b < 0 ? h.length : b);
  };
  const c0 = card(html());
  const selHtml = c0.match(/<select\b[^>]*>[\s\S]*?<\/select>/g).find((s) => s.includes(marker) || /psort-sel|id="(po|weekly)-line-sort"/.test(s));
  const selTag = selHtml.match(/^<select\b[^>]*>/)[0];
  assert.match(selTag, /\saria-label="Sort [^"]+"/, `${marker}: the select is labelled`);
  assert.match(selTag, /\sdata-tip="[^"]+"/, `${marker}: the select has a tip`);
  const options = [...selHtml.matchAll(/<option\b[^>]*>([^<]*)<\/option>/g)].map((m) => ({ value: attr(m[0], 'value'), first: attr(m[0], 'data-first'), label: attr(m[0], 'data-name'), text: dec(m[1]) }));
  const heads = [...c0.matchAll(/<button type="button" class="th-sort[^"]*"[^>]*>[\s\S]*?<span class="sort-arrow"/g)].map((m) => {
    const tag = m[0].match(/^<button\b[^>]*>/)[0];
    return { tag, key: attr(tag, 'data-focus-key'), label: dec(m[0].slice(tag.length).replace(/<span class="sort-arrow"$/, '').replace(/<[^>]*>/g, '')).trim() };
  }).filter((x) => x.key && x.key.startsWith(prefix)).map((x) => ({ ...x, col: x.key.slice(prefix.length) }));
  assert.ok(heads.length >= 2, `${marker}: sortable headings found`);
  const choices = options.filter((o) => o.value !== '' && colOf(o.value) !== null && colOf(o.value) !== undefined);
  // Every sortable column is a choice.
  assert.deepEqual(heads.map((x) => x.col).filter((c) => !choices.some((o) => String(colOf(o.value)) === c)), [], `${marker}: columns missing from the phone Sort menu`);
  if (/psort-sel/.test(selTag)) {
    // A psort menu: the table's own order first, then the columns in heading order with the heading's words.
    assert.equal(options[0].value, '');
    assert.deepEqual(choices.map((o) => [String(o.value), o.label]), heads.map((x) => [x.col, x.label]), `${marker}: the menu lists the headings`);
  }
  const saved = page.run('JSON.stringify({t:tableMore,po:poLineSort,w:weeklyLineSort})');
  const reset = () => page.run(`(s=>{tableMore=s.t;poLineSort=s.po;weeklyLineSort=s.w;renderResults();})(${saved})`);
  const call = (js, self) => page.run(`(function(){${js}}).call(${JSON.stringify(self)})`);
  const clickHead = (x) => call(attr(x.tag, 'onclick'), { dataset: { col: attr(x.tag, 'data-col'), sortLabel: attr(x.tag, 'data-sort-label') }, firstChild: { textContent: x.label } });
  const base = rows ? rows(card(html())) : null;
  let changed = 0;
  for (const o of choices) {
    const x = heads.find((h) => h.col === String(colOf(o.value)));
    reset();
    call(attr(selTag, 'onchange'), { value: o.value, selectedIndex: 0, options: [{ dataset: { first: o.first, name: o.label } }] });
    const viaMenu = html();
    const now = card(viaMenu);
    assert.match(now.match(/<select\b[^>]*>[\s\S]*?<\/select>/g).find((s) => s.startsWith(selTag.slice(0, 40))) || '', /<option\b[^>]*\sselected>/, `${marker}: the select shows the pick`);
    const dir = (now.match(new RegExp(`<button type="button" class="dz-pillinput psort-dir" data-focus-key="psort-${dirKey}-dir"[^>]*>`)) || [])[0];
    assert.ok(dir, `${marker} ${o.value}: the arrow button is drawn`);
    assert.doesNotMatch(dir, /aria-disabled/, `${marker} ${o.value}: the arrow works once a column is sorted`);
    assert.match(dir, /aria-label="Sort ascending" aria-pressed="(true|false)"/);
    assert.match(dir, /\sdata-tip="[^"]+"/);
    if (rows && JSON.stringify(rows(now)) !== JSON.stringify(base)) changed++;
    call(attr(dir, 'onclick'), { dataset: { name: attr(dir, 'data-name') } });
    const viaArrow = html();
    if (rows && JSON.stringify(rows(card(viaArrow))) !== JSON.stringify(base)) changed++;
    reset();
    clickHead(x);
    if (!legacy(o.value)) assert.ok(viaMenu === html(), `${marker}: "${o.text}" sorts as a click on ${x.label}`);
    clickHead(x);
    assert.ok(viaArrow === html(), `${marker}: "${o.text}" then the arrow sorts as two clicks on ${x.label}`);
  }
  if (rows) assert.ok(changed > 0, `${marker}: a phone sort changes the order`);
  // Back to the table's own order (a psort menu's first choice): no column is sorted and the arrow waits.
  if (/psort-sel/.test(selTag)) {
    call(attr(selTag, 'onchange'), { value: '', selectedIndex: 0, options: [{ dataset: {} }] });
    assert.match(card(html()), new RegExp(`data-focus-key="psort-${dirKey}-dir" aria-label="Sort ascending" aria-pressed="false" aria-disabled="true"`));
  }
  reset();
  return { heads, options };
}

module.exports = { HTML, INDEX, loadPage, upload, SAP_HEADERS, sapRow, sapExport, utf16Tsv, createSuite, checkPhoneSort };
