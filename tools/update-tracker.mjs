#!/usr/bin/env node
/**
 * Reads the current position of a rider from the official TCR live tracker
 * (followmychallenge.com) and appends a new entry to ../data.json.
 *
 * Data source: `window.ridersArray`, an internal JS object the tracker's own
 * app code keeps in sync with its live-position polling. Not a documented
 * public API — found by inspecting the loaded page on 2026-07-20, may break
 * if the site changes. We reach it with a real Chromium tab (Playwright) so
 * Cloudflare's JS challenge is solved the same way a normal browser solves
 * it, then read the object straight out of the page's own runtime — no
 * network payloads to parse.
 *
 * Usage:
 *   node update-tracker.mjs                 # dry run, prints the entry, writes data.json locally
 *   node update-tracker.mjs --commit         # also `git commit` the change
 *   node update-tracker.mjs --commit --push  # also `git push`
 *   node update-tracker.mjs --headed         # show the browser (debugging)
 *   node update-tracker.mjs --dump=rider.json  # dump the raw ridersArray entry for inspection
 *   node update-tracker.mjs --backfill       # rebuild the elevation profile from the archived track (no browser)
 *   node update-tracker.mjs --backfill --force   # ... from scratch, e.g. after changing the routing profile
 *   node update-tracker.mjs --places         # re-resolve place names of existing entries (no browser)
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runChecks } from './check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_JSON_PATH = path.join(REPO_ROOT, 'data.json');
const TRACK_JSON_PATH = path.join(REPO_ROOT, 'track.json');
const PROFILE_JSON_PATH = path.join(REPO_ROOT, 'profile.json');

const CONFIG = {
  trackerUrl: 'https://www.followmychallenge.com/live/tcrno12/',
  // Exact name as shown on the tracker (leaderboard / rider list).
  riderName: 'Manuel Kaufer',
  // Skip writing a new entry if the distance barely moved since the last one.
  minKmDelta: 1,
  /* BRouter-Profil. Seit die echte Spur bekannt ist, füllt es nur noch die
     Lücken zwischen gemessenen Punkten im Abstand von ~1,6 km — die Wahl
     wiegt also viel weniger schwer als früher, wo sie 30-km-Lücken zu raten
     hatte. Damals gemessen (2026-07-20): `trekking` traf Manuels Erwartung
     bis Flåm auf 6 % genau, `fastbike` lag 58 % darüber, weil es im
     Gudbrandsdal die andere, hügeligere Talseite nimmt.
     Nach einer Änderung `--backfill --force` laufen lassen. */
  routeProfile: 'trekking',
  // Wegpunkte je BRouter-Anfrage. 10 Spurpunkte sind bei ~5 Minuten Abstand
  // knapp eine Stunde Fahrt — fein genug, um Höhenmeter zeitlich einzelnen
  // Meldungen zuzuordnen, und grob genug, dass ein Lauf ein bis zwei
  // Anfragen braucht statt zwanzig.
  waypointsPerRequest: 10,
  // Spurpunkte, die weniger als das vom Vorgänger entfernt sind, fliegen
  // raus: steht der Fahrer, liefert der Tracker Dutzende Punkte auf demselben
  // Fleck, und BRouter kann zwischen identischen Koordinaten nicht routen.
  // (60 / 150 / 300 m getestet — auf die Gesamtlänge wirkt sich das kaum aus,
  // die Spurpunkte liegen ohnehin im Median 1,6 km auseinander. Also der
  // kleinste Wert, der seinen Zweck erfüllt, und maximale Spurtreue.)
  minTrackPointMeters: 60,
  // Stützpunkt-Abstand der gespeicherten Höhenlinie.
  profileSampleMeters: 500,
  // Pause zwischen BRouter-Anfragen — öffentlicher Gratis-Dienst.
  brouterDelayMs: 1200,
  /* Der Abruf hängt an einer fremden Seite hinter Cloudflare; dass er mal
     nicht durchkommt, ist Betriebsrisiko, kein Fehler. Am 21.07.2026 lief
     `page.goto` in seinen Timeout und der 17:06-Lauf fiel komplett aus —
     eine Stunde ohne frischen Live-Stand im Board, obwohl der nächste
     Versuch 20 Sekunden später geklappt hätte. Also mehrere Anläufe mit
     jeweils frischem Browser. */
  abrufVersuche: 3,
  abrufPauseMs: 20000,
  // Zeit fürs Laden der Tracker-Seite. Cloudflare-Prüfung plus ein träger
  // Server brauchen gelegentlich mehr als die ursprünglichen 45 s.
  gotoTimeoutMs: 60000,
  /* Ab welchem Alter des Live-Stands ein geplanter Lauf (`--scheduled`)
     tatsächlich arbeitet. Der launchd-Job tickt seit 21.07.2026 alle 15
     Minuten, startet aber nur einen Browser, wenn wirklich etwas fällig ist
     — sonst endet der Lauf nach Millisekunden.
     Der Sinn: scheitert ein Lauf, bleibt der Live-Stand alt, und schon der
     nächste Tick versucht es erneut. Aus „eine Stunde tot“ wird „höchstens
     eine Viertelstunde“, ohne dass jeder Tick einen Chromium startet.

     Seit 22.07.2026 25 statt 50 Minuten. 50 hieß in der Praxis ein Abruf pro
     Stunde, und damit konnte das Board der offiziellen Seite fast eine
     Stunde hinterherhinken: an dem Morgen kam Manuel um 06:31 aus dem
     Funkloch am Aurlandsfjellet zurück, der letzte Abruf lag bei 06:16, der
     nächste wäre erst 07:16 fällig gewesen — 45 Minuten, in denen die Seite
     ihn fahren sah und das Board ihn stehen ließ. 25 min heißt zwei echte
     Läufe je Stunde (Tick :00 überspringt, :15 überspringt, :30 arbeitet),
     also ~48 statt ~24 am Tag: doppelt so viele Chromium-Starts und
     Cloudflare-Passagen, aber höchstens eine halbe Stunde Rückstand.
     Weiter runter lohnt nicht — der Tracker selbst meldet nur alle ~5 min,
     und die Spur kommt ohnehin komplett per GPX-Export nach. */
  laufFaelligNachMin: 25,
};

