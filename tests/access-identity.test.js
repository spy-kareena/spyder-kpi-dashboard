// Who is signed in (Cloudflare Access): on the hosted site behind Access, GET /api/me names the person signed in and
// their name is the board's "Your name" (notes, delivery statuses, the Priority tick), with the sign-in's own name from
// /cdn-cgi/access/get-identity when it gives one. Settings > General then shows "Signed in as ..." with Sign out
// instead of the picker, and the Your name question is never asked. Without a sign-in (only the shared password, an
// older deploy without /api/me, no network) the board works as before. A file copy and a shared snapshot never ask.
// Run with `node tests/access-identity.test.js`. Fixtures are synthetic (no SAP data); no network (fetch is mocked;
// /api/notes and /api/people are the real Pages Functions over a Workers KV stand-in).
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const ORIGIN = 'https://kpi.example.test';
const EMAIL = 'aaron.joseph@spyder.example';
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const handlers = {};
async function handler(name) {
  if (!handlers[name]) ({ onRequest: handlers[name] } = await import(pathToFileURL(path.join(__dirname, '..', 'functions', 'api', `${name}.js`)).href));
  return handlers[name];
}
// Workers KV stand-in: get(key, {type}), put, delete.
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
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
const ME_USER = { v: 1, auth: { access: true, password: false }, user: { email: EMAIL, name: 'Aaron Joseph' }, logoutUrl: '/logout' };
const ME_NONE = { v: 1, auth: { access: false, password: true }, user: null, logoutUrl: '/logout' };
// The hosted site. me: the /api/me answer ('down' = no network, 404 = a deploy without it, else its JSON);
// identity: get-identity's JSON (null = it answers 404). PATCH and POST bodies are kept as the page sent them.
function fakeSite({ me = ME_USER, identity = null } = {}) {
  const env = { REPORT_STORE: kvStore() };
  const site = { env, me, identity, calls: [], patches: [], posts: [] };
  site.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    site.calls.push(`${method} ${url}`);
    if (url === '/api/me') {
      if (site.me === 'down') throw new TypeError('Failed to fetch');
      return site.me === 404 ? notFound() : json(site.me);
    }
    if (url === '/cdn-cgi/access/get-identity') return site.identity ? json(site.identity) : notFound();
    if (method === 'PATCH') site.patches.push(JSON.parse(init.body));
    if (method === 'POST' && url === '/api/people') site.posts.push(JSON.parse(init.body));
    const name = { '/api/notes': 'notes', '/api/people': 'people' }[url];
    if (!name) return notFound();
    const fn = await handler(name);
    const headers = { ...(init.headers || {}), ...(method === 'GET' ? {} : { Origin: ORIGIN }) };
    return fn({ request: new Request(ORIGIN + url, { method, body: init.body, headers }), env, params: {} });
  };
  site.asked = () => site.calls.filter((c) => /\/api\/me|get-identity/.test(c));
  return site;
}
// A browser on the hosted site (or a file copy), with its own localStorage. The harness opens every page as an empty
// shared snapshot; a real page is not one. Uploads go through Import files (live SAP is the default).
async function openPage(site, { storage = {}, protocol = 'https:', snapshot = false } = {}) {
  if (!('spyderKpiSettings' in storage)) storage.spyderKpiSettings = JSON.stringify({ dataSource: 'import' });
  const page = loadPage({ storage });
  await tick(0);
  Object.assign(page.ctx, { fetch: site.fetch, Response, location: { href: protocol === 'file:' ? 'file:///C:/kpi/index.html' : `${ORIGIN}/`, protocol } });
  page.run(`isSnapshotView=${snapshot};rowOverrides=loadRowOverrides()`);
  return page;
}
const ROWS = [sapRow({ DocumentNumber: '900', 'Internal Number': '900' }), sapRow({ DocumentNumber: '901', 'Internal Number': '901' })];
const kpi = () => ({ name: 'kpi.xls', bytes: sapExport(ROWS) });
// The Your name question: a modal <dialog>; counted, never answered.
function catchDialogs(page) {
  const opened = [];
  const create = page.ctx.document.createElement;
  page.ctx.document.createElement = (tag) => {
    if (tag !== 'dialog') return create(tag);
    const part = () => ({ value: '', textContent: '', hidden: false, innerHTML: '', focus() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], contains: () => false });
    const d = { setAttribute() {}, addEventListener() {}, querySelector: () => part(), showModal() { opened.push(d); }, close() {}, remove() {} };
    return d;
  };
  return opened;
}
async function settle(page) {
  for (let i = 0; i < 400; i++) {
    await tick(10);
    if (page.run('!notesInFlight&&!notesFlushTimer&&notesReady.size===0')) return;
  }
  throw new Error('shared notes never settled');
}
const keyOf = (page, doc) => page.run(`rowKey(allLoadedRows.find(r=>r.documentNumber===${JSON.stringify(doc)}))`);
const edit = (page, doc, value) => page.run(`updateRowOverride(${JSON.stringify(keyOf(page, doc))},'notes',${JSON.stringify(value)})`);
// Settings > General (stgPeopleAsked: drawing it here must not read the names list).
const general = (page) => page.run("(stgPeopleAsked=true,stgGeneralSection(''))");
const html = (page) => page.els['results-screen'].innerHTML;
const PICKER = /<select class="dz-pillinput stg-select stg-name" id="stg-name" data-focus-key="stg-name" onchange="stgPickName\(this\)" data-tip="Stamped on the notes you save\.">/;

