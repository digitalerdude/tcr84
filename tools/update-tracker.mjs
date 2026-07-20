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
 *   node update-tracker.mjs --backfill       # only fill missing ele/climb on existing entries
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_JSON_PATH = path.join(REPO_ROOT, 'data.json');

const CONFIG = {
  trackerUrl: 'https://www.followmychallenge.com/live/tcrno12/',
  // Exact name as shown on the tracker (leaderboard / rider list).
  riderName: 'Manuel Kaufer',
  // Skip writing a new entry if the distance barely moved since the last one.
  minKmDelta: 1,
  /* BRouter-Profil für die Höhenmeter-Schätzung. Vergleich am 2026-07-20 auf
     den ersten beiden Segmenten (Tracker-Delta als Referenz für die Länge,
     Manuels eigene Erwartung von ~5.400 hm bis Flåm als Referenz für die Höhe):

       Profil     Länge Seg1/Seg2   Summe hm   hochgerechnet bis Flåm
       trekking   +2,66 / −0,36 km      372    ~5.740   ← gewählt
       fastbike   +1,63 / +0,57 km      553    ~8.550
       shortest   +0,52 / −0,58 km      472    ~7.300

     Die Länge allein entscheidet nichts (jedes Profil gewinnt ein Segment),
     die Höhe schon: `fastbike` nimmt im Gudbrandsdal die andere, hügeligere
     Talseite und liegt 58 % über Manuels Erwartung, `trekking` 6 %. Sollte
     die Auswertung am Abend des 21.07. etwas anderes zeigen: hier ändern,
     dann `--backfill --force` — das Profil steht in jedem Eintrag als
     `climbSrc`, alte und neue Werte bleiben unterscheidbar. */
  routeProfile: 'trekking',
  // Don't try to route/climb-sample absurdly long gaps (tracker was offline
  // for hours) — the guessed route gets too speculative to be worth showing.
  maxSegmentKm: 250,
};

const args = process.argv.slice(2);
const FLAGS = {
  commit: args.includes('--commit'),
  push: args.includes('--push'),
  headed: args.includes('--headed'),
  backfill: args.includes('--backfill'),
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

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=12&accept-language=de`;
    const res = await fetch(url, { headers: { 'User-Agent': 'tcr84-tracker-updater (personal dotwatch board, github.com/digitalerdude/tcr84)' } });
    if (!res.ok) return '';
    const data = await res.json();
    const a = data.address || {};
    return a.village || a.town || a.city || a.municipality || a.county || data.name || '';
  } catch {
    return '';
  }
}

/* ---------- Höhe & Höhenmeter ----------------------------------------
 * `ele` — die Höhe AN der Meldung, `climbUp`/`climbDown` — die Höhenmeter
 * ZWISCHEN zwei Meldungen. Letztere kann man aus den Meldungen selbst nicht
 * ableiten: bei ~35 km Abstand liegt jeder Anstieg zwischen den Stützpunkten.
 *
 * Quelle für alles Streckenbezogene ist BRouter (brouter.de, die Engine
 * hinter vielen Rad-Navi-Apps): Radprofil `trekking`, und — entscheidend —
 * eine eigene, entrauschte Höhenmeter-Summe (`filtered ascend`).
 *
 * Warum nicht OSRM + Höhen-API punktweise abfragen (erster Ansatz, verworfen
 * am 2026-07-20): der öffentliche OSRM-Demo-Server routet nur mit Auto-
 * Profil (19,4 km statt der real gefahrenen 17,8 km), und das punktweise
 * Aufsummieren roher DEM-Werte alle ~230 m produziert massive Artefakte —
 * im Testsegment sprang das Gelände um 190 m auf 500 m Strecke (38 %
 * Steigung, unmöglich für eine Straße), weil die geratene Route eine
 * Hangflanke streift. Ergebnis waren 423 statt 103 Höhenmetern, also gut
 * das Vierfache. Eine Steigungs- und Rauschfilterung von Hand brachte nur
 * ~8 %; BRouter macht das schon richtig. Nicht zurückbauen.
 *
 * Bleibt eine Schätzung: TCR hat freie Routenwahl, BRouter rät die
 * wahrscheinlichste Radroute zwischen zwei Meldungen.
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

// Radroute zwischen zwei Punkten inklusive Höhe je Stützpunkt. Die GeoJSON-
// Koordinaten sind [lon, lat, ele].
async function brouterSegment(a, b) {
  const url = `https://brouter.de/brouter?lonlats=${a[1]},${a[0]}|${b[1]},${b[0]}` +
              `&profile=${CONFIG.routeProfile}&alternativeidx=0&format=geojson`;
  const data = await fetchJson(url);
  const f = data.features && data.features[0];
  if (!f || !f.geometry || !Array.isArray(f.geometry.coordinates)) return null;
  return { coords: f.geometry.coordinates, props: f.properties || {} };
}