const args = process.argv.slice(2);
const FLAGS = {
  commit: args.includes('--commit'),
  push: args.includes('--push'),
  headed: args.includes('--headed'),
  backfill: args.includes('--backfill'),
  places: args.includes('--places'),
  fixts: args.includes('--fixts'),
  /* Setzt nur der launchd-Job. Von Hand gestartete Läufe sollen immer sofort
     arbeiten — wer selbst tippt, will jetzt ein Ergebnis und nicht „ist noch
     frisch genug“ lesen. */
  scheduled: args.includes('--scheduled'),
  dump: (args.find(a => a.startsWith('--dump=')) || '').split('=')[1] || null,
};

function log(...a) { console.log('[tcr84]', ...a); }

// data.json stores timestamps as local wall-clock time with no timezone
// suffix (matching index.html's own setNow(), which does the same offset
// trick for the manual-entry form) — `new Date(ts)` in the browser then
// parses it as local time. A real UTC ISO string here would silently read
// as local time too and be off by the timezone offset.
function localIsoNoTZ(d = new Date()) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function waitForAppReady(page, timeoutMs = 40000) {
  const start = Date.now();
  let lastTitle = '';
  while (Date.now() - start < timeoutMs) {
    lastTitle = await page.title().catch(() => '');
    if (/TCRNo12|Transcontinental/i.test(lastTitle)) return lastTitle;
    await page.waitForTimeout(1000);
  }
  return lastTitle; // whatever we last saw, so the caller can log it
}

/* zoom=14, nicht 12: Stufe 12 ist bei Nominatim die Gemeindeebene, und
 * norwegische Kommunen sind riesig — Nord-Fron misst rund 1.100 km². Drei
 * aufeinanderfolgende Meldungen über 44 km Fahrt bekamen dadurch alle denselben
 * Ortsnamen und das Log sah aus, als stünde er seit Stunden still.
 *
 * `name` steht in der Kette VOR der Gemeinde, aber hinter allen echten
 * Siedlungsfeldern: auf Stufe 14 ist `name` ein lokaler Flur-/Hofname
 * (Vollsætra, Myreng) — nicht jedem ein Begriff, aber ein echter Punkt auf der
 * Karte statt eines Landkreises. Auf Stufe 16 wäre `name` dagegen meist der
 * Straßenname (Skåbuvegen), das ist als Ortsangabe unbrauchbar. Bleibt alles
 * leer, ist es wirklich Niemandsland — dann ist die Gemeinde die ehrliche
 * Antwort und darf sich auch wiederholen. */
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&accept-language=de`;
    const res = await fetch(url, { headers: { 'User-Agent': 'tcr84-tracker-updater (personal dotwatch board, github.com/digitalerdude/tcr84)' } });
    if (!res.ok) return '';
    const data = await res.json();
    const a = data.address || {};
    return a.village || a.hamlet || a.town || a.city || a.suburb || data.name ||
           a.municipality || a.county || '';
  } catch {
    return '';
  }
}

/* ---------- Höhe & Höhenmeter ----------------------------------------
 * Gerechnet wird entlang der ECHTEN gefahrenen Spur (track.json, aus dem
 * GPX-Export des Trackers, ~1 Punkt alle 5 Minuten). BRouter bekommt diese
 * Punkte als Wegpunktkette und füllt nur die Lücken dazwischen mit dem
 * Straßennetz auf; die Höhenmeter kommen aus seiner entrauschten Summe
 * (`filtered ascend`). Ergebnis landet in profile.json.
 *
 * Zwei verworfene Ansätze, damit sie niemand zurückholt:
 *
 * 1. OSRM + punktweise DEM-Abfrage (2026-07-20). Der öffentliche OSRM-Demo
 *    routet nur mit Auto-Profil, und das Aufsummieren roher DEM-Werte alle
 *    ~230 m erzeugt Artefakte: im Testsegment sprang das Gelände um 190 m
 *    auf 500 m Strecke (38 % Steigung, unmöglich für eine Straße), weil die
 *    geratene Route eine Hangflanke streift. 423 statt 103 hm. Filter von
 *    Hand brachten nur ~8 %.
 * 2. BRouter nur zwischen unseren eigenen Meldungen (2026-07-20). Lag 19 %
 *    zu hoch (372 statt 301 hm auf demselben Stück), weil zwischen zwei
 *    Meldungen 30 km Route geraten werden mussten. Genau das erledigt die
 *    echte Spur.
 *
 * Die rohe GPS-Höhe aus dem GPX ist KEINE Alternative: sie streut mit ~20 m
 * und ergäbe über die ersten 405 km 3.379 statt der gerechneten ~3.540 —
 * zufällig ähnlich, aber aus lauter Messrauschen zusammengesetzt.
 */
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: { 'User-Agent': 'tcr84-tracker-updater (personal dotwatch board, github.com/digitalerdude/tcr84)' },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Höhe einzelner Punkte aus dem DEM (Copernicus, ~90 m). Nur noch zum
// Nachtragen von `ele` bei Altmeldungen, nicht mehr für Höhenmeter.
async function demElevation(points) {
  if (!points.length) return [];
  const lat = points.map(p => p[0]).join(',');
  const lon = points.map(p => p[1]).join(',');
  const data = await fetchJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
  return data.elevation;
}

const EARTH_R = 6371000;
const toRad = d => d * Math.PI / 180;
function haversine(a, b) {
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(x));
}

/* Radroute DURCH eine Folge von Wegpunkten (nicht nur zwischen zweien) —
   BRouter nimmt beliebig viele `lonlats`, durch die Trennung mit `|`.
   Genau das macht die echte Spur nutzbar: die Route wird alle ~1,6 km an
   einem gemessenen GPS-Punkt festgenagelt, dazwischen füllt BRouter mit
   dem Straßennetz auf. Die GeoJSON-Koordinaten sind [lon, lat, ele]. */
async function brouterRoute(points) {
  const ll = points.map(p => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join('|');
  const url = `https://brouter.de/brouter?lonlats=${ll}` +
              `&profile=${CONFIG.routeProfile}&alternativeidx=0&format=geojson`;
  const data = await fetchJson(url);
  const f = data.features && data.features[0];
  if (!f || !f.geometry || !Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) return null;
  const p = f.properties || {};
  const up = Number(p['filtered ascend']);      // bereits entrauscht, siehe oben
  const net = Number(p['plain-ascend']);        // Netto-Höhendifferenz, kann negativ sein
  const len = Number(p['track-length']);
  if (!isFinite(up) || !isFinite(net) || !isFinite(len)) return null;
  /* `down` kann rechnerisch knapp negativ werden: `filtered ascend` ist
     entrauscht, `plain-ascend` nicht, und auf einem durchgehend steigenden
     Block liegt die entrauschte Summe manchmal 1 hm unter der Netto-Differenz.
     Bergab-Höhenmeter unter null gibt es aber nicht, und aufaddiert ließe das
     die kumulierte Reihe in profile.json fallen (2× passiert bis 21.07.2026,
     von check.mjs gefunden). */
  return { coords: f.geometry.coordinates, up: Math.round(up), down: Math.max(0, Math.round(up - net)), km: len / 1000 };
}

