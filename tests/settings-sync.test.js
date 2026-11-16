// Settings that follow the person (Cloudflare Access): behind Access, personal settings (how the board looks and opens)
// are kept in the person's account (GET / PUT /api/prefs) and the rules behind the numbers are team settings, one copy
// for everyone (GET / PUT /api/team-settings), that only admins change. Without a sign-in, a file copy or a shared
// snapshot, nothing is asked and settings stay in the browser as before.
// Run with `node tests/settings-sync.test.js`. Fixtures are synthetic (no SAP data); no network (fetch is a fake of the
// hosted site that follows the endpoints' contract; the last test runs the real functions/api handlers over a Workers KV
// stand-in).
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const ORIGIN = 'https://kpi.example.test';
const EMAIL = 'aaron.joseph@spyder.example';
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
// The servers' error body: {v:1, error:{code, message}}.
const fail = (status, message) => json({ v: 1, error: { code: status, message } }, status);
const ME_USER = { v: 1, auth: { access: true, password: false }, user: { email: EMAIL, name: 'Aaron Joseph' }, logoutUrl: '/logout', admin: false, teamSettings: true };
const ME_NONE = { v: 1, auth: { access: false, password: true }, user: null, logoutUrl: '/logout', admin: false, teamSettings: false };
const TEAM_KEYS = ['atRiskTarget', 'toleranceDays', 'horizon', 'otdGoalSales', 'otdGoalVendors', 'noteCommentsSo', 'noteCommentsPo'];
const PERSONAL_KEYS = ['theme', 'background', 'christmas', 'linesShown', 'openingView', 'linesStart', 'importReport', 'dataSource', 'startPage', 'poOpeningView', 'hiddenPages'];

// The hosted site. prefs: the account's copy (null = none yet); team: the team settings record (null = the endpoint
// answers 404); admin: canEdit. fail: status codes the next PUTs answer with, in turn (0 = no network).
function fakeSite({ me = ME_USER, prefs = null, team = { enabled: false }, admin = false } = {}) {
  const site = { me, prefs, team, admin, calls: [], puts: [], fail: { prefs: [], team: [] }, reject: '' };
  site.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    site.calls.push(`${method} ${url}`);
    if (url === '/api/me') {
      if (site.me === 'down') throw new TypeError('Failed to fetch');
      return site.me === 404 ? notFound() : json(site.me);
    }
    if (url === '/cdn-cgi/access/get-identity') return notFound();
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === 'PUT') site.puts.push({ url, body, keepalive: !!init.keepalive });
    if (url === '/api/prefs') {
      if (!site.me || !site.me.user) return fail(401, 'Personal settings need the company sign-in.');
      if (method === 'GET') return json({ v: 1, prefs: site.prefs, savedAt: site.prefs ? '2026-11-10T09:00:00Z' : null });
      const f = site.fail.prefs.shift();
      if (f === 0) throw new TypeError('Failed to fetch');
      if (f) return fail(f, 'Storage is busy.');
      site.prefs = body.prefs;
      return json({ v: 1, saved: true, prefs: site.prefs, savedAt: '2026-11-16T10:00:00Z' });
    }
    if (url === '/api/team-settings') {
      if (!site.team) return notFound();
      if (method === 'GET') return json({ v: 1, history: [], savedAt: null, savedBy: null, settings: null, ...site.team, canEdit: site.admin });
      const f = site.fail.team.shift();
      if (f === 0) throw new TypeError('Failed to fetch');
      if (f) return fail(f, 'Storage is busy.');
      if (!site.admin) return fail(403, 'Only admins can change team settings.');
      if (site.reject) return fail(400, site.reject);
      const t = site.team;
      if (body.reset) t.settings = null;
      else t.settings = { ...(t.settings || {}), ...body.settings };
      t.savedAt = '2026-11-16T10:00:00Z';
      t.savedBy = EMAIL;
      t.history = [{ at: t.savedAt, by: EMAIL, keys: body.reset ? ['reset'] : Object.keys(body.settings) }, ...(t.history || [])];
      return json({ v: 1, saved: true, settings: t.settings, savedAt: t.savedAt, savedBy: t.savedBy });
    }
    return notFound();
  };
  site.asked = (re = /\/api\/(prefs|team-settings)/) => site.calls.filter((c) => re.test(c));
  return site;
}
// A browser on the hosted site (or a file copy), with its own localStorage (settings as given, Import files so uploads
// work). The harness opens every page as an empty shared snapshot; a real page is not one.
async function openPage(site, { settings = {}, storage = {}, protocol = 'https:', snapshot = false, fast = true } = {}) {
  if (!('spyderKpiSettings' in storage)) storage.spyderKpiSettings = JSON.stringify({ dataSource: 'import', ...settings });
  const page = loadPage({ storage });
  await tick(0);
  Object.assign(page.ctx, { fetch: site.fetch, Response, location: { href: protocol === 'file:' ? 'file:///C:/kpi/index.html' : `${ORIGIN}/`, protocol } });
  page.run(`isSnapshotView=${snapshot};rowOverrides=loadRowOverrides()`);
  if (fast) page.run('STG_TIMING.save=40;STG_TIMING.retry=40');
  return page;
}
// Signed in and the settings read (accessLoad waits for them); then anything it started (an upload, a seed) settles.
async function signIn(page) {
  await page.ctx.accessLoad();
  await settle(page);
}
async function settle(page) {
  for (let i = 0; i < 200; i++) {
    await tick(10);
    if (page.run('!stgAcct.timer&&!stgAcct.busy&&(!stgTeam||(!stgTeam.timer&&!stgTeam.busy))')) return;
  }
  throw new Error('settings never settled');
}
const kpi = () => ({ name: 'kpi.xls', bytes: sapExport([sapRow({ DocumentNumber: '900', 'Internal Number': '900' })]) });
const html = (page) => page.els['results-screen'].innerHTML;
const settingsPage = (page) => { page.run("setTab('settings')"); return html(page); };
const sec = (h, id) => { const at = h.indexOf(`<section class="stg-sec" id="stg-sec-${id}"`); return at < 0 ? '' : h.slice(at, h.indexOf('</section>', at)); };
// One settings row (from its label to the end of its control).
const row = (h, label) => { const at = h.indexOf(`>${label}</`); assert.ok(at > 0, `row ${label}`); const a = h.lastIndexOf('<div class="stg-row', at); return h.slice(a, h.indexOf('</div></div>', at) + 12); };
const status = (h) => (h.match(/<div class="stg-status rise" id="stg-status">[\s\S]*?<\/p><\/div>/) || [''])[0].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const stored = (page) => JSON.parse(page.storage.spyderKpiSettings || '{}');
const TEAM_TIP = 'data-tip="Applies to everyone. Only admins can change it."';
const ADMIN_TIP = 'data-tip="Applies to everyone. You&#39;re an admin, so your change is saved for the whole team."';

