#!/usr/bin/env node
/**
 * Reset database: drop all app tables then run init-db.
 * Uses DB_* from .env (vak_copy).
 *
 * Run: npm run reset-db
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { execSync } = require('child_process');

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'vak_copy',
};

const TABLES = ['sessions', 'balance_log', 'activations', 'deposits', 'api_keys', 'users', 'settings'];

async function run() {
  const conn = await mysql.createConnection(DB);
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES) {
      await conn.query(`DROP TABLE IF EXISTS \`${table}\``);
      console.log('Dropped', table);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.end();
  } catch (e) {
    await conn.end();
    throw e;
  }

  console.log('Running init-db...');
  execSync('node server/init-db.js', {
    cwd: require('path').join(__dirname, '..'),
    stdio: 'inherit',
  });
  console.log('Database reset and initialized.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
