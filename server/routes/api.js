const express = require('express');
const db = require('../db');
const vak = require('../vak');
const cache = require('../cache');
const { requireAuth, requireVerified } = require('../middleware/auth');

const router = express.Router();

function getBaseUrl() {
  return (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

async function getSettings() {
  const rows = await db.query('SELECT `key`, value FROM settings');
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return s;
}

function rubToUsd(rub, settings) {
  const rate = Number(settings.rub_to_usd) || 0.011;
  const commission = Number(settings.commission_percent) || 5;
  const usd = rub * rate;
  return Math.round(usd * (1 + commission / 100) * 100) / 100;
}

function normalizeCountryList(raw) {
  const DISPLAY_NAMES = {
    us: 'United States',
    usv: 'United States virtual',
    cav: 'Canada virtual',
    gb: 'United Kingdom',
    ru: 'Russia',
    ua: 'Ukraine',
    ca: 'Canada',
    au: 'Australia',
    de: 'Germany',
    fr: 'France',
    in: 'India',
    br: 'Brazil',
    mx: 'Mexico',
    pl: 'Poland',
    nl: 'Netherlands',
    it: 'Italy',
    es: 'Spain',
    id: 'Indonesia',
    ph: 'Philippines',
    vn: 'Vietnam',
    th: 'Thailand',
    ng: 'Nigeria',
    ke: 'Kenya',
    za: 'South Africa',
    eg: 'Egypt',
    pk: 'Pakistan',
    bd: 'Bangladesh',
  };
  let list;
  if (Array.isArray(raw)) list = raw.filter(c => c && (c.countryCode || c.country));
  else {
    const obj = raw || {};
    list = Object.entries(obj).map(([k, v]) => {
      if (!v || typeof v !== 'object') return null;
      const code = (v.countryCode || v.country || (String(k).length === 2 ? k : null));
      if (!code) return null;
      const codeLower = String(code).toLowerCase();
      const ops = v.operatorList || v.operators;
      let operatorList = ['any'];
      if (Array.isArray(ops)) operatorList = ops;
      else if (ops && typeof ops === 'object' && !Array.isArray(ops)) operatorList = ['any', ...Object.keys(ops)];
      else if (ops && typeof ops === 'string' && ops.trim()) operatorList = ['any', ...ops.trim().split(/\s+/).filter(Boolean)];
      const countryName = DISPLAY_NAMES[codeLower] || v.countryName || v.country || code;
      return { countryCode: code, countryName, operatorList };
    }).filter(Boolean);
  }
  return list.map(c => {
    const code = c.countryCode || c.country;
    const codeLower = String(code).toLowerCase();
    const countryName = DISPLAY_NAMES[codeLower] || c.countryName || c.country || code;
    return { ...c, countryCode: code, countryName };
  });
}

/** Normalize getCountryOperatorList response: { AO: [{ name, icon, count, operators }], ... } -> array with full icon URLs */
function normalizeCountryOperatorList(raw, baseUrl) {
  const base = baseUrl || getBaseUrl();
  function fullUrl(path) {
    if (!path || typeof path !== 'string') return undefined;
    return path.startsWith('http') ? path : (base + (path.startsWith('/') ? path : '/' + path));
  }
  const DISPLAY_NAMES = {
    us: 'United States',
    usv: 'United States virtual',
    cav: 'Canada virtual',
    gb: 'United Kingdom',
  };
  function localOperatorIcon(iconPath) {
    if (!iconPath || typeof iconPath !== 'string') return undefined;
    const filename = iconPath.split('/').pop();
    const path = filename ? '/assets/operator/' + filename : undefined;
    return path ? fullUrl(path) : undefined;
  }
  const obj = raw && typeof raw === 'object' ? raw : {};
  return Object.entries(obj).map(([codeKey, arr]) => {
    if (!Array.isArray(arr) || !arr[0]) return null;
    const entry = arr[0];
    const codeLower = String(codeKey).toLowerCase();
    const operators = entry.operators && typeof entry.operators === 'object' ? entry.operators : {};
    const operatorList = [
      { id: 'any', name: 'Any operator', icon: undefined },
      ...Object.entries(operators).map(([id, list]) => {
        const op = Array.isArray(list) && list[0] ? list[0] : { name: id, icon: null };
        return { id, name: op.name || id, icon: localOperatorIcon(op.icon) };
      }).filter(Boolean),
    ];
    const countryName = DISPLAY_NAMES[codeLower] || entry.name || codeKey;
    let icon = null;
    if (entry.icon && typeof entry.icon === 'string') {
      const filename = entry.icon.split('/').pop() || '';
      if (filename) icon = fullUrl('/assets/country/' + filename);
    }
    return {
      countryCode: codeLower,
      countryName,
      count: entry.count != null ? Number(entry.count) : 0,
      operatorList,
      icon: icon || undefined,
    };
  }).filter(Boolean).filter(c => (c.count != null && c.count > 0));
}

/* Public config (Crisp chat ID, website name, etc.) */
router.get('/config', (req, res) => {
  const crispWebsiteId = (process.env.CRISP_WEBSITE_ID || '').trim();
  const websiteName = process.env.WEBSITE_NAME || 'text2fa.com';
  res.json({ crispWebsiteId: crispWebsiteId || null, websiteName });
});

/* Public routes — guests can see countries, operators, services, prices */
router.get('/countries', async (req, res) => {
  try {
    const settings = await getSettings();
    const ttl = Number(settings.cache_ttl_minutes) || 5;
    const cacheKey = 'countries';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const baseUrl = getBaseUrl();
    let data;
    try {
      const raw = await vak.getCountryOperatorList();
      data = normalizeCountryOperatorList(raw, baseUrl);
    } catch (e) {
      const raw = await vak.getCountryList();
      data = normalizeCountryList(raw);
      data = (data || []).map((c) => ({
        ...c,
        icon: baseUrl + '/assets/country/' + (c.countryCode || c.country || '').toLowerCase() + '.png',
      }));
    }
    cache.set(cacheKey, data, ttl);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Service temporarily unavailable. Please try again later.' });
  }
});

router.get('/services', async (req, res) => {
  const baseUrl = getBaseUrl();
  const country = (req.query.country || '').trim().toLowerCase();
  const operator = (req.query.operator || '').trim();
  const services = require('../services-list.json');
  const list = (services || []).map((s) => ({
    code: s.code,
    name: s.name,
    icon: baseUrl + '/assets/service/' + (s.code || '') + '.png',
  }));

  if (!country) {
    return res.json(list);
  }

  try {
    const settings = await getSettings();
    const ttl = Math.min(2, Number(settings.cache_ttl_minutes) || 5);
    const cacheKey = `services:${country}:${operator || 'any'}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const filtered = [];
    for (const s of list) {
      try {
        const { count, priceRub } = await vak.getCountNumber(s.code, country, operator || '');
        if (count > 0) {
          const priceUsd = priceRub != null ? rubToUsd(priceRub, settings) : null;
          filtered.push({ ...s, count, priceUsd });
        }
      } catch (_) {
        /* skip service if not available */
      }
    }
    cache.set(cacheKey, filtered, ttl);
    res.json(filtered);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Service temporarily unavailable. Please try again later.' });
  }
});

/** Operators by country — same data as /countries, response shape focused on operators list; full icon URLs */
router.get('/operators', async (req, res) => {
  try {
    const settings = await getSettings();
    const ttl = Number(settings.cache_ttl_minutes) || 5;
    const cacheKey = 'operators';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const baseUrl = getBaseUrl();
    let data;
    try {
      const raw = await vak.getCountryOperatorList();
      data = normalizeCountryOperatorList(raw, baseUrl);
    } catch (e) {
      const raw = await vak.getCountryList();
      data = normalizeCountryList(raw);
      data = (data || []).map((c) => {
        const code = (c.countryCode || c.country || '').toLowerCase();
        const ops = c.operatorList || [];
        const operatorList = ops.map((op) => {
          const id = typeof op === 'object' && op && op.id != null ? op.id : op;
          const name = typeof op === 'object' && op && op.name != null ? op.name : id;
          return {
            id: id,
            name: name,
            icon: id && id !== 'any' ? baseUrl + '/assets/operator/' + id + '.png' : undefined,
          };
        });
        return {
          ...c,
          icon: baseUrl + '/assets/country/' + code + '.png',
          operatorList,
        };
      });
    }
    const operatorsResponse = {
      countries: (data || []).map((c) => ({
        countryCode: c.countryCode || c.country,
        countryName: c.countryName || c.countryCode || '',
        count: c.count,
        operators: (c.operatorList || []).map((op) => ({
          id: op.id || op,
          name: op.name || (typeof op === 'string' ? op : ''),
          icon: op.icon,
        })),
        icon: c.icon,
      })),
    };
    cache.set(cacheKey, operatorsResponse, ttl);
    res.json(operatorsResponse);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Service temporarily unavailable. Please try again later.' });
  }
});

router.get('/notification', async (req, res) => {
  try {
    const settings = await getSettings();
    const enabled = settings.notification_enabled === '1' || settings.notification_enabled === 'true';
    const text = String(settings.notification_text || '').trim();
    res.json({ enabled: !!enabled && text.length > 0, text });
  } catch (e) {
    res.json({ enabled: false, text: '' });
  }
});

router.get('/price/:service', async (req, res) => {
  try {
    const { service } = req.params;
    const country = (req.query.country || 'usv').toLowerCase();
    const operator = String(req.query.operator || '').trim();
    const settings = await getSettings();
    const ttl = Number(settings.cache_ttl_minutes) || 5;
    const cacheKey = `price:${service}:${country}:${operator}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      const priceUsd = cached.priceRub != null ? rubToUsd(cached.priceRub, settings) : null;
      return res.json({ count: cached.count, priceRub: cached.priceRub, priceUsd });
    }
    const { count, priceRub } = await vak.getCountNumber(service, country, operator);
    cache.set(cacheKey, { count, priceRub }, ttl);
    const priceUsd = priceRub != null ? rubToUsd(priceRub, settings) : null;
    res.json({ count, priceRub, priceUsd });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Service temporarily unavailable. Please try again later.' });
  }
});

/* Protected routes — require login */
router.use(requireAuth);

router.get('/balance', async (req, res) => {
  const row = await db.queryOne('SELECT balance FROM users WHERE id = ?', [req.session.userId]);
  res.json({ balance: row ? row.balance : 0 });
});

router.post('/get-number', requireVerified, async (req, res) => {
  try {
    const { service, country = 'usv', operator = '', rent = false } = req.body;
    const svc = String(service).trim();
    if (!svc) return res.status(400).json({ error: 'service required' });

    const settings = await getSettings();
    const services = svc.split(',').map(s => s.trim()).filter(Boolean);
    let totalPriceUsd = 0;
    const firstService = services[0];

    for (const s of services) {
      const { count, priceRub } = await vak.getCountNumber(s, country, operator);
      if (count === 0) return res.status(400).json({ error: 'No numbers available for ' + s });
      if (priceRub == null && priceRub !== 0) return res.status(400).json({ error: 'Price not available for this service/country' });
      totalPriceUsd += rubToUsd(priceRub || 0, settings);
    }

    const user = await db.queryOne('SELECT balance FROM users WHERE id = ?', [req.session.userId]);
    if (!user || Number(user.balance) < totalPriceUsd) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const result = await vak.getNumber(svc, country, operator, !!rent);
    const tel = Array.isArray(result) ? result[0]?.tel : result.tel;
    const idNum = Array.isArray(result) ? result[0]?.idNum : result.idNum;
    if (!tel || !idNum) return res.status(502).json({ error: 'Failed to get number' });

    const serviceName = services.map(s => (require('../services-list.json').find(x => x.code === s) || {}).name || s).join(' + ');
    const serviceCode = services.length > 1 ? firstService : svc;

    const isRent = !!rent;
    const actId = await db.insertAndGetId(
      'INSERT INTO activations (user_id, service, service_name, country, operator, phone, id_num, price_usd, status, is_rent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.session.userId, serviceCode, serviceName, country || 'usv', operator || null, tel, idNum, totalPriceUsd, 'waiting', isRent ? 1 : 0]
    );

    await db.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [totalPriceUsd, req.session.userId]);
    await db.execute('INSERT INTO balance_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [
      req.session.userId, -totalPriceUsd, 'activation', actId
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
          userId, priceUsd, 'refund', r.id
        ]);
      }
      await db.execute('UPDATE activations SET status = ? WHERE id = ?', ['cancelled', r.id]);
    }
  }
}

