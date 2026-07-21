#!/usr/bin/env node
/* Invarianten-Prüfung für data.json / track.json / profile.json.
 *
 * Warum das existiert: die drei Dateien beschreiben dieselbe Fahrt aus drei
 * Blickwinkeln und müssen sich gegenseitig bestätigen — die Summe der
 * Tagesbalken MUSS der Gesamtstrecke entsprechen, die Summe der Tages-
 * Höhenmeter der Gesamtsumme, eine Meldung MUSS in der Nähe der Spur liegen.
 * Bricht eine dieser Beziehungen, ist irgendwo eine zweite Wahrheit
 * entstanden, und genau daran sind hier bisher die Fehler entstanden.
 * Ohne diese Prüfung ist so etwas erst Stunden später am Board zu sehen —
 * und dann steckt es schon in der Historie.
 *
 * Läuft ohne Browser, ohne Netz, ohne Abhängigkeiten:
 *   node check.mjs            # Bericht, Exit 1 bei FEHLER
 *   node check.mjs --quiet    # nur FEHLER und WARNUNG, kein OK-Protokoll
 *
 * update-tracker.mjs ruft runChecks() nach jedem Lauf auf und protokolliert
 * das Ergebnis — bewusst NICHT abbrechend: eine verletzte Invariante ist ein
 * Grund hinzusehen, aber kein Grund, den nächsten Live-Stand zu verwerfen.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/* Toleranzen an einem Ort, damit sie diskutierbar bleiben statt im Code
   verstreut zu stehen. Alle empirisch am Stand vom 21.07.2026 geeicht. */
const TOL = {
  abrufAltMin: 150,        // ab hier zeigt das Board „Abruf hängt“ (renderLive)
  spurAltMin: 180,         // Tracker meldet im Median alle 5 min; 3 h ohne Punkt ist auffällig
  profilRueckstandMin: 120,// Profil hinkt der Spur hinterher (updateProfile hat nicht durchgerechnet)
  kmScaleBand: [0.90, 1.08], // BRouter rechnet ~3 % länger als der Tracker
  maxKmh: 60,              // Radrennen, nicht Autobahn — darüber ist ein Sprung ein Datenfehler
  meldungZurSpurKm: 2,     // eine Meldung muss zur aufgezeichneten Spur passen
  summeKm: 1.5,            // Rundung über ~20 Tagesbalken
  summeHm: 5,
  hoheMax: 3500,           // höchster Punkt der Route; darüber ist es ein DEM-Artefakt
};

// Ohne Zeitzonen-Suffix, siehe CLAUDE.md — ein „Z“ hier verschiebt alle
// Tempo- und Prognoserechnungen im Board um die Zeitzonendifferenz.
const TS_LOKAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const la1 = a[0] * rad, la2 = b[0] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Kumulierte Höhenmeter/Kilometer zu einem Zeitpunkt — Zeile für Zeile
   dieselbe Rechnung wie `cumClimbAt()` in index.html. Die Verdopplung ist
   Absicht: prüfte die Prüfung mit dem Code des Boards, könnte sie einen
   Denkfehler im Board nicht finden, sondern würde ihn nachvollziehen. */
function cumAt(prof, unixSec) {
  const ch = prof.chunks;
  if (!Array.isArray(ch) || !ch.length) return null;
  const letzter = ch[ch.length - 1];
  if (unixSec >= letzter[0]) return { up: letzter[2], down: letzter[3], km: letzter[1] };
  let pT = prof.startUnix ?? ch[0][0], pUp = 0, pDown = 0, pKm = 0;
  for (const [t, km, up, down] of ch) {
    if (unixSec <= t) {
      const f = t > pT ? (unixSec - pT) / (t - pT) : 1;
      return { up: pUp + (up - pUp) * f, down: pDown + (down - pDown) * f, km: pKm + (km - pKm) * f };
    }
    pT = t; pUp = up; pDown = down; pKm = km;
  }
  return { up: pUp, down: pDown, km: pKm };
}

