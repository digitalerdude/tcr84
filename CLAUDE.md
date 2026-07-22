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
| `tools/check.mjs` | Invarianten-Prüfung der drei JSON-Dateien gegeneinander, siehe unten. |
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
      "ts": "2026-07-20T16:50", // Zeitpunkt der MESSUNG. Lokale Uhrzeit OHNE Zeitzone, siehe unten
      "tsSrc": "track",         // woher `ts` stammt: track | fix | scrape (fehlt = von Hand)
      "km": 360.17,
      "place": "Stor-Elvdal",
      "note": "Platz 66",
      "lat": 61.772323,         // optional, nur bei automatisch erfassten Einträgen
      "lon": 10.21984,          // optional
      "speed": 7.2,             // optional, km/h bei Erfassung
      "ele": 245,               // optional, Höhe in m an dieser Meldung
      "eleSrc": "dem",          // woher `ele` stammt: dem | gps
      "eleGps": 274             // optional, rohe GPS-Höhe des Trackers
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
Die Kennzahlen rechnen mit `entries` — mit **einer** Ausnahme, dem Ø-Schnitt
(seit 21.07.2026, siehe unten). Sonst fließt `live` nur in Anzeigen ein, die
Aktualität ausdrücken („zuletzt gesehen vor …”).

**Der Ø-Schnitt braucht den frischesten Messpunkt.** Ein Schnitt ist das
Verhältnis zweier Messungen und darf nur durch die Zeit geteilt werden, zu der
die Kilometer auch gemessen wurden. Zwei Fallen, beide dagewesen:

1. Durch die **laufende Rennuhr** geteilt (`now − start`) ließe ein Ausfall des
   Scrapers den Fahrer langsamer werden — eine erfundene Verlangsamung.
2. Durch die Zeit der **letzten Log-Meldung** geteilt wird eine Pause
   unsichtbar: unter `minKmDelta` entsteht keine Zeile, der Zähler bleibt
   stehen und der Schnitt friert auf dem Wert von vor der Pause ein. In der
   Nacht vom 20.07.2026 hätte das Board um 02:43 Uhr **17,6 km/h** behauptet
   — tatsächlich waren es **13,2**, ein Drittel zu hoch, und das floss über
   `eta` direkt in den Puffer auf das Zeitlimit.

Deshalb rechnet `compute()` mit dem frischesten Paar aus Kilometerstand und
Messzeit, und das ist bei laufender Pause `live` (`live.ts` minus
`fixMinsAgo` — der Zeitpunkt der Messung, nicht des Abrufs). Drei benannte
Zeitspannen halten das auseinander: `raceH` (laufende Rennuhr), `measuredH`
(Rennzeit bis zur frischesten Messung, Nenner des Schnitts) und `staleH` (wie
weit unser Wissen zurückliegt). `staleH` speist beide Warnhinweise — den
Zusatz „gemessen bis … zurück“ am Ø-Schnitt ab 1 h und den Satz im
Einschätzungskasten ab 3 h —, damit Kopfzeile, Kennzahl und Fließtext nicht
drei verschiedene Alter behaupten.

**Zusätzliche Felder sind sicher:** `renderLog()` und `compute()` ignorieren
unbekannte Keys, neue optionale Felder (wie `lat`/`lon`/`speed`) brechen nichts.

**Abgeschaffte Felder (21.07.2026):** `climbUp`/`climbDown`/`climbKm`/`climbSrc`/
`track` standen früher an den Einträgen (segmentweise geratene Höhenmeter);
`--backfill` hat sie abgeräumt. Höhenmeter kommen seither ausschließlich aus
`profile.json` — eine Wahrheit, ein Ort. `eleSrc:'route'` gibt es aus demselben
Grund nicht mehr, neue Einträge tragen `dem` oder `gps`.

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

