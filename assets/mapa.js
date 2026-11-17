/* Mapa punktów gry: ponumerowane pinezki, koła zaliczenia, „Sprawdź, gdzie jestem”,
   lista miejsc z odległością w linii prostej i przycisk „Potwierdź pobyt”.
   Używają jej: strona drużyny (index.html) i publiczna mapa (/mapa). */
(function () {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = { done: '#2f7a4a', here: '#2b6cb0', svc: '#1d2b45', self: '#b5652b' };

  function distance(a, b) {
    const R = 6371000, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(m) {
    if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + ' m';
    return (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',') + ' km';
  }
  // ta sama reguła co na serwerze: odległość minus dokładność odczytu (maks. 100 m) mieści się w kole
  const inRange = (p, me) => me && distance(me, p) - Math.min(me.acc || 0, 100) <= p.radius;
  const color = p => p.done ? COLORS.done : p.checkedIn ? COLORS.here : p.category === 'obslugiwany' ? COLORS.svc : COLORS.self;

  window.StaszicMap = function (opts) {
    opts = Object.assign({ withStatus: false, onOpen: null, onConfirm: null, canConfirm: () => false, onPos: null, summary: null }, opts);
    const root = document.createElement('div');
    root.className = 'smap';
    root.innerHTML = `
      <div class="smap-summary"></div>
      <div class="smap-tools">
        <button type="button" class="smap-loc">📍 Sprawdź, gdzie jestem</button>
        <div class="smap-filter" role="group" aria-label="Filtr miejsc">
          <button type="button" data-f="all" class="gs-on">Wszystkie</button>
          <button type="button" data-f="svc">Z animatorem</button>
          <button type="button" data-f="self">Samodzielne</button>
          ${opts.withStatus ? '<button type="button" data-f="todo">Do zaliczenia</button>' : ''}
        </div>
      </div>
      <div class="smap-locinfo"></div>
      <div class="smap-map" aria-label="Mapa punktów gry"></div>
      <div class="smap-legend">
        <span><i style="background:${COLORS.svc}"></i>z animatorem</span><span><i style="background:${COLORS.self}"></i>samodzielny</span>
        ${opts.withStatus ? `<span><i style="background:${COLORS.here}"></i>odwiedzony</span><span><i style="background:${COLORS.done}"></i>zaliczony</span>` : ''}
        <span><i class="gs-ring"></i>obszar zaliczenia</span>
      </div>
      <div class="smap-list"></div>
      <p class="smap-note">Odległości są mierzone w linii prostej, to nie jest trasa dojścia. Odczyt lokalizacji w telefonie bywa niedokładny. Koło wokół punktu pokazuje obszar, z którego można potwierdzić pobyt, a jego rozmiar jest ustalony osobno dla każdego punktu. Punkt zaliczajcie z bezpiecznego, ogólnodostępnego miejsca.</p>`;
    const mapEl = root.querySelector('.smap-map'), listEl = root.querySelector('.smap-list'), infoEl = root.querySelector('.smap-locinfo'), locBtn = root.querySelector('.smap-loc');
    let points = [], map = null, layers = [], meLayers = [], me = null, watchId = null, filter = 'all', firstFix = false, fitted = false;

    function ensureMap() {
      if (map) { map.invalidateSize(); return; }
      if (!window.L || !root.isConnected) { if (!window.L) mapEl.innerHTML = '<p class="smap-err">Nie udało się wczytać mapy. Lista miejsc poniżej działa normalnie.</p>'; return; }
      map = L.map(mapEl, { scrollWheelZoom: false, tap: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; autorzy <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      map.on('focus', () => map.scrollWheelZoom.enable());
      map.on('blur', () => map.scrollWheelZoom.disable());
      drawPoints(); drawMe();
    }
    function fitAll(extra) {
      if (!map || !points.length) return;
      const b = L.latLngBounds(points.map(p => [p.lat, p.lng]));
      if (extra) b.extend(extra);
      map.fitBounds(b, { padding: [28, 28], maxZoom: 16 });
    }
    function visible(p) {
      if (filter === 'svc') return p.category === 'obslugiwany';
      if (filter === 'self') return p.category !== 'obslugiwany';
      if (filter === 'todo') return !p.done;
      return true;
    }
    function pinIcon(p) {
      const label = p.done ? '✓' : p.no;
      return L.divIcon({ className: 'smap-pin', html: `<span style="--c:${color(p)}"><b>${label}</b></span>`, iconSize: [32, 40], iconAnchor: [16, 38], tooltipAnchor: [0, -34] });
    }
    function drawPoints() {
      if (!map) return;
      layers.forEach(l => map.removeLayer(l)); layers = [];
      points.filter(visible).forEach(p => {
        const c = color(p);
        layers.push(L.circle([p.lat, p.lng], { radius: p.radius, color: c, weight: 1.5, dashArray: '4 4', fillColor: c, fillOpacity: .10, interactive: false }).addTo(map));
        const tip = `<b>${p.no}. ${esc(p.name)}</b>${me ? '<br>' + fmtDist(distance(me, p)) + ' w linii prostej' : ''}`;
        layers.push(L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.name, keyboard: true }).addTo(map).bindTooltip(tip).on('click', () => open(p.id)));
      });
      if (!fitted && points.length) { fitAll(); fitted = true; }
    }
    function drawMe() {
      if (!map) return;
      meLayers.forEach(l => map.removeLayer(l)); meLayers = [];
      if (!me) return;
      meLayers.push(L.circle([me.lat, me.lng], { radius: Math.max(5, me.acc || 5), color: '#2b6cb0', weight: 1, fillColor: '#2b6cb0', fillOpacity: .12, interactive: false }).addTo(map));
      meLayers.push(L.circleMarker([me.lat, me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2b6cb0', fillOpacity: 1 }).addTo(map).bindTooltip('Tu jesteś'));
    }
    function open(id) {
      const p = points.find(x => x.id === id); if (!p) return;
      if (opts.onOpen) return opts.onOpen(id);
      if (map) map.flyTo([p.lat, p.lng], 17, { duration: .6 });
    }
    function renderList() {
      let list = points.filter(visible).map(p => ({ p, d: me ? distance(me, p) : null }));
      if (me) list.sort((a, b) => a.d - b.d);
      const done = points.filter(p => p.done).length;
      listEl.innerHTML = (list.map(({ p, d }) => {
        const near = inRange(p, me);
        const status = !opts.withStatus ? '' : p.done ? '<span class="gs-badge gs-done">zaliczony</span>' : p.checkedIn ? '<span class="gs-badge gs-here">odwiedzony</span>' : '';
        const confirm = opts.onConfirm && near && opts.canConfirm(p) ? `<button type="button" class="smap-confirm" data-confirm="${esc(p.id)}">Potwierdź pobyt</button>` : '';
        return `<div class="smap-item${near ? ' gs-near' : ''}${p.done ? ' gs-isdone' : ''}">
          <button type="button" class="smap-num" data-fly="${esc(p.id)}" style="--c:${color(p)}" aria-label="Pokaż na mapie: ${esc(p.name)}">${p.done ? '✓' : p.no}</button>
          <button type="button" class="smap-body" data-open="${esc(p.id)}">
            <b>${esc(p.name)}</b>
            <span class="smap-addr">${esc(p.address || '')}</span>
            <span>${p.category === 'obslugiwany' ? '<span class="gs-badge gs-svc">z animatorem</span>' : '<span class="gs-badge gs-self">samodzielny</span>'}${p.badge ? '<span class="gs-badge">Odznaka Staszicowska</span>' : ''}${status}</span>
          </button>
          <div class="smap-side">${d != null ? `<span class="smap-dist${near ? ' gs-ok' : ''}">${near ? 'Jesteś na miejscu' : fmtDist(d)}</span>` : ''}${confirm}</div>
        </div>`;
      }).join('')) || '<p class="smap-err">Brak miejsc w tym filtrze.</p>';
      root.querySelector('.smap-summary').innerHTML = opts.summary ? opts.summary(points, done) : '';
      listEl.querySelectorAll('[data-open]').forEach(b => b.onclick = () => open(b.dataset.open));
      listEl.querySelectorAll('[data-fly]').forEach(b => b.onclick = () => { const p = points.find(x => x.id === b.dataset.fly); if (map && p) { map.flyTo([p.lat, p.lng], 17, { duration: .6 }); mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
      listEl.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
        b.disabled = true; b.textContent = 'Sprawdzam…';
        try { await opts.onConfirm(b.dataset.confirm, me); } finally { if (b.isConnected) { b.disabled = false; b.textContent = 'Potwierdź pobyt'; } }
      });
    }
    function locInfo() {
      if (!me) { infoEl.innerHTML = ''; return; }
      const near = points.map(p => ({ p, d: distance(me, p) })).sort((a, b) => a.d - b.d)[0];
      const here = points.filter(p => inRange(p, me));
      infoEl.innerHTML = `<span class="dot-me"></span> Dokładność odczytu: ±${Math.round(me.acc || 0)} m. ` +
        (here.length ? `<b>Jesteś w obszarze: ${here.map(p => esc(p.name)).join(', ')}.</b>` : near ? `Najbliżej: <b>${esc(near.p.name)}</b>, ${fmtDist(near.d)} w linii prostej.` : '');
    }
    function setPos(pos) {
      me = pos; drawMe(); drawPoints(); renderList(); locInfo();
      if (opts.onPos) opts.onPos(me);
    }
    function startLoc() {
      if (!navigator.geolocation) { infoEl.innerHTML = '<span class="smap-err">Ta przeglądarka nie udostępnia lokalizacji.</span>'; return; }
      locBtn.textContent = 'Ustalam położenie…'; firstFix = true;
      watchId = navigator.geolocation.watchPosition(pos => {
        setPos({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
        locBtn.textContent = '⏹ Wyłącz lokalizację'; locBtn.classList.add('gs-on');
        if (firstFix && map) { firstFix = false; const n = points.slice().sort((a, b) => distance(me, a) - distance(me, b))[0]; const b = L.latLngBounds([[me.lat, me.lng]]); if (n) b.extend([n.lat, n.lng]); map.fitBounds(b, { padding: [40, 40], maxZoom: 17 }); }
      }, err => {
        stopLoc();
        infoEl.innerHTML = `<span class="smap-err">${err.code === 1 ? 'Brak zgody na lokalizację. Włącz ją w ustawieniach przeglądarki dla tej strony.' : 'Nie udało się ustalić położenia. Wyjdź na otwartą przestrzeń i spróbuj ponownie.'}</span>`;
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    }
    function stopLoc() {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null; locBtn.textContent = '📍 Sprawdź, gdzie jestem'; locBtn.classList.remove('gs-on');
    }
    locBtn.onclick = () => watchId != null ? (stopLoc(), setPos(null)) : startLoc();
    root.querySelectorAll('.smap-filter button').forEach(b => b.onclick = () => {
      filter = b.dataset.f; root.querySelectorAll('.smap-filter button').forEach(x => x.classList.toggle('gs-on', x === b));
      drawPoints(); renderList();
    });

    return {
      el: root,
      attach(container) { container.appendChild(root); ensureMap(); },
      update(pts) { points = pts.map((p, i) => Object.assign({}, p, { no: i + 1 })); drawPoints(); renderList(); locInfo(); },
      setPos(pos) { if (watchId == null) setPos(pos); },
      get pos() { return me; },
      focus(id) { const p = points.find(x => x.id === id); if (map && p) map.setView([p.lat, p.lng], 17); },
    };
  };
  window.StaszicMap.distance = distance;
})();
