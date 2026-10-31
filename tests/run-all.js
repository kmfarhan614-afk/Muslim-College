'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HARNESSES = [
  'mca-server-harness.js',
  'mca-teacher-portal-harness.js',
  'mca-sabih-preset-harness.js',
  'mca-wiring-harness.js'
];

let failed = 0;
for (const file of HARNESSES) {
  console.log('\n=== ' + file + ' ===');
  const result = spawnSync(process.execPath, [path.join(__dirname, file), ROOT], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    failed++;
    console.error('FAILED: ' + file + ' (exit ' + result.status + ')');
  }
}

console.log('\n' + (failed ? failed + ' harness(es) failed' : 'All harnesses passed'));

if (!failed) {
  for (const dir of fs.readdirSync(__dirname)) {
    if (dir.endsWith('-data')) {
      try { fs.rmSync(path.join(__dirname, dir), { recursive: true, force: true }); } catch (_) {}
    }
  }
}

process.exit(failed ? 1 : 0);
