/**
 * VAK-SMS API client (official API from docs)
 * Base: https://vak-sms.com/api/
 * All prices from VAK are in RUB. We convert to USD using admin rate + commission.
 */

const BASE = 'https://vak-sms.com/api';

const API_ERRORS = {
  apiKeyNotFound: 'Service temporarily unavailable.',
  noService: 'This service is not available.',
  noNumber: 'No numbers available. Try again later.',
  noMoney: 'Service temporarily unavailable. Please try again later.',
  noCountry: 'Selected country is not available.',
  noOperator: 'Selected operator is not available. Try "Any operator" or choose from the list.',
  badOperator: 'Selected operator is not available. Try "Any operator" or choose from the list.',
  badStatus: 'Service temporarily unavailable.',
  idNumNotFound: 'Service temporarily unavailable.',
  badService: 'This service is not available.',
  badData: 'Invalid request. Please try again.',
};

function getApiKey() {
  const key = process.env.VAK_API_KEY;
  if (!key) throw new Error('VAK_API_KEY is not set');
  return key;
}

async function fetchApi(path, params = {}) {
  const base = BASE.endsWith('/') ? BASE : BASE + '/';
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, base);
  url.searchParams.set('apiKey', getApiKey());
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString());
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text || 'Service temporarily unavailable');
  }
  if (data.error) {
    const msg = API_ERRORS[data.error] || data.error;
    const err = new Error(msg);
    err.code = data.error;
    throw err;
  }
  return data;
}

async function getBalance() {
  const data = await fetchApi('getBalance/');
  return data.balance != null ? Number(data.balance) : 0;
}

/**
 * Number of available numbers (and price if param price is set)
 * GET getCountNumber/?apiKey=...&service=...&country=...&operator=...&price
 */
async function getCountNumber(service, country = 'usv', operator = '', withPrice = true) {
  const params = { service, country };
  if (operator) params.operator = operator;
  if (withPrice) params.price = '1';
  const data = await fetchApi('getCountNumber/', params);
  const count = data[service] != null ? Number(data[service]) : 0;
  const priceRub = data.price != null ? Number(data.price) : null;
  return { count, priceRub };
}

async function getCountryList() {
  return fetchApi('getCountryList/');
}

/* Country: new API (ru,us,gb) -> stubs numeric (0,187,16) */
const COUNTRY_TO_STUBS = {
  ru: 0, ua: 1, kz: 2, ph: 4, mm: 5, id: 6, my: 7, ke: 8, tz: 9, vn: 10, kg: 11,
  usv: 12, il: 13, hk: 14, pl: 15, gb: 16, eg: 21, in: 22, ie: 23, la: 25,
  ro: 32, ee: 34, ca: 36, ma: 37, uz: 40, cm: 41, de: 43, lt: 44, hr: 45, se: 46,
  nl: 48, lv: 49, th: 52, mx: 54, es: 56, pt: 56, fi: 163, bd: 60, cz: 63,
  lk: 64, pe: 65, pk: 66, pa: 67, ng: 68, ni: 69, ne: 70, np: 71, nz: 72,
  no: 73, ae: 74, bo: 75, br: 76, by: 77, cy: 77, fr: 78, ch: 78, cl: 79,
  co: 80, cr: 81, be: 82, mk: 83, bg: 83, md: 85, it: 86, hn: 88, gt: 94,
  tl: 91, om: 107, sl: 115, lr: 84, bi: 119, sk: 141, tj: 143, cd: 150,
  bf: 152, mw: 137, cav: 1000, us: 187, ps: 188, za: 31, zw: 96,
};

/**
 * Getting a number. service can be "wa" or "wa,vi" for one number for two services.
 * rent=true: 4-hour rental.
 * Tries new API first; falls back to stubs handler if badService (API key may only work with stubs).
 */
async function getNumber(service, country = 'usv', operator = '', rent = false) {
  const params = { service, country };
  if (operator) params.operator = operator;
  if (rent) params.rent = 'true';

  try {
    const data = await fetchApi('getNumber/', params);
    if (Array.isArray(data)) {
      return data.map(({ tel, service: s, idNum }) => ({ tel: String(tel), service: s, idNum }));
    }
    return { tel: String(data.tel), idNum: data.idNum };
  } catch (e) {
    if (e.code !== 'badService' && e.code !== 'noService') throw e;
    return getNumberStubs(service, country, operator);
  }
}