// Ein Block, mit einem Rettungsversuch: schlägt BRouter für die ganze
// Wegpunktkette fehl (kommt vor, wenn ein GPS-Punkt weit abseits jeder
// Straße liegt), wird sie einmal halbiert.
async function routeChunk(points, depth = 0) {
  try {
    const r = await brouterRoute(points);
    if (r) return [r];
  } catch (e) {
    log(`  BRouter-Block (${points.length} Wegpunkte) fehlgeschlagen: ${e.message}`);
  }
  if (depth >= 1 || points.length < 4) return null;
  const mid = Math.floor(points.length / 2);
  await new Promise(r => setTimeout(r, CONFIG.brouterDelayMs));
  const a = await routeChunk(points.slice(0, mid + 1), depth + 1);
  await new Promise(r => setTimeout(r, CONFIG.brouterDelayMs));
  const b = await routeChunk(points.slice(mid), depth + 1);
  return (a && b) ? [...a, ...b] : null;
}

/* Höhenlinie eines Blocks auf feste Abstände ausdünnen. Gerechnet wird über
   die tatsächliche Punktfolge (Haversine), am Ende auf BRouters
   `track-length` skaliert — die ist genauer als die Summe der Sehnen. */
function sampleCoords(route, kmOffset) {
  const c = route.coords;
  const cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + haversine([c[i - 1][1], c[i - 1][0]], [c[i][1], c[i][0]]));
  const total = cum[cum.length - 1];
  const scale = total > 0 ? (route.km * 1000) / total : 1;
  const out = [];
  let nextAt = 0;
  for (let i = 0; i < c.length; i++) {
    const d = cum[i] * scale;
    if (d >= nextAt || i === c.length - 1) {
      if (typeof c[i][2] === 'number') out.push([Math.round((kmOffset + d / 1000) * 100) / 100, Math.round(c[i][2])]);
      nextAt = d + CONFIG.profileSampleMeters;
    }
  }
  return out;
}

function emptyProfile() {
  return {
    source: `brouter:${CONFIG.routeProfile} entlang der echten GPS-Spur`,
    note: 'points = [routedKm, m]. chunks = [tEnd, kmEnd, cumUp, cumDown] — kumuliert am Blockende, dazwischen linear interpolierbar.',
    updated: null, throughUnix: 0, startUnix: null, anchor: null,
    routedKm: 0, climbUp: 0, climbDown: 0,
    points: [], chunks: [],
  };
}

function loadProfile() {
  try { return JSON.parse(readFileSync(PROFILE_JSON_PATH, 'utf8')); } catch { return null; }
}

/* Baut das Höhenprofil entlang der echten Spur fort — inkrementell, es wird
   pro Lauf nur das neu hinzugekommene Ende geroutet (bei stündlichem Abruf
   also ~12 neue Spurpunkte, ein bis zwei BRouter-Anfragen). Ein kompletter
   Neuaufbau über 4.800 km wäre sonst jede Stunde ein paar hundert Anfragen
   an einen Gratis-Dienst.
   Die Kilometer sind BRouters gerechnete Streckenlänge, nicht die
   Renn-Kilometer des Trackers — das Board skaliert das beim Zeichnen. */
async function updateProfile(trackPoints, { rebuild = false } = {}) {
  const prev = rebuild ? null : loadProfile();
  const prof = (prev && prev.source === emptyProfile().source) ? prev : emptyProfile();
  if (prev && prof !== prev) log('Profil-Quelle hat sich geändert, baue neu auf.');

  // Neue Punkte einsammeln und dabei ausdünnen: steht Manuel, liegen zig
  // Punkte übereinander, und BRouter kann zwischen identischen Koordinaten
  // nicht routen.
  let last = prof.anchor;
  const fresh = [];
  for (const [lat, lon, , t] of trackPoints) {
    if (t <= prof.throughUnix) continue;
    if (last && haversine([lat, lon], [last[0], last[1]]) < CONFIG.minTrackPointMeters) continue;
    fresh.push([lat, lon, t]);
    last = [lat, lon, t];
  }
  if (!fresh.length) return { prof, added: 0, requests: 0 };

  const seq = prof.anchor ? [prof.anchor, ...fresh] : fresh;
  // Startzeit merken: die Blöcke halten nur ihr Ende fest, für die
  // Interpolation vor dem ersten Blockende braucht das Board einen Nullpunkt.
  if (prof.startUnix == null) prof.startUnix = seq[0][2];
  const step = CONFIG.waypointsPerRequest - 1;     // ein Punkt Überlappung an der Naht
  let requests = 0, added = 0;

  for (let i = 0; i + 1 < seq.length; i += step) {
    const chunk = seq.slice(i, i + CONFIG.waypointsPerRequest);
    if (chunk.length < 2) break;
    const routes = await routeChunk(chunk.map(p => [p[0], p[1]]));
    requests++;
    if (!routes) {
      log(`  Block ab ${new Date(chunk[0][2] * 1000).toISOString()} übersprungen (BRouter liefert nichts).`);
    } else {
      for (const r of routes) {
        prof.points.push(...sampleCoords(r, prof.routedKm));
        prof.routedKm = Math.round((prof.routedKm + r.km) * 100) / 100;
        prof.climbUp += r.up;
        prof.climbDown += r.down;
      }
      added += chunk.length - 1;
    }
    // Auch bei übersprungenem Block weiterrücken, sonst hängt der Lauf für
    // immer an derselben kaputten Stelle.
    const end = chunk[chunk.length - 1];
    prof.throughUnix = end[2];
    prof.anchor = end;
    prof.chunks.push([end[2], prof.routedKm, prof.climbUp, prof.climbDown]);
    await new Promise(r => setTimeout(r, CONFIG.brouterDelayMs));
  }

  prof.updated = new Date().toISOString();
  writeFileSync(PROFILE_JSON_PATH, JSON.stringify(prof) + '\n');
  return { prof, added, requests };
}

