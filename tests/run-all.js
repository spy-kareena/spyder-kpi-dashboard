// Runs every tests/*.test.js and tests/*.test.mjs file. Exits non-zero if any file fails.
// Usage: node tests/run-all.js
'use strict';
const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const files = readdirSync(__dirname).filter((f) => /\.test\.m?js$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  const summary = (r.stdout || '').trim().split('\n').pop();
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${f}: ${summary}`);
  if (r.status !== 0) {
    failed++;
    console.log((r.stdout || '').split('\n').filter((l) => l.startsWith('FAIL') || l.startsWith('     ')).join('\n'));
    if (r.stderr) console.log(r.stderr.trim());
  }
}
process.exitCode = failed ? 1 : 0;
