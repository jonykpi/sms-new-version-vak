# text2fa.com

SMS activation and virtual number rental — same design as VAK-SMS, powered by [VAK-SMS](https://vak-sms.com/) API. You set the RUB→USD rate and commission; users pay in USD from their balance.

## Features

- **Same layout as VAK-SMS**: service list with "Get", active numbers page, balance in header
- **English** only
- **Your pricing**: in admin set "1 RUB = X USD" and "Commission %" (e.g. 5%). User price = (VAK price in RUB × rate) × (1 + commission%)
- **User balance**: you give users balance (admin panel); they spend it on numbers
- **VAK-SMS behind**: all numbers and SMS go through your VAK-SMS API key

## Setup

1. **Copy env and set your VAK-SMS API key**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set:
   - `VAK_API_KEY` (your VAK-SMS API key)
   - `SESSION_SECRET` to a random string in production
   - `ADMIN_EMAIL=admin@text2fa.com` — the first account that registers with this email becomes admin
   - MySQL: `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` (create the database first, e.g. `CREATE DATABASE vak_copy`)

2. **Install and run**
   ```bash
   npm install
   npm run init-db   # creates MySQL tables (users, settings, activations, balance_log)
   npm start
   ```
   Open http://localhost:3000

3. **Admin**
   - Register with the email you set as `ADMIN_EMAIL` (e.g. admin@text2fa.com)
   - Go to **/admin**
   - Set **1 RUB = (USD)** e.g. `0.011`, and **Commission %** e.g. `5`
   - Add balance to users so they can order numbers

## Admin panel

- **Pricing**: `rub_to_usd` (e.g. 0.011 = 1 RUB = 0.011 USD), `commission_percent` (e.g. 5)
- **VAK balance**: view your VAK-SMS balance (RUB)
- **Users**: list users and add/subtract balance (reason logged)

## Tech

- **Backend**: Node.js, Express, MySQL (mysql2), bcrypt, sessions
- **Frontend**: plain HTML/CSS/JS, no build step
- **API**: VAK-SMS JSON API (getBalance, getNumber, getCountNumber, getCountryList, getStatus)

## Notes

- First user to register with `ADMIN_EMAIL` is admin
- User balance is in USD; VAK charges in RUB — conversion uses your `rub_to_usd` and `commission_percent`
- SMS status is polled from VAK (getStatus by idNum); codes appear on the Active numbers page
# sms-new-version-vak