/* Liefert {up, down, routeKm, track} oder null, wenn irgendein Schritt
   scheitert — Höhenmeter sind Beiwerk, sie dürfen den Lauf nie kippen.

   `track` ist die ausgedünnte Höhenlinie des Segments, [[km, m], …] mit
   ABSOLUTEN Renn-Kilometern: die Routenlänge wird dafür auf das km-Delta
   der beiden Meldungen gestreckt, damit die Punkte auf derselben Achse
   liegen wie alles andere im Board. Rund ein Stützpunkt je Kilometer —
   das reicht optisch und hält data.json klein. */
function thinTrack(coords, kmFrom, kmTo) {
  const kmSpan = Number(kmTo) - Number(kmFrom);
  if (!(kmSpan > 0)) return null;
  const n = Math.min(Math.max(Math.round(kmSpan), 4), 60);
  const step = (coords.length - 1) / n;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const c = coords[Math.round(i * step)];
    if (!c || typeof c[2] !== 'number') continue;
    out.push([Math.round((Number(kmFrom) + kmSpan * (i / n)) * 10) / 10, Math.round(c[2])]);
  }
  return out.length >= 2 ? out : null;
}

async function segmentClimb(from, to) {
  try {
    if (from.lat == null || to.lat == null) return null;
    if (Math.abs(Number(to.km) - Number(from.km)) > CONFIG.maxSegmentKm) {
      log(`segment > ${CONFIG.maxSegmentKm} km, skipping climb estimate.`);
      return null;
    }
    const seg = await brouterSegment([from.lat, from.lon], [to.lat, to.lon]);
    if (!seg || seg.coords.length < 2) return null;
    const up = Number(seg.props['filtered ascend']);
    const net = Number(seg.props['plain-ascend']);   // Netto-Höhendifferenz, kann negativ sein
    const trackLen = Number(seg.props['track-length']);
    if (!isFinite(up) || !isFinite(net)) return null;
    return {
      up: Math.round(up),
      down: Math.round(up - net),
      routeKm: isFinite(trackLen) ? Math.round(trackLen / 100) / 10 : null,
      track: thinTrack(seg.coords, from.km, to.km),
      src: 'brouter:' + CONFIG.routeProfile,
      endEle: typeof seg.coords[seg.coords.length - 1][2] === 'number'
        ? Math.round(seg.coords[seg.coords.length - 1][2]) : null,
    };
  } catch (e) {
    log('climb estimate failed (ignored):', e.message);
    return null;
  }
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
    await page.goto(CONFIG.trackerUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

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
    };
  } finally {
    await browser.close();
  }
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

