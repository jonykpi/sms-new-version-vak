#!/usr/bin/env node
/**
 * Download country and operator icons from VAK-SMS to public/assets/
 * Run: node scripts/download-country-icons.js
 * Requires VAK_API_KEY in .env (same as server) for getCountryOperatorList.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const BASE = 'https://vak-sms.com';
const COUNTRY_DIR = path.join(__dirname, '..', 'public', 'assets', 'country');
const OPERATOR_DIR = path.join(__dirname, '..', 'public', 'assets', 'operator');

async function fetchCountryOperatorList() {
  const apiKey = process.env.VAK_API_KEY;
  const url = new URL('/api/getCountryOperatorList/', BASE);
  if (apiKey) url.searchParams.set('apiKey', apiKey);
  const res = await fetch(url.toString());
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON: ' + text.slice(0, 200));
  }
  if (data.error) throw new Error(data.error);
  return data;
}

function collectCountryIconPaths(obj) {
  const set = new Set();
  for (const arr of Object.values(obj)) {
    if (!Array.isArray(arr) || !arr[0]) continue;
    const icon = arr[0].icon;
    if (icon && typeof icon === 'string' && icon.includes('/country/')) {
      const filename = icon.split('/').pop();
      if (filename && filename.endsWith('.png')) set.add(filename);
    }
  }
  return [...set];
}

/** Collect unique operator icon paths: /static/operator/xy.png or /static/default.png */
function collectOperatorIconPaths(obj) {
  const seen = new Set();
  const out = [];
  for (const arr of Object.values(obj)) {
    if (!Array.isArray(arr) || !arr[0]) continue;
    const operators = arr[0].operators;
    if (!operators || typeof operators !== 'object') continue;
    for (const list of Object.values(operators)) {
      if (!Array.isArray(list) || !list[0]) continue;
      const icon = list[0].icon;
      if (icon && typeof icon === 'string' && (icon.includes('/operator/') || icon.includes('/default.png'))) {
        const filename = icon.split('/').pop();
        if (filename && filename.endsWith('.png') && !seen.has(filename)) {
          seen.add(filename);
          out.push({ path: icon, filename });
        }
      }
    }
  }
  return out;
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function run() {
  console.log('Fetching getCountryOperatorList...');
  const data = await fetchCountryOperatorList();

  const countryFilenames = collectCountryIconPaths(data);
  console.log('Found', countryFilenames.length, 'country icons');
  fs.mkdirSync(COUNTRY_DIR, { recursive: true });
  let okC = 0;
  for (const filename of countryFilenames) {
    const url = BASE + '/static/country/' + filename;
    try {
      const buf = await download(url);
      fs.writeFileSync(path.join(COUNTRY_DIR, filename), buf);
      okC++;
      process.stdout.write('.');
    } catch (e) {
      console.error('\nCountry failed', filename, e.message);
    }
  }
  console.log('\nCountry icons written:', okC);

  const operatorIcons = collectOperatorIconPaths(data);
  console.log('Found', operatorIcons.length, 'unique operator icons');
  fs.mkdirSync(OPERATOR_DIR, { recursive: true });
  let okO = 0;
  for (const { path: iconPath, filename } of operatorIcons) {
    const url = iconPath.startsWith('http') ? iconPath : BASE + iconPath;
    try {
      const buf = await download(url);
      fs.writeFileSync(path.join(OPERATOR_DIR, filename), buf);
      okO++;
      process.stdout.write('.');
    } catch (e) {
      console.error('\nOperator failed', filename, e.message);
    }
  }
  console.log('\nOperator icons written:', okO);
  console.log('Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
