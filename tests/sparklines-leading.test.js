// Sparklines on Sales Order Health, Leading (owner's pick, Style A through dzSpark): At Risk draws its at-risk orders
// for the last 8 weeks (past weeks from the counts saved with the at-risk history, this week the card's own number) and
// the month's Ship Target the past-due orders it started each of the last 6 months with (rebuilt from the export's
// dates; this month the card's own number). Both follow the page filters, draw nothing with one period, and list every
// period in their tip. Run with `node tests/sparklines-leading.test.js`. Fixtures are synthetic; the report date is
// Thursday 2026-09-03 (week of Monday Aug 31, month of September).
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
const so = (doc, due, o = {}) => sapRow({ DocumentNumber: doc, 'Internal Number': doc, DueDate: due, LineDueDate: due, HeaderDueDate: due, ...o });
const closed = (on) => ({ Status: 'Closed', KPIStatus: 'Closed', OpenQuantity: '0.000', ClosedDate: on, FillStatus: 'Shipped' });
// SO 100: due in March, open: past due at every month start. SO 101: due May 10, closed Jul 20: past due on Jun 1 and
// Jul 1 only. SO 102: due Jun 15 but booked Jul 10: past due from Aug 1. SO 103 (Barletta): due Aug 20, open: this month.
const ROWS = [
  so('100', '03/15/2026', { DocumentDate: '01/05/2026' }),
  so('101', '05/10/2026', { DocumentDate: '04/01/2026', ...closed('07/20/2026') }),
  so('102', '06/15/2026', { DocumentDate: '07/10/2026' }),
  so('103', '08/20/2026', { CustomerVendorCode: 'BARLETTA', CustomerVendorName: 'Barletta Boats' }),
];
async function loaded(rows = ROWS) {
  const page = loadPage({ storage: { ...IMPORT } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
}
const html = (page) => page.els['results-screen'].innerHTML;
const card = (h, cls) => {
  const m = new RegExp(`<section class="dz-card(?: [^"]*)? ${cls}(?: [^"]*)?"[^>]*>`).exec(h);
  return m ? h.slice(m.index, h.indexOf('</section>', m.index) + '</section>'.length) : '';
};
const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// The keyboard hint every sparkline tip ends with (2v9 spark hover); left out of the tip lines below.
const ARROW_HINT = 'Left and right arrow keys: one period at a time';
// The sparkline in a card: its tip lines (title first, without the keyboard hint) and the number of points on its line, or null with none.
const spark = (c) => {
  const m = /<span class="dz-spark" role="img" tabindex="0" aria-label="[^"]*" data-tip="([^"]*)" data-spark="[^"]*"><svg[^>]*>([\s\S]*?)<\/svg><\/span>/.exec(c);
  if (!m) return null;
  const line = /<path d="([^"]*)" fill="none"/.exec(m[2]);
  return { tip: unesc(m[1]).split('\n').map((t) => t.replace(/^• /, '')).filter((t) => t !== ARROW_HINT), points: (line[1].match(/[ML]/g) || []).length };
};
const atRiskCard = (page) => card(html(page), 'ohl-card');
const shipCard = (page) => card(html(page), 'ohl-ship');
const heroOrders = (c) => +(/<span class="dz-big sm[^"]*">(\d+) orders?<\/span>/.exec(c) || [])[1];
const week = (asOf, counts) => ({ asOf, savedAt: 's', keys: [], ...(counts ? { counts: { asOf, ...counts } } : {}) });
const setWeeks = (page, weeks) => page.run(`atRiskWeeks=cleanAtRiskWeeks(${JSON.stringify(weeks)});renderResults()`);

