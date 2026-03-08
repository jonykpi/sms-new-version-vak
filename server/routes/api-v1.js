/**
 * Public API v1 — authenticate with API key (X-API-Key or Authorization: Bearer <key>).
 * Same operations as the web app: balance, get-number, activations, status, cancel/prolong.
 */
const express = require('express');
const db = require('../db');
const vak = require('../vak');
const cache = require('../cache');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

async function getSettings() {
  const rows = await db.query('SELECT `key`, value FROM settings');
  const s = {};
  rows.forEach((r) => { s[r.key] = r.value; });
  return s;
}

function rubToUsd(rub, settings) {
  const rate = Number(settings.rub_to_usd) || 0.011;
  const commission = Number(settings.commission_percent) || 5;
  const usd = rub * rate;
  return Math.round(usd * (1 + commission / 100) * 100) / 100;
}

const RENT_MINUTES = 4 * 60;
const ONETIME_MINUTES = 20;

async function processExpiredActivations(userId) {
  const rows = await db.query(
    'SELECT id, price_usd, is_rent, created_at FROM activations WHERE user_id = ? AND status NOT IN (?, ?) AND (sms_code IS NULL OR sms_code = ?)',
    [userId, 'cancelled', 'got_sms', '']
  );
  const now = Date.now();
  for (const r of rows) {
    const created = new Date(r.created_at).getTime();
    const mins = r.is_rent ? RENT_MINUTES : ONETIME_MINUTES;
    const expiry = created + mins * 60 * 1000;
    if (expiry <= now) {
      const priceUsd = Number(r.price_usd) || 0;
      const existing = await db.queryOne('SELECT id FROM balance_log WHERE ref_id = ? AND amount > 0 AND reason = ?', [r.id, 'refund']);
      if (!existing && priceUsd > 0) {
        await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [priceUsd, userId]);
        await db.execute('INSERT INTO balance_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [
          userId, priceUsd, 'refund', r.id,
        ]);
      }
      await db.execute('UPDATE activations SET status = ? WHERE id = ?', ['cancelled', r.id]);
    }
  }
}

/** Require verified email for get-number (same as web) */
async function requireVerifiedApi(req, res, next) {
  const row = await db.queryOne('SELECT email_verified FROM users WHERE id = ?', [req.apiUserId]);
  if (!row || !row.email_verified) {
    return res.status(403).json({ error: 'Verify your email to place orders. Use the website to verify.' });
  }
  next();
}

router.use(requireApiKey);

router.get('/balance', async (req, res) => {
  const row = await db.queryOne('SELECT balance FROM users WHERE id = ?', [req.apiUserId]);
  res.json({ balance: row ? Number(row.balance) : 0 });
});

router.post('/get-number', requireVerifiedApi, async (req, res) => {
  try {
    const { service, country = 'usv', operator = '', rent = false } = req.body;
    const svc = String(service).trim();
    if (!svc) return res.status(400).json({ error: 'service required' });

    const settings = await getSettings();
    const services = svc.split(',').map((s) => s.trim()).filter(Boolean);
    let totalPriceUsd = 0;
    const firstService = services[0];

    for (const s of services) {
      const { count, priceRub } = await vak.getCountNumber(s, country, operator);
      if (count === 0) return res.status(400).json({ error: 'No numbers available for ' + s });
      if (priceRub == null && priceRub !== 0) return res.status(400).json({ error: 'Price not available for this service/country' });
      totalPriceUsd += rubToUsd(priceRub || 0, settings);
    }

    const user = await db.queryOne('SELECT balance FROM users WHERE id = ?', [req.apiUserId]);
    if (!user || Number(user.balance) < totalPriceUsd) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const result = await vak.getNumber(svc, country, operator, !!rent);
    const tel = Array.isArray(result) ? result[0]?.tel : result.tel;
    const idNum = Array.isArray(result) ? result[0]?.idNum : result.idNum;
    if (!tel || !idNum) return res.status(502).json({ error: 'Failed to get number' });

    const servicesList = require('../services-list.json');
    const serviceName = services.map((s) => (servicesList.find((x) => x.code === s) || {}).name || s).join(' + ');
    const serviceCode = services.length > 1 ? firstService : svc;

    const isRent = !!rent;
    const actId = await db.insertAndGetId(
      'INSERT INTO activations (user_id, service, service_name, country, operator, phone, id_num, price_usd, status, is_rent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.apiUserId, serviceCode, serviceName, country || 'usv', operator || null, tel, idNum, totalPriceUsd, 'waiting', isRent ? 1 : 0]
    );

    await db.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [totalPriceUsd, req.apiUserId]);
    await db.execute('INSERT INTO balance_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [
      req.apiUserId, -totalPriceUsd, 'activation', actId,
    ]);

    const row = await db.queryOne('SELECT id, phone, service, service_name, price_usd, status, created_at FROM activations WHERE id = ?', [actId]);
    res.json({ activation: row });
  } catch (e) {
    const code = e.code || '';
    if (['noNumber', 'noMoney', 'noService', 'noCountry', 'noOperator', 'badService', 'apiKeyNotFound'].includes(code)) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/activations', async (req, res) => {
  await processExpiredActivations(req.apiUserId);
  const rows = await db.query(
    'SELECT id, service, service_name, country, phone, id_num, price_usd, status, sms_code, is_rent, created_at FROM activations WHERE user_id = ? ORDER BY id DESC',
    [req.apiUserId]
  );
  res.json({ activations: rows });
});