async function fetchRiderState() {
  // Cloudflare's WAF hard-blocks Playwright's headless mode here (fingerprint-
  // based, not IP-based — confirmed 2026-07-20: headless got "Attention
  // Required", the exact same real window that passes in --headed mode
  // sails through). So we always launch headed and, for unattended runs,
  // just push the window off-screen instead of fighting the fingerprint.
  const browser = await chromium.launch({
    headless: false,
    args: FLAGS.headed ? [] : ['--window-position=2400,2400', '--window-size=1024,768'],
  });
  try {
    const page = await browser.newPage();
    log('opening tracker (passing Cloudflare check)…');
    // Don't wait for networkidle: this site polls continuously in the
    // background (weather widget, update countdown) and network activity
    // never fully quiets down, so networkidle can hang indefinitely.
    await page.goto(CONFIG.trackerUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.gotoTimeoutMs });

    const title = await waitForAppReady(page);
    log('page title after load:', title);
    if (!/TCRNo12|Transcontinental/i.test(title)) {
      const shotPath = FLAGS.dump ? FLAGS.dump.replace(/\.\w+$/, '') + '.png' : 'update-tracker-failure.png';
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
      throw new Error(`app never reached ready state (title: "${title}"). Screenshot saved to ${shotPath}`);
    }

    log(`waiting for live position data on "${CONFIG.riderName}"…`);
    let handle;
    try {
      handle = await page.waitForFunction((riderName) => {
        if (!window.ridersArray) return false;
        const r = Object.values(window.ridersArray).find(x => x.riderName === riderName);
        return (r && typeof r.latitude === 'number') ? r : false;
      }, CONFIG.riderName, { timeout: 45000 });
    } catch {
      const shotPath = FLAGS.dump ? FLAGS.dump.replace(/\.\w+$/, '') + '.png' : 'update-tracker-failure.png';
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
      throw new Error(
        `"${CONFIG.riderName}" never showed up in window.ridersArray within 45s. ` +
        `Screenshot saved to ${shotPath}. Check the name spelling matches the tracker exactly.`
      );
    }
    const rider = await handle.jsonValue();

    /* Die echte gefahrene Spur. Die Tracker-Seite bietet dafür einen
       GPX-Export an (`export/gpx/generate.php?deviceId=…`, gefunden am
       2026-07-20 im nachgeladenen functions.min.js). Er liefert die volle
       Aufzeichnung seit dem Start: Position, Höhe und Zeitstempel je Punkt,
       im Median alle 5 Minuten — also viel feiner als alles, was wir durch
       eigenes Abfragen je bekommen. Muss aus dem geladenen Tab heraus
       geholt werden, direkt gibt Cloudflare auch hier 403. Die beiden
       anderen internen Endpunkte (`get_route.php`,
       `get_historical_waypoint_data.php`) sind hart geblockt. */
    let gpx = null;
    try {
      gpx = await page.evaluate(async (deviceId) => {
        const res = await fetch(`${location.origin}/live/tcrno12/export/gpx/generate.php?deviceId=${deviceId}`);
        return res.ok ? res.text() : null;
      }, rider.deviceId);
    } catch (e) { log('GPX-Export fehlgeschlagen (ignoriert):', e.message); }

    if (FLAGS.dump) {
      writeFileSync(FLAGS.dump, JSON.stringify(rider, null, 2));
      log(`raw rider object dumped to ${FLAGS.dump}`);
    }

    return {
      km: rider.totalDistance,
      lat: rider.latitude,
      lon: rider.longitude,
      rank: rider.position,
      lastReportMins: rider.lastReportMins,
      currentSpeed: rider.currentSpeed,
      // Der Tracker meldet seine GPS-Höhe in `altitude` (das Feld `elevation`
      // daneben steht konstant auf 0 und ist unbrauchbar).
      altitude: (typeof rider.altitude === 'number' && isFinite(rider.altitude)) ? rider.altitude : null,
      deviceId: rider.deviceId,
      gpx,
    };
  } finally {
    await browser.close();
  }
}

/* Mehrere Anläufe, jeder mit frischem Browser — ein hängengebliebener Tab
   oder eine halb durchlaufene Cloudflare-Prüfung lässt sich nicht reparieren,
   nur neu aufsetzen. Scheitern alle, wirft die Funktion den letzten Fehler
   weiter und der Lauf endet wie bisher mit Exit 1.
   Dauerhaft verloren geht dabei ohnehin nichts: der GPX-Export liefert beim
   nächsten erfolgreichen Lauf die volle Spur seit dem Start. Es geht allein
   um den Live-Stand in der Kopfzeile, der sonst eine Stunde stehen bleibt. */
