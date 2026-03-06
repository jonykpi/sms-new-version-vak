const nodemailer = require('nodemailer');

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'sandbox.smtp.mailtrap.io',
    port: parseInt(process.env.MAIL_PORT || '2525', 10),
    secure: false,
    auth: process.env.MAIL_USERNAME ? {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
    } : undefined,
  });
}

function getBaseUrl() {
  return process.env.APP_URL || 'http://localhost:3000';
}

async function sendVerificationEmail(to, name, token) {
  const url = `${getBaseUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME || process.env.WEBSITE_NAME || 'text2fa.com'}" <${process.env.MAIL_FROM_ADDRESS || 'noreply@example.com'}>`,
    to,
    subject: 'Verify your email — ' + (process.env.WEBSITE_NAME || 'text2fa.com'),
    html: `
      <p>Hi ${name || 'there'},</p>
      <p>Thanks for signing up. Please verify your email by clicking the link below:</p>
      <p><a href="${url}" style="color:#22c55e;font-weight:600">Verify my email</a></p>
      <p>Or copy this link: ${url}</p>
      <p>This link expires in 24 hours.</p>
      <p>— ${process.env.WEBSITE_NAME || 'text2fa.com'}</p>
    `,
  });
}

async function sendDepositSuccessEmail(to, name, amount) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME || process.env.WEBSITE_NAME || 'text2fa.com'}" <${process.env.MAIL_FROM_ADDRESS || 'noreply@example.com'}>`,
    to,
    subject: 'Deposit successful — ' + (process.env.WEBSITE_NAME || 'text2fa.com'),
    html: `
      <p>Hi ${name || 'there'},</p>
      <p>Your deposit of <strong>$${Number(amount).toFixed(2)}</strong> has been credited to your balance.</p>
      <p>You can now use your balance to purchase SMS activation numbers.</p>
      <p>— ${process.env.WEBSITE_NAME || 'text2fa.com'}</p>
    `,
  });
}

async function sendResetPasswordEmail(to, name, token) {
  const url = `${getBaseUrl()}/reset-password?token=${token}`;
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME || process.env.WEBSITE_NAME || 'text2fa.com'}" <${process.env.MAIL_FROM_ADDRESS || 'noreply@example.com'}>`,
    to,
    subject: 'Reset your password — ' + (process.env.WEBSITE_NAME || 'text2fa.com'),
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
}

module.exports = { sendVerificationEmail, sendResetPasswordEmail, sendDepositSuccessEmail };