**Wenn ein Lauf scheitert:** Der Abruf hängt an einer fremden Seite hinter
Cloudflare — dass er gelegentlich nicht durchkommt, ist Betriebsrisiko. Am
21.07.2026 lief `page.goto` in seinen 45-s-Timeout und der 17:06-Lauf fiel
komplett aus (1 Fehlschlag auf 22 Läufe). Seitdem: bis zu
`CONFIG.abrufVersuche` (3) Anläufe mit jeweils frischem Browser, 20 s Pause
dazwischen, Timeout auf 60 s erhöht. **Dauerhaft verloren geht durch einen
Fehlschlag ohnehin nichts** — der GPX-Export liefert beim nächsten
erfolgreichen Lauf die volle Spur seit dem Start, Spur und Höhenprofil holen
also lückenlos auf. Es fehlt allein eine Log-Zeile, und der Live-Stand in der
Kopfzeile bleibt bis zum nächsten Lauf stehen (ab 150 min zeigt das Board
dafür „Abruf hängt“). Nach einem Ausfall reicht ein manueller Lauf, um sofort
aufzuholen, statt auf die nächste volle Stunde zu warten.

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
node update-tracker.mjs --fixts               # Zeitstempel auf den Messzeitpunkt korrigieren (ohne Browser)
```

### Der Zeitstempel einer Meldung ist die Zeit ihres GPS-Punkts

Bis zum 21.07.2026 trug `ts` den Zeitpunkt **unseres Abrufs**. Position,
Kilometer, Tempo und Platz stammen aber alle vom letzten Fix davor — damals
1–4 Minuten früher, bei schlafendem Tracker auch mal 35. Bei 25 km/h waren das
bis zu 3,4 km Versatz zwischen Zeile und Wirklichkeit. Gefunden hat es
`check.mjs`: jede Meldung liegt auf 0–1 m genau auf einem Punkt aus
`track.json` — nur auf einem, der ein paar Minuten älter ist.

Genau das machte den Bestand korrigierbar, statt eine zweite Konvention
einführen zu müssen: der wahre Messzeitpunkt steht in der Spur und muss nur
nachgeschlagen werden. Seitdem gilt **eine** Regel für neue und alte Einträge,
umgesetzt in `trackTimeAt()` — gesucht wird über den **Ort**, denn die Zeit ist
ja das Gesuchte. Pflichtabstand 50 m, sonst bleibt der Eintrag unangetastet.

`tsSrc` hält fest, woher die Zeit kommt (gleiche Konvention wie `eleSrc`):
`'track'` aus der Spur (genau, Normalfall) · `'fix'` aus
`jetzt − lastReportMins` (Spur fehlt, auf ganze Minuten gerundet) · `'scrape'`
Abrufzeit (weder Spur noch Fix-Alter) · **fehlt** = von Hand gesetzt, wird nie
angefasst.

`--fixts` trägt das auf dem Bestand nach: ohne Browser, ohne Netz, idempotent
(der nächstgelegene Spurpunkt bleibt derselbe). Am 21.07.2026 einmal über 15
Einträge gelaufen, Korrekturen 1–5 Minuten. Beide Wege — neuer Eintrag wie
Nachkorrektur — schieben einen Zeitstempel **nie vor seinen Vorgänger**; das
Board rechnet Tempo aus aufeinanderfolgenden Zeilen, ein Tausch der
Reihenfolge würde negative Geschwindigkeiten erzeugen.

Dieselbe Regel gilt seit dem 21.07.2026 für die **Kilometer**: fällt der vom
Tracker gemeldete Stand unter die letzte Meldung (Neuberechnung serverseitig,
verrutschte Rider-Zuordnung), wird kein Eintrag geschrieben — nur Live-Stand
und Spur werden veröffentlicht, und `check.mjs` schlägt über
`live.km < letzter Eintrag` an, damit ein Mensch hinsieht.

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
umwegiger routet, nicht dass es genauer wäre. Das gewählte Profil steht im
`source`-Feld von `profile.json`, ein Wechsel plus `--backfill --force` bleibt
dadurch nachvollziehbar. (Achtung: ändert man `CONFIG.routeProfile`, passt
`source` nicht mehr und schon der nächste *stündliche* Lauf baut das Profil
komplett neu — am Rennende ein paar hundert BRouter-Anfragen. Einen Wechsel
also nur bewusst zusammen mit `--backfill --force` machen, nicht nebenbei.)

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

### Trackerstille ist kein Stillstand

Wenn nichts mehr hereinkommt, sieht das immer gleich aus — und heißt drei
verschiedene Dinge: er **steht**, er ist im **Funkloch**, oder der
**GPX-Export** ist tot. Am 22.07.2026 hat die Verwechslung zwei Stunden
Auffahrt auf den Aurlandsfjellet als Pause ausgegeben: Meldungen bis 04:29,
danach Stille, und `live.fixMinsAgo` wuchs auf 107. Tatsächlich fuhr er
durchgehend — der Queclink-Tracker hängt am Mobilfunk, auf der Hochebene ist
keiner, also hat er intern gepuffert und um 06:31 alles am Stück
nachgeliefert: +25 Spurpunkte, +16,4 km, +914 hm.

**Unterschieden wird am Schwanz der Spur, nicht an ihrem Ende** — das Ende ist
in allen Fällen dasselbe Nichts:

| | letzte Punkte davor | Live-Fix |
|---|---|---|
| **Pause** | alle ~5 min einer, Deltas 3–37 m (21.07., 17:58–19:34) | altert mit |
| **Funkloch** | alle ~5 min einer, Deltas 229–479 m (22.07., bis 04:29) | altert mit |
| **Export tot** | beliebig | bleibt **frisch** |

Der Tracker meldet im Stand also **unbeirrt weiter** — eine echte Pause
hinterlässt eine dichte Traube auf einem Fleck, erst danach schläft er ein
(21.07.: 19:34 → 03:00 am selben Ort). Ein Funkloch hinterlässt gar nichts,
und davor volle Fahrt. Ein Radfahrer verschwindet nicht mitten im Antritt.

Bei „Export tot“ zählt der **Abstand** der beiden Alter, nicht die Frische des
Live-Fixes: schweigt der Tracker, altern Spur und Live-Stand im Gleichschritt,
und daran ist der Export unschuldig.

`check.mjs` entscheidet das seit dem 22.07.2026 automatisch (siehe unten).
Nirgends aber darf das Board daraus „er steht“ machen — die Spur kennt den
Grund nicht, das ist dieselbe Regel wie bei Schlaf vs. Panne bei der Karte.
Im Zweifel ist „seit X keine Meldung“ die ehrliche Aussage.

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

## tools/check.mjs — die Invarianten

Kein Test-Framework, kein Netz, keine Abhängigkeiten: ein Skript, das
`data.json`, `track.json` und `profile.json` **gegeneinander** prüft. Der
Gedanke dahinter: die drei Dateien beschreiben dieselbe Fahrt aus drei
Blickwinkeln und müssen sich gegenseitig bestätigen. Die Summe der Tagesbalken
*muss* die Gesamtstrecke ergeben, die Summe der Tages-Höhenmeter die
Gesamtsumme, eine Meldung *muss* auf der aufgezeichneten Spur liegen. Bricht
eine dieser Beziehungen, ist irgendwo eine zweite Wahrheit entstanden — und
daran sind hier bisher fast alle Fehler entstanden.

```bash
node check.mjs           # Bericht, Exit 1 nur bei FEHLER
node check.mjs --quiet   # nur FEHLER und WARNUNG
```

`update-tracker.mjs` ruft `runChecks()` nach jedem Lauf auf (`checkAndLog()`,
nach dem Schreiben, vor dem Commit) und protokolliert das Ergebnis ins Log.
**Bewusst nicht abbrechend:** eine verletzte Invariante ist ein Grund
hinzusehen, kein Grund, den frischen Live-Stand zu verwerfen.

Drei Stufen: `FEHLER` (Datenstand ist in sich widersprüchlich), `WARNUNG`
(auffällig, aber erklärbar — Tracker schläft, Job hängt), `ok` (bestandene
Prüfung, wird mitprotokolliert, damit sichtbar ist *was* geprüft wurde).
Toleranzen stehen gesammelt in `TOL` oben im Skript, nicht im Code verstreut.

Zwei Eigenheiten, die nicht "vereinfacht" gehören:

- **`cumAt()` dupliziert `cumClimbAt()` aus `index.html` absichtlich.** Prüfte
  die Prüfung mit dem Code des Boards, könnte sie einen Denkfehler im Board
  nicht finden, sondern würde ihn nachvollziehen.
- **Meldung ↔ Spur wird über den ORT verglichen, nicht über die Zeit.** Gesucht
  ist der Spurpunkt, an dem die Meldung entstand; der Zeitversatz zu ihm ist
  dann die Aussage (= wie alt der Fix beim Abruf war). Umgekehrt herum schlägt
  die Prüfung falsch an: bei 30 km/h sind 4 Minuten Versatz 2 km Abstand.

**Beim ersten Lauf (21.07.2026) hat es zwei echte Sachen gefunden:**

1. `climbDown` konnte um 1 hm *fallen*. `down = filtered ascend − plain-ascend`,
   und auf einem durchgehend steigenden Block liegt die entrauschte Summe
   manchmal knapp unter der Netto-Differenz. Negative Bergab-Höhenmeter gibt es
   nicht — in `brouterRoute()` jetzt bei 0 geklemmt. Der Altbestand in
   `profile.json` behält die beiden Rundungsschritte (ein Neuaufbau wären
   hunderte BRouter-Anfragen für 2 hm), `check.mjs` kennt sie und meldet sie
   als bekannt statt als Fehler.
2. **`entry.ts` war der Zeitpunkt unseres Abrufs, nicht der der Messung** —
   behoben am selben Tag, siehe „Der Zeitstempel einer Meldung ist die Zeit
   ihres GPS-Punkts“ oben. `check.mjs` bewacht es weiter: es warnt bei
   GPS-Meldungen ohne `tsSrc` und wenn irgendwo mehr als 3 Minuten Versatz
   zwischen Zeitstempel und zugehörigem Spurpunkt stehen bleiben.

**„Pause oder Funkloch?“ (seit 22.07.2026).** Setzt die Regel aus
„Trackerstille ist kein Stillstand“ (oben) in eine Prüfung um. Ab
`TOL.funkstilleMin` (45 min) ohne neuen Spurpunkt wird der Schwanz der Spur
befragt und einer von vier Sätzen ausgegeben: laufender Kontakt · Funkloch
(WARNUNG) · er steht, Tracker schläft (ok) · GPX-Export tot (WARNUNG).

Beurteilt wird eine **Rate**, nicht eine nackte Strecke: rückwärts wird
gesammelt, bis `TOL.fahrtFensterMin` (30 min) voll ist, aber immer mindestens
ein Schritt — ein starres Zeitfenster ginge dort leer aus, wo die Punkte dünn
stehen (am Ende einer Pause, wenn der Tracker schon einschläft), und die
Prüfung müsste passen, obwohl der eine Schritt davor die Antwort enthält.
Grenze ist `TOL.fahrtMeter / TOL.fahrtFensterMin` = 500 m / 30 min ≈ 17 m/min,
gut 1 km/h. Geeicht an den beiden echten Fällen: Nachtpause 27 m/30 min,
Auffahrt 1.200 m/30 min — dazwischen ist viel Platz.

Die alte Prüfung `spurAltMin` (WARNUNG ab 3 h alter Spur, „Tracker aus, oder
GPX-Export liefert nicht mehr“) ist dadurch ersetzt. Sie hat in der Nacht vom
21.07. viermal hintereinander eine völlig normale Schlafpause angemeckert und
dabei die falsche Ursache geraten — genau der Fehlschluss, den die neue
Prüfung auseinandernimmt.

Verifiziert vor dem Einbau gegen sieben Fälle mit eingefrorener Uhr (frischer
Kontakt · das Funkloch vom 22.07. · echte Nachtpause · toter Export · Pause
mit schon dünnen Punkten · Tiefschlaf nach 446-min-Lücke · Grenzfall knapp
über der Schwelle) — jeweils gegen die **echte** Spur, an der gewünschten
Stelle abgeschnitten.

## Automatisierung (launchd)

`~/Library/LaunchAgents/com.digitalerdude.tcr84-tracker-updater.plist` — tickt alle
5 Minuten (`StartInterval: 300`), ruft
`update-tracker.mjs --commit --push --scheduled` auf.

**Häufig ticken, selten arbeiten.** Der Takt sagt nichts darüber, wie oft ein
Browser startet: `--scheduled` lässt den Lauf **vor** dem Browserstart abbrechen,
wenn `live.ts` jünger ist als `CONFIG.laufFaelligNachMin` (25 min). Ein nicht
fälliger Tick kostet dadurch 0,2 Sekunden und keinen Chromium-Start. Von zwölf
Ticks je Stunde arbeiten also zwei — ~48 echte Läufe am Tag.

**Die zwei Zahlen machen zwei verschiedene Dinge, und nur zusammen ergeben sie
Sinn.** `laufFaelligNachMin` bestimmt, wie alt die Kopfzahlen im Board werden
dürfen. Der `StartInterval` bestimmt, wie schnell sich ein Fehlschlag auswächst:
scheitert ein Lauf, bleibt `live.ts` alt, und der nächste Tick ist sofort wieder
fällig. Feiner ticken kostet also fast nichts und verkürzt genau die Zeit, in der
niemand hinsieht.

| | vorher | seit 22.07.2026 |
|---|---|---|
| Tick | 15 min | **5 min** |
| fällig ab | 50 min | **25 min** |
| echter Abstand zweier Läufe | 60 min | **25 min** |
| Erholung nach einem Fehlschlag | bis 15 min | **bis 5 min** |

Vorher waren 15 und 50 zudem schlecht aufeinander abgestimmt: bei 15-Minuten-Ticks
wird eine 25-Minuten-Fälligkeit erst nach 30 Minuten wahr (15 ist noch zu früh),
der Takt wäre also gar nicht angekommen. Erst 5-Minuten-Ticks lösen die 25 auch
wirklich ein.

**Warum überhaupt runter von 50 Minuten:** 50 hieß in der Praxis ein Abruf pro
Stunde, und damit konnte das Board der offiziellen Seite fast eine Stunde
hinterherhinken. Am Morgen des 22.07.2026 kam Manuel um 06:31 aus dem Funkloch am
Aurlandsfjellet zurück, der letzte Abruf lag bei 06:16, der nächste wäre erst
07:16 fällig gewesen — 45 Minuten, in denen die Tracker-Seite ihn fahren sah und
das Board ihn stehen ließ. Weiter runter als 25 lohnt nicht: der Tracker selbst
meldet nur alle ~5 min, und die Spur kommt ohnehin komplett per GPX-Export nach.

**Der Gewinn ist die Erholung.** Scheitert ein Lauf, bleibt `live.ts` alt — und
schon der nächste Tick arbeitet wieder. Aus „eine Stunde ohne Daten“ wird
„höchstens eine Viertelstunde“, ohne Zutun. Das ist der Fall, für den es gebaut
ist: niemand sitzt am Mac, und der Ausfall soll sich von selbst auswachsen.
Zusammen mit den drei Anläufen *innerhalb* eines Laufs (siehe oben) muss schon
sehr viel zusammenkommen, damit eine Lücke entsteht.

### Ein hängender Lauf ist schlimmer als ein gescheiterter

Die Wiederholung oben trägt nur, solange der Job überhaupt **endet**. launchd
startet keinen zweiten Durchlauf, solange der erste noch läuft — bleibt also
irgendwo etwas stehen, tickt der Job **nie wieder** und braucht genau den Anstoß
von Hand, den er sich selbst nicht holen kann. Ein toter Lauf dagegen kostet
nichts: der GPX-Export liefert beim nächsten Mal die volle Spur seit dem Start.
Deshalb gilt durchweg **lieber hart abbrechen als warten** (alles 22.07.2026):

- **`CONFIG.laufDeadlineMs` (10 min) — der Wachhund.** Ein `setTimeout` am
  Dateiende schießt den Prozess ab, wenn ein Lauf aus dem Ruder läuft. `.unref()`,
  damit er einen normalen Lauf (real 30–60 s) nicht künstlich offenhält.
  Chromium wird vorher per `SIGKILL` mitgenommen — `process.exit()` ließe ihn
  sonst als Waise zurück, und nach ein paar Läufen stehen Fenster im Nirgendwo
  herum.
- **Gegen synchrone Blocker hilft der Wachhund nicht.** `execFileSync` hält den
  Event-Loop an, der Timer feuert dann nie. Deshalb bringt `git()` sein eigenes
  `timeout` (90 s) mit — und `GIT_TERMINAL_PROMPT=0`: ein `git push`, das um vier
  Uhr früh auf einen Passwort-Dialog wartet, hängt für immer. Scheitern ist
  heilbar, Warten nicht.
- **Jeder `fetch` hat eine Deadline** (`CONFIG.netzTimeoutMs`, 25 s), auch der
  GPX-Export, der im Seitenkontext läuft.

### Die Push-Leiter

Ein abgelehnter Push war der letzte verbliebene Dauerschaden: ist der Fernstand
einmal vorausgelaufen, scheitert **jeder** folgende Push aus demselben Grund. Der
Job liefe munter weiter, sammelte brav Daten — und nichts davon käme je auf dem
Board an. `pushMitErholung()` arbeitet deshalb drei Stufen ab:

1. `git push`. Normalfall.
2. `git pull --rebase` + `push`. Deckt den häufigen Fall ab: woanders wurde am
   Quelltext gearbeitet, unsere Datencommits passen konfliktfrei obendrauf.
3. Kollidiert der Rebase **ausschließlich** in `data.json`/`track.json`/
   `profile.json`, gewinnt unser Stand: `reset --hard @{u}`, die drei Dateien
   zurückschreiben, neu committen. Das ist kein Trotz, sondern folgt aus der
   Architektur — alle drei werden bei jedem Lauf vollständig neu berechnet, der
   Fernstand ist dieselbe Ableitung, nur älter. Es gibt darin nichts, was uns
   fehlen könnte.

Stufe 3 hat zwei harte Sperren, und beide sind wichtiger als die Selbstheilung:
Berührt der Konflikt **eine Quelldatei**, bricht sie ab — die kann niemand
nachrechnen, und fremder Code, den ein Nachtjob wegwirft, ist schlimmer als ein
stehendes Board. Und ist der **Arbeitsbaum sonst nicht sauber**, ebenfalls: wer
gerade nebenher am Board arbeitet, soll das nicht durch ein `reset --hard`
verlieren. In beiden Fällen wird der Rebase sauber abgebrochen, der Commit bleibt
lokal liegen, der nächste Lauf nimmt ihn mit — und wenn das Board dadurch wirklich
alt wird, meldet sich der Wächter von selbst, der sieht ja den Fernstand.

Geprüft gegen echte Wegwerf-Repos, mit dem echten Modul (nur der Selbstaufruf
`main()` am Ende gegen ein `export` getauscht): Konflikt nur in den Datendateien
→ heilt und pusht · nächster Lauf danach → wieder Normalbetrieb · Konflikt in
einer Quelldatei → verweigert, Arbeitsbaum sauber, lokale Änderung erhalten.

**Was auch das NICHT abfängt:** einen dauerhaften Defekt (Chromium nach einem
Update kaputt, Cloudflare sperrt systematisch, Seitenstruktur geändert, Netz zu
Hause weg). Dagegen hilft kein Wiederholen, sondern nur eine Benachrichtigung —
dafür gibt es den Wächter (siehe unten). Die Arbeitsteilung ist bewusst so:
**der Mac versucht sich selbst zu retten, GitHub schlägt Alarm, wenn es nicht
gelingt.**

**Schlafender Mac:** `StartInterval` feuert verpasste Läufe nach dem Aufwachen
nach — zugeklappt passiert nichts, nach dem Öffnen holt der Job von selbst auf.

**Warum der Takt die Höhenauflösung nicht beeinflusst:** die hängt seit dem
GPX-Fund nicht am Intervall (der Export liefert bei jedem Abruf die volle
5-Minuten-Spur seit dem Start). Am Takt hängt nur die Frische der Kopfzahlen und
die Erholungszeit nach einem Fehlschlag.

`RunAtLoad` ist **`false`**: ein `launchctl bootstrap` startet den Job also *nicht*
sofort, sondern **setzt den Takt neu auf**. Wer sofort ein Ergebnis
will, nimmt `launchctl kickstart -k gui/$(id -u)/com.digitalerdude.tcr84-tracker-updater`
oder ruft das Skript direkt auf — ein Lauf von Hand kennt kein `--scheduled` und
arbeitet deshalb immer sofort.
Läuft in der GUI-Session des Users (nicht als reiner Daemon), das ist nötig, damit
der "headed"-Chromium-Start funktioniert (siehe oben).

```bash
launchctl list | grep tcr84                                          # Status
tail -f ~/Projekte/tcr84/tools/update-tracker.log                     # Log
launchctl kickstart -k gui/$(id -u)/com.digitalerdude.tcr84-tracker-updater  # sofort auslösen
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.digitalerdude.tcr84-tracker-updater.plist  # stoppen
```

## .github/workflows/waechter.yml — der Wächter

Läuft in **GitHubs Cloud, nicht auf dem Mac** — das ist der ganze Punkt: er
merkt auch dann etwas, wenn der Mac das Problem *ist*. Stündlich (`cron`,
zusätzlich von Hand über `workflow_dispatch` auslösbar) prüft er, wie alt
`live.ts` in `data.json` ist, und legt ab `SCHWELLE_MIN` (180) ein Issue an;
GitHub verschickt die Mail. Kommen wieder Daten, kommentiert und schließt er
es von selbst.

Drei Regeln, damit er nicht zum Nörgler wird:

- **Nur im Rennfenster** (`settings.start` … `deadline` + 1 Tag, direkt aus
  `data.json`) — davor und danach schweigt er.
- **Nachtruhe 23–7 Uhr lokal.** Nachts ist der Mac oft legitim aus, und eine
  Meldung um 3 Uhr hilft niemandem; was um 23 Uhr auffällt, meldet der Lauf um
  7 Uhr.
- **Ein Issue, nicht stündlich eins.** Vor dem Anlegen wird nach einem offenen
  mit demselben Titel gesucht.

**Die Zeitzone ist hier die Falle**, schärfer als sonst: der Runner läuft in
**UTC**, `live.ts` trägt lokale Zeit *ohne* Suffix. Ein nacktes `new Date(ts)`
wäre zwei Stunden daneben — also `alsLokal()` mit `+02:00`. Das Rennen liegt
komplett in der Sommerzeit, deshalb ist der feste Offset richtig; für ein
Rennen über den Zeitumstellungstermin müsste das anders gelöst werden.

Die 180 Minuten haben Luft mit Absicht: ein gesundes System schreibt
mindestens stündlich, also darf mehrfach hintereinander etwas schiefgehen,
bevor jemand behelligt wird. Getestet wurde die eingebettete Logik vor dem
ersten Scharfschalten gegen ein nachgebautes GitHub-API mit eingefrorener Uhr
(10 Zweige: frisch/alt, Tag/Nacht, vor/im/nach dem Rennen, Issue schon offen,
`live` fehlt, Grenzfälle 179 und 181 Minuten).

## index.html — UI-Konventionen

- Kein Framework, kein Build. Direkt editieren, direkt committen.
- **Tonlage: das Board soll motivieren, nicht sezieren.** Manuel liest selbst mit.
  Deshalb gibt es bewusst **keinen Platz-Verlauf/Rang-Trend** — der fällt bei
  jeder Schlafpause und würde demotivieren (Entscheidung 21.07.2026, nicht
  wieder vorschlagen). Der aktuelle Platz steht als Momentaufnahme in Kopfzeile
  und Log, aber nichts zeichnet seine Kurve. Stattdessen feiert das Board:
  ein frisch erreichter Kontrollpunkt (< 24 h, `cpReached` in `compute()`)
  bekommt einen 🎉-Satz im Einschätzungskasten und pulsiert golden in der
  Leiter (`.anchor.fresh`); läuft eine Pause, stellt der Kasten die
  Tagesleistung daneben („Heute stehen schon X km und ↑ Y hm in den Beinen —
  die Pause ist verdient“, ab 30 Tages-km, aus `cumClimbAt()` seit
  Mitternacht). Der Zuspruch bleibt neutral zum Grund der Pause — siehe die
  Schlaf-Regel bei der Karte.
- **Feiermoment beim Kontrollpunkt** (`maybeCelebrate()`/`showCelebration()`):
  vollflächiger Kasten mit grünem Haken (SVG, zeichnet sich per
  `stroke-dashoffset` selbst) und Konfetti (~80 `<i>`, gemeinsame Keyframe-
  Regel, Drift/Drehung/Dauer je Teil über CSS-Variablen — kein Animations-Loop
  in JS, keine Bibliothek). Gilt für **alle** Kontrollpunkte, nicht nur CP1 —
  der Kasten hängt an `settings.cps`, nicht an einem Namen. Damit sich vier
  Feiern nicht gleich anfühlen, zeigt er die Stelle in der Kette: Zähler in
  der Überzeile („Kontrollpunkt 2 von 4“), eine Punktreihe (erledigt gefüllt,
  kommend hohl, das Ziel als Raute) und das nächste Etappenziel mit Distanz.
  Gezählt wird über die Kilometer aus der Liste, nicht über Namen — kommt ein
  CP dazu oder verschiebt sich einer, stimmt der Zähler weiter. Kalamata
  bekommt eine eigene Textfassung („Zieleinlauf“) und hat kein nächstes Ziel.
  **Einmal je Gerät und Kontrollpunkt**, gemerkt in `localStorage` unter
  `tcr84:cpSeen` (Liste der Namen). Ohne diese Sperre ginge das Konfetti bei
  jedem 60-Sekunden-Tick von `render()` wieder los. Zwei Feinheiten, die
  Absicht sind: Die Sperre `celebrating` fällt **sofort**, die Gesehen-Marke
  aber erst, wenn der Kasten nach 600 ms wirklich aufgeht — wer den Tab vorher
  schließt, hat seine Feier nicht verloren. Und ist `localStorage` blockiert
  (privates Fenster), hält `SEEN_MEM` die Sperre wenigstens für die Sitzung.
  Das 24-h-Fenster von `cpReached` ist zugleich der Schutz gegen Verspätetes:
  wer Tage später zum ersten Mal vorbeischaut, bekommt keine schale Feier.
  Zum Vorführen/Testen in der Konsole: `tcr84Feier()` · `tcr84Feier('Kalamata')`
  · `tcr84FeierReset()`.
- **Alles Externe geht durch `esc()`**, sobald es in `innerHTML` landet:
  Ortsnamen (Nominatim), `note`, CP-Namen — `entries` und `cps` können über
  den `#d=`-Teil-Link von jedem kommen. `esc()` ersetzt auch `"`, damit es in
  Attributwerten trägt. Wer eine neue Render-Stelle baut: erst escapen.
