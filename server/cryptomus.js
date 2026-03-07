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

function signBody(body, apiKey) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  return crypto.createHash('md5').update(b64 + apiKey).digest('hex');
}

async function request(method, path, body = {}) {
  const { apiKey, merchantId } = getConfig();
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
    throw new Error(
      res.status === 401 ? 'Invalid Cryptomus API key or merchant ID' :
      res.status === 403 ? 'Cryptomus access denied (check API key and IP)' :
      res.status >= 500 ? 'Cryptomus server error — try again later' :
      `Cryptomus API returned invalid response (${res.status}). Check CRYPTOMUS_API_KEY and CRYPTOMUS_MERCHANT_ID.`
    );
  }
  if (data.state === 1) throw new Error(data.message || data.errors ? JSON.stringify(data.errors) : 'Cryptomus API error');
  return data.result || data;
}

/**
 * Create payment invoice
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

module.exports = { createPayment, signBody };
