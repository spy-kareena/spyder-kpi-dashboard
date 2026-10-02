#!/usr/bin/env node
// Spyder KPI MCP server: lets an AI app (Claude Desktop, Claude Code, Cursor, ...) answer questions from SAP B1
// exports on this computer. No dependencies (Node 18+). It runs ../index.html in a Node vm, loads the exports
// through the page's own handleFiles, and serves the page's KPI_TOOLS over MCP stdio (one JSON-RPC 2.0 message
// per line). stdout carries only protocol messages; logs go to stderr. See docs/MCP.md.
//
//   node mcp/spyder-kpi-mcp.mjs [--index <index.html>] [--check] [export files...]
//   Export files can also come from SPYDER_KPI_FILES, separated by ";".
//   --check loads the files, prints the overview and exits (exit code 1 when nothing could be loaded).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']; // newest first
const log = (...a) => console.error('[spyder-kpi]', ...a);
const unquote = (s) => String(s).trim().replace(/^"(.*)"$/s, '$1');

// --- Arguments ------------------------------------------------------------------------------------------
let indexPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
let check = false;
let startFiles = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--check') check = true;
  else if (argv[i] === '--index') indexPath = argv[++i];
  else startFiles.push(argv[i]);
}
startFiles = [...startFiles, ...String(process.env.SPYDER_KPI_FILES || '').split(';')].map(unquote).filter(Boolean);