- **Kein `?t=`-Cache-Busting mehr** (21.07.2026): alle drei JSON-fetches laufen
  mit `{cache:'no-cache'}` — der Browser revalidiert per ETag und bekommt von
  GitHub Pages ein 304 statt eines Volldownloads, wenn nichts neu ist. Mit
  `?t=` war jede URL neu und track/profile (am Rennende ein paar hundert KB)
  wurden alle 15 min voll übertragen. Das CDN darf so bis ~10 min alten Stand
  liefern; bei stündlichem Scraper-Takt egal. Nicht auf `?t=` zurückbauen.
- **Live-Zeile mit Augenzwinkern:** 🚴 (sanft wippend, `.rideAnim`, respektiert
  `prefers-reduced-motion`) wenn er fährt, 🚲 (abgestelltes Rad) bei Pause —
  bewusst kein Schlaf-Symbol, die Spur kennt den Grund nicht.
- **Tagesstreifen unter den Tagesbalken** (`dayStrip()`): je Tag 24 h von links
  nach rechts, Messing = Bewegung, abgedunkelt = Standzeit, Tooltip trägt die
  Summe. Gleiche Quelle wie Karte und Log (`findStops()`/`trackStops()`), damit
  nicht drei Stellen drei verschiedene Pausen behaupten. Braucht `track.json`,
  erscheint deshalb erst nach dem Nachladen der Spur — der erste Rendergang
  bleibt leicht. Heißt „Standzeit“, nie „Schlaf“.
