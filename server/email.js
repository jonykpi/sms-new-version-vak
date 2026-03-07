const nodemailer = require('nodemailer');

function getTransporter() {
  const encryption = (process.env.MAIL_ENCRYPTION || '').toLowerCase();
  const port = parseInt(process.env.MAIL_PORT || '2525', 10);
  const secure = encryption === 'ssl' || port === 465;
  const requireTLS = (encryption === 'tls' || encryption === 'starttls') && !secure;
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'sandbox.smtp.mailtrap.io',
    port,
    secure,
    requireTLS: requireTLS || undefined,
    auth: process.env.MAIL_USERNAME ? {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
    } : undefined,
  });
}

function logMailError(label, to, err) {
  console.error('[MAIL ERROR]', label, 'to=', to);
  console.error('[MAIL ERROR] message:', err.message);
  if (err.code) console.error('[MAIL ERROR] code:', err.code);
  if (err.response) console.error('[MAIL ERROR] response:', err.response);
  if (err.responseCode) console.error('[MAIL ERROR] responseCode:', err.responseCode);
  if (err.command) console.error('[MAIL ERROR] command:', err.command);
  console.error('[MAIL ERROR] full error:', err);
}

function getBaseUrl() {
  return process.env.APP_URL || 'http://localhost:3000';
}

/** Resolve sender display name: .env cannot expand ${APP_NAME}, so we do it here */
function getMailFromName() {
  const raw = process.env.MAIL_FROM_NAME || '';
  const name = (raw.includes('${APP_NAME}') || raw === '${APP_NAME}')
    ? (process.env.APP_NAME || process.env.WEBSITE_NAME || 'text2fa.com')
    : (raw || process.env.WEBSITE_NAME || 'text2fa.com');
  return name.trim() || process.env.WEBSITE_NAME || 'text2fa.com';
}

const siteName = () => process.env.WEBSITE_NAME || 'text2fa.com';

/** Subject from env or default */
function getSubject(envKey, defaultSubject) {
  const fromEnv = process.env[envKey];
  return (fromEnv && String(fromEnv).trim()) ? String(fromEnv).trim() : defaultSubject;
}

async function sendVerificationEmail(to, name, token) {
  const url = `${getBaseUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const transporter = getTransporter();
  try {
    await transporter.sendMail({
      from: `"${getMailFromName()}" <${process.env.MAIL_FROM_ADDRESS || 'noreply@example.com'}>`,
      to,
      subject: getSubject('MAIL_SUBJECT_VERIFY_EMAIL', 'Verify your email — ' + siteName()),
      html: `
      <p>Hi ${name || 'there'},</p>
      <p>Thanks for signing up. Please verify your email by clicking the link below:</p>
      <p><a href="${url}" style="color:#22c55e;font-weight:600">Verify my email</a></p>
      <p>Or copy this link: ${url}</p>
      <p>This link expires in 24 hours.</p>
      <p>— ${process.env.WEBSITE_NAME || 'text2fa.com'}</p>
    `,
    });
    console.log('[MAIL] Verification email sent to', to);
  } catch (err) {
    logMailError('sendVerificationEmail', to, err);
    throw err;
  }
}

async function sendDepositSuccessEmail(to, name, amount) {
  const transporter = getTransporter();
  try {
    await transporter.sendMail({
      from: `"${getMailFromName()}" <${process.env.MAIL_FROM_ADDRESS || 'noreply@example.com'}>`,
      to,
      subject: getSubject('MAIL_SUBJECT_DEPOSIT_SUCCESS', 'Deposit successful — ' + siteName()),
      html: `
      <p>Hi ${name || 'there'},</p>
      <p>Your deposit of <strong>$${Number(amount).toFixed(2)}</strong> has been credited to your balance.</p>
      <p>You can now use your balance to purchase SMS activation numbers.</p>
      <p>— ${process.env.WEBSITE_NAME || 'text2fa.com'}</p>
    `,
    });
    console.log('[MAIL] Deposit success email sent to', to);
  } catch (err) {
    logMailError('sendDepositSuccessEmail', to, err);
    throw err;
  }
}

async function sendResetPasswordEmail(to, name, token) {
  const url = `${getBaseUrl()}/reset-password?token=${token}`;
  const transporter = getTransporter();
  try {
    await transporter.sendMail({
      from: `"${getMailFromName()}" <${process.env.MAIL_FROM_ADDRESS || 'noreply@example.com'}>`,
      to,
      subject: getSubject('MAIL_SUBJECT_RESET_PASSWORD', 'Reset your password — ' + siteName()),
      html: `
      <p>Hi ${name || 'there'},</p>
      <p>You requested a password reset. Click the link below to set a new password:</p>
      <p><a href="${url}" style="color:#22c55e;font-weight:600">Reset password</a></p>
      <p>Or copy this link: ${url}</p>
      <p>This link expires in 1 hour.</p>
      <p>If you didn't request this, ignore this email.</p>
      <p>— ${process.env.WEBSITE_NAME || 'text2fa.com'}</p>
    `,
    });
    console.log('[MAIL] Reset password email sent to', to);
  } catch (err) {
    logMailError('sendResetPasswordEmail', to, err);
    throw err;
  }
}

module.exports = { sendVerificationEmail, sendResetPasswordEmail, sendDepositSuccessEmail };
