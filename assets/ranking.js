(function () {
'use strict';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function tick() {
  try {
    const r = await (await fetch(((window.GS_CFG || {}).api || '/wp-json/gra-staszic/v1') + '/ranking', { credentials: 'omit', cache: 'no-store' })).json();
    document.getElementById('gs-rows').innerHTML = r.ranking.map((t, i) => `<tr class="gs-top${i + 1}"><td class="gs-medal">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td><td>${esc(t.name)}${t.finished ? ' ✓' : t.started ? '' : ' <span class="gs-muted">(przed startem)</span>'}</td><td class="gs-num"><b>${t.score}</b></td><td class="gs-num">${t.points}</td><td class="gs-num">${t.durationMin != null ? t.durationMin + ' min' : '–'}</td></tr>`).join('') || '<tr><td colspan="5" class="gs-muted">Brak drużyn</td></tr>';
    document.getElementById('gs-at').textContent = 'Aktualizacja: ' + new Date(r.at).toLocaleTimeString('pl-PL') + ' · ✓ = gra ukończona';
  } catch {}
}
tick(); setInterval(tick, 10000);

})();
