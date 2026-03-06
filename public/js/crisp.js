/**
 * Crisp chat integration for text2fa.com
 * Web Chat SDK: https://docs.crisp.chat/guides/chatbox-sdks/web-sdk/
 * Uses $crisp global. User identification when logged in.
 */
(function() {
  async function initCrisp() {
    try {
      const r = await fetch('/api/config');
      const cfg = r.ok ? await r.json() : {};
      const websiteId = (cfg.crispWebsiteId || '').trim();
      if (!websiteId) return;

      window.$crisp = window.$crisp || [];
      window.CRISP_WEBSITE_ID = websiteId;
      const s = document.createElement('script');
      s.src = 'https://client.crisp.chat/l.js';
      s.async = 1;
      document.head.appendChild(s);
    } catch (_) {}
  }

  function setCrispUser(user) {
    if (!window.$crisp || !user) return;
    window.$crisp.push(['set', 'user:email', [user.email]]);
    if (user.name) window.$crisp.push(['set', 'user:nickname', [user.name]]);
    if (user.id) {
      window.CRISP_TOKEN_ID = 'u' + user.id;
      window.$crisp.push(['do', 'session:reset']);
    }
  }

  function resetCrispSession() {
    if (!window.$crisp) return;
    window.CRISP_TOKEN_ID = null;
    window.$crisp.push(['do', 'session:reset']);
  }

  window.initCrisp = initCrisp;
  window.setCrispUser = setCrispUser;
  window.resetCrispSession = resetCrispSession;
})();