// Trägt `ele`/`climbUp`/`climbDown`/`track` auf bestehenden Einträgen nach,
// die vor dem Höhen-Feature geschrieben wurden. Läuft ohne Browser, rührt
// nichts an, was schon einen Wert hat (außer mit --force), und lässt Einträge
// ohne Koordinaten in Ruhe — die sind nicht rekonstruierbar.
async function backfill() {
  const data = loadData();
  const entries = (data.entries || []).slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const force = args.includes('--force');
  let changed = 0;

  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1], b = entries[i];
    if (a.lat == null || b.lat == null) continue;
    if (b.climbUp != null && !force) continue;
    const climb = await segmentClimb(a, b);
    if (!climb) continue;
    b.climbUp = climb.up; b.climbDown = climb.down;
    if (climb.routeKm != null) b.climbKm = climb.routeKm;
    if (climb.track) b.track = climb.track;
    b.climbSrc = climb.src;
    if (climb.endEle != null) { b.ele = climb.endEle; b.eleSrc = 'route'; }
    changed++;
    log(`  ${b.ts} ${b.place||'?'}: ↑${climb.up} ↓${climb.down} hm over ~${climb.routeKm} km`);
    await new Promise(r => setTimeout(r, 1500)); // höflich zum öffentlichen BRouter-Server
  }

  // Übrig bleiben Meldungen, die kein Segment abbekommen haben (die erste mit
  // GPS, oder eine nach einer zu langen Lücke) — die bekommen einen DEM-Wert.
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

  if (!changed) { log('backfill: nothing to do.'); return; }
  data.entries = entries;
  data.updated = new Date().toISOString();
  saveData(data);
  log(`backfill: ${changed} field group(s) written.`);

  if (FLAGS.commit) {
    git('add', 'data.json');
    git('commit', '-m', 'Backfill elevation and climb data on existing entries');
    log('committed.');
    if (FLAGS.push) { git('push'); log('pushed.'); }
  } else {
    log('dry run — not committed. Pass --commit (and --push) to publish.');
  }
}

async function main() {
  if (FLAGS.backfill) return backfill();

  const data0 = loadData();
  const windowStart = new Date(data0.settings.start);
  const windowEnd = new Date(new Date(data0.settings.deadline).getTime() + 24 * 3600 * 1000); // +1 day buffer for finish-line stragglers
  const now = new Date();
  if (now < windowStart || now > windowEnd) {
    log(`outside race window (${windowStart.toISOString()} – ${windowEnd.toISOString()}), skipping.`);
    return;
  }

  const rider = await fetchRiderState();
  log('rider state:', rider);

  if (rider.lastReportMins != null && rider.lastReportMins > 180) {
    log(`warning: last report is ${rider.lastReportMins} min old — tracker may be offline/asleep.`);
  }

  const data = loadData();
  const entries = data.entries || [];
  const last = entries[entries.length - 1];

  if (last && Math.abs(rider.km - Number(last.km)) < CONFIG.minKmDelta) {
    log(`km barely changed since last entry (${last.km} → ${rider.km}), skipping.`);
    return;
  }

  const place = rider.lat != null ? await reverseGeocode(rider.lat, rider.lon) : (last ? last.place : '');

  const entry = {
    id: String(Date.now()),
    ts: localIsoNoTZ(),
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

  const climb = last ? await segmentClimb(last, entry) : null;
  if (climb) {
    entry.climbUp = climb.up;
    entry.climbDown = climb.down;
    if (climb.routeKm != null) entry.climbKm = climb.routeKm;
    if (climb.track) entry.track = climb.track;
    entry.climbSrc = climb.src;
    if (climb.endEle != null) { entry.ele = climb.endEle; entry.eleSrc = 'route'; }
    log(`climb since last entry: ↑${climb.up} ↓${climb.down} hm over ~${climb.routeKm} km`);
  }
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

  if (FLAGS.commit) {
    git('add', 'data.json');
    git('commit', '-m', `Auto-update: ${entry.km} km, ${entry.place || '?'} (${entry.note})`);
    log('committed.');
    if (FLAGS.push) {
      git('push');
      log('pushed.');
    }
  } else {
    log('dry run — not committed. Pass --commit (and --push) to publish.');
  }
}

main().catch(err => {
  console.error('[tcr84] FAILED:', err.message);
  process.exit(1);
});
