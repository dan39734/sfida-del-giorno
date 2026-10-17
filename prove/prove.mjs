// Prove automatiche di Sfida su un emulatore Android (GitHub Actions).
// Uso: node prove/prove.mjs <file.apk> [--atteso prove/atteso-difettoso.json]
// Parla con l'app in due modi: `adb` per installare, avviare, chiudere e leggere lo stato di Android;
// il protocollo DevTools di Chrome (la stessa porta che usa Chrome per ispezionare le pagine) per leggere
// la pagina dentro la WebView ed eseguire JavaScript nell'app. L'APK di debug ha la WebView ispezionabile.
// Scrive il rapporto ✅/❌/⚠️ nel riepilogo dell'esecuzione ($GITHUB_STEP_SUMMARY) e in prove/rapporto.json.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const PKG = 'io.github.dan39734.sfidadelgiorno';
const ACT = PKG + '/.MainActivity';
const KEY = 'sfida-del-giorno-v1';
const PORT = 9222;

const apk = process.argv[2];
if (!apk) { console.error('Uso: node prove/prove.mjs <file.apk> [--atteso file.json]'); process.exit(2); }
const iAtt = process.argv.indexOf('--atteso');
const atteso = iAtt > 0 ? JSON.parse(readFileSync(process.argv[iAtt + 1], 'utf8')) : null;

// ---------- utilità ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sh(cmd, args, opt = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opt });
  if (r.error) throw r.error;
  return { out: (r.stdout || '').replace(/\r/g, ''), err: (r.stderr || '').replace(/\r/g, ''), code: r.status };
}
const adb = (...a) => sh('adb', a).out;
const adbShell = (c) => sh('adb', ['shell', c]).out.trim();

