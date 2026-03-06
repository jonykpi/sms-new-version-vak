/**
 * Toaster notifications for text2fa.com
 * Usage: toast('Message', 'success'|'error'|'warning'|'info')
 */
(function () {
  let container = null;

  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function toast(message, type = 'info', duration = 4500) {
    const c = getContainer();
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.innerHTML = typeof message === 'string' ? message : String(message);
    c.appendChild(el);

    requestAnimationFrame(() => el.classList.add('toast-visible'));

    const t = setTimeout(() => {
      el.classList.remove('toast-visible');
      setTimeout(() => el.remove(), 300);
    }, duration);

    el.addEventListener('click', () => {
      clearTimeout(t);
      el.classList.remove('toast-visible');
      setTimeout(() => el.remove(), 300);
    });
  }

  window.toast = toast;
})();
