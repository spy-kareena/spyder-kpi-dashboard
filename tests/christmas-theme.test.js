// Christmas Theme (2v9, owner's pick "Snowy Treeline"): the Settings key 'christmas' (Off by default) and its row in
// Pages & Display; applyTheme() puts data-xmas="on" on <html> (the boot script too, before the first paint) and removes it
// when off; the Snowy Treeline markup (aria-hidden, no strokes, a fixed seed) placed once right after the header; the
// CSS that shows it on screen only; the hidden snow (5 clicks on the header logo within 4 s, 5 s of snow, a new burst
// restarts it; nothing with the theme off) and a shared snapshot leaving all of it out.
// Run with `node tests/christmas-theme.test.js`. Fixtures are synthetic.
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { dataSource: 'import' };
const html = (page) => page.els['results-screen'].innerHTML;
const css = (from, to) => HTML.slice(HTML.indexOf(from), HTML.indexOf(to) + to.length);
const XMAS_CSS = css('/* 2v9:xmas */', '/* 2v9:end xmas */');
const T = 1_800_000_000_000; // a made-up clock for the logo clicks (ms)

// A page with an export loaded, the given settings saved, and a stand-in <html> that keeps data-* like the browser.
async function loaded(settings = {}) {
  const page = loadPage({ storage: { spyderKpiSettings: JSON.stringify({ ...IMPORT, ...settings }) } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport([sapRow()]) }]);
  Object.assign(page.ctx.document.documentElement, { dataset: {}, style: {} });
  return page;
}
// Timers the snow sets, kept instead of run, so a test can end the snow at once.
function holdTimers(page) {
  const timers = [];
  page.ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; };
  page.ctx.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; };
  return timers;
}
const stored = (page) => JSON.parse(page.storage.spyderKpiSettings || '{}');

test('the setting: Off by default, only off / on are taken, saved like every setting', async () => {
  const page = await loaded();
  assert.equal(page.run("stgValue('christmas')"), 'off');
  assert.equal(page.run("stgSpec().christmas.def()"), 'off');
  assert.equal(page.run("stgSpec().christmas.check('on')"), 'on');
  for (const bad of ["'yes'", 'true', '1', "'ON'"]) assert.equal(page.run(`stgSpec().christmas.check(${bad})`), undefined, bad);
  assert.equal(page.run("stgSet('christmas','maybe')"), false);
  assert.equal(page.run("stgSet('christmas','on')"), true);
  assert.equal(stored(page).christmas, 'on');
  assert.equal(page.run("stgValue('christmas')"), 'on');
  // Back to the default removes the key; a broken saved value reads as Off.
  page.run("stgSet('christmas','off')");
  assert.equal('christmas' in stored(page), false);
  const odd = await loaded({ christmas: 'snow' });
  assert.equal(odd.run("stgValue('christmas')"), 'off');
  // Reset to defaults puts it back to Off.
  const on = await loaded({ christmas: 'on' });
  on.run('stgResetAll()');
  assert.equal(on.run("stgValue('christmas')"), 'off');
  assert.equal(on.ctx.document.documentElement.dataset.xmas, undefined);
  assert.deepEqual(page.errors, []);
});