const risultati = []; // {nome, esito: 'ok'|'ko'|'na', nota}
function segna(nome, esito, nota = '') {
  risultati.push({ nome, esito, nota });
  const ico = { ok: '✅', ko: '❌', na: '⚠️' }[esito];
  console.log(`${ico} ${nome}${nota ? ' — ' + nota : ''}`);
}
async function prova(nome, fn) {
  try {
    const nota = await fn();
    segna(nome, 'ok', typeof nota === 'string' ? nota : '');
  } catch (e) {
    const msg = String((e && e.message) || e);
    segna(nome, msg.startsWith('N/A:') ? 'na' : 'ko', msg.replace(/^N\/A:\s*/, ''));
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

// ---------- Android ----------
function pid() { const p = adbShell(`pidof ${PKG}`); return p ? Number(p.split(/\s+/)[0]) : 0; }
function attivitaInPrimoPiano() {
  const o = adbShell('dumpsys activity activities');
  const m = o.match(/(?:topResumedActivity|mResumedActivity|ResumedActivity)[^\n]*?\s([\w.]+\/[\w.$]+)/);
  return m ? m[1] : '';
}
async function avvia() {
  adbShell(`am start -W -n ${ACT}`);
  for (let i = 0; i < 30; i++) { if (pid()) break; await sleep(500); }
  assert(pid(), "l'app non è partita (nessun processo)");
  await sleep(3000); // tempo alla WebView di caricare la pagina
}
function chiudi() { adbShell(`am force-stop ${PKG}`); }
function crashNelLog() {
  const log = adb('logcat', '-d', '-v', 'brief');
  const righe = log.split('\n').filter((r) => /FATAL EXCEPTION|Force finishing activity|ANR in/.test(r) && r.includes(PKG));
  return righe.slice(0, 3).join(' | ');
}

// ---------- DevTools della WebView ----------
let ws = null, seq = 0;
const attese = new Map();
async function collega() {
  if (ws) { try { ws.close(); } catch {} ws = null; }
  const p = pid(); assert(p, 'app non in esecuzione');
  // il socket della WebView ispezionabile si chiama webview_devtools_remote_<pid>
  let sock = '';
  for (let i = 0; i < 20 && !sock; i++) {
    const unix = adbShell('cat /proc/net/unix');
    const m = unix.match(new RegExp(`@(webview_devtools_remote_${p})\\b`)) || unix.match(/@(webview_devtools_remote_\d+)\b/);
    if (m) sock = m[1]; else await sleep(500);
  }
  assert(sock, 'N/A: la WebView non espone DevTools (APK non di debug?)');
  adb('forward', `tcp:${PORT}`, `localabstract:${sock}`);
  let pagine = [];
  for (let i = 0; i < 20; i++) {
    try { pagine = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { pagine = []; }
    pagine = pagine.filter((x) => x.type === 'page' && /localhost/.test(x.url || ''));
    if (pagine.length) break;
    await sleep(500);
  }
  assert(pagine.length, "nessuna pagina dell'app trovata via DevTools");
  ws = new WebSocket(pagine[0].webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('WebSocket DevTools non raggiungibile')); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && attese.has(m.id)) { attese.get(m.id)(m); attese.delete(m.id); }
  };
  await cdp('Runtime.enable', {});
}
function cdp(method, params) {
  const id = ++seq;
  return new Promise((ok, no) => {
    attese.set(id, (m) => (m.error ? no(new Error(m.error.message)) : ok(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (attese.has(id)) { attese.delete(id); no(new Error('DevTools: nessuna risposta a ' + method)); } }, 15000);
  });
}
// Esegue JavaScript dentro l'app e restituisce il valore (anche di una Promise).
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
const oggi = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const stato = () => js(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || '{}')`);
const visibile = (id) => js(`(function(){var e=document.getElementById(${JSON.stringify(id)});return !!(e&&!e.hidden&&e.offsetParent!==null&&getComputedStyle(e).visibility!=='hidden')})()`);
const fatta = () => js("document.getElementById('card').classList.contains('is-done')");
const serie = () => js("document.querySelector('#vStreak span:last-child').textContent.trim()");

// ---------- le prove ----------
async function tutte() {
  console.log(`Emulatore: Android ${adbShell('getprop ro.build.version.release')} (API ${adbShell('getprop ro.build.version.sdk')}), data ${adbShell('date +%F')}`);
  adb('logcat', '-c');

  await prova("Installazione dell'APK", async () => {
    const r = sh('adb', ['install', '-r', apk]);
    assert(r.code === 0 && /Success/.test(r.out + r.err), (r.out + r.err).trim().split('\n').pop());
    adbShell(`pm clear ${PKG}`); // parte da zero, come al primo avvio
  });

  await prova("L'app si apre senza crash", async () => {
    await avvia();
    const c = crashNelLog(); assert(!c, 'crash nel log: ' + c);
    const top = attivitaInPrimoPiano();
    assert(top.startsWith(PKG), "in primo piano c'è " + (top || 'altro'));
  });

  await prova('Compare la sfida del giorno', async () => {
    await collega();
    const testo = await js("document.getElementById('text').textContent.trim()");
    assert(testo && testo !== '—', 'testo della sfida vuoto');
    assert(await visibile('btnDone'), 'il pulsante Fatto non è visibile');
    assert(!(await fatta()), 'la sfida risulta già fatta al primo avvio');
    return '«' + testo.slice(0, 60) + (testo.length > 60 ? '…' : '') + '»';
  });

  await prova('Si può completare (Fatto)', async () => {
    await js("document.getElementById('btnDone').click()");
    await sleep(800);
    assert(await fatta(), 'la carta non è passata a «fatta»');
    assert(!(await visibile('btnDone')), 'il pulsante Fatto è ancora visibile');
    const s1 = await serie();
    assert(s1 === '1', 'serie mostrata: ' + s1 + ' (attesa 1)');
    const s = await stato();
    assert(s.done && s.done[oggi()], 'il giorno di oggi non è salvato in localStorage');
    return 'serie 1, salvato ' + oggi();
  });

  await prova('Il progresso resta dopo chiusura e riapertura', async () => {
    chiudi(); await sleep(1500);
    assert(!pid(), "l'app non si è chiusa");
    await avvia(); await collega();
    const s = await stato();
    assert(s.done && s.done[oggi()], 'dopo la riapertura il giorno fatto è sparito');
    assert(await fatta(), 'dopo la riapertura la carta non è «fatta»');
    const s1 = await serie();
    assert(s1 === '1', 'serie dopo la riapertura: ' + s1);
    const c = crashNelLog(); assert(!c, 'crash nel log: ' + c);
  });

  // ----- promemoria -----
  await prova('Nel pacchetto NON c\'è SCHEDULE_EXACT_ALARM', async () => {
    // "requested permissions" = i permessi dichiarati nel manifest del pacchetto installato
    const o = adbShell(`dumpsys package ${PKG}`);
    const blocco = (o.split(/requested permissions:/i)[1] || '').split(/\n\s*\n|install permissions:|runtime permissions:/i)[0];
    const perms = [...blocco.matchAll(/android\.permission\.[A-Z_]+/g)].map((m) => m[0]);
    assert(perms.length, 'N/A: elenco dei permessi non leggibile da dumpsys');
    const esatti = perms.filter((p) => /SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM/.test(p));
    assert(!esatti.length, 'trovato ' + esatti.join(', '));
    assert(perms.includes('android.permission.POST_NOTIFICATIONS'), 'manca POST_NOTIFICATIONS');
    return perms.map((p) => p.replace('android.permission.', '')).join(', ');
  });

  await prova('Il promemoria si attiva e chiede il permesso notifiche', async () => {
    assert(await visibile('remind'), 'il riquadro del promemoria non è visibile (plugin notifiche assente?)');
    assert(!(await js("document.getElementById('remindOn').checked")), 'il promemoria risulta già attivo');
    await js("document.getElementById('remindOn').click()");
    // la finestra di Android «Consentire a Sfida di inviare notifiche?» ha il pulsante permission_allow_button
    let bottone = null;
    for (let i = 0; i < 20 && !bottone; i++) {
      await sleep(500);
      bottone = pulsanteSulloSchermo('permission_allow_button');
    }
    assert(bottone, 'la finestra del permesso notifiche non è comparsa');
    adbShell(`input tap ${bottone.x} ${bottone.y}`);
    await sleep(2000);
    assert(await js("document.getElementById('remindOn').checked"), 'dopo il permesso l\'interruttore non è acceso');
    const ns = await js("JSON.parse(localStorage.getItem('sfida-notif') || '{}')");
    assert(ns.on === true, 'impostazione non salvata: ' + JSON.stringify(ns));
    const grant = adbShell(`dumpsys package ${PKG}`).match(/POST_NOTIFICATIONS: granted=(\w+)/);
    assert(grant && grant[1] === 'true', 'Android non risulta aver concesso POST_NOTIFICATIONS');
    return 'ora ' + ns.t;
  });

  await prova('La notifica viene programmata', async () => {
    let pend = null;
    for (let i = 0; i < 10 && !(pend && pend.length); i++) {
      await sleep(1000);
      pend = await js("window.Capacitor.Plugins.LocalNotifications.getPending().then(function(r){return (r&&r.notifications)||[]})");
    }
    assert(pend && pend.length, 'il plugin non ha notifiche in sospeso');
    const ids = pend.map((n) => n.id);
    assert(ids.every((id) => id >= 1001 && id < 1001 + 28), 'id inattesi: ' + ids.slice(0, 5).join(','));
    const prima = pend.map((n) => n.schedule && n.schedule.at).filter(Boolean).sort()[0];
    const alarm = adbShell('dumpsys alarm');
    assert(alarm.includes(PKG), 'nessuna sveglia di Sfida in dumpsys alarm');
    return pend.length + ' notifiche in sospeso' + (prima ? ', la prima il ' + String(prima).slice(0, 16) : '');
  });

  await prova('Non si apre la schermata «Sveglie e promemoria»', async () => {
    await sleep(1500);
    const top = attivitaInPrimoPiano();
    assert(!/AlarmsAndReminders|ScheduleExactAlarm/i.test(top), 'in primo piano: ' + top);
    assert(top.startsWith(PKG), "in primo piano c'è " + (top || 'altro') + ' invece di Sfida');
    const log = adb('logcat', '-d');
    const m = log.split('\n').find((r) => /REQUEST_SCHEDULE_EXACT_ALARM|AlarmsAndRemindersActivity/.test(r));
    assert(!m, 'nel log: ' + m);
    const c = crashNelLog(); assert(!c, 'crash nel log: ' + c);
  });
}

// Cerca sullo schermo di Android (fuori dalla WebView) un elemento per resource-id e ne restituisce il centro.
function pulsanteSulloSchermo(idParziale) {
  const xml = sh('adb', ['exec-out', 'uiautomator', 'dump', '/dev/tty']).out;
  const re = new RegExp(`<node[^>]*resource-id="[^"]*${idParziale}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return null;
  return { x: Math.round((+m[1] + +m[3]) / 2), y: Math.round((+m[2] + +m[4]) / 2) };
}