test('personal settings: the account\'s copy goes over this browser\'s (theme and the rest), bad, unknown and team keys skipped; the browser keeps a copy', async () => {
  const prefs = { theme: 'dark', background: 'mint', christmas: 'on', linesShown: 50, hiddenPages: ['warehouses'], startPage: 'shipping', poOpeningView: 'received',
    openingView: 'sideways', linesStart: 7, atRiskTarget: 20, noteCommentsSo: ['From the account'], favouriteColour: 'green', dataSource: 'import' };
  const site = fakeSite({ prefs });
  const page = await openPage(site, { settings: { theme: 'light', linesShown: 20, atRiskTarget: 12, openingView: 'lagging' } });
  await upload(page, [kpi()]);
  page.run("setTab('settings')");
  await signIn(page);
  assert.deepEqual(site.asked(), ['GET /api/prefs', 'GET /api/team-settings']);
  const v = page.run(`Object.fromEntries(${JSON.stringify([...PERSONAL_KEYS, 'atRiskTarget', 'noteCommentsSo'])}.map(k=>[k,stgValue(k)]))`);
  assert.equal(v.theme, 'dark');
  assert.equal(page.run('thmIsDark()'), true, 'the theme applies at once');
  assert.equal(v.background, 'mint');
  assert.equal(v.christmas, 'on');
  assert.equal(v.linesShown, 50);
  assert.deepEqual(v.hiddenPages, ['warehouses']);
  assert.equal(v.startPage, 'shipping');
  assert.equal(v.poOpeningView, 'received');
  assert.equal(v.openingView, 'lagging', 'a bad value is skipped: this browser\'s stays');
  assert.equal(v.linesStart, 'folded');
  assert.equal(v.atRiskTarget, 12, 'a team key in personal settings is ignored');
  assert.equal(v.noteCommentsSo.includes('From the account'), false);
  assert.equal(v.dataSource, 'import', 'the data source is not switched by the account copy (the page opens on Live SAP)');
  assert.equal(page.run("stgValue('favouriteColour')"), undefined);
  // The browser keeps a copy (the next open starts with it), with the 2v9 hidden-page flags of a choice made.
  const s = stored(page);
  assert.equal(s.theme, 'dark');
  assert.equal(s.linesShown, 50);
  assert.deepEqual(s.hiddenPages, ['warehouses']);
  assert.equal(s.hiddenMonthly2v69, true);
  assert.equal(s.atRiskTarget, 12);
  // Nothing goes back up: the account's copy is what this browser has now.
  assert.deepEqual(site.puts, []);
  // Settings on screen is drawn again: where settings are kept.
  assert.equal(status(html(page)), `Your settings are saved to your account (${EMAIL}).`);
  assert.doesNotMatch(html(page), /stg-team|Rows marked Team/, 'team settings are off on this site');
  assert.deepEqual(page.errors, []);
});

test('first sign-in: an account with none takes this browser\'s personal settings, once; no email, no team key', async () => {
  const site = fakeSite();
  const settings = { theme: 'dark', linesShown: 20, hiddenPages: ['warehouses'], hiddenSupply2v69: true, hiddenMonthly2v69: true, atRiskTarget: 12, noteCommentsPo: ['Vendor late'] };
  const page = await openPage(site, { settings });
  await signIn(page);
  assert.equal(site.puts.length, 1);
  const { url, body } = site.puts[0];
  assert.equal(url, '/api/prefs');
  assert.deepEqual(Object.keys(body), ['prefs']);
  assert.deepEqual(Object.keys(body.prefs).sort(), [...PERSONAL_KEYS].sort(), 'every personal key and nothing else');
  assert.equal(body.prefs.theme, 'dark');
  assert.equal(body.prefs.linesShown, 20);
  assert.deepEqual(body.prefs.hiddenPages, ['warehouses']);
  assert.equal(body.prefs.background, 'blue', 'defaults are sent too');
  for (const k of TEAM_KEYS) assert.ok(!(k in body.prefs), k);
  assert.ok(!JSON.stringify(body).includes(EMAIL) && !/aaron|joseph/i.test(JSON.stringify(body)), 'never who you are');
  // The next open (another browser, say) gets them; nothing is uploaded again.
  const next = await openPage(site, { settings: { theme: 'light' } });
  await signIn(next);
  assert.equal(site.puts.length, 1);
  assert.equal(next.run("stgValue('theme')"), 'dark');
  assert.equal(next.run("stgValue('linesShown')"), 20);
  assert.equal(next.run("stgValue('atRiskTarget')"), 5, 'team keys stay per browser while team settings are off');
  assert.deepEqual(page.errors, []);
});

