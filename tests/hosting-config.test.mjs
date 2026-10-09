// Hosting config files agree with each other and with the docs: the Pages wrangler.toml, the shipping poller's
// wrangler.toml and the IIS web.config. Run: node tests/hosting-config.test.mjs. Reads files only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const pages = read('wrangler.toml');
const poller = read('workers', 'shipping-poller', 'wrangler.toml');
const webConfig = read('web.config');
const PLACEHOLDER = 'REPLACE_WITH_REPORT_STORE_NAMESPACE_ID';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('Pages wrangler.toml: project name, whole folder served, no plain vars or secrets', () => {
  assert.match(pages, /^name = "spyder-kpi-dashboard"$/m);
  assert.match(pages, /^pages_build_output_dir = "\."$/m);
  // A [vars] table here would replace variables typed into the Cloudflare dashboard; secrets stay encrypted secrets.
  assert.doesNotMatch(pages, /^\s*\[vars\]/m);
  assert.doesNotMatch(pages, /^\s*(DASHBOARD_PASSWORD|SESSION_SECRET|[A-Z_]+_API_KEY|FEDEX_CLIENT_(ID|SECRET))\s*=/m);
});

test('REPORT_STORE: Pages block commented with the placeholder (or filled in), same namespace id as the poller', () => {
  // Before the owner's one-time setup the Pages block is commented out; afterwards both files carry the same real id.
  const block = /^(# )?\[\[kv_namespaces\]\]\n\1binding = "REPORT_STORE"\n\1id = "([^"]+)"$/m;
  const p = pages.match(block);
  assert.ok(p, 'Pages wrangler.toml has the REPORT_STORE block');
  const pollerId = (poller.match(/^\[\[kv_namespaces\]\]\nbinding = "REPORT_STORE"\nid = "([^"]+)"$/m) || [])[1];
  assert.ok(pollerId, 'poller wrangler.toml binds REPORT_STORE');
  if (p[1]) assert.equal(p[2], PLACEHOLDER, 'the commented Pages block keeps the shared placeholder');
  else assert.notEqual(p[2], PLACEHOLDER, 'an uncommented Pages block needs the real namespace id');
  if (p[2] !== PLACEHOLDER && pollerId !== PLACEHOLDER) assert.equal(pollerId, p[2], 'both files use the same namespace');
  assert.match(pages, /npx wrangler kv namespace create spyder-kpi-report/);
});

test('both wrangler.toml files use the same compatibility date', () => {
  const date = (t) => (t.match(/^compatibility_date = "(\d{4}-\d{2}-\d{2})"$/m) || [])[1];
  assert.ok(date(pages), 'Pages compatibility_date');
  assert.equal(date(poller), date(pages));
});

test('web.config: MIME types for .mjs and the image assets; server-only folders hidden', () => {
  for (const [ext, type] of [['.mjs', 'text/javascript'], ['.jpg', 'image/jpeg'], ['.png', 'image/png'], ['.svg', 'image/svg+xml']]) {
    assert.match(webConfig, new RegExp(`<remove fileExtension="\\${ext}" />\\s*<mimeMap fileExtension="\\${ext}" mimeType="${type.replace('+', '\\+')}" />`), ext);
  }
  for (const seg of ['functions', 'shared', 'workers', 'tests']) assert.match(webConfig, new RegExp(`<add segment="${seg}" />`), seg);
});

test('docs name Node.js 20 or newer for the MCP connector and tests, never Node 18', () => {
  for (const file of ['README.md', 'docs/MCP.md', 'docs/IT_HOSTING_README.md', 'docs/SHIPPING.md', 'mcp/spyder-kpi-mcp.mjs']) {
    const text = read(file);
    assert.match(text, /Node(\.js)? 20 or newer/, file);
    assert.doesNotMatch(text, /Node(\.js)? 18|v18 or newer/, file);
  }
});

test('README, IT hosting notes and the owner checklist name every secret, the KV binding and the Worker cron', () => {
  const secrets = ['DASHBOARD_PASSWORD', 'SESSION_SECRET', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'FEDEX_CLIENT_ID', 'FEDEX_CLIENT_SECRET'];
  for (const file of ['README.md', 'docs/IT_HOSTING_README.md', 'docs/OWNER_CHECKLIST.md']) {
    const text = read(file);
    for (const name of [...secrets, 'REPORT_STORE']) assert.ok(text.includes(name), `${file} names ${name}`);
  }
  assert.match(read('docs/IT_HOSTING_README.md'), /crons = \["0 \*\/4 \* \* \*"\]/);
  assert.match(read('README.md'), /\(docs\/OWNER_CHECKLIST\.md\)/);
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
