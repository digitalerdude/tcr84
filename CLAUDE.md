# CLAUDE.md — tcr84

Dotwatch-Board für Manuel Kaufer (Startnummer 84) beim Transcontinental Race No12
(Trondheim → Kalamata, 19.07.–08.08.2026). Statische Single-Page-App, gehostet über
GitHub Pages direkt von `main` (`https://digitalerdude.github.io/tcr84/`).

## Struktur

| Datei | Zweck |
|---|---|
| `index.html` | Die ganze App: Vanilla-JS, kein Build-Step. CSS-Variablen in `:root` sind das Design-System (`--night`, `--panel`, `--brass`, `--mono` etc.) — neue UI hält sich daran, keine Hardcoded-Farben. |
| `data.json` | Der Datenspeicher. Wird von GitHub Pages ausgeliefert, `index.html` lädt ihn per `fetch('data.json?t=...')`. Schreibrechte nur über Git-Commit ins Repo (kein Server, kein Backend). |
| `track.json` | Archiv der **echten gefahrenen Spur** aus dem GPX-Export des Trackers, siehe unten. Wird bei jedem Lauf komplett neu geschrieben. Noch von nichts im Frontend gelesen. |
| `tools/update-tracker.mjs` | Automatisierter Scraper, siehe unten. |
| `tools/package.json` | Playwright-Dependency für den Scraper. `cd tools && npm install`. |

## data.json-Schema

```jsonc
{
  "settings": { "totalKm": 4800, "start": "...", "deadline": "...", "cps": [...] },
  "entries": [
    {
      "id": "...",              // String(Date.now())
      "ts": "2026-07-20T16:52", // WICHTIG: lokale Uhrzeit OHNE Zeitzone, siehe unten
      "km": 360.17,
      "place": "Stor-Elvdal",
      "note": "Platz 66",
      "lat": 61.772323,         // optional, nur bei automatisch erfassten Einträgen
      "lon": 10.21984,          // optional
      "speed": 7.2,             // optional, km/h bei Erfassung
      "ele": 245,               // optional, Höhe in m an dieser Meldung
      "eleSrc": "route",        // woher `ele` stammt: route | dem | gps
      "eleGps": 274,            // optional, rohe GPS-Höhe des Trackers
      "climbUp": 103,           // optional, geschätzte Höhenmeter seit der Meldung davor
      "climbDown": 427,         // optional, dito bergab
      "climbKm": 17.4,          // optional, Länge der gerouteten Strecke des Segments
      "climbSrc": "brouter:trekking",  // welches Routing-Profil die climb-Werte erzeugt hat
      "track": [[387.1,569]]    // optional, ausgedünnte Höhenlinie [km, m], absolute Renn-km
    }
  ],
  "updated": "..."
}
```

**Zeitzonen-Falle:** `ts` wird im Browser mit `new Date(ts)` geparst. Ein ISO-String
ohne `Z`/Offset-Suffix wird von `Date` als **lokale Zeit** interpretiert — nicht UTC.
`index.html`s eigenes `setNow()` nutzt deshalb den Trick
`d.setMinutes(d.getMinutes()-d.getTimezoneOffset())` vor `toISOString()`, um lokale
Zeit in diesem Format zu erzeugen. Jeder Code, der `ts` schreibt, muss dieselbe
Konvention einhalten (`localIsoNoTZ()` in `update-tracker.mjs`) — ein echter UTC-ISO-
String hier verschiebt Tempo-/Prognose-Berechnungen um die Zeitzonen-Differenz.

**Zusätzliche Felder sind sicher:** `renderLog()` und `compute()` ignorieren
unbekannte Keys, neue optionale Felder (wie `lat`/`lon`/`speed`) brechen nichts.

## tools/update-tracker.mjs — automatischer Live-Tracker-Scraper

Liest die Position von Manuel Kaufer vom offiziellen Live-Tracker
(`followmychallenge.com/live/tcrno12/`) und hängt automatisch einen neuen Eintrag an
`data.json` an.

**Datenquelle:** `window.ridersArray` — ein internes JS-Objekt, das die Tracker-Seite
selbst pflegt (nicht dokumentiert, per Reverse-Engineering am 2026-07-20 gefunden,
kann brechen wenn sich die Seite ändert). Enthält pro Fahrer u.a. `latitude`,
`longitude`, `totalDistance`, `position`, `currentSpeed`, `lastReportMins`. Wird per
`page.waitForFunction()` direkt aus dem laufenden Tab gelesen, kein Payload-Parsing.