test('later changes: one PUT about 800 ms after the last change, every personal key, never a team key; one retry; never in the way', async () => {
  const site = fakeSite({ prefs: { theme: 'light' } });
  const page = await openPage(site, { fast: false });
  await signIn(page);
  assert.equal(page.run('STG_TIMING.save'), 800);
  page.run("stgSet('theme','dark');stgSet('linesShown',50)");
  assert.equal(page.run("stgValue('theme')"), 'dark', 'in use at once');
  assert.match(page.els.toast.innerHTML, /Saved/);
  await tick(500);
  assert.deepEqual(site.puts, [], 'nothing sent before the delay');
  page.run("stgSet('christmas','on')"); // a change restarts the delay
  await tick(500);
  assert.deepEqual(site.puts, []);
  await tick(450);
  await settle(page);
  assert.equal(site.puts.length, 1, 'one PUT for the three changes');
  assert.deepEqual(Object.keys(site.puts[0].body.prefs).sort(), [...PERSONAL_KEYS].sort());
  assert.deepEqual([site.puts[0].body.prefs.theme, site.puts[0].body.prefs.linesShown, site.puts[0].body.prefs.christmas], ['dark', 50, 'on']);
  assert.ok(!JSON.stringify(site.puts).includes(EMAIL));

  page.run('STG_TIMING.save=40;STG_TIMING.retry=40');
  // A team key with team settings off: this browser only, nothing sent.
  page.run("stgSet('atRiskTarget',9)");
  await tick(80);
  await settle(page);
  assert.equal(site.puts.length, 1);
  assert.equal(stored(page).atRiskTarget, 9);
  assert.equal(page.run('AT_RISK_TARGET'), 9);
  // The header's theme button, a page switch, Import settings and Reset to defaults all go to the account.
  page.run('hdrThemeToggle()');
  await settle(page);
  assert.equal(site.prefs.theme, 'light');
  page.run("stgTogglePage('warehouses')");
  await settle(page);
  assert.ok(!site.prefs.hiddenPages.includes('warehouses'));
  page.run('FileReader=class{readAsText(f){this.result=f.text;this.onload();}}');
  page.run(`stgImport({files:[{text:${JSON.stringify(JSON.stringify({ settings: { background: 'peach', atRiskTarget: 30 } }))}}],value:''})`);
  await settle(page);
  assert.equal(site.prefs.background, 'peach');
  assert.ok(!('atRiskTarget' in site.prefs));
  page.run('stgResetAll()');
  await settle(page);
  assert.equal(site.prefs.background, 'blue');
  assert.equal(site.prefs.theme, 'light');
  const sent = site.puts.length;
  // A failed save is sent once more; a second failure says so in a toast; the page carries on either way.
  site.fail.prefs = [503];
  page.run("stgSet('background','grey')");
  await tick(60);
  await settle(page);
  assert.equal(site.puts.length, sent + 2);
  assert.equal(site.prefs.background, 'grey');
  site.fail.prefs = [0, 503];
  page.run("stgSet('background','mint')");
  await tick(60);
  await settle(page);
  assert.equal(site.puts.length, sent + 4);
  assert.equal(site.prefs.background, 'grey');
  assert.match(page.els.toast.innerHTML, /Not saved to your account: this browser keeps the change/);
  assert.equal(page.run("stgValue('background')"), 'mint');
  assert.equal(stored(page).background, 'mint');
  // A change still waiting when the page is hidden goes at once (keepalive).
  page.run("STG_TIMING.save=60000;stgSet('linesShown',20)");
  page.ctx.document.visibilityState = 'hidden';
  page.dispatch('visibilitychange', {});
  await tick(20);
  const last = site.puts[site.puts.length - 1];
  assert.equal(last.keepalive, true);
  assert.equal(last.body.prefs.linesShown, 20);
  assert.equal(page.run('stgAcct.timer'), null);
  assert.deepEqual(page.errors, []);
});

