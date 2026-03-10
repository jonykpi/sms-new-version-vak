require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

const WEBSITE_NAME = process.env.WEBSITE_NAME || 'text2fa.com';
const APP_URL = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

function sendHtmlWithSiteName(res, filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  res.send(
    html
      .replace(/\{\{WEBSITE_NAME\}\}/g, WEBSITE_NAME)
      .replace(/\{\{APP_URL\}\}/g, APP_URL)
  );
}
const cookieParser = require('cookie-parser');
const { maintenanceMiddleware } = require('./middleware/maintenance');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const apiV1Routes = require('./routes/api-v1');
const adminRoutes = require('./routes/admin');
const depositRoutes = require('./routes/deposit');

const app = express();
const PORT = process.env.PORT || 3000;

/* Trust first proxy (nginx, etc.) so req.secure and IP are correct; required for cookies behind HTTPS */
app.set('trust proxy', 1);

const sessionStoreOptions = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'vak_copy',
  createDatabaseTable: true,
  expiration: 7 * 24 * 60 * 60 * 1000,
};
const sessionStore = new MySQLStore(sessionStoreOptions);

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'text2fa-secret-change-in-production',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  })
);

app.use(maintenanceMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/deposit', depositRoutes);
app.use('/api/v1', apiV1Routes);
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);

const publicDir = path.join(__dirname, '..', 'public');

app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const rel = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
    const filePath = path.join(publicDir, rel);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return sendHtmlWithSiteName(res, filePath);
    }
  }
  next();
});

app.use(express.static(publicDir, { index: false }));

app.get('/', (req, res) => sendHtmlWithSiteName(res, path.join(publicDir, 'index.html')));
app.get('/maintenance', (req, res) => sendHtmlWithSiteName(res, path.join(publicDir, 'maintenance.html')));
app.get('/login', (req, res) => sendHtmlWithSiteName(res, path.join(publicDir, 'login.html')));
app.get('/register', (req, res) => sendHtmlWithSiteName(res, path.join(publicDir, 'register.html')));
app.get('/forgot-password', (req, res) => sendHtmlWithSiteName(res, path.join(publicDir, 'forgot-password.html')));
app.get('/reset-password', (req, res) => sendHtmlWithSiteName(res, path.join(publicDir, 'reset-password.html')));
app.get('/active', (req, res) => sendHtmlWithSiteName(res, path.join(publicDir, 'active.html')));
app.get('/topup', (req, res) => sendHtmlWithSiteName(res, path.join(publicDir, 'topup.html')));
app.get('/api-docs', (req, res) => sendHtmlWithSiteName(res, path.join(publicDir, 'api-docs.html')));
app.get('/admin', (req, res) => sendHtmlWithSiteName(res, path.join(publicDir, 'admin', 'index.html')));

/* 404 — page not found */
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404);
  sendHtmlWithSiteName(res, path.join(publicDir, '404.html'));
});

function start() {
  app.listen(PORT, () => {
    console.log(`${WEBSITE_NAME} running at http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, PORT, start };
