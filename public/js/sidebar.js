/**
 * Purchase panel sidebar - shared by index, active, topup pages
 */
(function() {
  function init() {
    const serviceList = document.getElementById('serviceList');
    if (!serviceList) return;

  const countryInput = document.getElementById('country');
  const operatorInput = document.getElementById('operator');
  const countryDisplay = document.getElementById('countryDisplay');
  const STORAGE_KEY_COUNTRY = 'sidebar_country';
  const STORAGE_KEY_OPERATOR = 'sidebar_operator';
  try {
    const savedCountry = localStorage.getItem(STORAGE_KEY_COUNTRY);
    const savedOperator = localStorage.getItem(STORAGE_KEY_OPERATOR);
    if (savedCountry) countryInput.value = savedCountry;
    else { countryInput.value = 'usv'; if (countryText) countryText.textContent = 'United States virtual'; updateFlagDisplay(countryFlagEl, 'usv'); }
    if (savedOperator !== null && savedOperator !== undefined) {
      operatorInput.value = savedOperator;
      if (document.getElementById('operatorText')) document.getElementById('operatorText').textContent = savedOperator || 'Any operator';
    }
  } catch (_) {}
  const countryDropdown = document.getElementById('countryDropdown');
  const operatorDropdown = document.getElementById('operatorDropdown');
  const countryText = document.getElementById('countryText');
  const countryFlagEl = document.getElementById('countryFlag');
  const operatorDisplay = document.getElementById('operatorDisplay');
  const operatorText = document.getElementById('operatorText');
  const countryGrid = document.getElementById('countryGrid');
  const operatorGrid = document.getElementById('operatorGrid');
  const twoService1 = document.getElementById('twoService1');
  const twoService2 = document.getElementById('twoService2');
  if (!countryInput || !countryGrid || !operatorGrid) return;

  let servicesData = [];
  let countriesData = [];

  const OPERATORS_BY_COUNTRY = {
    ru: 'beeline gazprom lycamobile megafon mts mtt patriot rostelecom sbermobile tele2 tinkoff vector vtbmobile win mobile yota',
    ua: 'kyivstar lifecell lycamobile vodafone', bg: 'a1 bulsatcom max telecom telenor vivacom', bul: 'a1 bulsatcom max telecom telenor vivacom',
    kz: 'activ altel beeline forte mobile tele2', ph: 'globe telecom smart sun cellular',
    id: 'axis indosat smartfren telkomsel three', my: 'celcom digi electcoms indosat maxis telekom tune talk u mobile xox yes',
    ke: 'airtel econet orange safaricom telkom', tz: 'vodacom', vn: 'vietnamobile viettel vinaphone',
    kg: 'beeline megacom nurtel o!', usv: 'textnow', il: '018 xphone azi cellcom golan telecom hot mobile pali partner pelephone rami levy',
    hk: 'china mobile csl pccw smartone three', pl: 'aero2 lycamobile nju orange play plus tmobile',
    gb: 'ee giffgaff lycamobile o2 orange three tmobile vodafone', eg: 'etisalat orange vodafone we',
    ee: 'elisa tele2 telia', ca: 'bell mobility freedom mobile globalstar ice wireless mts rogers wireless sasktel tbay mobility telus mobility videotron',
    ma: 'inwi maroc telecom orange', uz: 'beeline perfectum ucell ums uzmobile', cm: 'mtn nexttel orange',
    de: 'lebara lycamobile tmobile vodafone', lt: 'labas pylduk tele2', hr: 'a1 bonbon hrvatski telekom telemach',
    se: 'comviq lycamobile telenor', nl: 'kpn lebara lmobiel lycamobile vodafone', lv: 'lmt pylduk tele2 zelta zivtina',
    th: 'ais dtac truemove', mx: 'movistar telcel', es: 'lycamobile movistar orange vodafone yoigo',
    pt: 'lycamobile vodafone', fi: 'dna elisa', bd: 'airtel banglalink banglalion grameenphone ollo robi teletalk',
    cz: 'nordic telecom o2 szdc tmobile vodafone', lk: 'airtel dialog etisalat hutch lanka bell mobitel slt',
    pe: 'bitel claro entel movistar', pk: 'charji jazz sco mobile telenor ufone zong', pa: 'digicel movistar claro',
    ng: 'mtn airtel glo etisalat', ni: 'movistar claro', ne: 'ntc ncell', np: 'ntc ncell',
    nz: 'vodafone 2degrees spark', no: 'telenor telia ice', ae: 'etisalat du', bo: 'entel tigo movistar',
    br: 'claro vivo tim oi', by: 'mts velcom life', cy: 'cablenet epic lemontel primetel vodafon',
    fr: 'bouygues lebara lycamobile orange sfr symamobile', ch: 'sunrise swisscom salt',
    cl: 'entel movistar claro', co: 'movistar claro tigo', cr: 'kolbi claro movistar',
    be: 'base lycamobile mobile vikings orange proximus telenet', mk: 'telekom a1 vip',
    md: 'moldcell orange', it: 'fastweb iliad three tim vodafone wind tre', hn: 'claro digicel hondutel tigo',
    gt: 'claro movistar tigo', tl: 'telemor telkomcel timor telecom', om: 'omantel ooredoo',
    sl: 'africell orange sierratel', lr: 'lonestar cellcom', bi: 'econet lumitel onatel smart',
    sk: '4ka o2 orange telekom', tj: 'babilon mobile beeline megafon tcell', cd: 'africell airtel orange vodacom',
    bf: 'onatel orange telecel', mw: 'access airtel tnm', cav: 'textnow', us: 'att tmobile tracfone',
    ps: 'jawwal wataniya', za: 'cell c mtn neotel telkom vodacom', zw: 'econet netone telecel',
    ao: 'movicel', ar: 'claro movistar nextel personal', au: 'telstra vodafone', at: 'a1 lycamobile orange telering yesss',
    az: 'azercell azerfon bakcell humans nar mobile naxtel', dk: 'lycamobile tdc telenor telia three',
    ge: 'beeline geocell magticom silknet', gr: 'cosmote cyta vodafone wind', la: 'beeline etl laotel unitel',
    mm: 'mpt mytel ooredoo telenor', mn: 'gmobile mobicom skytel unitel', mz: 'mcell movitel vodacom',
    si: 'a1 t-2 telekom telemach', xk: 'ipko mtc vala', km: 'telecom telma', nu: 'telecom'
  };

  function countryFlag(code) {
    const c = (code || 'xx').toUpperCase();
    if (c.length !== 2) return '';
    return String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65, 0x1F1E6 + c.charCodeAt(1) - 65);
  }
  function flagUrl(code) {
    const c = (code || '').toLowerCase();
    if (c.length === 2) return 'https://flagcdn.com/w64/' + c + '.png';
    if (c === 'usv') return 'https://flagcdn.com/w64/us.png';
    if (c === 'cav') return 'https://flagcdn.com/w64/ca.png';
    return '';
  }
  function normalizeCountries(list) {
    if (Array.isArray(list)) return list.filter(c => c && (c.countryCode || c.country));
    const obj = list || {};
    return Object.entries(obj).map(([k, v]) => {
      if (!v || typeof v !== 'object') return null;
      const code = v.countryCode || v.country || (k.length === 2 ? k : null);
      if (!code) return null;
      return { countryCode: code, countryName: v.countryName || v.country || code, operatorList: Array.isArray(v.operatorList) ? v.operatorList : (Array.isArray(v.operators) ? v.operators : (v.operators ? Object.keys(v.operators) : ['any'])) };
    }).filter(Boolean);
  }
  function updateFlagDisplay(el, code) {
    if (!el) return;
    const c = countriesData.find(x => ((x.countryCode || x.country) || '').toLowerCase() === (code || '').toLowerCase());
    const localIcon = (c && c.icon) ? c.icon : null;
    const fu = localIcon || flagUrl(code);
    const emoji = countryFlag(code);
    if (fu) el.innerHTML = '<img src="' + fu + '" alt="" class="filter-display-flag" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'"><span style="display:none">' + emoji + '</span>';
    else el.textContent = emoji;
  }
  function loadOperators(country) {
    const cc = (country || '').toLowerCase();
    const c = countriesData.find(x => ((x.countryCode || x.country) || '').toLowerCase() === cc);
    let apiOps = (c && (c.operatorList || c.operators));
    let ops;
    if (typeof apiOps === 'string' && apiOps.trim()) {
      ops = ['any', ...apiOps.trim().split(/\s+/).filter(Boolean)];
    } else if (Array.isArray(apiOps) && apiOps.length > 0) {
      const first = apiOps[0];
      if (first && typeof first === 'object' && 'id' in first) {
        ops = apiOps;
      } else {
        ops = apiOps.filter(o => o && o !== 'any').length > 0 ? apiOps : (OPERATORS_BY_COUNTRY[cc] ? ['any', ...OPERATORS_BY_COUNTRY[cc].trim().split(/\s+/).filter(Boolean)] : ['any']);
      }
    } else {
      const fallback = OPERATORS_BY_COUNTRY[cc];
      ops = fallback ? ['any', ...fallback.trim().split(/\s+/).filter(Boolean)] : ['any'];
    }
    const isNewFormat = Array.isArray(ops) && ops[0] && typeof ops[0] === 'object' && 'id' in ops[0];
    const opList = isNewFormat ? ops : ops.filter(o => o && o !== 'any');

    if (isNewFormat) {
      operatorGrid.innerHTML = opList.map(op => {
        const isAny = op.id === 'any' || !op.id;
        const sel = (operatorInput.value === (isAny ? '' : op.id)) ? ' selected' : '';
        const name = isAny ? 'Any operator' : (op.name || op.id);
        let logoContent = '—';
        if (!isAny) {
          if (op.icon) logoContent = '<img src="' + (op.icon || '').replace(/"/g, '&quot;') + '" alt="" class="filter-card-logo-img" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span class="filter-card-logo-fallback" style="display:none">' + (op.id.slice(0,2) || '—').toUpperCase() + '</span>';
          else logoContent = (op.id.slice(0,2) || '—').toUpperCase();
        }
        return '<div class="filter-card filter-card-operator' + sel + '" data-operator="' + (isAny ? '' : op.id).replace(/"/g, '&quot;') + '"><div class="filter-card-logo">' + logoContent + '</div><span class="filter-card-name">' + (name || '—').replace(/"/g, '&quot;') + '</span></div>';
      }).join('');
    } else {
      operatorGrid.innerHTML = '<div class="filter-card filter-card-operator' + (!operatorInput.value ? ' selected' : '') + '" data-operator=""><div class="filter-card-logo">—</div><span class="filter-card-name">Any operator</span></div>' + opList.map(o => {
        const sel = (operatorInput.value === o) ? ' selected' : '';
        return '<div class="filter-card filter-card-operator' + sel + '" data-operator="' + (o || '').replace(/"/g, '&quot;') + '"><div class="filter-card-logo">' + (o.slice(0,2) || '—').toUpperCase() + '</div><span class="filter-card-name">' + (o || '—') + '</span></div>';
      }).join('');
    }
    operatorGrid.querySelectorAll('.filter-card-operator').forEach(card => {
      card.addEventListener('click', () => selectOperator(card.dataset.operator));
    });
    refreshPrices();
  }
  function selectCountry(code, name) {
    countryInput.value = code || 'usv';
    if (countryText) countryText.textContent = name || code;
    updateFlagDisplay(countryFlagEl, code);
    countryGrid.querySelectorAll('.filter-card-country').forEach(c => c.classList.toggle('selected', c.dataset.country === code));
    countryDropdown.classList.remove('open');
    operatorInput.value = '';
    if (operatorText) operatorText.textContent = 'Any operator';
    try { localStorage.setItem(STORAGE_KEY_COUNTRY, countryInput.value); localStorage.setItem(STORAGE_KEY_OPERATOR, ''); } catch (_) {}
    loadOperators(code);
    refreshPrices();
  }
  function selectOperator(code) {
    operatorInput.value = code || '';
    if (operatorText) operatorText.textContent = code || 'Any operator';
    operatorGrid.querySelectorAll('.filter-card-operator').forEach(c => c.classList.toggle('selected', (c.dataset.operator || '') === (code || '')));
    operatorDropdown.classList.remove('open');
    try { localStorage.setItem(STORAGE_KEY_OPERATOR, operatorInput.value); } catch (_) {}
    refreshPrices();
  }
  function renderCountryGrid() {
    if (!countriesData.length) return;
    const sorted = [...countriesData].sort((a, b) => {
      const nameA = (a.countryName || a.countryCode || a.country || '').toLowerCase();
      const nameB = (b.countryName || b.countryCode || b.country || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
    countryGrid.innerHTML = sorted.map(c => {
      const code = c.countryCode || c.country || '';
      const name = c.countryName || c.country || code;
      const imgSrc = c.icon || flagUrl(code);
      const sel = (countryInput.value === code) ? ' selected' : '';
      const flagHtml = imgSrc ? '<img src="' + imgSrc + '" alt="" class="filter-card-flag-img" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span class="filter-card-flag-emoji" style="display:none">' + countryFlag(code) + '</span>' : '<span class="filter-card-flag-emoji">' + countryFlag(code) + '</span>';
      return '<div class="filter-card filter-card-country' + sel + '" data-country="' + code + '" data-name="' + (name || '').replace(/"/g, '&quot;') + '"><div class="filter-card-flag">' + flagHtml + '</div><span class="filter-card-name">' + (name || code) + '</span><span class="filter-card-pcs" data-country="' + code + '">' + ((c.count != null && c.count >= 0) ? (c.count >= 1000 ? (c.count/1000).toFixed(1) + 'k' : c.count) + ' pcs' : '— pcs') + '</span></div>';
    }).join('');
    countryGrid.querySelectorAll('.filter-card-country').forEach(card => {
      card.addEventListener('click', () => selectCountry(card.dataset.country, card.dataset.name));
    });
  }
  async function loadCountries() {
    try {
      const r = await fetch('/api/countries');
      if (!r.ok) return;
      const raw = await r.json();
      countriesData = normalizeCountries(raw);
      /* Count comes from getCountryOperatorList (total available numbers per country) - no per-service fetch */
      const cur = countryInput.value;
      const match = countriesData.find(x => (x.countryCode || x.country) === cur);
      const withStock = countriesData.filter(x => (x.count || 0) > 0);
      const sel = match || withStock[0] || countriesData[0];
      if (sel) {
        countryInput.value = sel.countryCode || sel.country;
        if (countryText) countryText.textContent = sel.countryName || sel.country || sel.countryCode;
        updateFlagDisplay(countryFlagEl, sel.countryCode || sel.country);
        if (!match) {
          operatorInput.value = '';
          if (operatorText) operatorText.textContent = 'Any operator';
          try { localStorage.setItem(STORAGE_KEY_OPERATOR, ''); } catch (_) {}
        }
        try { localStorage.setItem(STORAGE_KEY_COUNTRY, countryInput.value); } catch (_) {}
      }
      renderCountryGrid();
      loadOperators(countryInput.value);
    } catch (_) { countryGrid.innerHTML = '<div class="filter-grid-loading">Failed to load</div>'; }
  }
  function refreshPrices() {
    const country = countryInput.value || 'usv';
    const operator = operatorInput.value || '';
    (servicesData || []).forEach(s => loadPrice(s.code, country, operator));
  }
  async function loadPrice(service, country, operator) {
    try {
      const r = await fetch('/api/price/' + service + '?country=' + (country || 'usv') + (operator ? '&operator=' + encodeURIComponent(operator) : ''));
      if (!r.ok) return;
      const d = await r.json();
      const priceEl = document.querySelector('.service-price[data-service="' + service + '"]');
      const countEl = document.querySelector('.service-pcs[data-service="' + service + '"]');
      if (priceEl) priceEl.textContent = d.priceUsd != null ? '$' + d.priceUsd : '—';
      if (countEl) countEl.textContent = (d.count != null ? d.count : '—') + ' pcs';
    } catch (_) {}
  }
  async function getNumber(service, name, rent) {
    if (!window.currentUser) { if (window.toast) toast('Please log in to get a number.', 'warning'); return; }
    if (!window.currentUser.emailVerified) { if (window.toast) toast('Verify your email to place orders.', 'warning'); return; }
    const country = countryInput.value || 'usv';
    const operator = operatorInput.value || '';
    const btn = document.querySelector('.btn-get[data-service="' + service + '"]');
    if (btn) btn.disabled = true;
    try {
      const r = await fetch('/api/get-number', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service, country, operator, rent: !!rent }) });
      const data = await r.json();
      if (!r.ok) { if (window.toast) toast(data.error || 'Error', 'error'); return; }
      if (window.toast) toast('Number <strong>' + data.activation.phone + '</strong> for ' + name + '. Redirecting to Active numbers…', 'success');
      if (window.updateBalance) window.updateBalance();
      refreshPrices();
      window.location.href = '/active';
    } catch (e) { if (window.toast) toast('Request failed.', 'error'); }
    finally { if (btn) btn.disabled = false; }
  }
  function filterServices() {
    const q = (document.getElementById('serviceSearch')?.value || '').toLowerCase().trim();
    document.querySelectorAll('.service-item[data-name]').forEach(el => {
      const name = (el.dataset.name || '').toLowerCase();
      const code = (el.dataset.code || '').toLowerCase();
      el.style.display = !q || name.includes(q) || code.includes(q) ? '' : 'none';
    });
  }
  async function loadServices() {
    try {
      const r = await fetch('/api/services');
      servicesData = r.ok ? await r.json() : [];
      const country = countryInput.value || 'usv';
      const op = operatorInput.value || '';
      const opts = servicesData.map(s => '<option value="' + s.code + '">' + (s.name || s.code) + '</option>').join('');
      if (twoService1) twoService1.innerHTML = '<option value="">Service 1</option>' + opts;
      if (twoService2) twoService2.innerHTML = '<option value="">Service 2</option>' + opts;
      serviceList.innerHTML = servicesData.map(s => {
        const name = (s.name || s.code || '').replace(/"/g, '&quot;');
        const code = (s.code || '').replace(/"/g, '&quot;');
        const iconUrl = '/assets/service/' + (s.code || '') + '.png';
        const iconHtml = '<img src="' + iconUrl + '" alt="" class="service-icon-img" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span class="service-icon-fallback" style="display:none">' + (s.name || s.code).slice(0, 2).toUpperCase() + '</span>';
        return '<li class="service-item" data-name="' + name + '" data-code="' + code + '"><span class="service-icon" title="' + (s.name || s.code) + '">' + iconHtml + '</span><span class="service-name">' + (s.name || s.code) + '</span><span class="service-pcs" data-service="' + s.code + '">— pcs</span><span class="service-price" data-service="' + s.code + '">—</span><button type="button" class="btn btn-get" data-service="' + s.code + '" data-name="' + (s.name || s.code) + '">GET</button></li>';
      }).join('') || '<li class="service-item">No services</li>';
      refreshPrices();
      serviceList.querySelectorAll('.btn-get').forEach(btn => { btn.addEventListener('click', () => getNumber(btn.dataset.service, btn.dataset.name, false)); });
      filterServices();
    } catch (_) { serviceList.innerHTML = '<li class="service-item">Failed to load services</li>'; }
  }

  if (countryDisplay) countryDisplay.addEventListener('click', (e) => { e.stopPropagation(); if (operatorDropdown) operatorDropdown.classList.remove('open'); countryDropdown.classList.toggle('open'); });
  if (operatorDisplay) operatorDisplay.addEventListener('click', (e) => { e.stopPropagation(); if (countryDropdown) countryDropdown.classList.remove('open'); operatorDropdown.classList.toggle('open'); });
  const cp = document.getElementById('countryDropdownPanel');
  const op = document.getElementById('operatorDropdownPanel');
  if (cp) cp.addEventListener('click', e => e.stopPropagation());
  if (op) op.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => { if (countryDropdown) countryDropdown.classList.remove('open'); if (operatorDropdown) operatorDropdown.classList.remove('open'); });

  const getRentBtn = document.getElementById('getRentBtn');
  if (getRentBtn) getRentBtn.addEventListener('click', () => { const s = (document.getElementById('rentService')?.value || '').trim(); if (!s) { if (window.toast) toast('Enter a service code (e.g. wa, tg).', 'warning'); return; } getNumber(s, s, true); });
  if (twoService1 && twoService2) {
    const getTwoBtn = document.getElementById('getTwoBtn');
    if (getTwoBtn) getTwoBtn.addEventListener('click', () => { const s1 = twoService1.value, s2 = twoService2.value; if (!s1 || !s2) { if (window.toast) toast('Select both services.', 'warning'); return; } if (s1 === s2) { if (window.toast) toast('Choose two different services.', 'warning'); return; } getNumber(s1 + ',' + s2, s1 + ' + ' + s2, false); });
  }
  const searchEl = document.getElementById('serviceSearch');
  if (searchEl) searchEl.addEventListener('input', filterServices);

  loadCountries().then(loadServices);
  }
  if (document.getElementById('sidebar-placeholder')) {
    window.addEventListener('layoutReady', init, { once: true });
  } else {
    init();
  }
})();