test('Ship target: past-due orders at the start of the last 6 months, the last point the card number, red, beside it', async () => {
  const page = await loaded();
  const c = shipCard(page);
  assert.match(c, /<h2[^>]*>September ship target<\/h2>/);
  const s = spark(c);
  assert.ok(s, 'the ship target draws a line');
  assert.equal(s.points, 6);
  assert.equal(heroOrders(c), 3, 'SO 100, 102 and 103 are past due and open');
  assert.deepEqual(s.tip, ['Past-due orders at the start of each month', 'Apr 1: 1 order', 'May 1: 1 order', 'Jun 1: 2 orders', 'Jul 1: 2 orders', 'Aug 1: 2 orders',
    'Sep 1 (still open today): 3 orders', 'Tick: Aug 1']);
  // Beside the big number, in the risk tone.
  assert.match(c, /<div class="mwm-hero"[^>]*><span class="dz-big sm mwm-red">3 orders<\/span><span class="dz-sub">[^<]*<\/span><span class="dz-spark"/);
  assert.match(c, /stroke="var\(--dz-risk\)"/);
  // It follows the page filters as the card's number does: Firefly only.
  page.run(`weeklyCustomerFilter=['FIREFLY'];renderResults()`);
  const f = spark(shipCard(page));
  assert.equal(heroOrders(shipCard(page)), 2);
  assert.deepEqual(f.tip.slice(1, 7).map((t) => t.split(': ')[1]), ['1 order', '1 order', '2 orders', '2 orders', '2 orders', '2 orders']);
  // Original dates only (the Dates basis) is the same rule on the other date.
  page.run(`weeklyCustomerFilter=['ALL'];shipScenarioDateBasis='original';renderResults()`);
  assert.equal(spark(shipCard(page)).tip[6], 'Sep 1 (still open today): 3 orders');
  assert.deepEqual(page.errors, []);
});

test('Ship target: the last point is the card number, and no errors with a PO-only export, an empty view, a snapshot or print', async () => {
  // A PO-only export: whatever the card counts, the line ends on it, and At Risk has no line.
  const po = sapRow({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'Purchase Order', DocumentNumber: '9', 'Internal Number': '9', CustomerVendorCode: 'VEND', CustomerVendorName: 'Vendor' });
  const page = await loaded([po]);
  const sc = shipCard(page);
  if (spark(sc)) assert.match(spark(sc).tip[6], new RegExp(`: ${heroOrders(sc)} orders?$`), 'the last point is the card number');
  assert.doesNotMatch(atRiskCard(page), /class="dz-spark"/);
  const p2 = await loaded();
  p2.run(`weeklyCustomerFilter=['BARLETTA'];renderResults()`);
  assert.equal(heroOrders(shipCard(p2)), 1);
  assert.deepEqual(spark(shipCard(p2)).tip.slice(1, 7).map((t) => t.split(': ')[1]), ['0 orders', '0 orders', '0 orders', '0 orders', '0 orders', '1 order']);
  p2.run(`weeklyCustomerFilter=['ALL'];isSnapshotView=true;renderResults()`);
  assert.ok(spark(shipCard(p2)), 'a snapshot draws the ship target line from its own rows');
  p2.run(`isSnapshotView=false;printMode=true;renderResults();printMode=false`);
  assert.deepEqual([...page.errors, ...p2.errors], []);
});

test('At Risk: last 8 weeks from the saved counts, the last point the card number, a tick at last week', async () => {
  const page = await loaded();
  const n = heroOrders(atRiskCard(page));
  assert.ok(n >= 3);
  assert.equal(spark(atRiskCard(page)), null, 'no saved weeks: only this week, so no line');
  // Weeks saved before counts existed have no point; one week with counts is enough for two points.
  setWeeks(page, [week('2026-08-12'), week('2026-08-19')]);
  assert.equal(spark(atRiskCard(page)), null, 'old weeks without counts draw nothing');
  setWeeks(page, [
    week('2026-06-01', { lines: 40, orders: 30 }), // older than 8 weeks: left out
    week('2026-08-12'),
    week('2026-08-18', { lines: 9, orders: 7, by: { cust: { FIREFLY: [4, 2], BARLETTA: [5, 5] }, wh: { 'Spyder - Lacombe': [9, 7] } } }),
    week('2026-08-26', { lines: 6, orders: 5 }),
    week('2026-09-01', { lines: 99, orders: 99 }), // this week: the card's own number wins
  ]);
  const c = atRiskCard(page), s = spark(c);
  assert.ok(s);
  assert.equal(s.points, 3);
  assert.deepEqual(s.tip, ['At-risk orders, last 8 weeks', 'Week of Jul 6: no data', 'Week of Jul 13: no data', 'Week of Jul 20: no data', 'Week of Jul 27: no data',
    'Week of Aug 3: no data', 'Week of Aug 10: no data', 'Week of Aug 17: 7 orders', 'Last week: 5 orders', `This week: ${n} orders`, 'Tick: Last week'].filter((t) => !/Jul 6/.test(t)));
  // Beside the big number, red.
  assert.match(c, /<div class="ohl-hero-row"><button type="button" class="ohl-hero"[\s\S]*?<\/button><span class="dz-spark"/);
  assert.match(c, /stroke="var\(--dz-risk\)"/);
  assert.deepEqual(page.errors, []);
});

