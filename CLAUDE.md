# CLAUDE.md — tcr84

Dotwatch-Board für Manuel Kaufer (Startnummer 84) beim Transcontinental Race No12
(Trondheim → Kalamata, 19.07.–08.08.2026). Statische Single-Page-App, gehostet über
GitHub Pages direkt von `main` (`https://digitalerdude.github.io/tcr84/`).

## Struktur

| Datei | Zweck |
|---|---|
| `index.html` | Die ganze App: Vanilla-JS, kein Build-Step. CSS-Variablen in `:root` sind das Design-System (`--night`, `--panel`, `--brass`, `--mono` etc.) — neue UI hält sich daran, keine Hardcoded-Farben. |
| `data.json` | Der Datenspeicher. Wird von GitHub Pages ausgeliefert, `index.html` lädt ihn per `fetch('data.json?t=...')`. Schreibrechte nur über Git-Commit ins Repo (kein Server, kein Backend). |
| `track.json` | Archiv der **echten gefahrenen Spur** aus dem GPX-Export des Trackers, siehe unten. Wird bei jedem Lauf komplett neu geschrieben. Rohdaten, vom Frontend nicht gelesen. |
| `profile.json` | Das daraus gerechnete Höhenprofil (Stützpunkte + kumulierte Höhenmeter je Block). **Einzige Quelle für alle Höhenangaben im Board.** Eigener Ladetakt im Frontend (15 Min), weil es die größte Datei ist. |
| `tools/update-tracker.mjs` | Automatisierter Scraper, siehe unten. |
| `tools/package.json` | Playwright-Dependency für den Scraper. `cd tools && npm install`. |

## data.json-Schema

```jsonc
{
  "settings": { "totalKm": 4800, "start": "...", "deadline": "...", "cps": [...] },
  "live": {                   // Live-Stand, wird bei JEDEM Lauf überschrieben
    "ts": "2026-07-20T21:28", // wann wir zuletzt nachgesehen haben
    "km": 404.92,
    "fixMinsAgo": 35,         // wie alt die Trackermeldung dabei war
    "speed": 0, "rank": 67,
    "stopSince": "2026-07-20T18:55"  // nur wenn gerade eine Pause läuft
  },
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

**`live` vs. `entries` — nicht verwechseln:** `entries` ist das Protokoll und
bekommt nur einen Eintrag, wenn sich der Kilometerstand um mindestens
`minKmDelta` (1 km) bewegt hat. Steht der Fahrer, entsteht stundenlang keiner —
das Board sah dadurch eingefroren aus, obwohl der Stillstand die eigentliche
Information war. `live` wird dagegen bei jedem Lauf geschrieben und trägt im
Board die Kopfzeile (`renderLive()`) mit drei unterscheidbaren Zuständen:
Pause läuft / unterwegs / **unser Abruf hängt** (ab 150 Min ohne neuen `live.ts`).
Der dritte ist der wichtigste — ohne ihn ist von außen nicht zu erkennen, ob der
Fahrer steht oder der launchd-Job tot ist.
Die Kennzahlen rechnen weiter ausschließlich mit `entries`; `live` fließt nur in
Anzeigen ein, die Aktualität ausdrücken („zuletzt gesehen vor …“).

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
node update-tracker.mjs --places              # Ortsnamen bestehender Einträge neu auflösen (ohne Browser)
```

### Ortsnamen (Nominatim)

`reverseGeocode()` fragt mit **`zoom=14`** ab, nicht mit 12. Stufe 12 ist die
Gemeindeebene, und norwegische Kommunen sind riesig: drei aufeinanderfolgende
Meldungen am 21.07.2026 über 44 km Fahrt bekamen alle „Nord-Fron" (~1.100 km²)
und das Log sah aus, als stünde er seit drei Stunden am selben Fleck.

