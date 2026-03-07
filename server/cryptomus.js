/**
 * Cryptomus payment API client
 * https://doc.cryptomus.com/merchant-api/
 */

const crypto = require('crypto');

const API_BASE = 'https://api.cryptomus.com/v1';
const API_BASE_V2 = 'https://api.cryptomus.com/v2/user-api';

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

/** V2 user-api request: sign = md5(base64_encode(json_body) . API_KEY), header userId = merchant UUID */
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


/**
 * Convert USD to crypto using exchange rate formula:
 * amount_in_crypto = usd_amount / course, where course is "<currency> -> USD".
 */
async function convertUsdToCryptoByRate(currency, usdAmount) {
  const cur = String(currency || '').toUpperCase();
  const amount = Number(usdAmount);
  if (!cur) throw new Error('Currency is required');
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid USD amount');

  try {
    const url = `${API_BASE}/exchange-rate/${encodeURIComponent(cur)}/list`;
    const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      if (res.status === 403) await logOutboundIpHint('[Cryptomus rate]');
      throw new Error(`Exchange rate API error (${res.status})`);
    }

    const data = await res.json();
    const list = Array.isArray(data?.result) ? data.result : [];
    const usdRow = list.find((row) => String(row?.to || '').toUpperCase() === 'USD');
    const course = Number(usdRow?.course);

    if (!Number.isFinite(course) || course <= 0) {
      throw new Error(`USD exchange rate not found for ${cur}`);
    }

    return {
      currency: cur,
      course,
      amount: amount / course,
    };
  } catch (rateError) {
    // Fallback for blocked/unstable public exchange-rate endpoint:
    // use authenticated calculate endpoint and derive course from 1 USD.
    const oneUsd = await calculate({ to: cur, from_amount: '1' });
    const oneUsdInCrypto = Number(oneUsd?.to ?? oneUsd?.to_amount ?? oneUsd?.amount);
    if (!Number.isFinite(oneUsdInCrypto) || oneUsdInCrypto <= 0) {
      throw new Error(`Failed to convert USD to ${cur}: ${rateError.message}`);
    }
    const course = 1 / oneUsdInCrypto;
    return {
      currency: cur,
      course,
      amount: amount * oneUsdInCrypto,
    };
  }
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

module.exports = { createWallet, calculate, convertUsdToCryptoByRate, signBody };
