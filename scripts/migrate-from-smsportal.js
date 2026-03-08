#!/usr/bin/env node
/**
 * Migrate users and balance from smsportal database into current app DB (vak_copy).
 * Source: DB=smsportal, user=jn, password=root (same host/port as .env).
 *
 * Supports:
 * - users with balance column: uses users.balance
 * - users + wallets: uses wallets.Balance/100 keyed by holder_id (user id)
 *
 * Run: npm run migrate:smsportal
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const SOURCE_DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: 'jn',
  password: 'root',
  database: 'smsportal',
};

const TARGET_DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USERNAME || 'jn',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_DATABASE || 'vak_copy',
};

async function run() {
  const src = await mysql.createConnection(SOURCE_DB);
  const tgt = await mysql.createConnection(TARGET_DB);

  try {
    // Fetch users from source (support password or password_hash, optional balance)
    let users = [];
    let useUsersBalance = false;
    const [cols] = await src.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
      [SOURCE_DB.database]
    );
    const colNames = (cols || []).map((c) => c.COLUMN_NAME);
    const colSet = new Set(colNames.map((c) => c.toLowerCase()));
    const has = (name) => colSet.has(name.toLowerCase());
    const hasBalance = has('balance');
    const hasPassword = has('password');
    const hasPasswordHash = has('password_hash');
    const selectCols = ['id', 'email'];
    if (has('is_admin')) selectCols.push('is_admin');
    if (has('name')) selectCols.push('name');
    if (hasPasswordHash) selectCols.push('password_hash');
    if (hasPassword) selectCols.push('password');
    if (hasBalance) selectCols.push('balance');
    const selectList = selectCols.join(', ');

    [users] = await src.query(`SELECT ${selectList} FROM users`);
    useUsersBalance = hasBalance;

    const balanceByUserId = {};

    if (useUsersBalance) {
      for (const u of users || []) {
        const b = Number(u.balance);
        if (Number.isFinite(b)) balanceByUserId[u.id] = b;
      }
    } else {
      try {
        const [wallets] = await src.query(
          `SELECT holder_id, Balance, balance FROM wallets`
        );
        for (const w of wallets || []) {
          const uid = w.holder_id;
          const bal = Number(w.Balance ?? w.balance ?? 0) / 100;
          if (uid != null && Number.isFinite(bal)) {
            balanceByUserId[uid] = (balanceByUserId[uid] || 0) + bal;
          }
        }
      } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
      }
    }

    console.log(
      'Found',
      (users || []).length,
      'users,',
      Object.keys(balanceByUserId).length,
      'with balance'
    );

    let inserted = 0,
      updated = 0,
      skipped = 0;
    for (const u of users || []) {
      const email = (u.email || '').trim().toLowerCase();
      if (!email) {
        skipped++;
        continue;
      }
      const passwordHash =
        (u.password_hash || u.password || 'MIGRATED_RESET_REQUIRED').toString();
      const balance = Math.round(
        (balanceByUserId[u.id] ?? u.balance ?? 0) * 100
      ) / 100;
      const isAdmin = (u.is_admin || 0) ? 1 : 0;
      const name = u.name || null;

      try {
        const [result] = await tgt.execute(
          `INSERT INTO users (email, password_hash, balance, is_admin, name, email_verified)
           VALUES (?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE balance = VALUES(balance), name = COALESCE(VALUES(name), name)`,
          [email, passwordHash, balance, isAdmin, name]
        );
        if (result.affectedRows === 1) inserted++;
        else if (result.affectedRows === 2) updated++;
      } catch (e) {
        console.error('Error for', email, e.message);
        skipped++;
      }
    }

    console.log(
      'Done. Inserted:',
      inserted,
      'Updated:',
      updated,
      'Skipped:',
      skipped
    );
  } finally {
    await src.end();
    await tgt.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