test('team settings on, not an admin: the team\'s values count instead of this browser\'s, the rows are read only, a change goes nowhere', async () => {
  const team = { enabled: true, settings: { atRiskTarget: 8, horizon: 'm2', otdGoalSales: 85, noteCommentsPo: ['Waiting on vendor'] }, savedAt: '2026-11-14T15:00:00Z', savedBy: 'pat.lee@spyder.example',
    history: [{ at: '2026-11-14T15:00:00Z', by: 'pat.lee@spyder.example', keys: ['atRiskTarget', 'horizon'] }] };
  const site = fakeSite({ prefs: { theme: 'light' }, team });
  const page = await openPage(site, { settings: { atRiskTarget: 12, toleranceDays: 4, horizon: 'w2', otdGoalVendors: 70, noteCommentsSo: ['Mine'] } });
  await upload(page, [kpi()]);
  assert.equal(page.run('AT_RISK_TARGET'), 12);
  assert.equal(page.run('ohRiskTone(10)'), 'good');
  await signIn(page);
  // The numbers: the team's values, the defaults where the team has none.
  assert.deepEqual(page.run('[AT_RISK_TARGET,ON_TRACK_TOLERANCE_DAYS,OTD_GOAL_SALES,OTD_GOAL_VENDORS,stgHorizonLabel()]'), [8, 2, 85, 90, 'next 2 months']);
  assert.equal(page.run('ohRiskTone(10)'), 'warning', 'the same amber as everyone');
  assert.equal(page.run('ohAtRiskData(currentMetrics()).target'), 8, 'the metrics are counted again');
  assert.deepEqual(page.run('NOTE_COMMENTS_PO'), ['Waiting on vendor']);
  assert.deepEqual(page.run('NOTE_COMMENTS_SO'), page.run('NOTE_COMMENTS_SO_DEFAULT'));
  // This browser's own values stay in its store (they come back without team settings), unused.
  assert.equal(stored(page).atRiskTarget, 12);
  // A change to a team key: refused, nothing changes, nothing is sent.
  assert.equal(page.run("stgSet('atRiskTarget',20)"), false);
  assert.match(page.els.toast.innerHTML, /Set by your admin/);
  page.run("stgNumChange({value:'3'},'toleranceDays',0,14);stgAddComment('so',{querySelector:()=>({value:'New one',focus(){}})});stgResetList('po')");
  await tick(80);
  await settle(page);
  assert.deepEqual(page.run('[AT_RISK_TARGET,ON_TRACK_TOLERANCE_DAYS]'), [8, 2]);
  assert.deepEqual(page.run('NOTE_COMMENTS_PO'), ['Waiting on vendor']);
  assert.equal(stored(page).atRiskTarget, 12);
  assert.deepEqual(site.asked(/PUT/), []);
  // Settings: the status line, the Team chips, the read-only controls with "Set by your admin".
  const h = settingsPage(page);
  assert.equal(status(h), `Your settings are saved to your account (${EMAIL}). Rows marked Team apply to everyone and only admins can change them. Team settings last changed by Pat Lee on Nov 14, 2026.`);
  assert.match(h, /<span class="stg-status-when" data-tip="Recent team changes\n• Nov 14, 2026, Pat Lee: At-risk target, Look-ahead window">/);
  const sales = sec(h, 'sales');
  for (const [label, id] of [['At-risk target', 'stg-target'], ['On-track tolerance', 'stg-tolerance'], ['Look-ahead window', 'stg-horizon'], ['On-time goal', 'stg-otdGoalSales']]) {
    const r = row(sales, label);
    assert.match(r, /^<div class="stg-row stg-team-row"><div class="stg-l"><span class="stg-lt"><label class="stg-label" for="[^"]+">[^<]+<\/label><span class="dz-chip stg-team" data-tip="Applies to everyone\. Only admins can change it\."><svg class="stg-team-ico"[^>]*>[\s\S]*?<\/svg>Team<\/span><\/span>/, label);
    assert.match(r, /<span class="stg-team-hint"><svg[\s\S]*?<\/svg>Set by your admin<\/span>/, label);
    assert.match(r, new RegExp(`id="${id}"[^>]* disabled`), `${label} is read only`);
  }
  assert.match(sec(h, 'sales'), /value="8"/);
  for (const label of ['Lines a page', 'Opening view']) {
    const r = row(sales, label);
    assert.doesNotMatch(r, /stg-team|disabled/, `${label} is personal`);
  }
  const po = sec(h, 'po');
  assert.ok(row(po, 'On-time goal').includes(TEAM_TIP));
  assert.match(row(po, 'On-time goal'), /id="stg-otdGoalVendors"[^>]* disabled/);
  assert.doesNotMatch(row(po, 'Opening view'), /stg-team|disabled/);
  const notes = sec(h, 'notes');
  assert.ok(row(notes, 'Ready-made comments').includes(TEAM_TIP));
  assert.match(notes, /class="stg-x print-hide"[^>]*data-tip="Set by your admin\."[^>]* disabled>×/);
  assert.match(notes, /data-focus-key="stg-add-so" autocomplete="off" disabled><button type="submit" class="dz-btn" data-focus-key="stg-add-btn-so" disabled>Add/);
  assert.doesNotMatch(notes, /Reset list/);
  assert.doesNotMatch(sec(h, 'display'), /stg-team|disabled/);
  // About: Export, Import and Reset cover your own settings; no Reset team settings.
  const about = sec(h, 'about');
  assert.match(about, /data-focus-key="stg-export" onclick="stgExport\(\)" data-tip="Save your own settings to a file; team settings and your name are left out\."/);
  assert.match(about, /data-focus-key="stg-import" onclick="stgImportPick\(\)" data-tip="Load your own settings from a file; team settings in it are skipped\."/);
  assert.match(about, /<span class="stg-help">Your own settings back to their defaults\. Team settings stay\.<\/span>/);
  assert.doesNotMatch(about, /stg-team-reset/);
  page.run('stgExport()');
  const file = JSON.parse(page.blobs[page.blobs.length - 1].parts.join(''));
  assert.deepEqual(Object.keys(file.settings).sort(), [...PERSONAL_KEYS].sort());
  page.run('FileReader=class{readAsText(f){this.result=f.text;this.onload();}}');
  page.run(`stgImport({files:[{text:${JSON.stringify(JSON.stringify({ settings: { atRiskTarget: 30, linesShown: 20 } }))}}],value:''})`);
  assert.deepEqual(page.run("[stgValue('atRiskTarget'),stgValue('linesShown')]"), [8, 20]);
  assert.equal(stored(page).atRiskTarget, 12);
  page.run('stgResetAll()');
  assert.equal(page.run("stgValue('linesShown')"), 10);
  assert.equal(stored(page).atRiskTarget, 12, 'Reset leaves the team keys alone');
  await settle(page);
  assert.deepEqual(site.asked(/PUT \/api\/team/), []);
  assert.ok(site.puts.every((p) => TEAM_KEYS.every((k) => !(k in p.body.prefs))));
  assert.deepEqual(page.errors, []);
});

