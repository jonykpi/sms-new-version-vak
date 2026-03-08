/**
 * Cryptomus payment API client
 * https://doc.cryptomus.com/merchant-api/
 */

const crypto = require('crypto');

const API_BASE = 'https://api.cryptomus.com/v1';
const API_BASE_V2 = 'https://api.cryptomus.com/v2/user-api';
const RATE_CACHE_TTL_MS = Math.max(1000, (Number(process.env.CRYPTOMUS_RATE_CACHE_SECONDS) || 600) * 1000);
const conversionCache = new Map();
let lastConnectivityError = null;

function getConfig() {
  const apiKey = process.env.CRYPTOMUS_API_KEY;
  const merchantId = process.env.CRYPTOMUS_MERCHANT_ID;
  if (!apiKey || !merchantId) throw new Error('CRYPTOMUS_API_KEY and CRYPTOMUS_MERCHANT_ID must be set');
  return { apiKey, merchantId };
}

/** Mask secret for logs: first 2 + … + last N chars */
function mask(s, visible = 4) {
  if (!s || s.length <= visible * 2) return '***';
  return s.slice(0, 2) + '…' + s.slice(-visible);
}

function signBody(body, apiKey) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  return crypto.createHash('md5').update(b64 + apiKey).digest('hex');
}

async function logOutboundIpHint(prefix = '[Cryptomus]') {
  try {
    const ipRes = await fetch('https://api.ipify.org?format=json');
    const ipData = await ipRes.json();
    if (ipData && ipData.ip) {
      console.error(`${prefix} Your server outbound IP is:`, ipData.ip, '— add this IP to Cryptomus merchant IP whitelist.');
    }
  } catch (_) {}
}

async function getOutboundIp() {
  try {
    const ipRes = await fetch('https://api.ipify.org?format=json');
    const ipData = await ipRes.json();
    return ipData?.ip || null;
  } catch {
    return null;
  }
}

async function request(method, path, body = {}) {
  const { apiKey, merchantId } = getConfig();
  const debug = process.env.CRYPTOMUS_DEBUG === '1' || process.env.CRYPTOMUS_DEBUG === 'true';
  console.log(
    '[Cryptomus]',
    method,
    path,
    '| merchant:',
    debug ? merchantId : mask(merchantId, 6),
    '| apiKey:',
    mask(apiKey, 4)
  );
  const bodyStr = Object.keys(body).length ? JSON.stringify(body) : '';
  const sign = signBody(bodyStr, apiKey);
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'merchant': merchantId,
      'sign': sign,
      'Content-Type': 'application/json',
    },
    body: bodyStr || undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    console.error('[Cryptomus] Non-JSON response:', res.status, res.statusText, 'Body:', snippet);
    if (res.status === 403) {
      await logOutboundIpHint('[Cryptomus]');
    }
    throw new Error(
      res.status === 401 ? 'Invalid Cryptomus API key or merchant ID' :
      res.status === 403 ? 'Cryptomus returned 403: add your server IP to the Cryptomus merchant IP whitelist in the Cryptomus dashboard.' :
      res.status >= 500 ? 'Cryptomus server error — try again later' :
      `Cryptomus API returned invalid response (${res.status}). Check CRYPTOMUS_API_KEY and CRYPTOMUS_MERCHANT_ID.`
    );
  }
  if (data.state === 1) {
    const msg = data.message || (data.errors ? JSON.stringify(data.errors) : null) || 'Cryptomus API error';
    console.error('[Cryptomus] API error response:', JSON.stringify(data));
    throw new Error(msg);
  }
  return data.result || data;
}