- **Dauer-Anzeigen (`dur()`, `dhm()`): erst auf Minuten runden, dann zerlegen.**
  Andersherum entsteht „1 h 60 min“ (119,6 min) bzw. „60 min“ statt „1 h“ —
  war drin bis 21.07.2026.
- `EDIT`-Modus (`#edit` im URL-Hash) zeigt das manuelle Eintrags-Formular; der
  öffentliche Board-View bleibt read-only und einfach.
- Neue optionale Detail-Ebenen (z. B. der GPS-Log-Zeilen-Expand, die Karte) sind
  bewusst **standardmäßig eingeklappt** (`<details>`/Klick-Toggle) — die mobile
  Startansicht soll schlank bleiben, tiefere Daten sind einen Klick entfernt, nicht
  auf der ersten Bildschirmseite.
- **Gespeicherte Dauern altern nicht mit — Zeitstempel schon.** `live.fixMinsAgo`
  ist das Alter der Trackermeldung *zum Zeitpunkt unseres Abrufs*, kein
  laufender Wert. Roh angezeigt stand in der Kopfzeile eine Stunde nach dem
  Abruf immer noch „Meldung vor 1 min“ (behoben 21.07.2026). Gültig ist die
  Angabe nur zusammen mit `live.ts`: `fixMinsAgo + (jetzt − live.ts)`. Wer eine
  Dauer aus `data.json` anzeigt, muss sie beim Rendern neu aufaddieren —
  dieselbe Regel gilt für jedes künftige Feld dieser Art.