// ---------- rapporto ----------
function rapporto(titolo) {
  const ico = { ok: '✅', ko: '❌', na: '⚠️' };
  let md = `### ${titolo}\n\n| Esito | Prova | Note |\n|---|---|---|\n`;
  for (const r of risultati) md += `| ${ico[r.esito]} | ${r.nome} | ${r.nota.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |\n`;
  const n = (e) => risultati.filter((r) => r.esito === e).length;
  md += `\n**${n('ok')} superate, ${n('ko')} fallite, ${n('na')} non eseguibili.**\n\n`;
  return md;
}

try {
  await tutte();
} catch (e) {
  segna('Esecuzione delle prove', 'na', 'interrotta: ' + ((e && e.message) || e));
} finally {
  if (ws) { try { ws.close(); } catch {} }
  try { writeFileSync('prove/logcat.txt', adb('logcat', '-d')); } catch {}
}

const nomeApk = apk.split(/[\\/]/).pop();
let titolo = 'Prove su emulatore: ' + nomeApk;
let fallito;
if (!atteso) {
  fallito = risultati.some((r) => r.esito === 'ko');
} else {
  // Prova di controllo: l'APK difettoso deve essere bocciato esattamente dove previsto.
  titolo = 'Prova di controllo (APK con difetto noto): ' + nomeApk;
  const diff = [];
  for (const [nome, e] of Object.entries(atteso)) {
    if (nome.startsWith('_')) continue;
    const r = risultati.find((x) => x.nome === nome);
    if (!r) diff.push(`«${nome}»: prova non eseguita`);
    else if (r.esito !== e) diff.push(`«${nome}»: atteso ${e}, ottenuto ${r.esito}`);
  }
  segna('Le prove segnalano il difetto come previsto', diff.length ? 'ko' : 'ok', diff.join('; '));
  fallito = diff.length > 0;
}
const md = rapporto(titolo);
console.log('\n' + md);
writeFileSync('prove/rapporto.json', JSON.stringify(risultati, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
process.exit(fallito ? 1 : 0);