test('an admin: a change counts at once and is sent for everyone after the delay, only the keys changed; "Saved for everyone"', async () => {
  const team = { enabled: true, settings: { atRiskTarget: 8 }, savedAt: '2026-11-14T15:00:00Z', savedBy: 'Pat Lee', history: [] };
  const site = fakeSite({ prefs: { theme: 'light' }, team, admin: true, me: { ...ME_USER, admin: true } });
  const page = await openPage(site, { settings: { atRiskTarget: 12 } });
  await upload(page, [kpi()]);
  await signIn(page);
  let h = settingsPage(page);
  assert.ok(row(sec(h, 'sales'), 'At-risk target').includes(ADMIN_TIP));
  assert.doesNotMatch(sec(h, 'sales'), /Set by your admin|id="stg-target"[^>]* disabled/);
  assert.match(sec(h, 'notes'), /data-focus-key="stg-add-btn-so">Add/);
  page.run("stgNumChange({value:'10'},'atRiskTarget',1,50)");
  assert.equal(page.run('AT_RISK_TARGET'), 10, 'counted again at once');
  assert.equal(page.run('ohAtRiskData(currentMetrics()).target'), 10);
  assert.match(html(page), /id="stg-target"[^>]*value="10"/);
  page.run("stgSet('horizon','w6')");
  page.run("stgSet('linesShown',20)"); // a personal key: the account, not the team
  assert.deepEqual(site.asked(/PUT/), []);
  await tick(80);
  await settle(page);
  const teamPuts = site.puts.filter((p) => p.url === '/api/team-settings');
  assert.deepEqual(teamPuts.map((p) => p.body), [{ settings: { atRiskTarget: 10, horizon: 'w6' } }], 'only the changed keys');
  assert.deepEqual(site.team.settings, { atRiskTarget: 10, horizon: 'w6' });
  assert.ok(site.puts.filter((p) => p.url === '/api/prefs').every((p) => !('atRiskTarget' in p.body.prefs)));
  assert.match(page.els.toast.innerHTML, /Saved for everyone/);
  assert.equal(stored(page).atRiskTarget, 12, 'not written to this browser\'s own settings');
  h = settingsPage(page);
  assert.match(status(h), /Team settings last changed by you on Nov 16, 2026\.$/);
  // The comment lists too.
  page.run("stgAddComment('po',{querySelector:()=>({value:'Waiting on vendor',focus(){}})})");
  await tick(80);
  await settle(page);
  assert.deepEqual(site.team.settings.noteCommentsPo.slice(-1), ['Waiting on vendor']);
  assert.deepEqual(site.puts.filter((p) => p.url === '/api/team-settings').pop().body, { settings: { noteCommentsPo: page.run('NOTE_COMMENTS_PO') } });
  assert.deepEqual(page.errors, []);
});

test('an admin\'s change refused (400 names the value, 403 not an admin): back to the server\'s value, with the message', async () => {
  const team = { enabled: true, settings: { atRiskTarget: 8 }, savedAt: '2026-11-14T15:00:00Z', savedBy: 'Pat Lee', history: [] };
  const site = fakeSite({ team, admin: true, prefs: { theme: 'light' } });
  const page = await openPage(site);
  await upload(page, [kpi()]);
  await signIn(page);
  site.reject = 'atRiskTarget: use a whole number from 1 to 40.';
  page.run("stgSet('atRiskTarget',45)");
  assert.equal(page.run('AT_RISK_TARGET'), 45);
  await tick(80);
  await settle(page);
  assert.equal(page.run('AT_RISK_TARGET'), 8, 'back to the server\'s value');
  assert.match(page.els.toast.innerHTML, /Not saved for everyone: atRiskTarget: use a whole number from 1 to 40\./);
  let h = settingsPage(page);
  assert.match(h, /id="stg-target"[^>]*value="8"/);
  assert.match(status(h), /The last team change was not saved: atRiskTarget: use a whole number from 1 to 40\.$/);
  // The next change that saves clears it.
  site.reject = '';
  page.run("stgSet('atRiskTarget',9)");
  await tick(80);
  await settle(page);
  assert.doesNotMatch(status(settingsPage(page)), /not saved/);
  // 403: no longer an admin. Back to the server's value; the controls become read only.
  site.admin = false;
  page.run("stgSet('toleranceDays',6)");
  await tick(80);
  await settle(page);
  assert.equal(page.run('ON_TRACK_TOLERANCE_DAYS'), 2);
  assert.match(page.els.toast.innerHTML, /Not saved for everyone: Only admins can change team settings\./);
  h = settingsPage(page);
  assert.match(h, /id="stg-tolerance"[^>]* disabled/);
  assert.match(row(sec(h, 'sales'), 'On-track tolerance'), /Set by your admin/);
  // A server that cannot be reached: sent once more, then back with a message.
  site.admin = true;
  page.run("stgTeam.canEdit=true");
  site.fail.team = [0, 429];
  page.run("stgSet('otdGoalSales',80)");
  await tick(150);
  await settle(page);
  assert.equal(site.puts.filter((p) => p.url === '/api/team-settings' && p.body.settings && p.body.settings.otdGoalSales === 80).length, 2);
  assert.equal(page.run('OTD_GOAL_SALES'), 90);
  assert.match(page.els.toast.innerHTML, /Not saved for everyone: Storage is busy\./);
  assert.deepEqual(page.errors, []);
});

