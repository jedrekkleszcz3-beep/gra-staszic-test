// Backend gry „Staszic w Kielcach” – Vercel Function + Supabase (RPC).
// Ta sama logika co wtyczka WordPress (includes/core.php + rest.php).
'use strict';
const crypto = require('crypto');
const DEFAULT_GAME = require('../data/game.json');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY;
const GS_SECRET = process.env.GS_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

class GsError extends Error { constructor(msg, status = 400, extra) { super(msg); this.status = status; this.extra = extra; } }

async function rpc(fn, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ k: GS_SECRET }, args)),
  });
  const txt = await r.text();
  if (!r.ok) throw new GsError('Błąd bazy danych: ' + txt.slice(0, 200), 500);
  return txt ? JSON.parse(txt) : null;
}

/* ---------- konfiguracja gry ---------- */
let GAME = null;
async function loadGame() {
  const g = await rpc('gs_cfg_get', { ck: 'game' });
  if (g && g.settings) {
    GAME = g;
    // punkty z animatorami: tylko zadanie animatora, bez pytań wiedzowych (20.11)
    let ch = false;
    for (const p of GAME.points || []) if (['muzeum', 'sienkiewicza', 'pttk'].includes(p.id) && (p.tasks || []).some(t => t.kind !== 'animator')) { p.tasks = p.tasks.filter(t => t.kind === 'animator'); ch = true; }
    const mz = (GAME.points || []).find(p => p.id === 'muzeum');
    const at = mz && (mz.tasks || []).find(t => t.kind === 'animator');
    if (at && /czterema|7–8/.test(at.text || '')) { at.text = at.text.replace('czterema opisami', 'sześcioma opisami').replace('(7–8 pkt za każdy poprawny minerał, za komplet 30 pkt)', '(5 pkt za każdy poprawny minerał, maksymalnie 30 pkt)'); ch = true; }
    if (ch) await saveGame(GAME);
    return;
  }
  GAME = JSON.parse(JSON.stringify(DEFAULT_GAME));
  await rpc('gs_cfg_set', { ck: 'game', v: GAME });
}
async function saveGame(g) {
  const old = await rpc('gs_cfg_get', { ck: 'game' });
  const b = (await rpc('gs_cfg_get', { ck: 'game_backups' })) || [];
  b.unshift({ at: nowIso(), json: old });
  await rpc('gs_cfg_set', { ck: 'game_backups', v: b.slice(0, 10) });
  await rpc('gs_cfg_set', { ck: 'game', v: g });
  GAME = g;
}
const S = (k, def) => { const s = GAME.settings; if (k === undefined) return s; return s[k] !== undefined && s[k] !== null && s[k] !== '' ? s[k] : def; };
const points = () => GAME.points;
const point = id => points().find(p => p.id === id) || null;

