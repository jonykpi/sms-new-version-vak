require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');

const WEBSITE_NAME = process.env.WEBSITE_NAME || 'text2fa.com';

function sendHtmlWithSiteName(res, filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  res.send(html.replace(/\{\{WEBSITE_NAME\}\}/g, WEBSITE_NAME));
}
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { maintenanceMiddleware } = require('./middleware/maintenance');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const depositRoutes = require('./routes/deposit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'text2fa-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

app.use(maintenanceMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/deposit', depositRoutes);
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
app.get('/admin', (req, res) => sendHtmlWithSiteName(res, path.join(publicDir, 'admin', 'index.html')));

app.listen(PORT, () => {
  console.log(`${WEBSITE_NAME} running at http://localhost:${PORT}`);
});
