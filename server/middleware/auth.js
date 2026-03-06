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

module.exports = { requireAuth, requireVerified, requireAdmin };