router.get('/activation/:id/status', async (req, res) => {
  const row = await db.queryOne(
    'SELECT id, id_num, user_id, status, sms_code FROM activations WHERE id = ? AND user_id = ?',
    [req.params.id, req.apiUserId]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status === 'got_sms') {
    let codes = [];
    if (row.sms_code) {
      try {
        const parsed = JSON.parse(row.sms_code);
        codes = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        codes = [row.sms_code];
      }
    }
    const last = codes.length ? codes[codes.length - 1] : row.sms_code;
    return res.json({ status: row.status, sms_code: last, sms_codes: codes });
  }

  try {
    const data = await vak.getSmsCode(row.id_num);
    const code = data.smsCode;
    if (code != null && code !== '') {
      const newCode = Array.isArray(code) ? code[code.length - 1] : String(code);
      let stored;
      if (row.sms_code) {
        try {
          const existing = JSON.parse(row.sms_code);
          const arr = Array.isArray(existing) ? existing : [existing];
          arr.push(newCode);
          stored = arr.length === 1 ? arr[0] : JSON.stringify(arr);
        } catch {
          stored = JSON.stringify([row.sms_code, newCode]);
        }
      } else {
        stored = newCode;
      }
      await db.execute('UPDATE activations SET status = ?, sms_code = ? WHERE id = ?', ['got_sms', stored, row.id]);
      const codes = typeof stored === 'string' && stored.startsWith('[') ? JSON.parse(stored) : [stored];
      return res.json({ status: 'got_sms', sms_code: newCode, sms_codes: codes });
    }
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Service temporarily unavailable. Please try again later.' });
  }
  res.json({ status: row.status, sms_code: row.sms_code });
});

router.post('/activation/:id/status', async (req, res) => {
  const row = await db.queryOne(
    'SELECT id, id_num, user_id, status, price_usd, sms_code FROM activations WHERE id = ? AND user_id = ?',
    [req.params.id, req.apiUserId]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { action } = req.body;
  if (!['send', 'end', 'bad'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const hasReceivedSms = row.status === 'got_sms' || (row.sms_code != null && String(row.sms_code).trim() !== '');
  if ((action === 'end' || action === 'bad') && hasReceivedSms) {
    return res.status(400).json({ error: 'Cannot cancel or refund. SMS already received — balance is consumed.' });
  }
  try {
    const data = await vak.setStatus(row.id_num, action);
    if (action === 'end' || action === 'bad') {
      await db.execute('UPDATE activations SET status = ? WHERE id = ?', ['cancelled', row.id]);
      const priceUsd = Number(row.price_usd) || 0;
      if (priceUsd > 0) {
        const existing = await db.queryOne('SELECT id FROM balance_log WHERE ref_id = ? AND amount > 0 AND reason = ?', [row.id, 'refund']);
        if (!existing) {
          await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [priceUsd, req.apiUserId]);
          await db.execute('INSERT INTO balance_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [
            req.apiUserId, priceUsd, 'refund', row.id,
          ]);
        }
      }
    }
    res.json({ ok: true, data });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Service temporarily unavailable. Please try again later.' });
  }
});

/** Cancel activation (refund if SMS not received). Same as POST .../status with action "end". */
router.post('/activation/:id/cancel', async (req, res) => {
  const row = await db.queryOne(
    'SELECT id, id_num, user_id, status, price_usd, sms_code FROM activations WHERE id = ? AND user_id = ?',
    [req.params.id, req.apiUserId]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  const hasReceivedSms = row.status === 'got_sms' || (row.sms_code != null && String(row.sms_code).trim() !== '');
  if (hasReceivedSms) {
    return res.status(400).json({ error: 'Cannot cancel. SMS already received — balance is consumed.' });
  }
  try {
    await vak.setStatus(row.id_num, 'end');
    await db.execute('UPDATE activations SET status = ? WHERE id = ?', ['cancelled', row.id]);
    const priceUsd = Number(row.price_usd) || 0;
    if (priceUsd > 0) {
      const existing = await db.queryOne('SELECT id FROM balance_log WHERE ref_id = ? AND amount > 0 AND reason = ?', [row.id, 'refund']);
      if (!existing) {
        await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [priceUsd, req.apiUserId]);
        await db.execute('INSERT INTO balance_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [
          req.apiUserId, priceUsd, 'refund', row.id,
        ]);
      }
    }
    res.json({ ok: true, message: 'Activation cancelled and refunded.' });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Service temporarily unavailable. Please try again later.' });
  }
});

