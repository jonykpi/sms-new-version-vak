/**
 * Cryptomus payment API client
 * https://doc.cryptomus.com/merchant-api/
 */

const crypto = require('crypto');

const API_BASE = 'https://api.cryptomus.com/v1';

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
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipRes.json();
        if (ipData && ipData.ip) {
          console.error('[Cryptomus] Your server outbound IP is:', ipData.ip, '— add this IP to Cryptomus merchant IP whitelist.');
        }
      } catch (_) {}
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

/**
 * Create payment invoice (fixed amount)
 * @param {Object} opts - amount (USD string), order_id, to_currency (e.g. USDT), network (e.g. tron), url_callback
 */
async function createPayment(opts) {
  const { amount, order_id, to_currency, network, url_callback, url_success, url_return } = opts;
  return request('POST', '/payment', {
    amount: String(amount),
    currency: 'USD',
    order_id,
    to_currency: to_currency || undefined,
    network: network || undefined,
    url_callback: url_callback || undefined,
    url_success: url_success || undefined,
    url_return: url_return || undefined,
    is_payment_multiple: true,
    lifetime: 3600,
  });
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

module.exports = { createPayment, createWallet, signBody };