test('seeding: an admin whose team has never saved any saves this browser\'s team values for everyone, once', async () => {
  const site = fakeSite({ team: { enabled: true, settings: null }, admin: true, prefs: { theme: 'light' } });
  const local = { atRiskTarget: 12, toleranceDays: 4, otdGoalVendors: 75, noteCommentsPo: ['Vendor late'] };
  const page = await openPage(site, { settings: local });
  await upload(page, [kpi()]);
  await signIn(page);
  const seeds = site.puts.filter((p) => p.url === '/api/team-settings');
  assert.equal(seeds.length, 1);
  assert.deepEqual(Object.keys(seeds[0].body.settings).sort(), [...TEAM_KEYS].sort());
  assert.deepEqual([seeds[0].body.settings.atRiskTarget, seeds[0].body.settings.toleranceDays, seeds[0].body.settings.horizon, seeds[0].body.settings.otdGoalVendors, seeds[0].body.settings.noteCommentsPo], [12, 4, 'm1', 75, ['Vendor late']]);
  assert.equal(page.run('AT_RISK_TARGET'), 12, 'the admin\'s setup carries over');
  assert.equal(site.team.settings.atRiskTarget, 12);
  assert.doesNotMatch(page.els.toast.innerHTML, /Saved for everyone/, 'quietly');
  // Everyone else now gets them; nobody seeds again.
  const other = await openPage(site, { settings: { atRiskTarget: 30 } });
  site.admin = false;
  await signIn(other);
  assert.equal(other.run('AT_RISK_TARGET'), 12);
  site.admin = true;
  const again = await openPage(site, { settings: { atRiskTarget: 40 } });
  await signIn(again);
  assert.equal(site.puts.filter((p) => p.url === '/api/team-settings').length, 1);
  assert.equal(again.run('AT_RISK_TARGET'), 12);

  // No team settings yet and not an admin: the defaults, nothing sent.
  const fresh = fakeSite({ team: { enabled: true, settings: null }, admin: false, prefs: { theme: 'light' } });
  const viewer = await openPage(fresh, { settings: { atRiskTarget: 12 } });
  await signIn(viewer);
  assert.equal(viewer.run('AT_RISK_TARGET'), 5);
  assert.deepEqual(fresh.asked(/PUT \/api\/team/), []);
  // A team reset (settings null, but a date and a history) is not seeded again; nor is a browser that had team settings.
  const reset = fakeSite({ team: { enabled: true, settings: null, savedAt: '2026-11-15T08:00:00Z', savedBy: 'Pat Lee', history: [{ at: '2026-11-15T08:00:00Z', by: 'Pat Lee', keys: ['reset'] }] }, admin: true, prefs: { theme: 'light' } });
  const admin2 = await openPage(reset, { settings: { atRiskTarget: 12 } });
  await signIn(admin2);
  assert.equal(admin2.run('AT_RISK_TARGET'), 5);
  const seen = fakeSite({ team: { enabled: true, settings: null }, admin: true, prefs: { theme: 'light' } });
  const admin3 = await openPage(seen, { settings: { atRiskTarget: 12 }, storage: { spyderKpiTeamSeenV1: '1' } });
  await signIn(admin3);
  assert.deepEqual([reset.asked(/PUT \/api\/team/), seen.asked(/PUT \/api\/team/)], [[], []]);
  assert.deepEqual(page.errors, []);
});

test('Reset team settings (admins): asks in the page, no confirm dialog; Cancel keeps them; Reset for everyone sends {reset:true}', async () => {
  const team = { enabled: true, settings: { atRiskTarget: 8, horizon: 'w2' }, savedAt: '2026-11-14T15:00:00Z', savedBy: 'Pat Lee', history: [] };
  const site = fakeSite({ team, admin: true, prefs: { theme: 'light' } });
  const page = await openPage(site, { settings: { atRiskTarget: 12 } });
  let dialogs = 0;
  page.ctx.confirm = () => { dialogs++; return true; };
  await upload(page, [kpi()]);
  await signIn(page);
  let about = sec(settingsPage(page), 'about');
  assert.match(about, /<span class="stg-label">Team settings<\/span><span class="stg-help">Back to the defaults for everyone\.<\/span><\/div><div class="stg-ctl"><button type="button" class="dz-btn stg-reset print-hide" data-focus-key="stg-team-reset" onclick="stgTeamResetAsk\(true\)" data-tip="Put every team setting back to its default for everyone\. Asks first\.">Reset team settings<\/button>/);
  assert.equal(about.split('data-focus-key="stg-reset-all"').length - 1, 1, 'Reset to defaults is still there, once');
  page.run('stgTeamResetAsk(true)');
  about = sec(html(page), 'about');
  assert.match(about, /<div class="stg-btns stg-ask print-hide" role="group" aria-label="Reset team settings for everyone\?"><span class="stg-ask-q">Reset for everyone\?<\/span><button type="button" class="dz-btn stg-danger" data-focus-key="stg-team-reset-yes" onclick="stgTeamReset\(\)" data-tip="Every team setting goes back to its default for everyone\.">Reset for everyone<\/button><button type="button" class="dz-btn" data-focus-key="stg-team-reset-no" onclick="stgTeamResetAsk\(false\)" data-tip="Keep the team settings as they are\.">Cancel<\/button><\/div>/);
  assert.doesNotMatch(about, /data-focus-key="stg-team-reset"/);
  page.run('stgTeamResetAsk(false)');
  assert.match(sec(html(page), 'about'), /data-focus-key="stg-team-reset"/);
  assert.deepEqual(site.asked(/PUT \/api\/team/), []);
  page.run('stgTeamResetAsk(true)');
  await page.run('stgTeamReset()');
  assert.deepEqual(site.puts.filter((p) => p.url === '/api/team-settings').map((p) => p.body), [{ reset: true }]);
  assert.equal(dialogs, 0, 'no confirm() dialog');
  assert.deepEqual(page.run('[AT_RISK_TARGET,stgHorizonLabel()]'), [5, 'next month']);
  assert.match(page.els.toast.innerHTML, /Team settings are back to their defaults for everyone/);
  about = sec(html(page), 'about');
  assert.match(about, /data-focus-key="stg-team-reset" onclick="stgTeamResetAsk\(true\)" disabled data-tip="Every team setting is at its default\."/);
  assert.equal(stored(page).atRiskTarget, 12, 'this browser\'s own value stays (unused)');
  // Not an admin: no Reset team settings, and asking does nothing.
  const viewer = await openPage(fakeSite({ team: { ...team }, admin: false, prefs: { theme: 'light' } }));
  await signIn(viewer);
  assert.doesNotMatch(sec(settingsPage(viewer), 'about'), /stg-team-reset/);
  viewer.run('stgTeamResetAsk(true)');
  assert.doesNotMatch(sec(html(viewer), 'about'), /Reset for everyone/);
  assert.deepEqual(page.errors, []);
});

