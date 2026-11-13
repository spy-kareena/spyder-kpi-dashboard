// 2v6.9 pager sweep: every card list with more than 10 items shows 10 a page (dzPageOf + dzPageFoot), the owner's
// global rule. Covers the page state (a new sig starts at page 1, clamping, print), the grouped pages, and two pages
// that use it (Purchase Orders lines, the Order Health Lines card). Run with `node tests/pager-2v69.test.js`.
// Fixtures are synthetic.
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
const html = (page) => page.els['results-screen'].innerHTML;
const so = (doc, due, o = {}) => sapRow({ DocumentNumber: doc, 'Internal Number': doc, DueDate: due, LineDueDate: due, HeaderDueDate: due, ...o });
const po = (doc, due, o = {}) => sapRow({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'Purchase Order', DocumentNumber: doc, 'Internal Number': doc, CustomerVendorCode: 'VEND', CustomerVendorName: 'Vendor Co', DueDate: due, LineDueDate: due, HeaderDueDate: due, ...o });
async function loaded(rows) {
  const page = loadPage({ storage: { ...IMPORT } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
}

test('dzPageOf: 10 a page, a new sig starts at page 1, the page is clamped to the list, print gives every row', () => {
  const page = loadPage();
  const list = 'Array.from({length:24},(_,i)=>i+1)';
  const pg = (sig, extra = '') => page.run(`(()=>{${extra}const p=dzPageOf('t',${list},${JSON.stringify(sig)});return [p.rows,p.page,p.pages,p.from,p.to,p.total];})()`);
  assert.deepEqual(pg('a'), [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1, 3, 1, 10, 24]);
  page.run("dzPg.t.page=3");
  assert.deepEqual(pg('a'), [[21, 22, 23, 24], 3, 3, 21, 24, 24], 'the same sig keeps the page');
  assert.deepEqual(pg('b')[1], 1, 'a new sig (another filter, search or sort) starts at page 1');
  // A list that shrinks keeps a page that still exists.
  page.run("dzPg.t.page=3");
  const short = page.run("(()=>{const p=dzPageOf('t',[1,2,3,4,5,6,7,8,9,10,11,12],'b');return [p.page,p.pages,p.rows];})()");
  assert.deepEqual(short, [2, 2, [11, 12]]);
  const empty = page.run("(()=>{const p=dzPageOf('t',[],'b');return [p.page,p.pages,p.from,p.to,p.total];})()");
  assert.deepEqual(empty, [1, 1, 0, 0, 0]);
  // A page size of its own (the Lines card's Settings choice).
  assert.equal(page.run("dzPageOf('t2',Array.from({length:45},(_,i)=>i),'',20).pages"), 3);
  // Print: every row, no pager.
  page.run('printMode=true');
  assert.deepEqual(pg('a').slice(1), [1, 1, 1, 24, 24]);
  assert.equal(page.run("dzPageFoot('t',dzPageOf('t',Array.from({length:24}),'a'),'Test')"), '');
  page.run('printMode=false');
  // One page: no foot. Two pages: the range and the pager.
  assert.equal(page.run("dzPageFoot('t3',dzPageOf('t3',[1,2,3],''),'Test')"), '');
  const foot = page.run("dzPageFoot('t4',dzPageOf('t4',Array.from({length:11}),''),'Test','items')");
  assert.match(foot, /^<div class="dz-pagefoot"><span class="dz-pagecount">1–10 of 11 items<\/span><nav class="shp-pager dz-pager print-hide" data-dzpager="t4" aria-label="Test pages"/);
  assert.match(foot, /data-focus-key="pg-t4-2" aria-label="Page 2 of 2"/);
  // dzGoPage clamps; the arrow keys, Home and End step through the pages.
  page.run("dzPageOf('t5',Array.from({length:35}),'');dzGoPage('t5',99)");
  assert.equal(page.run('dzPg.t5.page'), 4);
  page.run("dzPagerKey({key:'Home',preventDefault(){}},'t5')");
  assert.equal(page.run('dzPg.t5.page'), 1);
  page.run("dzPagerKey({key:'ArrowRight',preventDefault(){}},'t5')");
  assert.equal(page.run('dzPg.t5.page'), 2);
  page.run("dzPagerKey({key:'End',preventDefault(){}},'t5')");
  assert.equal(page.run('dzPg.t5.page'), 4);
  assert.deepEqual(page.errors, []);
});

test('dzPageGroups: the group heading repeats at the top of each page, the subtotal follows a group\'s last row', () => {
  const page = loadPage();
  const out = (p) => page.run(`(()=>{dzPg.g&&(dzPg.g.page=${p});const groups=[{id:'A',rows:Array.from({length:4},(_,i)=>'a'+i)},{id:'B',rows:Array.from({length:12},(_,i)=>'b'+i)}];return dzPageGroups('g',groups,'s',r=>'['+r+']',g=>'<'+g.id+'>',g=>'{'+g.id+'}').html;})()`);
  assert.equal(out(1), '<A>[a0][a1][a2][a3]{A}<B>[b0][b1][b2][b3][b4][b5]');
  assert.equal(out(2), '<B>[b6][b7][b8][b9][b10][b11]{B}');
});

test('Purchase Orders lines: 10 a page, page 2 lists the next lines, a sort or filter change starts at page 1', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => po(String(5000 + i), '08/01/2026', { AmountLocal: String(100 + i) }));
  const page = await loaded(rows);
  page.run("setTab('purchaseorders')");
  const docs = () => [...html(page).matchAll(/<td class="sup-strong" data-label="PO #">(\d+)<\/td>/g)].map((m) => m[1]);
  const first = docs();
  assert.equal(first.length, 10);
  assert.match(html(page), /<span class="dz-pagecount">1–10 of 25 lines<\/span><nav class="shp-pager dz-pager print-hide" data-dzpager="po-lines" aria-label="PO lines pages"/);
  assert.doesNotMatch(html(page), /po-linked-all|Show up to 100|togglePoLinkedAll/);
  page.run("dzGoPage('po-lines',2)");
  assert.equal(docs().length, 10);
  assert.ok(docs().every((d) => !first.includes(d)), 'page 2 lists other lines');
  assert.match(html(page), /11–20 of 25 lines/);
  page.run("dzGoPage('po-lines',3)");
  assert.equal(docs().length, 5);
  // A sort change starts at page 1 (value high to low: the biggest amounts first).
  page.run("setPoLineSort('value')");
  assert.match(html(page), /1–10 of 25 lines/);
  assert.equal(docs()[0], '5024');
  // So does a filter change.
  page.run("dzGoPage('po-lines',2);setPoVendorFilter(['VEND'])");
  assert.match(html(page), /1–10 of 25 lines/);
  // Print lists all 25.
  page.run('refreshForPrint()');
  assert.equal(docs().length, 25);
  page.run('endPrintMode()');
  assert.deepEqual(page.errors, []);
});