**Cloudflare:** Die Seite ist hinter Cloudflare. Zwei wichtige, empirisch bestätigte
Punkte (2026-07-20):
- Reines `curl`/`fetch` ohne echten Browser wird site-weit hart geblockt (403
  "Attention Required"), auch mit gefälschtem User-Agent.
- **Playwright headless wird ebenfalls hart geblockt** — dieselbe "Attention
  Required"-Seite. Nur ein echter, "headed" Chromium-Tab kommt durch (vermutlich
  Fingerprint-basiert, nicht IP-basiert). Deshalb startet das Skript IMMER mit
  `headless:false`; für unbeaufsichtigte Läufe wird das Fenster per
  `--window-position` einfach aus dem sichtbaren Bereich geschoben, statt echtes
  Headless zu erzwingen.
- `waitUntil:'networkidle'` beim `page.goto()` funktioniert nicht — die Seite pollt
  dauerhaft im Hintergrund (Wetter-Widget, Update-Countdown) und wird nie "idle".
  Stattdessen wird auf den Seitentitel gepollt (`waitForAppReady`).

**Nutzung:**
```bash
cd tools
node update-tracker.mjs                     # Dry Run, schreibt data.json nur lokal
node update-tracker.mjs --commit --push      # committet und pusht
node update-tracker.mjs --headed             # Fenster sichtbar (Debugging)
node update-tracker.mjs --dump=rider.json    # rohes ridersArray-Objekt für den Fahrer dumpen
node update-tracker.mjs --backfill            # nur fehlende Höhen-Felder nachtragen (ohne Browser)
node update-tracker.mjs --backfill --force    # dito, auch vorhandene Werte neu rechnen
```

### Höhen und Höhenmeter

Zwei verschiedene Dinge mit zwei verschiedenen Problemen:

- **`ele`** — Höhe *an* der Meldung. `ridersArray` hat ein Feld `altitude` (das Feld
  `elevation` daneben steht konstant auf 0, unbrauchbar), aber es ist **nicht immer
  gefüllt** — am 2026-07-20 mal 274, eine Stunde später `null`. Es wird als `eleGps`
  immer mitgeschrieben, ist aber nicht die angezeigte Höhe: Einzelfix-GPS-Höhen
  streuen um ±20–30 m. Angezeigt wird der Wert aus der gerouteten Strecke
  (`eleSrc:'route'`), damit die Kurve im Board eine durchgehend gleiche Quelle hat.
  Fallbacks: DEM-Lookup (`'dem'`), dann GPS (`'gps'`).
- **`climbUp`/`climbDown`/`track`** — Höhenmeter *zwischen* zwei Meldungen. Aus den
  Meldungen selbst nicht ableitbar (bei ~35 km Abstand liegt jeder Anstieg
  dazwischen), also wird die wahrscheinlichste Radroute geroutet und deren
  Höhenprofil ausgewertet.