Feldpriorität: `village → hamlet → town → city → suburb → name → municipality →
county`. `name` steht bewusst **vor** der Gemeinde, aber **hinter** allen echten
Siedlungsfeldern — auf Stufe 14 ist `name` ein lokaler Flur-/Hofname
(Vollsætra, Myreng), nicht jedem ein Begriff, aber ein echter Punkt auf der Karte
statt eines Landkreises. **Nicht auf zoom=16 hochdrehen:** dort ist `name` meist
der Straßenname (Skåbuvegen), als Ortsangabe unbrauchbar. Bleibt alles leer, ist
es tatsächlich Niemandsland — dann ist die Gemeinde die ehrliche Antwort und darf
sich auch wiederholen.

Nach einer Änderung an dieser Kette `--places` laufen lassen, sonst stehen alte
grobe und neue feine Namen im selben Log nebeneinander. Der Modus fasst nur
Einträge mit `lat`/`lon` an (von Hand gesetzte bleiben unberührt) und hält 1,1 s
Abstand je Anfrage — Nominatims Nutzungsregeln erlauben eine pro Sekunde.

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
beiden Segmenten — Tracker-Delta als Referenz für die Länge:

| Profil | Länge Seg1 / Seg2 | Summe hm |
|---|---|---|
| `trekking` | +2,66 / −0,36 km | 372 ← gewählt |
| `fastbike` | +1,63 / +0,57 km | 553 |
| `shortest` | +0,52 / −0,58 km | 472 |

Die Länge entscheidet nichts (jedes Profil gewinnt ein Segment), die Höhe schon:
`fastbike` nimmt im Gudbrandsdal die andere, hügeligere Talseite und liefert 49 %
mehr Höhenmeter für dieselbe Strecke — ein Indiz dafür, dass es systematisch
umwegiger routet, nicht dass es genauer wäre. Das gewählte Profil steht in jedem
Eintrag als `climbSrc` (`"brouter:trekking"`), ein Wechsel plus
`--backfill --force` bleibt dadurch nachvollziehbar.

(Frühere Fassung dieser Notiz rechnete die Segmentwerte linear auf 700 km bis
Flåm hoch und verglich das mit „Manuels ~5.400 hm bis Flåm“ — das beruhte auf
einem Missverständnis: Manuel meinte damit die *morgige Restetappe* ab der
aktuellen Position [Sør-Fron, km 405] nach Flåm [km 700], also 295 km, nicht die
Gesamtstrecke ab Trondheim. Die beiden vermessenen Segmente lagen zudem in einem
Flusstal mit vergleichsweise sanftem Profil (~800–950 hm/100 km); die Etappe nach
Flåm quert das Hochgebirge vor den Fjorden und dürfte deutlich steiler sein. Eine
lineare Hochrechnung war deshalb ohnehin nicht aussagekräftig für die
Profil-Wahl — die blieb aus dem harten Indiz oben: `fastbike` nimmt nachweislich
den Umweg über die falsche Talseite.)
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

### profile.json — die Höhenrechnung

`updateProfile()` schreibt das Profil **inkrementell** fort: pro Lauf wird nur das
neu hinzugekommene Ende der Spur an BRouter geschickt (bei stündlichem Abruf ~12
neue Punkte = ein bis zwei Anfragen). Die Spurpunkte gehen als **Wegpunktkette**
rein (`lonlats=a|b|c|…`), BRouter legt sie aufs Straßennetz und füllt nur die
Lücken von im Schnitt 1,6 km. Ein kompletter Neuaufbau über 4.800 km wäre sonst
jede Stunde ein paar hundert Anfragen an einen Gratis-Dienst.

```jsonc
{
  "startUnix": 1784484000,   // Nullpunkt für die Interpolation
  "throughUnix": 1784571485, // bis hierhin verarbeitet
  "anchor": [lat, lon, unix],// letzter verarbeiteter Punkt = Start des nächsten Blocks
  "routedKm": 418.2, "climbUp": 3536, "climbDown": 3283,
  "points": [[routedKm, m], …],          // alle 500 m
  "chunks": [[tEnd, kmEnd, cumUp, cumDown], …]  // kumuliert am Blockende
}
```

