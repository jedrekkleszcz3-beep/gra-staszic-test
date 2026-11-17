(function () {

'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let PIN = ''; try { PIN = sessionStorage.getItem('anim_pin') || ''; } catch {}
const API = (window.GS_CFG || {}).api || '/wp-json/gra-staszic/v1';
let DATA = null, POINT = null, FILTER = '', NOTE = '';
async function api(path, body) {
  const r = await fetch(API + path.replace(/^\/api/, ''), { method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Animator-Pin': PIN }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Błąd'); return j;
}
function loginView(err) {
  $('#gsAnimOut').classList.add('gs-hidden');
  $('#gs-anim-root').innerHTML = `<div class="gs-card"><h2>Logowanie animatora</h2>${err ? `<div class="gs-msg gs-err">${esc(err)}</div>` : ''}
  <form id="f"><label>PIN stanowiska</label><input name="p" inputmode="numeric" autocomplete="off" required><p><button>Wejdź</button></p></form></div>`;
  $('#f').onsubmit = e => { e.preventDefault(); PIN = e.target.p.value.trim(); load(); };
}
async function load() {
  try { DATA = await api('/api/animator/state'); try { sessionStorage.setItem('anim_pin', PIN); } catch {} if (!POINT || !DATA.points.find(p => p.id === POINT)) POINT = DATA.points[0].id; render(); }
  catch (e) { PIN = ''; try { sessionStorage.removeItem('anim_pin'); } catch {} loginView(e.message); }
}
function render(note) {
  $('#gsAnimOut').classList.remove('gs-hidden');
  const p = DATA.points.find(x => x.id === POINT);
  const teams = DATA.teams.filter(t => !FILTER || t.name.toLowerCase().includes(FILTER.toLowerCase()));
  $('#gs-anim-root').innerHTML = `${note || ''}
  ${DATA.points.length > 1 ? `<div class="gs-tabs">${DATA.points.map(x => `<button data-pt="${x.id}" class="${x.id === POINT ? 'gs-active' : ''}">${esc(x.name)}</button>`).join('')}</div>` : ''}
  <div class="gs-card"><h2>${esc(p.name)}</h2>${p.tasks.map(t => `<p><b>${esc(t.title)}</b> (max ${t.points} pkt)<br>${esc(t.text)}</p>`).join('')}</div>
  <div class="gs-card"><label>Szukaj drużyny</label><input id="q" value="${esc(FILTER)}" placeholder="nazwa drużyny">
  <table style="margin-top:10px"><thead><tr><th>Drużyna</th><th class="gs-num">Wynik u was</th><th></th></tr></thead><tbody>
  ${teams.map(t => { const s = t.scores[POINT]; return `<tr><td><b>${esc(t.name)}</b><br><span class="gs-muted">${t.members} os.${t.started ? '' : ' · nie wystartowała'}</span></td>
    <td class="gs-num">${s ? `<b>${s.points}</b> / ${p.max}` : '–'}</td>
    <td style="width:150px"><form class="gs-row" data-team="${t.id}" style="gap:6px;flex-wrap:nowrap"><input name="pts" type="number" min="0" max="${p.max}" value="${s ? s.points : ''}" style="width:70px;flex:0 0 70px" required><button style="flex:0 0 auto;padding:8px 10px">${s ? 'Popraw' : 'Zapisz'}</button></form></td></tr>`; }).join('') || '<tr><td colspan="3" class="gs-muted">Brak drużyn</td></tr>'}
  </tbody></table></div>`;
  document.querySelectorAll('[data-pt]').forEach(b => b.onclick = () => { POINT = b.dataset.pt; render(); });
  const q = $('#q'); q.oninput = () => { FILTER = q.value; render(); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  document.querySelectorAll('form[data-team]').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/animator/score', { pointId: POINT, teamId: f.dataset.team, points: Number(f.pts.value) }); DATA = await api('/api/animator/state'); render(`<div class="gs-msg gs-ok">Zapisano ${esc(f.pts.value)} pkt.</div>`); }
    catch (er) { render(`<div class="gs-msg gs-err">${esc(er.message)}</div>`); }
  });
}
$('#gsAnimOut').onclick = () => { PIN = ''; try { sessionStorage.removeItem('anim_pin'); } catch {} loginView(); };
setInterval(async () => { if (PIN && DATA && document.activeElement.tagName !== 'INPUT') { try { DATA = await api('/api/animator/state'); render(); } catch {} } }, 20000);
PIN ? load() : loginView();

})();