test('signed in through Access: the sign-in name is Your name everywhere, Settings shows Signed in with Sign out, no name question', async () => {
  const site = fakeSite();
  // This browser had picked another name before: it is kept, not used, while signed in.
  const page = await openPage(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  const dialogs = catchDialogs(page);
  await upload(page, [kpi()]);
  await page.ctx.accessLoad();
  await page.ctx.syncSharedNotes();
  await tick(10);
  assert.deepEqual(site.asked(), ['GET /api/me', 'GET /cdn-cgi/access/get-identity']);
  assert.deepEqual(page.run('accessId'), { name: 'Aaron Joseph', email: EMAIL, logoutUrl: '/logout' });
  assert.equal(page.run('readEditor()'), 'Aaron Joseph');
  assert.equal(page.storage.spyderKpiEditorName, 'Kareena', 'the name picked before is not deleted');
  assert.deepEqual(JSON.parse(page.storage.spyderKpiAccessIdV1), { email: EMAIL, name: 'Aaron Joseph' }, 'remembered as from the sign-in');

  // Notes carry the name; the question is never asked (editing, opening the note editor, Add a new name).
  edit(page, '900', 'Chasing the vendor');
  page.run(`toggleRowNote(${JSON.stringify(keyOf(page, '901'))})`);
  page.run('askEditorName(true)');
  await tick(10);
  assert.equal(dialogs.length, 0, 'no Your name question');
  await page.run('flushSharedNotes({all:true})');
  await settle(page);
  const k = keyOf(page, '900');
  assert.equal(site.patches.find((b) => b.rows && b.rows[k]).rows[k].by, 'Aaron Joseph', 'sent with the display name, as before');
  assert.equal(JSON.parse(page.storage.spyderKpiRowOverridesV1)[k].by, 'Aaron Joseph');
  assert.ok(!JSON.stringify(site.patches).includes(EMAIL), 'the page never sends the email');
  // The note editor shows the name, read only (nothing to pick).
  const editor = html(page);
  assert.match(editor, /<label>Your name<span class="note-name note-name-ro" data-tip="From your company sign-in; saved with the note\.">Aaron Joseph<\/span><\/label>/);
  assert.doesNotMatch(editor, /<select class="note-name"|Pick your name|Add a new name/);

  // Delivery statuses and the Priority tick (Shipping) are stamped with it too.
  assert.equal(page.run('shippingEditor()'), 'Aaron Joseph');
  assert.equal(page.run("sharedNotesPatchShipments({'st:770012345678':{order:'600',number:'770012345678',status:'transit'}})"), 1);
  assert.equal(page.run("getSharedShipments()['st:770012345678'].by"), 'Aaron Joseph');

  // The name joins the shared list once (as a picked name: at most once a day).
  assert.deepEqual(site.posts, [{ name: 'Aaron Joseph' }]);
  page.run('peopleOnOpen()');
  await tick(10);
  assert.equal(site.posts.length, 1);

  // Settings > General: who is signed in, the email in grey, Sign out; no picker.
  const g = general(page);
  assert.match(g, /<div class="stg-row stg-who-row"><div class="stg-l"><span class="stg-label">Your name<\/span><span class="stg-help">From your company sign-in\.<\/span><\/div><div class="stg-ctl"><span class="stg-who"><span class="stg-who-n">Signed in as Aaron Joseph<\/span><span class="stg-who-e">aaron\.joseph@spyder\.example<\/span><\/span><button type="button" class="dz-btn print-hide" id="stg-signout" data-focus-key="stg-signout" onclick="accessSignOut\(\)" data-tip="Sign out of the board in this browser\.">Sign out<\/button><\/div><\/div>/);
  assert.doesNotMatch(g, /id="stg-name"|Pick your name|Add a new name/);
  assert.match(g, /<label class="stg-label" for="stg-startPage">Start page<\/label>/, 'the rest of General is unchanged');
  page.run("setTab('settings')");
  assert.match(html(page), /id="stg-sec-general"[\s\S]*?Signed in as Aaron Joseph/);
  // The notes problem line has no Change name link (there is nothing to change).
  page.run("sharedNotes.message='busy'");
  assert.doesNotMatch(page.run('sharedNotesSidebarLine()'), /Change name|Set your name/);
  page.run("sharedNotes.message=''");

  // Sign out: the site's sign-out page; the remembered sign-in goes, the name picked before stays.
  page.run('accessSignOut()');
  assert.equal(page.ctx.location.href, '/logout');
  assert.equal(page.storage.spyderKpiAccessIdV1, undefined);
  assert.equal(page.storage.spyderKpiEditorName, 'Kareena');
  assert.deepEqual(page.errors, []);
});

test('no sign-in (password only, user null), /api/me missing (404) or failing: today\'s picker, the name picked before, a stale sign-in dropped', async () => {
  for (const me of [ME_NONE, 404, 'down', { v: 1, auth: { access: true }, user: { email: 'not an email', name: 'X' } }]) {
    const site = fakeSite({ me, identity: { name: 'Should Not Show', email: EMAIL } });
    const stale = JSON.stringify({ email: EMAIL, name: 'Aaron Joseph' });
    const page = await openPage(site, { storage: { spyderKpiEditorName: 'Kareena', spyderKpiAccessIdV1: stale } });
    await page.ctx.accessLoad();
    const what = JSON.stringify(me);
    assert.deepEqual(site.asked(), ['GET /api/me'], `${what}: get-identity is asked only with a sign-in`);
    assert.equal(page.run('accessId'), null, what);
    assert.equal(page.run('readEditor()'), 'Kareena', what);
    assert.equal(page.storage.spyderKpiAccessIdV1, undefined, `${what}: the stale sign-in is dropped`);
    const g = general(page);
    assert.match(g, PICKER, what);
    assert.match(g, /<label class="stg-label" for="stg-name">Your name<\/label><span class="stg-help">Shown on the notes you save\.<\/span>/, what);
    assert.doesNotMatch(g, /Signed in|Sign out|stg-signout/, what);
    assert.deepEqual(page.errors, [], what);
  }
});

test('no sign-in and no name yet: the Your name question is asked on the first edit, as before', async () => {
  const site = fakeSite({ me: ME_NONE });
  const page = await openPage(site);
  const dialogs = catchDialogs(page);
  await upload(page, [kpi()]);
  await page.ctx.accessLoad();
  await page.ctx.syncSharedNotes();
  edit(page, '900', 'first note');
  await tick(10);
  assert.equal(dialogs.length, 1);
  assert.match(general(page), /<option value="" selected disabled>Pick your name<\/option>/);
});

test('the sign-in\'s own name (get-identity) is used when it gives one for the same email; else the name /api/me makes', async () => {
  const cases = [
    [{ name: 'Aaron M. Joseph', email: EMAIL }, 'Aaron M. Joseph'],
    [{ name: 'Aaron M. Joseph', email: 'Aaron.Joseph@Spyder.Example' }, 'Aaron M. Joseph'],
    [{ name: 'Aaron M. Joseph' }, 'Aaron M. Joseph'],
    [{ name: 'Someone Else', email: 'someone.else@spyder.example' }, 'Aaron Joseph'],
    [{ email: EMAIL }, 'Aaron Joseph'],
    [{ name: 'Aaron Joseph (Sales) #2', email: EMAIL }, 'Aaron Joseph Sales'],
    [null, 'Aaron Joseph'],
  ];
  for (const [identity, want] of cases) {
    const site = fakeSite({ identity });
    const page = await openPage(site);
    await page.ctx.accessLoad();
    assert.equal(page.run('readEditor()'), want, JSON.stringify(identity));
    assert.match(general(page), new RegExp(`Signed in as ${want.replace(/\./g, '\\.')}<`));
  }
  // A name /api/me cannot make and no get-identity name: no sign-in name, today's picker.
  const odd = fakeSite({ me: { ...ME_USER, user: { email: EMAIL, name: '' } } });
  const page = await openPage(odd, { storage: { spyderKpiEditorName: 'Kareena' } });
  await page.ctx.accessLoad();
  assert.equal(page.run('accessId'), null);
  assert.match(general(page), PICKER);
  // Sign out goes to a path on this site only.
  assert.deepEqual(page.run("['/logout','/cdn-cgi/access/logout','//evil.example/x','https://evil.example/','/\\\\evil'].map(accessLogoutUrl)"), ['/logout', '/cdn-cgi/access/logout', '/logout', '/logout', '/logout']);
});

test('signed in after the notes are shared: the name joins the list then, once; the next open starts with the sign-in seen here', async () => {
  const site = fakeSite();
  const storage = { spyderKpiEditorName: 'Kareena', spyderKpiNameSeenV1: JSON.stringify({ name: 'Kareena', at: new Date('2026-09-24T10:00:00').getTime() }) };
  const page = await openPage(site, { storage });
  await upload(page, [kpi()]);
  await page.ctx.syncSharedNotes();
  assert.deepEqual(site.posts, [], 'Kareena was sent today already');
  page.run("setTab('settings')");
  assert.match(html(page), PICKER);
  await page.ctx.accessLoad();
  await tick(10);
  assert.deepEqual(site.posts, [{ name: 'Aaron Joseph' }]);
  // Settings on screen is drawn again with the sign-in.
  assert.match(html(page), /Signed in as Aaron Joseph/);
  assert.doesNotMatch(html(page), /id="stg-name"/);

  // The next open (same browser): the sign-in is there from the start, before /api/me answers; /api/me then says
  // someone else signed in here, and that person's name is used.
  site.me = { ...ME_USER, user: { email: 'pat.lee@spyder.example', name: 'Pat Lee' } };
  const next = await openPage(site, { storage });
  const asking = next.ctx.accessLoad();
  assert.equal(next.run('readEditor()'), 'Aaron Joseph');
  await asking;
  assert.equal(next.run('readEditor()'), 'Pat Lee');
  assert.deepEqual(JSON.parse(storage.spyderKpiAccessIdV1), { email: 'pat.lee@spyder.example', name: 'Pat Lee' });
  // Asked once a page open.
  const before = site.asked().length;
  await next.ctx.accessLoad();
  assert.equal(site.asked().length, before);
});

test('a file copy and a shared snapshot never ask /api/me; a hosted page asks once when it opens', async () => {
  const site = fakeSite();
  const file = await openPage(site, { protocol: 'file:' });
  await file.ctx.accessLoad();
  const snap = await openPage(site, { snapshot: true });
  await snap.ctx.accessLoad();
  snap.ctx.startApp();
  await tick(10);
  assert.deepEqual(site.asked(), []);
  assert.equal(file.run('accessId'), null);
  assert.equal(snap.run('accessId'), null);
  // A snapshot never uses a sign-in remembered in this browser either.
  const kept = await openPage(site, { snapshot: true, storage: { spyderKpiAccessIdV1: JSON.stringify({ email: EMAIL, name: 'Aaron Joseph' }), spyderKpiEditorName: 'Kareena' } });
  await kept.ctx.accessLoad();
  assert.equal(kept.run('readEditor()'), 'Kareena');

  // The page opening (startApp) on the hosted site asks once, without waiting for it.
  const hosted = await openPage(site);
  hosted.run('loadEmbeddedSnapshot=()=>{}');
  hosted.ctx.startApp();
  for (let i = 0; i < 50 && !hosted.run('accessId'); i++) await tick(10);
  assert.deepEqual(site.asked(), ['GET /api/me', 'GET /cdn-cgi/access/get-identity']);
  assert.equal(hosted.run('readEditor()'), 'Aaron Joseph');
  assert.deepEqual(hosted.errors, []);
});

test('the sign-in stays out of Export settings, Ask AI and the shared snapshot', async () => {
  const site = fakeSite();
  const page = await openPage(site);
  await upload(page, [kpi()]);
  await page.ctx.accessLoad();
  await page.ctx.syncSharedNotes();
  edit(page, '900', 'Chasing the vendor');
  page.run('stgExport()');
  const file = page.blobs[page.blobs.length - 1].parts.join('');
  assert.deepEqual(Object.keys(JSON.parse(file)), ['app', 'kind', 'version', 'settings']);
  assert.doesNotMatch(file, /aaron|joseph|spyder\.example|access/i);
  const ai = page.run('aiSystemPrompt()') + JSON.stringify(page.run("allLoadedRows.map(aiLine)")) + JSON.stringify(page.run("aiRunTool('get_overview',{})"));
  assert.ok(!ai.includes(EMAIL), 'no email in what Ask AI sends');
  const snap = JSON.stringify(page.run('rowOverrides'));
  assert.ok(!snap.includes(EMAIL), 'notes carry the name only');
});

run();
