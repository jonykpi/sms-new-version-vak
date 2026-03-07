const express = require('express');
const db = require('../db');
const cryptomus = require('../cryptomus');
const { requireAuth, requireVerified } = require('../middleware/auth');
const { sendDepositSuccessEmail } = require('../email');

const router = express.Router();

function getBaseUrl() {
  return process.env.APP_URL || 'http://localhost:3000';
}

/* Fixed deposit options: BNB-BSC, BTC-BTC, LTC-LTC, USDT-BSC, USDT-TRON (no API call) */
const CRYPTO_OPTIONS = [
  { currency: 'BNB', network: 'BSC', label: 'BNB (BSC)' },
  { currency: 'BTC', network: 'BTC', label: 'BTC (BTC)' },
  { currency: 'LTC', network: 'LTC', label: 'LTC (LTC)' },
  { currency: 'USDT', network: 'BSC', label: 'USDT (BSC)' },
  { currency: 'USDT', network: 'TRON', label: 'USDT (TRON)' },
];

router.get('/options', (req, res) => {
  res.json({ options: CRYPTO_OPTIONS });
});

/** Convert USD to crypto using formula: amount_in_crypto = usd_amount / course */
router.post('/calculate', async (req, res) => {
  try {
    const { to, amount_usd, from_amount } = req.body;
    if (!to) return res.status(400).json({ error: 'to is required' });

    const usdAmount = amount_usd != null ? Number(amount_usd) : Number(from_amount);
    if (!Number.isFinite(usdAmount) || usdAmount < 0) {
      return res.status(400).json({ error: 'amount_usd must be a valid non-negative number' });
    }

    const result = await cryptomus.convertUsdToCryptoByRate(to, usdAmount);
    return res.json({
      from: 'USD',
      to: result.amount,
      currency: result.currency,
      course: result.course,
      amount_usd: usdAmount,
    });
  } catch (e) {
    console.error('Deposit calculate error:', e.message);
    return res.status(502).json({ error: e.message || 'Conversion failed' });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  const rows = await db.query(
    'SELECT id, order_id, amount_usd, to_currency, network, status, created_at, paid_at FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 100',
    [req.session.userId]
  );
  res.json({ deposits: rows });
});

router.post('/create', requireAuth, requireVerified, async (req, res) => {
  try {
    const { amount_usd, amount_in_crypto, to_currency, network } = req.body;
    const amt = parseFloat(amount_usd);
    if (!Number.isFinite(amt) || amt < 1 || amt > 10000) {
      return res.status(400).json({ error: 'Amount must be between $1 and $10,000' });
    }
    if (!to_currency || !network) return res.status(400).json({ error: 'Invalid currency or network' });
    const opt = CRYPTO_OPTIONS.find(o => o.currency === to_currency && o.network === network);
    if (!opt) return res.status(400).json({ error: 'Currency or network not allowed' });

    const urlCallback = `${getBaseUrl()}/api/deposit/webhook`;

    // 1. Create deposit row first with USD amount (like PHP TempDepositHistory::create)
    const tempOrderId = `p_${req.session.userId}_${Date.now()}`;
    const id = await db.insertAndGetId(
      `INSERT INTO deposits (user_id, order_id, amount_usd, to_currency, network, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [req.session.userId, tempOrderId, amt, to_currency, network]
    );
    const orderId = String(id);

    await db.execute('UPDATE deposits SET order_id = ? WHERE id = ?', [orderId, id]);

    // 2. Create wallet at Cryptomus with order_id = deposit id (like PHP createWallet)
    const walletCreate = await cryptomus.createWallet({
      currency: to_currency,
      network,
      order_id: orderId,
      url_callback: urlCallback,
    });

    // 3. Save Cryptomus response to same row (like PHP $order->cryptomus_uuid = ...)
    await db.execute(
      `UPDATE deposits SET cryptomus_uuid = ?, address = ? WHERE id = ?`,
      [
        walletCreate.uuid || walletCreate.wallet_uuid || null,
        walletCreate.address || null,
        id,
      ]
    );

    res.json({
      order_id: orderId,
      address: walletCreate.address,
      network: walletCreate.network || network,
      currency: walletCreate.currency || to_currency,
      url: walletCreate.url,
      amount_usd: amt,
    });
  } catch (e) {
    console.error('Deposit create error:', e);
    const isCryptomus = e.message && (e.message.includes('Cryptomus') || e.message.includes('API key') || e.message.includes('IP'));
    res.status(502).json({
      error: isCryptomus
        ? 'Payment provider is temporarily unavailable. Please try again later or contact support.'
        : (e.message || 'Failed to create payment'),
    });
  }
});

/* Webhook — called by Cryptomus, no auth. Verify signature. */
router.post('/webhook', async (req, res) => {
  const rawBody = req.rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    return res.status(400).send('Bad request');
  }
  const bodyStr = rawBody.toString('utf8');
  let data;
  try {
    data = JSON.parse(bodyStr);
  } catch {
    return res.status(400).send('Invalid JSON');
  }
  const sign = data.sign;
  if (!sign) return res.status(400).send('Missing sign');
  delete data.sign;
  const jsonForSign = JSON.stringify(data);
  const expectedSign = cryptomus.signBody(jsonForSign, process.env.CRYPTOMUS_API_KEY);
  if (sign !== expectedSign) {
    console.error('Cryptomus webhook: invalid signature');
    return res.status(400).send('Invalid signature');
  }

  const { order_id, status, amount, payment_amount_usd } = data;
  if (!order_id) return res.status(400).send('Missing order_id');

  const paid = status === 'paid' || status === 'paid_over';
  if (!paid) {
    await db.execute('UPDATE deposits SET status = ? WHERE order_id = ?', [status || 'failed', order_id]);
    return res.status(200).send('OK');
  }

  const dep = await db.queryOne('SELECT id, user_id, amount_usd, status FROM deposits WHERE order_id = ?', [order_id]);
  if (!dep) {
    console.error('Deposit not found:', order_id);
    return res.status(200).send('OK');
  }
  if (dep.status === 'paid') {
    return res.status(200).send('OK');
  }

  const creditAmount = parseFloat(payment_amount_usd || amount || dep.amount_usd) || dep.amount_usd;
  await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [creditAmount, dep.user_id]);
  await db.execute('INSERT INTO balance_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [
    dep.user_id,
    creditAmount,
    'deposit',
    dep.id,
  ]);
  await db.execute('UPDATE deposits SET status = ?, paid_at = NOW(), amount_usd = ? WHERE id = ?', ['paid', creditAmount, dep.id]);

  const user = await db.queryOne('SELECT email, name FROM users WHERE id = ?', [dep.user_id]);
  if (user && user.email) {
    try {
      await sendDepositSuccessEmail(user.email, user.name, creditAmount);
    } catch (e) {
      console.error('Deposit email error:', e);
    }
  }

  res.status(200).send('OK');
});

module.exports = router;
