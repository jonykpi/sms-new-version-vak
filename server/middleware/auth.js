async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Login required' });
    }
    return res.redirect('/login');
  }
  const db = require('../db');
  const row = await db.queryOne('SELECT suspended FROM users WHERE id = ?', [req.session.userId]);
  if (row && row.suspended && !req.session.impersonating) {
    req.session.destroy(() => {});
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'Account suspended. Contact support.' });
    }
    return res.redirect('/login?error=suspended');
  }
  next();
}

async function requireVerified(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Login required' });
    }
    return res.redirect('/login');
  }
  const db = require('../db');
  const row = await db.queryOne('SELECT email_verified FROM users WHERE id = ?', [req.session.userId]);
  if (!row || !row.email_verified) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'Verify your email to deposit or place orders.' });
    }
    return res.redirect('/?verify=1');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.isAdmin) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ error: 'Admin required' });
  }
  return res.redirect('/');
}

/** Resolve API key from X-API-Key header or Authorization: Bearer <key> */
function getApiKeyFromRequest(req) {
  const header = req.headers['x-api-key'];
  if (header && typeof header === 'string') return header.trim();
  const auth = req.headers.authorization;
  if (auth && typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

/** Require valid API key; sets req.apiUserId and req.apiKeyId. Used by /api/v1/* */
async function requireApiKey(req, res, next) {
  const key = getApiKeyFromRequest(req);
  if (!key) {
    return res.status(401).json({ error: 'API key required. Send X-API-Key header or Authorization: Bearer <key>.' });
  }
  const db = require('../db');
  const row = await db.queryOne(
    'SELECT ak.id, ak.user_id, u.suspended FROM api_keys ak JOIN users u ON u.id = ak.user_id WHERE ak.api_key = ?',
    [key]
  );
  if (!row) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }
  if (row.suspended) {
    return res.status(403).json({ error: 'Account suspended. Contact support.' });
  }
  req.apiUserId = row.user_id;
  req.apiKeyId = row.id;
  next();
}

module.exports = { requireAuth, requireVerified, requireAdmin, requireApiKey, getApiKeyFromRequest };