/** Report number as banned/bad (refund if SMS not received). Same as POST .../status with action "bad". */
router.post('/activation/:id/banned', async (req, res) => {
  const row = await db.queryOne(
    'SELECT id, id_num, user_id, status, price_usd, sms_code FROM activations WHERE id = ? AND user_id = ?',
    [req.params.id, req.apiUserId]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  const hasReceivedSms = row.status === 'got_sms' || (row.sms_code != null && String(row.sms_code).trim() !== '');
  if (hasReceivedSms) {
    return res.status(400).json({ error: 'Cannot refund. SMS already received — balance is consumed.' });
  }
  try {
    await vak.setStatus(row.id_num, 'bad');
    await db.execute('UPDATE activations SET status = ? WHERE id = ?', ['cancelled', row.id]);
    const priceUsd = Number(row.price_usd) || 0;
    if (priceUsd > 0) {
      const existing = await db.queryOne('SELECT id FROM balance_log WHERE ref_id = ? AND amount > 0 AND reason = ?', [row.id, 'refund']);
      if (!existing) {
        await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [priceUsd, req.apiUserId]);
        await db.execute('INSERT INTO balance_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [
          req.apiUserId, priceUsd, 'refund', row.id,
        ]);
      }
    }
    res.json({ ok: true, message: 'Number reported as banned; refunded.' });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Service temporarily unavailable. Please try again later.' });
  }
});

/** Reuse / extend number after expiry (same as /prolong). Charge same price again, number goes back to waiting for SMS. */
router.post('/activation/:id/reuse', async (req, res) => {
  const row = await db.queryOne(
    'SELECT id, id_num, user_id, service, phone, price_usd, status, created_at, is_rent FROM activations WHERE id = ? AND user_id = ?',
    [req.params.id, req.apiUserId]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'got_sms') return res.status(400).json({ error: 'Can only reuse numbers you have received SMS on.' });
  const created = new Date(row.created_at).getTime();
  const mins = row.is_rent ? RENT_MINUTES : ONETIME_MINUTES;
  const expiry = created + mins * 60 * 1000;
  if (expiry > Date.now()) return res.status(400).json({ error: 'Number is still active. Reuse after it expires.' });
  const priceUsd = Number(row.price_usd) || 0;
  if (priceUsd <= 0) return res.status(400).json({ error: 'Invalid price.' });
  const user = await db.queryOne('SELECT balance FROM users WHERE id = ?', [req.apiUserId]);
  if (!user || Number(user.balance) < priceUsd) return res.status(400).json({ error: 'Insufficient balance' });
  try {
    await vak.prolongNumber(row.service, row.phone);
    await db.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [priceUsd, req.apiUserId]);
    await db.execute('INSERT INTO balance_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [
      req.apiUserId, -priceUsd, 'prolong', row.id,
    ]);
    await db.execute(
      'UPDATE activations SET status = ?, sms_code = NULL, created_at = NOW(), is_rent = 1 WHERE id = ?',
      ['waiting', row.id]
    );
    res.json({ ok: true, message: 'Number reused; waiting for SMS again.' });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Reuse failed. Number may no longer be available.' });
  }
});

router.post('/activation/:id/prolong', async (req, res) => {
  const row = await db.queryOne(
    'SELECT id, id_num, user_id, service, phone, price_usd, status, created_at, is_rent FROM activations WHERE id = ? AND user_id = ?',
    [req.params.id, req.apiUserId]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'got_sms') return res.status(400).json({ error: 'Can only extend numbers you have received SMS on.' });
  const created = new Date(row.created_at).getTime();
  const mins = row.is_rent ? RENT_MINUTES : ONETIME_MINUTES;
  const expiry = created + mins * 60 * 1000;
  if (expiry > Date.now()) return res.status(400).json({ error: 'Number is still active. Extend after it expires.' });
  const priceUsd = Number(row.price_usd) || 0;
  if (priceUsd <= 0) return res.status(400).json({ error: 'Invalid price.' });
  const user = await db.queryOne('SELECT balance FROM users WHERE id = ?', [req.apiUserId]);
  if (!user || Number(user.balance) < priceUsd) return res.status(400).json({ error: 'Insufficient balance' });
  try {
    await vak.prolongNumber(row.service, row.phone);
    await db.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [priceUsd, req.apiUserId]);
    await db.execute('INSERT INTO balance_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [
      req.apiUserId, -priceUsd, 'prolong', row.id,
    ]);
    await db.execute(
      'UPDATE activations SET status = ?, sms_code = NULL, created_at = NOW(), is_rent = 1 WHERE id = ?',
      ['waiting', row.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Extend failed. Number may no longer be available.' });
  }
});

module.exports = router;