test('team settings off, or no sign-in: today\'s settings; no /api/prefs or /api/team-settings without Access', async () => {
  // Signed in, team settings off on this site (enabled false, or /api/me says so): team keys stay per browser.
  for (const [me, team, asked] of [[ME_USER, { enabled: false }, ['GET /api/prefs', 'GET /api/team-settings']], [{ ...ME_USER, teamSettings: false }, { enabled: true, settings: { atRiskTarget: 8 } }, ['GET /api/prefs']], [{ ...ME_USER, teamSettings: undefined }, null, ['GET /api/prefs', 'GET /api/team-settings']]]) {
    const site = fakeSite({ me, team, prefs: { theme: 'light' } });
    const page = await openPage(site, { settings: { atRiskTarget: 12 } });
    await signIn(page);
    const what = JSON.stringify([me.teamSettings, team]);
    assert.deepEqual(site.asked(), asked, what);
    assert.equal(page.run('AT_RISK_TARGET'), 12, what);
    page.run("stgSet('atRiskTarget',9)");
    assert.equal(page.run('AT_RISK_TARGET'), 9, what);
    assert.equal(stored(page).atRiskTarget, 9, what);
    await tick(80);
    await settle(page);
    assert.deepEqual(site.asked(/PUT/), [], what);
    const h = settingsPage(page);
    assert.doesNotMatch(h, /stg-team|Rows marked Team|Set by your admin/, what);
    assert.equal(status(h), `Your settings are saved to your account (${EMAIL}).`, what);
    assert.match(sec(h, 'about'), /data-tip="Save settings to a file; your name is left out\."/);
  }
  // No sign-in (the shared password, /api/me missing or down): only /api/me is asked; settings stay in this browser.
  for (const me of [ME_NONE, 404, 'down']) {
    const site = fakeSite({ me, team: { enabled: true, settings: { atRiskTarget: 8 } }, prefs: { theme: 'dark' } });
    const page = await openPage(site, { settings: { atRiskTarget: 12 } });
    await signIn(page);
    page.run("stgSet('theme','dark');stgSet('atRiskTarget',9)");
    await tick(80);
    await settle(page);
    assert.deepEqual(site.asked(/\/api\/(me|prefs|team-settings)/), ['GET /api/me'], JSON.stringify(me));
    assert.equal(page.run('AT_RISK_TARGET'), 9);
    assert.equal(status(settingsPage(page)), 'Settings are saved in this browser.');
  }
  // The account cannot be reached when the page opens: this browser's copy, said plainly; nothing is sent.
  const down = fakeSite({ prefs: { theme: 'dark' } });
  down.fetch = ((inner) => async (url, init) => (url === '/api/prefs' ? json({ error: 'down' }, 503) : inner(url, init)))(down.fetch);
  const page = await openPage(down, { settings: { theme: 'light' } });
  await signIn(page);
  assert.equal(page.run("stgValue('theme')"), 'light');
  page.run("stgSet('linesShown',20)");
  await tick(80);
  await settle(page);
  assert.deepEqual(down.asked(/PUT/), []);
  assert.equal(status(settingsPage(page)), 'Your account could not be reached, so your settings are saved in this browser for now.');
  assert.deepEqual(page.errors, []);
});

test('a shared snapshot and a file copy ask nothing and keep today\'s settings; the next open counts with the team settings seen last', async () => {
  const site = fakeSite({ team: { enabled: true, settings: { atRiskTarget: 8 } }, prefs: { theme: 'dark' } });
  const file = await openPage(site, { protocol: 'file:', settings: { atRiskTarget: 12 } });
  await file.ctx.accessLoad();
  file.run('loadEmbeddedSnapshot=()=>{};startApp()');
  const snap = await openPage(site, { snapshot: true, settings: { atRiskTarget: 12 }, storage: { spyderKpiAccessIdV1: JSON.stringify({ email: EMAIL, name: 'Aaron Joseph' }), spyderKpiTeamSettingsV1: JSON.stringify({ settings: { atRiskTarget: 8 } }) } });
  await snap.ctx.accessLoad();
  snap.run('startApp()');
  await tick(30);
  assert.deepEqual(site.calls, []);
  assert.equal(file.run('AT_RISK_TARGET'), 12);
  assert.equal(snap.run('AT_RISK_TARGET'), 12, 'a snapshot never uses team settings kept in this browser');
  assert.equal(snap.run('stgTeam'), null);
  snap.run("setTab('settings')");
  assert.doesNotMatch(html(snap), /stg-status/);
  assert.match(html(snap), /<p class="stg-ro rise">Shared snapshot: settings are read only\./);
  file.run("setTab('settings')");
  assert.equal(status(html(file)), 'Settings are saved in this browser.');

  // Signed in once: the team settings are kept here; the next open starts counting with them before the server answers.
  const first = await openPage(site, { settings: { atRiskTarget: 12 } });
  await signIn(first);
  const storage = { ...first.storage };
  assert.deepEqual(JSON.parse(storage.spyderKpiTeamSettingsV1).settings, { atRiskTarget: 8 });
  const next = await openPage(site, { storage: { ...storage } });
  assert.equal(next.run('AT_RISK_TARGET'), 12);
  next.run('stgTeamBoot()');
  assert.equal(next.run('AT_RISK_TARGET'), 8, 'counted with the team settings seen last');
  // The server then says there is no sign-in any more: this browser's values again, the kept copy dropped.
  site.me = ME_NONE;
  await next.ctx.accessLoad();
  assert.equal(next.run('AT_RISK_TARGET'), 12);
  assert.equal(next.storage.spyderKpiTeamSettingsV1, undefined);
  // Without a remembered sign-in the kept copy is not used.
  const plain = await openPage(site, { storage: { spyderKpiSettings: JSON.stringify({ dataSource: 'import', atRiskTarget: 12 }), spyderKpiTeamSettingsV1: storage.spyderKpiTeamSettingsV1 } });
  plain.run('stgTeamBoot()');
  assert.equal(plain.run('AT_RISK_TARGET'), 12);
  assert.deepEqual(next.errors, []);
});

