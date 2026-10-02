// Review fixes for file import (handleFiles / Add file) and share snapshots. Synthetic fixtures only.
// Run: node tests/review-data-import-snapshot.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadPage, upload, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const SERVER = path.join(__dirname, '..', 'mcp', 'spyder-kpi-mcp.mjs');

test('a failed first load lists no files, and MCP --check reports the real reason', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'empty-result.xls', bytes: sapExport([]) }]);
  assert.match(page.els['upload-error'].textContent, /No rows found/);
  assert.deepEqual(page.run('loadedFiles.map(f=>f.name)'), []);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spyder kpi review '));
  try {
    const file = path.join(dir, 'empty-result.xls');
    fs.writeFileSync(file, sapExport([]));
    const r = spawnSync(process.execPath, [SERVER, '--check', file], { encoding: 'utf8', env: { ...process.env, SPYDER_KPI_FILES: '' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /No rows found in these exports/);
    assert.doesNotMatch(r.stderr, /TypeError/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

run();
