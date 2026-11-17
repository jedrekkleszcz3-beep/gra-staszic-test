(function () {

'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CFG = window.GS_CFG || {}; const API = CFG.api || '/wp-json/gra-staszic/v1';
let D = null, TAB = 'druzyny', NOTE = '';
// Tryb poza WordPressem (CFG.adminLogin): hasło organizatora w nagłówku X-Admin-Key
const KEYS = 'gsAdminKey'; let KEY = ''; try { KEY = sessionStorage.getItem(KEYS) || ''; } catch (e) {}
async function api(path, body, method) {
  const r = await fetch(API + path.replace(/^\/api/, ''), { method: method === 'PUT' ? 'POST' : (method || (body ? 'POST' : 'GET')), credentials: 'same-origin', cache: 'no-store', headers: Object.assign({ 'Content-Type': 'application/json' }, CFG.adminLogin ? { 'X-Admin-Key': KEY } : { 'X-WP-Nonce': CFG.nonce || '' }), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Błąd'); return j;
}
const t = iso => iso ? new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '–';
function login(err) {
  if (!CFG.adminLogin) { $('#gs-admin-root').innerHTML = `<div class="gs-msg gs-err">${esc(err || 'Brak dostępu.')} Odśwież stronę (sesja WordPressa mogła wygasnąć).</div>`; return; }
  $('#gs-admin-root').innerHTML = `<div class="gs-card" style="max-width:420px"><h2>Panel organizatora</h2>${KEY && err ? `<div class="gs-msg gs-err">${esc(err)}</div>` : ''}
    <form id="fAdm"><label>Hasło organizatora</label><input name="k" type="password" required autocomplete="current-password"><p><button type="submit">Wejdź</button></p></form></div>`;
  $('#fAdm').onsubmit = e => { e.preventDefault(); KEY = new FormData(e.target).get('k'); try { sessionStorage.setItem(KEYS, KEY); } catch (x) {} load(); };
}
async function downloadCsv(e) {
  if (!CFG.adminLogin) return; e.preventDefault();
  try { const r = await fetch(API + '/admin/export', { headers: { 'X-Admin-Key': KEY }, cache: 'no-store' }); if (!r.ok) throw new Error('Nie udało się pobrać wyników.');
    const u = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = u; a.download = 'wyniki-gry-staszic.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000);
  } catch (x) { alert(x.message); }
}
async function load() {
  try { D = await api('/api/admin/state'); render(); }
  catch (e) { login(e.message); }
}
function render() {
  const s = D.settings;
  $('#gs-admin-root').innerHTML = `${NOTE}
  ${D.todo.length ? `<div class="gs-msg gs-err">Uzupełnij odpowiedzi po wizji lokalnej (${D.todo.length}): ${D.todo.map(esc).join(' · ')}</div>` : ''}
  <div class="gs-card"><div class="gs-row" style="align-items:end">
    <div><label>Tryb gry</label><select id="sMode"><option value="event" ${s.mode === 'event' ? 'selected' : ''}>Wydarzenie (z animatorami)</option><option value="solo" ${s.mode === 'solo' ? 'selected' : ''}>Samodzielny quest (bez animatorów)</option></select></div>
    <div><label>Rejestracja</label><select id="sReg"><option value="1" ${s.registrationOpen ? 'selected' : ''}>otwarta</option><option value="0" ${!s.registrationOpen ? 'selected' : ''}>zamknięta</option></select></div>
    <div><label>Gra</label><select id="sOpen"><option value="1" ${s.gameOpen ? 'selected' : ''}>trwa</option><option value="0" ${!s.gameOpen ? 'selected' : ''}>wstrzymana</option></select></div>
    <div><label>Start gry (od kiedy można grać)</label><input id="sStart" value="${esc(s.gameStartsAt || '')}" placeholder="2026-11-20T12:00:00+01:00"></div>
    <div><label>Kod rejestracji (puste = bez kodu)</label><input id="sCode" value="${esc(s.registrationCode || '')}" autocomplete="off"></div>
    <div><label>Koniec gry (wydarzenie)</label><input id="sEnd" value="${esc(s.gameEndsAt || '')}"></div>
    <div><label>Limit na drużynę (min)</label><input id="sLim" type="number" value="${s.teamTimeLimitMin || ''}"></div>
    <div><label>Tryb testowy</label><select id="sTest"><option value="0" ${!s.testMode ? 'selected' : ''}>wyłączony</option><option value="1" ${s.testMode ? 'selected' : ''}>WŁĄCZONY (bez blokady startu i GPS)</option></select></div>
    <div style="flex:0 0 auto"><button id="bSave">Zapisz ustawienia</button></div>
  </div></div>
  ${s.testMode ? `<div class="gs-msg gs-err">Tryb testowy jest włączony: gra działa przed startem, a potwierdzenie obecności przechodzi z dowolnego miejsca. <a href="/" target="_blank">Otwórz grę</a>, zarejestruj drużynę testową, a po testach usuń ją w zakładce Drużyny i wyłącz tryb testowy przed wydarzeniem.</div>` : ''}
  <div class="gs-tabs"><button data-t="druzyny">Drużyny (${D.teams.length})</button><button data-t="ranking">Ranking</button><button data-t="log">Dziennik</button><button data-t="zadania">Zadania i punkty</button></div>
  <div id="tab"></div>`;
  document.querySelectorAll('[data-t]').forEach(b => { b.classList.toggle('gs-active', b.dataset.t === TAB); b.onclick = () => { TAB = b.dataset.t; NOTE = ''; render(); }; });
  $('#bSave').onclick = async () => { await act(() => api('/api/admin/settings', { mode: $('#sMode').value, registrationOpen: $('#sReg').value === '1', gameOpen: $('#sOpen').value === '1', gameStartsAt: $('#sStart').value.trim() || null, registrationCode: $('#sCode').value.trim(), gameEndsAt: $('#sEnd').value.trim() || null, teamTimeLimitMin: Number($('#sLim').value) || null, testMode: $('#sTest').value === '1' }), 'Zapisano ustawienia.'); };
  const tab = $('#tab');
  if (TAB === 'druzyny') {
    tab.innerHTML = `<p><a class="gs-btn" id="gsCsv" href="${esc(CFG.exportUrl || '#')}">Pobierz wyniki (CSV / Excel)</a></p>` + D.teams.map(tm => `
    <div class="gs-card"><div class="gs-row"><div><h3>${esc(tm.name)} ${tm.hidden ? '<span class="gs-badge">ukryta</span>' : ''}${tm.finishedAt ? '<span class="gs-badge gs-done">ukończona</span>' : ''}</h3>
      <div class="gs-small">Kapitan: <b>${esc(tm.captain)}</b>, ${esc(tm.contact)} ${tm.school ? '· ' + esc(tm.school) : ''}<br>Skład (${tm.members.length}): ${tm.members.map(esc).join(', ')}<br>
      Rejestracja ${t(tm.createdAt)} · start ${t(tm.startedAt)} · meta ${t(tm.finishedAt)}</div></div>
      <div style="flex:0 0 auto;text-align:right"><div style="font-size:1.6rem;font-weight:800">${tm.score} pkt</div><div class="gs-small">animator ${tm.progress.svcDone}/${tm.progress.svcTotal} · samodz. ${tm.progress.selfDone}/${tm.progress.selfRequired}</div></div></div>
      <details><summary>Szczegóły i korekty</summary>
        <table class="gs-small"><thead><tr><th>Punkt</th><th>Obecność</th><th>Animator</th></tr></thead><tbody>${D.points.map(p => `<tr><td>${esc(p.name)}</td><td>${tm.checkins[p.id] ? t(tm.checkins[p.id].at) + ' (' + tm.checkins[p.id].method + (tm.checkins[p.id].d != null ? ', ' + tm.checkins[p.id].d + ' m' : '') + ')' : `<button class="gs-ghost" data-ck="${tm.id}|${p.id}">zalicz obecność</button>`}</td><td>${tm.animator[p.id] ? tm.animator[p.id].points + ' pkt' : ''}</td></tr>`).join('')}</tbody></table>
        <p class="gs-small"><b>Odpowiedzi:</b><br>${Object.entries(tm.tasks).map(([id, st]) => `${esc(id)}: ${st.correct ? '✅' : '❌'} próby ${st.attempts}, podp. ${st.hints} – <i>${st.answers.map(a => esc(a.a)).join(' | ')}</i> <button class="gs-ghost" data-rt="${tm.id}|${esc(id)}">wyzeruj</button>`).join('<br>') || 'brak'}</p>
        <p class="gs-small"><b>Korekty:</b> ${tm.adjustments.map(a => `${a.delta > 0 ? '+' : ''}${a.delta} (${esc(a.reason)})`).join(', ') || 'brak'}</p>
        <form class="gs-row" data-adj="${tm.id}"><input name="d" type="number" placeholder="+/- punkty" required style="flex:0 0 130px"><input name="r" placeholder="powód (np. zdjęcie, kara)"><button style="flex:0 0 auto">Dodaj korektę</button></form>
        <p class="gs-row"><button class="gs-secondary" data-pw="${tm.id}">Nowe hasło drużyny</button><button class="gs-secondary" data-hide="${tm.id}">${tm.hidden ? 'Pokaż w rankingu' : 'Ukryj w rankingu'}</button><button class="gs-secondary" style="color:var(--bad)" data-del="${tm.id}">Usuń drużynę</button></p>
      </details></div>`).join('');
    const csv = document.getElementById('gsCsv'); if (csv) csv.onclick = downloadCsv;
    tab.querySelectorAll('[data-ck]').forEach(b => b.onclick = () => { const [id, p] = b.dataset.ck.split('|'); act(() => api(`/api/admin/team/${id}/checkin`, { pointId: p }), 'Zaliczono obecność.'); });
    tab.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => { const [id, tk] = b.dataset.rt.split('|'); if (confirm('Wyzerować to zadanie (drużyna odpowie od nowa)?')) act(() => api(`/api/admin/team/${id}/resettask`, { taskId: tk }), 'Wyzerowano zadanie.'); });
    tab.querySelectorAll('[data-adj]').forEach(f => f.onsubmit = e => { e.preventDefault(); act(() => api(`/api/admin/team/${f.dataset.adj}/adjust`, { delta: Number(f.d.value), reason: f.r.value }), 'Dodano korektę.'); });
    tab.querySelectorAll('[data-pw]').forEach(b => b.onclick = () => { const p = prompt('Nowe hasło (min. 4 znaki):'); if (p) act(() => api(`/api/admin/team/${b.dataset.pw}/password`, { password: p }), 'Zmieniono hasło: ' + p); });
    tab.querySelectorAll('[data-hide]').forEach(b => b.onclick = () => act(() => api(`/api/admin/team/${b.dataset.hide}/hide`, {}), 'Zmieniono widoczność.'));
    tab.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (confirm('Na pewno usunąć drużynę? Tego nie da się cofnąć.')) act(() => api(`/api/admin/team/${b.dataset.del}/delete`, {}), 'Usunięto drużynę.'); });
  }
  if (TAB === 'ranking') tab.innerHTML = `<div class="gs-card"><table><thead><tr><th>#</th><th>Drużyna</th><th class="gs-num">Pkt</th><th class="gs-num">Miejsca</th><th class="gs-num">Czas</th></tr></thead><tbody>${D.ranking.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}${r.finished ? ' ✓' : ''}</td><td class="gs-num"><b>${r.score}</b></td><td class="gs-num">${r.points}</td><td class="gs-num">${r.durationMin ?? '–'}</td></tr>`).join('')}</tbody></table></div>`;
  if (TAB === 'log') { const names = Object.fromEntries(D.teams.map(x => [x.id, x.name])); tab.innerHTML = `<div class="gs-card"><table class="gs-small"><tbody>${D.log.map(l => `<tr><td>${t(l.at)}</td><td>${esc(names[l.teamId] || l.teamId || '')}</td><td>${esc(l.type)}</td><td>${esc(typeof l.info === 'object' ? JSON.stringify(l.info) : l.info || '')}</td></tr>`).join('')}</tbody></table></div>`; }
  if (TAB === 'zadania') {
    tab.innerHTML = `<div class="gs-card"><h3>Edycja punktów i zadań</h3><p class="gs-small">Cała gra jest zapisana w jednym pliku JSON. Możesz tu poprawić odpowiedzi (pole <code>answers</code>, zamień <code>__UZUPELNIJ__</code> na prawdziwą odpowiedź i usuń <code>"todo": true</code>), współrzędne GPS (<code>lat</code>, <code>lng</code>, <code>radius</code> w metrach), kody miejsc, PIN-y animatorów (<code>animators</code>) i dodawać nowe punkty. Przed zapisem robiona jest kopia zapasowa. Typy zadań: <code>answer</code> (wpisywana odpowiedź), <code>choice</code> (wybór z <code>options</code>), <code>animator</code> (punkty wpisuje animator). Pole <code>mode</code>: <code>event</code> (tylko podczas wydarzenia), <code>solo</code> (tylko w samodzielnym queście), <code>both</code>. Dopasowanie <code>match</code>: <code>exact</code> albo <code>contains</code>; wielkość liter i polskie znaki nie mają znaczenia.</p>
    <textarea id="gj" style="min-height:60vh;font:13px ui-monospace,monospace" spellcheck="false">Ładowanie…</textarea><p><button id="bGj">Zapisz grę</button></p></div>`;
    api('/api/admin/game').then(g => { $('#gj').value = JSON.stringify(g, null, 2); });
    $('#bGj').onclick = () => { let g; try { g = JSON.parse($('#gj').value); } catch (e) { NOTE = `<div class="gs-msg gs-err">Błąd w JSON: ${esc(e.message)}</div>`; return render(); } act(() => api('/api/admin/game', g, 'PUT'), 'Zapisano grę.'); };
  }
}
async function act(fn, ok) { try { await fn(); NOTE = `<div class="gs-msg gs-ok">${esc(ok)}</div>`; } catch (e) { NOTE = `<div class="gs-msg gs-err">${esc(e.message)}</div>`; } D = await api('/api/admin/state'); render(); }
setInterval(async () => { if (D && TAB !== 'zadania' && !document.querySelector('details[open]') && document.activeElement.tagName !== 'INPUT') { try { D = await api('/api/admin/state'); render(); } catch {} } }, 20000);
load();

})();