test('At Risk: the saved weeks follow the warehouse, segment and customer filters; other filters leave no line', async () => {
  const page = await loaded();
  setWeeks(page, [
    week('2026-08-18', { lines: 9, orders: 7, by: { cust: { FIREFLY: [4, 2], BARLETTA: [5, 5] }, wh: { 'Spyder - Lacombe': [9, 7] } } }),
    week('2026-08-26', { lines: 6, orders: 5 }),
  ]);
  page.run(`weeklyCustomerFilter=['FIREFLY'];renderResults()`);
  let c = atRiskCard(page), s = spark(c);
  assert.equal(s.points, 2, 'last week has no split, so only Aug 17 and this week');
  assert.equal(s.tip[6], 'Week of Aug 17: 2 orders');
  assert.equal(s.tip[7], 'Last week: no data');
  assert.equal(s.tip[8], `This week: ${heroOrders(c)} order${heroOrders(c) === 1 ? '' : 's'}`);
  page.run(`weeklyCustomerFilter=['FIREFLY','BARLETTA'];renderResults()`);
  assert.equal(spark(atRiskCard(page)).tip[6], 'Week of Aug 17: 7 orders', 'an order has one customer, so customers add up');
  page.run(`weeklyCustomerFilter=['ALL'];weeklyWarehouseFilter=['Spyder - Lacombe'];renderResults()`);
  assert.equal(spark(atRiskCard(page)).tip[6], 'Week of Aug 17: 7 orders');
  // Two filters at once, or a filter the saved figures cannot split by: only this week, no line.
  page.run(`weeklyCustomerFilter=['FIREFLY'];renderResults()`);
  assert.equal(spark(atRiskCard(page)), null);
  page.run(`weeklyCustomerFilter=['ALL'];weeklyWarehouseFilter=['ALL'];weeklyReasonFilter=${JSON.stringify('Past due')};renderResults()`);
  assert.equal(spark(atRiskCard(page)), null);
  assert.deepEqual(page.errors, []);
});

test('At Risk: the page sends the card figures with the week, and keeps them through cleaning and merging', async () => {
  const page = await loaded();
  const w = page.run('reportAtRiskWeek()');
  const n = heroOrders(atRiskCard(page));
  assert.equal(w.counts.orders, n);
  assert.equal(w.counts.asOf, '2026-09-03');
  assert.deepEqual(w.counts.by.cust, { FIREFLY: [2, 2], BARLETTA: [1, 1] });
  assert.deepEqual(Object.keys(w.counts.by).sort(), ['cust', 'seg', 'wh']);
  // Merged in the same week: the later export date's figures win; a week without figures keeps the other's.
  const merged = page.run(`mergeAtRiskWeeks(cleanAtRiskWeeks([{asOf:'2026-09-01',savedAt:'a',keys:['x'],counts:{asOf:'2026-09-01',lines:1,orders:1}}]),cleanAtRiskWeeks([{asOf:'2026-09-02',savedAt:'b',keys:['y'],counts:{asOf:'2026-09-02',lines:2,orders:2}},{asOf:'2026-09-03',savedAt:'c',keys:['z']}]))`);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].counts, { asOf: '2026-09-02', lines: 2, orders: 2 });
  assert.deepEqual(merged[0].keys.sort(), ['x', 'y', 'z']);
  // Malformed figures are dropped, the week kept.
  assert.deepEqual(page.run(`cleanAtRiskWeeks([{asOf:'2026-09-01',keys:[],counts:{lines:-1,orders:2}}])`), [{ asOf: '2026-09-01', savedAt: '', keys: [] }]);
  assert.deepEqual(page.errors, []);
});

