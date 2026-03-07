#!/usr/bin/env node
/**
 * Download service icons from VAK-SMS to public/assets/service/
 * Uses server/services-list.json for service codes.
 * Run: node scripts/download-service-icons.js
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://vak-sms.com';
const SERVICES_PATH = path.join(__dirname, '..', 'server', 'services-list.json');
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'service');

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function run() {
  const raw = fs.readFileSync(SERVICES_PATH, 'utf8');
  const services = JSON.parse(raw);
  const codes = services.map(s => s && s.code).filter(Boolean);
  console.log('Found', codes.length, 'services');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let ok = 0;
  let err = 0;
  for (const code of codes) {
    const filename = code + '.png';
    const url = BASE + '/static/service/' + filename;
    try {
      const buf = await download(url);
      fs.writeFileSync(path.join(OUT_DIR, filename), buf);
      ok++;
      process.stdout.write('.');
    } catch (e) {
      err++;
      console.error('\nFailed', filename, e.message);
    }
  }
  console.log('\nDone. Written:', ok, 'Failed:', err);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