test('Order Health Lines card: 10 a page by default (Settings: Lines a page), page 2, a card or search change starts at page 1', async () => {
  const rows = Array.from({ length: 23 }, (_, i) => so(String(1000 + i), '08/01/2026'));
  const page = await loaded(rows);
  page.run("setTab('weekly')");
  const docs = () => [...html(page).matchAll(/<td class="c-doc">(\d+)<\/td>/g)].map((m) => m[1]);
  const first = docs();
  assert.equal(first.length, 10);
  assert.match(html(page), /<span class="dz-pagecount">1–10 of 23 lines<\/span><nav class="shp-pager dz-pager print-hide" data-dzpager="oh-lines"/);
  assert.doesNotMatch(html(page), /linked-all|Show more →/);
  page.run("dzGoPage('oh-lines',3)");
  assert.equal(docs().length, 3);
  assert.ok(docs().every((d) => !first.includes(d)));
  assert.match(html(page), /21–23 of 23 lines/);
  // The search box narrows the list and starts it at page 1.
  page.run("ohlLineQuery='10';renderResults()");
  assert.match(html(page), /1–10 of \d+ lines/);
  page.run("ohlLineQuery='';renderResults()");
  // Lines a page: 20 shows two pages of 20 and 3.
  page.run("stgSet('linesShown',20)");
  page.run("setTab('weekly')");
  assert.equal(docs().length, 20);
  assert.match(html(page), /1–20 of 23 lines/);
  page.run("stgSet('linesShown',10)");
  // A new report resets every page.
  page.run("dzGoPage('oh-lines',2);resetViewState()");
  assert.deepEqual(page.run('dzPg'), {});
  assert.deepEqual(page.errors, []);
});

run();
