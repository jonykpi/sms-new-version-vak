/**
 * Shared layout: loads header and sidebar from partials and injects into placeholders.
 * Fires 'layoutReady' when done. Other scripts (app, sidebar) should wait for this.
 */
(function() {
  async function loadLayout() {
  const headerEl = document.getElementById('header-placeholder');
  const sidebarEl = document.getElementById('sidebar-placeholder');
  if (!headerEl && !sidebarEl) {
    setTimeout(function() { window.dispatchEvent(new Event('layoutReady')); }, 0);
    return;
  }
    try {
      const [headerRes, sidebarRes] = await Promise.all([
        fetch('/partials/header.html'),
        fetch('/partials/sidebar.html')
      ]);
      if (headerEl && headerRes.ok) {
        headerEl.outerHTML = await headerRes.text();
      }
      if (sidebarEl && sidebarRes.ok) {
        sidebarEl.outerHTML = await sidebarRes.text();
      }
      const activeNav = document.body.dataset.activeNav || '';
      document.querySelectorAll('[data-nav]').forEach(function(a) {
        if (a.dataset.nav === activeNav) a.classList.add('active');
      });
      const banner = document.getElementById('notification-banner');
      if (banner) {
        try {
          const r = await fetch('/api/notification');
          const d = r.ok ? await r.json() : {};
          if (d.enabled && d.text) {
            banner.textContent = d.text;
            banner.style.display = 'block';
          }
        } catch (_) {}
      }
    } catch (e) {
      console.error('Layout load failed:', e);
    }
    setTimeout(function() {
      window.dispatchEvent(new Event('layoutReady'));
    }, 0);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadLayout);
  } else {
    loadLayout();
  }
})();