test('Settings > Pages & Display: a Christmas Theme row (Off | On) after Background; the Changed mark and the tip', async () => {
  const page = await loaded();
  page.run("setTab('settings')");
  let h = html(page);
  const card = h.slice(h.indexOf('id="stg-card-pages"'), h.indexOf('id="stg-card-hiddenpages"'));
  assert.match(card, /<span class="stg-label">Background<\/span>[\s\S]*?<\/div><\/div><div class="stg-row"><div class="stg-l"><span class="stg-label">Christmas Theme<\/span><\/div><div class="stg-ctl"><div class="dz-seg stg-seg" role="group" aria-label="Christmas Theme"><button type="button" data-focus-key="stg-christmas-off" class="on" aria-pressed="true" onclick="stgSet\(&#39;christmas&#39;,&#39;off&#39;\)">Off<\/button><button type="button" data-focus-key="stg-christmas-on" aria-pressed="false" onclick="stgSet\(&#39;christmas&#39;,&#39;on&#39;\)">On<\/button><\/div><\/div><\/div><div class="stg-row"><div class="stg-l"><span class="stg-label">Line lists start/);
  assert.match(card, /data-tip="Pages &amp; Display\n• Match system follows this device\n• Christmas Theme: snowy hills under the header, Santa on the Live SAP mark\n• Each line list/);
  assert.doesNotMatch(card, />Changed</);
  // Choosing On saves it, sets data-xmas at once and marks the card changed.
  page.run("stgSet('christmas','on')");
  assert.equal(page.ctx.document.documentElement.dataset.xmas, 'on');
  h = html(page);
  const card2 = h.slice(h.indexOf('id="stg-card-pages"'), h.indexOf('id="stg-card-hiddenpages"'));
  assert.match(card2, /data-focus-key="stg-christmas-on" class="on" aria-pressed="true"/);
  assert.match(card2, />Changed</);
  assert.deepEqual(page.errors, []);
});

test('applyTheme(): data-xmas="on" on <html> with the theme on, removed when off; the boot script does the same first', async () => {
  const page = await loaded();
  const root = page.ctx.document.documentElement;
  page.run('applyTheme()');
  assert.equal('xmas' in root.dataset, false);
  page.storage.spyderKpiSettings = JSON.stringify({ ...IMPORT, christmas: 'on' });
  page.run('stgMemo=undefined;applyTheme()');
  assert.equal(root.dataset.xmas, 'on');
  assert.equal(root.dataset.theme, 'light');
  // Choosing Off (stgSet, then stgAfterChange, as for a change made in another tab) removes it.
  page.run("stgSet('christmas','off')");
  assert.equal('xmas' in root.dataset, false);
  // A shared snapshot follows the viewer's own setting (nothing in the file decides it).
  page.run('isSnapshotView=true');
  page.storage.spyderKpiSettings = JSON.stringify({ christmas: 'on' });
  page.run('stgMemo=undefined;applyTheme()');
  assert.equal(root.dataset.xmas, 'on');
  assert.equal(page.run("stgSet('christmas','off')"), false, 'a snapshot keeps no settings');

  // The boot script at the top of <body>, run on its own: the saved setting, before the app runs.
  const boot = /<script id="thm-boot">([\s\S]*?)<\/script>/.exec(HTML)[1];
  const bootRun = (saved, had) => {
    const attrs = { ...(had ? { 'data-xmas': 'on' } : {}) };
    const documentElement = { style: {}, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
    vm.runInNewContext(boot, { document: { documentElement }, localStorage: { getItem: () => JSON.stringify(saved) }, window: {}, JSON });
    return attrs;
  };
  assert.equal(bootRun({ christmas: 'on' })['data-xmas'], 'on');
  assert.equal('data-xmas' in bootRun({}, true), false);
  assert.equal('data-xmas' in bootRun({ christmas: 'yes' }, true), false);
  assert.deepEqual(page.errors, []);
});

test('the Snowy Treeline: one aria-hidden drawing of hills and small pines, no strokes, the same every visit, placed once after the header', async () => {
  const page = await loaded();
  const svg = page.run('xmasRidgeSVG()');
  assert.equal(svg, page.run('xmasRidgeSVG()'), 'a fixed seed: the same ridge every time');
  assert.match(svg, /^<div class="xmas-ridge" aria-hidden="true"><svg viewBox="0 0 4800 40" preserveAspectRatio="xMidYMin slice" focusable="false">[\s\S]*<\/svg><\/div>$/);
  assert.doesNotMatch(svg, /stroke|<text|<title|tabindex|fill="/);
  // Layers in order: far pines, far hills, near pines, near hills (each hides the foot of the one before).
  const order = [...svg.matchAll(/class="(pine2|far|pine|near)"/g)].map((m) => m[1]).filter((c, i, a) => c !== a[i - 1]);
  assert.deepEqual(order, ['pine2', 'far', 'pine', 'near']);
  const pines = [...svg.matchAll(/<path class="pine2?" d="M([\d.]+) ([\d.-]+)L/g)].map((m) => [+m[1], +m[2]]);
  assert.ok(pines.length >= 30 && pines.length <= 120, `a few small pines over 4800px: ${pines.length}`);
  assert.ok(pines.every(([, top]) => top >= 3), 'no pine tip within 3px of the top (it stays under the header text)');
  // Hills are filled to the bottom, everything inside the 40px band.
  assert.match(svg, /<path class="far" d="M0 40V[\d.]+C/);
  assert.match(svg, /<path class="near" d="M0 40V[\d.]+C/);
  const ys = [...svg.matchAll(/ d="([^"]+)"/g)].flatMap((d) => [...d[1].matchAll(/[ CLM]([\d.-]+) ([\d.-]+)/g)].map((m) => +m[2]));
  assert.ok(ys.length > 300);
  assert.ok(ys.every((y) => y >= 0 && y <= 40), 'inside the band');

  // Mounted once, right after the header (not inside it: the header's markup is redrawn often).
  const inserted = [];
  Object.assign(page.ctx.document.getElementById('app-header'), { parentNode: {}, insertAdjacentHTML: (where, markup) => inserted.push([where, markup]) });
  let present = false;
  page.ctx.document.querySelector = (sel) => (sel === '.xmas-ridge' && present ? {} : null);
  page.run("stgSet('christmas','on')");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0][0], 'afterend');
  assert.equal(inserted[0][1], svg);
  present = true;
  page.run('applyTheme();applyTheme()');
  assert.equal(inserted.length, 1, 'not again while it is there');
  // Off does not draw it.
  const off = await loaded();
  const none = [];
  Object.assign(off.ctx.document.getElementById('app-header'), { parentNode: {}, insertAdjacentHTML: () => none.push(1) });
  off.run('applyTheme()');
  assert.equal(none.length, 0);
  assert.deepEqual(page.errors, []);
});

test('CSS: shown only on screen under data-xmas="on", after the header in the gap above the title, in page shades; nothing prints', () => {
  assert.ok(XMAS_CSS.length > 200);
  assert.ok(HTML.includes('/* 2v9:end po-recv */\n/* 2v9:xmas */'), 'the block sits right after the po-recv block');
  // Hidden by default and never clickable; shown only inside @media screen with the attribute.
  assert.match(XMAS_CSS, /\n\.xmas-ridge,\.xmas-snow\{display:none;pointer-events:none\}/);
  assert.match(XMAS_CSS, /@media screen\{\n {2}:root\[data-xmas="on"\] \.app-shell\{overflow-x:clip\}\n {2}:root\[data-xmas="on"\] \.xmas-ridge\{display:block;position:relative;z-index:0;height:0;margin-top:-22px\}\n {2}:root\[data-xmas="on"\] \.xmas-snow\{display:block\}/);
  assert.match(XMAS_CSS, /@media \(max-width:640px\)\{:root\[data-xmas="on"\] \.xmas-ridge\{margin-top:-18px\}\}/);
  // The column gap it cancels is the shell's own (22px, 18px on phones).
  assert.match(HTML, /\.app-col\{max-width:1440px;margin:0 auto;display:flex;flex-direction:column;gap:22px;min-width:0\}/);
  assert.match(HTML, /@media \(max-width:640px\)\{\.app-shell\{padding:12px 16px 36px\}\.app-col\{gap:18px\}/);
  // About 40px high (24px under a two-row header), fading out at the bottom.
  assert.match(XMAS_CSS, /\.xmas-ridge svg\{position:absolute;top:-10px;left:calc\(50% - 50vw\);display:block;width:100vw;height:40px;\n {2}-webkit-mask-image:linear-gradient\(#000 40%,transparent 74%\);mask-image:linear-gradient\(#000 40%,transparent 74%\)\}/);
  assert.match(XMAS_CSS, /@media \(max-width:900px\)\{\n {2}\.xmas-ridge svg\{top:-1px;height:24px;/);
  // Shades of the page background (color-mix with --dz-page), light and dark; no strokes, no plain white hills.
  for (const t of ['--xm-hill-far', '--xm-hill', '--xm-pine', '--xm-pine-2']) {
    const all = [...XMAS_CSS.matchAll(new RegExp(`${t}:([^;}]+)`, 'g'))].map((m) => m[1]);
    assert.equal(all.length, 2, t);
    for (const v of all) assert.match(v, /^color-mix\(in srgb,var\(--dz-page\),(#fff|var\(--dz-ink-1\)) [\d.]+%\)$/, `${t}: ${v}`);
  }
  assert.match(XMAS_CSS, /:root\[data-xmas="on"\]\[data-theme=dark\]\{/);
  assert.match(XMAS_CSS, /\.xmas-ridge \.far\{fill:var\(--xm-hill-far\)\}\.xmas-ridge \.near\{fill:var\(--xm-hill\)\}/);
  assert.doesNotMatch(XMAS_CSS, /stroke|@keyframes|animation:/);
  // Print and forced colours: none of it.
  assert.match(XMAS_CSS, /@media print\{\.xmas-ridge,\.xmas-snow\{display:none!important\}\}/);
  assert.match(XMAS_CSS, /@media \(forced-colors:active\)\{\.xmas-ridge,\.xmas-snow\{display:none!important\}\}/);
  // The snow: fixed, over the cards, under the filter row (40), the title row (45), the header (50), the AI panel (60),
  // tips (70) and the toast (80).
  assert.match(XMAS_CSS, /\.xmas-snow\{position:fixed;inset:0;z-index:39;width:100%;height:100%\}/);
  assert.match(HTML, /\.dz-filterrow\{[^}]*z-index:40\}/);
  assert.match(HTML, /\.dz-pagehead\{position:relative;z-index:45;/);
  assert.match(HTML, /\.app-header\{position:relative;z-index:50;/);
  // Reduced motion: the still snow keeps its short fade; taps on the logo do not zoom the page.
  assert.match(XMAS_CSS, /@media \(prefers-reduced-motion:reduce\)\{\.xmas-snow\.out\{transition-duration:\.6s!important\}\}/);
  assert.match(XMAS_CSS, /:root\[data-xmas="on"\] \.hdr-logo\{touch-action:manipulation\}/);
});

test('logo snow: 5 clicks within 4 s start it, 4 do not, 5 over 4.2 s do not, and nothing with the theme off', async () => {
  const page = await loaded({ christmas: 'on' });
  holdTimers(page);
  const click = (ms) => page.run(`xmasLogoClick(${T + ms})`);
  // 4 clicks: nothing.
  assert.deepEqual([0, 300, 600, 900].map(click), [false, false, false, false]);
  assert.equal(page.run('xmasSnowing()'), false);
  // 5 spread over 4.2 s: never 5 inside 4 s.
  const late = [10000, 11050, 12100, 13150, 14200].map(click);
  assert.deepEqual(late, [false, false, false, false, false]);
  assert.equal(page.run('xmasSnowing()'), false);
  // 5 within 4 s (the last exactly 4 s after the first): snow.
  const quick = [20000, 21000, 22000, 23000, 24000].map(click);
  assert.deepEqual(quick, [false, false, false, false, true]);
  assert.equal(page.run('xmasSnowing()'), true);
  assert.equal(page.run('xmasSnow.end'), T + 24000 + 5000);
  page.run('xmasSnowStop()');
  // Theme off: 5 quick clicks do nothing; turning it off also stops any snow.
  page.run("stgSet('christmas','off')");
  assert.deepEqual([30000, 30100, 30200, 30300, 30400].map(click), [false, false, false, false, false]);
  assert.equal(page.run('xmasSnowing()'), false);
  page.run("stgSet('christmas','on')");
  [40000, 40100, 40200, 40300, 40400].map(click);
  assert.equal(page.run('xmasSnowing()'), true);
  page.run("stgSet('christmas','off')");
  assert.equal(page.run('xmasSnowing()'), false);
  // Clicks before the theme went off do not count after it comes back.
  page.run("stgSet('christmas','on')");
  assert.deepEqual([50000, 50100, 50200, 50300].map(click), [false, false, false, false]);
  page.run("stgSet('christmas','off')");
  page.run("stgSet('christmas','on')");
  assert.equal(click(50400), false);
  assert.deepEqual(page.errors, []);
});

test('logo snow: it ends after 5 s; a new burst while it snows starts the 5 s again', async () => {
  const page = await loaded({ christmas: 'on' });
  const timers = holdTimers(page);
  const burst = (ms) => [0, 100, 200, 300, 400].map((d) => page.run(`xmasLogoClick(${T + ms + d})`)).pop();
  assert.equal(burst(0), true);
  const first = timers.filter((t) => t.ms === 5000);
  assert.equal(first.length, 1, 'one 5 s timer');
  // 3 s in, a new burst: still the same snow, now ending 5 s after the new burst; the old timer is cleared.
  assert.equal(burst(3000), true);
  assert.equal(page.run('xmasSnowing()'), true);
  assert.equal(page.run('xmasSnow.end'), T + 3400 + 5000);
  assert.equal(first[0].cleared, true);
  const second = timers.filter((t) => t.ms === 5000 && !t.cleared);
  assert.equal(second.length, 1);
  // The old timer would not end the new snow early; the new one ends it.
  second[0].fn();
  assert.equal(page.run('xmasSnowing()'), false);
  assert.deepEqual(page.errors, []);
});

test('logo snow: clicks on the logo reach it through one listener on the page (Enter and taps send clicks too)', async () => {
  const page = await loaded({ christmas: 'on' });
  holdTimers(page);
  const capture = page.listeners.filter((l) => l.type === 'click' && l.capture);
  assert.ok(capture.length >= 1, 'a capturing click listener');
  const logo = { closest: (s) => (s === '.hdr-logo' ? logo : null) };
  const other = { closest: () => null };
  for (let i = 0; i < 4; i++) page.dispatch('click', { target: logo });
  page.dispatch('click', { target: other });
  assert.equal(page.run('xmasSnowing()'), false, 'a click elsewhere does not count');
  page.dispatch('click', { target: logo });
  assert.equal(page.run('xmasSnowing()'), true);
  page.run('xmasSnowStop()');
  // The header's own logo link is unchanged: it still opens Sales Order Health.
  page.run('renderSidebar()');
  assert.match(page.els['app-header'].innerHTML, /^<a class="hdr-logo" href="\.\/" aria-label="Spyder Controls Corp, Sales Order Health" onclick="event\.preventDefault\(\);dzMenuClose\(\);setTab\('weekly'\)">/);
  assert.doesNotMatch(page.els['app-header'].innerHTML, /xmas/);
  assert.deepEqual(page.errors, []);
});

test('the snow draws soft, small, round flakes for its colours; it is one fixed canvas, made only in a browser', async () => {
  const page = await loaded({ christmas: 'on' });
  holdTimers(page);
  // No canvas in this test page: the snow still runs its clock (and ends) without drawing.
  page.run(`xmasSnowStart(${T})`);
  assert.equal(page.run('xmasSnowing()'), true);
  assert.equal(page.run('xmasSnow.canvas'), null);
  page.run('xmasSnowStop()');
  // Computed colours become rgba() for the canvas, with the rim's alpha.
  assert.equal(page.run("xmasRgba('rgb(255, 255, 255)',1)"), 'rgba(255,255,255,1)');
  assert.equal(page.run("xmasRgba('rgb(65, 86, 108)',.46)"), 'rgba(65,86,108,0.46)');
  assert.equal(page.run("xmasRgba('rgba(16, 34, 50, 0.5)',.5)"), 'rgba(16,34,50,0.25)');
  assert.equal(page.run("xmasRgba('color(srgb 1 0.5 0)',1)"), 'rgba(255,128,0,1)');
  assert.equal(page.run("xmasRgba('oklab(0.5 0.1 0.1)',1)"), '');
  // Flakes: 2 to 5px across, at most 0.84 opaque, about 1 per 6500px² (52 to 160), a fixed canvas that is removed.
  const src = HTML.slice(HTML.indexOf('function xmasSnowDraw'), HTML.indexOf('// ===== end 2v9 Christmas Theme ====='));
  assert.match(src, /const r=1\.1\+Math\.random\(\)\*1\.4;/);
  assert.match(src, /a:\.72\+Math\.random\(\)\*\.12/);
  assert.match(src, /Math\.max\(52,Math\.min\(160,W\*H\/6500\)\)/);
  assert.match(src, /c\.className='xmas-snow';\n {2}c\.setAttribute\('aria-hidden','true'\);/);
  assert.match(src, /s\.still=!motionAllowed\(\);/);
  assert.match(src, /requestAnimationFrame\(tick\)/);
  assert.deepEqual(page.errors, []);
});

test('a shared snapshot file leaves out data-xmas, the treeline and the snow', async () => {
  const page = await loaded({ christmas: 'on' });
  const removed = [];
  const attrs = { 'data-xmas': 'on', 'data-theme': 'light' };
  const node = (name) => ({ remove: () => removed.push(name) });
  const body = { classList: { remove() {} }, appendChild() {} };
  page.ctx.document.documentElement.cloneNode = () => ({
    removeAttribute: (k) => { delete attrs[k]; },
    querySelectorAll: (sel) => (sel === '.xmas-ridge,.xmas-snow' ? [node('ridge'), node('snow')] : []),
    querySelector: (sel) => (sel === 'body' ? body : null),
    get outerHTML() { return `<html ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}></html>`; },
  });
  page.run('applyTheme()');
  const out = page.run("buildSnapshotHtml({encoding:'json',text:'{}'})");
  assert.equal(out, '<!DOCTYPE html>\n<html data-theme="light"></html>');
  assert.deepEqual(removed, ['ridge', 'snow']);
  assert.equal(page.ctx.document.documentElement.dataset.xmas, 'on', 'the page itself keeps it');
  assert.deepEqual(page.errors, []);
});

test('the user guide names the switch and what it adds (not the hidden snow)', () => {
  const doc = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'docs', 'USER_QUICK_START.md'), 'utf8');
  assert.match(doc, /\*\*Christmas Theme\*\*/);
  assert.match(doc, /Pages & Display/);
  assert.doesNotMatch(doc, /five clicks|5 clicks|click the logo|snow falls|easter egg/i);
});

run();