- Positionslog: nur die `LOG_HEAD` (3) neuesten Meldungen stehen offen, der Rest
  hinter einem Knopf — über drei Wochen werden das hunderte Zeilen. Bewusst
  **kein `<details>`**: das darf keine `<tr>` umschließen, und zwei getrennte
  Tabellen bekämen unterschiedliche Spaltenbreiten. Stattdessen ein zweites
  `<tbody>` in derselben Tabelle. `LOG_ALL` ist eine Modulvariable, damit der
  aufgeklappte Zustand das 60s-Re-Render überlebt.
- **Pausenzeilen im Log.** Das Log protokolliert Bewegung — unter `minKmDelta`
  entsteht kein Eintrag, und ein stehender Fahrer hinterlässt darin eine
  stumme Lücke (in der Nacht 20./21.07.2026 achteinhalb Stunden zwischen zwei
  Zeilen, mit „1,8 km/h“ daneben). Kopfzeile und Karte wussten von der Pause,
  ausgerechnet das Log nicht. Quelle ist dasselbe `findStops()` wie für die
  Kartenmarker, damit nicht zwei Stellen verschiedene Pausen behaupten.
  Einsortiert wird nach der **Mitte** der Pause, nicht nach ihrem Beginn: sie
  überspannt oft eine Meldung (der Tracker meldet ja weiter, während er steht),
  und nach dem Beginn einsortiert landete die Nacht unter der 19:05-Zeile —
  also gerade nicht in der Lücke, die sie erklärt.
