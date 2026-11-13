// The Christmas live mark (2v9): santaMark draws Santa in his sleigh with two reindeer for the header's date button and
// the live popover line, after the standard live mark; the 2v9:santa CSS shows him in place of that mark only with
// <html data-xmas="on"> on screen without forced colours. ok flies (no green dot), down lands once on the change from ok
// (Santa stands and smiles, a red crossed circle after him), '' is parked. Live mode runs through the real
// functions/api/sap function and a stand-in bridge, as in sap-live.test.js. Synthetic data only.
// Run: node tests/christmas-santa.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HTML, loadPage, createSuite } = require('./harness');

const { test, run } = createSuite();
const CSS = HTML.match(/<style[^>]*>([\s\S]*?)<\/style>/g).join('\n');
const START = '/* 2v9:santa */';
const END = '/* end 2v9:santa */';
const BLOCK = CSS.slice(CSS.indexOf(START), CSS.indexOf(END) + END.length);

// --- Live mode on a page (the same stand-ins as sap-live.test.js) ------------------------------------------------
const ORIGIN = 'https://kpi.example.test';
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const until = async (fn, what) => { for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise((r) => setImmediate(r)); } assert.fail(`timed out: ${what}`); };
const BRIDGE_KPI = fs.readFileSync(path.join(__dirname, '..', 'samples', 'sample-so-po.csv'), 'utf8').trim().split(/\r?\n/).map((l) => l.split(',').join('\t')).join('\r\n') + '\r\n';
const ENV = { SAP_BRIDGE_URL: 'https://sap-bridge.example.test', SAP_BRIDGE_KEY: 'bridge-key' };
const SD_HEAD = ['ExportDate', 'ItemCode', 'ItemDescription', 'ItemGroupName', 'WarehouseCode', 'WarehouseName', 'MonthStart', 'YearMonth', 'DemandOpenQty', 'DemandNoCommitQty', 'DemandOpenValue', 'UsableSupplyQty', 'RescheduledSupplyQty', 'UnconfirmedSupplyQty', 'NoCommitSupplyQty', 'LateSupplyQty', 'RiskSupplyQty', 'DemandOrderCount', 'MonthlyNetQty', 'CumulativeNetQty', 'MonthlyCoverageStatus', 'CumulativeCoverageStatus', 'SupplyRiskFlag'];
const SD_FULL = [SD_HEAD.join('\t'), ['2026-09-10', 'SPY-100', 'Controller board', 'Electronics', '01', 'Spyder - Lacombe', '2026-09-01', '2026-09', '10', '0', '12500', '4', '0', '0', '0', '0', '0', '2', '-6', '-6', 'Short', 'Short', 'OK'].join('\t')].join('\r\n') + '\r\n';