/* Stubs API uses different service codes for some services (e.g. go not gl for Google) */
const STUBS_SERVICE_MAP = { gl: 'go', mr: 'vk' };

/** Fallback: sms-activate stubs handler (api_key, action=getNumber, country numeric) */
async function getNumberStubs(service, country, operator) {
  const key = getApiKey();
  const countryNum = COUNTRY_TO_STUBS[country] ?? 0;
  let svc = service.includes(',') ? service.split(',')[0].trim() : service;
  svc = STUBS_SERVICE_MAP[svc] || svc;
  const url = new URL('https://vak-sms.com/stubs/handler_api.php');
  url.searchParams.set('api_key', key);
  url.searchParams.set('action', 'getNumber');
  url.searchParams.set('service', svc);
  url.searchParams.set('country', countryNum);
  if (operator) url.searchParams.set('operator', operator);
  const res = await fetch(url);
  const text = (await res.text()).trim();
  if (text.startsWith('ACCESS_NUMBER:')) {
    const [, id, number] = text.split(':');
    return { tel: number, idNum: id };
  }
  if (text === 'NO_NUMBERS') throw Object.assign(new Error('No numbers available. Try again later.'), { code: 'noNumber' });
  if (text === 'NO_BALANCE') throw Object.assign(new Error('Insufficient balance on provider.'), { code: 'noMoney' });
  if (text === 'BAD_KEY') throw Object.assign(new Error('Invalid API key.'), { code: 'apiKeyNotFound' });
  if (text === 'BAD_SERVICE') throw Object.assign(new Error('Invalid service code.'), { code: 'badService' });
  throw new Error(text || 'Service temporarily unavailable');
}

/**
 * Activation state / get SMS code.
 * If idNum is numeric (from stubs), uses stubs getStatus. Otherwise uses new API getSmsCode.
 */
async function getSmsCode(idNum, all = false) {
  const isStubsId = /^\d+$/.test(String(idNum));
  if (isStubsId) return getSmsCodeStubs(idNum);
  const params = { idNum };
  if (all) params.all = '1';
  const data = await fetchApi('getSmsCode/', params);
  return data;
}

async function getSmsCodeStubs(id) {
  const url = `https://vak-sms.com/stubs/handler_api.php?api_key=${encodeURIComponent(getApiKey())}&action=getStatus&id=${id}`;
  const res = await fetch(url);
  const text = (await res.text()).trim();
  if (text.startsWith('STATUS_OK:')) return { smsCode: text.replace('STATUS_OK:', '').trim() };
  if (text === 'STATUS_WAIT_CODE' || text === 'STATUS_WAIT_RETRY' || text === 'STATUS_WAIT_RESEND') return { smsCode: null };
  if (text === 'STATUS_CANCEL') return { smsCode: null };
  return { smsCode: null };
}

/**
 * Change status: send = request another SMS (free), end = cancel, bad = number used/banned
 * If idNum is numeric (from stubs), uses stubs handler.
 */
async function setStatus(idNum, status) {
  const valid = ['send', 'end', 'bad'];
  if (!valid.includes(status)) throw new Error('badStatus');
  const isStubsId = /^\d+$/.test(String(idNum));
  if (isStubsId) return setStatusStubs(idNum, status);
  const data = await fetchApi('setStatus/', { idNum, status });
  return data;
}

async function setStatusStubs(id, status) {
  const statusMap = { send: 3, end: 6, bad: 8 };
  const s = statusMap[status] || 6;
  const url = `https://vak-sms.com/stubs/handler_api.php?api_key=${encodeURIComponent(getApiKey())}&action=setStatus&id=${id}&status=${s}`;
  const res = await fetch(url);
  const text = (await res.text()).trim();
  return { status: text };
}

/**
 * Prolong (renew) a previously received number. Requires prior SMS received on that number.
 */
async function prolongNumber(service, tel) {
  const data = await fetchApi('prolongNumber/', { service, tel });
  return data;
}

module.exports = {
  getBalance,
  getCountNumber,
  getCountryList,
  getNumber,
  getSmsCode,
  setStatus,
  prolongNumber,
};
module.exports.API_ERRORS = API_ERRORS;