router.get('/activations', async (req, res) => {
  await processExpiredActivations(req.session.userId);
  const rows = await db.query(
    'SELECT id, service, service_name, country, phone, id_num, price_usd, status, sms_code, is_rent, created_at FROM activations WHERE user_id = ? ORDER BY id DESC',
    [req.session.userId]
  );
  res.json({ activations: rows });
});

router.get('/activation/:id/status', async (req, res) => {
  const row = await db.queryOne(
    'SELECT id, id_num, user_id, status, sms_code FROM activations WHERE id = ? AND user_id = ?',
    [req.params.id, req.session.userId]
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
    [req.params.id, req.session.userId]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { action } = req.body; // 'send' = more SMS, 'end' = cancel, 'bad' = number used/banned
  if (!['send', 'end', 'bad'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  /* Lock: once SMS received, balance is consumed — no cancel/refund */
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
          await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [priceUsd, req.session.userId]);
          await db.execute('INSERT INTO balance_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [
            req.session.userId, priceUsd, 'refund', row.id
          ]);
        }
      }
    }
    res.json({ ok: true, data });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Service temporarily unavailable. Please try again later.' });
  }
});

router.post('/activation/:id/prolong', async (req, res) => {
  const row = await db.queryOne(
    'SELECT id, id_num, user_id, service, phone, price_usd, status, created_at, is_rent FROM activations WHERE id = ? AND user_id = ?',
    [req.params.id, req.session.userId]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'got_sms') return res.status(400).json({ error: 'Can only extend numbers you have received SMS on.' });
  const created = new Date(row.created_at).getTime();
  const mins = row.is_rent ? RENT_MINUTES : ONETIME_MINUTES;
  const expiry = created + mins * 60 * 1000;
  if (expiry > Date.now()) return res.status(400).json({ error: 'Number is still active. Extend after it expires.' });
  const priceUsd = Number(row.price_usd) || 0;
  if (priceUsd <= 0) return res.status(400).json({ error: 'Invalid price.' });
  const user = await db.queryOne('SELECT balance FROM users WHERE id = ?', [req.session.userId]);
  if (!user || Number(user.balance) < priceUsd) return res.status(400).json({ error: 'Insufficient balance' });
  try {
    await vak.prolongNumber(row.service, row.phone);
    await db.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [priceUsd, req.session.userId]);
    await db.execute('INSERT INTO balance_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [
      req.session.userId, -priceUsd, 'prolong', row.id
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