`chunks` hält bewusst nur den Stand am Blockende — das Board interpoliert dazwischen
linear (`cumClimbAt()`) und kann so Höhenmeter für beliebige Zeiträume ableiten:
je Meldung im Log, je Kalendertag in den Balken. Ein Block ist knapp eine Stunde
Fahrt (`waypointsPerRequest: 10` × ~5 Minuten).

**Warum die Kilometer skaliert werden:** `routedKm` ist BRouters Streckenlänge und
liegt ~3 % über der des Trackers (418 gegen 405 km). Das Frontend streckt beim
Zeichnen mit `kmScale = km / routedKm`, damit Profil, Leiter und Log auf derselben
Achse liegen. Getestet, dass das *nicht* am GPS-Zittern liegt: `minTrackPointMeters`
von 60 auf 150 und 300 zu erhöhen ändert die Gesamtlänge nicht.

**Messvergleich, der zu diesem Aufbau geführt hat (2026-07-20)**, alles auf demselben
44,6-km-Stück:

| Methode | Länge | ↑ hm |
|---|---|---|
| BRouter nur zwischen unseren 4 Meldungen | 45,0 km | 372 |
| BRouter entlang der echten Spurpunkte | 44,4 km | **301** |
| rohe GPS-Höhe aufsummiert | — | über 405 km 3.379 statt 3.536, aus Rauschen |

Race-Window-Guard: läuft nur zwischen `settings.start` und `settings.deadline + 1 Tag`
(liest das direkt aus `data.json`), damit der geplante Job vor/nach dem Rennen
stillschweigend überspringt statt Fehlermeldungen zu produzieren.

Rider-Zuordnung über `CONFIG.riderName` (exakter Name wie auf dem Tracker,
aktuell `"Manuel Kaufer"`) — sucht in `ridersArray` nach `riderName`-Match, kein
hartkodiertes Tracker-ID mapping (Tracker-Nummern aus dem Leaderboard sind ein
anderer ID-Namespace als die internen `ridersArray`-Keys).

## Automatisierung (launchd)

`~/Library/LaunchAgents/com.digitalerdude.tcr84-tracker-updater.plist` — läuft
stündlich (`StartInterval: 3600`), ruft
`update-tracker.mjs --commit --push` auf.

**Warum stündlich reicht:** kurzzeitig stand das Intervall auf 30 Minuten, um mehr
Auflösung fürs Höhenprofil zu bekommen. Das ist seit dem GPX-Fund hinfällig — der
Export liefert bei *jedem* Abruf die volle 5-Minuten-Spur seit dem Start, die
Profilauflösung hängt also gar nicht am Intervall. Daran hängt nur noch die Frische
der Kopfzahlen (km-Stand, Platz, „letzte Meldung vor…“), und dafür reicht stündlich.
Dagegen stehen 24 statt 48 Chromium-Starts und Commits pro Tag.

`RunAtLoad` ist **`false`**: ein `launchctl bootstrap` startet den Job also *nicht*
sofort, sondern **setzt den Stundentakt neu auf**. Nach einem Neuladen dauert es
dadurch bis zu einer vollen Stunde bis zum nächsten Lauf — wer sofort ein Ergebnis
will, nimmt `launchctl kickstart -k gui/$(id -u)/com.digitalerdude.tcr84-tracker-updater`.
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
- Höhenprofil-Diagramm: **aggregieren, nicht ausdünnen.** Am Ende stehen ~9.600
  Stützpunkte einer Breite von 340 Pixeln gegenüber, ein Pixel ist dann ~14 km.
  Jede Pixelspalte bekommt Minimum *und* Maximum ihrer Höhen (`cols` in
  `renderProfile()`), gezeichnet als Band zwischen beiden plus Linie auf der
  Gipfelhöhe. Würde man stattdessen jeden n-ten Punkt nehmen, verschwänden die
  Pässe — ein Gipfel zwischen zwei Stichproben ist weg, und die Alpen sähen
  flacher aus als die Poebene. Nicht auf „einfaches“ Sampling zurückbauen.
