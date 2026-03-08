const express = require('express');
const db = require('../db');
const vak = require('../vak');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/settings', requireAdmin, async (req, res) => {
  const rows = await db.query('SELECT `key`, value FROM settings');
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  res.json(s);
});

router.post('/settings', requireAdmin, async (req, res) => {
  const { rub_to_usd, commission_percent, cache_ttl_minutes, notification_enabled, notification_text } = req.body;
  if (rub_to_usd != null) {
    const v = Number(rub_to_usd);
    if (Number.isFinite(v) && v > 0) {
      await db.execute(
        'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        ['rub_to_usd', String(v)]
      );
    }
  }
  if (commission_percent != null) {
    const v = Number(commission_percent);
    if (Number.isFinite(v) && v >= 0) {
      await db.execute(
        'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        ['commission_percent', String(v)]
      );
    }
  }
  if (cache_ttl_minutes != null) {
    const v = Math.max(1, Math.min(60, Math.round(Number(cache_ttl_minutes))));
    if (Number.isFinite(v)) {
      await db.execute(
        'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        ['cache_ttl_minutes', String(v)]
      );
    }
  }
  if (notification_enabled != null) {
    const v = notification_enabled === true || notification_enabled === '1' || notification_enabled === 'true' ? '1' : '0';
    await db.execute(
      'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['notification_enabled', v]
    );
  }
  if (notification_text != null) {
    await db.execute(
      'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['notification_text', String(notification_text).slice(0, 500)]
    );
  }
  const rows = await db.query('SELECT `key`, value FROM settings');
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  res.json(s);
});

