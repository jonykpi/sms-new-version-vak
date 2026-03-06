/**
 * Shared auth & balance for text2fa.com
 */
const API = '/api';

async function getMe() {
  const r = await fetch(API + '/auth/me');
  if (!r.ok) return null;
  const d = await r.json();
  window.impersonating = !!d.impersonating;
  return d.user;
}

function renderHeader(user) {
  const guest = document.getElementById('headerGuest');
  const userEl = document.getElementById('headerUser');
  const navLinks = document.getElementById('headerNavLinks');
  const amountEl = document.getElementById('balanceAmount');
  const emailEl = document.getElementById('userEmail');
  if (user) {
    if (guest) guest.style.display = 'none';
    if (userEl) userEl.style.display = '';
    if (navLinks) navLinks.style.display = '';
    if (amountEl) amountEl.textContent = Number(user.balance).toFixed(2);
    if (emailEl) emailEl.textContent = user.email;
    renderVerifyBanner(user);
  } else {
    if (guest) guest.style.display = '';
    if (userEl) userEl.style.display = 'none';
    if (navLinks) navLinks.style.display = 'none';
    hideVerifyBanner();
  }
}

function hideVerifyBanner() {
  const b = document.getElementById('verifyBanner');
  if (b) b.remove();
}

function renderVerifyBanner(user) {
  if (user.emailVerified) { hideVerifyBanner(); return; }
  let b = document.getElementById('verifyBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'verifyBanner';
    b.className = 'verify-banner';
    const header = document.querySelector('.site-header');
    if (header && header.nextSibling) header.parentNode.insertBefore(b, header.nextSibling);
    else if (header) header.parentNode.appendChild(b);
  }
  b.innerHTML = '<span>Verify your email to access all features.</span> <button type="button" class="btn btn-get btn-sm" id="resendVerifyBtn">Resend verification link</button>';
  b.style.display = '';
  const btn = document.getElementById('resendVerifyBtn');
  if (btn) btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const r = await fetch(API + '/auth/resend-verification', { method: 'POST' });
      const d = await r.json();
      if (r.ok && window.toast) toast(d.message || 'Check your email.', 'success');
      else if (window.toast) toast(d.error || 'Failed', 'error');
    } finally { btn.disabled = false; }
  });
}

function renderImpersonateBanner(user) {
  let b = document.getElementById('impersonateBanner');
  if (!window.impersonating || !user) {
    if (b) b.remove();
    return;
  }
  if (!b) {
    b = document.createElement('div');
    b.id = 'impersonateBanner';
    b.className = 'impersonate-banner';
    const header = document.querySelector('.site-header');
    const wrap = header && header.closest('.site-header-wrap');
    if (wrap) wrap.insertBefore(b, wrap.firstChild);
    else if (header) header.parentNode.insertBefore(b, header);
  }
  b.innerHTML = '<span>Viewing as <strong>' + (user.email || 'user') + '</strong></span> <button type="button" class="btn btn-outline btn-sm" id="stopImpersonateBtn">Stop impersonating</button>';
  document.getElementById('stopImpersonateBtn')?.addEventListener('click', async () => {
    const r = await fetch(API + '/admin/stop-impersonate', { method: 'POST' });
    if (r.ok) window.location.href = '/admin';
  });
}

async function loadNotificationBanner() {
  const banner = document.getElementById('notification-banner');
  if (!banner) return;
  try {
    const r = await fetch(API + '/notification');
    const d = r.ok ? await r.json() : {};
    if (d.enabled && d.text) {
      banner.textContent = d.text;
      banner.style.display = 'block';
    }
  } catch (_) {}
}

async function initAuth() {
  if (window.initCrisp) window.initCrisp();
  loadNotificationBanner();
  window.currentUser = await getMe();
  renderHeader(window.currentUser);
  renderImpersonateBanner(window.currentUser);
  if (window.currentUser && window.setCrispUser) window.setCrispUser(window.currentUser);
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (window.resetCrispSession) window.resetCrispSession();
      await fetch(API + '/auth/logout', { method: 'POST' });
      window.currentUser = null;
      renderHeader(null);
      if (window.location.pathname === '/active' || window.location.pathname === '/admin') {
        window.location.href = '/';
      }
    });
  }
  window.updateBalance = async () => {
    const u = await getMe();
    if (u) { window.currentUser = u; renderHeader(u); renderImpersonateBanner(u); }
  };
  const params = new URLSearchParams(window.location.search);
  if (params.get('verified') === '1' && typeof toast === 'function') toast('Email verified successfully.', 'success');
  if (params.get('verify') === '1' && typeof toast === 'function') toast('Verify your email to deposit or place orders.', 'warning');
}

function runInit() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth);
  } else {
    initAuth();
  }
}
if (document.getElementById('header-placeholder')) {
  window.addEventListener('layoutReady', runInit, { once: true });
} else {
  runInit();
}
