#!/usr/bin/env node
/**
 * Migrate users from old text2fa_prd database to vak_copy.
 * Transfers users + balance from wallets (Balance/100).
 *
 * Old DB: text2fa_prd, user: jn, password: root
 * Run: node scripts/migrate-users-from-text2fa-prd.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const OLD_DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: 'jn',
  password: 'root',
  database: 'text2fa_prd',
};

const NEW_DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USERNAME || 'jn',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_DATABASE || 'vak_copy',
};

async function run() {
  const oldConn = await mysql.createConnection(OLD_DB);
  const newConn = await mysql.createConnection(NEW_DB);

  try {
    // Fetch users from old DB (tries password or password_hash)
    let oldUsers = [];
    try {
      [oldUsers] = await oldConn.query(`SELECT id, email, password FROM users`);
    } catch (_) {
      [oldUsers] = await oldConn.query(`SELECT id, email, password_hash FROM users`);
    }

    // Fetch balances from wallets (Balance/100) — holder_id is the user id
    const [wallets] = await oldConn.query(`SELECT holder_id, Balance FROM wallets`);

    const balanceByUserId = {};
    for (const w of wallets || []) {
      const uid = w.holder_id;
      const bal = Number(w.Balance ?? w.balance ?? 0) / 100;
      balanceByUserId[uid] = (balanceByUserId[uid] || 0) + bal;
    }

    console.log('Found', oldUsers.length, 'users,', Object.keys(balanceByUserId).length, 'with wallet balance');

    let inserted = 0, updated = 0, skipped = 0;
    for (const u of oldUsers) {
      const email = (u.email || '').trim().toLowerCase();
      if (!email) { skipped++; continue; }
      const passwordHash = u.password || u.password_hash || 'MIGRATED_RESET_REQUIRED';
      const balance = Math.round((balanceByUserId[u.id] || 0) * 100) / 100;
      const isAdmin = (u.is_admin || 0) ? 1 : 0;
      const name = u.name || null;

      try {
        const [result] = await newConn.execute(
          `INSERT INTO users (email, password_hash, balance, is_admin, name, email_verified)
           VALUES (?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE balance = VALUES(balance)`,
          [email, passwordHash, balance, isAdmin, name]
        );
        if (result.affectedRows === 1) inserted++;
        else if (result.affectedRows === 2) updated++;
      } catch (e) {
        console.error('Error for', email, e.message);
        skipped++;
      }
    }

    console.log('Done. Inserted:', inserted, 'Updated:', updated, 'Skipped:', skipped);
  } finally {
    await oldConn.end();
    await newConn.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
