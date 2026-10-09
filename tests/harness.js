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

module.exports = { HTML, INDEX, loadPage, upload, SAP_HEADERS, sapRow, sapExport, utf16Tsv, createSuite };