**Quelle: [BRouter](https://brouter.de/)** (`format=geojson`), kein Key,
öffentlicher Server. Profil in `CONFIG.routeProfile`, aktuell `trekking`.

**Warum `trekking` und nicht `fastbike`?** Messung am 2026-07-20 auf den ersten
beiden Segmenten — Tracker-Delta als Referenz für die Länge, Manuels eigene
Erwartung von ~5.400 hm bis Flåm als Referenz für die Höhe:

| Profil | Länge Seg1 / Seg2 | Summe hm | hochgerechnet bis Flåm |
|---|---|---|---|
| `trekking` | +2,66 / −0,36 km | 372 | ~5.740 ← gewählt |
| `fastbike` | +1,63 / +0,57 km | 553 | ~8.550 |
| `shortest` | +0,52 / −0,58 km | 472 | ~7.300 |

Die Länge entscheidet nichts (jedes Profil gewinnt ein Segment), die Höhe schon:
`fastbike` nimmt im Gudbrandsdal die andere, hügeligere Talseite. Das gewählte
Profil steht in jedem Eintrag als `climbSrc` (`"brouter:trekking"`), ein Wechsel
plus `--backfill --force` bleibt dadurch nachvollziehbar.
`fastbike-asphalt-avoid-unsafe` gibt es auf dem öffentlichen Server nicht (HTTP 500). Liefert Höhe je Stützpunkt in der Geometrie
(`[lon, lat, ele]`), `track-length`, und entscheidend `filtered ascend` — eine
bereits entrauschte Höhenmeter-Summe. `climbDown` = `filtered ascend` − `plain-ascend`.

**Verworfener erster Ansatz (2026-07-20), nicht zurückbauen:** OSRM-Demo-Server +
punktweise Höhenabfrage bei Open-Meteo. Zwei Fehler: der öffentliche OSRM-Demo
routet nur mit Auto-Profil (19,4 km statt real gefahrener 17,8 km — BRouter trifft
mit 17,4 km), und das Aufsummieren roher DEM-Werte alle ~230 m erzeugt massive
Artefakte, weil die geratene Route Hangflanken streift: im Testsegment ein Sprung
von 190 m auf 500 m Strecke (38 % Steigung). Ergebnis 423 statt 103 Höhenmeter,
gut das Vierfache. Steigungs- und Hysterese-Filter von Hand brachten nur ~8 %.

`--backfill` trägt die Felder auf bestehenden Einträgen nach (ohne Browser, nur
BRouter + DEM), `--backfill --force` rechnet auch schon vorhandene Werte neu.
1,5 s Pause zwischen den Segmenten, der BRouter-Server ist ein Gratis-Dienst.

### Die echte Spur (track.json) — und warum die Schätzung ersetzt gehört

Am 2026-07-20 im nachgeladenen `functions.min.js` der Tracker-Seite gefunden:

```
export/gpx/generate.php?deviceId=<deviceId>          ← funktioniert
application/get/get_route.php?id=…                    ← Cloudflare 403
application/get/get_historical_waypoint_data.php?id=… ← Cloudflare 403
```

Der GPX-Export liefert die **komplette Aufzeichnung seit dem Start**: Position,
GPS-Höhe und Zeitstempel je Punkt, im Median **alle 5 Minuten**. Muss aus dem
geladenen Tab heraus geholt werden (`page.evaluate` + `fetch`), direkt gibt es
auch hier 403. `rider.deviceId` ist der richtige Parameter (nicht `id`, nicht `imei`).

Landet in `track.json` als kompakte Arrays `[lat, lon, eleGps, unixSec]`.

**Wichtig:** die `eleGps`-Werte sind rohe GPS-Höhen und dürfen **nicht** aufsummiert
werden — sie streuen mit ~20 m gegen das Geländemodell und ergäben über die ersten
405 km 3.379 statt ~2.750 hm.

**Offene, gemessene Erkenntnis (2026-07-20):** die aktuelle Schätzung über
BRouter-Segmente *zwischen unseren Meldungen* liegt zu hoch, weil sie die Route
dazwischen errät. Für dasselbe 44,6-km-Stück:

| Methode | Länge | ↑ hm |
|---|---|---|
| BRouter zwischen den 4 Meldungen (aktuell im Board) | 45,0 km | 372 |
| BRouter **entlang der echten Spurpunkte** (20er-Blöcke als Wegpunkte) | 44,4 km | **301** |
| rohe GPS-Höhe | — | verrauscht, zu hoch |

Der Umbau darauf steht noch aus. Er würde zusätzlich die größte Lücke schließen:
das Profil beginnt aktuell erst bei 360 km (erste eigene GPS-Meldung), die Spur
reicht dagegen bis Trondheim zurück. Dabei zu beachten: BRouter nicht bei jedem
Lauf über die ganze Spur laufen lassen, sondern nur über das neue Ende.

Race-Window-Guard: läuft nur zwischen `settings.start` und `settings.deadline + 1 Tag`
(liest das direkt aus `data.json`), damit der geplante Job vor/nach dem Rennen
stillschweigend überspringt statt Fehlermeldungen zu produzieren.

Rider-Zuordnung über `CONFIG.riderName` (exakter Name wie auf dem Tracker,
aktuell `"Manuel Kaufer"`) — sucht in `ridersArray` nach `riderName`-Match, kein
hartkodiertes Tracker-ID mapping (Tracker-Nummern aus dem Leaderboard sind ein
anderer ID-Namespace als die internen `ridersArray`-Keys).

## Automatisierung (launchd)

`~/Library/LaunchAgents/com.digitalerdude.tcr84-tracker-updater.plist` — läuft
alle 30 Minuten (`StartInterval: 1800`, seit 2026-07-20; davor stündlich — der
Tracker selbst meldet deutlich häufiger, `lastReportMins` lag im Test bei 2–7
Minuten, stündliches Abfragen hat also unnötig Auflösung verschenkt), ruft
`update-tracker.mjs --commit --push` auf. `RunAtLoad` ist gesetzt: ein
`launchctl bootstrap` nach dem Editieren startet den Job **sofort** mit, inklusive
Push — vor dem Neuladen also schauen, was gerade uncommittet im Baum liegt.
Läuft in der GUI-Session des Users (nicht als reiner Daemon), das ist nötig, damit
der "headed"-Chromium-Start funktioniert (siehe oben).

```bash
launchctl list | grep tcr84                                          # Status
tail -f ~/Projekte/tcr84/tools/update-tracker.log                     # Log
launchctl kickstart -k gui/$(id -u)/com.digitalerdude.tcr84-tracker-updater  # sofort auslösen
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.digitalerdude.tcr84-tracker-updater.plist  # stoppen
```

## index.html — UI-Konventionen

- Kein Framework, kein Build. Direkt editieren, direkt committen.
- `EDIT`-Modus (`#edit` im URL-Hash) zeigt das manuelle Eintrags-Formular; der
  öffentliche Board-View bleibt read-only und einfach.
- Neue optionale Detail-Ebenen (z. B. der GPS-Log-Zeilen-Expand, die Karte) sind
  bewusst **standardmäßig eingeklappt** (`<details>`/Klick-Toggle) — die mobile
  Startansicht soll schlank bleiben, tiefere Daten sind einen Klick entfernt, nicht
  auf der ersten Bildschirmseite.
- Höhenprofil (`#profileWrap`, `renderProfile()`): handgebautes SVG, **kein
  Chart-Framework**. Wird auf die tatsächliche Container-Breite gerechnet
  (1 SVG-Einheit = 1 px), damit Schriftgrößen auf dem Handy echte Pixel sind statt
  hochskalierter Miniaturen — deshalb der entprellte `resize`-Handler daneben.
  Zwei Ebenen: die dichte Linie aus den `track`-Arrays (~1 Stützpunkt je km) und die
  Meldungen als Punkte darauf. Farben über CSS-Klassen (`.pl`, `.gl`, `.pdot` …)
  statt `var()` in SVG-Präsentationsattributen. Zeiger per `pointermove`/`pointerdown`
  auf einem transparenten `<rect>`, also auch auf Touch bedienbar.
- **Testmodus Höhenprofil:** `PROFILE_TEST = true` im Script blendet eine
  „Testmodus“-Kennzeichnung neben der Überschrift ein und hängt einen Prüfkasten in
  den Erklärkasten: Manuel rechnet bis Flåm (700 km) mit rund 5.400 hm, das Board
  rechnet seinen bisherigen hm/km-Schnitt dagegen hoch. Auswertung war für den Abend
  des 21.07.2026 geplant — **danach hier auf `false` stellen**, sonst steht die
  Kennzeichnung für immer da. Referenzwerte in `PROFILE_TEST_REF`.
- Karte: Leaflet + OpenStreetMap-Tiles, per CDN erst beim Öffnen von
  `<details id="mapDetails">` nachgeladen (`ensureLeaflet()`), kein Impact auf die
  normale Ladezeit.
- Wetter: kompakte Zeile im Masthead (`#wxLine`), Quelle
  [Open-Meteo](https://open-meteo.com/) (kein API-Key, CORS-fähig, direkt aus dem
  Browser). Gekoppelt an die Koordinaten der **letzten Meldung mit `lat`/`lon`**, nicht
  an eine feste Startnummer-Position. Läuft über ein eigenes `setInterval` (15 Min),
  bewusst entkoppelt vom 5-Min-`data.json`-Poll — Wetter aktualisiert sich unabhängig
  davon, ob neue Positionsdaten reinkommen. Zeigt nur, was fürs Radfahren zählt:
  Temperatur/gefühlte Temperatur, Wind (Stärke/Richtung/Böen, ab 30 km/h bzw. 45 km/h
  Böen farblich hervorgehoben), Niederschlag falls >0. Kein Icon/Zeile ohne
  GPS-Position (noch keine automatische Meldung erfasst).
- `render()` läuft alle 60s (lokal neu berechnet) und alle 5 Min wird `data.json`
  neu vom Server geholt. Log-Zeilen werden bei jedem `render()` komplett neu gebaut
  — ein manuell aufgeklappter GPS-Detail-Toggle fällt beim nächsten Tick wieder
  automatisch zu (bekannter, unkritischer Rough Edge).

## Sonstiges

- `tools/node_modules/`, `tools/update-tracker.log`, `tools/*.png`/`*.dump.json`
  sind über `tools/.gitignore` ausgeschlossen.
- Startnummer-84-Zuordnung zu Manuel Kaufer ist laut Footer-Text "nicht unabhängig
  verifiziert" — das ist Absicht, nicht vergessen zu entfernen.
