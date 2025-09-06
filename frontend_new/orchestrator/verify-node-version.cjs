#!/usr/bin/env node
const semverMajor = parseInt(process.versions.node.split('.')[0],10);
if (semverMajor >= 23 || semverMajor < 22) {
  console.error(`\n[ATLAS] Unsupported Node version ${process.versions.node}. Required range: >=22 <23 (pin via .nvmrc).\n`);
  process.exit(1);
}
if (semverMajor === 24) {
  console.error(`\n[ATLAS] Detected Node 24.x which lacks prebuilt better-sqlite3 here. Switch to Node 22 (nvm use) for fast install.\n`);
  process.exit(1);
}
// OK