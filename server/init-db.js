require('dotenv').config();
const mysql = require('mysql2/promise');

async function init() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'vak_copy',
  });

  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      balance DECIMAL(12,2) NOT NULL DEFAULT 0,
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      \`key\` VARCHAR(64) PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS activations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      service VARCHAR(64) NOT NULL,
      service_name VARCHAR(255),
      country VARCHAR(8) NOT NULL DEFAULT 'ru',
      operator VARCHAR(64),
      phone VARCHAR(32) NOT NULL,
      id_num VARCHAR(64) NOT NULL,
      price_usd DECIMAL(12,2) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'waiting',
      sms_code VARCHAR(64),
      is_rent TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS deposits (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      order_id VARCHAR(128) UNIQUE NOT NULL,
      amount_usd DECIMAL(12,2) NOT NULL,
      to_currency VARCHAR(16) NOT NULL,
      network VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      cryptomus_uuid VARCHAR(64),
      address VARCHAR(255),
      deposit_url VARCHAR(512),
      payer_amount VARCHAR(64),
      payer_currency VARCHAR(16),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMP NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS balance_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      reason VARCHAR(64) NOT NULL,
      ref_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      session_id VARCHAR(128) NOT NULL PRIMARY KEY,
      expires INT UNSIGNED NOT NULL,
      data MEDIUMTEXT
    )`,
    `INSERT IGNORE INTO settings (\`key\`, value) VALUES ('rub_to_usd', '0.011')`,
    `INSERT IGNORE INTO settings (\`key\`, value) VALUES ('commission_percent', '5')`,
    `INSERT IGNORE INTO settings (\`key\`, value) VALUES ('cache_ttl_minutes', '5')`,
    `INSERT IGNORE INTO settings (\`key\`, value) VALUES ('notification_enabled', '0')`,
    `INSERT IGNORE INTO settings (\`key\`, value) VALUES ('notification_text', '')`,
    `INSERT IGNORE INTO settings (\`key\`, value) VALUES ('maintenance_mode', '0')`,
    `INSERT IGNORE INTO settings (\`key\`, value) VALUES ('maintenance_code', '')`,
  ];
  for (const sql of statements) await conn.query(sql);

  try {
    await conn.query('ALTER TABLE activations MODIFY COLUMN sms_code TEXT');
  } catch (e) {
    if (!e.message.includes('Duplicate') && !e.message.includes('Unknown')) throw e;
  }
  const alterColumns = [
    ['activations', 'is_rent', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['users', 'name', 'VARCHAR(255)'],
    ['users', 'whatsapp', 'VARCHAR(64)'],
    ['users', 'telegram', 'VARCHAR(64)'],
    ['users', 'email_verified', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['users', 'verification_token', 'VARCHAR(64)'],
    ['users', 'verification_token_expires', 'TIMESTAMP NULL'],
    ['users', 'reset_token', 'VARCHAR(64)'],
    ['users', 'reset_token_expires', 'TIMESTAMP NULL'],
    ['users', 'suspended', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['deposits', 'deposit_url', 'VARCHAR(512)'],
  ];
  for (const [table, col, def] of alterColumns) {
    try {
      await conn.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch (e) {
      if (!e.message.includes('Duplicate column')) throw e;
    }
  }

  try {
    await conn.query('UPDATE users SET email_verified = 1 WHERE verification_token IS NULL AND (email_verified = 0 OR email_verified IS NULL)');
  } catch (e) {}

  await conn.end();
  console.log('MySQL database initialized. Tables: users, settings, activations, balance_log, sessions');
}

init().catch((e) => {
  console.error('Init failed:', e.message);
  process.exit(1);
});