async function fetchRiderStateMitWiederholung() {
  let letzterFehler;
  for (let versuch = 1; versuch <= CONFIG.abrufVersuche; versuch++) {
    try {
      if (versuch > 1) log(`Abruf-Versuch ${versuch} von ${CONFIG.abrufVersuche}…`);
      return await fetchRiderState();
    } catch (e) {
      letzterFehler = e;
      log(`Abruf ${versuch}/${CONFIG.abrufVersuche} fehlgeschlagen: ${String(e.message).split('\n')[0]}`);
      if (versuch < CONFIG.abrufVersuche) {
        await new Promise(r => setTimeout(r, CONFIG.abrufPauseMs));
      }
    }
  }
  throw letzterFehler;
}

/* ---------- Echte Spur archivieren --------------------------------------
 * Der GPX-Export liefert bei jedem Abruf die komplette Aufzeichnung seit dem
 * Start, es geht also (Stand jetzt) nichts verloren, wenn ein Lauf ausfällt.
 * Trotzdem wird sie mitgeschrieben: ob der Export irgendwann ältere Punkte
 * abschneidet, weiß niemand, und die Spur ist die einzige Quelle, die nicht
 * rekonstruierbar wäre.
 *
 * Format bewusst kompakt (Arrays statt Objekte, Koordinaten auf 5
 * Nachkommastellen ≈ 1 m, Zeit als Unix-Sekunden): bei ~5 Minuten je Punkt
 * und drei Wochen Rennen landet das bei einigen Tausend Punkten, und die
 * Datei wird alle 30 Minuten neu committet.
 *
 * `ele` ist hier die rohe GPS-Höhe des Trackers — brauchbar als Rohdatum,
 * aber NICHT zum Aufsummieren: sie streut mit gut 20 m gegen das
 * Geländemodell und käme über 405 km auf 3.379 statt ~2.750 hm.
 */
function parseGpx(gpx) {
  const out = [];
  const re = /<trkpt lat="([\d.-]+)" lon="([\d.-]+)">\s*<ele>([\d.-]+)<\/ele>[\s\S]*?<time>([^<]*)<\/time>/g;
  for (const m of gpx.matchAll(re)) {
    const t = Date.parse(m[4]);
    if (!isFinite(t)) continue;
    out.push([Math.round(+m[1] * 1e5) / 1e5, Math.round(+m[2] * 1e5) / 1e5, Math.round(+m[3]), Math.round(t / 1000)]);
  }
  return out;
}

function saveTrack(gpx, deviceId) {
  if (!gpx) return null;
  const points = parseGpx(gpx);
  if (points.length < 2) { log('GPX enthielt keine brauchbaren Punkte, übersprungen.'); return null; }
  const prevLen = (loadTrack() || { points: [] }).points.length;
  if (points.length < prevLen) {
    // Sollte nicht vorkommen; wenn der Export doch irgendwann kürzt, ist die
    // archivierte Fassung die vollständigere und darf nicht überschrieben werden.
    log(`WARNUNG: GPX liefert nur ${points.length} Punkte, archiviert sind ${prevLen}. Nicht überschrieben.`);
    return null;
  }
  writeFileSync(TRACK_JSON_PATH, JSON.stringify({
    source: 'followmychallenge GPX export',
    deviceId,
    updated: new Date().toISOString(),
    fields: ['lat', 'lon', 'eleGps', 'unixSec'],
    points,
  }) + '\n');
  return points;
}

function loadTrack() {
  try { return JSON.parse(readFileSync(TRACK_JSON_PATH, 'utf8')); } catch { return null; }
}

/* Laufende Pause: aufeinanderfolgende Spurpunkte, die im Umkreis von 150 m um
   den Beginn der Ansammlung bleiben, und die bis zum letzten bekannten Punkt
   reicht. Bewusst dieselbe Regel wie `findStops()` im Board, damit Karte und
   Kopfzeile nicht unterschiedliche Zahlen behaupten.
   Was die Pause verursacht hat — Schlaf, Panne, Einkauf — steht hier nicht und
   ist aus der Spur auch nicht ableitbar. */
function ongoingStop(points, minMinutes = 40, radiusM = 150) {
  let i = 0, last = null;
  while (i < points.length) {
    let j = i + 1;
    while (j < points.length && haversine([points[i][0], points[i][1]], [points[j][0], points[j][1]]) < radiusM) j++;
    const mins = (points[j - 1][3] - points[i][3]) / 60;
    if (j > i + 1 && mins >= minMinutes) { last = { sinceUnix: points[i][3], toUnix: points[j - 1][3], mins }; i = j; }
    else i = (j > i + 1) ? j : i + 1;
  }
  // Nur melden, wenn die Ansammlung bis ans Ende der Spur reicht.
  return (last && last.toUnix === points[points.length - 1][3]) ? last : null;
}

function loadData() {
  return JSON.parse(readFileSync(DATA_JSON_PATH, 'utf8'));
}

function saveData(data) {
  writeFileSync(DATA_JSON_PATH, JSON.stringify(data, null, 2) + '\n');
}

function git(...cmdArgs) {
  return execFileSync('git', cmdArgs, { cwd: REPO_ROOT, encoding: 'utf8' });
}

/* Nach jedem Lauf gegen die Invarianten prüfen: data.json, track.json und
   profile.json beschreiben dieselbe Fahrt und müssen sich gegenseitig
   bestätigen. Läuft bewusst NACH dem Schreiben und VOR dem Commit, damit im
   Log steht, was mit genau diesem Stand veröffentlicht wurde — bricht aber
   nichts ab: eine verletzte Invariante ist ein Grund hinzusehen, kein Grund,
   den frischen Live-Stand wegzuwerfen. */
function checkAndLog() {
  try {
    const f = runChecks();
    for (const [stufe, text] of f) if (stufe !== 'ok') log(`CHECK ${stufe}: ${text}`);
    const fehler = f.filter(x => x[0] === 'FEHLER').length;
    log(`check: ${f.length - fehler} von ${f.length} Prüfungen sauber.`);
  } catch (e) { log('check.mjs fehlgeschlagen (ignoriert):', e.message); }
}

