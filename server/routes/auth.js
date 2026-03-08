const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { sendVerificationEmail, sendResetPasswordEmail } = require('../email');
const { requireAuth, requireVerified } = require('../middleware/auth');

const router = express.Router();

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@text2fa.com').toLowerCase();

function setSession(req, row) {
  req.session.userId = row.id;
  req.session.email = row.email;
  req.session.isAdmin = !!row.is_admin;
  req.session.emailVerified = !!row.email_verified;
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, confirmPassword, whatsapp, telegram } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const normalized = String(email).toLowerCase().trim();
    const hash = await bcrypt.hash(password, 10);
    const isAdmin = normalized === ADMIN_EMAIL ? 1 : 0;
    const autoVerify = isAdmin ? 1 : 0;
    const verificationToken = autoVerify ? null : crypto.randomBytes(32).toString('hex');
    const verificationExpires = autoVerify ? null : new Date(Date.now() + 24 * 60 * 60 * 1000);
    const insertId = await db.insertAndGetId(
      'INSERT INTO users (email, password_hash, is_admin, name, whatsapp, telegram, email_verified, verification_token, verification_token_expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [normalized, hash, isAdmin, (name || '').trim() || null, (whatsapp || '').trim() || null, (telegram || '').trim() || null, autoVerify, verificationToken, verificationExpires]
    );
    const row = await db.queryOne('SELECT id, email, balance, is_admin, name, email_verified FROM users WHERE id = ?', [insertId]);
    if (!autoVerify && verificationToken) {
      try {
        await sendVerificationEmail(normalized, (name || '').trim() || 'there', verificationToken);
      } catch (mailErr) {
        console.error('Verification email failed:', mailErr.message);
      }
    }
    setSession(req, row);
    res.json({ user: { id: row.id, email: row.email, balance: row.balance, isAdmin: !!row.is_admin, emailVerified: !!row.email_verified }, message: 'Check your email to verify your account.' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already registered' });
    res.status(500).json({ error: e.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const row = await db.queryOne(
    'SELECT id, email, password_hash, balance, is_admin, email_verified, suspended FROM users WHERE email = ?',
    [String(email).toLowerCase().trim()]
  );
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (row.suspended) {
    return res.status(403).json({ error: 'Account suspended. Contact support.' });
  }
  setSession(req, row);
  const isAdmin = !!row.is_admin;
  res.json({
    user: { id: row.id, email: row.email, balance: row.balance, isAdmin, emailVerified: !!row.email_verified },
    emailVerified: !!row.email_verified,
    redirect: isAdmin ? '/admin' : '/',
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login?error=invalid_token');
  const row = await db.queryOne('SELECT id, email, email_verified, verification_token_expires FROM users WHERE verification_token = ?', [token]);
  if (!row) return res.redirect('/login?error=invalid_token');
  if (row.email_verified) return res.redirect('/?verified=1');
  if (!row.verification_token_expires || new Date(row.verification_token_expires) < new Date()) {
    return res.redirect('/login?error=token_expired');
  }
  await db.execute('UPDATE users SET email_verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = ?', [row.id]);
  if (req.session && req.session.userId === row.id) req.session.emailVerified = true;
  res.redirect('/?verified=1');
});

router.post('/resend-verification', async (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Login required' });
  const row = await db.queryOne('SELECT id, email, name, email_verified FROM users WHERE id = ?', [req.session.userId]);
  if (!row) return res.status(401).json({ error: 'User not found' });
  if (row.email_verified) return res.status(400).json({ error: 'Email already verified' });
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.execute('UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?', [verificationToken, verificationExpires, row.id]);
  try {
    await sendVerificationEmail(row.email, row.name || 'there', verificationToken);
    res.json({ ok: true, message: 'Verification email sent. Check your inbox.' });
  } catch (e) {
    res.status(502).json({ error: 'Failed to send email. Try again later.' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const row = await db.queryOne('SELECT id, email, name FROM users WHERE email = ?', [String(email).toLowerCase().trim()]);
  if (row) {
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000);
    await db.execute('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [resetToken, resetExpires, row.id]);
    try {
      await sendResetPasswordEmail(row.email, row.name || 'there', resetToken);
    } catch (_) {}
  }
  res.json({ ok: true, message: 'If that email exists, we sent a reset link.' });
});

router.post('/reset-password', async (req, res) => {
  const { token, password, confirmPassword } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const row = await db.queryOne('SELECT id, reset_token_expires FROM users WHERE reset_token = ?', [token]);
  if (!row) return res.status(400).json({ error: 'Invalid or expired link' });
  if (!row.reset_token_expires || new Date(row.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'Link expired. Request a new one.' });
  }
  const hash = await bcrypt.hash(password, 10);
  await db.execute('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [hash, row.id]);
  res.json({ ok: true, message: 'Password updated. You can now log in.' });
});

router.get('/me', async (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const row = await db.queryOne('SELECT id, email, balance, is_admin, name, email_verified, suspended, admin_note FROM users WHERE id = ?', [req.session.userId]);
  if (!row) return res.status(401).json({ error: 'User not found' });
  if (row.suspended && !req.session.impersonating) {
    req.session.destroy(() => {});
    return res.status(403).json({ error: 'Account suspended. Contact support.' });
  }
  const payload = {
    user: {
      id: row.id,
      email: row.email,
      balance: row.balance,
      isAdmin: !!row.is_admin,
      name: row.name,
      emailVerified: !!row.email_verified,
      adminNote: row.admin_note ? String(row.admin_note).trim() : null,
    },
  };
  if (req.session.impersonating) payload.impersonating = true;
  res.json(payload);
});

/* ---------- API keys (for programmatic access) ---------- */
router.post('/api-keys', requireAuth, requireVerified, async (req, res) => {
  const name = (req.body.name || '').trim() || null;
  const apiKey = crypto.randomBytes(32).toString('hex');
  await db.execute(
    'INSERT INTO api_keys (user_id, api_key, name) VALUES (?, ?, ?)',
    [req.session.userId, apiKey, name]
  );
  res.status(201).json({
    message: 'API key created. Copy it now — it will not be shown again.',
    apiKey,
    prefix: apiKey.slice(0, 8) + '…',
  });
});

router.get('/api-keys', requireAuth, async (req, res) => {
  const rows = await db.query(
    'SELECT id, name, LEFT(api_key, 8) AS prefix, created_at FROM api_keys WHERE user_id = ? ORDER BY id DESC',
    [req.session.userId]
  );
  res.json({ apiKeys: rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix + '…', createdAt: r.created_at })) });
});

router.delete('/api-keys/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await db.execute('DELETE FROM api_keys WHERE id = ? AND user_id = ?', [id, req.session.userId]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'API key not found' });
  res.json({ ok: true });
});

module.exports = router;