// The page against the real handlers (functions/api/me.js, prefs.js, team-settings.js) over a Workers KV stand-in, as
// the middleware would call them for a person Cloudflare Access signed in.
function kvStore() {
  const map = new Map();
  return {
    async get(k, opts = {}) {
      if (!map.has(k)) return null;
      const text = map.get(k);
      return (typeof opts === 'string' ? opts : opts.type) === 'json' ? JSON.parse(text) : text;
    },
    async put(k, v) { map.set(k, String(v)); },
    async delete(k) { map.delete(k); },
  };
}
function realSite({ admins = 'pat.lee@spyder.example' } = {}) {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const env = { REPORT_STORE: kvStore(), ADMIN_EMAILS: admins };
  const handlers = {};
  const site = { env, calls: [], bodies: [] };
  site.browser = (email, name) => async (url, init = {}) => {
    const method = init.method || 'GET';
    site.calls.push(`${method} ${url}`);
    const file = { '/api/me': 'me', '/api/prefs': 'prefs', '/api/team-settings': 'team-settings' }[url];
    if (!file) return notFound();
    if (!handlers[file]) ({ onRequest: handlers[file] } = await import(pathToFileURL(path.join(__dirname, '..', 'functions', 'api', `${file}.js`)).href));
    if (method !== 'GET') site.bodies.push({ url, body: JSON.parse(init.body) });
    const headers = { ...(init.headers || {}), ...(method === 'GET' ? {} : { Origin: ORIGIN }) };
    const data = { auth: { access: true, password: false }, user: { via: 'access', email, name } };
    return handlers[file]({ request: new Request(ORIGIN + url, { method, body: init.body, headers }), env, data, params: {} });
  };
  return site;
}
async function openReal(site, email, name, settings) {
  const page = await openPage({ fetch: site.browser(email, name) }, { settings });
  await signIn(page);
  return page;
}

test('with the real endpoints: first sign-in and seeding, an admin\'s change for everyone, read only for others, a refused value, reset', async () => {
  const site = realSite();
  // The admin's first visit: their own settings go to their account, their team values become the team's.
  const admin = await openReal(site, 'pat.lee@spyder.example', 'Pat Lee', { theme: 'dark', atRiskTarget: 12, horizon: 'w6' });
  assert.equal(admin.run('stgTeam.canEdit'), true);
  assert.equal(admin.run('AT_RISK_TARGET'), 12);
  assert.deepEqual(site.bodies.map((b) => b.url).sort(), ['/api/prefs', '/api/team-settings']);
  // Another person: their theme from this browser goes to their account; the team's values count for them, read only.
  const viewer = await openReal(site, EMAIL, 'Aaron Joseph', { theme: 'light', atRiskTarget: 30, linesShown: 20 });
  assert.equal(viewer.run('stgTeam.canEdit'), false);
  assert.deepEqual(viewer.run('[AT_RISK_TARGET,stgHorizonLabel(),stgValue("linesShown")]'), [12, 'next 6 weeks', 20]);
  let h = settingsPage(viewer);
  assert.match(status(h), /^Your settings are saved to your account \(aaron\.joseph@spyder\.example\)\. Rows marked Team apply to everyone and only admins can change them\. Team settings last changed by Pat Lee on [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/);
  assert.match(h, /id="stg-target"[^>]* disabled/);
  // The admin changes the target: saved for everyone; the viewer's next open counts with it.
  admin.run("stgSet('atRiskTarget',9)");
  await tick(80);
  await settle(admin);
  assert.match(admin.els.toast.innerHTML, /Saved for everyone/);
  assert.deepEqual(site.bodies[site.bodies.length - 1], { url: '/api/team-settings', body: { settings: { atRiskTarget: 9 } } });
  const viewer2 = await openReal(site, EMAIL, 'Aaron Joseph', { theme: 'dark' });
  assert.equal(viewer2.run('AT_RISK_TARGET'), 9);
  assert.equal(viewer2.run("stgValue('theme')"), 'light', 'the account\'s theme wins over this browser\'s');
  assert.equal(viewer2.run("stgValue('linesShown')"), 20);
  // A value the page takes but the server would not (the server's message is shown): back to the server's value.
  admin.run("stgTeam.settings={...stgTeam.settings,horizon:'w6'};stgTeam.pending={horizon:'q3'};stgTeamSave()");
  await settle(admin);
  assert.match(admin.els.toast.innerHTML, /Not saved for everyone: horizon must be one of w2, m1, w6, m2\./);
  assert.equal(admin.run('stgHorizonLabel()'), 'next 6 weeks');
  // Reset team settings: every team setting back to its default for everyone; nobody seeds them again.
  admin.run('stgTeamResetAsk(true)');
  await admin.run('stgTeamReset()');
  assert.deepEqual(admin.run('[AT_RISK_TARGET,stgHorizonLabel()]'), [5, 'next month']);
  const fresh = await openReal(site, 'pat.lee@spyder.example', 'Pat Lee', { atRiskTarget: 12 });
  assert.equal(fresh.run('AT_RISK_TARGET'), 5);
  assert.match(status(settingsPage(fresh)), /Team settings last changed by you on /);
  // No email ever reaches the personal settings or the team settings sent.
  for (const b of site.bodies) assert.ok(!/@/.test(JSON.stringify(b.body)), JSON.stringify(b));
  assert.deepEqual([admin.errors, viewer.errors, viewer2.errors, fresh.errors], [[], [], [], []]);
});

run();