// Committet data.json, track.json und profile.json zusammen, aber nur, wenn
// sich wirklich etwas geändert hat — sonst bricht `git commit` den Lauf ab.
// Die drei Dateien werden namentlich gestaged: der stündliche Job soll keine
// nebenher offenen Quelltextänderungen mit einsammeln.
function commitAll(message) {
  git('add', 'data.json', 'track.json', 'profile.json');
  if (!git('diff', '--cached', '--name-only').trim()) { log('nothing changed, no commit.'); return; }
  git('commit', '-m', message);
  log('committed.');
  if (FLAGS.push) { git('push'); log('pushed.'); }
}

/* Baut das Höhenprofil aus der archivierten Spur neu auf und räumt die
   Felder der alten, geratenen Schätzung von den Einträgen ab. Läuft ohne
   Browser — die Spur liegt ja schon in track.json.

   Mit `--force` von Null an (nötig nach einem Wechsel des Routing-Profils),
   sonst nur das noch nicht verarbeitete Ende. */
async function backfill() {
  const force = args.includes('--force');
  const track = loadTrack();
  if (!track || !track.points) {
    log('track.json fehlt — erst einen normalen Lauf machen, der holt die Spur.');
    return;
  }

  log(`Profil aus ${track.points.length} Spurpunkten${force ? ' (kompletter Neuaufbau)' : ''}…`);
  const { prof, added, requests } = await updateProfile(track.points, { rebuild: force });
  log(`profile.json: +${added} Spurpunkte in ${requests} Anfragen → ${prof.routedKm} km, ` +
      `↑${prof.climbUp} ↓${prof.climbDown} hm, ${prof.points.length} Stützpunkte.`);

  const data = loadData();
  const entries = (data.entries || []).slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
  let changed = 0;

  // Reste der alten Segment-Schätzung entfernen — die Höhenmeter stehen jetzt
  // ausschließlich in profile.json, doppelte Wahrheiten wären nur verwirrend.
  for (const e of entries) {
    for (const k of ['climbUp', 'climbDown', 'climbKm', 'climbSrc', 'track']) {
      if (k in e) { delete e[k]; changed++; }
    }
    if (e.eleSrc === 'route') { delete e.ele; delete e.eleSrc; changed++; }
  }

  const missingEle = entries.filter(e => e.lat != null && e.ele == null);
  if (missingEle.length) {
    for (let i = 0; i < missingEle.length; i += 100) {
      const chunk = missingEle.slice(i, i + 100);
      const ele = await demElevation(chunk.map(e => [e.lat, e.lon]));
      chunk.forEach((e, j) => {
        if (typeof ele[j] === 'number') { e.ele = Math.round(ele[j]); e.eleSrc = 'dem'; changed++; }
      });
    }
    log(`backfilled ${missingEle.length} elevation(s) from DEM.`);
  }

  data.entries = entries;
  data.updated = new Date().toISOString();
  saveData(data);
  log(`data.json: ${changed} Altfeld(er) aufgeräumt.`);

  if (FLAGS.commit) commitAll('Rebuild elevation profile from the real GPS track');
  else log('dry run — not committed. Pass --commit (and --push) to publish.');
}

/* ---- Der Zeitstempel einer Meldung ist die Zeit ihres GPS-Punkts ----
 *
 * Bis zum 21.07.2026 trug `ts` den Zeitpunkt UNSERES Abrufs. Position, km,
 * Tempo und Platz stammen aber alle vom letzten Fix davor — bisher 1–4
 * Minuten früher, bei schlafendem Tracker auch mal 35. check.mjs hat es
 * gefunden: jede Meldung liegt auf 0–1 m genau auf einem Punkt aus
 * track.json, aber auf einem, der ein paar Minuten älter ist.
 *
 * Genau das macht den Bestand korrigierbar: der wahre Messzeitpunkt steht in
 * der Spur, er muss nur nachgeschlagen werden. Deshalb EINE Regel für neue
 * und alte Einträge statt zweier Konventionen im selben Feld.
 *
 * `tsSrc` hält fest, woher die Zeit stammt — dieselbe Konvention wie `eleSrc`
 * und `climbSrc`:
 *   'track'  aus der aufgezeichneten Spur (genau, der Normalfall)
 *   'fix'    aus `jetzt − lastReportMins` (Spur fehlt; auf ganze Minuten grob)
 *   'scrape' Zeitpunkt des Abrufs (weder Spur noch Fix-Alter — alte Konvention)
 *   fehlt    von Hand gesetzter Eintrag, nie angefasst
 */
const TS_MAX_METERS = 50;   // weiter weg ist es nicht derselbe Punkt, dann lieber nichts ändern

/* Sucht den Spurpunkt, an dem eine Meldung entstanden ist — über den ORT,
   nicht über die Zeit. Die Zeit ist ja gerade das Gesuchte. */
function trackTimeAt(points, lat, lon) {
  if (!points || !points.length) return null;
  let best = null, bd = Infinity;
  for (const p of points) {
    const d = haversine([lat, lon], [p[0], p[1]]);
    if (d < bd) { bd = d; best = p; }
  }
  return bd <= TS_MAX_METERS ? { unix: best[3], meters: bd } : null;
}

/* Zeitstempel bestehender Einträge auf den Messzeitpunkt korrigieren. Ohne
 * Browser und ohne Netz — die Spur liegt in track.json. Idempotent: der
 * nächstgelegene Spurpunkt bleibt derselbe, egal wie oft es läuft.
 * Einträge ohne lat/lon sind von Hand gesetzt und werden nicht angefasst. */
