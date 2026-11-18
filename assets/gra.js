(function () {

'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CFG = window.GS_CFG || {}; const API = CFG.api || '/wp-json/gra-staszic/v1'; const PAGES = CFG.pages || {};
let TOKEN = null; try { TOKEN = localStorage.getItem('staszic_token'); } catch {}
let PUB = null, ME = null, TAB = 'mapa', SMAP = null, OPEN_POINT = null, MY_POS = null, flash = null;

async function api(path, body) {
  const opt = { headers: { 'Content-Type': 'application/json' }, credentials: 'omit', cache: 'no-store' };
  if (TOKEN) opt.headers['X-GS-Token'] = TOKEN;
  if (body !== undefined) { opt.method = 'POST'; opt.body = JSON.stringify(body); }
  const r = await fetch(API + path.replace(/^\/api/, ''), opt);
  const j = await r.json().catch(() => ({ error: 'Błąd połączenia' }));
  if (r.status === 401 && path.startsWith('/api/team')) { logout(); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Błąd'), { data: j });
  return j;
}
function setToken(t) { TOKEN = t; try { t ? localStorage.setItem('staszic_token', t) : localStorage.removeItem('staszic_token'); } catch {} }
function logout() { setToken(null); ME = null; SMAP = null; closeModal(); render(); }
function msg(type, text) { return text ? `<div class="gs-msg gs-${type}">${esc(text)}</div>` : ''; }
let SKEW = 0, CD_TIMER = null;
function beforeStart() { const st = PUB && PUB.settings.gameStartsAt ? Date.parse(PUB.settings.gameStartsAt) : 0; const left = st - (Date.now() + SKEW); return left > 0 ? left : 0; }
function fmtLeft(ms) { const s = Math.ceil(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60; const p = n => String(n).padStart(2, '0'); return (d ? d + ' d ' : '') + p(h) + ':' + p(m) + ':' + p(sec); }
const COLORS = { done: '#2f7a4a', here: '#2b6cb0', svc: '#1d2b45', self: '#b5652b' };
function pColor(p) { return p.done ? COLORS.done : p.checkedIn ? COLORS.here : p.category === 'obslugiwany' ? COLORS.svc : COLORS.self; }
function catBadge(p) {
  return (p.category === 'obslugiwany' ? '<span class="gs-badge gs-svc">z animatorem</span>' : '<span class="gs-badge gs-self">samodzielny</span>')
    + (p.badge ? '<span class="gs-badge">Odznaka Staszicowska</span>' : '')
    + (p.done ? '<span class="gs-badge gs-done">zaliczony</span>' : p.checkedIn ? '<span class="gs-badge gs-here">odwiedzony</span>' : '');
}

// ---------- ekran startowy ----------
function renderWelcome(view = 'reg', note = '') {
  const s = PUB.settings;
  $('#gs-root').innerHTML = `
  <div class="gs-card"><h1>${esc(s.title)}</h1><p class="gs-muted">${esc(s.subtitle || '')}</p><div class="gs-story">${esc(PUB.intro)}</div></div>
  <div class="gs-card">
    <h2>Zasady w skrócie</h2>
    <ul>
      ${beforeStart() ? `<li><b>Gra rusza ${esc(s.startsLabel)}.</b> Drużynę możecie zarejestrować już teraz.</li>` : ''}
      <li>Drużyny od ${s.minTeamSize} do ${s.maxTeamSize} osób. Startujecie, kiedy chcecie${s.mode === 'event' ? ', a na przejście trasy macie ' + s.teamTimeLimitMin + ' min' : ''}.</li>
      <li>Do ukończenia gry potrzeba: <b>wszystkich punktów z animatorem</b> oraz <b>${s.requiredSelfPoints} z ${PUB.points.filter(p => p.category !== 'obslugiwany').length} punktów samodzielnych</b>. Kolejne punkty to dodatkowe punkty do rankingu.</li>
      <li>Obecność w miejscu potwierdzacie GPS-em telefonu (+${s.checkinPoints} pkt). Potem pokażą się zadania.</li>
      <li><b>Rozstrzygnięcie gry: o 16:30 w PTTK / Informacji Turystycznej, plac Artystów.</b> Zapraszamy wszystkie drużyny!</li>
      <li>Podpowiedź kosztuje punkty. Za ukończenie gry: +${s.finishBonus} pkt. Przy remisie wygrywa krótszy czas.</li>
    </ul>
    ${PAGES.mapa || PAGES.ranking ? `<p>${PAGES.mapa ? `<a href="${esc(PAGES.mapa)}">Zobacz mapę miejsc →</a>` : ''}${PAGES.mapa && PAGES.ranking ? ' · ' : ''}${PAGES.ranking ? `<a href="${esc(PAGES.ranking)}">Ranking na żywo →</a>` : ''}</p>` : ''}
  </div>
  <div class="gs-card">
    <div class="gs-tabs"><button id="tReg" class="${view === 'reg' ? 'gs-active' : ''}">Rejestracja drużyny</button><button id="tLog" class="${view === 'log' ? 'gs-active' : ''}">Logowanie</button></div>
    ${note}
    ${view === 'reg' ? (s.registrationOpen ? `
    <form id="fReg">
      ${s.needsRegCode ? '<label>Kod rejestracji (od organizatora)</label><input name="regCode" required maxlength="60" autocomplete="off">' : ''}
      <label>Nazwa drużyny</label><input name="name" required maxlength="40" autocomplete="off">
      <div class="gs-row"><div><label>Kapitan (imię i nazwisko)</label><input name="captain" required maxlength="60"></div>
      <div><label>Telefon lub e-mail kapitana</label><input name="contact" required maxlength="100"></div></div>
      <label>Pozostali członkowie (każdy w nowej linii)</label><textarea name="members" placeholder="Anna Kowalska&#10;Jan Nowak"></textarea>
      <label>Szkoła / klasa (opcjonalnie)</label><input name="school" maxlength="80">
      <label>Hasło drużyny (do logowania na innych telefonach)</label><input name="password" type="password" required minlength="4" autocomplete="new-password">
      <label class="gs-check"><input type="checkbox" name="consent" required> Akceptuję regulamin gry i wyrażam zgodę na przetwarzanie podanych danych w celu organizacji gry. Osoby niepełnoletnie biorą udział za zgodą rodzica lub pod opieką nauczyciela.</label>
      <p><button type="submit">Zarejestruj drużynę</button></p>
    </form>` : msg('info', 'Rejestracja jest zamknięta.')) : `
    <form id="fLog">
      <label>Nazwa drużyny</label><input name="name" required autocomplete="username">
      <label>Hasło drużyny</label><input name="password" type="password" required autocomplete="current-password">
      <p><button type="submit">Zaloguj</button></p>
    </form>`}
  </div>`;
  $('#tReg').onclick = () => renderWelcome('reg');
  $('#tLog').onclick = () => renderWelcome('log');
  const fr = $('#fReg'), fl = $('#fLog');
  if (fr) fr.onsubmit = async e => {
    e.preventDefault(); const f = new FormData(fr);
    try {
      const r = await api('/api/register', { name: f.get('name'), captain: f.get('captain'), contact: f.get('contact'), school: f.get('school'), password: f.get('password'), consent: !!f.get('consent'), regCode: f.get('regCode') || '', members: String(f.get('members') || '').split('\n') });
      setToken(r.token); flash = ['ok', 'Drużyna zarejestrowana! Zapamiętajcie nazwę i hasło.']; await load(); scrollTop();
    } catch (err) { renderWelcome('reg', msg('err', err.message)); restoreForm('fReg', f); scrollTop(); }
  };
  if (fl) fl.onsubmit = async e => {
    e.preventDefault(); const f = new FormData(fl);
    try { const r = await api('/api/login', { name: f.get('name'), password: f.get('password') }); setToken(r.token); await load(); scrollTop(); }
    catch (err) { renderWelcome('log', msg('err', err.message)); }
  };
}
function restoreForm(id, fd) { const f = document.getElementById(id); if (!f) return; for (const [k, v] of fd.entries()) { const el = f.elements[k]; if (el && el.type !== 'checkbox' && el.type !== 'password') el.value = v; } }

function scrollTop() { const a = document.querySelector('.gs-app'); if (a && a.getBoundingClientRect().top < 0) a.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

// ---------- gra ----------
function render() {
  if (!PUB) return;
  $('#gs-score').classList.toggle('gs-hidden', !ME);
  if (!ME) SMAP = null;
  if (!ME) return renderWelcome();
  $('#gs-score').textContent = ME.team.score + ' pkt';
  const pr = ME.progress;
  if (!ME.team.startedAt) {
    const wait = beforeStart();
    $('#gs-root').innerHTML = `${flash ? msg(flash[0], flash[1]) : ''}
    <div class="gs-card"><h2>Drużyna „${esc(ME.team.name)}”</h2>
      <p>Skład: ${ME.team.members.map(esc).join(', ')}</p>
      ${wait ? `<div class="gs-msg gs-info">Jesteście zarejestrowani. Gra rusza ${esc(PUB.settings.startsLabel)}.</div>
      <p>Do startu zostało:</p><div class="gs-countdown" id="gsCd">${fmtLeft(wait)}</div>
      <p>Wtedy ten przycisk się odblokuje. Od naciśnięcia Start liczy się czas${PUB.settings.mode === 'event' ? ' (limit: ' + PUB.settings.teamTimeLimitMin + ' min)' : ''}.</p>`
      : `<p>Gdy cała drużyna będzie gotowa, naciśnijcie Start. Od tej chwili liczy się czas${PUB.settings.mode === 'event' ? ' (limit: ' + PUB.settings.teamTimeLimitMin + ' min)' : ''}.</p>`}
      <p class="gs-muted">Na innym telefonie zalogujcie się nazwą drużyny i hasłem.</p>
      <button id="bStart"${wait ? ' disabled' : ''}>Start ekspedycji</button> <button class="gs-secondary" id="bOut">Wyloguj</button></div>
    ${PAGES.mapa ? `<div class="gs-card"><p>Trasę możecie obejrzeć już teraz: <a href="${esc(PAGES.mapa)}">mapa miejsc →</a></p></div>` : ''}
    <div class="gs-card"><div class="gs-story">${esc(PUB.intro)}</div></div>`;
    flash = null;
    $('#bStart').onclick = async () => { try { ME = await api('/api/team/start', {}); render(); } catch (e) { alertBox(e.message); } };
    $('#bOut').onclick = logout;
    clearInterval(CD_TIMER);
    if (wait) CD_TIMER = setInterval(() => { const w = beforeStart(); const el = $('#gsCd'); if (!el) { clearInterval(CD_TIMER); return; } if (w) el.textContent = fmtLeft(w); else { clearInterval(CD_TIMER); render(); } }, 1000);
    return;
  }
  {
    $('#gs-root').innerHTML = `
    <div id="flash"></div>
    ${ME.closed ? msg('err', ME.closed) : ''}
    ${ME.team.finishedAt ? msg('ok', 'Gra ukończona! Gratulacje. Rozwiążcie jeszcze Przysięgę Elewa. Rozstrzygnięcie gry o 16:30 w PTTK (plac Artystów) – zapraszamy!') : ''}
    <div class="gs-progress">
      <div class="gs-box"><b>Punkty z animatorem</b><div>${pr.svcDone} / ${pr.svcTotal}</div><div class="gs-bar"><i style="width:${100 * pr.svcDone / pr.svcTotal}%"></i></div></div>
      <div class="gs-box"><b>Punkty samodzielne</b><div>${pr.selfDone} / ${pr.selfRequired} <span class="gs-muted">(z ${pr.selfTotal})</span></div><div class="gs-bar"><i style="width:${Math.min(100, 100 * pr.selfDone / pr.selfRequired)}%"></i></div></div>
    </div>
    <div class="gs-tabs" style="margin-top:14px">
      <button data-t="mapa">Mapa</button><button data-t="punkty">Punkty</button><button data-t="ranking">Ranking</button><button data-t="druzyna">Drużyna</button>
    </div>
    <div id="tab"></div>`;
    document.querySelectorAll('.gs-tabs button').forEach(b => { b.classList.toggle('gs-active', b.dataset.t === TAB); b.onclick = () => { TAB = b.dataset.t; render(); }; });
  }
  if (flash && !OPEN_POINT) { $('#flash').innerHTML = msg(flash[0], flash[1]); flash = null; }
  const tab = $('#tab');
  if (TAB === 'mapa') renderMap(tab);
  if (TAB === 'punkty') tab.innerHTML = `${ME.finalTask ? `<div class="gs-card"><h3>★ ${esc(ME.finalTask.title)}</h3>${taskHtml(ME.finalTask, null)}</div>` : ''}<div class="gs-plist">${ME.points.map(p => `
      <button class="gs-pitem" data-p="${p.id}"><span class="gs-dot" style="background:${pColor(p)}"></span><span class="gs-t"><b>${esc(p.name)}</b><span class="gs-muted">${esc(p.address)}</span><br>${catBadge(p)}</span><span>›</span></button>`).join('')}</div>`;
  if (TAB === 'ranking') loadRanking(tab);
  if (TAB === 'druzyna') {
    tab.innerHTML = `<div class="gs-card"><h2>${esc(ME.team.name)}</h2><p><b>Wynik:</b> ${ME.team.score} pkt</p>
      <p><b>Skład:</b> ${ME.team.members.map(esc).join(', ')}</p>
      <p><b>Start:</b> ${new Date(ME.team.startedAt).toLocaleTimeString('pl-PL')}${ME.team.finishedAt ? ' · <b>Meta:</b> ' + new Date(ME.team.finishedAt).toLocaleTimeString('pl-PL') : ''}</p>
      <p class="gs-muted">${esc(PUB.settings.contact || '')}</p><button class="gs-secondary" id="bOut">Wyloguj na tym telefonie</button></div>
      <div class="gs-card"><div class="gs-story">${esc(PUB.intro)}</div></div>`;
    $('#bOut').onclick = logout;
  }
  if (TAB === 'punkty' && ME.finalTask) bindTask(document.querySelector('.gs-card'), ME.finalTask);
  document.querySelectorAll('[data-p]').forEach(el => el.onclick = () => openPoint(el.dataset.p));
  if (OPEN_POINT) openPoint(OPEN_POINT, true);
}

function canConfirm(p) { return !p.checkedIn && !(p.category === 'obslugiwany' && PUB.settings.mode === 'event'); }
function renderMap(tab) {
  if (!SMAP) SMAP = StaszicMap({
    withStatus: true, onOpen: openPoint, canConfirm,
    onPos: pos => { MY_POS = pos; },
    onConfirm: async (id, pos) => {
      try { const r = await api('/api/team/checkin', { pointId: id, lat: pos.lat, lng: pos.lng, accuracy: pos.acc }); ME = r; flash = ['ok', r.message]; OPEN_POINT = id; render(); }
      catch (e) { flash = ['err', e.message]; render(); }
    },
  });
  SMAP.update(ME.points);
  SMAP.attach(tab);
}
function showMe() { if (SMAP && MY_POS) SMAP.setPos(MY_POS); }

function taskHtml(t, p) {
  let body = '';
  if (t.kind === 'animator') {
    body = t.animatorPoints != null ? msg('ok', `Zaliczone u animatora: ${t.animatorPoints} / ${t.points} pkt`) : msg('info', `Zadanie u animatora, do ${t.points} pkt. Podejdźcie do stanowiska. Punkty wpisze animator.`);
  } else if (t.correct) {
    body = msg('ok', `Zaliczone: +${t.earned} pkt`);
  } else if (t.resolved) {
    body = msg('err', 'Wykorzystaliście wszystkie próby.');
  } else {
    body = (t.hints || []).map(h => `<div class="gs-hint">💡 ${esc(h)}</div>`).join('');
    body += t.options ? `<div class="gs-opts">${t.options.map(o => `<button type="button" data-opt="${esc(o)}">${esc(o)}</button>`).join('')}</div>`
      : `<form class="gs-ans"><div class="gs-row"><input name="a" placeholder="Wasza odpowiedź" autocomplete="off" required><button type="submit" style="flex:0 0 auto">Sprawdź</button></div></form>`;
    body += `<p class="gs-muted">Za zadanie: ${t.points} pkt.</p>`;
    if (t.hints.length < t.hintsTotal) body += `<button class="gs-ghost" data-hint="1">Weź podpowiedź (−${t.hintCosts[t.hints.length]} pkt)</button>`;
  }
  return `<div class="gs-task" data-task="${t.id}"><h3>${esc(t.title)}</h3><p>${esc(t.text)}</p>${body}<div class="gs-tmsg"></div></div>`;
}
function bindTask(root, t) {
  const el = root.querySelector(`[data-task="${t.id}"]`); if (!el) return;
  const out = r => { ME = r; flash = [r.ok ? 'ok' : 'err', r.message]; render(); };
  const fail = e => { el.querySelector('.gs-tmsg').innerHTML = msg('err', e.message); };
  const f = el.querySelector('form.gs-ans');
  if (f) f.onsubmit = async e => { e.preventDefault(); try { out(await api('/api/team/answer', { taskId: t.id, answer: f.a.value })); } catch (er) { fail(er); } };
  el.querySelectorAll('[data-opt]').forEach(b => b.onclick = async () => { if (!confirmOpt(b)) return; try { out(await api('/api/team/answer', { taskId: t.id, answer: b.dataset.opt })); } catch (er) { fail(er); } });
  const h = el.querySelector('[data-hint]');
  if (h) h.onclick = async () => { try { ME = await api('/api/team/hint', { taskId: t.id }); render(); } catch (er) { fail(er); } };
}
function confirmOpt(b) { if (b.dataset.armed) return true; b.closest('.gs-opts').querySelectorAll('button').forEach(x => { delete x.dataset.armed; x.style.borderColor = ''; x.textContent = x.dataset.opt; }); b.dataset.armed = 1; b.style.borderColor = 'var(--copper)'; b.textContent = b.dataset.opt + '  (dotknij ponownie, aby potwierdzić)'; return false; }

function openPoint(id, refresh) {
  const p = ME.points.find(x => x.id === id); if (!p) return;
  OPEN_POINT = id;
  const sheet = $('#gs-sheet');
  const needCheck = !p.checkedIn && !(p.category === 'obslugiwany' && PUB.settings.mode === 'event');
  sheet.innerHTML = `<div class="gs-sheet-head"><h2>${esc(p.name)}</h2><button class="gs-secondary" id="mClose" aria-label="Zamknij">✕</button></div>
    <p class="gs-muted">${esc(p.address)} · <a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking">nawiguj</a></p>
    <p>${catBadge(p)}</p>
    <div class="gs-story">${esc(p.story)}</div>
    <div id="pmsg">${refresh && flash ? '' : ''}</div>
    ${needCheck ? `<div class="gs-card" style="margin-top:12px"><h3>Potwierdźcie obecność</h3>
      <p class="gs-muted">Telefon poprosi o zgodę na lokalizację. Musicie być w promieniu ${p.radius} m od punktu.</p>
      ${PUB.settings.testMode ? '<button id="bTest" class="gs-navy" style="margin-bottom:8px">🧪 Potwierdź (tryb testowy, bez GPS)</button>' : ''}
      <button id="bGps">📍 Jestem na miejscu</button>
      <details style="margin-top:10px"><summary class="gs-muted">GPS nie działa? Wpiszcie kod miejsca</summary>
      <form id="fCode" class="gs-row" style="margin-top:8px"><input name="c" placeholder="Kod miejsca (od organizatora)" autocomplete="off"><button type="submit" class="gs-navy" style="flex:0 0 auto">Potwierdź</button></form></details></div>` : ''}
    ${p.tasks.map(t => taskHtml(t, p)).join('')}
    ${!p.checkedIn && p.category !== 'obslugiwany' ? '<p class="gs-muted">Zadania pokażą się po potwierdzeniu obecności.</p>' : ''}`;
  $('#gs-modal').classList.remove('gs-hidden');
  if (refresh && flash) { $('#pmsg').innerHTML = msg(flash[0], flash[1]); flash = null; }
  $('#mClose').onclick = closeModal;
  p.tasks.forEach(t => bindTask(sheet, t));
  const bg = $('#bGps');
  if (bg) bg.onclick = () => {
    if (!navigator.geolocation) { $('#pmsg').innerHTML = msg('err', 'Ten telefon nie udostępnia lokalizacji. Użyjcie kodu miejsca.'); return; }
    bg.disabled = true; bg.textContent = 'Sprawdzam położenie…';
    navigator.geolocation.getCurrentPosition(async pos => {
      MY_POS = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }; showMe();
      try { const r = await api('/api/team/checkin', { pointId: p.id, lat: MY_POS.lat, lng: MY_POS.lng, accuracy: MY_POS.acc }); ME = r; flash = ['ok', r.message]; render(); }
      catch (e) { bg.disabled = false; bg.textContent = '📍 Spróbuj ponownie'; $('#pmsg').innerHTML = msg('err', e.message); }
    }, err => { bg.disabled = false; bg.textContent = '📍 Jestem na miejscu'; $('#pmsg').innerHTML = msg('err', err.code === 1 ? 'Brak zgody na lokalizację. Włączcie ją w ustawieniach przeglądarki albo użyjcie kodu miejsca.' : 'Nie udało się ustalić położenia. Wyjdźcie na otwartą przestrzeń i spróbujcie ponownie.'); },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
  };
  const bt = $('#bTest');
  if (bt) bt.onclick = async () => { try { const r = await api('/api/team/checkin', { pointId: p.id, test: true }); ME = r; flash = ['ok', r.message]; render(); } catch (e) { $('#pmsg').innerHTML = msg('err', e.message); } };
  const fc = $('#fCode');
  if (fc) fc.onsubmit = async e => { e.preventDefault(); try { const r = await api('/api/team/checkin', { pointId: p.id, code: fc.c.value }); ME = r; flash = ['ok', r.message]; render(); } catch (er) { $('#pmsg').innerHTML = msg('err', er.message); } };
}
function closeModal() { OPEN_POINT = null; $('#gs-modal').classList.add('gs-hidden'); if (ME) { const keep = TAB; render(); TAB = keep; } }
$('#gs-modal').addEventListener('click', e => { if (e.target.id === 'gs-modal') closeModal(); });
function alertBox(t) { const a = $('#gs-root'); a.insertAdjacentHTML('afterbegin', msg('err', t)); }

async function loadRanking(el) {
  try {
    const r = await api('/api/ranking');
    el.innerHTML = `<div class="gs-card"><h2>Ranking</h2><table><thead><tr><th>#</th><th>Drużyna</th><th class="gs-num">Punkty</th><th class="gs-num">Miejsca</th><th class="gs-num">Czas</th></tr></thead><tbody>
      ${r.ranking.map((t, i) => `<tr${ME && t.id === ME.team.id ? ' style="background:#f2dcc8"' : ''}><td class="gs-medal">${i + 1}</td><td>${esc(t.name)}${t.finished ? ' ✓' : ''}</td><td class="gs-num"><b>${t.score}</b></td><td class="gs-num">${t.points}</td><td class="gs-num">${t.durationMin != null ? t.durationMin + ' min' : '–'}</td></tr>`).join('') || '<tr><td colspan="5" class="gs-muted">Brak drużyn</td></tr>'}
      </tbody></table><p class="gs-muted">✓ = gra ukończona. Odświeża się automatycznie.</p></div>`;
  } catch (e) { el.innerHTML = msg('err', e.message); }
}

async function load() {
  try {
    PUB = await api('/api/public');
    if (PUB.settings.serverTime) SKEW = Date.parse(PUB.settings.serverTime) - Date.now();
    $('#gs-brand').innerHTML = `${esc(PUB.settings.title)}<small>${esc(PUB.settings.subtitle || '')}</small>`;
    if (TOKEN) { try { ME = await api('/api/team/me'); } catch { ME = null; } }
    render();
  } catch (e) { $('#gs-root').innerHTML = msg('err', 'Nie można połączyć się z serwerem gry. ' + e.message); }
}
setInterval(async () => {
  if (!ME || document.hidden) return;
  try {
    const before = JSON.stringify(ME);
    const fresh = await api('/api/team/me');
    if (JSON.stringify(fresh) !== before && !document.activeElement.matches('input,textarea')) { ME = fresh; render(); }
    else if (TAB === 'ranking') loadRanking($('#tab'));
  } catch {}
}, 15000);
load();

})();
