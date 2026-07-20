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
};

const args = process.argv.slice(2);
const FLAGS = {
  commit: args.includes('--commit'),
  push: args.includes('--push'),
  headed: args.includes('--headed'),
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

async function fetchRiderState() {
  const browser = await chromium.launch({ headless: !FLAGS.headed });
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

async function main() {
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