async function fixTimestamps() {
  const track = loadTrack();
  if (!track || !track.points || !track.points.length) {
    log('track.json fehlt — erst einen normalen Lauf machen, der holt die Spur.');
    return;
  }
  const data = loadData();
  const entries = data.entries || [];
  let changed = 0, ohneSpur = 0, blockiert = 0;

  entries.forEach((e, i) => {
    if (e.lat == null || e.lon == null) return;           // von Hand gesetzt
    const hit = trackTimeAt(track.points, e.lat, e.lon);
    if (!hit) { ohneSpur++; return; }
    const neu = localIsoNoTZ(new Date(hit.unix * 1000));
    if (neu === e.ts) { e.tsSrc = 'track'; return; }
    /* Nie vor den Vorgänger rutschen. Die Korrektur zieht Zeitstempel um
       Minuten nach hinten; lägen zwei Meldungen dicht beieinander, könnten
       sie sonst die Reihenfolge tauschen — und das Board rechnet Tempo aus
       aufeinanderfolgenden Zeilen. */
    const vor = entries[i - 1];
    if (vor && new Date(neu) <= new Date(vor.ts)) {
      log(`  ${e.ts} → ${neu} übersprungen: läge vor der Meldung davor (${vor.ts}).`);
      blockiert++;
      return;
    }
    const deltaMin = (new Date(e.ts) - new Date(neu)) / 60000;
    log(`  ${e.ts} → ${neu}  (−${deltaMin.toFixed(0)} min, ${hit.meters.toFixed(0)} m vom Spurpunkt)`);
    e.ts = neu;
    e.tsSrc = 'track';
    changed++;
  });

  if (ohneSpur) log(`${ohneSpur} Eintrag/Einträge ohne passenden Spurpunkt (>${TS_MAX_METERS} m) — unverändert.`);
  if (blockiert) log(`${blockiert} Korrektur(en) wegen Reihenfolge verworfen.`);
  if (!changed) { log('nichts zu korrigieren.'); return; }

  data.updated = new Date().toISOString();
  saveData(data);
  log(`data.json: ${changed} Zeitstempel auf den Messzeitpunkt korrigiert.`);
  checkAndLog();
  if (FLAGS.commit) commitAll(`Zeitstempel auf den Messzeitpunkt korrigiert (${changed} Einträge)`);
  else log('dry run — not committed. Pass --commit (and --push) to publish.');
}

/* Ortsnamen bestehender Einträge neu auflösen — nötig nach einer Änderung an
 * reverseGeocode(), sonst stehen alte grobe und neue feine Namen im selben Log
 * nebeneinander. Kein Browser nötig, nur Nominatim. Deren Nutzungsregeln
 * erlauben eine Anfrage pro Sekunde; das Log hat wenige Dutzend Einträge, das
 * läuft also in Sekunden durch. Einträge ohne lat/lon sind von Hand gesetzt und
 * werden nicht angefasst. */
async function refreshPlaces() {
  const data = loadData();
  const entries = (data.entries || []).filter(e => e.lat != null && e.lon != null);
  log(`${entries.length} Einträge mit Koordinaten — Ortsnamen neu auflösen…`);
  let changed = 0;
  for (const e of entries) {
    const place = await reverseGeocode(e.lat, e.lon);
    if (place && place !== e.place) {
      log(`  ${e.ts}  ${e.place || '—'} → ${place}`);
      e.place = place;
      changed++;
    }
    await new Promise(r => setTimeout(r, 1100));
  }
  if (!changed) { log('nichts geändert.'); return; }
  data.updated = new Date().toISOString();
  saveData(data);
  log(`data.json: ${changed} Ortsname(n) verfeinert.`);
  if (FLAGS.commit) commitAll(`Ortsnamen der Meldungen verfeinert (${changed} Einträge)`);
  else log('dry run — not committed. Pass --commit (and --push) to publish.');
}