// --- The dashboard page in a vm (same approach as tests/harness.js, smaller DOM stub) ----------------------
let html;
try { html = fs.readFileSync(indexPath, 'utf8'); } catch (err) {
  log(`Cannot read the dashboard page ${indexPath}: ${err.message}. Keep index.html next to the mcp folder, or pass --index <path>.`);
  process.exit(1);
}
const stub = (id) => ({
  id, style: {}, innerHTML: '', textContent: '', value: '', dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  querySelector: () => null, querySelectorAll: () => [], appendChild: (c) => c, insertBefore: (c) => c,
  remove() {}, addEventListener() {}, setAttribute() {}, click() {}, focus() {},
});
const els = {};
const store = {};
const alerts = [];
const quiet = () => {};
class FileReader {
  readAsArrayBuffer(f) { setImmediate(() => this.onload({ target: { result: f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) } })); }
}
const page = vm.createContext({
  console: { log: quiet, info: quiet, debug: quiet, warn: log, error: log },
  document: {
    // No embedded snapshot: this is the full page, and its data comes only from load().
    getElementById: (id) => (id === 'embedded-snapshot-data' ? null : els[id] || (els[id] = stub(id))), querySelector: () => null, querySelectorAll: () => [],
    createElement: stub, body: stub('body'), documentElement: { outerHTML: html }, addEventListener() {}, title: '',
  },
  alert: (m) => alerts.push(String(m)), confirm: () => true,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  FileReader, Blob: class {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
  setTimeout, clearTimeout, Intl, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer,
  navigator: {}, location: { href: 'http://localhost/' }, print() {}, addEventListener() {},
});
page.window = page;
page.self = page;
const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
for (let m; (m = re.exec(html));) if (!/type=["']application\/json/.test(m[1] || '')) vm.runInContext(m[2], page, { filename: indexPath });
const run = (expr) => vm.runInContext(expr, page);
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

// Remember each file's row count and kind, read the same way handleFiles classifies it.
const readExport = page.readExportFile;
page.readExportFile = async (file) => {
  const rows = await readExport(file);
  const r = rows[0];
  file.rows = rows.length;
  file.kind = !r ? 'empty' : page.isBuildRiskRow(r) ? 'Clear To Build report' : page.isSupplyDemandRow(r) ? 'supply / demand snapshot'
    : page.isKpiExportHeaderSet(new Set(Object.keys(r).map(page.normalizeHeader))) ? 'SAP KPI export' : 'not recognized (skipped)';
  return rows;
};

// --- Loading exports ------------------------------------------------------------------------------------
const HOW_TO_LOAD = 'No export is loaded. Call load_exports with the full paths of the export files on this computer, e.g. {"paths":["C:\\\\Exports\\\\kpi_export.xls"]} (add a supply / demand or Clear To Build file to the same list), or list the files after the server path in the AI app\'s MCP config and restart the app.';
let lastError = '';

// Replaces what is loaded. On any failure nothing changes (the page keeps the previous files) and this throws.
async function load(paths) {
  const files = paths.map((p) => {
    const full = path.resolve(unquote(p));
    try { return { name: path.basename(full), path: full, bytes: fs.readFileSync(full) }; } catch (err) {
      throw new Error(`Cannot read ${full}: ${err.code === 'ENOENT' ? 'file not found' : err.code === 'EISDIR' ? 'that is a folder, not a file' : err.message}`);
    }
  });
  const box = page.document.getElementById('upload-error');
  box.style.display = 'none';
  alerts.length = 0;
  await page.handleFiles(files);
  if (box.style.display === 'block' || alerts.length) throw new Error(box.style.display === 'block' ? box.textContent : alerts.join(' '));
}

function loadedInfo() {
  const files = run('loadedFiles').map((f) => ({ name: f.name, path: f.path, kind: f.kind, rows_read: f.rows }));
  const extra = lastError ? { last_load_error: lastError } : {};
  if (!files.length) return { loaded: false, hint: HOW_TO_LOAD, ...extra };
  const o = plain(page.aiRunTool('get_overview', {}));
  return { loaded: true, as_of: o.as_of, as_of_basis: o.as_of_basis, files, rows: o.files.rows,
    data_check: o.data_check, ...extra };
}

// --- Tools ------------------------------------------------------------------------------------------------
const kpiTools = plain(run('KPI_TOOLS.map(({name,description,parameters})=>({name,description,parameters}))'));
const TOOLS = [
  ...kpiTools.map(({ name, description, parameters }) => ({ name, description, inputSchema: parameters })),
  { name: 'load_exports',
    description: 'Load SAP export files from this computer, replacing what is loaded (KPI export, plus optional supply / demand snapshot and Clear To Build report). Use after a new export is saved. Paths are full paths, e.g. C:\\Exports\\kpi_export.xls. If a file cannot be read, nothing changes.',
    inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Full paths of every file to load' } }, required: ['paths'] } },
  { name: 'loaded_files',
    description: 'What is loaded: file names, paths, kind and rows of each file, row totals and the as-of date of the numbers.',
    inputSchema: { type: 'object', properties: {} } },
];
const kpiNames = new Set(kpiTools.map((t) => t.name));

async function callTool(name, args) {
  if (name === 'loaded_files') return loadedInfo();
  if (name === 'load_exports') {
    const paths = args.paths;
    if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== 'string' || !unquote(p))) {
      return { error: 'paths must be a list of full file paths, e.g. ["C:\\\\Exports\\\\kpi_export.xls"]' };
    }
    try { await load(paths); lastError = ''; } catch (err) {
      const now = loadedInfo();
      return { error: err.message, still_loaded: now.loaded ? now.files.map((f) => f.name) : [] };
    }
    return loadedInfo();
  }
  if (!kpiNames.has(name)) return { error: `Unknown tool ${name}. Tools: ${TOOLS.map((t) => t.name).join(', ')}.` };
  const out = plain(page.aiRunTool(name, args));
  // The page's hints speak of its upload screen; here files come in through load_exports.
  if (out.loaded === false) out.hint = run('hasLoadedData()') ? `${out.hint} With this connector, call load_exports with the paths of every file to use.` : HOW_TO_LOAD + (lastError ? ` Last load error: ${lastError}` : '');
  return out;
}

// One load or tool call at a time, so a tool never sees a half-loaded export.
let work = Promise.resolve();
const serial = (fn) => { const p = work.then(fn); work = p.catch(() => {}); return p; };

// The start files load after the first tools/list reply (or at the first tools/call), not at launch: parsing a
// large export blocks for seconds, and the initialize / tools/list handshake must not wait for it.
let started = null;
const startLoad = () => started ??= serial(async () => {
  if (!startFiles.length) { log('No export files given. Tools will explain how to load them (load_exports).'); return; }
  try {
    await load(startFiles);
    const info = loadedInfo();
    log(`Loaded ${info.files.length} file(s), as of ${info.as_of}: ${info.files.map((f) => `${f.name} (${f.rows_read} rows)`).join(', ')}`);
  } catch (err) { lastError = err.message; log(`Could not load the export files: ${err.message}`); }
});

if (check) {
  await startLoad();
  const info = loadedInfo();
  if (!info.loaded) {
    if (!lastError) log('Usage: node mcp/spyder-kpi-mcp.mjs --check "C:\\path\\to\\kpi_export.xls"');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(await callTool('get_overview', {}), null, 2)}\n`, () => process.exit(0));
} else {
  serve();
}

// --- MCP over stdio -------------------------------------------------------------------------------------
function serve() {
  const INSTRUCTIONS = 'Numbers come from SAP B1 export files loaded on this computer, as of the export date (see loaded_files). Start with get_overview; use search_lines for order lines and group_totals for breakdowns. If nothing is loaded, call load_exports.';
  const rpcError = (code, message) => Object.assign(new Error(message), { code });
  const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  async function dispatch(method, params) {
    switch (method) {
      case 'initialize':
        return { protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
          capabilities: { tools: {} }, serverInfo: { name: 'spyder-kpi', version: VERSION }, instructions: INSTRUCTIONS };
      case 'ping': return {};
      case 'tools/list': return { tools: TOOLS };
      case 'tools/call': {
        const args = params.arguments ?? {};
        if (typeof params.name !== 'string') throw rpcError(-32602, 'tools/call needs params.name');
        if (typeof args !== 'object' || Array.isArray(args)) throw rpcError(-32602, 'params.arguments must be an object');
        startLoad();
        const out = await serial(() => callTool(params.name, args)).catch((err) => ({ error: String(err && err.message || err) }));
        return { content: [{ type: 'text', text: JSON.stringify(out) }], ...('error' in out ? { isError: true } : {}) };
      }
      default: throw rpcError(-32601, `Method not found: ${method}`);
    }
  }

  // ponytail: JSON-RPC batches (arrays, 2025-03-26 only) get Invalid Request; no MCP client sends them.
  async function handle(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return failure(null, -32600, 'Invalid Request');
    if (msg.method === undefined && ('result' in msg || 'error' in msg)) return null; // a client reply; this server sends no requests
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return failure(msg.id ?? null, -32600, 'Invalid Request');
    if (!('id' in msg)) return null; // notifications (initialized, cancelled, ...) get no reply
    const params = msg.params ?? {};
    if (typeof params !== 'object' || Array.isArray(params)) return failure(msg.id, -32602, 'params must be an object');
    try { return { jsonrpc: '2.0', id: msg.id, result: await dispatch(msg.method, params) }; } catch (err) {
      return failure(msg.id, err.code || -32603, err.message);
    }
  }

  // Resolves once the reply is flushed, so exiting on stdin close never cuts one off.
  const send = (m) => m && new Promise((done) => process.stdout.write(`${JSON.stringify(m)}\n`, done));
  let pending = Promise.resolve();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg, reply;
    try { msg = JSON.parse(line); reply = handle(msg); } catch { reply = Promise.resolve(failure(null, -32700, 'Parse error')); }
    const p = reply.then(send, (err) => log(err));
    if (msg && msg.method === 'tools/list') p.then(() => setImmediate(startLoad));
    pending = Promise.all([pending, p]);
  });
  rl.on('close', () => pending.then(() => process.exit(0)));
  process.on('uncaughtException', (err) => log('Unexpected error:', err && err.stack || err));
  log(`spyder-kpi ${VERSION} ready (${TOOLS.length} tools, page ${indexPath}).`);
}