/* ---------- pomocnicze ---------- */
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const ts = iso => (iso ? Date.parse(iso) / 1000 : null);
const now = () => Date.now() / 1000;
function normalize(s) {
  s = String(s ?? '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const LOGQ = [];
function log(type, teamId = '', info = null) {
  LOGQ.push(rpc('gs_log_add', { ty: type, tid: String(teamId || ''), inf: info === null || info === undefined ? null : (typeof info === 'object' ? JSON.stringify(info) : String(info)) }).catch(() => {}));
}
function activeTasks(p) { const mode = S('mode', 'event'); return (p.tasks || []).filter(t => { const m = t.mode || 'both'; return m === 'both' || m === mode; }); }
function findTask(id) {
  if (GAME.finalTask && GAME.finalTask.id === id) return [GAME.finalTask, null];
  for (const p of points()) for (const t of (p.tasks || [])) if (t.id === id) return [t, p];
  return null;
}
const hintCost = (task, used) => (task.hints || []).slice(0, used).reduce((s, h) => s + (parseInt(h.cost, 10) || 0), 0);
const maxAttempts = () => 9999;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

function hashPassword(pw) { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt$' + salt + '$' + crypto.scryptSync(pw, salt, 32).toString('hex'); }
function checkPassword(pw, h) {
  const [alg, salt, hex] = String(h || '').split('$'); if (alg !== 'scrypt' || !salt || !hex) return false;
  const a = crypto.scryptSync(pw, salt, 32), b = Buffer.from(hex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

/* ---------- drużyny ---------- */
function fixTeam(t, ver) {
  for (const k of ['checkins', 'tasks', 'animator']) if (!isObj(t[k])) t[k] = {};
  for (const k of ['adjustments', 'tokens', 'members']) if (!Array.isArray(t[k])) t[k] = [];
  t._ver = ver; return t;
}
let TEAMS_CACHE = null;
async function teams() {
  if (TEAMS_CACHE) return TEAMS_CACHE;
  const rows = await rpc('gs_teams_all', {});
  TEAMS_CACHE = (rows || []).map(r => fixTeam(r.data, r.ver));
  return TEAMS_CACHE;
}
async function team(id) { const rows = await rpc('gs_team_get', { tid: String(id) }); return rows && rows[0] ? fixTeam(rows[0].data, rows[0].ver) : null; }
async function teamByToken(tok) {
  if (!tok || tok.length < 20) return null;
  const h = sha256(tok);
  return (await teams()).find(t => t.tokens.includes(h)) || null;
}
const strip = t => { const d = Object.assign({}, t); delete d._ver; return d; };
async function insertTeam(t) { return rpc('gs_team_insert', { tid: t.id, nn: normalize(t.name), d: strip(t) }); }
async function mutateTeam(id, fn) {
  for (let i = 0; i < 6; i++) {
    const t = await team(id);
    if (!t) throw new GsError('Nie ma takiej drużyny.', 404);
    const ver = t._ver;
    let res = await fn(t);
    if (res === false) return t;
    res = refreshFinish(res);
    const ok = await rpc('gs_team_update', { tid: id, v: ver, nn: normalize(res.name), d: strip(res) });
    if (ok) { res._ver = ver + 1; TEAMS_CACHE = null; return res; }
    await new Promise(r => setTimeout(r, 30));
  }
  throw new GsError('Serwer jest zajęty, spróbujcie ponownie.', 409);
}

/* ---------- stan gry ---------- */
function taskResolved(tm, task, p) {
  if (task.kind === 'animator') return !!tm.animator[p.id];
  const st = tm.tasks[task.id];
  return !!st && (!!st.correct || st.attempts >= maxAttempts(task));
}
function pointDone(tm, p) {
  if (!tm.checkins[p.id]) return false;
  return activeTasks(p).every(t => taskResolved(tm, t, p));
}
function progress(tm) {
  const svc = points().filter(p => p.category === 'obslugiwany'), self = points().filter(p => p.category !== 'obslugiwany');
  const sd = svc.filter(p => pointDone(tm, p)).length, fd = self.filter(p => pointDone(tm, p)).length;
  const req = parseInt(S('requiredSelfPoints', 4), 10);
  return { svcDone: sd, svcTotal: svc.length, selfDone: fd, selfTotal: self.length, selfRequired: req, finished: sd === svc.length && fd >= req };
}
function score(tm) {
  let pts = 0;
  for (const p of points()) if (tm.checkins[p.id]) pts += parseInt(S('checkinPoints', 0), 10);
  for (const [tid, st] of Object.entries(tm.tasks)) { const f = findTask(tid); if (f && st.correct) pts += Math.max(0, (parseInt(f[0].points, 10) || 0) - hintCost(f[0], st.hints || 0)); }
  for (const a of Object.values(tm.animator)) pts += parseInt(a.points, 10) || 0;
  for (const a of tm.adjustments) pts += parseInt(a.delta, 10) || 0;
  if (tm.finishedAt) pts += parseInt(S('finishBonus', 0), 10);
  return pts;
}
function refreshFinish(tm) {
  if (!tm.finishedAt && progress(tm).finished) { tm.finishedAt = nowIso(); log('finish', tm.id); }
  return tm;
}
function startsLabel() {
  const iso = S('gameStartsAt'); if (!iso) return '';
  const ms = Date.parse(iso); if (isNaN(ms)) return iso;
  const m = /([+-])(\d\d):?(\d\d)$/.exec(iso); const off = m ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) : 60;
  const d = new Date(ms + off * 60000);
  const days = ['niedzielę', 'poniedziałek', 'wtorek', 'środę', 'czwartek', 'piątek', 'sobotę'];
  const months = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  return `w ${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} o ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function gameClosedFor(tm) {
  const start = ts(S('gameStartsAt'));
  if (start && now() < start && !S('testMode', false)) return 'Gra rusza ' + startsLabel() + '. Do zobaczenia!';
  if (!S('gameOpen', false)) return 'Gra jest obecnie zamknięta.';
  if (S('mode') === 'event') {
    const end = ts(S('gameEndsAt'));
    if (end && now() > end) return 'Czas gry minął.';
    const lim = parseInt(S('teamTimeLimitMin', 0), 10);
    if (tm && tm.startedAt && lim && now() > ts(tm.startedAt) + lim * 60) return 'Wasz limit czasu minął. Zgłoście się do organizatora.';
  }
  return null;
}
function ranking(list) {
  const out = list.filter(t => !t.hidden).map(t => {
    const pr = progress(t);
    const dur = t.finishedAt && t.startedAt ? ts(t.finishedAt) - ts(t.startedAt) : null;
    return { id: t.id, name: t.name, score: score(t), points: pr.svcDone + pr.selfDone, finished: !!t.finishedAt, durationMin: dur !== null ? Math.round(dur / 60) : null, started: !!t.startedAt };
  });
  out.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.finished !== b.finished) return b.finished ? 1 : -1;
    const da = a.durationMin === null ? 1e9 : a.durationMin, db = b.durationMin === null ? 1e9 : b.durationMin;
    if (da !== db) return da - db;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return out;
}

/* ---------- widoki publiczne ---------- */
function publicTask(task, tm, p) {
  const st = tm && tm.tasks[task.id] ? tm.tasks[task.id] : { attempts: 0, hints: 0 };
  const hints = task.hints || [];
  const out = { id: task.id, kind: task.kind, title: task.title, text: task.text, points: parseInt(task.points, 10) || 0, maxAttempts: maxAttempts(task), options: task.options || null, hintsTotal: hints.length, hintCosts: hints.map(h => parseInt(h.cost, 10) || 0) };
  if (tm) {
    const used = parseInt(st.hints, 10) || 0;
    out.attempts = parseInt(st.attempts, 10) || 0;
    out.correct = !!st.correct;
    out.hints = hints.slice(0, used).map(h => h.text);
    out.resolved = p ? taskResolved(tm, task, p) : (!!st.correct || out.attempts >= maxAttempts(task));
    if (task.kind === 'animator' && p && tm.animator[p.id]) out.animatorPoints = parseInt(tm.animator[p.id].points, 10);
    if (st.correct) out.earned = Math.max(0, out.points - hintCost(task, used));
  }
  return out;
}
function publicPoint(p, tm) {
  const checked = tm ? !!tm.checkins[p.id] : false;
  const tasks = activeTasks(p);
  return {
    id: p.id, name: p.name, category: p.category, badge: !!p.badge, address: p.address || '',
    lat: +p.lat, lng: +p.lng, radius: parseInt(p.radius || S('gpsDefaultRadius', 80), 10),
    story: p.story || '', checkedIn: checked, done: tm ? pointDone(tm, p) : false,
    taskCount: tasks.length, tasks: tasks.filter(t => t.kind === 'animator' || checked).map(t => publicTask(t, tm, p)),
  };
}
function publicSettings() {
  const s = S(), o = {};
  for (const k of ['title', 'subtitle', 'mode', 'registrationOpen', 'gameOpen', 'maxTeamSize', 'minTeamSize', 'teamTimeLimitMin', 'gameStartsAt', 'gameEndsAt', 'requiredSelfPoints', 'checkinPoints', 'finishBonus', 'contact']) o[k] = s[k] !== undefined ? s[k] : null;
  o.testMode = !!s.testMode; if (o.testMode) o.gameStartsAt = null;
  o.startsLabel = startsLabel(); o.needsRegCode = !!s.registrationCode; o.serverTime = nowIso();
  return o;
}
function teamView(tm) {
  return {
    team: { id: tm.id, name: tm.name, captain: tm.captain, members: tm.members, startedAt: tm.startedAt || null, finishedAt: tm.finishedAt || null, score: score(tm) },
    progress: progress(tm), closed: gameClosedFor(tm),
    points: points().map(p => publicPoint(p, tm)),
    finalTask: tm.finishedAt && GAME.finalTask ? publicTask(GAME.finalTask, tm, null) : null,
  };
}

/* ---------- HTTP ---------- */
const str = (b, k, max = 200) => (b && b[k] !== undefined && b[k] !== null && typeof b[k] !== 'object' ? String(b[k]).trim().slice(0, max) : '');
const newId = (n = 6) => crypto.randomBytes(n).toString('hex');
function issueToken(tm) {
  const tok = crypto.randomBytes(30).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  tm.tokens.push(sha256(tok)); if (tm.tokens.length > 20) tm.tokens.shift();
  return tok;
}
let IP = 'x';
async function rateLimited(key, max, windowS) { return rpc('gs_rate_hit', { rk: sha256(key + '|' + IP).slice(0, 40), mx: max, win: windowS }); }
const isAdmin = req => ADMIN_PASSWORD.length >= 8 && safeEq(req.headers['x-admin-key'] || '', ADMIN_PASSWORD);

const routes = {};
const R = (m, p, fn) => { routes[m + ' ' + p] = fn; };

R('GET', 'public', async () => ({ settings: publicSettings(), intro: GAME.intro, points: points().map(p => publicPoint(p, null)) }));
R('GET', 'ranking', async () => ({ ranking: ranking(await teams()), at: nowIso() }));

R('POST', 'register', async (req, b) => {
  if (!S('registrationOpen', false)) throw new GsError('Rejestracja jest zamknięta.');
  if (await rateLimited('reg', 30, 3600)) throw new GsError('Za dużo rejestracji z tego adresu. Spróbujcie później.', 429);
  const code = String(S('registrationCode', ''));
  if (code !== '' && normalize(str(b, 'regCode', 60)) !== normalize(code)) throw new GsError('Niepoprawny kod rejestracji. Otrzymacie go od organizatora.');
  const name = str(b, 'name', 40), captain = str(b, 'captain', 60), contact = str(b, 'contact', 100);
  const password = typeof b.password === 'string' ? b.password : '';
  const members = (Array.isArray(b.members) ? b.members : []).map(m => String(m).trim().slice(0, 60)).filter(Boolean).slice(0, 20);
  if (name.length < 2 || normalize(name) === '') throw new GsError('Podaj nazwę drużyny (min. 2 znaki).');
  if ((await teams()).some(t => normalize(t.name) === normalize(name))) throw new GsError('Drużyna o takiej nazwie już istnieje.');
  if (password.length < 4) throw new GsError('Hasło drużyny musi mieć co najmniej 4 znaki.');
  if (!captain) throw new GsError('Podaj imię i nazwisko kapitana.');
  if (!contact) throw new GsError('Podaj telefon lub e-mail kapitana.');
  const all = [captain]; for (const m of members) if (normalize(m) !== normalize(captain)) all.push(m);
  const min = parseInt(S('minTeamSize', 1), 10), max = parseInt(S('maxTeamSize', 99), 10);
  if (all.length < min || all.length > max) throw new GsError(`Drużyna musi liczyć od ${min} do ${max} osób (razem z kapitanem).`);
  if (!b.consent) throw new GsError('Zaakceptuj regulamin i zgodę na przetwarzanie danych.');
  const tm = { id: newId(), name, captain, contact, school: str(b, 'school', 80), members: all, passHash: hashPassword(password), createdAt: nowIso(), startedAt: null, finishedAt: null, tokens: [], checkins: {}, tasks: {}, animator: {}, adjustments: [] };
  const tok = issueToken(tm);
  if (!(await insertTeam(tm))) throw new GsError('Drużyna o takiej nazwie już istnieje.');
  log('register', tm.id, name);
  return { token: tok };
});
R('POST', 'login', async (req, b) => {
  if (await rateLimited('login', 20, 600)) throw new GsError('Za dużo prób logowania. Odczekajcie 10 minut.', 429);
  const n = normalize(str(b, 'name', 60));
  const tm = (await teams()).find(t => normalize(t.name) === n);
  if (!tm || !checkPassword(typeof b.password === 'string' ? b.password : '', tm.passHash)) throw new GsError('Zła nazwa drużyny lub hasło.', 401);
  let tok = null;
  await mutateTeam(tm.id, t => { tok = issueToken(t); return t; });
  return { token: tok };
});

async function authTeam(req) { const tm = await teamByToken(String(req.headers['x-gs-token'] || '')); if (!tm) throw new GsError('Zaloguj się ponownie.', 401); return tm; }
R('GET', 'team/me', async req => teamView(await authTeam(req)));

async function teamAction(action, req, b) {
  const tm = await authTeam(req);
  const closed = gameClosedFor(tm);
  if (closed) throw new GsError(closed);
  if (action === 'start') {
    const res = await mutateTeam(tm.id, t => { if (t.startedAt) return false; t.startedAt = nowIso(); log('start', t.id); return t; });
    return teamView(res);
  }
  if (!tm.startedAt) throw new GsError('Najpierw rozpocznijcie grę przyciskiem „Start”.');
  if (action === 'checkin') {
    const p = point(str(b, 'pointId', 40));
    if (!p) throw new GsError('Nie ma takiego punktu.', 404);
    if (tm.checkins[p.id]) return Object.assign(teamView(tm), { message: 'Obecność już potwierdzona.' });
    const radius = parseInt(p.radius || S('gpsDefaultRadius', 80), 10);
    let entry;
    if (str(b, 'code', 60) !== '') {
      if (await rateLimited('code' + tm.id, 30, 3600)) throw new GsError('Za dużo prób kodu. Zgłoście się do organizatora.', 429);
      if (!p.placeCode || normalize(b.code) !== normalize(p.placeCode)) { log('checkin-bad-code', tm.id, p.id); throw new GsError('Niepoprawny kod miejsca.'); }
      entry = { at: nowIso(), method: 'code' };
    } else if (S('testMode', false) && b.test) {
      entry = { at: nowIso(), method: 'test' };
    } else {
      const lat = parseFloat(b.lat), lng = parseFloat(b.lng);
      const acc = Math.min(parseFloat(b.accuracy) || 0, 100);
      if (!isFinite(lat) || !isFinite(lng) || (!lat && !lng)) throw new GsError('Brak położenia GPS.');
      const d = distanceM(lat, lng, +p.lat, +p.lng);
      if (d - acc > radius && !S('testMode', false)) {
        log('checkin-far', tm.id, { point: p.id, d: Math.round(d) });
        throw new GsError(`Jesteście ok. ${Math.round(d)} m od punktu. Podejdźcie bliżej (limit ${radius} m) albo użyjcie kodu miejsca.`, 400, { distance: Math.round(d) });
      }
      entry = { at: nowIso(), method: d - acc > radius ? 'test' : 'gps', d: Math.round(d), acc: Math.round(acc) };
    }
    const res = await mutateTeam(tm.id, t => { if (t.checkins[p.id]) return false; t.checkins[p.id] = entry; return t; });
    log('checkin', tm.id, p.id);
    return Object.assign(teamView(res), { message: `Jesteście na miejscu: ${p.name}. +${parseInt(S('checkinPoints', 0), 10)} pkt` });
  }
  // answer / hint
  const f = findTask(str(b, 'taskId', 60));
  if (!f || f[0].kind === 'animator') throw new GsError('Nie ma takiego zadania.', 404);
  const [task, p] = f;
  if (p && !tm.checkins[p.id]) throw new GsError('Najpierw potwierdźcie obecność w tym miejscu.');
  if (p && !activeTasks(p).some(t => t.id === task.id)) throw new GsError('To zadanie jest nieaktywne w tym trybie gry.');
  if (!p && !tm.finishedAt) throw new GsError('To zadanie odblokujecie po zaliczeniu wymaganych punktów.');
  const maxA = maxAttempts(task);
  const given = str(b, 'answer', 200);
  if (action === 'answer' && normalize(given) === '') throw new GsError('Wpiszcie odpowiedź.');
  let out = {};
  const res = await mutateTeam(tm.id, t => {
    const st = t.tasks[task.id] || { attempts: 0, hints: 0, correct: false, answers: [] };
    if (st.correct) { out = { message: 'Zadanie już zaliczone.' }; return false; }
    if (st.attempts >= maxA) throw new GsError('Wykorzystaliście wszystkie próby.');
    if (action === 'hint') {
      if (st.hints >= (task.hints || []).length) throw new GsError('Brak kolejnych podpowiedzi.');
      st.hints++; t.tasks[task.id] = st; out = {}; return t;
    }
    st.attempts++; st.answers.push({ a: given, at: nowIso() });
    const g = normalize(given); let ok = false;
    for (const a of (task.answers || [])) {
      const n = normalize(a); if (n === '' || a === '__UZUPELNIJ__') continue;
      if (task.match === 'contains' ? g.includes(n) : g === n) { ok = true; break; }
    }
    if (ok) { st.correct = true; st.at = nowIso(); }
    t.tasks[task.id] = st;
    const left = maxA - st.attempts;
    out = { ok, message: ok ? `Dobra odpowiedź! +${Math.max(0, (parseInt(task.points, 10) || 0) - hintCost(task, st.hints))} pkt` : 'Niestety, to nie to. Spróbujcie jeszcze raz.' };
    return t;
  });
  if (action === 'answer' && out.ok !== undefined) log(out.ok ? 'answer-ok' : 'answer-bad', tm.id, { task: task.id, a: given });
  if (action === 'hint') log('hint', tm.id, task.id);
  return Object.assign(teamView(res), out);
}
for (const a of ['start', 'checkin', 'answer', 'hint']) R('POST', 'team/' + a, (req, b) => teamAction(a, req, b));

/* ---------- animator ---------- */
async function animatorPoints(req) {
  if (isAdmin(req)) return points().filter(p => p.category === 'obslugiwany').map(p => p.id);
  const pin = String(req.headers['x-animator-pin'] || '');
  if (!pin) return null;
  if (await rateLimited('pin', 40, 600)) return null;
  const ids = Object.entries(GAME.animators || {}).filter(([, v]) => safeEq(v, pin)).map(([id]) => id);
  return ids.length ? ids : null;
}
const animTasks = p => (p.tasks || []).filter(t => t.kind === 'animator');
R('GET', 'animator/state', async req => {
  const ids = await animatorPoints(req);
  if (!ids) throw new GsError('Zły PIN animatora.', 401);
  const pts = points().filter(p => ids.includes(p.id)).map(p => {
    const at = animTasks(p);
    return { id: p.id, name: p.name, max: at.reduce((s, t) => s + (parseInt(t.points, 10) || 0), 0), tasks: at.map(t => ({ title: t.title, text: t.text, points: parseInt(t.points, 10) || 0 })) };
  });
  const tl = (await teams()).filter(t => !t.hidden).map(t => {
    const sc = {}; for (const id of ids) if (t.animator[id]) sc[id] = t.animator[id];
    return { id: t.id, name: t.name, members: t.members.length, started: !!t.startedAt, scores: sc };
  }).sort((a, b) => (a.name < b.name ? -1 : 1));
  return { points: pts, teams: tl };
});
R('POST', 'animator/score', async (req, b) => {
  const ids = await animatorPoints(req);
  if (!ids) throw new GsError('Zły PIN animatora.', 401);
  const pid = str(b, 'pointId', 40);
  if (!ids.includes(pid)) throw new GsError('Ten PIN nie obsługuje tego punktu.', 403);
  const p = point(pid); const max = animTasks(p).reduce((s, t) => s + (parseInt(t.points, 10) || 0), 0);
  const pts = b.points !== undefined && b.points !== '' && isFinite(+b.points) ? Math.round(+b.points) : -1;
  if (pts < 0 || pts > max) throw new GsError(`Punkty muszą być w zakresie 0–${max}.`);
  const by = isAdmin(req) ? 'admin' : 'animator';
  const res = await mutateTeam(str(b, 'teamId', 20), t => {
    if (!t.startedAt) t.startedAt = nowIso();
    t.animator[pid] = { points: pts, note: str(b, 'note', 200), at: nowIso(), by };
    if (!t.checkins[pid]) t.checkins[pid] = { at: nowIso(), method: 'animator' };
    return t;
  });
  log('animator', res.id, { point: pid, pts });
  return { ok: true };
});

/* ---------- organizator ---------- */
function requireAdmin(req) { if (!isAdmin(req)) throw new GsError('Złe hasło organizatora.', 401); }
R('GET', 'admin/state', async req => {
  requireAdmin(req);
  const list = await teams();
  const todo = [];
  for (const p of points()) for (const t of (p.tasks || [])) if (t.todo || (t.answers || []).includes('__UZUPELNIJ__')) todo.push(p.name + ': ' + t.title);
  const tv = list.map(t => ({ id: t.id, name: t.name, captain: t.captain, contact: t.contact, school: t.school || '', members: t.members, createdAt: t.createdAt, startedAt: t.startedAt, finishedAt: t.finishedAt, hidden: !!t.hidden, score: score(t), progress: progress(t), checkins: t.checkins, tasks: t.tasks, animator: t.animator, adjustments: t.adjustments }));
  const lg = ((await rpc('gs_log_list', { lim: 200 })) || []).map(l => ({ at: new Date(l.at).toISOString().replace(/\.\d{3}Z$/, 'Z'), type: l.type, teamId: l.team_id, info: l.info }));
  const s = Object.assign({}, S()); s.registrationCode = String(S('registrationCode', ''));
  return { settings: s, ranking: ranking(list), todo, teams: tv, points: points().map(p => ({ id: p.id, name: p.name, category: p.category })), log: lg };
});
R('GET', 'admin/game', async req => { requireAdmin(req); return GAME; });
R('POST', 'admin/game', async (req, g) => {
  requireAdmin(req);
  if (!isObj(g) || !g.settings || !Array.isArray(g.points)) throw new GsError('Brak pól settings lub points.');
  const ids = new Set();
  for (const p of g.points) {
    if (!p.id || ids.has(p.id)) throw new GsError('Zduplikowane lub puste id punktu: ' + (p.id || ''));
    ids.add(p.id);
    if (!isFinite(parseFloat(p.lat)) || !isFinite(parseFloat(p.lng))) throw new GsError(`Punkt ${p.id}: brak współrzędnych.`);
    for (const t of (p.tasks || [])) { if (!t.id || ids.has(t.id)) throw new GsError('Zduplikowane lub puste id zadania: ' + (t.id || '')); ids.add(t.id); }
  }
  await saveGame(g);
  for (const t of await teams()) await mutateTeam(t.id, x => x).catch(() => {});
  return { ok: true };
});
R('POST', 'admin/settings', async (req, b) => {
  requireAdmin(req);
  const g = JSON.parse(JSON.stringify(GAME));
  for (const k of ['mode', 'registrationOpen', 'gameOpen', 'gameStartsAt', 'gameEndsAt', 'teamTimeLimitMin', 'requiredSelfPoints', 'registrationCode', 'testMode']) if (k in b) g.settings[k] = b[k];
  if (!['event', 'solo'].includes(g.settings.mode)) g.settings.mode = 'event';
  await saveGame(g);
  return { ok: true };
});
async function adminTeam(req, b, id, op) {
  requireAdmin(req);
  if (op === 'delete') {
    const t = await team(id); if (!t) throw new GsError('Nie ma takiej drużyny.', 404);
    await rpc('gs_team_delete', { tid: id }); log('delete', id, t.name); return { ok: true };
  }
  await mutateTeam(id, t => {
    switch (op) {
      case 'adjust':
        if (b.delta === undefined || b.delta === '' || !isFinite(+b.delta)) throw new GsError('Zła liczba');
        t.adjustments.push({ delta: Math.round(+b.delta), reason: str(b, 'reason', 200), at: nowIso() }); break;
      case 'checkin': { const p = point(str(b, 'pointId', 40)); if (!p) throw new GsError('Brak punktu', 404); t.checkins[p.id] = { at: nowIso(), method: 'admin' }; break; }
      case 'resettask': delete t.tasks[str(b, 'taskId', 60)]; break;
      case 'hide': t.hidden = !t.hidden; break;
      case 'password': {
        const pw = typeof b.password === 'string' ? b.password : '';
        if (pw.length < 4) throw new GsError('Min. 4 znaki');
        t.passHash = hashPassword(pw); t.tokens = []; break;
      }
    }
    return t;
  });
  log('admin-' + op, id, op === 'password' ? '' : b);
  return { ok: true };
}
async function exportCsv(req, res) {
  requireAdmin(req);
  const list = await teams(); const rank = ranking(list); const pos = {};
  rank.forEach((r, i) => { pos[r.id] = i + 1; });
  const head = ['miejsce', 'druzyna', 'punkty', 'ukonczona', 'czas_min', 'kapitan', 'kontakt', 'szkola', 'liczba_osob', 'sklad', 'start', 'meta', ...points().map(p => 'pkt_' + p.id)];
  const rows = list.map(t => [pos[t.id] || '', t.name, score(t), t.finishedAt ? 'tak' : 'nie', t.finishedAt && t.startedAt ? Math.round((ts(t.finishedAt) - ts(t.startedAt)) / 60) : '', t.captain, t.contact, t.school || '', t.members.length, t.members.join(', '), t.startedAt || '', t.finishedAt || '',
    ...points().map(p => (pointDone(t, p) ? 'zaliczony' : t.checkins[p.id] ? 'odwiedzony' : ''))]);
  rows.sort((a, b) => (a[0] === '' ? 1e9 : a[0]) - (b[0] === '' ? 1e9 : b[0]));
  const cell = v => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = '﻿' + [head, ...rows].map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wyniki-gry-staszic.csv"');
  res.setHeader('Cache-Control', 'no-store');
  res.end(csv);
}

async function readBody(req) {
  if (req.body !== undefined) { if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } } return isObj(req.body) ? req.body : {}; }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return {}; }
}

module.exports = async (req, res) => {
  TEAMS_CACHE = null; LOGQ.length = 0;
  IP = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
  const send = (code, data) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.end(JSON.stringify(data)); };
  try {
    if (!SB_URL || !SB_KEY || !GS_SECRET) throw new GsError('Brak konfiguracji serwera (zmienne środowiskowe).', 500);
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
    const b = req.method === 'POST' ? await readBody(req) : {};
    await loadGame();
    let out;
    const m = /^admin\/team\/([a-f0-9]+)\/(adjust|checkin|resettask|hide|password|delete)$/.exec(path);
    if (req.method === 'POST' && m) out = await adminTeam(req, b, m[1], m[2]);
    else if (req.method === 'GET' && path === 'admin/export') { await exportCsv(req, res); await Promise.all(LOGQ); return; }
    else {
      const fn = routes[req.method + ' ' + path];
      if (!fn) throw new GsError('Nie znaleziono.', 404);
      out = await fn(req, b);
    }
    await Promise.all(LOGQ);
    send(200, out);
  } catch (e) {
    await Promise.all(LOGQ);
    if (e instanceof GsError) send(e.status, Object.assign({ error: e.message }, e.extra || {}));
    else { console.error(e); send(500, { error: 'Błąd serwera.' }); }
  }
};