export function runChecks({ now = new Date() } = {}) {
  const f = [];   // [Stufe, Text]
  const fehler = m => f.push(['FEHLER', m]);
  const warnung = m => f.push(['WARNUNG', m]);
  const ok = m => f.push(['ok', m]);

  const lade = name => {
    try { return JSON.parse(readFileSync(path.join(REPO_ROOT, name), 'utf8')); }
    catch (e) { fehler(`${name} nicht lesbar: ${e.message}`); return null; }
  };
  const data = lade('data.json');
  const track = lade('track.json');
  const prof = lade('profile.json');
  const nowSec = now.getTime() / 1000;

  /* ---------- data.json ---------- */
  let letzte = null;
  if (data) {
    const st = data.settings || {};
    const start = new Date(st.start), dl = new Date(st.deadline);
    if (!isFinite(start) || !isFinite(dl)) fehler('settings.start/deadline nicht parsebar.');
    else if (start >= dl) fehler('settings.start liegt nicht vor settings.deadline.');

    const es = data.entries || [];
    if (!es.length) warnung('data.json hat noch keine Einträge.');
    const ids = new Set();
    es.forEach((e, i) => {
      const wo = `entries[${i}] (${e.ts})`;
      if (!TS_LOKAL.test(String(e.ts)))
        fehler(`${wo}: ts ist nicht lokale Zeit ohne Zeitzone — verschiebt alle Zeitrechnungen im Board.`);
      if (ids.has(e.id)) fehler(`${wo}: doppelte id ${e.id}.`);
      ids.add(e.id);
      if (!isFinite(Number(e.km))) fehler(`${wo}: km ist keine Zahl.`);
      if (new Date(e.ts) > new Date(now.getTime() + 5 * 60000))
        fehler(`${wo}: liegt in der Zukunft — klassisches Zeichen für einen UTC-Stempel im lokalen Feld.`);
      if (i > 0) {
        const v = es[i - 1];
        if (new Date(e.ts) < new Date(v.ts)) fehler(`${wo}: steht vor dem Eintrag davor (${v.ts}).`);
        if (Number(e.km) < Number(v.km))
          fehler(`${wo}: Kilometerstand fällt (${v.km} → ${e.km}). Rückwärts geht es im Rennen nicht.`);
        const dh = (new Date(e.ts) - new Date(v.ts)) / 3.6e6;
        const kmh = dh > 0 ? (Number(e.km) - Number(v.km)) / dh : 0;
        if (kmh > TOL.maxKmh) warnung(`${wo}: ${kmh.toFixed(0)} km/h seit der Meldung davor — unplausibel.`);
      }
    });
    letzte = es[es.length - 1] || null;
    if (es.length) ok(`data.json: ${es.length} Einträge, ${letzte.km} km, lückenlos aufsteigend.`);

    const lv = data.live;
    if (!lv || !lv.ts) warnung('data.live fehlt — die Kopfzeile des Boards bleibt leer.');
    else {
      if (!TS_LOKAL.test(String(lv.ts))) fehler(`live.ts (${lv.ts}) ist nicht lokale Zeit ohne Zeitzone.`);
      const altMin = (now - new Date(lv.ts)) / 60000;
      if (altMin < -5) fehler(`live.ts (${lv.ts}) liegt in der Zukunft — Zeitzonenfehler im Scraper?`);
      else if (altMin > TOL.abrufAltMin)
        warnung(`Letzter Abruf ist ${Math.round(altMin)} min her — das Board zeigt „Abruf hängt“. launchd-Job prüfen.`);
      else ok(`live: Abruf vor ${Math.round(altMin)} min, ${lv.km} km${lv.stopSince ? ', Pause läuft' : ''}.`);
      if (letzte && lv.km != null && Number(lv.km) < Number(letzte.km) - 0.05)
        fehler(`live.km (${lv.km}) liegt unter dem letzten Log-Eintrag (${letzte.km}).`);
      if (lv.stopSince && new Date(lv.stopSince) > new Date(lv.ts))
        fehler('live.stopSince liegt nach live.ts — die Pause hätte noch nicht begonnen.');
      /* `fixMinsAgo` ist eine eingefrorene Dauer, kein laufender Wert: gültig
         nur zusammen mit live.ts. Wer sie roh anzeigt, behauptet stundenalte
         Meldungen seien frisch (genau dieser Bug, 21.07.2026). */
      if (lv.fixMinsAgo != null && (lv.fixMinsAgo < 0 || lv.fixMinsAgo > 24 * 60))
        warnung(`live.fixMinsAgo = ${lv.fixMinsAgo} min ist außerhalb jedes sinnvollen Bereichs.`);
    }
  }

  /* ---------- track.json ---------- */
  let pts = null;
  if (track) {
    pts = track.points || [];
    if (pts.length < 2) fehler('track.json hat weniger als zwei Spurpunkte.');
    else {
      let zeitfehler = 0, ortfehler = 0, luecken = 0, ausfaelle = 0;
      for (let i = 1; i < pts.length; i++) {
        const [la, lo, , t] = pts[i], v = pts[i - 1];
        if (t <= v[3]) zeitfehler++;
        if (!(la > 34 && la < 72 && lo > -11 && lo < 31)) ortfehler++;
        const gapMin = (t - v[3]) / 60;
        if (gapMin > 60) {
          /* Eine Lücke ist nur dann Datenverlust, wenn er dabei woanders
             wieder auftaucht. Steht er, schläft der Tracker — in der Nacht
             vom 20. auf den 21.07.2026 waren das 5,5 h am selben Fleck, und
             das ist die Information, kein Ausfall. */
          if (haversine([la, lo], [v[0], v[1]]) > 500) ausfaelle++;
          else luecken++;
        }
      }
      if (zeitfehler) fehler(`track.json: ${zeitfehler} Punkte laufen zeitlich rückwärts.`);
      if (ortfehler) fehler(`track.json: ${ortfehler} Punkte liegen außerhalb Europas.`);
      if (ausfaelle) warnung(`track.json: ${ausfaelle} Lücken > 60 min MIT Ortswechsel — dort fehlt echte Spur.`);
      if (luecken) ok(`track.json: ${luecken} Lücken > 60 min am selben Ort (Tracker schläft im Stand, erwartet).`);
      const altMin = (nowSec - pts[pts.length - 1][3]) / 60;
      if (altMin > TOL.spurAltMin)
        warnung(`Letzter Spurpunkt ist ${Math.round(altMin / 60)} h alt — Tracker aus, oder GPX-Export liefert nicht mehr.`);
      if (!zeitfehler && !ortfehler) ok(`track.json: ${pts.length} Punkte, zeitlich sauber.`);
    }
  }

  /* ---------- profile.json ---------- */
  if (prof) {
    const ch = prof.chunks || [];
    if (!ch.length) warnung('profile.json hat keine Blöcke — das Board zeigt keine Höhenmeter.');
    else {
      /* Kumulierte Reihen dürfen nie fallen. Ein einzelnes Höhenmeter Rückgang
         ist allerdings ein bekannter Rundungsrest der BRouter-Formel
         (`down = filtered ascend − plain-ascend`), inzwischen an der Quelle
         geklemmt — Altbestand behält ihn, ein Neuaufbau des Profils wäre
         dafür hunderte Anfragen an einen Gratis-Dienst. */
      let mono = 0, monoKlein = 0;
      for (let i = 1; i < ch.length; i++)
        for (let k = 0; k < 4; k++) {
          const d = ch[i - 1][k] - ch[i][k];
          if (d > 1) mono++; else if (d > 0) monoKlein++;
        }
      if (mono) fehler(`profile.json: ${mono} Werte in chunks fallen — kumulierte Reihen dürfen das nie.`);
      else if (monoKlein) ok(`profile.json: ${monoKlein}× 1 hm Rundungsrückgang in chunks (bekannt, Altbestand).`);
      const l = ch[ch.length - 1];
      if (Math.abs(l[1] - prof.routedKm) > 0.05) fehler(`routedKm (${prof.routedKm}) passt nicht zum letzten Block (${l[1]}).`);
      if (Math.abs(l[2] - prof.climbUp) > 1) fehler(`climbUp (${prof.climbUp}) passt nicht zum letzten Block (${l[2]}).`);
      if (Math.abs(l[3] - prof.climbDown) > 1) fehler(`climbDown (${prof.climbDown}) passt nicht zum letzten Block (${l[3]}).`);
      if (prof.anchor && prof.anchor[2] !== prof.throughUnix)
        fehler('anchor und throughUnix zeigen auf verschiedene Zeitpunkte — der nächste Block setzt falsch an.');
      if (prof.startUnix != null && prof.startUnix > prof.throughUnix)
        fehler('startUnix liegt nach throughUnix.');
      if (!mono) ok(`profile.json: ${ch.length} Blöcke, ${prof.routedKm} km, ↑${prof.climbUp} ↓${prof.climbDown} hm.`);
    }
    const p = prof.points || [];
    if (p.length) {
      // Stützpunkte alle 500 m (CONFIG.profileSampleMeters) — grobe Plausibilität.
      const soll = prof.routedKm * 2;
      if (p.length < soll * 0.7 || p.length > soll * 1.3)
        warnung(`profile.points: ${p.length} Stützpunkte für ${prof.routedKm} km (erwartet ~${Math.round(soll)}).`);
      const hoch = Math.max(...p.map(x => x[1])), tief = Math.min(...p.map(x => x[1]));
      if (hoch > TOL.hoheMax) warnung(`Höchster Profilpunkt ${hoch} m — über der Plausibilitätsgrenze, DEM-Artefakt?`);
      if (tief < -10) warnung(`Tiefster Profilpunkt ${tief} m — unter Meeresniveau.`);
      let kmMono = 0;
      for (let i = 1; i < p.length; i++) if (p[i][0] < p[i - 1][0]) kmMono++;
      if (kmMono) fehler(`profile.points: ${kmMono} Kilometerwerte fallen.`);
    }
  }

  /* ---------- Querbezüge: hier hängt es zusammen oder gar nicht ---------- */
  if (prof && pts && pts.length && (prof.chunks || []).length) {
    const rueckstandMin = (pts[pts.length - 1][3] - prof.throughUnix) / 60;
    if (rueckstandMin > TOL.profilRueckstandMin)
      warnung(`Profil hinkt der Spur ${Math.round(rueckstandMin)} min hinterher — BRouter-Blöcke sind ausgefallen.`);
    else ok(`Profil ist bis ${Math.round(rueckstandMin)} min an die Spur herangerechnet.`);
  }

  if (data && prof && letzte && prof.routedKm > 0) {
    const kmScale = Number(letzte.km) / prof.routedKm;
    if (kmScale < TOL.kmScaleBand[0] || kmScale > TOL.kmScaleBand[1])
      warnung(`kmScale ${kmScale.toFixed(3)}: geroutete (${prof.routedKm}) und gemeldete Strecke (${letzte.km}) laufen auseinander.`);
    else ok(`kmScale ${kmScale.toFixed(3)} — Profil und Tracker im erwarteten Band.`);

    /* Die Probe, die das Board sichtbar macht: renderDays() zerlegt dieselben
       chunks in Kalendertage. Summieren sich die Balken nicht zur Gesamtzahl
       im Kennzahlenblock, stehen zwei verschiedene Wahrheiten auf einer Seite. */
    const ch = prof.chunks;
    const ersterSec = prof.startUnix ?? ch[0][0];
    const letzterSec = ch[ch.length - 1][0];
    let summeKm = 0, summeHm = 0;
    for (let d = new Date(ersterSec * 1000); ; d.setDate(d.getDate() + 1)) {
      const tagStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
      const tagEnde = tagStart + 86400;
      const a = cumAt(prof, Math.max(tagStart, ersterSec));
      const b = cumAt(prof, Math.min(tagEnde, letzterSec));
      summeKm += Math.max(b.km - a.km, 0);
      summeHm += Math.max(b.up - a.up, 0);
      if (tagEnde > letzterSec) break;
    }
    const dKm = Math.abs(summeKm * kmScale - Number(letzte.km));
    const dHm = Math.abs(summeHm - prof.climbUp);
    if (dKm > TOL.summeKm) fehler(`Tagesbalken summieren sich auf ${(summeKm * kmScale).toFixed(1)} km statt ${letzte.km} km (Δ ${dKm.toFixed(1)}).`);
    if (dHm > TOL.summeHm) fehler(`Tages-Höhenmeter summieren sich auf ${Math.round(summeHm)} statt ${prof.climbUp} hm (Δ ${Math.round(dHm)}).`);
    if (dKm <= TOL.summeKm && dHm <= TOL.summeHm)
      ok(`Tagesbalken summieren sich sauber: ${(summeKm * kmScale).toFixed(0)} km, ${Math.round(summeHm)} hm.`);
  }

  /* Jede automatisch erfasste Meldung muss auf der aufgezeichneten Spur
     liegen — sie stammt aus derselben Quelle. Tut sie es nicht, ist entweder
     die Rider-Zuordnung im Scraper verrutscht oder track.json gehört zu einem
     anderen Fahrer.
     Verglichen wird über den ORT, nicht über die Zeit: gesucht ist der
     Spurpunkt, an dem die Meldung entstanden ist. Der zeitliche Versatz zu
     diesem Punkt ist dann die eigentliche Aussage — er misst, wie alt die
     Trackermeldung war, als wir sie abgeholt haben. Über die Zeit zu suchen
     verwechselt beides: bei 30 km/h sind 4 Minuten Versatz 2 km Abstand, und
     die Prüfung schlüge Alarm, obwohl die Position stimmt. */
  if (data && pts && pts.length) {
    let weit = 0, geprueft = 0, schlimmsteKm = 0, schlimmsteMin = 0;
    for (const e of (data.entries || [])) {
      if (e.lat == null || e.lon == null) continue;
      geprueft++;
      let best = null, bd = Infinity;
      for (const p of pts) {
        const d = haversine([e.lat, e.lon], [p[0], p[1]]);
        if (d < bd) { bd = d; best = p; }
      }
      const km = bd / 1000;
      if (km > TOL.meldungZurSpurKm) { weit++; schlimmsteKm = Math.max(schlimmsteKm, km); }
      else schlimmsteMin = Math.max(schlimmsteMin, (new Date(e.ts).getTime() / 1000 - best[3]) / 60);
    }
    if (weit) fehler(`${weit} von ${geprueft} Meldungen liegen bis zu ${schlimmsteKm.toFixed(1)} km neben der Spur — falscher Fahrer?`);
    else if (geprueft) ok(`${geprueft} GPS-Meldungen liegen auf der aufgezeichneten Spur.`);
    /* Seit 21.07.2026 ist `ts` der Zeitpunkt der Messung, nicht des Abrufs —
       die Zeit kommt aus dem Spurpunkt unter der Meldung (`tsSrc:'track'`).
       Bleibt hier Versatz stehen, ist entweder ein Eintrag nach der alten
       Konvention dazugekommen oder `--fixts` ist nach einem Ausfall des
       GPX-Exports nie nachgelaufen. */
    const altKonvention = (data.entries || [])
      .filter(e => e.lat != null && e.tsSrc !== 'track' && e.tsSrc !== 'fix').length;
    if (altKonvention)
      warnung(`${altKonvention} GPS-Meldung(en) ohne tsSrc — Zeitstempel ist der Abruf, nicht die Messung. \`--fixts\` laufen lassen.`);
    if (schlimmsteMin > 3)
      warnung(`Meldungen tragen bis zu ${Math.round(schlimmsteMin)} min Versatz zur Messung.`);
    else if (geprueft) ok(`${geprueft} Zeitstempel sitzen auf ihrem Messpunkt (Versatz ≤ ${Math.round(schlimmsteMin)} min).`);
  }

  return f;
}

/* Direkt aufgerufen: Bericht drucken. Exit 1 nur bei FEHLER — eine WARNUNG
   ist ein Hinweis (Tracker schläft, Job hängt), kein kaputter Datenstand. */
const direkt = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direkt) {
  const quiet = process.argv.includes('--quiet');
  const f = runChecks();
  const zeichen = { FEHLER: '✗', WARNUNG: '!', ok: '·' };
  for (const [stufe, text] of f) {
    if (quiet && stufe === 'ok') continue;
    console.log(`${zeichen[stufe]} ${stufe === 'ok' ? '' : stufe + ': '}${text}`);
  }
  const fehler = f.filter(x => x[0] === 'FEHLER').length;
  const warn = f.filter(x => x[0] === 'WARNUNG').length;
  console.log(`\n${fehler} Fehler, ${warn} Warnungen, ${f.length - fehler - warn} Prüfungen bestanden.`);
  process.exit(fehler ? 1 : 0);
}