let sapApi;
const api = async () => {
  if (!sapApi) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'api', 'sap', '[[path]].js'), 'utf8');
    sapApi = (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).onRequest;
  }
  return sapApi;
};
function liveSite() {
  const site = { calls: [], down: false, bridge: { kpi: { status: 200, body: BRIDGE_KPI, headers: { 'x-refreshed-at': '2026-09-24T09:58:00-06:00', 'x-row-count': '5' } }, 'supply-demand': { status: 200, body: SD_FULL } } };
  globalThis.fetch = async (url) => {
    const name = new URL(String(url)).pathname.replace('/api/reports/', '');
    if (site.down) throw new TypeError('fetch failed');
    const r = site.bridge[name] || { status: 404, body: '{"error":"unknown"}' };
    const headers = r.status === 200
      ? { 'content-type': 'text/tab-separated-values; charset=utf-8', 'content-disposition': `attachment; filename="SAP_live_${name === 'kpi' ? 'KPI' : 'supply_demand'}_2026-09-24.txt"`, ...(r.headers || {}) }
      : { 'content-type': 'application/json' };
    return new Response(r.body, { status: r.status, headers });
  };
  site.fetch = async (url, init = {}) => {
    const u = String(url);
    site.calls.push(`${init.method || 'GET'} ${u}`);
    if (!u.startsWith('/api/sap/')) return new Response('', { status: 404 });
    const handler = await api();
    const p = u.replace('/api/sap/', '').split('?')[0];
    return handler({ request: new Request(ORIGIN + u, init), env: ENV, params: { path: p.split('/') } });
  };
  return site;
}
// A page started as the browser does, in live mode (the default); reads of 30 s or more wait for timers.fire().
async function openLive(site) {
  const page = loadPage({ storage: {} });
  await tick();
  Object.assign(page.ctx, {
    fetch: site.fetch, Blob, File, Response,
    location: { href: ORIGIN + '/', protocol: 'https:' },
    FileReader: class {
      readAsArrayBuffer(f) { (ArrayBuffer.isView(f.bytes) ? Promise.resolve(f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength)) : f.arrayBuffer()).then((b) => this.onload({ target: { result: b } })); }
      readAsText(f) { (ArrayBuffer.isView(f.bytes) ? Promise.resolve(Buffer.from(f.bytes).toString('utf8')) : f.text()).then((t) => this.onload({ target: { result: t } })); }
    },
  });
  page.run('isSnapshotView=false');
  const held = [];
  page.ctx.setTimeout = (fn, ms, ...a) => { if (ms >= 30000) { const t = { fn, ms, a }; held.push(t); return t; } return setTimeout(fn, ms, ...a); };
  page.ctx.clearTimeout = (t) => { const i = held.indexOf(t); if (i >= 0) held.splice(i, 1); else clearTimeout(t); };
  page.fire = () => { const t = held.find((x) => x.fn === page.ctx.liveTick); assert.ok(t, 'a live read is scheduled'); held.splice(held.indexOf(t), 1); t.fn(); };
  const mem = (db) => (mode, use) => Promise.resolve(use({ put: (v, k) => { db[k] = v; return { result: k }; }, get: (k) => ({ result: db[k] }) }).result);
  page.ctx.liveStore = mem({});
  page.ctx.reportStore = mem({});
  page.run('loadEmbeddedSnapshot=()=>{}');
  page.ctx.startApp();
  await until(() => !page.run('liveState.busy') && ['ok', 'down', 'off'].includes(page.run('liveState.status')), 'live start');
  await settle();
  return page;
}
const header = (page) => page.els['app-header'].innerHTML;
// The page clock santaMark reads (performance.now), set by the test.
const clock = (page, ms) => page.run(`globalThis.__now=${ms};globalThis.performance={now:()=>globalThis.__now}`);
const marks = (h) => [...h.matchAll(/<svg class="santa-mark[^"]*"[^>]*>/g)].map((m) => m[0]);
const cls = (svg) => svg.match(/class="([^"]+)"/)[1];

