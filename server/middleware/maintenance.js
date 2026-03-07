/**
 * Maintenance mode: when enabled, only users with the bypass code can access the site.
 * Bypass is stored in a signed cookie (hash of code + secret).
 */
const db = require('../db');
const crypto = require('crypto');

const COOKIE_NAME = 'maintenance_bypass';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

async function getMaintenanceSettings() {
  const rows = await db.query("SELECT `key`, value FROM settings WHERE `key` IN ('maintenance_mode', 'maintenance_code')");
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return s;
}

function hashForCookie(code, secret) {
  if (!code || !secret) return null;
  return crypto.createHmac('sha256', secret).update(String(code)).digest('hex');
}

function hasValidBypass(req, settings) {
  const code = (settings.maintenance_code || '').trim();
  if (!code) return false;
  const secret = process.env.SESSION_SECRET || 'text2fa-secret-change-in-production';
  const expected = hashForCookie(code, secret);
  const cookie = req.cookies && req.cookies[COOKIE_NAME];
  if (!cookie || typeof cookie !== 'string') return false;
  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const cookieBuf = Buffer.from(cookie, 'hex');
    return expectedBuf.length === cookieBuf.length && crypto.timingSafeEqual(expectedBuf, cookieBuf);
  } catch {
    return false;
  }
}

/** Paths that are always allowed during maintenance (no bypass required) */
function isAllowedDuringMaintenance(req) {
  const path = req.path;
  if (path === '/maintenance') return true;
  if (path === '/api/config') return true;
  if (/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|map)$/i.test(path)) return true;
  if (path.startsWith('/assets/')) return true;
  return false;
}

function isPageRequest(req) {
  const path = req.path;
  return path === '/' || path === '/login' || path === '/register' || path === '/forgot-password' ||
    path === '/reset-password' || path === '/active' || path === '/topup' ||
    path === '/admin' || (path.endsWith('.html') && !path.includes('/'));
}

async function maintenanceMiddleware(req, res, next) {
  try {
    const settings = await getMaintenanceSettings();
    const enabled = settings.maintenance_mode === '1' || settings.maintenance_mode === 'true';
    if (!enabled) return next();

    if (hasValidBypass(req, settings)) return next();

    /* Access via URL: ?secret=CODE — set cookie and redirect to home (must check before allowing /maintenance) */
    const code = (settings.maintenance_code || '').trim();
    const querySecret = req.query && String(req.query.secret || '').trim();
    if (code && querySecret && code === querySecret) {
      setBypassCookie(res, code);
      return res.redirect(302, '/');
    }

    if (isAllowedDuringMaintenance(req)) return next();

    if (req.method === 'GET' && isPageRequest(req)) {
      return res.redirect(302, '/maintenance');
    }
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({ error: 'Site is under maintenance. Please try again later.' });
    }
    res.redirect(302, '/maintenance');
  } catch (e) {
    next(e);
  }
}

function setBypassCookie(res, code) {
  const secret = process.env.SESSION_SECRET || 'text2fa-secret-change-in-production';
  const value = hashForCookie(code, secret);
  if (!value) return;
  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE * 1000,
    path: '/',
  });
}

module.exports = {
  maintenanceMiddleware,
  setBypassCookie,
  getMaintenanceSettings,
  hasValidBypass,
  COOKIE_NAME,
};
