#!/usr/bin/env node
/**
 * Put the site under maintenance (only users with the code can access).
 *
 * Enable:
 *   node scripts/set-maintenance.js on --code=YOUR_SECRET_CODE
 *
 * Disable:
 *   node scripts/set-maintenance.js off
 *
 * Requires DB_* in .env (or defaults).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../server/db');

async function run() {
  const args = process.argv.slice(2);
  const mode = (args[0] || '').toLowerCase();
  let code = '';
  for (const a of args.slice(1)) {
    if (a.startsWith('--code=')) code = a.slice(7).trim();
  }
  if (!code && process.env.MAINTENANCE_CODE) code = process.env.MAINTENANCE_CODE.trim();

  if (mode === 'on') {
    if (!code) {
      console.error('Usage: node scripts/set-maintenance.js on --code=YOUR_SECRET_CODE');
      console.error('   or: MAINTENANCE_CODE=yourSecret node scripts/set-maintenance.js on');
      console.error('Example: node scripts/set-maintenance.js on --code=mySecret123');
      process.exit(1);
    }
    await db.execute(
      "INSERT INTO settings (`key`, value) VALUES ('maintenance_mode', '1') ON DUPLICATE KEY UPDATE value = '1'"
    );
    await db.execute(
      "INSERT INTO settings (`key`, value) VALUES ('maintenance_code', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [code]
    );
    console.log('Maintenance mode is ON. Only users who enter the code can access the site.');
    console.log('Share the code with whoever should have access. Turn off with: node scripts/set-maintenance.js off');
  } else if (mode === 'off') {
    await db.execute(
      "INSERT INTO settings (`key`, value) VALUES ('maintenance_mode', '0') ON DUPLICATE KEY UPDATE value = '0'"
    );
    console.log('Maintenance mode is OFF. The site is accessible to everyone.');
  } else {
    console.error('Usage:');
    console.error('  node scripts/set-maintenance.js on --code=YOUR_SECRET_CODE   enable maintenance');
    console.error('  node scripts/set-maintenance.js off                          disable maintenance');
    process.exit(1);
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