// --- santaMark itself ------------------------------------------------------------------------------------------
test('santaMark: ok flies, down stands with a red crossed circle after him, anything else is parked; hidden from screen readers', () => {
  const page = loadPage();
  clock(page, 5000);
  const ok = page.run("santaMark('ok')");
  assert.match(ok, /^<svg class="santa-mark ok" viewBox="0 0 84 30" style="--sm-t:-5\.000s" aria-hidden="true" focusable="false">/);
  assert.ok(ok.endsWith('</svg>'));
  assert.equal(ok.match(/<svg/g).length, 1, 'one drawing, no crossed circle');
  // The parts the CSS moves: the team (bob), three sparkles, two reindeer with four legs each, the lead's nose and its
  // glow, Santa in the seat (hat tip, sack) and Santa standing (smile), the ground.
  for (const part of ['sm-ground', 'sm-team', 'sm-bob', 'sm-trail', 'sm-rein', 'sm-seat', 'sm-tip', 'sm-sack', 'sm-sleigh', 'sm-runner', 'sm-out', 'sm-smile']) assert.ok(ok.includes(`class="${part}"`), part);
  assert.equal(ok.match(/class="sm-spark"/g).length, 3, 'three sparkles');
  assert.equal(ok.match(/<g class="sm-deer/g).length, 2, 'two reindeer');
  assert.equal(ok.match(/<g class="sm-deer sm-lead"/g).length, 1, 'one lead');
  for (const leg of ['sm-f1', 'sm-f2', 'sm-h1', 'sm-h2']) assert.equal(ok.match(new RegExp(`class="sm-leg ${leg}"`, 'g')).length, 2, leg);
  assert.equal(ok.match(/class="sm-nose"/g).length, 1, 'the lead\'s nose only');
  assert.equal(ok.match(/class="sm-glow"/g).length, 1);
  page.run('santaTone=null');
  const down = page.run("santaMark('down')");
  assert.match(down, /^<svg class="santa-mark down" viewBox="0 0 84 30" style="--sm-t:-5\.000s" aria-hidden="true" focusable="false">[\s\S]*<\/svg><svg class="santa-x" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1\.7" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="4\.6"\/><path d="M3\.9 3\.9l4\.2 4\.2M8\.1 3\.9L3\.9 8\.1"\/><\/svg>$/);
  assert.match(BLOCK, /\.santa-x\{[^}]*color:var\(--dz-risk\)/, 'the crossed circle is the down red');
  for (const t of ["''", 'undefined', "'busy'"]) {
    const parked = page.run(`santaMark(${t})`);
    assert.match(parked, /^<svg class="santa-mark" viewBox="0 0 84 30" style="--sm-t:-5\.000s" aria-hidden="true" focusable="false">/, t);
    assert.ok(!parked.includes('santa-x'), t);
  }
  for (const svg of [ok, down].join('').match(/<svg[^>]*>/g)) assert.match(svg, /aria-hidden="true" focusable="false"/);
});

test('no green dot: the Santa mark has no dot, pulse or live green, and its colours come from the CSS', () => {
  const page = loadPage();
  clock(page, 1000);
  const ok = page.run("santaMark('ok')");
  assert.ok(!/live-pulse|live-ok|live-trace|dot|pulse/.test(ok), 'no standard mark or dot inside');
  assert.ok(!/fill="(?!none)|stroke="(?!currentColor)|#[0-9a-f]{3,6}\b/i.test(ok.replace(/<svg class="santa-x"[\s\S]*$/, '')), 'no colours in the markup');
  // Each circle is a named part (sparkles are four-point stars, not dots).
  const circles = [...ok.matchAll(/<circle([^>]*)>/g)].map((m) => (m[1].match(/class="([^"]+)"/) || [, 'sack'])[1]);
  assert.deepEqual([...new Set(circles)].sort(), ['sack', 'sm-eye', 'sm-glow', 'sm-nose', 'sm-skin', 'sm-skin-d', 'sm-tail', 'sm-white', 'sm-boot'].sort());
  assert.ok(!/--live-ok|teal|#007565|#2cc8b2|#0fa08e/i.test(BLOCK), 'the Santa CSS never uses the live green');
});

// --- In the header -----------------------------------------------------------------------------------------------
test('the date button and the live popover line hold both marks: the standard one first, then Santa; the labels still say the status', async () => {
  const site = liveSite();
  const page = await openLive(site);
  assert.equal(page.run('liveState.status'), 'ok');
  page.run("dzOpenMenu='hdr-file';renderSidebar()");
  const h = header(page);
  assert.match(h, /id="hdr-date-btn"[^>]*aria-label="Live · Updated [^"]+"[^>]*><svg class="live-pulse ok"[^>]*>[\s\S]*?<\/svg><svg class="santa-mark ok" viewBox="0 0 84 30" style="--sm-t:[^"]+" aria-hidden="true" focusable="false">[\s\S]*?<\/svg><span class="hdr-date-txt">10 Sep<\/span>/);
  const pop = h.slice(h.indexOf('id="hdr-file-pop"'));
  assert.match(pop, /<div class="live-pop-line"><svg class="live-pulse ok"[^>]*>[\s\S]*?<\/svg><svg class="santa-mark ok"[^>]*>[\s\S]*?<\/svg><span>Live SAP · Updated \d{1,2}:\d\d [AP]M<\/span><\/div>/);
  assert.equal(marks(h).length, 2, 'the button and the popover line');
  // Only those two places draw Santa: Settings > Data Source keeps the standard mark.
  assert.equal((HTML.match(/santaMark\(/g) || []).length, 3, 'the function and its two callers');
  assert.match(HTML, /const dot=st\.tone\?liveMark\(st\.tone\)\+santaMark\(st\.tone\):'';/);
  assert.match(HTML, /<div class="live-pop-line"\$\{[^}]+\}>\$\{liveMark\(st\.tone\)\}\$\{santaMark\(st\.tone,fileOpen\)\}<span>/, 'the popover line lands only while open');
  page.run("setTab('settings')");
  const res = page.els['results-screen'].innerHTML;
  assert.match(res, /id="stg-card-source"[\s\S]*<svg class="live-pulse ok"/);
  assert.ok(!res.includes('santa-mark'), 'no Santa in Settings');
  // Down: the standard red mark first, Santa (landing) and the crossed circle; the button's label says so in words.
  site.down = true;
  page.fire();
  await until(() => page.run('liveState.status') === 'down', 'down');
  assert.match(header(page), /aria-label="Disconnected · Showing data from [^"]+"[^>]*><svg class="live-pulse down"[^>]*>[\s\S]*?<\/svg><svg class="santa-mark down( landing)?"[^>]*>[\s\S]*?<\/svg><svg class="santa-x"[^>]*>[\s\S]*?<\/svg><span class="hdr-date-txt">/);
});

test('down: Santa lands once, when the link goes from ok to down; a redraw carries on or shows him landed, never replays', async () => {
  const site = liveSite();
  const page = await openLive(site);
  clock(page, 10000);
  page.run('renderSidebar()');
  // The button's mark, then the popover line's (drawn while the popover is closed too).
  const all = () => marks(header(page)).map(cls);
  assert.deepEqual(all(), ['santa-mark ok', 'santa-mark ok']);
  site.down = true;
  page.fire();
  await until(() => page.run('liveState.status') === 'down', 'down');
  // The button's Santa lands; the closed popover's is drawn landed (it would only start moving when opened).
  const landed = marks(header(page));
  assert.deepEqual(landed.map(cls), ['santa-mark down landing', 'santa-mark down']);
  assert.match(landed[0], /style="--sm-t:-10\.000s;--sm-land:-0\.000s"/, 'from the start');
  // A redraw 0.3 s in, now with the popover open: both land, 0.3 s along (no restart).
  clock(page, 10300);
  page.run("dzOpenMenu='hdr-file';renderSidebar()");
  assert.deepEqual(all(), ['santa-mark down landing', 'santa-mark down landing']);
  for (const svg of marks(header(page))) assert.match(svg, /--sm-land:-0\.300s"/);
  // Redraws after the landing (0.9 s), with the same tone: the landed pose, no landing class, again and again.
  for (const ms of [11000, 15000, 60000]) {
    clock(page, ms);
    page.run('renderSidebar()');
    assert.deepEqual(all(), ['santa-mark down', 'santa-mark down'], `at ${ms}`);
    assert.ok(!header(page).includes('--sm-land'), `at ${ms}`);
  }
  // The retry fails again: still down, no replay.
  page.fire();
  await until(() => !page.run('liveState.busy') && page.run('liveState.fails') === 2, 'second failure');
  assert.deepEqual(all(), ['santa-mark down', 'santa-mark down']);
  // Back up, then down again: it lands again.
  site.down = false;
  page.fire();
  await until(() => page.run('liveState.status') === 'ok', 'back');
  assert.deepEqual(all(), ['santa-mark ok', 'santa-mark ok']);
  clock(page, 70000);
  site.down = true;
  page.fire();
  await until(() => page.run('liveState.status') === 'down', 'down again');
  assert.deepEqual(all(), ['santa-mark down landing', 'santa-mark down landing'], 'the popover is still open');
});

test('after the landing the class comes off every mark still carrying it, so a mark shown later does not replay it', async () => {
  const page = loadPage();
  clock(page, 3000);
  const removed = [];
  const el = { classList: { remove: (c) => removed.push(c) }, style: { removeProperty: (p) => removed.push(p) } };
  page.ctx.document.querySelectorAll = (s) => (s === '.santa-mark.landing' ? [el] : []);
  page.run("santaMark('ok')");
  assert.equal(page.run('santaLandTimer===null'), true, 'no timer while flying');
  assert.equal(cls(page.run("santaMark('down',false)")), 'santa-mark down', 'land=false: drawn landed');
  assert.equal(page.run('santaLandAt'), 3000, 'the landing has begun all the same');
  assert.equal(cls(page.run("santaMark('down')")), 'santa-mark down landing');
  assert.equal(page.run('santaLandTimer!==null'), true, 'one timer for the end of the landing');
  await new Promise((r) => setTimeout(r, page.run('SANTA_LAND_MS') + 150));
  assert.deepEqual(removed, ['landing', '--sm-land']);
  assert.equal(page.run('santaLandTimer===null'), true);
});

test('no landing without a flight first: starting down, or connecting then down, shows Santa standing straight away', () => {
  const page = loadPage();
  clock(page, 2000);
  page.run('santaTone=null');
  assert.equal(cls(page.run("santaMark('down')")), 'santa-mark down', 'first draw down');
  page.run('santaTone=null');
  page.run("santaMark('')");
  assert.equal(cls(page.run("santaMark('down')")), 'santa-mark down', 'parked, then down');
  page.run("santaMark('ok')");
  assert.equal(cls(page.run("santaMark('down')")), 'santa-mark down landing', 'ok, then down');
  assert.equal(cls(page.run("santaMark('down')")), 'santa-mark down landing', 'a redraw in the same instant carries on');
  clock(page, 2000 + page.run('SANTA_LAND_MS'));
  assert.equal(cls(page.run("santaMark('down')")), 'santa-mark down', 'done');
});

// --- The CSS -----------------------------------------------------------------------------------------------------
test('CSS: Santa shows and the standard mark hides only under [data-xmas="on"], on screen without forced colours, in two places', () => {
  assert.ok(CSS.indexOf(START) > 0 && CSS.indexOf(END) > CSS.indexOf(START));
  assert.ok(CSS.includes(`@media (forced-colors:active){.live-pulse{forced-color-adjust:none}}\n${START}`), 'right after the live mark\'s forced-colours line');
  assert.match(BLOCK, /\n\.santa-mark,\.santa-x\{display:none\}\n/, 'hidden by default');
  // Every rule that hides the standard mark or shows Santa: inside a screen + (forced-colors:none) block, each selector
  // under :root[data-xmas=on] and in the date button or the popover line.
  const rules = [];
  const re = /@media ([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g;
  let m;
  while ((m = re.exec(BLOCK))) for (const r of m[2].matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ media: m[1], sel: r[1].trim(), body: r[2] });
  const hides = rules.filter((r) => r.sel.includes('.live-pulse') && /display:none/.test(r.body));
  const shows = rules.filter((r) => /santa-(mark|x)/.test(r.sel) && /display:block/.test(r.body));
  assert.equal(hides.length, 2);
  assert.equal(shows.length, 2);
  for (const r of [...hides, ...shows]) {
    assert.match(r.media, /^screen and \(forced-colors:none\)/, r.sel);
    for (const s of r.sel.split(',')) assert.match(s, /^:root\[data-xmas=on\] (#hdr-date-btn|\.live-pop-line) \.(live-pulse|santa-mark|santa-x)$/, s);
  }
  // Nowhere else in the block, and nowhere outside it, is the standard mark hidden or Santa shown.
  const outside = BLOCK.replace(/@media [^{]+\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
  assert.ok(!/live-pulse[^{}]*\{[^}]*display:none/.test(outside));
  assert.ok(!/santa-(mark|x)[^{}]*\{[^}]*display:block/.test(outside));
  assert.ok(!CSS.replace(BLOCK, '').includes('santa-'), 'no Santa rules outside the block');
  // Phones: the date button holds Santa from 360 px (widened there); narrower ones keep the standard mark.
  const btn = rules.filter((r) => r.sel.includes('#hdr-date-btn') && /display/.test(r.body));
  for (const r of btn) assert.match(r.media, /\(min-width:360px\)/);
  assert.match(BLOCK, /\(min-width:360px\) and \(max-width:420px\)\{\n {2}:root\[data-xmas=on\] \.hdr-right \.hdr-date\.has-live\{width:auto;/);
  // The standard mark itself is untouched.
  assert.match(CSS, /\.live-pulse\.ok \.live-trace\{animation:live-draw 2\.2s cubic-bezier\(\.45,\.05,\.55,\.95\) infinite\}/);
});

test('CSS: the loops run on the page clock, the landing once; reduced motion shows still poses; print keeps the standard mark', () => {
  const anims = [...BLOCK.matchAll(/animation:([^;}]+)/g)].map((x) => x[1]);
  const loops = anims.filter((a) => a.includes('infinite'));
  assert.ok(loops.length >= 6, 'bob, legs, hat tip, sack, sparkles, nose');
  for (const a of loops) assert.match(a, /var\(--sm-t,0s\)/, a);
  for (const a of anims.filter((x) => !x.includes('infinite') && !x.startsWith('none'))) assert.match(a, /var\(--sm-land,0s\)[^;]* both$/, a);
  assert.match(BLOCK, /\.santa-mark\.landing \.sm-out\{animation:sm-step /, 'Santa steps out only while landing');
  assert.ok(!/\.santa-mark\.down [^{]*\{[^}]*animation/.test(BLOCK), 'nothing moves in the plain down pose');
  // The owner's "more animated": legs gallop in 0.7 s, the team bobs and glides in 3.6 s.
  assert.match(BLOCK, /\.santa-mark\.ok \.sm-leg\{animation:sm-fore \.7s /);
  assert.match(BLOCK, /\.santa-mark\.ok \.sm-h1,\.santa-mark\.ok \.sm-h2\{animation-name:sm-hind\}/);
  assert.match(BLOCK, /\.santa-mark\.ok \.sm-bob\{animation:sm-bob 3\.6s /);
  // Still poses (what reduced motion shows): flying for ok, standing (and smiling) for down.
  assert.match(BLOCK, /@media \(prefers-reduced-motion:reduce\)\{\.santa-mark,\.santa-mark \*\{animation:none!important\}\}/);
  assert.match(BLOCK, /\.santa-mark\.ok \.sm-team\{transform:translate\(0,-4\.5px\) rotate\(-6deg\)\}/);
  assert.match(BLOCK, /\.santa-mark\.ok \.sm-leg\{transform:rotate\(var\(--sm-a\)\)\}/);
  assert.match(BLOCK, /\.santa-mark\.down \.sm-seat\{opacity:0\}\n\.santa-mark\.down \.sm-out\{opacity:1\}/);
  assert.match(BLOCK, /@media print\{\.santa-mark,\.santa-x\{display:none!important\}\}/);
  // Dark mode gets its own Santa colours; the sleigh and reindeer follow the ink and page colours.
  assert.match(BLOCK, /\[data-theme=dark\]\{--sm-red:#e0656d;/);
  assert.match(BLOCK, /--sm-sleigh:color-mix\(in oklab,var\(--dz-ink-2\) 92%,var\(--dz-page\)\)/);
});

run();