router.get('/users', requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 25));
  const search = String(req.query.search || '').trim();
  const offset = (page - 1) * limit;
  let where = '';
  const params = [];
  if (search) {
    const idNum = parseInt(search, 10);
    if (Number.isFinite(idNum)) {
      where = ' WHERE id = ? OR email LIKE ?';
      params.push(idNum, '%' + search + '%');
    } else {
      where = ' WHERE email LIKE ?';
      params.push('%' + search + '%');
    }
  }
  const [countRow] = await db.query('SELECT COUNT(*) as n FROM users' + where, params);
  const total = countRow?.n || 0;
  const rows = await db.query(
    'SELECT id, email, balance, is_admin, suspended, admin_note, created_at FROM users' + where + ' ORDER BY id LIMIT ' + limit + ' OFFSET ' + offset,
    params
  );
  res.json({ users: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post('/users/:id/suspend', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const user = await db.queryOne('SELECT id, is_admin FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.is_admin) return res.status(400).json({ error: 'Cannot suspend admin users' });
  await db.execute('UPDATE users SET suspended = NOT suspended WHERE id = ?', [userId]);
  const row = await db.queryOne('SELECT id, email, balance, suspended FROM users WHERE id = ?', [userId]);
  res.json({ user: row });
});

router.post('/users/:id/balance', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const { amount, reason } = req.body;
  const add = Number(amount);
  if (!Number.isFinite(add)) return res.status(400).json({ error: 'Invalid amount' });
  const user = await db.queryOne('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [add, userId]);
  await db.execute('INSERT INTO balance_log (user_id, amount, reason) VALUES (?, ?, ?)', [
    userId, add, reason || 'admin_adjustment'
  ]);
  const row = await db.queryOne('SELECT id, email, balance FROM users WHERE id = ?', [userId]);
  res.json({ user: row });
});

router.post('/users/:id/note', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const note = req.body.note != null ? String(req.body.note).trim().slice(0, 2000) : '';
  const user = await db.queryOne('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await db.execute('UPDATE users SET admin_note = ? WHERE id = ?', [note || null, userId]);
  const row = await db.queryOne('SELECT id, email, admin_note FROM users WHERE id = ?', [userId]);
  res.json({ user: { id: row.id, email: row.email, admin_note: row.admin_note } });
});

router.get('/deposits', requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 25));
  const search = String(req.query.search || '').trim();
  const offset = (page - 1) * limit;
  let where = '';
  const params = [];
  if (search) {
    where = ' WHERE u.email LIKE ? OR d.order_id LIKE ?';
    params.push('%' + search + '%', '%' + search + '%');
  }
  const [countRow] = await db.query(
    `SELECT COUNT(*) as n FROM deposits d LEFT JOIN users u ON u.id = d.user_id` + where,
    params
  );
  const total = countRow?.n || 0;
  const rows = await db.query(
    `SELECT d.id, d.user_id, u.email, d.order_id, d.amount_usd, d.to_currency, d.network, d.status, d.created_at, d.paid_at
     FROM deposits d
     LEFT JOIN users u ON u.id = d.user_id` + where + `
     ORDER BY d.id DESC
     LIMIT ` + limit + ` OFFSET ` + offset,
    params
  );
  res.json({ deposits: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get('/activations', requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 25));
  const search = String(req.query.search || '').trim();
  const offset = (page - 1) * limit;
  let where = '';
  const params = [];
  if (search) {
    where = ' WHERE u.email LIKE ? OR a.service LIKE ? OR a.phone LIKE ?';
    params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
  }
  const [countRow] = await db.query(
    `SELECT COUNT(*) as n FROM activations a LEFT JOIN users u ON u.id = a.user_id` + where,
    params
  );
  const total = countRow?.n || 0;
  const rows = await db.query(
    `SELECT a.id, a.user_id, u.email, a.service, a.service_name, a.country, a.phone, a.price_usd, a.status, a.sms_code, a.is_rent, a.created_at
     FROM activations a
     LEFT JOIN users u ON u.id = a.user_id` + where + `
     ORDER BY a.id DESC
     LIMIT ` + limit + ` OFFSET ` + offset,
    params
  );
  res.json({ activations: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get('/vak-balance', requireAdmin, async (req, res) => {
  try {
    const balance = await vak.getBalance();
    res.json({ balance });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post('/impersonate/:id', requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  const target = await db.queryOne('SELECT id, email FROM users WHERE id = ?', [targetId]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  req.session.impersonateAdminId = req.session.userId;
  req.session.userId = targetId;
  req.session.impersonating = true;
  res.json({ ok: true, user: { id: target.id, email: target.email } });
});

router.post('/stop-impersonate', requireAdmin, async (req, res) => {
  if (!req.session.impersonating || !req.session.impersonateAdminId) {
    return res.status(400).json({ error: 'Not impersonating' });
  }
  req.session.userId = req.session.impersonateAdminId;
  delete req.session.impersonateAdminId;
  delete req.session.impersonating;
  res.json({ ok: true });
});

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [usersCount] = await db.query('SELECT COUNT(*) as n FROM users');
    const [depositsCount] = await db.query('SELECT COUNT(*) as n FROM deposits');
    const [depositsPaid] = await db.query('SELECT COALESCE(SUM(amount_usd), 0) as total FROM deposits WHERE status = ?', ['paid']);
    const [ordersCount] = await db.query('SELECT COUNT(*) as n FROM activations');
    const [ordersRevenue] = await db.query('SELECT COALESCE(SUM(price_usd), 0) as total FROM activations WHERE status IN (?, ?)', ['received', 'finished']);
    const [ordersToday] = await db.query('SELECT COUNT(*) as n FROM activations WHERE DATE(created_at) = CURDATE()');
    const [depositsToday] = await db.query('SELECT COUNT(*) as n, COALESCE(SUM(amount_usd), 0) as total FROM deposits WHERE status = ? AND DATE(paid_at) = CURDATE()', ['paid']);
    res.json({
      users: usersCount?.n || 0,
      deposits: depositsCount?.n || 0,
      depositsTotalUsd: Number(depositsPaid?.total || 0),
      orders: ordersCount?.n || 0,
      ordersRevenueUsd: Number(ordersRevenue?.total || 0),
      ordersToday: ordersToday?.n || 0,
      depositsToday: depositsToday?.n || 0,
      depositsTodayUsd: Number(depositsToday?.total || 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