- **`track.json` wird nicht mehr nur für die Karte geladen**, sondern nach dem
  ersten Rendergang im Hintergrund (`refreshTrack()`, danach im 15-Min-Takt wie
  das Profil) — die Pausenzeilen brauchen es. Der erste Rendergang läuft
  weiterhin ohne, die mobile Startansicht bleibt also leicht. Abgeleitete
  Caches (`TRACK_KM`, `STOPS_KEY`) fallen bei jedem Nachladen mit, sonst zeigt
  die Karte alte Pausen auf neuer Spur.
- Höhenprofil (`#profileWrap`, `renderProfile()`): handgebautes SVG, **kein
  Chart-Framework**. Wird auf die tatsächliche Container-Breite gerechnet
  (1 SVG-Einheit = 1 px), damit Schriftgrößen auf dem Handy echte Pixel sind statt
  hochskalierter Miniaturen — deshalb der entprellte `resize`-Handler daneben.
  Zwei Ebenen: die dichte Linie aus `profile.json`s `points` (alle 500 m ein
  Stützpunkt) und die Meldungen als Punkte darauf. Farben über CSS-Klassen (`.pl`, `.gl`, `.pdot` …)
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
  über geratene Routen mehr. Der offene Flåm-Abgleich wurde am 21.07.2026 gemacht
  (Manuels ~5.400 hm für die Etappe Sør-Fron km 405 → Flåm km 700 gegen
  `cumClimbAt()` über genau dieses Zeitfenster): nach 195 von 295 km standen
  **3.153 hm** im Profil, also 16,2 hm/km gegen Manuels angenommene 18,3 hm/km im
  Etappenmittel. Das verträgt sich gut — seine Schätzung setzt voraus, dass die
  restlichen 100 km über das Hochgebirge vor den Fjorden ~2.250 hm bringen
  (22 hm/km), was zum Gelände passt. Die Höhenrechnung besteht damit ihren
  ersten unabhängigen Realitätstest; kein Anlass, am Aufbau zu drehen.
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