- Der Testmodus (sichtbare Kennzeichnung am Höhenprofil, 20.07.2026) ist mit dem
  Umbau auf die echte Spur entfallen — die Zahlen sind seitdem keine Schätzung
  über geratene Routen mehr. Offen bleibt ein Abgleich für den 21.07.2026: Manuel
  rechnet für seine **morgige Etappe** Sør-Fron (km 405) → Flåm (km 700, CP1, also
  295 km) mit rund 5.400 hm. Der passende Vergleich ist `climbUp` aus
  `profile.json` **speziell für dieses Zeitfenster** (`cumClimbAt()` am Anfang und
  Ende der Etappe, nicht die Gesamtsumme seit Trondheim) gegen diese 5.400 hm —
  nicht gegen eine Hochrechnung der bisherigen sanften Flusstal-Kilometer, die
  Etappe quert vermutlich deutlich steileres Gelände vor den Fjorden.
- Karte: Leaflet + OpenStreetMap-Tiles, per CDN erst beim Öffnen von
  `<details id="mapDetails">` nachgeladen (`ensureLeaflet()`), kein Impact auf die
  normale Ladezeit. `track.json` wird genauso lazy geholt (`ensureTrack()`) — es ist
  die größte Datei und wird sonst nirgends gebraucht.
  Gezeichnet wird die **echte Spur** (vorher nur eine Gerade zwischen den
  stündlichen Meldungen, die Kurven abschnitt), mit dunkler Unterlage darunter für
  Lesbarkeit auf bunten Kacheln. `findStops()` erkennt Pausen: aufeinanderfolgende
  Spurpunkte im Umkreis von 150 m, die länger als 40 Minuten dort bleiben. Ein
  Tracker-Ausfall sieht anders aus (nächster Punkt weit weg, keine Ansammlung).
  Die **laufende** Pause bekommt keinen eigenen Marker — sie läge unter dem
  Messingpunkt der aktuellen Position und wäre unklickbar, ihre Angaben stehen
  deshalb in dessen Sprechblase.
  Die Spur zeigt nur, **dass** er stand, nie warum — Schlaf, Panne und Einkauf
  sehen identisch aus. Deshalb heißt es überall neutral „Pause“; keine Texte
  einbauen, die auf Schlaf schließen.
  `fitBounds` läuft nur beim ersten Zeichnen (`mapFitted`): `renderMap()` hängt am
  60s-`render()`, ein Einpassen bei jedem Durchlauf würde herangezoomte Ansichten
  wegreißen.
- **Das Höhenprofil wird zweimal gezeichnet**, beide Male von `renderProfileInto()`,
  unterschieden über `prefix` für die Element-IDs (zwei Diagramme mit denselben IDs
  wären nicht ansprechbar; Zustand je Instanz in `PROFS[prefix]`):
  `renderProfile()` — eigenständig im Board, mit Kennzahlenstreifen und Erklärkasten.
  `renderMapProfile()` — nackt unter der Karte, dafür **an sie gekoppelt**: der
  Zeiger schiebt über `onHover` einen Marker (hohler heller Ring, absichtlich anders
  als die gefüllten Punkte für Pausen und Position) über die Karte mit.
  Kilometer → Koordinate macht `latLonAtKm()` über die aufsummierte Spurlänge,
  normiert auf die Renn-Kilometer. Gegenprobe bei 181 km: 62,615 °N / 11,371 °O bei
  670 m — das ist Røros (62,57 / 11,38, 630 m).
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