/** GET v1 exchange-rate list: GET /v1/exchange-rate/{currency}/list. Returns array of { from, to, course }. */
async function getExchangeRateList(currency) {
  const cur = String(currency || '').toUpperCase();
  if (!cur) throw new Error('Currency is required');
  const path = `/exchange-rate/${cur}/list`;
  const bodyStr = '';
  const { apiKey, merchantId } = getConfig();
  const sign = signBody(bodyStr, apiKey);
  const res = await fetch(API_BASE + path, {
    method: 'GET',
    headers: {
      'merchant': merchantId,
      'sign': sign,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    console.error('[Cryptomus] exchange-rate list Non-JSON:', res.status, res.statusText, 'Body:', snippet);
    if (res.status === 403) await logOutboundIpHint('[Cryptomus]');
    throw new Error(`Cryptomus exchange-rate API error (${res.status})`);
  }
  if (data.state === 1) {
    const msg = data.message || (data.errors ? JSON.stringify(data.errors) : null) || 'Cryptomus API error';
    throw new Error(msg);
  }
  const list = data.result || data;
  return Array.isArray(list) ? list : [];
}
async function requestV2(method, path, body = {}) {
  const { apiKey, merchantId } = getConfig();
  const bodyStr = typeof body === 'string' ? body : (Object.keys(body).length ? JSON.stringify(body) : '');
  const sign = signBody(bodyStr, apiKey);

  const res = await fetch(API_BASE_V2 + path, {
    method,
    headers: {
      'userId': merchantId,
      'sign': sign,
      'Content-Type': 'application/json',
    },
    body: bodyStr || undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    console.error('[Cryptomus v2] Non-JSON response:', res.status, res.statusText, 'Body:', snippet);
    if (res.status === 403) await logOutboundIpHint('[Cryptomus v2]');
    throw new Error(`Cryptomus calculate API error (${res.status})`);
  }
  if (data.state === 1) {
    const msg = data.message || (data.errors ? JSON.stringify(data.errors) : null) || 'Cryptomus API error';
    throw new Error(msg);
  }
  return data.result || data;
}

/**
 * Parse crypto amount from Cryptomus convert/calculate response.
 * API returns string numbers in to, to_amount, or total_amount.
 */
function parseCryptoAmount(result) {
  if (result == null) return NaN;
  const raw = result.to ?? result.to_amount ?? result.total_amount ?? result.amount;
  if (raw === undefined || raw === null) return NaN;
  const n = Number(typeof raw === 'string' ? raw.replace(/\s/g, '') : raw);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Calculate conversion (v2 user-api)
 * POST /calculate with body { from, to, from_amount } or { from, to, to_amount }
 * Sign: md5(base64_encode(json_body) . API_KEY)
 */
async function calculate(opts) {
  const { from, to, from_amount, to_amount } = opts;
  const body = { from: 'USD', to };
  if (from_amount != null && from_amount !== '') body.from_amount = String(from_amount);
  else if (to_amount != null && to_amount !== '') body.to_amount = String(to_amount);
  else throw new Error('Either from_amount or to_amount is required');
  return requestV2('POST', '/convert/calculate', body);
}

async function calculateWithRetry(opts, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await calculate(opts);
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) {
        const delayMs = 250 * (i + 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError || new Error('Calculate failed');
}


/**
 * Convert USD to crypto using v1 exchange-rate list API.
 * GET /v1/exchange-rate/{currency}/list → find rate to USD, then amount_crypto = usdAmount / course.
 * (from = always USD, to = selected currency)
 */
async function convertUsdToCryptoByRate(currency, usdAmount) {
  const cur = String(currency || '').toUpperCase();
  const amount = Number(usdAmount);
  if (!cur) throw new Error('Currency is required');
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid USD amount');

  try {
    const list = await getExchangeRateList(cur);
    const usdRate = list.find((r) => String(r?.to || '').toUpperCase() === 'USD');
    if (!usdRate || usdRate.course == null) {
      throw new Error(`No USD rate found for ${cur}`);
    }
    const course = Number(String(usdRate.course).replace(/\s/g, ''));
    if (!Number.isFinite(course) || course <= 0) {
      throw new Error(`Invalid rate for ${cur} -> USD`);
    }
    // course = USD per 1 unit of crypto → amount_crypto = usdAmount / course
    const cryptoAmount = amount / course;
    const oneUsdInCrypto = 1 / course;
    const cached = { course, oneUsdInCrypto, updatedAt: Date.now() };
    conversionCache.set(cur, cached);
    lastConnectivityError = null;
    return {
      currency: cur,
      course,
      amount: cryptoAmount,
      cached: false,
    };
  } catch (e) {
    lastConnectivityError = {
      at: new Date().toISOString(),
      currency: cur,
      message: e?.message || 'Unknown error',
    };
    const cached = conversionCache.get(cur);
    if (cached && (Date.now() - cached.updatedAt) <= RATE_CACHE_TTL_MS) {
      return {
        currency: cur,
        course: cached.course,
        amount: amount * cached.oneUsdInCrypto,
        cached: true,
      };
    }
    throw e;
  }
}

async function getDiagnostics(opts = {}) {
  const probe = opts.probe === true;
  const outboundIp = await getOutboundIp();
  const diagnostics = {
    apiBase: API_BASE,
    apiBaseV2: API_BASE_V2,
    hasApiKey: Boolean(process.env.CRYPTOMUS_API_KEY),
    hasMerchantId: Boolean(process.env.CRYPTOMUS_MERCHANT_ID),
    outboundIp,
    cacheTtlSeconds: Math.round(RATE_CACHE_TTL_MS / 1000),
    cachedCurrencies: Array.from(conversionCache.keys()),
    lastConnectivityError,
    now: new Date().toISOString(),
  };

  if (!probe) return diagnostics;

  try {
    const test = await convertUsdToCryptoByRate('USDT', 1);
    diagnostics.probe = {
      ok: true,
      currency: test.currency,
      amount: test.amount,
      course: test.course,
      cached: test.cached === true,
      at: new Date().toISOString(),
    };
  } catch (e) {
    diagnostics.probe = {
      ok: false,
      error: e?.message || 'Probe failed',
      at: new Date().toISOString(),
    };
  }

  return diagnostics;
}

/**
 * Create static wallet (any amount to one address) — same as PHP createWallet
 * @param {Object} opts - currency (e.g. USDT), network (e.g. tron), order_id, url_callback
 */
async function createWallet(opts) {
  const { currency, network, order_id, url_callback } = opts;
  return request('POST', '/wallet', {
    currency: currency || undefined,
    network: network || undefined,
    order_id: String(order_id),
    url_callback: url_callback || undefined,
  });
}

module.exports = { createWallet, calculate, convertUsdToCryptoByRate, getDiagnostics, signBody };
