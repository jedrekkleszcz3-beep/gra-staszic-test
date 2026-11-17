(function () {

'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CFG = window.GS_CFG || {}; const API = CFG.api || '/wp-json/gra-staszic/v1'; const PAGES = CFG.pages || {};
let PUB = null, SMAP = null;
function openPoint(id) {
  const p = PUB.points.find(x => x.id === id); if (!p) return;
  const d = SMAP.pos ? StaszicMap.distance(SMAP.pos, p) : null;
  $('#gs-sheet').innerHTML = `<div class="gs-sheet-head"><h2>${esc(p.name)}</h2><button class="gs-secondary" id="mClose" aria-label="Zamknij">✕</button></div>
    <p class="gs-muted">${esc(p.address)}${d != null ? ' · ' + (d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1).replace('.', ',') + ' km') + ' w linii prostej' : ''}</p>
    <p>${p.category === 'obslugiwany' ? '<span class="gs-badge gs-svc">z animatorem</span>' : '<span class="gs-badge gs-self">samodzielny</span>'}${p.badge ? '<span class="gs-badge">Odznaka Staszicowska</span>' : ''}</p>
    <div class="gs-story">${esc(p.story)}</div>
    <p class="gs-muted">Obszar zaliczenia: koło o promieniu ${p.radius} m.</p>
    <div class="gs-row"><a class="gs-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking">Nawiguj</a>
    <button class="gs-secondary" id="mShow">Pokaż na mapie</button></div>`;
  $('#gs-modal').classList.remove('gs-hidden');
  $('#mClose').onclick = close;
  $('#mShow').onclick = () => { close(); SMAP.focus(id); document.querySelector('.gs-app .smap-map').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
}
function close() { $('#gs-modal').classList.add('gs-hidden'); }
$('#gs-modal').addEventListener('click', e => { if (e.target.id === 'gs-modal') close(); });
(async () => {
  try {
    PUB = await (await fetch(API + '/public', { credentials: 'omit', cache: 'no-store' })).json();
    const s = PUB.settings, self = PUB.points.filter(p => p.category !== 'obslugiwany').length, svc = PUB.points.length - self;
    SMAP = StaszicMap({
      onOpen: openPoint,
      summary: pts => `<div class="gs-progress">
        <div class="gs-box"><b>Miejsc na mapie</b><div>${pts.length}</div></div>
        <div class="gs-box"><b>Do ukończenia gry</b><div>${s.mode === 'solo' ? '' : svc + ' z animatorem + '}${s.requiredSelfPoints} z ${self} samodzielnych</div></div></div>`,
    });
    $('#gs-map-root').innerHTML = `<div class="gs-card"><h2>Mapa miejsc</h2><p>Wszystkie punkty gry w jednym miejscu. Włącz lokalizację, aby zobaczyć, jak daleko masz do każdego z nich. Pobyt w punkcie potwierdza drużyna po zalogowaniu w grze${PAGES.gra ? ` (<a href="${esc(PAGES.gra)}">przejdź do gry</a>)` : ''}.</p>${s.startsLabel && Date.parse(s.gameStartsAt) > Date.now() ? `<p><b>Gra rusza ${esc(s.startsLabel)}.</b></p>` : ''}</div>`;
    SMAP.attach($('#gs-map-root'));
    SMAP.update(PUB.points);
  } catch (e) { $('#gs-map-root').innerHTML = '<div class="gs-msg gs-err">Nie można wczytać mapy. Spróbuj odświeżyć stronę.</div>'; }
})();

})();
