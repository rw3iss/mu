#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const cacheDir = path.resolve(__dirname, '../packages/server/data/cache/streams/persistent');

if (!fs.existsSync(cacheDir)) {
  console.log('No cache directory found.');
  process.exit();
}

let removed = 0;

for (const fileId of fs.readdirSync(cacheDir)) {
  const fileDir = path.join(cacheDir, fileId);
  if (!fs.statSync(fileDir).isDirectory()) continue;

  for (const quality of fs.readdirSync(fileDir)) {
    const qualityDir = path.join(fileDir, quality);
    if (!fs.statSync(qualityDir).isDirectory()) continue;

    if (!fs.existsSync(path.join(qualityDir, '.complete'))) {
      fs.rmSync(qualityDir, { recursive: true, force: true });
      removed++;
      console.log('Removed:', qualityDir);
    }
  }

  // Remove empty file directories
  if (fs.readdirSync(fileDir).length === 0) {
    fs.rmdirSync(fileDir);
  }
}

console.log(removed ? `${removed} stale cache(s) removed.` : 'No stale caches found.');
