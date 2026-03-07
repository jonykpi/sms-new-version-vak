const express = require('express');
const db = require('../db');
const cryptomus = require('../cryptomus');
const { requireAuth, requireVerified } = require('../middleware/auth');
const { sendDepositSuccessEmail } = require('../email');

const router = express.Router();

function getBaseUrl() {
  return process.env.APP_URL || 'http://localhost:3000';
}

/* Currencies and networks we support for top-up */
const CRYPTO_OPTIONS = [
  { currency: 'USDT', network: 'tron', label: 'USDT (TRC-20)' },
  { currency: 'USDT', network: 'ethereum', label: 'USDT (ERC-20)' },
  { currency: 'USDT', network: 'bsc', label: 'USDT (BEP-20)' },
  { currency: 'USDC', network: 'ethereum', label: 'USDC (ERC-20)' },
  { currency: 'USDC', network: 'tron', label: 'USDC (TRC-20)' },
  { currency: 'BTC', network: 'btc', label: 'Bitcoin' },
  { currency: 'ETH', network: 'ethereum', label: 'Ethereum' },
  { currency: 'TRX', network: 'tron', label: 'TRON' },
];

router.get('/options', (req, res) => {
  res.json({ options: CRYPTO_OPTIONS });
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
    const { amount, to_currency, network } = req.body;
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt < 1 || amt > 10000) {
      return res.status(400).json({ error: 'Amount must be between $1 and $10,000' });
    }
    const opt = CRYPTO_OPTIONS.find(o => o.currency === to_currency && o.network === network);
    if (!opt) return res.status(400).json({ error: 'Invalid currency or network' });

    const orderId = `dep_${req.session.userId}_${Date.now()}`;
    const urlCallback = `${getBaseUrl()}/api/deposit/webhook`;
    const urlSuccess = `${getBaseUrl()}/topup?success=1`;
    const urlReturn = `${getBaseUrl()}/topup`;

    const result = await cryptomus.createPayment({
      amount: amt.toFixed(2),
      order_id: orderId,
      to_currency,
      network,
      url_callback: urlCallback,
      url_success: urlSuccess,
      url_return: urlReturn,
    });

    await db.execute(
      `INSERT INTO deposits (user_id, order_id, amount_usd, to_currency, network, status, cryptomus_uuid, address, payer_amount, payer_currency)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [
        req.session.userId,
        orderId,
        amt,
        to_currency,
        network,
        result.uuid || null,
        result.address || null,
        result.payer_amount || null,
        result.payer_currency || result.currency || null,
      ]
    );

    res.json({
      order_id: orderId,
      address: result.address,
      payer_amount: result.payer_amount,
      payer_currency: result.payer_currency || result.currency,
      amount_usd: result.amount,
      network: result.network,
      expired_at: result.expired_at,
      url: result.url,
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
  await db.execute('UPDATE deposits SET status = ?, paid_at = NOW() WHERE id = ?', ['paid', dep.id]);

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