// 2v9 spark hover: the figure carries its periods (data-spark: x, y, value, name); the pointer marks the nearest one with
// a hairline and a ring and the bubble shows that period's value (bold), its name and the target; the general tooltip
// does not cover it with the full list; the arrow keys, Home and End step through the periods and read each out; leaving
// clears the mark; a finger taps one (no long-press list). The figure here is a stand-in with the real data-spark.
test('Hover: the nearest period is marked and its value shown; arrow keys step and read out; a tap works; the full list stays for keyboard focus', async () => {
  const page = await loaded();
  const c = shipCard(page);
  assert.match(c, /data-tip="[^"]*Left and right arrow keys: one period at a time"/, 'the keyboard hint ends the tip');
  const d = JSON.parse(unesc(/<span class="dz-spark"[^>]* data-spark="([^"]*)">/.exec(c)[1]));
  assert.deepEqual(d.pts.map((p) => p[3]), ['Apr 1', 'May 1', 'Jun 1', 'Jul 1', 'Aug 1', 'Sep 1 (still open today)']);
  assert.deepEqual(d.pts.map((p) => p[2]), ['1 order', '1 order', '2 orders', '2 orders', '2 orders', '3 orders']);
  assert.deepEqual([d.w, d.h, d.target], [120, 30, '']);
  assert.ok(d.pts.every((p, i) => i === 0 || p[0] > d.pts[i - 1][0]), 'left to right');
  assert.match(c, /<line class="dz-spark-x"[^>]*\/><path d="M[^"]*" fill="none"/, 'the hairline sits under the line');
  assert.match(c, /<circle class="dz-spark-hl"[^>]*\/><\/svg>/, 'the ring on top');
  // The stand-in: the svg 120 x 30 px at (100, 50); a tip layer that records what it shows.
  page.run(`(()=>{
    const attrs=o=>({a:{},setAttribute(k,v){this.a[k]=String(v);}});
    const hair=attrs(),ring=attrs(),svg={getBoundingClientRect:()=>({left:100,top:50,width:120,height:30})};
    const cls=new Set(['dz-spark']),json=${JSON.stringify(JSON.stringify(d))};
    const el={isConnected:true,cls,hair,ring,svg,classList:{add:c=>cls.add(c),remove:c=>cls.delete(c),contains:c=>cls.has(c)},
      getAttribute:k=>k==='data-spark'?json:k==='data-tip'?'Past-due orders at the start of each month\\n• Apr 1: 1 order':null,
      closest:sel=>sel==='.dz-spark'||sel==='[data-tip]'?el:null,matches:sel=>sel==='.dz-spark',
      contains:n=>n===el||n===svg,querySelector:sel=>sel==='.dz-spark-x'?hair:sel==='.dz-spark-hl'?ring:sel==='svg'?svg:null};
    const text={kids:[],get textContent(){return this.kids.map(k=>k.textContent).join('');},set textContent(v){this.kids=[];},appendChild(n){this.kids.push(n);return n;}};
    const layer={hidden:true,style:{setProperty(){}},dataset:{},offsetWidth:80,offsetHeight:40,classList:{add(){},remove(){}},querySelector:s=>s==='.tip-text'?text:null};
    document.getElementById=(orig=>id=>id==='tip-layer'?layer:orig(id))(document.getElementById);
    globalThis.fakeSpark=el;globalThis.fakeLayer=layer;globalThis.fakeText=text;
    globalThis.said=[];announce=t=>said.push(t);
  })()`);
  const xOf = (i) => 100 + d.pts[i][0];
  const shown = () => page.run('[fakeLayer.hidden,fakeText.kids.map(k=>[k.className,k.textContent])]');
  // The pointer near the third period: hairline and ring there, the bubble shows "2 orders" (bold) then "Jun 1".
  page.dispatch('pointerover', { target: page.ctx.fakeSpark, pointerType: 'mouse' });
  assert.notEqual(page.run('tipState.pending===fakeSpark'), true, 'no full-list tip queued on hover');
  page.dispatch('pointermove', { target: page.ctx.fakeSpark, pointerType: 'mouse', clientX: xOf(2) + 3, clientY: 60 });
  assert.equal(page.run('fakeSpark.hair.a.x1'), String(d.pts[2][0]));
  assert.deepEqual(page.run('[fakeSpark.ring.a.cx,fakeSpark.ring.a.cy]'), [String(d.pts[2][0]), String(d.pts[2][1])]);
  assert.equal(page.run("fakeSpark.cls.has('hov')"), true);
  assert.deepEqual(shown(), [false, [['tip-line tip-head', '2 orders\n'], ['tip-line', 'Jun 1']]]);
  // Past the right end: the last period.
  page.dispatch('pointermove', { target: page.ctx.fakeSpark, pointerType: 'mouse', clientX: 400, clientY: 60 });
  assert.deepEqual(shown()[1].map((r) => r[1]), ['3 orders\n', 'Sep 1 (still open today)']);
  // Leaving clears the mark.
  page.dispatch('pointerout', { target: page.ctx.fakeSpark, pointerType: 'mouse', relatedTarget: null });
  assert.equal(page.run("fakeSpark.cls.has('hov')"), false);
  // Keys: the first arrow goes to the latest period, then one at a time; Home and End; each is read out.
  const key = (k) => page.dispatch('keydown', { target: page.ctx.fakeSpark, key: k });
  assert.equal(key('ArrowLeft').defaultPrevented, true);
  key('ArrowLeft');
  assert.equal(page.run('sparkState.i'), 4);
  key('Home');
  assert.deepEqual(shown()[1].map((r) => r[1]), ['1 order\n', 'Apr 1']);
  key('ArrowLeft');
  assert.equal(page.run('sparkState.i'), 0, 'stays at the first');
  key('End');
  assert.deepEqual(page.run('said'), ['Sep 1 (still open today): 3 orders', 'Aug 1: 2 orders', 'Apr 1: 1 order', 'Apr 1: 1 order', 'Sep 1 (still open today): 3 orders']);
  assert.equal(key('Tab').defaultPrevented, false, 'other keys are left alone');
  key('Escape');
  assert.equal(page.run("fakeSpark.cls.has('hov')"), false);
  // A finger: a tap marks the nearest period at once, with no long-press list waiting.
  page.dispatch('pointerdown', { target: page.ctx.fakeSpark, pointerType: 'touch', clientX: xOf(1), clientY: 60 });
  assert.equal(page.run('tipState.press'), null);
  assert.equal(page.run('sparkState.i'), 1);
  assert.deepEqual(shown()[1].map((r) => r[1]), ['1 order\n', 'May 1']);
  page.dispatch('pointerup', { target: page.ctx.fakeSpark, pointerType: 'touch' });
  // The tap also focuses the figure (not from the keyboard): the bubble and the mark stay, and leave on their own timer.
  page.dispatch('focusin', { target: page.ctx.fakeSpark });
  assert.deepEqual([shown()[0], page.run("fakeSpark.cls.has('hov')")], [false, true]);
  assert.ok(page.run('!!sparkState.timer'), 'its own 4-second timer');
  // A scroll hides the bubble and takes the mark with it.
  page.dispatch('scroll', {});
  assert.equal(page.run("fakeSpark.cls.has('hov')"), false);
  // A swipe that starts on the line: the browser cancels the touch, and the mark goes at once.
  page.dispatch('pointerdown', { target: page.ctx.fakeSpark, pointerType: 'touch', clientX: xOf(3), clientY: 60 });
  assert.equal(page.run("fakeSpark.cls.has('hov')"), true);
  page.dispatch('pointercancel', { target: page.ctx.fakeSpark, pointerType: 'touch' });
  assert.equal(page.run("fakeSpark.cls.has('hov')"), false);
  assert.equal(page.run('tipState.el'), null);
  // Other tips still queue on hover as before.
  const other = page.run(`(()=>{const o={isConnected:true,getAttribute:k=>k==='data-tip'?'A tip':null,closest:s=>s==='[data-tip]'?o:null,matches:()=>false};globalThis.otherTip=o;return true})()`);
  assert.ok(other);
  page.dispatch('pointerover', { target: page.ctx.otherTip, pointerType: 'mouse' });
  assert.equal(page.run('tipState.pending===otherTip'), true);
  page.run('hideTip()');
  assert.deepEqual(page.errors, []);
});

run();
