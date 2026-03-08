# API Reference

**Base URL:** Use your site URL from `.env`: `APP_URL` (e.g. `https://text2fa.com`). No trailing slash.

- Authenticated: `APP_URL/api/v1`
- Public data: `APP_URL/api` (no `/v1`)

## Authentication

Send your API key with every request using one of:

- **Header:** `X-API-Key: YOUR_API_KEY`
- **Header:** `Authorization: Bearer YOUR_API_KEY`

Generate an API key at **/api-docs** when logged in (verified email required for ordering numbers).

---

## Authenticated endpoints (API key required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/balance` | Get account balance (USD). |
| POST | `/api/v1/get-number` | Order a phone number. |
| GET | `/api/v1/activations` | List your activations. |
| GET | `/api/v1/activation/:id/status` | Get status and SMS code(s). Poll until `status` is `got_sms`. |
| POST | `/api/v1/activation/:id/status` | Set action: `send`, `end`, `bad`. |
| POST | `/api/v1/activation/:id/cancel` | Cancel activation and refund (only if SMS not received). |
| POST | `/api/v1/activation/:id/banned` | Report number as banned/bad and refund (only if SMS not received). |
| POST | `/api/v1/activation/:id/reuse` | Reuse / extend number after expiry (same price). |
| POST | `/api/v1/activation/:id/prolong` | Same as `/reuse`. |

### POST /api/v1/get-number

**Body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| service | string | Yes | Service code (e.g. `wa`, `gl`, `dr`). From GET /api/services. |
| country | string | No | Country code (default: `usv`). From GET /api/countries. |
| operator | string | No | Operator id or empty for any. |
| rent | boolean | No | `true` for rent (longer use), default `false`. |

**Response:** `{ "activation": { "id", "phone", "service", "service_name", "price_usd", "status", "created_at" } }`

### GET /api/v1/activation/:id/status

**Response (waiting):** `{ "status": "waiting" }`  
**Response (SMS received):** `{ "status": "got_sms", "sms_code": "123456", "sms_codes": ["123456"] }`

### POST /api/v1/activation/:id/status

**Body (JSON):** `{ "action": "send" | "end" | "bad" }`

- `send` — request another SMS.
- `end` — cancel and refund (only if SMS not received yet).
- `bad` — report number as bad, refund.

**Dedicated endpoints (same behaviour):**

- **POST /api/v1/activation/:id/cancel** — cancel and refund (no body).
- **POST /api/v1/activation/:id/banned** — report banned/bad and refund (no body).
- **POST /api/v1/activation/:id/reuse** — reuse/extend number after expiry (same price; no body). Same as `/prolong`.

---

## Public endpoints (no API key)

All `icon` fields are **full URLs** (e.g. `$APP_URL/assets/service/wa.png`). Use them directly in your app.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/services` | All services: `[{ "code", "name", "icon" }]`. With `?country=usv` (and optional `&operator=`) returns only services available there; each item includes `count`, `priceUsd`. |
| GET | `/api/countries` | List of countries with `countryCode`, `countryName`, `operatorList`, `count`, `icon` (full URL). |
| GET | `/api/operators` | Operators by country; each country and operator has `icon` (full URL). |
| GET | `/api/price/:service` | Price for service. Query: `?country=usv&operator=`. Returns `count`, `priceUsd`. |

For **request and response examples** for every endpoint, see the web documentation at **/api-docs**.

---

## Example (curl)

Replace `$APP_URL` with your actual base URL from `.env` (e.g. `https://text2fa.com`).

```bash
# Get balance
curl -H "X-API-Key: YOUR_KEY" "$APP_URL/api/v1/balance"

# Order a number (WhatsApp, US virtual)
curl -X POST -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"service":"wa","country":"usv","rent":false}' \
  "$APP_URL/api/v1/get-number"

# Get activation status (poll until got_sms)
curl -H "X-API-Key: YOUR_KEY" "$APP_URL/api/v1/activation/123/status"
```

---

## Errors

- **401** — Missing or invalid API key.
- **403** — Account suspended, or email not verified (for get-number).
- **404** — Activation not found or not yours.
- **4xx/5xx** — JSON body: `{ "error": "message" }`.