async function main() {
  if (FLAGS.places) return refreshPlaces();
  if (FLAGS.backfill) return backfill();
  if (FLAGS.fixts) return fixTimestamps();

  const data0 = loadData();
  const windowStart = new Date(data0.settings.start);
  const windowEnd = new Date(new Date(data0.settings.deadline).getTime() + 24 * 3600 * 1000); // +1 day buffer for finish-line stragglers
  const now = new Date();
  if (now < windowStart || now > windowEnd) {
    log(`outside race window (${windowStart.toISOString()} – ${windowEnd.toISOString()}), skipping.`);
    return;
  }

  /* Fälligkeits-Gatter für den geplanten Lauf. Muss VOR dem Browserstart
     stehen — der ganze Sinn ist, dass ein nicht fälliger Tick nichts kostet.
     Fehlt `live` (allererster Lauf) oder ist der Stand alt, wird gearbeitet. */
  if (FLAGS.scheduled) {
    const lv = data0.live && data0.live.ts ? new Date(data0.live.ts) : null;
    const altMin = lv && isFinite(lv) ? (now - lv) / 60000 : Infinity;
    if (altMin < CONFIG.laufFaelligNachMin) {
      log(`Live-Stand ist ${Math.round(altMin)} min alt (fällig ab ${CONFIG.laufFaelligNachMin} min) — nichts zu tun.`);
      return;
    }
    log(`Live-Stand ist ${isFinite(altMin) ? Math.round(altMin) + ' min' : 'unbekannt'} alt — Lauf fällig.`);
  }

  const rider = await fetchRiderStateMitWiederholung();
  const { gpx, ...riderLog } = rider;   // das GPX ist zigtausend Zeichen, nicht ins Log
  log('rider state:', riderLog);

  if (rider.lastReportMins != null && rider.lastReportMins > 180) {
    log(`warning: last report is ${rider.lastReportMins} min old — tracker may be offline/asleep.`);
  }

  const trackPoints = saveTrack(gpx, rider.deviceId) || (loadTrack() || {}).points;
  if (trackPoints) log(`track.json: ${trackPoints.length} Spurpunkte archiviert.`);

  if (trackPoints) {
    try {
      const { prof, added, requests } = await updateProfile(trackPoints);
      log(`profile.json: +${added} Spurpunkte in ${requests} Anfragen → ` +
          `${prof.routedKm} km, ↑${prof.climbUp} ↓${prof.climbDown} hm gesamt.`);
    } catch (e) { log('Profilfortschreibung fehlgeschlagen (ignoriert):', e.message); }
  }

  const data = loadData();
  const entries = data.entries || [];
  const last = entries[entries.length - 1];

  /* Der Live-Stand, unabhängig davon ob ein Log-Eintrag fällig ist. Steht der
     Fahrer, entsteht sonst stundenlang kein Eintrag und das Board sieht aus,
     als wäre es kaputt — dabei IST der Stillstand die Information. */
  const stop = trackPoints ? ongoingStop(trackPoints) : null;
  data.live = {
    ts: localIsoNoTZ(),                          // wann wir zuletzt nachgesehen haben
    km: rider.km,
    fixMinsAgo: rider.lastReportMins ?? null,    // wie alt die Trackermeldung dabei war
    speed: rider.currentSpeed ?? null,
    rank: rider.rank ?? null,
  };
  if (stop) {
    data.live.stopSince = localIsoNoTZ(new Date(stop.sinceUnix * 1000));
    log(`steht seit ${data.live.stopSince} (${Math.round(stop.mins)} min).`);
  }

  /* Rückwärts geht es im Rennen nicht: fällt der gemeldete Stand unter die
     letzte Meldung (Tracker-Neuberechnung, verrutschte Rider-Zuordnung),
     wäre der Eintrag sofort ein FEHLER in check.mjs — stünde aber schon in
     der Historie und als negatives Tempo im Log. Analog zum Zeitstempel-
     Guard („nie vor den Vorgänger“) wird er gar nicht erst geschrieben.
     Live-Stand und Spur werden trotzdem veröffentlicht: check.mjs meldet
     dann live.km < letzter Eintrag, und ein Mensch soll hinsehen. */
  if (last && rider.km < Number(last.km) - 0.001) {
    log(`WARNUNG: Tracker-km fällt (${last.km} → ${rider.km}) — kein Eintrag geschrieben.`);
    data.updated = new Date().toISOString();
    saveData(data);
    checkAndLog();
    if (FLAGS.commit) commitAll(`Auto-update: Live-Stand ${rider.km} km (km-Rückgang, kein Eintrag)`);
    return;
  }

  // Auch wenn kein neuer Eintrag fällig ist, sind Live-Stand und Spur neu —
  // die werden trotzdem veröffentlicht.
  if (last && Math.abs(rider.km - Number(last.km)) < CONFIG.minKmDelta) {
    log(`km barely changed since last entry (${last.km} → ${rider.km}), skipping entry.`);
    data.updated = new Date().toISOString();
    saveData(data);
    checkAndLog();
    if (FLAGS.commit) commitAll(`Auto-update: Live-Stand ${rider.km} km${stop ? ', Pause' : ''}`);
    return;
  }

  const place = rider.lat != null ? await reverseGeocode(rider.lat, rider.lon) : (last ? last.place : '');

  /* Zeitstempel = Zeitpunkt der MESSUNG, nicht des Abrufs (siehe die Notiz
     über fixTimestamps()). Die Spur des laufenden Abrufs liegt schon vor,
     also dieselbe Regel wie beim Nachkorrigieren des Bestands: der Spurpunkt
     unter der gemeldeten Position gibt die Zeit. `lastReportMins` ist nur der
     Notnagel — es ist auf ganze Minuten gerundet. */
  let ts = localIsoNoTZ(), tsSrc = 'scrape';
  const hit = rider.lat != null ? trackTimeAt(trackPoints, rider.lat, rider.lon) : null;
  if (hit) { ts = localIsoNoTZ(new Date(hit.unix * 1000)); tsSrc = 'track'; }
  else if (rider.lastReportMins != null) {
    ts = localIsoNoTZ(new Date(Date.now() - rider.lastReportMins * 60000));
    tsSrc = 'fix';
  }
  // Nie vor die Meldung davor rutschen — das Board rechnet Tempo aus
  // aufeinanderfolgenden Zeilen.
  if (last && new Date(ts) <= new Date(last.ts)) {
    log(`Messzeit ${ts} läge vor der letzten Meldung (${last.ts}) — Abrufzeit verwendet.`);
    ts = localIsoNoTZ(); tsSrc = 'scrape';
  }

  const entry = {
    id: String(Date.now()),
    ts,
    tsSrc,
    km: rider.km,
    place,
    note: rider.rank != null ? `Platz ${rider.rank}` : '',
  };
  if (rider.lat != null) { entry.lat = rider.lat; entry.lon = rider.lon; }
  if (rider.currentSpeed != null) { entry.speed = rider.currentSpeed; }
  // Die GPS-Höhe des Trackers wird immer mitgeschrieben, ist aber nicht die
  // angezeigte: Einzelfix-Höhen streuen um ±20–30 m (hier 274 m gegen 245 m
  // aus dem Geländemodell). Fürs Diagramm zählt eine durchgehend gleiche
  // Quelle mehr als die Rohmessung, deshalb gewinnt der Routenwert.
  if (rider.altitude != null) entry.eleGps = Math.round(rider.altitude);

  // Höhenmeter stehen nicht mehr am Eintrag: die kommen aus profile.json,
  // das entlang der echten Spur rechnet und dessen kumulierte Werte das
  // Board für beliebige Zeiträume interpolieren kann. Eine Wahrheit, ein Ort.
  if (entry.ele == null && entry.lat != null) {
    try {
      const [e] = await demElevation([[entry.lat, entry.lon]]);
      if (typeof e === 'number') { entry.ele = Math.round(e); entry.eleSrc = 'dem'; }
    } catch (e) { log('elevation lookup failed (ignored):', e.message); }
  }
  if (entry.ele == null && entry.eleGps != null) { entry.ele = entry.eleGps; entry.eleSrc = 'gps'; }

  entries.push(entry);
  data.entries = entries;
  data.updated = new Date().toISOString();
  saveData(data);
  log('wrote entry:', entry);
  checkAndLog();

  if (FLAGS.commit) {
    commitAll(`Auto-update: ${entry.km} km, ${entry.place || '?'} (${entry.note})`);
  } else {
    log('dry run — not committed. Pass --commit (and --push) to publish.');
  }
}

main().catch(err => {
  console.error('[tcr84] FAILED:', err.message);
  process.exit(1);
});
