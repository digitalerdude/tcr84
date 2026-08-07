/* =========================================================
   Datenquellen, in dieser Reihenfolge:
   1. data.json neben dieser Datei   (GitHub Pages, ein fester Link für alle)
   2. Daten im Link-Hash  #d=...      (Übergangslösung ohne Server)
   3. lokaler Speicher                (nur für die eintragende Person)
   Bearbeiten-Modus: an die Adresse #edit anhängen.
   ========================================================= */
const KEY = 'tcr84:state';
/* `pos` ist der Ort des Kontrollpunkts, [Breite, Länge]. Das sind die
   Ortsmittelpunkte der namensgebenden Orte, NICHT die eingemessene Lage des
   jeweiligen Kontrollpunkt-Postens — mehr braucht die Erkennung auch nicht,
   sie fragt nur „war er da?". `lat` daneben bleibt was es war: der Text für
   die Leiter. Kontrollpunkte ohne `pos` funktionieren weiter, sie werden dann
   allein über den Kilometerstand erkannt (siehe cpHit() in compute()).

   Quelle für CP2b/CP3/CP4: die offiziellen Lost-Dot-Parcours-Routen auf
   ridewithgps.com (Sammlung „Transcontinental Race No12 // #TCRNo12“,
   8094883) — `pos` ist dort jeweils das ENDE der benannten Parcours-Route
   (`last_lat`/`last_lng`), also der echte Kontrollpunkt, nicht eine
   Luftlinien-Schätzung. Grund für den Umbau am 29./30.07.2026: CP2b Chopok
   stand ursprünglich auf einer geratenen Position, die 215 km neben der
   echten lag (siehe Praděd/Chopok-Vorfall) — seitdem gilt hier nur noch
   „offizielle Route nachschlagen, nicht schätzen".

   `km` ist davon UNABHÄNGIG und bleibt eine Schätzung, bis Manuel wirklich
   in der Nähe ist (dann wie bei CP2b anhand seiner eigenen Kilometerangabe
   oder der Spur nachgezogen) — CP3/CP4 tragen vorerst die redaktionellen
   Werte aus dotwatcher.substack.com/p/inside-tcrno12-route (~3.520 / ~4.250
   km), nicht Bodenwahrheit. Für die Erkennung selbst ist das unkritisch:
   `pos` + der 4-km-Nahradius entscheiden, `km` steuert nur, AB WANN
   (CP_KM_MIN_FRAC) und BIS WANN OHNE Spur-Bestätigung (CP_FALLBACK_MAX_KM)
   danach gesucht wird — ein ungenauer Wert verschiebt also nur das Zeitfenster
   der Suche, erfindet aber keine Ankunft. */
const DEFAULTS = {
  totalKm: 4800,   // redaktionell wie die cp.km unten; data.json trägt die
                   // gemessene Ziel-km (05.08.2026 via BRouter 4800→4876,
                   // gleiche Zwei-Lineale-Korrektur wie CP3/CP4). Hier NICHT
                   // nachziehen — das ist der Fallback, keine Bodenwahrheit.
  start: '2026-07-19T20:00',
  deadline: '2026-08-08T23:59',
  cps: [
    { nm:'Trondheim', lat:'63.4°N', km:0, pos:[63.430, 10.395] },
    { nm:'CP1 Flåm', lat:'60.9°N', km:700, pos:[60.863, 7.113] },
    { nm:'CP2a Praděd', lat:'50.1°N', km:2320, pos:[50.0894, 17.2261] },
    { nm:'CP2b Chopok', lat:'48.9°N', km:2719, pos:[48.96395, 19.58613], deadline:'2026-07-30T11:00' },
    { nm:'CP3 Sarajevo', lat:'43.8°N', km:3520, pos:[43.83074, 18.470769], deadline:'2026-08-02T23:59' },
    { nm:'CP4 Leskovik', lat:'40.2°N', km:4250, pos:[40.152629, 20.599462], deadline:'2026-08-05T23:59' },
    { nm:'Kalamata', lat:'37.0°N', km:4800, pos:[37.02398, 22.10307] }
  ]
};
/* Wie nah er dem Kontrollpunkt gekommen sein muss, damit er als erreicht gilt
   — und ab welchem Anteil seines nominellen Kilometerstands die Nähe
   überhaupt zählen darf. Die zweite Zahl ist die Bremse gegen ein Auslösen
   außer der Reihe, falls die Strecke einen späteren Kontrollpunkt zufällig
   streift; 10 % vor dem Soll ist immer noch früh genug.

   Ursprünglich an einem Fall geeicht: Am 22.07.2026 lag die Meldung aus Flåm
   0,8 km vom Ortsmittelpunkt; die nächstgelegene davor stand mit 5,6 km in
   Aurlandsvangen, dem Nachbarort über dem Fjord — und der ist NICHT CP1. Ein
   erster Versuch mit 10 km hätte CP1 in Aurlandsvangen ausgelöst, eine gute
   Stunde zu früh; 4 km hielt zu beiden Seiten Abstand (zwischen 0,8 und 5,6).

   Auf 1,5 km verengt (01.08.2026): CP3 Sarajevo feierte bei 4 km schon auf
   der Anfahrt aus Boguševac, 2,8–3,1 km vom Kontrollpunkt entfernt — dort
   noch nicht angekommen, nur in dessen Nähe. Anders als das kleine Flåm ist
   Sarajevo eine Großstadt mit Bergrand-Anfahrt; die Zufahrtsstraße streift
   den 4-km-Radius, lange bevor die letzten Kilometer zum eigentlichen Posten
   gefahren sind. 1,5 km bleibt oberhalb der Flåm-Ortsmitte (0,8 km) — der
   ursprüngliche Fall löst also weiterhin korrekt aus — und deutlich unter
   Aurlandsvangen (5,6 km) sowie dem neuen Sarajevo-Vorfall (2,8 km). Enger
   als nötig darf sie nicht sein: sitzt der Posten am Ortsrand statt in der
   Mitte, fällt die Erkennung auf den Kilometerstand zurück — dann ist es
   wieder so spät wie vorher, aber nie falsch.

   Auf 1 km verengt (07.08.2026), vorsorglich vor der Zielankunft in
   Kalamata: gleichzeitig wurde Kalamatas `pos` von der groben Ortsmitte
   (37,038/22,113) auf die tatsächliche Ziellinie am Meer (37,02398/22,10307,
   vom Nutzer geliefert, 1,79 km Versatz) korrigiert — dieselbe Lehre wie bei
   CP3/CP4: die Näherungsprüfung muss gegen den echten Zielpunkt laufen, nicht
   gegen eine Ortsmitte, sonst löst selbst ein enger Radius am Stadtrand aus
   statt an der Ziellinie. 1 km bleibt oberhalb von Flåm (0,8 km). Zum
   Zeitpunkt der Änderung war Manuel noch 20,3 km Luftlinie entfernt, keine
   akute Fehlauslösung — der Kilometerstand-Fallback (`CP_FALLBACK_MAX_KM`)
   bleibt unverändert das Sicherheitsnetz. */
const CP_RADIUS_KM = 1;
const CP_KM_MIN_FRAC = 0.9;
/* Ab welcher Kilometerlücke der heutige ↑-Höhenmeter-Balken als „hängt
   hinterher" markiert wird (todayHmAsOf in renderDays). Gemessen wird der
   Abstand zwischen den frischen Tageskilometern (Tracker) und den vom Profil
   abgedeckten — nicht das Alter der Spur, denn ein legitimer Halt lässt die
   Spur ebenso altern, ohne dass Höhenmeter fehlen. 25 km liegt sicher über
   dem normalen Stapel-Rückstand des Exports (~40 min ≈ 13 km bei Fahrttempo)
   und der bekannten Ferry/kmScale-Restdrift, und deutlich unter dem echten
   Ausfall vom 03.08.2026 (86 km). */
const DAY_HM_STALE_KM = 25;
/* Obergrenze für den Kilometerstand-Fallback in cpHit(), wenn die Spur da ist
   aber nie in CP_RADIUS_KM herankommt. Bewusst großzügiger als CP_RADIUS_KM:
   sie deckt weiterhin den harmlosen Fall ab, dass der Posten am Ortsrand statt
   in der Ortsmitte sitzt (siehe CP_RADIUS_KM-Kommentar) — nur eine Spur, die
   den Kontrollpunkt um ein Vielfaches verfehlt, gilt als Widerlegung. Am
   29.07.2026 lag CP2b Chopok schon 51 km entfernt, weit über jedem plausiblen
   Ortsrand-Versatz, als der reine Kilometerstand ihn trotzdem für erreicht
   erklärte. */
const CP_FALLBACK_MAX_KM = 15;
/* Ab wann das Board auf den Zieltag-Look umschaltet: Verpflegung ohne
   Speisekarte, Karte zoomt auf den Fahrer statt die Gesamtstrecke, „Rest
   bis Kalamata" pulst, Soll-Schnitt/Puffer werden zu einer Ankunftszeit-
   Kachel, Höhenprofil startet auf „Heute", Zielmarker auf der Karte. Ein
   einzelnes Datum-Gate statt sieben Einzelbedingungen — dasselbe Muster wie
   die Fährplanung (dort `pos.lat`) oder die Verpflegung (dort der
   Fährstatus). Lokale Zeit ohne TZ-Suffix, kippt automatisch um Mitternacht,
   auch in einem bereits offenen Tab, weil jede render()-Runde `istZieltag()`
   neu auswertet statt den Wert einmalig zu cachen. */
const ZIELTAG_AB = '2026-08-07T00:00';
let ZIELTAG_OVERRIDE = null;   // Debug-Hook tcr84Zieltag(), siehe unten
function istZieltag(c){
  return ZIELTAG_OVERRIDE != null ? ZIELTAG_OVERRIDE : c.now >= new Date(ZIELTAG_AB);
}
/* Die echte Ankunft — datengetrieben, kein Datum. `istZieltag` schaltet den
   LOOK des letzten Tages frei (Verpflegung ohne Karte, Zoom, Zielmarker) und
   kippt am 07.08.2026 um Mitternacht, egal wo Manuel gerade ist. Für das
   Finale (großer Popup + dauerhafter Andenken-Zustand) zählt das nicht — das
   darf erst kommen, wenn er wirklich da ist. `c.rest===0` ist exakt dieselbe
   Bedingung, die schon die Ankunfts-Kachel und den Verdict-Satz „das Ding ist
   durch" auslöst (siehe compute()), hier nur unter einem eigenen Namen für
   die Stellen, die ausdrücklich AN DER ANKUNFT hängen, nicht am Kalenderblatt. */
let ANGEKOMMEN_OVERRIDE = null;   // Debug-Hook tcr84Angekommen(), siehe unten
function istAngekommen(c){
  return ANGEKOMMEN_OVERRIDE != null ? ANGEKOMMEN_OVERRIDE : c.rest === 0;
}
/* Lokale Zeit ohne Zeitzonen-Suffix — dieselbe Konvention wie `ts` in
   data.json (siehe CLAUDE.md). Ein nacktes toISOString() verschöbe die
   Anzeige um die Zeitzonendifferenz. */
const localIso = d => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
let S = { settings: structuredClone(DEFAULTS), entries: [] };
let SOURCE = 'leer';
let DIRTY = false;
const EDIT = /(^|[#&])edit(&|$)/.test(location.hash);

/* ---------- Speicher-Adapter: Artefakt oder normale Webseite ---------- */
const store = {
  async get(){
    if(window.storage){ const r = await window.storage.get(KEY); return r && r.value; }
    return localStorage.getItem(KEY);
  },
  async set(v){
    if(window.storage) return window.storage.set(KEY, v);
    localStorage.setItem(KEY, v);
  },
  async del(){
    if(window.storage) return window.storage.delete(KEY);
    localStorage.removeItem(KEY);
  }
};

/* ---------- Link-Kodierung ---------- */
function packLink(obj){
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin=''; bytes.forEach(b=> bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unpackLink(s){
  const b64 = s.replace(/-/g,'+').replace(/_/g,'/');
  const bin = atob(b64 + '==='.slice((b64.length+3)%4));
  const bytes = Uint8Array.from(bin, ch=> ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
function hashParam(name){
  const m = location.hash.replace(/^#/,'').split('&').find(p=> p.startsWith(name+'='));
  return m ? m.slice(name.length+1) : null;
}
function adopt(p){
  S.settings = Object.assign(structuredClone(DEFAULTS), p.settings||{});
  S.entries = Array.isArray(p.entries) ? p.entries : [];
  // Live-Stand des Trackers, unabhängig vom letzten Log-Eintrag (siehe renderLive)
  S.live = p.live || null;
}

/* ---------- Laden ---------- */
/* 'no-cache' statt ?t=-Cache-Busting: der Browser fragt beim Server nach
   (ETag) und bekommt ein 304 statt eines Volldownloads, wenn sich nichts
   geändert hat. Mit ?t= war jede URL neu und jeder Poll ein kompletter
   Transfer — bei track.json und profile.json am Rennende ein paar hundert
   KB alle 15 Minuten je Betrachter. GitHub Pages' CDN darf so bis ~10 min
   alten Stand liefern; bei stündlichem Scraper-Takt ist das egal. */
async function loadRemote(){
  try{
    const res = await fetch('data.json', {cache:'no-cache'});
    if(!res.ok) return false;
    adopt(await res.json()); SOURCE = 'data.json'; return true;
  }catch(e){ return false; }
}
/* Das Höhenprofil liegt in einer eigenen Datei: es wächst auf einige Hundert
   Kilobyte und ändert sich nur, wenn Manuel fährt — es alle 5 Minuten mit
   data.json mitzuladen wäre Verschwendung. Eigener, langsamerer Takt. */
let PROFILE = null;
async function loadProfile(){
  try{
    const res = await fetch('profile.json', {cache:'no-cache'});
    if(!res.ok) return false;
    const p = await res.json();
    if(Array.isArray(p.points) && p.points.length) { PROFILE = p; return true; }
  }catch(e){ /* Board funktioniert auch ohne Profil, nur ohne Höhenteil */ }
  return false;
}

async function loadAll(){
  if(await loadRemote()) return;
  const d = hashParam('d');
  if(d){ try{ adopt(unpackLink(d)); SOURCE = 'Link'; return; }catch(e){} }
  try{ const raw = await store.get(); if(raw){ adopt(JSON.parse(raw)); SOURCE = 'lokal'; } }catch(e){}
}

/* ---------- Hilfen ---------- */
const num = n => n.toLocaleString('de-DE',{maximumFractionDigits:0});
const one = n => n.toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1});
const sorted = () => [...S.entries].sort((a,b)=> new Date(a.ts)-new Date(b.ts));
function dur(ms){
  if(!isFinite(ms)) return '–';
  const neg = ms<0;
  // Erst auf ganze Minuten runden, DANN zerlegen — andersherum wird aus
  // 59,8 min „60 min“ statt „1 h“ (gleiches Muster in dhm() unten).
  const min = Math.round(Math.abs(ms)/6e4);
  const h = Math.floor(min/60), d = Math.floor(h/24);
  // Unter einer Stunde in Minuten — sonst steht bei frischen Werten „0 h“,
  // was aussieht als fehle die Angabe. Gilt auch für knappe Puffer.
  if(h < 1) return (neg?'−':'') + min + ' min';
  return (neg?'−':'') + (d>0 ? d+' T '+(h-d*24)+' h' : h+' h');
}
function fmt(ts){
  const d = new Date(ts);
  return d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})+' '+
         d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
}

/* ---------- Rechnung ---------- */
function compute(){
  const st = S.settings;
  const start = new Date(st.start), dl = new Date(st.deadline), now = new Date();
  const total = Number(st.totalKm)||1;
  const list = sorted(), last = list[list.length-1] || null;
  const km = last ? Number(last.km) : 0;
  const rest = Math.max(total-km, 0);
  /* Ein Schnitt ist ein Verhältnis zweier Messungen und darf nur durch die
     Zeit geteilt werden, zu der die Kilometer auch gemessen wurden. Zwei
     Fallen stecken darin, beide hier schon dagewesen:

     1. Durch die laufende Rennuhr geteilt, ließe ein Ausfall des Scrapers den
        Fahrer langsamer werden — eine erfundene Verlangsamung.
     2. Durch die Zeit der letzten LOG-Meldung geteilt, wird eine Pause
        unsichtbar: das Log bekommt unter `minKmDelta` keine Zeile, steht der
        Fahrer, bleibt der Zähler stehen und der Schnitt friert auf dem Wert
        von vor der Pause ein. In der Nacht vom 20.07.2026 hätte das Board um
        02:43 Uhr 17,6 km/h behauptet — tatsächlich waren es 13,2.

     Deshalb der frischeste Messpunkt, den wir haben: `live` schreibt der
     Scraper bei JEDEM Lauf, auch wenn keine Log-Zeile fällig ist. Das ist die
     eine Stelle, an der `live` in eine Kennzahl einfließt statt nur in eine
     Aktualitätsangabe — und zwar genau deshalb, weil die Aktualität hier Teil
     der Rechnung ist. Der Zeitpunkt ist die Messung, nicht der Abruf:
     `live.ts` minus dem Alter der Trackermeldung. */
  let mKm = km, mAt = last ? new Date(last.ts) : null;
  const lv = S.live;
  if(lv && lv.ts && lv.km != null){
    const gemessen = new Date(new Date(lv.ts).getTime() - (lv.fixMinsAgo||0)*6e4);
    if(!mAt || gemessen > mAt){ mKm = Number(lv.km); mAt = gemessen; }
  }
  const raceH = (now-start)/3.6e6;              // laufende Rennuhr
  const measuredH = mAt ? (mAt-start)/3.6e6 : 0; // Rennzeit bis zur frischesten Messung
  const staleH = mAt ? (now-mAt)/3.6e6 : 0;      // wie weit unser Wissen zurückliegt
  const leftToDl = (dl-now)/3.6e6;
  const avg = measuredH > 0 ? mKm/measuredH : 0;
  const need = leftToDl > 0 ? rest/leftToDl : Infinity;
  const eta = avg > 0 && rest > 0 ? new Date(now.getTime() + rest/avg*3.6e6) : null;
  const buffer = eta ? (dl-eta) : (rest===0 && last ? dl-new Date(last.ts) : null);
  let roll = null;
  if(list.length >= 2){
    const a = list[list.length-2], b = last;
    const dh = (new Date(b.ts)-new Date(a.ts))/3.6e6;
    if(dh > 0) roll = (b.km-a.km)/dh;
  }
  /* Erreicht ist NICHT dasselbe wie „Kilometerstand überschritten". `cp.km`
     steht auf der Skala der geplanten Route, `entry.km` auf der des Trackers
     — zwei verschiedene Lineale, und sie laufen auseinander. Am 22.07.2026
     meldete der Tracker aus Flåm 688,5 km gegen die 700 der Liste; nach dem
     reinen Kilometervergleich galt CP1 erst zwei Stunden und zwölf Kilometer
     später als erreicht, da war Manuel längst wieder unterwegs.
     Vom Lineal unabhängig ist allein die NÄHE: liegt eine Meldung im Umkreis
     von CP_RADIUS_KM um den Ort, war er dort — egal, was der Zähler sagt. Der
     Kilometerstand bleibt der zweite Weg (Kontrollpunkte ohne `pos` haben nur
     ihn) und die Bremse gegen zu frühes Auslösen. Es gilt der frühere der
     beiden: gefeiert wird die Ankunft, nicht ihre Bestätigung. */
  const cpHit = cp=>{
    const soll = Number(cp.km);
    const drueber = list.find(e=> Number(e.km) >= soll) || null;
    let nah = null;
    let spurGeprueft = false, naechsteSpurM = Infinity;
    if(cp.pos){
      /* Die Nähe zählt erst, wenn er auch nach Kilometern in der Gegend ist.
         Die Meldung, ab der das gilt, ist zugleich die früheste Zeit, die ein
         Spurpunkt unterbieten darf — sonst zählte ein Streifen der Gegend
         Tage vorher. */
      const ab = list.find(e=> Number(e.km) >= soll*CP_KM_MIN_FRAC);
      if(ab){
        /* Gesucht wird in der SPUR, nicht in den Meldungen: die Spur hat alle
           ~5 Minuten einen Punkt, die Meldungen nur alle ~25. Bei 4 km Radius
           ist ein Treffer in der Spur so gut wie sicher — unter den Meldungen
           wäre er Glückssache, in Flåm lag am 22.07.2026 genau eine einzige im
           Umkreis. Nebenbei sitzt der gefeierte Zeitpunkt dadurch auf fünf
           Minuten genau statt auf fünfundzwanzig. Ohne Spur (erster
           Rendergang, sie wird nachgeladen) bleiben die Meldungen der Weg.

           Genommen wird nicht der erste Punkt im Radius, sondern der
           NÄCHSTGELEGENE: der erste ist der Moment der Annäherung, in Flåm
           rund 19 Minuten vor der Ankunft. Solange er noch im Umkreis
           unterwegs ist, rückt der Zeitpunkt mit jedem Rendergang näher an
           die Ankunft heran und steht still, sobald er den Ort verlässt. */
        const abSec = new Date(ab.ts).getTime()/1000;
        let best = null, bestM = Infinity;
        if(TRACK){
          spurGeprueft = true;
          for(const q of TRACK.points){
            if(q[3] < abSec) continue;
            const m = metersBetween([q[0],q[1]], cp.pos);
            if(m < naechsteSpurM) naechsteSpurM = m;
            if(m <= CP_RADIUS_KM*1000 && m < bestM){ bestM = m; best = q; }
          }
        }
        if(best) nah = {ts: localIso(new Date(best[3]*1000))};
        else nah = list.find(e=> e.lat!=null && e.lon!=null
              && new Date(e.ts) >= new Date(ab.ts)
              && metersBetween([e.lat,e.lon], cp.pos) <= CP_RADIUS_KM*1000) || null;
      }
    }
    // Der frühere der beiden gilt — gefeiert wird die Ankunft, nicht ihre
    // Bestätigung durch den Zähler.
    if(nah && drueber) return new Date(nah.ts) <= new Date(drueber.ts) ? nah : drueber;
    if(nah) return nah;
    /* Der Kilometerstand allein darf nur greifen, wenn die Spur ihn nicht
       widerlegt hat — sonst wäre „spät, aber nie falsch" (siehe CP_RADIUS_KM
       oben) nicht mehr wahr. Am 29.07.2026 lag CP2b Chopok schon 51 km
       entfernt, als der Kilometerstand allein CP2b für erreicht erklärte:
       Manu war laut Spur weder am Kontrollpunkt noch überhaupt im Umkreis
       der Passstraße. CP_FALLBACK_MAX_KM lässt den harmlosen Fall stehen
       (Posten am Ortsrand statt in der Mitte, siehe oben), verwirft aber
       einen Kilometerstand, den die Spur über viele Kilometer widerlegt. */
    /* Für einen Kontrollpunkt MIT `pos` darf der reine Kilometerstand nur
       zählen, wenn die Spur ihn bestätigt (naechsteSpurM <= CP_FALLBACK_MAX_KM).
       Ist die Spur noch nicht geladen (erster Rendergang, `spurGeprueft`
       false), wird NICHT gefeiert: ein vorausgelaufenes Tracker-Lineal löste
       sonst zu früh aus — am 01.08.2026 meldete der Tracker 3527 km und damit
       CP3 Sarajevo als „erreicht", während Manuel laut Spur noch 42 km davor
       stand; die Feier fiel, bevor der nächste Rendergang mit geladener Spur
       sie widerlegen konnte, und die localStorage-Gesehen-Marke verhinderte
       das Nachfeuern. Ein Kontrollpunkt OHNE `pos` hat nur den Kilometerstand
       und behält ihn. */
    if(drueber){
      if(!cp.pos) return drueber;
      if(spurGeprueft && naechsteSpurM <= CP_FALLBACK_MAX_KM*1000) return drueber;
    }
    return null;
  };
  const cpHits = new Map();   // Kontrollpunkt → Meldung, mit der er erreicht wurde
  st.cps.forEach(cp=>{ const h = cpHit(cp); if(h) cpHits.set(cp, h); });
  const nextCp = st.cps.find(cp=> Number(cp.km) > 0 && !cpHits.has(cp)) || null;
  /* Zuletzt erreichter Kontrollpunkt samt Zeitpunkt. Jünger als 24 h heißt:
     das Board feiert noch — Einschätzungskasten, Leiter und der Feier-Kasten
     (`maybeCelebrate()`) machen den Moment sichtbar, statt ihn im Log
     versinken zu lassen. Kalamata zählt mit: der Zieleinlauf ist der größte
     dieser Momente. Nur Trondheim (km 0) ist ausgenommen — der Start ist kein
     Erfolg. Das 24-h-Fenster ist auch der Schutz gegen Verspätetes: wer das
     Board drei Tage nach CP1 zum ersten Mal öffnet, bekommt keine schale
     Feier mehr vorgesetzt. */
  let cpReached = null;
  const passedCp = st.cps.filter(cp=> Number(cp.km) > 0 && cpHits.has(cp)).pop();
  if(passedCp){
    const hit = cpHits.get(passedCp);
    if((now - new Date(hit.ts)) < 24*3.6e6) cpReached = {cp: passedCp, ts: hit.ts};
  }
  /* Länderübertritt, dieselbe 24h-Feier-Regel wie bei Kontrollpunkten.
     Grenze zwischen zwei EINTRÄGEN, nicht in der Spur: `cc` kommt aus der
     Nominatim-Antwort beim Scrapen und steht nur an Log-Zeilen, `track.json`
     kennt kein Land. Genommen wird der erste Eintrag mit dem neuen Länder-
     code nach dem letzten mit einem anderen — die Feier ist also auf die
     Auflösung des Logs genau (~25 min), nicht auf die der Spur (~5 min). */
  let ccReached = null;
  const ccList = list.filter(e => e.cc && FUEL.laender.some(l=> l.cc === e.cc));
  if (ccList.length > 0) {
    const latestCc = ccList[ccList.length - 1].cc;
    let transitionEntry = null;
    for (let i = ccList.length - 2; i >= 0; i--) {
      if (ccList[i].cc !== latestCc) {
        transitionEntry = ccList[i+1];
        break;
      }
    }
    if (transitionEntry && (now - new Date(transitionEntry.ts)) < 24*3.6e6) {
      ccReached = { cc: latestCc, ts: transitionEntry.ts, km: transitionEntry.km };
    }
  }
  /* Höhen: `ele` ist die Höhe an der Meldung, `climbUp`/`climbDown` sind die
     geschätzten Höhenmeter im Segment davor (siehe update-tracker.mjs). Beides
     optional — Meldungen ohne GPS haben nichts davon, und die Summen zählen
     deshalb ausdrücklich nur den abgedeckten Teil der Strecke. */
  const P = PROFILE;
  const climbUp = P ? Math.round(P.climbUp) : 0;
  const climbDown = P ? Math.round(P.climbDown) : 0;
  const climbKm = P ? Number(P.routedKm) : 0;
  // Renn-Kilometer je gerouteten Kilometer: BRouter rechnet die Strecke etwas
  // anders als der Tracker (418 gegen 405 km). Damit das Profil auf derselben
  // Achse liegt wie Leiter und Log, wird es beim Zeichnen gestreckt.
  const kmScale = (P && P.routedKm > 0 && km > 0) ? km / P.routedKm : 1;
  const eleMax = P ? Math.max(...P.points.map(p=> p[1])) : null;
  const ele = P ? P.points[P.points.length-1][1]
                : (list.filter(e=> e.ele!=null).pop() || {}).ele ?? null;
  let state = 'warn';
  if(!last) state = '';
  else if(rest === 0) state = 'good';
  else if(buffer !== null && buffer > 24*3.6e6) state = 'good';
  else if(buffer !== null && buffer > 0) state = 'warn';
  else state = 'alert';
  const ferry = ferryCrossing();
  /* Roadbook-Fristen einzelner Kontrollpunkte (CP2/CP3/CP4, von Manuel
     genannt) bekommen denselben Puffer wie das Gesamtlimit — dieselbe Formel,
     nur mit CP-Kilometer statt Gesamtstrecke und CP-Frist statt Renn-Deadline.
     Nur Kontrollpunkte mit eigener `deadline` bekommen eine Kachel; CP1 hat
     (Stand jetzt) keine genannte Frist und bleibt außen vor, statt eine zu
     erfinden.
     Ein erreichter CP fällt aus der Rotation (30.07.2026) — die Frist ist
     dann Geschichte, keine Kennzahl mehr, auf die noch irgendjemand
     hinarbeitet. Geprüft wird über `cpHits`, dieselbe Landkarte, die auch
     `cpReached` und damit die Konfetti-Feier speist — keine zweite,
     eigene "ist er da"-Prüfung, die der Feier widersprechen könnte. Bewusst
     NICHT an das 24-h-Fenster von `cpReached` gekoppelt: das Fenster steuert
     nur, wie lange gefeiert wird, nicht ob der CP erreicht ist. Sonst käme
     die Kachel nach 24 h wieder — von "geschafft" zurück zu "läuft noch". */
  const cpTiles = st.cps.filter(cp=> cp.deadline && !cpHits.has(cp)).map(cp=>{
    const cpDl = new Date(cp.deadline);
    const restCp = Math.max(Number(cp.km) - km, 0);
    const leftToCpDl = (cpDl-now)/3.6e6;
    const needCp = leftToCpDl > 0 ? restCp/leftToCpDl : Infinity;
    const etaCp = avg > 0 && restCp > 0 ? new Date(now.getTime() + restCp/avg*3.6e6)
                : (restCp === 0 ? now : null);
    const bufferCp = etaCp ? (cpDl - etaCp) : null;
    const stateCp = bufferCp === null ? '' : bufferCp > 24*3.6e6 ? 'good' : bufferCp > 0 ? 'warn' : 'alert';
    return {nm: cp.nm, short: cp.nm.split(' ')[0], dl: cpDl, need: needCp, reached: false, arrival: null, eta: etaCp, buffer: bufferCp, state: stateCp};
  });
  const pufferTiles = [
    {nm:'Kalamata', short:'Ziel', dl, reached: rest===0, arrival: rest===0 && last ? new Date(last.ts) : null,
     eta, buffer, state},
    ...cpTiles
  ];
  /* Der bindende Termin ist nicht immer Kalamata. `need`/`state` oben rechnen
     nur gegen das Gesamtlimit — ein Fahrer, der auf CP3 (eigene Roadbook-
     Frist) zusteuert, ist bei verpasstem Cutoff außer Wertung, ganz
     unabhängig davon, ob Kalamata rechnerisch noch drin wäre. Ohne diesen
     Schritt hätte „Soll-Schnitt ab jetzt“ und die Gesamteinschätzung (Pille,
     Kasten) genau das ausgeblendet: grün fürs Ziel, während die Uhr für einen
     näheren CP längst abgelaufen ist.
     Gewählt wird der Termin mit dem schlechtesten Ampel-Stand (alert schlägt
     warn schlägt good); bei Gleichstand entscheidet der höhere nötige
     Schnitt — die unmittelbarere Zwangslage. Nur unerreichte CPs mit eigener
     Frist stehen zur Wahl (`cpTiles`, s.o.), dieselbe Quelle wie die
     Puffer-Kacheln — keine zweite Landkarte, die etwas anderes behauptet. */
  const stateRank = {alert:3, warn:2, good:1, '':0};
  const bindingCandidates = [{nm:'Kalamata', dl, need, state}, ...cpTiles];
  let binding = bindingCandidates[0];
  for(const t of bindingCandidates.slice(1)){
    const tr = stateRank[t.state]||0, br = stateRank[binding.state]||0;
    const tn = isFinite(t.need) ? t.need : 1e9, bn = isFinite(binding.need) ? binding.need : 1e9;
    if(tr > br || (tr === br && tn > bn)) binding = t;
  }
  return {st,start,dl,now,total,list,last,km,rest,leftToDl,avg,need,eta,buffer,roll,nextCp,cpHits,cpReached,ccReached,state,
          bindingNeed:binding.need,bindingState:binding.state,bindingNm:binding.nm,bindingDl:binding.dl,
          raceH,measuredH,staleH,ferry,pufferTiles,
          ele,eleMax,climbUp,climbDown,climbKm,kmScale};
}

/* ---------- Ansicht ---------- */
/* Gewählte Puffer-Kachel (Ziel oder ein Kontrollpunkt); Modulvariable, damit
   sie das 60s-Re-Render überlebt — dasselbe Muster wie FER_SCEN beim
   Fährpanel. Ein Klick auf den Pfeil verändert nur diese Zahl und ruft
   renderMetrics() erneut auf, statt das Raster um eine Kachel je CP zu
   erweitern (siehe Anlass: Roadbook nennt Fristen für CP2–CP4, die sollen
   sichtbar sein, ohne das Board zu überfrachten). */
let PUFFER_IDX = 0;

function pufferCellHtml(c){
  const tiles = c.pufferTiles;
  const idx = ((PUFFER_IDX % tiles.length) + tiles.length) % tiles.length;
  const t = tiles[idx];
  const k = idx===0 ? 'Puffer auf das Limit' : 'Puffer auf '+esc(t.short);
  const v = t.buffer!=null ? dur(t.buffer) : '–';
  /* Ziel-Kachel bleibt wortgleich zum bisherigen Verhalten. CP-Kacheln
     zeigen nur noch PROGNOSE — ein erreichter CP fällt aus `pufferTiles`
     heraus (siehe compute()), bevor er hier ankommt, GEMESSEN gibt es an
     dieser Stelle also nicht mehr zu unterscheiden. */
  const n = idx===0
    ? (c.rest===0 ? 'im Ziel' : c.eta ? 'Prognose Ankunft '+fmt(c.eta) : 'ab zwei Meldungen')
    : (t.eta ? 'Prognose Ankunft '+fmt(t.eta)+' · Frist '+fmt(t.dl)
       : 'ab zwei Meldungen · Frist '+fmt(t.dl));
  const nav = tiles.length > 1 ? `
    <div class="pnav">
      <button type="button" data-pufdir="-1" aria-label="voriger Puffer">‹</button>
      <div class="pdots">${tiles.map((_,i)=> `<i class="${i===idx?'on':''}"></i>`).join('')}</div>
      <button type="button" data-pufdir="1" aria-label="nächster Puffer">›</button>
    </div>` : '';
  return `<div class="cell puffercell"><div class="k">${k}</div>
    <div class="v ${t.state||''}">${v}</div>
    ${n?`<div class="n">${n}</div>`:''}
    ${nav}</div>`;
}

/* Ersetzt pufferCellHtml() am Zieltag: „Soll-Schnitt ab jetzt" und „Puffer
   auf das Limit" sind dann nur noch Notfall-Kennzahlen (die gebundene Frist
   wäre an diesem Punkt ohnehin längst gerissen oder komfortabel entspannt),
   die Ankunftszeit ist die eigentlich interessante. Beide Kacheln werden zu
   einer breiten zusammengeführt (`.zielkachel`, CSS spannt 2 Spalten) statt
   das Grid um eine sechste zu erweitern. pufferTiles hat am Zieltag ohnehin
   nur noch die Ziel-Kachel — alle CPs sind erreicht, cpTiles also leer. */
function zielCellHtml(c){
  const t = c.pufferTiles[0];
  const v = c.rest===0 ? 'Angekommen' : c.eta ? fmt(c.eta) : '–:–';
  const n = c.rest===0 ? 'im Ziel'
    : !c.eta ? 'ab zwei Meldungen'
    : dur(t.buffer) + (t.buffer>=0 ? ' Puffer bis Fristende' : ' über der Frist');
  return `<div class="cell puffercell zielkachel"><div class="k">Ankunft in Kalamata</div>
    <div class="v ${t.state||''} ${c.rest>0?'zielpuls':''}">${v}</div>
    ${n?`<div class="n">${n}</div>`:''}</div>`;
}

function renderMetrics(c){
  const zt = istZieltag(c);
  /* Der bindende Termin und das physisch nächste CP müssen nicht derselbe
     sein — CP3s eigene Frist kann entspannt sein, während CP4s Frist eng
     ist (siehe compute()). Ohne diesen Zusatz liest sich „bis CP4 Leskovik“
     hier wie ein Widerspruch zum „Bis CP3 …“-Satz im Kasten weiter unten,
     der ja den nächsten physischen Kontrollpunkt nennt. Nur wenn der
     nächste CP überhaupt eine eigene Frist trägt (`nextCpTile` gefunden)
     und nicht selbst der bindende ist, lohnt der Hinweis. */
  const nextCpTile = c.nextCp ? c.pufferTiles.find(t=> t.nm===c.nextCp.nm) : null;
  const bindingNote = (c.bindingNm!=='Kalamata' && nextCpTile && nextCpTile.nm!==c.bindingNm)
    ? ' ('+esc(nextCpTile.short)+' selbst entspannt)' : '';
  const cells = [
    /* „Zuletzt gesehen“ statt „letzte Meldung“: gemeint ist, wie alt unser
       Wissen über seine Position ist, nicht wann zuletzt eine Log-Zeile
       entstand. Bei Stillstand entsteht keine — der Tracker meldet trotzdem.
       Alter = Zeit seit unserem Abruf + Alter der Trackermeldung dabei. */
    ['Rennzeit', dur(c.now-c.start), '',
      S.live && S.live.ts
        ? 'zuletzt gesehen vor ' + dur((c.now - new Date(S.live.ts)) + (S.live.fixMinsAgo||0)*6e4)
        : (c.last ? 'letzte Meldung vor '+dur(c.now-new Date(c.last.ts)) : 'noch keine Meldung'), ''],
    ['Gefahren', c.last? num(c.km):'–', 'km', c.last? one(c.km/c.total*100)+' % der Strecke':'', ''],
    ['Rest bis Kalamata', c.last? num(c.rest):'–', 'km', '', (zt && c.rest>0) ? 'zielpuls' : ''],
    /* Der Zusatz erscheint nur, wenn das Wissen wirklich zurückliegt (ab 1 h,
       also nach einem ausgefallenen stündlichen Lauf). Im Normalbetrieb wäre
       er Rauschen — dann sind Rennuhr und Messung ohnehin deckungsgleich. */
    ['Ø-Schnitt gesamt', c.avg? one(c.avg):'–', 'km/h',
      c.avg? num(c.avg*24)+' km/Tag inkl. Pausen'
             + (c.staleH >= 1 ? ' · gemessen bis '+dur(c.staleH*3.6e6)+' zurück' : '') : '', ''],
    /* Rechnet gegen den bindenden Termin (`compute()`), nicht stur gegen
       Kalamata — ein näherer CP-Cutoff sticht das Gesamtlimit, wenn er
       enger ist. Bei Bindung an einen CP wird das im Zusatztext benannt,
       sonst läse sich die Zahl wie gehabt als Zielschnitt. Am Zieltag entfällt
       die Kachel — sie geht mit „Puffer auf das Limit" in zielCellHtml() auf. */
    ...(zt ? [] : [[
      'Soll-Schnitt ab jetzt', isFinite(c.bindingNeed)&&c.rest>0? one(c.bindingNeed):'–', 'km/h',
      c.rest===0? 'Ziel erreicht' : isFinite(c.bindingNeed)
        ? num(c.bindingNeed*24)+' km/Tag'+(c.bindingNm!=='Kalamata'? ' · bis '+esc(c.bindingNm):'')+bindingNote+' · '+dur(c.bindingDl-c.now)+' übrig'
        : (c.bindingNm!=='Kalamata'? 'Frist für '+esc(c.bindingNm)+' vorbei' : 'Zeitlimit vorbei'),
      c.rest===0?'good':(c.bindingState==='alert'?'alert':(c.avg && c.bindingNeed<=c.avg?'good':'warn'))
    ]])
  ];
  document.getElementById('metrics').innerHTML = cells.map(([k,v,u,n,cl])=>
    `<div class="cell"><div class="k">${k}</div>
     <div class="v ${cl||''}">${v}${u?` <span class="u">${u}</span>`:''}</div>
     ${n?`<div class="n">${n}</div>`:''}</div>`).join('') + (zt ? zielCellHtml(c) : pufferCellHtml(c));

  document.querySelectorAll('#metrics .pnav button').forEach(b=> b.onclick = ()=>{
    PUFFER_IDX += Number(b.dataset.pufdir);
    renderMetrics(c);
  });

  /* Pille und Kasten urteilen über den bindenden Termin, nicht stur über
     Kalamata — siehe `bindingState` in compute(). Sonst bliebe die
     Gesamteinschätzung grün, während ein näherer CP-Cutoff längst reißt. */
  const pill = document.getElementById('statusPill');
  pill.textContent = !c.last ? 'keine Daten' : c.rest===0 ? 'im Ziel'
    : c.bindingState==='good' ? 'im Zeitplan' : c.bindingState==='warn' ? 'knapp' : 'hinter dem Limit';
  pill.className = 'pill ' + c.bindingState;

  const v = document.getElementById('verdict');
  v.className = 'verdict ' + c.bindingState;
  if(!c.last){
    v.textContent = EDIT
      ? 'Trag die erste Position ein: Kilometerstand aus dem Live-Tracker ablesen, Zeitpunkt dazu. Ab der zweiten Meldung rechnet das Board Tempo, Prognose und Puffer.'
      : 'Noch keine Position gemeldet. Sobald der erste Stand eingetragen ist, erscheint hier die Einschätzung.';
  } else {
    const p = [];
    if(c.cpReached) p.push(`🎉 <strong>${esc(c.cpReached.cp.nm)} erreicht</strong> — ${fmt(c.cpReached.ts)}, nach ${dur(new Date(c.cpReached.ts)-c.start)} Rennzeit.`);
    p.push(`Bei <strong>${one(c.avg)} km/h</strong> im Mittel seit dem Start reicht es ${
      c.rest===0 ? 'nicht mehr zu diskutieren, das Ding ist durch.' :
      c.bindingState==='alert' ? (c.bindingNm==='Kalamata' ? 'nicht bis zum Zeitlimit.'
        : `nicht bis zur Frist für ${esc(c.bindingNm)} — außer Wertung, bevor das Zeitlimit überhaupt zur Frage wird.`) :
      c.bindingState==='warn' ? (c.bindingNm==='Kalamata' ? 'gerade so, ohne Reserve.'
        : `gerade so für ${esc(c.bindingNm)}, ohne Reserve.`) : 'mit Reserve.'}`);
    if(c.roll) p.push(`Zwischen den letzten beiden Meldungen: <strong>${one(c.roll)} km/h</strong> ${
      c.roll > c.avg ? '— über dem Gesamtschnitt, also ein Fahrblock ohne längere Pause.'
                     : '— unter dem Gesamtschnitt, da lag also eine längere Pause drin.'}`);
    const lastCl = c.list.length >= 2 ? climbBetween(c.list[c.list.length-2].ts, c.last.ts) : null;
    if(lastCl && lastCl.up > 0)
      p.push(`Dabei rund <strong>${num(lastCl.up)} Höhenmeter</strong> bergauf${
        lastCl.down > lastCl.up*1.5 ? ' — netto ging es aber deutlich abwärts.' : '.'}`);
    if(c.nextCp) p.push(`Bis ${esc(c.nextCp.nm)}: <strong>${num(c.nextCp.km-c.km)} km</strong>${
      c.avg? `, bei gleichem Schnitt rund ${dur((c.nextCp.km-c.km)/c.avg*3.6e6)}.` : '.'}`);
    /* Läuft gerade eine Pause, bekommt sie die Tagesleistung an die Seite —
       als Zuspruch, nicht als Anklage. Der Grund der Pause steht nicht in
       der Spur, deshalb bleibt der Satz neutral gegenüber Schlaf/Panne/
       Einkauf. Nur bei hängendem Abruf (> 150 min) schweigen wir — dann
       wissen wir ja gar nicht, ob die Pause noch läuft. */
    if(S.live && S.live.stopSince && (c.now - new Date(S.live.ts))/6e4 <= 150){
      const mitternacht = new Date(c.now.getFullYear(), c.now.getMonth(), c.now.getDate()).getTime()/1000;
      const eff = effortBetween(mitternacht, c.now.getTime()/1000);
      if(eff){
        const kmHeute = Math.round(eff.km * c.kmScale);
        const hmHeute = Math.round(eff.up);
        if(kmHeute >= 30) p.push(`Heute stehen schon <strong>${num(kmHeute)} km</strong> und ↑ ${num(hmHeute)} hm in den Beinen — die Pause ist verdient.`);
      }
    }
    /* Dieselbe Zeitspanne wie im Kennzahlenstreifen — nicht die letzte
       LOG-Zeile, die bei einer Pause stundenlang alt ist, ohne dass etwas
       fehlt. `staleH` misst, wie alt unser Wissen tatsächlich ist. */
    if(c.staleH > 3) p.push(`Unser letzter Stand ist ${dur(c.staleH*3.6e6)} alt, die Prognose ist entsprechend weich.`);
    v.innerHTML = p.join(' ');
  }
}

/* Live-Zeile im Kopf. Sie beantwortet die Frage, die das Positionslog nicht
   beantworten kann: das bekommt nur alle paar Kilometer einen Eintrag, steht
   der Fahrer, bleibt es stundenlang stumm und das Board wirkt eingefroren.
   `data.live` schreibt der Scraper dagegen bei JEDEM Lauf.
   Zustände, bewusst unterscheidbar: auf der Fähre / bestätigte Pause (≥40 min
   im Track) / steht gerade (Tempo 0, noch unbestätigt) / unterwegs / Abruf
   hängt. */
/* Der Streifen selbst verschwindet, sobald weder Live-Stand noch Wetter etwas
   zu sagen haben — ein leerer Kasten unter dem Namen wäre sonst sichtbar. */
function syncNowbar(){
  const bar = document.getElementById('nowbar');
  if(!bar) return;
  const sichtbar = [...bar.children].some(k => k.style.display !== 'none');
  bar.style.display = sichtbar ? 'flex' : 'none';
}

/* Unter dieser Geschwindigkeit ist „unterwegs“ nicht mehr die ehrliche
   Aussage — niemand radelt bei 2,4 km/h, das ist Schrittgeschwindigkeit oder
   GPS-Rauschen im Stand. Vorher stand hier eine exakte Null, und die griff
   nicht: als Manuel am 25.07.2026 zwei Stunden am Fährterminal in Ystad
   wartete, meldete der Tracker zwischendurch 2,4 und 7,1 km/h statt 0 — die
   40-Minuten-Bestätigung aus der Spur (`stopSince`) lag zu dem Zeitpunkt noch
   nicht vor, weil der GPX-Export gerade in einem seiner normalen Rückstände
   steckte (siehe „Der Export arbeitet in Stapeln“). Das Board zeigte in dieser
   Lücke „🚴 unterwegs · 2,4 km/h“ — sichtbar falsch, während er längst stand.
   3 km/h ist bewusst niedrig angesetzt: eine echte, wenn auch quälend
   langsame Steigung bleibt darüber, nur echter Stillstand fällt darunter. */
const LIVE_STEHT_KMH = 3;

function renderLive(c){
  const el = document.getElementById('liveLine');
  const lv = S.live;
  if(!el) return;
  /* Andenken-Zustand: sobald er wirklich angekommen ist, ersetzt eine feste
     Zeile die ganze Kaskade darunter (Pause/steht/unterwegs/Abruf hängt) —
     dauerhaft, nicht nur für einen Rendergang. Unabhängig von `lv`, denn auch
     ein `S.live`, das seit der Ankunft nicht mehr geschrieben wurde, ändert
     nichts daran, dass er da ist. */
  if(istAngekommen(c) && c.last){
    el.style.display = 'flex';
    el.innerHTML = `<span>🏁 <span class="wxval">Angekommen</span> — ${fmt(c.last.ts)},
      nach ${dur(new Date(c.last.ts)-c.start)} Rennzeit</span>`;
    syncNowbar();
    return;
  }
  if(!lv || !lv.ts){ el.style.display = 'none'; syncNowbar(); return; }
  el.style.display = 'flex';

  const alterAbruf = (c.now - new Date(lv.ts)) / 6e4;      // Minuten seit unserem letzten Blick
  const teile = [];

  /* Die Überfahrt hat Vorrang vor allem anderen: während er auf der Fähre
     sitzt, meldet der Tracker Tempo 0, und ohne diesen Zweig stünde hier
     „🚲 Pause“ — genau das Falsche. Ist die Überfahrt vorbei, übernimmt sofort
     wieder die normale Zeile (keine 24h-Nachlaufzeit mehr, siehe renderFerry()
     — dieselbe Entscheidung, dieselbe Begründung: sobald er wieder fährt,
     zeigt das echte Live-Tempo mehr als eine stehende „Fähre genommen“-Notiz). */
  const fer = c.ferry;
  if(fer && fer.state === 'onboard'){
    teile.push(`<span><span class="ferryAnim">⛴️</span> <span class="wxval">Auf der Fähre</span>` +
      ` · seit ${new Date(fer.boardTs).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} Uhr` +
      ` nach ${esc(FERRY.ziel)}</span>`);
  } else if(alterAbruf > 150){
    // Nicht der Fahrer hängt, sondern unsere Abfrage — das muss man auseinanderhalten.
    teile.push(`<span class="wxwarn">⚠ Abruf zuletzt ${fmt(lv.ts)}</span>`);
  } else if(lv.stopSince && !(lv.speed != null && Number(lv.speed) > LIVE_STEHT_KMH)){
    /* `stopSince` kommt aus der Spur und kann veraltet sein, wenn der
       GPX-Export gerade hinterherhinkt (siehe „Der Export arbeitet in
       Stapeln“) — dann bleibt die letzte bestätigte Standphase stehen, obwohl
       der frischere Live-Fix längst wieder Fahrt zeigt. Genau dieser
       Widerspruch wird schon im Fährpanel abgefangen (`!(speed>0)`), hier
       fehlte der Abgleich: ohne ihn behauptete die Kopfzeile „Pause seit …“,
       während `lv.speed` gleichzeitig 18,8 km/h meldete. Das frischere Tempo
       gewinnt, dieselbe Haltung wie beim Ø-Schnitt in compute(). */
    const dauer = (c.now - new Date(lv.stopSince)) / 6e4;
    teile.push(`<span>🚲 <span class="wxval">Pause seit ${new Date(lv.stopSince)
      .toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} Uhr</span>` +
      ` · ${dhm(dauer)}</span>`);
  } else if(lv.speed != null && Number(lv.speed) <= LIVE_STEHT_KMH
            && !(c.roll != null && c.roll > LIVE_STEHT_KMH)){
    /* Tempo nahe null gemeldet, aber die 40-min-Standphase im Track ist noch
       nicht bestätigt (oder der GPX-Export hinkt hinterher) — dann steht kein
       `stopSince`. Bis dahin „unterwegs“ zu behaupten, war falsch. „steht
       gerade“ nennt nur die gemeldete Momentangeschwindigkeit, ohne eine
       Pause samt Dauer/Grund zu behaupten — dieselbe Zurückhaltung wie sonst
       (die Spur kennt den Grund nicht). Parkendes Rad, keine Wippanimation.

       Die gemeldete Momentangeschwindigkeit ALLEIN reicht aber nicht: an
       einer steilen Steigung (Serpentinen vor Sarajevo, 01.08.2026) fiel sie
       an einzelnen Meldungen kurz unter LIVE_STEHT_KMH (2,5 / 2,9 km/h),
       während der Kilometerstand zwischen den Meldungen die ganze Zeit
       stetig weiterwuchs (Schnitt seit davor 5,6 / 3,5 km/h) — „steht
       gerade“ hätte gelogen, während er sich den Berg hochquälte. `c.roll`
       (derselbe Schnitt zwischen den letzten beiden Meldungen, den auch die
       Log-Spalte „Schnitt seit davor“ zeigt) ist gegen so ein einzelnes
       Momentan-Rauschen robust, weil er aus tatsächlich zurückgelegten
       Kilometern über die verstrichene Zeit gerechnet ist: bewegt sich der
       GPX-Punkt nachweislich, kann er nicht stehen. Zeigt `roll` dagegen
       KEINEN Fortschritt (≤ LIVE_STEHT_KMH oder noch keine zwei Meldungen,
       dann ist `roll` null), bleibt es bei „steht gerade“. */
    teile.push(`<span>🚲 <span class="wxval">steht gerade</span></span>`);
  } else {
    teile.push(`<span><span class="rideAnim">🚴</span> <span class="wxval">unterwegs</span>${
      lv.speed ? ' · '+one(lv.speed)+' km/h' : ''}</span>`);
  }

  // Kilometerstand steht schon in der Kennzahl „Gefahren“ darunter — hier
  // wäre er Dopplung. Platz und Meldungsalter sind die eigene Information.
  if(lv.rank!=null) teile.push(`<span>Platz ${lv.rank}</span>`);
  /* `fixMinsAgo` ist das Alter der Trackermeldung ZUM ZEITPUNKT UNSERES ABRUFS,
     kein laufender Wert. Roh angezeigt stand hier eine Stunde nach dem Abruf
     immer noch „vor 4 min“. Es muss also mitaltern: Alter beim Abruf plus die
     Zeit, die seitdem vergangen ist — dieselbe Rechnung wie in renderMetrics. */
  if(lv.fixMinsAgo!=null && alterAbruf <= 150)
    teile.push(`<span style="opacity:.75">Meldung vor ${dur((lv.fixMinsAgo + alterAbruf) * 6e4)}</span>`);
  el.innerHTML = teile.join('');
  syncNowbar();
}

function renderLadder(c){
  const frac = Math.min(c.km/c.total, 1);
  const pos = k => Number(k)/c.total*100;
  let html = '<div class="rail"></div>' +
             `<div class="rail-shade" style="top:${frac*100}%;bottom:0"></div>`;
  c.st.cps.forEach(cp=>{
    // Dieselbe Wahrheit wie im Feier-Kasten — nicht noch einmal km vergleichen.
    const done = c.cpHits.has(cp);
    const fresh = c.cpReached && cp === c.cpReached.cp;
    html += `<div class="anchor ${done?'done':''}${fresh?' fresh':''}" style="top:${pos(cp.km)}%">
      <span class="lat">${esc(cp.lat)}</span><span class="tick"></span>
      <span class="nm">${esc(cp.nm)}</span><span class="km">${num(Number(cp.km))} km</span></div>`;
  });
  if(c.last){
    html += `<div class="dot" style="top:${frac*100}%"></div>
             <div class="dot-label" style="top:${frac*100}%">▸ ${num(c.km)} km</div>`;
  }
  document.getElementById('ladder').innerHTML = html;
}

/* ---------- Höhenprofil ----------
   Bewusst kein Chart-Framework: die SVG wird auf die tatsächliche Container-
   Breite gerechnet (1 SVG-Einheit = 1 px), damit Schriftgrößen auf dem Handy
   echte Pixel sind statt hochskalierter Miniaturen. Deshalb auch der
   resize-Handler unten. */
/* Durch esc() geht ALLES, was aus data.json, von Nominatim oder aus einem
   #d=-Teil-Link stammt und in innerHTML landet — Ortsnamen sind externe
   Daten, und über den Teil-Link kann jeder beliebige entries/cps ins Board
   geben. `"` ist mit dabei, damit esc() auch in Attributwerten trägt. */
const esc = s => String(s).replace(/[<>&"]/g, ch=> ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));

/* Das Höhenprofil wird zweimal gezeichnet: eigenständig im Board und noch
   einmal in der aufgeklappten Karte, dort an sie gekoppelt. Beide Male
   dieselbe Funktion, unterschieden nur durch `prefix` für die Element-IDs —
   zwei Diagramme mit denselben IDs wären sonst nicht ansprechbar. */
const PROFS = {};

/* Standardmäßig zeigt das Board-Höhenprofil nur die letzten Tage, nicht die
   ganze Strecke. Grund: die Y-Achse skaliert auf Min/Max der gesamten Fahrt,
   und sobald die norwegischen Berge (~1.300 m) mit der jetzigen Ebene (~5 m)
   auf einer Achse liegen, wird genau der Abschnitt, auf dem er GERADE fährt,
   zu einem platten Strich am unteren Rand gequetscht — dazu staucht die
   mitwachsende X-Achse die letzten Tage horizontal immer weiter. Der
   Ausschnitt reskaliert beide Achsen aufs aktuelle Gelände; ein Umschalter
   holt die Gesamtstrecke (der motivierende „so weit sind wir geklettert“-
   Blick) zurück, ein dritter zoomt am Zieltag auf den laufenden Tag.
   `PROF_VIEW` überlebt das 60s-Neuzeichnen wie LOG_ALL. */
const PROF_FENSTER_TAGE = 2;
/* 'heute' | 'fenster' | 'full'. Solange PROF_VIEW_TOUCHED false ist, folgt
   der Default weiter automatisch dem Zieltag-Flag (siehe istZieltag()) —
   auch in einem bereits offenen Tab kippt er dadurch um Mitternacht auf
   „Heute". Sobald jemand selbst einen Reiter anklickt, gilt seine Wahl wie
   bisher über den 60s-Re-Render hinweg (gleiches Muster wie LOG_ALL). */
let PROF_VIEW = 'fenster';
let PROF_VIEW_TOUCHED = false;

/* profile.json hält je Block nur den kumulierten Stand am Blockende fest
   ([tEnd, kmEnde, cumUp, cumDown]; ein Block ist knapp eine Stunde Fahrt).
   Für beliebige Zeitpunkte dazwischen wird linear interpoliert — das ist
   genau genug, um einer Meldung oder einem Kalendertag Höhenmeter
   zuzuordnen, und spart, jeden Stützpunkt einzeln zu speichern. */
function cumClimbAt(unixSec){
  const P = PROFILE;
  if(!P || !Array.isArray(P.chunks) || !P.chunks.length) return null;
  const ch = P.chunks, lastCh = ch[ch.length-1];
  if(unixSec >= lastCh[0]) return {up:lastCh[2], down:lastCh[3], km:lastCh[1]};
  let prevT = P.startUnix != null ? P.startUnix : ch[0][0], prevUp = 0, prevDown = 0, prevKm = 0;
  for(const [t,km,up,down] of ch){
    if(unixSec <= t){
      const f = t > prevT ? (unixSec - prevT)/(t - prevT) : 1;
      return {up: prevUp + (up-prevUp)*f, down: prevDown + (down-prevDown)*f, km: prevKm + (km-prevKm)*f};
    }
    prevT = t; prevUp = up; prevDown = down; prevKm = km;
  }
  return {up:prevUp, down:prevDown, km:prevKm};
}
// Höhenmeter zwischen zwei Zeitpunkten (ts-Strings wie in data.json).
function climbBetween(tsA, tsB){
  const a = cumClimbAt(new Date(tsA).getTime()/1000);
  const b = cumClimbAt(new Date(tsB).getTime()/1000);
  if(!a || !b) return null;
  return {up: Math.max(Math.round(b.up-a.up), 0), down: Math.max(Math.round(b.down-a.down), 0)};
}
/* Kilometer/Höhenmeter zwischen zwei Zeitpunkten, aber ohne eine dazwischen
   liegende Fährüberfahrt mitzuzählen. profile.json bucht eine Überfahrt seit
   dem 26.07.2026 mit 0 Höhenmetern (siehe update-tracker.mjs), aber weiterhin
   mit ihrer Luftlinien-Distanz als "km" — sonst gäbe es gar keinen Wert, auf
   den sich `kmScale` beim Zeichnen bezieht. cumClimbAt() interpoliert diese
   km linear über die ganze Blockdauer, und liegt Mitternacht mitten in der
   Überfahrt (wie in der Nacht Ystad→Świnoujście), bekäme „seit Mitternacht"
   einen Teil einer Strecke gutgeschrieben, die er sitzend auf einem Schiff
   zurückgelegt hat, nicht tretend. Deshalb wird der Anteil der Überfahrt, der
   in [t1,t2] fällt, aus dem km-Delta wieder herausgerechnet — auch bei nur
   teilweiser Überlappung, denn genau die tritt hier ein (die Nacht beginnt
   vor der Abfahrt und endet nach Mitternacht, aber vor der Landung). */
function effortBetween(t1, t2){
  const a = cumClimbAt(t1), b = cumClimbAt(t2);
  if(!a || !b) return null;
  let km = b.km - a.km;
  const up = Math.max(b.up - a.up, 0), down = Math.max(b.down - a.down, 0);
  const fer = ferryCrossing();
  if(fer && fer.state === 'done'){
    const bT = new Date(fer.boardTs).getTime()/1000, lT = new Date(fer.landTs).getTime()/1000;
    const from = Math.max(bT, t1), to = Math.min(lT, t2);
    if(from < to){
      const fa = cumClimbAt(from), fb = cumClimbAt(to);
      if(fa && fb) km -= (fb.km - fa.km);
    }
  }
  return {km: Math.max(km, 0), up, down};
}
/* Offizielle Tracker-Kilometer zu einem Zeitpunkt, linear zwischen den zwei
   umgebenden Log-Einträgen. Anderes Lineal als effortBetween() oben (das
   rechnet auf profile.json/BRouter-Kilometern, umgerechnet über `kmScale`,
   der selbst driftet — siehe die kmScale-WARNUNG in check.mjs nach der
   Fähre). Für die Gesamtsumme seit Trondheim zählt aber `c.km`, das
   offizielle Lineal des Trackers, und dessen Fähranteil muss auch auf diesem
   Lineal herausgerechnet werden, nicht über den Umweg des anderen. */
function kmAt(list, unixSec){
  if(!list.length) return null;
  if(unixSec <= new Date(list[0].ts).getTime()/1000) return Number(list[0].km);
  for(let i = 1; i < list.length; i++){
    const tPrev = new Date(list[i-1].ts).getTime()/1000, tCur = new Date(list[i].ts).getTime()/1000;
    if(unixSec <= tCur){
      const f = tCur > tPrev ? (unixSec - tPrev)/(tCur - tPrev) : 1;
      return Number(list[i-1].km) + (Number(list[i].km) - Number(list[i-1].km))*f;
    }
  }
  return Number(list[list.length-1].km);
}
/* Der heutige (noch laufende) Tag ist ein Sonderfall gegenüber den
   abgeschlossenen Tagen in renderDays(): effortBetween() dort hängt am
   GPX-Export (profile.json) und friert ein, sobald der stockt — Cloudflare
   blockt ihn zeitweise (siehe update-tracker.mjs, zuletzt 02.08.2026 über
   5 Stunden), während der Live-Feed weiterläuft. Fürs Heute gibt es ein
   zweites Lineal, das nicht am Export hängt: kmAt() auf den Log-Metern plus
   `live.km`, das bei JEDEM Lauf geschrieben wird statt nur bei einer neuen
   Log-Zeile — dieselbe Frische-Regel wie beim Ø-Schnitt in compute(). Die
   Fährkorrektur läuft wie in renderFuel() auf derselben Tracker-Skala, nicht
   wie bei effortBetween() auf der Profil-Skala. Ältere Tage bleiben bewusst
   bei effortBetween(): das Log deckt erst ab der ersten eigenen Erfassung,
   die Spur reicht bis Trondheim zurück, und ein Tausch löste ihre Summe von
   der Gesamtstrecke. */
function todayKm(c){
  const dayStart = new Date(c.now.getFullYear(), c.now.getMonth(), c.now.getDate()).getTime()/1000;
  const kmNow = Math.max(c.km, Number(S.live && S.live.km) || 0);
  const kmMidnight = kmAt(c.list, dayStart);
  let km = kmNow - (kmMidnight ?? kmNow);
  const fer = ferryCrossing();
  if(fer && fer.state === 'done'){
    const bT = new Date(fer.boardTs).getTime()/1000, lT = new Date(fer.landTs).getTime()/1000;
    const from = Math.max(bT, dayStart), to = Math.min(lT, c.now.getTime()/1000);
    if(from < to){
      const vor = kmAt(c.list, from), nach = kmAt(c.list, to);
      if(vor != null && nach != null) km -= Math.max(nach - vor, 0);
    }
  }
  return Math.max(km, 0);
}
let PROF = null; // gerenderter Zustand für die Zeigersteuerung

// Das eigenständige Diagramm im Board: mit Kennzahlenstreifen und Erklärkasten.
function renderProfile(c){
  renderProfileInto(c, {wrapId:'profileWrap', prefix:'prof', strip:true, explain:true, window:true});
}
// Die gekoppelte Zweitfassung unter der Karte: nur das Diagramm, dafür schiebt
// der Zeiger einen Marker über die Karte mit.
function renderMapProfile(c){
  renderProfileInto(c, {wrapId:'mapProfileWrap', prefix:'mprof', strip:false, explain:false,
                        onHover: showMapPosition, onLeave: hideMapPosition});
}

function renderProfileInto(c, o){
  const wrap = document.getElementById(o.wrapId);
  if(!wrap) return;
  const wasOpen = !!wrap.querySelector('details')?.open;

  /* Die Höhenlinie kommt aus profile.json und folgt der echten gefahrenen
     Spur, mit einem Stützpunkt alle 500 m. Die Kilometer darin sind BRouters
     gerechnete Streckenlänge und werden hier auf die Renn-Kilometer des
     Trackers gestreckt (`kmScale`). `marks` sind die Meldungen aus data.json,
     auf dieselbe Achse gelegt. */
  const ptsAll = PROFILE
    ? PROFILE.points.map(([k,e])=> ({km: k*c.kmScale, ele: e}))
    : [];
  let marks = c.list.filter(e=> e.lat!=null).map(e=> ({
    km:Number(e.km), ts:e.ts, place:e.place||'',
    ele: ptsAll.length ? eleAtKm(ptsAll, Number(e.km)) : (e.ele!=null?Number(e.ele):null)
  })).filter(m=> m.ele!=null);

  /* Ausschnitt der letzten Tage ODER des heutigen Tages (nur das
     Board-Diagramm, nicht die an die Karte gekoppelte Zweitfassung). Die
     Schnitt-Kilometer kommen über die Zeit: `cumClimbAt` liefert den
     gerouteten Stand vor N Tagen bzw. seit Mitternacht, auf die Tracker-
     Achse gestreckt (`kmScale`) liegen sie auf derselben Skala wie `pts.km`.
     Erst ab genug Daten — vor dem N-ten Tag bzw. vor dem ersten Punkt des
     laufenden Tages ist „Ausschnitt“ gleich „Gesamt“, der jeweilige Reiter
     bleibt dann aus. PROF_VIEW folgt automatisch dem Zieltag-Flag, solange
     niemand selbst einen Reiter angeklickt hat (siehe PROF_VIEW_TOUCHED
     oben) — deshalb hier statt beim deklarieren neu ausgewertet. */
  if(!PROF_VIEW_TOUCHED) PROF_VIEW = istZieltag(c) ? 'heute' : 'fenster';
  let pts = ptsAll, fensterAb = null, heuteAb = null;
  const genugFuerFenster = o.window && ptsAll.length > 2 && PROFILE
    && PROFILE.chunks && PROFILE.chunks.length;
  if(genugFuerFenster){
    const cut = cumClimbAt(c.now.getTime()/1000 - PROF_FENSTER_TAGE*86400);
    fensterAb = cut ? cut.km * c.kmScale : null;
    const dayStart = new Date(c.now.getFullYear(), c.now.getMonth(), c.now.getDate()).getTime()/1000;
    const cutHeute = cumClimbAt(dayStart);
    heuteAb = cutHeute ? cutHeute.km * c.kmScale : null;
    // Nur windowen, wenn der Schnitt wirklich Strecke abschneidet — sonst ist
    // „Ausschnitt“ dasselbe Bild wie „Gesamt“ und der Umschalter nur Zierde.
    const anwenden = ab=>{
      const w = ptsAll.filter(p=> p.km >= ab);
      if(w.length > 1){ pts = w; marks = marks.filter(m=> m.km >= pts[0].km); }
    };
    if(PROF_VIEW === 'heute' && heuteAb != null && heuteAb > ptsAll[0].km + 1) anwenden(heuteAb);
    else if(PROF_VIEW === 'fenster' && fensterAb != null && fensterAb > ptsAll[0].km + 1) anwenden(fensterAb);
  }

  const strip = !o.strip ? '' : [
    ['Aktuelle Höhe', c.ele!=null? num(c.ele):'–', 'm ü. NN', ''],
    ['Höhenmeter bergauf', c.climbUp? num(c.climbUp):'–', 'hm',
      c.climbKm>0 ? num(c.climbUp/c.climbKm*100)+' hm je 100 km' : ''],
    ['Bergab', c.climbDown? num(c.climbDown):'–', 'hm', ''],
    ['Höchster Punkt', c.eleMax!=null? num(c.eleMax):'–', 'm', '']
  ].map(([k,v,u,n])=>
    `<div class="cell"><div class="k">${k}</div>
     <div class="v">${v}${u?` <span class="u">${u}</span>`:''}</div>
     ${n?`<div class="n">${n}</div>`:''}</div>`).join('');
  const stripHtml = o.strip ? `<div class="hmstrip">${strip}</div>` : '';

  if(pts.length < 2){
    wrap.innerHTML = stripHtml +
      `<div class="profbox"><div class="empty" style="border:none;padding:22px 8px">
        Das Höhenprofil wird aus der aufgezeichneten Spur berechnet und erscheint,
        sobald der erste Abschnitt ausgewertet ist.</div></div>`;
    PROFS[o.prefix] = null; return;
  }

  const W = Math.max(wrap.clientWidth || 340, 260);
  const H = W < 520 ? 158 : 205;
  const L = 36, R = 10, T = 16, B = 22;
  const x0 = pts[0].km, x1 = Math.max(pts[pts.length-1].km, pts[0].km + 1);
  const lo = Math.min(...pts.map(p=>p.ele)), hi = Math.max(...pts.map(p=>p.ele));
  const pad = Math.max((hi-lo)*0.18, 25);
  const eBot = Math.max(lo - pad, Math.min(0, lo)), eTop = hi + pad;
  const X = km => L + (km - x0)/(x1 - x0) * (W - L - R);
  const Y = e  => T + (eTop - e)/(eTop - eBot) * (H - T - B);
  const base = H - B;

  /* Aggregieren statt Ausdünnen. Am Ende des Rennens stehen ~9.600
     Stützpunkte einer Diagrammbreite von 340 Pixeln gegenüber — ein Pixel
     wäre dann rund 14 km. Würde man jeden n-ten Punkt nehmen, verschwänden
     genau die Pässe: ein Gipfel zwischen zwei Stichproben ist einfach weg,
     und die Alpen sähen flacher aus als die Poebene. Stattdessen bekommt
     jede Pixelspalte das Minimum UND das Maximum ihrer Höhen. Die Silhouette
     bleibt damit ehrlich, nur die Feinstruktur dazwischen fällt weg — und
     die will bei 14 km je Pixel ohnehin niemand sehen. */
  const cols = [];
  for(const p of pts){
    const xi = Math.round(X(p.km));
    const last = cols[cols.length-1];
    if(last && last.x === xi){ last.lo = Math.min(last.lo, p.ele); last.hi = Math.max(last.hi, p.ele); last.n++; }
    else cols.push({x: xi, lo: p.ele, hi: p.ele, km: p.km, n: 1});
  }
  const topLine = cols.map((q,i)=> `${i?'L':'M'}${q.x},${Y(q.hi).toFixed(1)}`).join('');
  // Fläche unter der Gipfellinie …
  const area = `M${cols[0].x},${base}L` + topLine.slice(1) +
               `L${cols[cols.length-1].x},${base}Z`;
  // … und das Band zwischen Tal- und Gipfelhöhe je Spalte. Wo eine Spalte nur
  // einen Punkt enthält (herangezoomt), fällt es auf null zusammen — dann
  // trägt allein die Linie, deshalb wird die immer zusätzlich gezeichnet.
  const band = cols.length > 1
    ? `M` + cols.map(q=> `${q.x},${Y(q.hi).toFixed(1)}`).join('L') + 'L' +
      cols.slice().reverse().map(q=> `${q.x},${Y(q.lo).toFixed(1)}`).join('L') + 'Z'
    : '';

  // Gitternetz: drei Höhenlinien, auf 50er/100er gerundet damit die Beschriftung ruhig bleibt
  const stepRaw = (eTop - eBot)/3;
  const step = stepRaw > 400 ? 500 : stepRaw > 200 ? 250 : stepRaw > 80 ? 100 : 50;
  let grid = '';
  for(let v = Math.ceil(eBot/step)*step; v <= eTop; v += step){
    grid += `<line class="gl" x1="${L}" y1="${Y(v).toFixed(1)}" x2="${W-R}" y2="${Y(v).toFixed(1)}" stroke-width="1"/>
             <text x="${L-6}" y="${(Y(v)+3.5).toFixed(1)}" text-anchor="end" font-size="9.5">${num(v)}</text>`;
  }

  // Kontrollpunkte, sofern sie im dargestellten Kilometerfenster liegen
  let cps = '';
  c.st.cps.forEach(cp=>{
    const k = Number(cp.km);
    if(k <= x0 || k >= x1) return;
    cps += `<line class="cpl" x1="${X(k).toFixed(1)}" y1="${T}" x2="${X(k).toFixed(1)}" y2="${base}"
                  stroke-width="1" stroke-dasharray="2 3" opacity=".4"/>
            <text x="${(X(k)+4).toFixed(1)}" y="${T+8}" font-size="9">${esc(cp.nm)}</text>`;
  });

  const cur = marks[marks.length-1];
  // Die Meldungen als kleine Punkte auf der Linie — die aktuelle in Messing.
  const dots = marks.map((m,i)=>
    `<circle class="${i===marks.length-1?'pdot':'pmark'}" cx="${X(m.km).toFixed(1)}" cy="${Y(m.ele).toFixed(1)}"
             r="${i===marks.length-1?4.5:2.4}" ${i===marks.length-1?'stroke-width="1.5"':''}/>`).join('');
  /* Jeder Reiter erscheint nur, wenn er wirklich etwas abschneidet — vor dem
     ersten eigenen Tagespunkt bzw. vor dem zweiten Tag ist „Ausschnitt"
     dasselbe Bild wie „Gesamt". „Gesamt" selbst erscheint immer, sobald
     überhaupt einer der beiden anderen Reiter da ist. */
  const zeigeHeute = heuteAb != null && heuteAb > ptsAll[0].km + 1;
  const zeigeFenster = fensterAb != null && fensterAb > ptsAll[0].km + 1;
  const zeigeToggle = o.window && (zeigeHeute || zeigeFenster);
  const profBtn = (view, label) => `<button class="${PROF_VIEW===view?'on':''}" data-view="${view}">${label}</button>`;
  const winHtml = zeigeToggle
    ? `<div class="profwin">
         ${zeigeHeute ? profBtn('heute', 'Heute') : ''}
         ${zeigeFenster ? profBtn('fenster', 'Letzte '+PROF_FENSTER_TAGE+' Tage') : ''}
         ${profBtn('full', 'Gesamt')}
       </div>`
    : '';

  const P = o.prefix;
  wrap.innerHTML = stripHtml +
    `<div class="profbox">
       <div class="profhead"><div class="profread" id="${P}Read"></div>${winHtml}</div>
       <svg id="${P}Svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
            aria-label="Höhenprofil der gefahrenen Strecke, aktuell ${num(cur.ele)} Meter">
         <defs><linearGradient id="${P}Fill" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0%" stop-color="#D9A441" stop-opacity=".34"/>
           <stop offset="100%" stop-color="#D9A441" stop-opacity="0"/>
         </linearGradient></defs>
         ${grid}
         <path d="${area}" fill="url(#${P}Fill)"/>
         ${band ? `<path class="pband" d="${band}"/>` : ''}
         <path class="pl" d="${topLine}" fill="none" stroke-width="1.6"
               stroke-linejoin="round" stroke-linecap="round"/>
         ${cps}
         <line class="gl" x1="${L}" y1="${base}" x2="${W-R}" y2="${base}"/>
         <text x="${L}" y="${H-7}" font-size="9.5">${num(x0)} km</text>
         <text x="${W-R}" y="${H-7}" text-anchor="end" font-size="9.5">${num(x1)} km</text>
         <line class="gd" id="${P}Guide" x1="0" y1="${T}" x2="0" y2="${base}" stroke-width="1" opacity="0"/>
         ${dots}
         <circle class="pcur" id="${P}Cursor" cx="0" cy="0" r="4" opacity="0"/>
         <rect id="${P}Hit" x="${L}" y="${T}" width="${W-L-R}" height="${base-T}" fill="transparent"/>
       </svg>
     </div>` +
    (!o.explain ? '' :
    `<details>
       <summary>Wie das Höhenprofil entsteht</summary>
       <div class="setbody">
         <p class="profnote" style="margin-top:14px">
           Der Tracker an Manuels Rad speichert seine Position etwa alle fünf Minuten. Diese
           Aufzeichnung ist öffentlich abrufbar, und das Board holt sie sich stündlich komplett —
           die Linie oben folgt also der <strong>tatsächlich gefahrenen Strecke</strong>, nicht
           einer angenommenen. Aktuell sind das ${num(PROFILE ? PROFILE.points.length : 0)}
           Stützpunkte über ${num(c.km)} km.
         </p>
         <p class="profnote">
           Höhenmeter meldet der Tracker allerdings nicht, und seine rohe GPS-Höhe taugt nicht
           zum Aufsummieren — sie schwankt um rund 20 Meter, und jeder Messfehler nach oben
           würde als Anstieg mitgezählt. Genau deshalb zeigen Radcomputer oft zu viele
           Höhenmeter an. Stattdessen wird die aufgezeichnete Spur an
           <a href="https://brouter.de/" target="_blank" rel="noopener">BRouter</a> übergeben,
           das die Punkte auf das Straßennetz legt, die Lücken dazwischen füllt und die
           Höhenmeter aus einem Geländemodell entrauscht aufsummiert.
         </p>
         <p class="profnote">
           Was bleibt: zwischen zwei aufgezeichneten Punkten liegen im Schnitt 1,6 km, deren
           Verlauf gerechnet und nicht gemessen ist. Kurze Wellen darin fehlen, die Summe
           fällt also eher etwas zu niedrig aus. Und die Streckenlänge weicht leicht von der
           des Trackers ab (${num(c.climbKm)} gegen ${num(c.km)} km) — fürs Diagramm wird sie
           auf dessen Kilometer gestreckt.
         </p>
       </div>
     </details>`);

  // Der Erklärkasten überlebt das 60s-Neuzeichnen — anders als beim Log-Detail
  // wäre ein Zuklappen mitten im Lesen hier echt ärgerlich.
  if(wasOpen){ const d = wrap.querySelector('details'); if(d) d.open = true; }

  wrap.querySelectorAll('.profwin button').forEach(b=> b.onclick = ()=>{
    PROF_VIEW = b.dataset.view; PROF_VIEW_TOUCHED = true; renderProfile(c);
  });

  PROFS[o.prefix] = {pts, cols, marks, X, Y, L, R, W, T, base, cur,
                     kmScale:c.kmScale, totalKm:c.km, opt:o};
  bindProfilePointer(o.prefix);
  showProfileRead(o.prefix, -1);
}

// Höhe an einem Renn-Kilometer, linear zwischen den Stützpunkten interpoliert.
function eleAtKm(pts, km){
  if(!pts.length) return null;
  if(km <= pts[0].km) return pts[0].ele;
  for(let i=1;i<pts.length;i++){
    if(pts[i].km >= km){
      const a = pts[i-1], b = pts[i], span = b.km - a.km;
      return Math.round(span > 0 ? a.ele + (b.ele-a.ele)*(km-a.km)/span : b.ele);
    }
  }
  return pts[pts.length-1].ele;
}

/* i = Spaltenindex, -1 = Ausgangszustand (aktuelle Position).
   Ortsname und Zeit gibt es nur, wenn der Zeiger nah genug an einer echten
   Meldung steht — dazwischen weiß das Board weder das eine noch das andere. */
function showProfileRead(prefix, i){
  const PROF = PROFS[prefix];
  const el = document.getElementById(prefix + 'Read');
  if(!el || !PROF) return;
  const q = i < 0 ? null : PROF.cols[i];
  const km = q ? q.km : PROF.cur.km;
  const ele = q ? q.hi : PROF.cur.ele;
  const span = PROF.pts[PROF.pts.length-1].km - PROF.pts[0].km;
  const near = PROF.marks.find(m=> Math.abs(m.km - km) < Math.max(span/60, .8));
  // Höhenmeter bis zu diesem Punkt: die Blöcke in profile.json tragen ihren
  // kumulierten Stand samt gerouteter Kilometer, also nach km interpolierbar.
  let cum = null;
  if(PROFILE && PROFILE.chunks && PROFILE.chunks.length){
    const routedKm = km / (PROF.kmScale || 1);
    let prevKm = 0, prevUp = 0;
    for(const [,kmEnd,up] of PROFILE.chunks){
      if(routedKm <= kmEnd){
        const f = kmEnd > prevKm ? (routedKm-prevKm)/(kmEnd-prevKm) : 1;
        cum = Math.round(prevUp + (up-prevUp)*f); break;
      }
      prevKm = kmEnd; prevUp = up;
    }
    if(cum === null) cum = Math.round(PROFILE.chunks[PROFILE.chunks.length-1][2]);
  }
  el.innerHTML =
    `<span><span class="rv">${num(ele)} m</span> bei ${num(km)} km</span>` +
    (q && q.n > 1 ? `<span style="opacity:.7">Tal ${num(q.lo)} m</span>` : '') +
    (cum !== null ? `<span>bis hier <span class="rv">↑ ${num(cum)}</span> hm</span>` : '') +
    (near ? `<span>${esc(near.place)}</span><span style="opacity:.7">${fmt(near.ts)}</span>` : '');
}

function bindProfilePointer(prefix){
  const PROF = PROFS[prefix];
  const svg = document.getElementById(prefix + 'Svg'), hit = document.getElementById(prefix + 'Hit');
  if(!svg || !hit || !PROF) return;
  const guide = document.getElementById(prefix + 'Guide');
  const cursor = document.getElementById(prefix + 'Cursor');
  const move = ev=>{
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width * PROF.W;   // Bildschirm- → SVG-Koordinaten
    let best = 0, bd = Infinity;
    PROF.cols.forEach((q,i)=>{ const d = Math.abs(q.x-px); if(d<bd){ bd=d; best=i; } });
    const q = PROF.cols[best];
    guide.setAttribute('x1', q.x); guide.setAttribute('x2', q.x);
    guide.setAttribute('opacity', '.45');
    cursor.setAttribute('cx', q.x); cursor.setAttribute('cy', PROF.Y(q.hi));
    cursor.setAttribute('opacity', '1');
    showProfileRead(prefix, best);
    if(PROF.opt.onHover) PROF.opt.onHover(q.km, PROF.totalKm);
  };
  const leave = ()=>{
    guide.setAttribute('opacity','0'); cursor.setAttribute('opacity','0');
    showProfileRead(prefix, -1);
    if(PROF.opt.onLeave) PROF.opt.onLeave();
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
  hit.addEventListener('pointercancel', leave);
}

// Breitenabhängig gerendert, also bei Größenänderung neu zeichnen (entprellt).
let profResizeT = null;
addEventListener('resize', ()=>{
  clearTimeout(profResizeT);
  profResizeT = setTimeout(()=>{
    const c = compute();
    renderProfile(c);
    if(document.getElementById('mapDetails').open) renderMapProfile(c);
  }, 180);
});

/* Der Tagesstreifen unter den Balken: 24 Stunden von links nach rechts,
   Messing wo die Spur Bewegung zeigt, abgedunkelt wo er stand — dieselben
   Pausen wie Karte und Log (findStops), damit nicht drei Stellen drei
   verschiedene Wahrheiten behaupten. Es heißt STANDZEIT, nicht Schlaf: die
   Spur kennt den Grund nicht. Ohne geladene Spur (erster Rendergang) gibt es
   schlicht keinen Streifen — kommt beim Nachladen von selbst. */
function dayStrip(key){
  if(!TRACK) return '';
  const p = TRACK.points;
  const t0 = new Date(key + 'T00:00').getTime()/1000, t1 = t0 + 86400;
  const letzterPunkt = p[p.length-1][3];
  /* Die laufende Pause reicht bis jetzt, nicht nur bis zum letzten Spurpunkt —
     ES SEI DENN, der frischere Live-Fix zeigt schon wieder Fahrt (Export
     hinkt hinterher). Sonst malt der Streifen stundenlang Standzeit, obwohl
     er längst fährt. Gleiche Korrektur wie im Positionslog. */
  const widerlegt = liveWiderlegtStand(letzterPunkt);
  const spurEnde = widerlegt ? letzterPunkt : Math.max(letzterPunkt, Date.now()/1000);
  const von = Math.max(t0, p[0][3]), bis = Math.min(t1, spurEnde);
  if(bis <= von) return '<div class="daystrip"></div>';
  const pct = sec => ((sec - t0)/864).toFixed(2);       // Sekunden → % von 24 h
  let segs = '', standMin = 0;
  for(const s of trackStops()){
    const laeuft = s.to === letzterPunkt && !widerlegt;
    const a = Math.max(s.from, von), b = Math.min(laeuft ? spurEnde : s.to, bis);
    if(b > a){ segs += `<i style="left:${pct(a)}%;width:${((b-a)/864).toFixed(2)}%"></i>`; standMin += (b-a)/60; }
  }
  /* Die Fähre selbst hinterlässt in der Spur keine Punkte (offene See) und
     fiele ohne diesen Zusatz unter „durchgefahren" — Messing wäre falsch (er
     trat nicht), die normale Standzeit-Abdunklung auch (er stand nicht,
     das Schiff fuhr). Anders als bei einer echten Pause/einem Funkloch kennen
     wir den Grund hier aber genau (ferryCrossing(), echte GPS-Zeiten), daher
     eine eigene Farbe statt der üblichen Zurückhaltung „Standzeit, nie mehr". */
  const fer = ferryCrossing();
  if(fer && fer.state === 'done'){
    const bT = new Date(fer.boardTs).getTime()/1000, lT = new Date(fer.landTs).getTime()/1000;
    const a = Math.max(bT, von), b = Math.min(lT, bis);
    if(b > a) segs += `<i class="ferry" title="Fähre" style="left:${pct(a)}%;width:${((b-a)/864).toFixed(2)}%"></i>`;
  }
  return `<div class="daystrip" title="${standMin >= 5 ? dhm(standMin)+' Standzeit' : 'durchgefahren'}">` +
         `<b style="left:${pct(von)}%;width:${((bis-von)/864).toFixed(2)}%"></b>${segs}</div>`;
}

function renderDays(c){
  const w = document.getElementById('daysWrap');
  if(c.list.length < 2){ w.innerHTML = '<div class="empty">Ab zwei Meldungen erscheint hier die Tagesleistung.</div>'; return; }
  const byDay = {}, upDay = {};
  let todayK = null, todayHmAsOf = null;
  if(PROFILE && PROFILE.chunks && PROFILE.chunks.length){
    /* Aus der aufgezeichneten Spur, nicht aus den Meldungen: die decken erst
       ab der ersten eigenen Erfassung ab, die Spur reicht bis Trondheim
       zurück. Sonst stünden hier Tageswerte, die sich nicht zur Gesamtsumme
       addieren. Kalendertage in lokaler Zeit, passend zu `ts` in data.json. */
    const dayKey = d => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
    const first = new Date((PROFILE.startUnix ?? PROFILE.chunks[0][0]) * 1000);
    const lastT = PROFILE.chunks[PROFILE.chunks.length-1][0] * 1000;
    for(let d = new Date(first.getFullYear(), first.getMonth(), first.getDate());
        d.getTime() <= lastT; d.setDate(d.getDate()+1)){
      const from = Math.max(d.getTime()/1000, PROFILE.startUnix ?? 0);
      const to = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1).getTime()/1000;
      // effortBetween() statt cumClimbAt(): rechnet eine dazwischen liegende
      // Fährüberfahrt wieder raus, sonst bekäme ihr Tag dieselbe erfundene
      // Kilometer-/Standzeit-Gutschrift wie vorher die Verpflegung.
      const eff = effortBetween(from, Math.min(to, lastT/1000));
      if(!eff) continue;
      const key = dayKey(d);
      byDay[key] = eff.km * c.kmScale;
      upDay[key] = Math.round(eff.up);
    }
    /* Heute überschreiben: der Balken oben rechnet bis lastT (Ende der
       archivierten Spur) und friert ein, sobald der GPX-Export stockt —
       dann zeigt er einen alten Stand, obwohl Log und `live` längst weiter
       sind (siehe todayKm() oben). Nur die Kilometer werden ersetzt; die
       Höhenmeter (upDay) bleiben auf dem letzten Profilstand, weil sie sich
       ohne Profil nicht neu rechnen lassen. */
    todayK = dayKey(c.now);
    const abgedecktHeute = byDay[todayK] || 0;   // vom Profil abgedeckte Tages-km
    byDay[todayK] = todayKm(c);
    /* Der ↑-Wert des Tages bleibt beim Profilstand — ohne dichte Spur nicht
       neu rechenbar, und eine zweite Höhenquelle wäre eine erfundene Zahl
       (dotwatcher.cc & Co. haben die Spur auch nicht, sie betten denselben
       Cloudflare-gated Tracker ein). Also wird der Stand kommentiert statt
       eine Teilsumme als Tagessumme auszugeben: übersteigen die frischen
       Kilometer die abgedeckten deutlich, fehlt dem Profil echte
       Fahrstrecke → Zeitpunkt anhängen, bis zu dem die Summe reicht. Steht
       er dagegen (Halt/Schlaf), ist die Lücke ~0 und nichts wird markiert —
       dieselbe Pause-vs-Ausfall-Unterscheidung wie bei der Karte, hier über
       die Kilometerlücke statt über das nackte Alter der Spur. */
    if(byDay[todayK] - abgedecktHeute > DAY_HM_STALE_KM)
      todayHmAsOf = new Date(lastT).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  } else {
    for(let i=1;i<c.list.length;i++){
      const a=c.list[i-1], b=c.list[i];
      const key = b.ts.slice(0,10);
      byDay[key] = (byDay[key]||0) + Math.max(Number(b.km)-Number(a.km), 0);
    }
  }
  const keys = Object.keys(byDay).sort();
  const max = Math.max(...keys.map(k=>byDay[k]), 1);
  const best = keys.reduce((p,k)=> byDay[k]>byDay[p]?k:p, keys[0]);
  w.innerHTML =
    `<div class="dayscrollwrap"><div class="dayscroll"><div class="daystrack">` +
      `<div class="days">${keys.map(k=>`<div class="day"><span class="daykm">${num(byDay[k])}</span>
        ${upDay[k]?`<span class="dayhm">↑${num(upDay[k])}${k===todayK&&todayHmAsOf?`<span class="dayhmstale" title="Höhenmeter aus der aufgezeichneten Spur, die gerade hinterherhängt — Stand ${todayHmAsOf} Uhr. Die Kilometer sind aktuell.">…</span>`:''}</span>`:''}
        <div class="bar ${k===best?'top':''}" style="height:${byDay[k]/max*60}px"></div></div>`).join('')}</div>` +
      (TRACK ? `<div class="daystrips">${keys.map(k=>`<div class="daystripcell">${dayStrip(k)}</div>`).join('')}</div>` : '') +
      `<div class="daylabels">${keys.map(k=>`<div class="daylabel">${k.slice(8)}.${k.slice(5,7)}.</div>`).join('')}</div>` +
    `</div></div></div>` +
    (todayHmAsOf ? `<div class="daynote">Heutige ↑ Höhenmeter erst bis ${todayHmAsOf} Uhr erfasst — der Spur-Export hängt gerade. Die Kilometer sind aktuell.</div>` : '') +
    (TRACK ? `<div class="striplegend">Streifen je Tag (0–24 Uhr): <span class="lg-ride">▬</span> unterwegs · ▬ Standzeit${
      c.ferry && c.ferry.state === 'done' ? ` · <span class="lg-ferry">▬</span> Fähre` : ''}</div>` : '');

  /* Beim ersten Aufbau — und immer, wenn der Nutzer ohnehin ganz rechts steht —
     ans rechte Ende scrollen, damit der jüngste (und laufende) Tag zu sehen
     ist. Hat er nach links gewischt, um Vergangenes anzusehen, bleibt seine
     Position über das 60s-Neuzeichnen erhalten (wie fitBounds bei der Karte
     die herangezoomte Ansicht nicht wegreißt). */
  const sc = w.querySelector('.dayscroll');
  if(sc){
    if(!DAYS_INIT || DAYS_ATRIGHT) sc.scrollLeft = sc.scrollWidth;
    else sc.scrollLeft = DAYS_LEFT;
    DAYS_INIT = true;
    DAYS_ATRIGHT = (sc.scrollWidth - sc.clientWidth - sc.scrollLeft) < 8;
    const wrap = w.querySelector('.dayscrollwrap');
    const fades = ()=>{
      wrap.classList.toggle('more-left', sc.scrollLeft > 2);
      wrap.classList.toggle('more-right', sc.scrollWidth - sc.clientWidth - sc.scrollLeft > 2);
    };
    fades();
    sc.onscroll = ()=>{ DAYS_LEFT = sc.scrollLeft;
      DAYS_ATRIGHT = (sc.scrollWidth - sc.clientWidth - sc.scrollLeft) < 8; fades(); };
  }
}
let DAYS_INIT = false, DAYS_LEFT = 0, DAYS_ATRIGHT = true;

/* ---------- Fährplanung Südschweden ----------
   Ein Planungspanel für eine einzige Entscheidung: mit welcher Ostsee-Fähre
   geht es nach Świnoujście. Es lebt nur, solange die Frage offen ist, und
   schaltet sich selbst ab, sobald er südlich der Ostsee ist (`ausAbLat`).

   Der Grund für dieses Panel ist eine Beobachtung, die man auf der Karte
   nicht sieht: Malmö, Trelleborg und Ystad sind KEINE Alternativen, sie
   liegen in dieser Reihenfolge hintereinander auf derselben Route, 32 bzw.
   48 Kilometer auseinander. Der Hafen muss also nicht vorab gewählt werden —
   gewählt wird die Abfahrt, an der er ankommt. Deshalb rechnet das Panel
   nicht „welcher Hafen", sondern „wann ist er wo, und was fährt dann".

   Was hier NICHT hineingehört: eine Empfehlung, die so tut, als kenne sie
   die Auslastung. Ob ein Schiff Platz hat, weiß dieses Board nicht und kann
   es nicht wissen — es zeigt nur, welche Abfahrten zeitlich erreichbar sind.
   Die Kennzeichnung als Nachtfähre ist die eigentliche Aussage: eine
   Überfahrt von sechs bis acht Stunden ist genau eine Nachtruhe. Nachts
   kostet sie keine Rennzeit, tagsüber kostet sie einen halben Fahrtag.

   ZWEI LINEALE, dasselbe Problem wie bei den Kontrollpunkten (siehe `cpHit`):
   die Hafendistanzen sind mit BRouter geroutet (`trekking`, dasselbe Profil
   wie in update-tracker.mjs) und stehen damit auf BRouters Skala, `live.km`
   steht auf der des Trackers. Umgerechnet wird mit `c.kmScale`, derselben
   Kalibrierung, mit der auch das Höhenprofil gestreckt wird — sie wird mit
   jedem Lauf genauer, statt auf einem Faktor von heute festzustehen.

   DIE FAHRPLÄNE SIND DAS SCHWÄCHSTE GLIED, und sie sind es zweimal
   geworden. Der erste Aufbau nahm Wochentagsmuster aus aggregierten
   Portalen — 41 Abfahrten die Woche, vier Reedereien. Ein Gegencheck in den
   Buchungsmaschinen am 22.07.2026, mit gesetztem Fahrrad, ließ davon einen
   Bruchteil übrig. Zwei Gründe, beide grundsätzlich:

   1. POLSCA S.A. hat am 30.03.2026 Polferries UND Unity Line übernommen und
      die Flotte umverteilt (Jantar Unity weg von Trelleborg, Mazovia hin).
      Die Portale zeigen streckenweise noch den Stand davor. Ein Fahrplan,
      den niemand gegen den Betrieb geprüft hat, ist eine Behauptung.
   2. Ein Platz für einen Menschen ist kein Platz für ein Rad. Auf
      Trelleborg–Świnoujście befördert POLSCA derzeit gar keine Fahrräder —
      die Abfahrt steht im Fahrplan, im Portal, und ist für ihn trotzdem
      keine. Genau diese Abfahrten sind die gefährlichsten: sie sehen aus
      wie eine Option.

   Deshalb steht hier KEIN Wochentagsmuster mehr, sondern datumsgenaue
   Abfahrten, jede einzeln in einer Buchungsmaschine mit Rad nachgesehen
   (`geprueftAm`). Was nicht geprüft ist, existiert für dieses Panel nicht —
   und über `geprueftBis` hinaus sagt es das ausdrücklich, statt eine leere
   Liste als "keine Fähre" auszugeben. Abfahrten, die nachweislich KEINE
   Räder nehmen, bleiben mit `rad:false` stehen: Negativwissen ist teuer
   erkauft, und ohne die Zeile trägt sie beim nächsten Mal jemand wieder ein.

   Die Liste ist nach unten sicher und nach oben offen — es kann mehr geben,
   als hier steht, aber nichts Zusätzliches ist bestätigt. Sie steht als
   Konstante und nicht in data.json: sie ist redaktionell, nicht gemessen,
   und nichts anderes im Board darf sich auf sie stützen. Der Hinweis darauf
   steht sichtbar unter der Tabelle, nicht nur in diesem Kommentar. */
const FERRY = {
  ankerKm: 794.57,        // Tracker-Kilometerstand, ab dem die Distanzen gemessen sind (Geilo, 22.07.2026)
  ausAbLat: 55.0,         // südlich davon ist die Ostsee überquert und die Frage erledigt
  zielPos: [53.910, 14.278],   // Świnoujście, für den Karten-Zielpunkt der Überfahrt
  /* Das Ostsee-Band, an dem die tatsächliche Überfahrt erkannt wird. Der ganze
     Trick: zwischen der schwedischen Südküste und Świnoujście liegt NUR offene
     See — ein Spurpunkt hier drin sitzt zwangsläufig auf einem Boot, Manuel
     schwimmt nicht und radelt dort nicht. Erkannt wird der Nord→Süd-Übergang
     durchs Band (siehe ferryCrossing()), das trägt auch bei einer reinen
     Funkloch-Lücke mitten auf der Ostsee. Die Längengrad-Grenzen halten
     Bornholm (14,9°O) und die dänischen Inseln (<12,5°O) draußen, sonst wäre
     das Band nicht mehr reines Wasser. mindKm verwirft zu kurze Sprünge. */
  seeband: { latNord: 55.30, latSued: 54.05, lonWest: 12.6, lonOst: 14.5, mindKm: 40 },
  /* Ab wie vielen Kilometern hinter einem Hafen der als endgültig passiert
     gilt und aus der Auswahl fällt. Nicht bei 0: die Kilometerstände stehen
     auf zwei verschiedenen Linealen (siehe unten), ein paar Kilometer
     Unschärfe sind normal — und wer am Terminal steht, hat den Hafen
     rechnerisch schon knapp überschritten. */
  passiertKm: 15,
  checkinMin: 60,         // Vorlauf am Terminal. Für ein Rad als Fußgepäck reicht das; Autos brauchen 2 h.
  nachtVon: 19.5, nachtBis: 3,   // Abfahrtsfenster, in dem die Überfahrt die Nachtruhe ersetzt
  /* Wie weit zurück nach knapp verpassten Abfahrten gesucht wird. Eine Fähre,
     die kurz vor seiner Ankunft ablegt, ist die teuerste Information im
     ganzen Panel und zugleich die einzige, die sonst gar nicht auftaucht:
     bei Plantempo kommt er 01:26 in Ystad an, die Nachtfähre um 01:00 ist
     26 Minuten weg, und der Unterschied zur nächsten Möglichkeit ist ein
     halber Fahrtag. Genau das ist die Brücke zwischen Tempo und Fähre — also
     der Zweck dieses Panels. */
  knappStd: 6,
  ziel: 'Świnoujście',
  geprueftAm: '22.07.2026',
  /* Letzter Tag, für den mit Rad nachgesehen wurde. Je Hafen überschreibbar,
     und das ist nicht Feinschliff: die Prüftiefe hängt daran, wie weit die
     Suchmaske getrieben wurde, und die war je Hafen verschieden. Ein globaler
     Horizont ließ das Panel für Ystad am Sonntag "keine Abfahrt" behaupten,
     wo "nicht nachgesehen" richtig war — derselbe Fehler wie zuvor, nur eine
     Ebene tiefer. */
  geprueftBis: '2026-07-26',
  /* `d` Abfahrtsdatum, `t` Abfahrt, `an` Ankunft (vor `t` = Folgetag).
     Ankunftszeit statt Dauer, damit die Zeilen direkt aus dem Fahrplan
     abgeschrieben werden können — eine Dezimalstunde ist eine Rechnung, und
     Rechnungen beim Abschreiben sind eine Fehlerquelle ohne Gegenwert.

     `q` ist die BELEGSTÄRKE, und sie steht hier, weil sie unterschiedlich
     teuer erkauft ist:
       'rad'  in einer Buchungsmaschine MIT gesetztem Fahrrad übrig geblieben
       'plan' offizieller Fahrplan der Reederei, Radmitnahme nicht einzeln
              geprüft — die Abfahrt fährt, ob sie sein Rad nimmt, ist offen
     Beide werden gewertet, aber 'plan' wird sichtbar als solches ausgewiesen.
     Alles über einen Kamm zu scheren hieße, den Unterschied wegzuwerfen, der
     diese Liste überhaupt erst belastbar gemacht hat. */
  haefen: [
    { nm:'Malmö', brouterKm:902, pos:[55.606,12.985], url:'https://www.finnlines.com/routes/swinoujscie-malmo/',
      geprueftBis:'2026-07-26', ab:[
      {d:'2026-07-25', t:'11:00', an:'19:15', linie:'Finnlines · Finnfellow', preis:34, q:'rad'},
      {d:'2026-07-26', t:'10:15', an:'19:15', linie:'Finnlines · Finnfellow', preis:34, q:'rad'},
    ]},
    { nm:'Trelleborg', brouterKm:936, pos:[55.372,13.157], url:'https://www.ttline.com/de/schweden-faehren/trelleborg-swinoujscie/',
      geprueftBis:'2026-07-26', ab:[
      {d:'2026-07-25', t:'09:00', an:'15:00', linie:'TT-Line · Nils Holgersson', preis:31, q:'rad'},
      {d:'2026-07-25', t:'17:30', an:'00:00', linie:'POLSCA', rad:false},
      {d:'2026-07-26', t:'07:45', an:'14:00', linie:'TT-Line · Tom Sawyer', preis:31, q:'rad'},
      {d:'2026-07-26', t:'15:45', an:'23:15', linie:'TT-Line · Tinker Bell', preis:38, q:'rad'},
      {d:'2026-07-26', t:'17:00', an:'23:30', linie:'POLSCA', rad:false},
    ]},
    /* Ystad aus dem Monatsfahrplan von Polferries selbst (Juli 2026), nicht
       aus einem Portal. Gegenprobe: das Buchungs-Dropdown für den 26.07.
       listet 01:00 · 08:50 · 13:00 · 17:30 · 23:50 — genau die fünf Zeilen,
       die hier für den Tag stehen. Die 23:50 am 25.07. ist zusätzlich mit Rad
       bestätigt (50 €); die Route nimmt also grundsätzlich Räder. */
    { nm:'Ystad', brouterKm:986, pos:[55.419,13.820], url:'https://polferries.com/prices-i-timetable/ferries-to-sweden-timetable.html',
      geprueftBis:'2026-07-27', ab:[
      {d:'2026-07-25', t:'09:30', an:'15:30', linie:'POLSCA · Mazovia',  q:'plan'},
      {d:'2026-07-25', t:'13:00', an:'20:00', linie:'POLSCA · Varsovia', q:'plan'},
      {d:'2026-07-25', t:'23:50', an:'07:30', linie:'POLSCA · M/F Polonia', q:'rad'},
      {d:'2026-07-26', t:'01:00', an:'09:00', linie:'POLSCA · Jantar',   q:'rad'},
      {d:'2026-07-26', t:'08:50', an:'15:00', linie:'POLSCA · Mazovia',  q:'plan'},
      {d:'2026-07-26', t:'13:00', an:'19:30', linie:'POLSCA · Varsovia', q:'plan'},
      {d:'2026-07-26', t:'17:30', an:'23:59', linie:'POLSCA · Epsilon',  q:'plan'},
      {d:'2026-07-26', t:'23:50', an:'06:15', linie:'POLSCA · Polonia',  q:'plan'},
      {d:'2026-07-27', t:'12:45', an:'19:00', linie:'POLSCA · Mazovia',  q:'plan'},
      {d:'2026-07-27', t:'13:00', an:'19:30', linie:'POLSCA · Varsovia', q:'plan'},
      {d:'2026-07-27', t:'22:45', an:'06:15', linie:'POLSCA · Polonia',  q:'plan'},
    ]},
  ],
  /* Tagesleistungen INKLUSIVE Pausen — die Währung der Tagesbalken, nicht
     reines Fahrtempo. Gelände-kalibriert: bis Geilo lagen 12,4 Höhenmeter je
     Kilometer an, von hier bis Trelleborg sind es 5,0. Sein Muster von rund
     14 Stunden Fahrzeit am Tag ergibt bei 21 km/h knapp 300 km — der mittlere
     Wert ist also nicht geraten, sondern Manuels eigener Plan, gegengerechnet. */
  szenarien: [
    {nm:'vorsichtig', kmT:260}, {nm:'Plan', kmT:300}, {nm:'stark', kmT:340},
  ],
  /* Die eine tatsächlich gebuchte Überfahrt (Buchung am 24.07.2026 bestätigt).
     Sobald das hier gesetzt ist, beantwortet es die Frage, um die sich der
     ganze Rest der Datei dreht ("welche Fähre") endgültig — renderFerry()
     zeigt dann keine Szenario-Tabelle mehr, sondern nur noch den Countdown zur
     Abfahrt (renderFerryBooked()).
     Kein manuelles Zurücksetzen nötig: erkennt ferryCrossing() später die
     echte GPS-Überfahrt, greift in renderFerry() schon der ältere
     `ferAktiv`-Zweig zuerst, und dieser Codepfad wird nie mehr erreicht. */
  booked: {
    hafen: 'Ystad', linie: 'POLSCA · M/F Polonia',
    d: '2026-07-25', t: '23:50', an: '07:30',
    preis: 50, q: 'rad', gebuchtAm: '24.07.2026',
  },
};

let FER_SCEN = 1;   // gewähltes Szenario; Modulvariable, damit sie das 60s-Re-Render überlebt
/* Gleiches Motiv wie LOG_ALL: der Erklärteil wird bei jedem render() neu
   gebaut, ein aufgeklappter Kasten fiele sonst im Minutentakt wieder zu. */
let FER_INFO = false;

/* Abfahrten eines Hafens ab `ab`, nach Zeit sortiert. Seit die Einträge
   datumsgenaue sind (siehe oben), ist das ein Filter und keine Fahrplanlogik
   mehr — das Wochentagsmuster, das hier stand, war genau die Erfindung, die
   der Gegencheck kassiert hat. Abfahrten ohne Radmitnahme kommen mit, sie
   werden nur nicht gewertet. */
function ferryDeps(hafen, ab){
  return hafen.ab.map(dep=>{
    const t = new Date(`${dep.d}T${dep.t}`);
    const an = new Date(`${dep.d}T${dep.an}`);
    if(an <= t) an.setDate(an.getDate()+1);   // Ankunft vor Abfahrt heißt Folgetag
    return {ab:t, an, dauer:(an-t)/3.6e6, linie:dep.linie, preis:dep.preis,
            q:dep.q, rad:dep.rad !== false};
  }).filter(d=> d.ab >= ab).sort((a,b)=> a.ab - b.ab);
}

const ferWochentag = d => d.toLocaleDateString('de-DE',{weekday:'short'}).replace('.','');
const ferZeit = d => d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
const ferTagZeit = d => `${ferWochentag(d)} ${d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})}, ${ferZeit(d)}`;

/* Dieselbe Kalibrierung wie beim Höhenprofil, aber geklemmt (0,92…1,02) —
   geteilt zwischen der Szenario-Rechnung und dem Countdown zur gebuchten
   Fähre, damit beide bei einer Änderung nicht auseinanderlaufen. Siehe
   Kommentar an der ursprünglichen Verwendungsstelle in renderFerry(). */
function ferrySkala(c){ return Math.min(1.02, Math.max(0.92, c.kmScale || 1)); }

/* Abfahrt/Ankunft der gebuchten Fähre als Date-Paar, gleiche Folgetag-Regel
   wie ferryDeps(): `an` vor `t` heißt, sie legt erst nach Mitternacht an. */
function bookedDeparture(){
  const b = FERRY.booked;
  if(!b) return null;
  const ab = new Date(`${b.d}T${b.t}`);
  const an = new Date(`${b.d}T${b.an}`);
  if(an <= ab) an.setDate(an.getDate()+1);
  return {ab, an};
}

function renderFerry(c){
  const det = document.getElementById('ferryDetails');
  // Andenken-Zustand: die Ostsee ist Geschichte, sobald das ganze Rennen es
  // ist. Der Breitengrad-Test unten träfe dasselbe, aber nicht so klar lesbar.
  if(istAngekommen(c)){ det.hidden = true; return; }
  const fer = c.ferry;
  /* Nur solange die Überfahrt tatsächlich läuft — die 24h-Nachlaufzeit nach
     der Landung (bis 26.07.2026 in Kraft) ist auf Wunsch wieder raus: sobald
     `ferryCrossing()` 'done' meldet, entscheidet allein noch der Breitengrad
     unten, ob das Panel abschaltet. */
  const ferAktiv = fer && fer.state === 'onboard';
  /* Abschalten, sobald die Ostsee hinter ihm liegt — aber nicht schon MITTEN
     auf der Überfahrt. Die Fährroute kreuzt `ausAbLat` (55°N) auf offener See,
     der reine Breitengrad-Test ließe das Panel also im Moment seiner größten
     Nützlichkeit verschwinden. Solange eine Überfahrt läuft, bleibt es
     sichtbar; danach greift der Rückfall über den Breitengrad. */
  const pos = c.list.filter(e=> e.lat != null).pop();
  if(!ferAktiv && (!pos || pos.lat < FERRY.ausAbLat)){ det.hidden = true; return; }
  det.hidden = false;

  /* Läuft eine Überfahrt (oder ist sie frisch gelandet), ist die Frage „welche
     Fähre“ beantwortet — statt Szenario-Knöpfen und Hafen-Tabelle steht dann
     nur noch der Status. Der Erklär-<details> bleibt darunter. */
  if(ferAktiv){ renderFerryStatus(c, fer); return; }

  /* Ist eine Überfahrt gebucht, ist "welche Fähre" keine offene Frage mehr —
     die ganze Szenario-Rechnung darunter dient nur noch der Suche danach und
     wird durch den Countdown zur Abfahrt ersetzt. */
  if(FERRY.booked){ renderFerryBooked(c); return; }

  // Der frischeste Kilometerstand, den wir haben — `live` schreibt der Scraper
  // bei jedem Lauf, das Log nur ab 1 km Bewegung. Kilometer wachsen nur.
  const km = Math.max(c.km, Number(S.live && S.live.km) || 0);
  const szen = FERRY.szenarien[FER_SCEN];
  const jetzt = c.now;

  /* Bewertet wird nicht die früheste Ankunft drüben, sondern die verlorene
     Zeit — und zwar aus einem Grund, der im ersten Entwurf noch fehlte und
     das Panel gegen seinen eigenen Erklärtext hätte antreten lassen: eine
     Überfahrt von sechs bis acht Stunden ersetzt eine Nachtruhe. Nachts
     kostet sie nichts, tagsüber kostet sie sich selbst, weil er drüben
     trotzdem noch schlafen muss. Nach der reinen Ankunftszeit gewann im
     Szenario "stark" eine Tagesfähre — die früher anlegt und ihn trotzdem
     einen halben Fahrtag kostet.
        Verlust = Wartezeit am Terminal + (Tagesfähre ? Überfahrt : 0)
     Die Fahrt zum weiter entfernten Hafen zählt bewusst NICHT als Verlust:
     sie bringt ihn dem Ziel näher, sie hält ihn nicht auf. */
  const istNacht = d=>{
    const std = d.ab.getHours() + d.ab.getMinutes()/60;
    return std >= FERRY.nachtVon || std < FERRY.nachtBis;
  };
  /* Dieselbe Kalibrierung wie beim Höhenprofil — aber geklemmt, und das ist
     nicht Vorsicht, sondern eine Lehre aus dem Aufbau: `kmScale` ist der
     Quotient aus `live.km` und `profile.routedKm`, zwei Größen mit
     verschiedenem Ladetakt (5 gegen 15 Minuten) und verschiedener Herkunft.
     Läuft eine davon der anderen davon — Profil hinkt nach einem
     Scraper-Ausfall hinterher, oder umgekehrt —, wandert der Faktor, und mit
     ihm wanderten die Hafendistanzen um Dutzende Kilometer. Beobachtet wurde
     stabil 0,957; alles außerhalb dieses Bandes ist ein Zeichen für einen
     Rückstand, nicht dafür, dass BRouter plötzlich anders routet. */
  const skala = ferrySkala(c);
  const bloecke = FERRY.haefen.map(h=>{
    const zielKm = FERRY.ankerKm + h.brouterKm * skala;
    const rest = zielKm - km;
    const an = rest > 0 ? new Date(jetzt.getTime() + rest/szen.kmT*24*3.6e6) : jetzt;
    const fruehestens = new Date(an.getTime() + FERRY.checkinMin*6e4);
    const alle = ferryDeps(h, new Date(fruehestens.getTime() - FERRY.knappStd*3.6e6));
    const deps = alle.filter(d=> d.ab >= fruehestens).slice(0, 4);
    /* Knapp verpasst: fährt vor seiner Abfahrbereitschaft, aber nicht lange.
       Gerechnet ohne Wartezeit — er wäre ja gerade erst angekommen —, also
       bleibt bei einer Nachtfähre glatt null Verlust stehen. */
    const knapp = alle.filter(d=> d.rad && d.ab < fruehestens).map(d=>{
      d.nacht = istNacht(d);
      d.frueher = fruehestens - d.ab;
      d.hypVerlust = d.nacht ? 0 : d.dauer*3.6e6;
      return d;
    /* Bei gleichwertigem Verlust — zwei Nachtfähren kosten beide nichts —
       gewinnt die, für die er am wenigsten Vorsprung gebraucht hätte. Ohne
       diesen Stichentscheid nannte das Panel die 23:50 vom Vortag statt der
       01:00, die nur 26 Minuten entfernt war: derselbe Nutzen, doppelter
       geforderter Aufwand. */
    }).reduce((p,d)=> !p || d.hypVerlust < p.hypVerlust
                   || (d.hypVerlust === p.hypVerlust && d.frueher < p.frueher) ? d : p, null);
    deps.forEach(d=>{
      d.nacht = istNacht(d);
      d.warten = d.ab - an;
      d.verlust = d.warten + (d.nacht ? 0 : d.dauer*3.6e6);
    });
    /* Innerhalb eines Hafens gilt dieselbe Rechnung: die günstigste Abfahrt
       muss nicht die nächste sein — drei Stunden länger warten kann billiger
       sein als eine Überfahrt bei Tageslicht. Abfahrten ohne Radmitnahme
       stehen in der Liste, kommen aber nie in die Wertung. */
    const beste = deps.filter(d=> d.rad)
      .reduce((p,d)=> !p || d.verlust < p.verlust ? d : p, null);
    /* Reicht seine Ankunft über den geprüften Horizont hinaus, ist eine leere
       Liste KEINE Aussage über den Fahrplan, sondern über unser Wissen. Die
       beiden auseinanderzuhalten ist der ganze Punkt der Umstellung auf
       datumsgenaue Einträge — "keine Fähre" und "nicht nachgesehen" sehen im
       Datenmodell sonst identisch aus. */
    const horizont = new Date(`${h.geprueftBis || FERRY.geprueftBis}T23:59`);
    return {h, rest, an, deps, beste, knapp, ungeprueft: an > horizont};
  });
  /* Hinter ihm liegende Häfen sind keine Wahl mehr und fallen raus — aber
     niemals der letzte. Die beiden Kilometerskalen liegen rund vier Prozent
     auseinander, auf 986 km sind das fast vierzig; die Toleranz oben kann das
     gar nicht auffangen. Wer in Ystad am Terminal steht, gilt danach leicht
     als "vorbei", und ausgerechnet dann verschwände das Panel im Moment
     seiner größten Nützlichkeit. Ob die Ostsee wirklich hinter ihm liegt,
     entscheidet die Breite weiter oben — die hängt an keinem Lineal. */
  const offen = bloecke.filter(b=> b.rest > -FERRY.passiertKm);
  if(offen.length) bloecke.splice(0, bloecke.length, ...offen);
  else bloecke.splice(0, bloecke.length - 1);
  const empfohlen = bloecke.filter(b=> b.beste)
    .reduce((p,b)=> !p || b.beste.verlust < p.beste.verlust ? b : p, null);

  document.getElementById('ferrySum').innerHTML = 'Fähre nach ' + esc(FERRY.ziel) + ' · ' + (empfohlen
    ? `<b>ab ${esc(empfohlen.h.nm)} ${ferTagZeit(empfohlen.beste.ab)} → an ${ferTagZeit(empfohlen.beste.an)}</b>`
    : '<b>keine erreichbare Abfahrt im Fenster</b>');

  const knoepfe = FERRY.szenarien.map((s,i)=>
    `<button data-scen="${i}" class="${i===FER_SCEN?'on':''}">${esc(s.nm)}<b>${s.kmT} km/Tag</b></button>`).join('');

  /* Gerechnet wird ab JETZT vom frischesten Kilometerstand. Steht er gerade,
     wächst der Zähler nicht, die Uhr aber schon — die Ankunftszeiten wandern
     also während einer Pause von selbst nach hinten, statt eine Verspätung
     zu verschlucken. Das ist gewollt und darf nicht "geglättet" werden, es ist
     dieselbe Haltung wie beim Ø-Schnitt in compute(): lieber eine Prognose,
     die mit dem Stillstand altert, als eine, die ihn wegrechnet. Gesagt wird
     es trotzdem, sonst sieht es nach einer wackeligen Zahl aus. */
  const stop = S.live && S.live.stopSince && !(Number(S.live.speed) > 0) ? S.live.stopSince : null;
  const pause = stop
    ? `<div class="ferpause">Er steht gerade (seit ${fmt(stop)}, ${dur(jetzt - new Date(stop))}).
         Die Ankunftszeiten rechnen ab jetzt mit der vollen Tagesleistung und rücken
         deshalb weiter nach hinten, solange die Pause läuft.</div>`
    : '';

  /* Steht die Empfehlung selbst nur auf dem Fahrplan, muss das oben stehen und
     nicht als Kürzel in einer Zeile: es ist die eine Sache, die vor dem Buchen
     noch zu klären ist. */
  const belegHinweis = empfohlen && empfohlen.beste.q === 'plan'
    ? `<div class="ferpause">Die empfohlene Abfahrt steht im Fahrplan der Reederei, ihre
         Radmitnahme ist aber nicht einzeln geprüft (Kürzel <b>Plan</b>). Auf dieser Route
         nimmt POLSCA Räder mit — für dieses Schiff bestätigt ist es nicht.</div>`
    : '';

  const karten = bloecke.map(b=>{
    const kopf = `<div class="ferhead">
        <span class="pn">${esc(b.h.nm)}</span>
        <span class="pa">${b.rest > 0
          ? `noch ${num(b.rest)} km · ${ferTagZeit(b.an)}`
          : 'erreicht'}</span>
      </div>`;
    // "Nicht nachgesehen" ist eine andere Aussage als "fährt nicht", und nur
    // eine davon darf hier stehen.
    if(b.ungeprueft) return `<div class="ferport">${kopf}
        <div class="fernone">Ankunft nach dem ${fmt((b.h.geprueftBis || FERRY.geprueftBis)+'T00:00').slice(0,6)} —
          für diesen Tag ist der Fahrplan hier nicht mit Rad geprüft.</div></div>`;
    if(!b.deps.length) return `<div class="ferport">${kopf}
        <div class="fernone">Keine geprüfte Abfahrt nach seiner Ankunft.</div></div>`;
    let vorTag = null;   // für die Datums-Deduplizierung innerhalb des Hafens
    const zeilen = b.deps.map(d=>{
      const top = d === b.beste;
      const tag = `${ferWochentag(d.ab)} ${d.ab.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})}`;
      // Datum nur, wenn es sich ändert — sonst reicht die Uhrzeit.
      const abTxt = tag === vorTag ? ferZeit(d.ab) : `${tag}, ${ferZeit(d.ab)}`;
      vorTag = tag;
      const arr = `→ ${ferZeit(d.an)}${d.an.getDate()!==d.ab.getDate()?' (+1)':''}${d.nacht?' 🌙':''}`;
      // Fahrplan der Reederei, Rad nicht einzeln geprüft — sichtbar, aber leise.
      const beleg = d.rad && d.q === 'plan' ? '<span class="plan" title="Fahrplan der Reederei — Radmitnahme nicht einzeln geprüft">Plan</span>' : '';
      const meta = !d.rad
        ? '<span class="norad">kein Fahrrad an Bord</span>'
        : `<span class="pk">${esc(d.linie)}${d.preis?` · ab ${d.preis} €`:''}</span>${beleg}` +
          `<span class="wt">${dur(d.warten)} Warten${d.nacht?'':` + ${dur(d.dauer*3.6e6)} Tagfahrt`}</span>`;
      return `<div class="ferdep${top?' first':''}${d.rad?'':' aus'}">
          <div class="fdtime"><span class="mk">${d.rad ? (top?'↳':'·') : '×'}</span> <span class="dt">${abTxt}</span> <span class="arr">${arr}</span></div>
          <div class="fdmeta">${meta}</div>
        </div>`;
    }).join('');
    /* Nur zeigen, wenn sie WIRKLICH besser gewesen wäre — sonst ist das kein
       Hinweis, sondern Bedauern ohne Gegenwert. Eine Stunde Schwelle, damit
       Rundungsunterschiede nicht als Chance auftreten. */
    const knappZeile = b.knapp && b.beste && b.knapp.hypVerlust < b.beste.verlust - 3.6e6
      // dhm() statt dur(): hier IST die Minute die Aussage — "1 h" statt
      // "1 h 26 min" verschenkt genau den Unterschied, um den es geht.
      ? `<div class="ferknapp"><b>${dhm(b.knapp.frueher/6e4)} früher hier</b>, und die
           ${b.knapp.nacht?'Nachtfähre ':''}${ferZeit(b.knapp.ab)}${b.knapp.nacht?' 🌙':''} wäre drin —
           spart ${dur(b.beste.verlust - b.knapp.hypVerlust)} gegenüber der hier nächstbesten.</div>`
      : '';
    return `<div class="ferport${empfohlen && b === empfohlen ? ' pick':''}">${kopf}${zeilen}${knappZeile}</div>`;
  }).join('');

  const w = document.getElementById('ferryWrap');
  /* Der Erklärteil steht eingeklappt: die Tabelle darüber ist die Antwort,
     das hier ist die Begründung. Wer sie einmal gelesen hat, braucht sie
     nicht bei jedem Blick aufs Board wieder. */
  w.innerHTML = `<div class="ferscen-hint">Tagesleistung antippen</div>
    <div class="ferscen">${knoepfe}</div>${pause}${belegHinweis}${karten}
    ${ferryInfoHtml()}`;
  w.querySelectorAll('.ferscen button').forEach(b=> b.onclick = ()=>{
    FER_SCEN = Number(b.dataset.scen); renderFerry(c);
  });
  const info = w.querySelector('.ferinfo');
  if(info) info.ontoggle = ()=>{ FER_INFO = info.open; };
}

/* Die Frage "welche Fähre" ist beantwortet — dieser Zweig zeigt nur noch, ob
   die Zeit bis zur Abfahrt reicht: ein Countdown als Fokuspunkt für die
   nächsten Stunden, kein Vergleich mehr. Läuft die Abfahrt laut Uhr schon,
   hat die Spur die Überfahrt aber noch nicht bestätigt (der `ferAktiv`-Zweig
   weiter oben greift erst dann), sagt die Karte das ehrlich statt eine
   negative Uhr laufen zu lassen — dieselbe Vorsicht wie bei "Trackerstille
   ist kein Stillstand" weiter oben in dieser Datei: eine Lücke am Ende der
   Spur heißt nicht automatisch, dass etwas falsch lief. */
function renderFerryBooked(c){
  const b = FERRY.booked;
  const dep = bookedDeparture();
  const jetzt = c.now;
  const sum = document.getElementById('ferrySum');
  const w = document.getElementById('ferryWrap');

  if(jetzt >= dep.ab){
    sum.innerHTML = `⛴️ Fähre ${esc(b.hafen)} → ${esc(FERRY.ziel)} · <b>müsste unterwegs sein</b>`;
    w.innerHTML = `<div class="ferbooked">
        <div class="ferb-eyebrow"><span class="ferryAnim">⛴️</span> ${esc(b.linie)}</div>
        <div class="ferb-head">Vermutlich schon auf See</div>
        <div class="ferb-meta">Ab ${esc(b.hafen)} ${ferZeit(dep.ab)} → an ${esc(FERRY.ziel)} ${ferZeit(dep.an)} Uhr —
          diese Karte zieht nach, sobald die Spur die Überfahrt bestätigt.</div>
      </div>`;
    return;
  }

  sum.innerHTML = `🎉 Fähre gebucht · <b>${ferTagZeit(dep.ab)} ab ${esc(b.hafen)}</b>`;

  w.innerHTML = `<div class="ferbooked">
      <div class="ferb-eyebrow">🎉 Fähre gebucht</div>
      <div class="ferb-head"><span class="ferryAnim">⛴️</span> ${esc(b.hafen)} → ${esc(FERRY.ziel)}</div>
      <div class="ferb-count"><span class="ferb-num">${dhm((dep.ab-jetzt)/6e4)}</span><span class="ferb-lbl">bis zur Abfahrt</span></div>
      <div class="ferb-meta">${esc(b.linie)} · ${ferTagZeit(dep.ab)} → an ${ferTagZeit(dep.an)} in ${esc(FERRY.ziel)}${b.preis?` · ${b.preis} €`:''}</div>
      <div class="ferb-cheer">Stark gefahren bis hierhin — jetzt heißt's ankommen, dann übernimmt die Fähre. 💪</div>
    </div>`;
}

/* Der eingeklappte Erklärteil des Fährpanels — geteilt zwischen der
   Szenario-Tabelle und der Status-Ansicht während der Überfahrt. */
function ferryInfoHtml(){
  return `<details class="ferinfo"${FER_INFO?' open':''}>
    <summary>Wie das gerechnet ist — und woher die Fahrpläne stammen</summary>
    <div class="ferinfobody">
    <p class="profnote">Die drei Häfen liegen hintereinander auf der Route — Malmö, dann
      32 km weiter Trelleborg, dann 48 km weiter Ystad. Der Hafen muss deshalb nicht vorab
      gewählt werden; wer bis Trelleborg fährt, hat alle drei noch in der Hand.
      Die Messing-Kante markiert nicht die früheste Abfahrt, sondern die geringste
      verlorene Zeit — Warten am Terminal, bei einer Tagesfähre zusätzlich die Überfahrt.</p>
    <p class="profnote">Denn eine Überfahrt dauert 6 bis 9 Stunden und ist damit genau eine
      Nachtruhe: eine <b>🌙 Nachtfähre kostet praktisch keine Rennzeit</b>, eine
      Tagesfähre einen halben Fahrtag, weil er drüben trotzdem noch schlafen muss.
      Es lohnt sich also eher, die Ankunft an der Küste auf den Abend zu legen, als so
      früh wie möglich dort zu sein — und mitunter, eine frühere Fähre ziehen zu lassen.</p>
    <p class="profnote"><b>Stand ${esc(FERRY.geprueftAm)}, aus zwei Quellen mit
      unterschiedlichem Gewicht:</b> ohne Kürzel = in einer Buchungsmaschine mit gesetztem
      Fahrrad übrig geblieben · <span class="plan">Plan</span> = Monatsfahrplan der Reederei,
      Radmitnahme nicht für dieses Schiff geprüft. Aggregierte Vergleichsportale sind hier
      bewusst keine Quelle mehr: sie zeigen teils noch den Stand vor der Übernahme von
      Polferries und Unity Line durch POLSCA (30.03.2026) und unterscheiden nicht, ob ein
      Schiff Räder mitnimmt. Auf Trelleborg → ${esc(FERRY.ziel)} tut POLSCA das derzeit nicht;
      diese Abfahrten stehen mit × dabei, damit sie niemand für eine Möglichkeit hält.</p>
    <p class="profnote">Distanzen mit BRouter geroutet (Profil <code>trekking</code>) und auf die
      Skala des Trackers gestreckt, Tagesleistungen einschließlich Pausen.
      Über die Auslastung sagt dieses Panel nichts — vor dem Buchen bei der Reederei prüfen:
      ${FERRY.haefen.map(h=> `<a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.nm)}</a>`).join(' · ')}.
      Fällt ${esc(FERRY.ziel)} ganz aus, bleibt Trelleborg → Rostock (deutlich dichter
      getaktet), kostet aber etwa 125 km mehr Landweg bis CP2.</p>
    <p class="profnote"><b>Direkt bei der Reederei buchen, nicht über ein Portal</b> — hier
      nicht wegen der Buchungsgebühr, sondern weil eine Ankunftszeit, die auf einer
      Tagesleistung beruht, sich verschieben wird. Umbuchen geht bei der Reederei
      unkompliziert, über einen Vermittler selten.</p>
    </div></details>`;
}

/* Status statt Planung: während der Überfahrt und 24 h danach. Die Zeiten
   kommen aus der Spur (boardTs/landTs), der Linien-Name aus dem passenden
   Fahrplaneintrag, falls einer nah genug lag. */
function renderFerryStatus(c, fer){
  const hhmmTs = ts => new Date(ts).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  const hafen = fer.hafen ? esc(fer.hafen.nm) : 'Schweden';
  const linie = fer.dep ? ` · ${esc(fer.dep.linie)}` : '';
  let box;
  if(fer.state === 'onboard'){
    const dauer = dhm((c.now - new Date(fer.boardTs)) / 6e4);
    document.getElementById('ferrySum').innerHTML =
      `<b>⛴️ Auf der Fähre nach ${esc(FERRY.ziel)}</b>`;
    box = `<div class="ferstatus on">
        <div class="fsline"><span class="ferbig">⛴️ Auf der Fähre</span> nach ${esc(FERRY.ziel)}</div>
        <div class="fsmeta">ab ${hafen} ${hhmmTs(fer.boardTs)} Uhr${linie} · unterwegs seit ${dauer}</div>
      </div>`;
  } else {
    document.getElementById('ferrySum').innerHTML =
      `Fähre nach ${esc(FERRY.ziel)} · <b>genommen ab ${hafen}</b>`;
    box = `<div class="ferstatus done">
        <div class="fsline"><span class="ferbig">⛴️ Fähre genommen</span></div>
        <div class="fsmeta">${hafen} ${hhmmTs(fer.boardTs)} → ${esc(FERRY.ziel)} ${hhmmTs(fer.landTs)} Uhr${linie}</div>
      </div>`;
  }
  /* Ohne den Erklärteil: der begründet die WAHL einer Fähre, und die ist ab
     dem Ablegen keine Frage mehr. Ab hier ist das Panel nur noch ein Status —
     das Emoji und die Zeiten bleiben, die Fahrplan-Tabelle und ihre
     Herleitung verschwinden. Ihren Platz nimmt das Verpflegungs-Panel ein. */
  document.getElementById('ferryWrap').innerHTML = box;
}

/* ---------- Verpflegung: Kalorien und Landesküche ----------

   Das Panel, das die Fährplanung ablöst, sobald die Ostsee-Frage beantwortet
   ist. Es entscheidet nichts, warnt vor nichts und niemand muss danach
   handeln — es rechnet die Fahrt in die Währung um, die auf einem
   Ultra-Rennen tatsächlich zählt, und sagt, was es dafür im nächsten Land
   gibt. Manuel isst vegetarisch, die Karten sind entsprechend gewählt.

   DIE RECHNUNG steht auf zwei Termen, weil die Fahrt aus zwei verschiedenen
   Arbeiten besteht — und das ist keine Verkomplizierung, sondern der
   Unterschied zwischen 1.600 flachen und 1.600 bergigen Kilometern:

     Ebene   Rollwiderstand (Crr 0,006) und Luftwiderstand (CdA 0,42) ergeben
             bei rund 22 km/h zusammen ~15 N. Über 1.000 m sind das 15 kJ
             mechanisch, bei 23 % Wirkungsgrad des Menschen 65 kJ
             metabolisch — 15,6 kcal je Kilometer.
     Höhe    m·g·h: 95 kg über einen Höhenmeter sind 932 J mechanisch, durch
             denselben Wirkungsgrad 4,05 kJ — 0,97 kcal je Höhenmeter. Das
             ist genau die bekannte Faustregel „100 hm bei 100 kg ≈ 100 kcal“.

   Systemgewicht 95 kg (Fahrer, Rad und Gepäck) ist die EINZIGE von außen
   gesetzte Zahl; alles andere folgt daraus. Gezeigt wird die reine
   Fahrleistung — das, was ein Radcomputer anzeigt und was er ZUSÄTZLICH zum
   Grundumsatz essen muss. Der Grundumsatz steht als Nebenzeile daneben,
   damit beide Zahlen dastehen und keine die andere verschluckt.

   Die Höhenmeter kommen aus `c.climbUp`, also aus profile.json — dieselbe
   und einzige Höhenquelle wie überall sonst im Board. Hier keine zweite
   aufmachen, auch nicht „nur fürs Gimmick“.

   Das LAND kommt aus `entry.cc`, das der Scraper aus derselben
   Nominatim-Antwort mitschreibt wie den Ortsnamen (siehe reverseGeocode()).
   Es ist damit gemessen statt geraten. Der naheliegende Weg wären
   Bounding-Boxen im Frontend gewesen — die überlappen auf dem Balkan
   (Kroatien, Bosnien und Montenegro liegen ineinander verschachtelt) und
   hätten ausgerechnet dort danebengelegen, wo die Route am kleinteiligsten
   ist. Fehlt `cc`, schweigt das Panel über das Land, statt eines zu raten. */
const FUEL = {
  systemKg: 95,
  kcalProKm: 15.6,
  kcalProHm: 0.97,
  grundumsatzTag: 1750,   // Fahrer allein, ruhend — nur für die Nebenzeile
  swarmMax: 60,           // Deckel für den Emoji-Haufen, sonst 19 Zeilen am Rennende
  /* Die Route in Länderreihenfolge. `em`/`snack`/`kcal` ist die WÄHRUNG des
     Landes: der Snack, in dem hier gezählt wird. `pl` ist dessen Mehrzahl und
     steht ausgeschrieben da, weil sie sich aus dem Singular nicht ableiten
     lässt: Skolebrød und Lángos bleiben gleich, Pączek wird zu Pączki,
     Halušky und Priganice sind schon Mehrzahl. Eine Regel dafür gäbe es
     nicht, nur eine Reihe falscher Formen. `karte` ist die Empfehlung —
     durchweg vegetarisch, durchweg unterwegs zu bekommen. Kalorienangaben
     sind Hausnummern für übliche Portionen, keine Laborwerte; sie stehen im
     Panel deshalb mit „rund“ dabei. */
  laender: [
    {cc:'NO', nm:'Norwegen', flag:'🇳🇴', em:'🥐', snack:'Skolebrød', pl:'Skolebrød', kcal:350, karte:[
      ['🥐','Skolebrød','Hefeteig, Vanillecreme, Kokos',350],
      ['🌀','Kanelbolle','die norwegische Zimtschnecke',300],
      ['🧀','Brunost aufs Knekkebrød','Karamellkäse, hält ewig',200],
    ]},
    {cc:'SE', nm:'Schweden', flag:'🇸🇪', em:'🍥', snack:'Zimtschnecke', pl:'Zimtschnecken', kcal:300, karte:[
      ['🍥','Kanelbulle','die Zimtschnecke — Manus Standard',300],
      ['🌿','Kardemummabulle','Kardamom statt Zimt',320],
      ['🥪','Ostmacka','Käsebrot zum Kaffee',250],
    ], notiz:'Fika ist hier praktisch Streckenverpflegung — und in dieser Währung rechnet das Panel gerade.'},
    {cc:'PL', nm:'Polen', flag:'🇵🇱', em:'🍩', snack:'Pączek', pl:'Pączki', kcal:300, karte:[
      ['🍩','Pączek','Krapfen, klassisch mit Rosenkonfitüre',300],
      ['🥟','Pierogi ruskie','Kartoffel und Quark, eine Portion',450],
      ['🥯','Drożdżówka','Hefeteilchen mit Pudding',280],
      ['🍰','Sernik','polnischer Käsekuchen',350],
    ]},
    {cc:'CZ', nm:'Tschechien', flag:'🇨🇿', em:'🧀', snack:'Smažák', pl:'Smažáky', kcal:700, karte:[
      ['🧀','Smažený sýr','frittierter Käse im Brötchen',700],
      ['🥔','Bramborák','Kartoffelpuffer mit Knoblauch',300],
      ['🍪','Koláče','Hefegebäck mit Quark oder Mohn',250],
    ], notiz:'Der frittierte Käse ist das kalorienreichste Ding auf der ganzen Route — ein Smažák deckt fast einen halben Fahrtag Klettern.'},
    {cc:'SK', nm:'Slowakei', flag:'🇸🇰', em:'🥔', snack:'Halušky', pl:'Halušky', kcal:750, karte:[
      ['🥔','Bryndzové halušky','Nocken mit Schafskäse, Nationalgericht',750],
      ['🍫','Horalky','Haselnusswaffel, an jedem Kiosk',150],
      ['🌙','Šúľance s makom','Mohnnudeln',400],
    ], notiz:'Hier liegt CP2 am Chopok — die Halušky danach sind verdient.'},
    {cc:'HU', nm:'Ungarn', flag:'🇭🇺', em:'🫓', snack:'Lángos', pl:'Lángos', kcal:450, karte:[
      ['🫓','Lángos','Fladen mit Sauerrahm und Käse',450],
      ['🍫','Túró Rudi','Quarkriegel aus jedem Kühlregal',130],
      ['🍥','Kürtőskalács','Baumstriezel vom Rost',400],
    ]},
    {cc:'HR', nm:'Kroatien', flag:'🇭🇷', em:'🥧', snack:'Burek', pl:'Burek', kcal:550, karte:[
      ['🥧','Burek sa sirom','Blätterteigrolle mit Käse',550],
      ['🧀','Štrukli','Quarkstrudel, Zagreber Küche',400],
      ['🍩','Fritule','Teigbällchen mit Rosinen',250],
    ]},
    {cc:'BA', nm:'Bosnien', flag:'🇧🇦', em:'🥬', snack:'Zeljanica', pl:'Zeljanice', kcal:500, karte:[
      ['🥬','Zeljanica','Blätterteig mit Spinat',500],
      ['🧀','Sirnica','dieselbe Rolle mit Käse',520],
      ['🍎','Tufahija','Apfel mit Walnuss in Sirup',350],
    ], notiz:'Wichtig für ihn: <b>„Burek“ heißt hier ausschließlich die Fleischvariante.</b> Vegetarisch bestellt man Sirnica (Käse) oder Zeljanica (Spinat) — in Kroatien meint Burek beides, hier nicht.'},
    {cc:'RS', nm:'Serbien', flag:'🇷🇸', em:'🧀', snack:'Gibanica', pl:'Gibanice', kcal:450, karte:[
      ['🧀','Gibanica','Blätterteig mit Käse und Ei, das serbische Nationalgebäck',450],
      ['🥧','Burek sa sirom','Blätterteigrolle mit Käse — anders als in Bosnien meint Burek hier auch die Käseversion',520],
      ['🍩','Krofne','Krapfen mit Marmelade, an jedem Kiosk',300],
    ], notiz:'Kurzer Grenzstreifen an der Drina zwischen Bosnien und Montenegro auf dem Weg Richtung CP4.'},
    {cc:'ME', nm:'Montenegro', flag:'🇲🇪', em:'🍯', snack:'Priganice', pl:'Priganice', kcal:350, karte:[
      ['🍯','Priganice','Teigbällchen mit Honig und Kajmak',350],
      ['🌽','Cicvara','Maisgrieß mit Kajmak, Bergküche',600],
      ['🧀','Njeguški sir','Bergkäse vom Lovćen',300],
    ]},
    {cc:'XK', nm:'Kosovo', flag:'🇽🇰', em:'🍌', snack:'Krem Banana', pl:'Krem Banana', kcal:220, karte:[
      ['🍌','Krem Banana','Bananencreme in Schokolade, an jedem Kiosk',220],
      ['🥧','Flija','geschichtete Palatschinken-Torte mit Kajmak',600],
      ['🥬','Pite me spinaq','Spinat im Blätterteig, wie Byrek nebenan',450],
    ], notiz:'Kurzer Grenzzipfel zwischen Montenegro und Albanien auf dem Weg nach CP4 Leskovik.'},
    {cc:'AL', nm:'Albanien', flag:'🇦🇱', em:'🥟', snack:'Byrek', pl:'Byrek', kcal:400, karte:[
      ['🥟','Byrek me spinaq','Spinatblätterteig, überall und billig',400],
      ['🍯','Petulla','frittierter Teig mit Honig',350],
      ['🍮','Trileçe','Milchkuchen, drei Sorten Milch',400],
    ], notiz:'CP4 Leskovik liegt hier — und Byrek gibt es in Albanien an jeder Tankstelle.'},
    {cc:'MK', nm:'Nordmazedonien', flag:'🇲🇰', em:'🥯', snack:'Banica', pl:'Banici', kcal:450, karte:[
      ['🥯','Banica so sirenje','Blätterteig mit Käse und Ei, der serbischen Gibanica sehr ähnlich',450],
      ['🍩','Mekici','frittierte Teigpuffer, mit Käse oder Ajvar bestrichen',380],
      ['🍯','Tulumbi','frittierter Teig in Zuckersirup',400],
    ], notiz:'Ein kurzer Grenzzipfel auf der Fahrt durch Albanien Richtung Griechenland — hin und zurück auf wenigen Kilometern.'},
    {cc:'GR', nm:'Griechenland', flag:'🇬🇷', em:'🥙', snack:'Spanakopita', pl:'Spanakopites', kcal:350, karte:[
      ['🥙','Spanakopita','Spinat und Feta im Blätterteig',350],
      ['🥧','Bougatsa','Grießcreme im Blätterteig, warm',400],
      ['🥯','Koulouri','Sesamkringel, das Frühstück to go',250],
      ['🍯','Loukoumades','Honigbällchen',300],
    ], notiz:'Letztes Land. In Kalamata gibt es die Spanakopita zur Zieleinfahrt.'},
  ],
};

/* Fahrleistung in Kilokalorien — die beiden Terme aus dem Kommentar oben. */
function fuelKcal(km, hm){
  return Math.max(km, 0) * FUEL.kcalProKm + Math.max(hm || 0, 0) * FUEL.kcalProHm;
}

/* Das Land der jüngsten Meldung, die eines trägt. Alte Einträge aus der Zeit
   vor `cc` haben keins — deshalb rückwärts suchen statt nur den letzten
   ansehen. */
let FUEL_OVERRIDE = null;   // Debug-Hook tcr84Land(), siehe unten
function fuelLand(c){
  if(FUEL_OVERRIDE) return FUEL_OVERRIDE;
  const e = c.list.filter(x=> x.cc && FUEL.laender.some(l=> l.cc === x.cc)).pop();
  return e ? FUEL.laender.find(l=> l.cc === e.cc) || null : null;
}

/* Sichtbar ab dem Moment, in dem die Fähre ablegt — entweder weil die Spur
   die Überfahrt bestätigt hat, oder weil die gebuchte Abfahrtszeit erreicht
   ist. Der zweite Weg ist nötig, weil mitten auf der Ostsee kein Netz ist:
   die Spur bestätigt die Überfahrt erst Stunden später, und bis dahin stünde
   sonst weder Fähre noch Verpflegung da. */
/* Werkstatt-Logbuch: was unterwegs kaputtging, verlorenging und gerichtet wurde.
   Von Hand gemeldet, nicht gemessen — deshalb Frontend-Konstante wie FERRY/FUEL/
   WIND, nicht data.json. `grp` steuert die Anzeige-Gruppe, `kat` nur die Bilanz-
   Zählung. Neue Meldung: Zeile anhängen, km ist der Tracker-Stand bei Eintritt. */
const WERKSTATT = {
  intro: 'Was unterwegs kaputtging, verlorenging — und wieder gerichtet wurde.',
  eintraege: [
    {km:10,   ic:'🔔', txt:'Klingel verloren',                    grp:'defekt',  kat:'verlust'},
    {km:40,   ic:'🔧', txt:'Reifenpanne hinten',                  grp:'defekt',  kat:'reifen'},
    {km:250,  ic:'🔧', txt:'Reifenpanne hinten',                  grp:'defekt',  kat:'reifen'},
    {km:670,  ic:'🍌', txt:'Banane verloren',                     grp:'defekt',  kat:'verlust'},
    {km:680,  ic:'🔧', txt:'Reifenpanne hinten',                  grp:'defekt',  kat:'reifen'},
    {km:1300, ic:'🔧', txt:'Reifenpanne vorn',                    grp:'defekt',  kat:'reifen'},
    {km:2100, ic:'⛓️', txt:'Kette geölt',                         grp:'wartung', kat:'kette'},
    {km:3000, ic:'🔧', txt:'Reifenpanne vorn',                    grp:'defekt',  kat:'reifen'},
    {km:3150, ic:'⛓️', txt:'Kette geölt',                         grp:'wartung', kat:'kette'},
    {km:3150, ic:'🔩', txt:'Bowdenzug Schaltung hinten gerissen', grp:'defekt',  kat:'defekt'},
    {km:4050, ic:'🦵', txt:'Sehnenreizung rechte Kniekehle · Leistung ~80%, Schmerz erträglich', grp:'defekt', kat:'defekt'},
    {km:4125, ic:'⛓️', txt:'Kette geölt',                         grp:'wartung', kat:'kette'},
    {km:4572, ic:'🎉', txt:'Knie läuft nach Einstellungen am Rad gut: Klickpedal-Winkel verändert, Sattel etwas vor. Kann wieder begrenzt liegend fahren — zuversichtlich, morgen zu beenden.', grp:'wartung', kat:'update'},
  ]
};

/* Einmaliger, leiser Board-Hinweis — von Hand gepflegte Frontend-Konstante wie
   WERKSTATT (redaktionell, nicht gemessen). Poppt einmal je Gerät als
   .celebrate-Overlay (showHinweis), ausdrücklich OHNE Konfetti/Haken: bei einer
   Verletzung wäre der Feier-Schmuck tonlos. `id` ist die Gesehen-Marke —
   bumpen zeigt einen NEUEN Hinweis erneut, derselbe nie zweimal; `null`
   schaltet den Hinweis ganz ab. Tonlage bewusst neutral zum Ausgang (Abbruch
   ist okay), kein Druck — Manuel liest mit. */
const HINWEIS = {
  id: 'knieverletzung-2026-08',
  em: '🙏',
  eyebrow: 'Aus der Werkstatt',
  titel: 'Denkt an Manuel',
  text: 'Seit Kilometer 4.050 fährt Manuel mit einer Sehnenreizung im Knie — ' +
        'angeschlagen, aber unterwegs. Er beißt sich durch, so weit es geht; ' +
        'und wenn Schluss ist, ist Schluss, ganz ohne schlechtes Gewissen. ' +
        'Kein Anfeuern unter Druck — schick ihm einfach einen guten Gedanken.',
  cta: 'Einen Zuruf schicken'
};

/* Bilanz-Fragmente für die Kopfzeile — nur nicht-leere Kategorien, in fester
   Reihenfolge, Singular/Plural von Hand (eine Regel gäbe es nicht, nur eine
   Reihe falscher Formen — siehe FUEL.pl). Reifenpannen zuerst, sie sind die
   Geschichte. */
function werkstattBilanz(z){
  const n = k => z.filter(e=> e.kat === k).length;
  const teile = [];
  const r = n('reifen'), v = n('verlust'), ke = n('kette'), d = n('defekt');
  if(r)  teile.push(`${r} ${r===1?'Reifenpanne':'Reifenpannen'}`);
  if(v)  teile.push(`${v}× verloren`);
  if(ke) teile.push(`${ke}× Kette geölt`);
  if(d)  teile.push(`${d} ${d===1?'Defekt':'Defekte'}`);
  return teile;
}

function renderWerkstatt(c){
  const det = document.getElementById('werkstattDetails');
  // km-Guard: nie ein Missgeschick „vor" dem Fahrer. Die Liste ist ohnehin
  // rückblickend, aber so kann keine vorab getippte Zeile zu früh auftauchen.
  const z = WERKSTATT.eintraege.filter(e=> e.km <= (c.km||0) + 1)
    .slice().sort((a,b)=> a.km - b.km);
  if(!z.length){ det.hidden = true; return; }
  det.hidden = false;

  const bilanz = werkstattBilanz(z);
  document.getElementById('werkstattSum').innerHTML =
    'Werkstatt · <b>' + esc(bilanz[0]) + '</b>' +
    (bilanz.length > 1 ? ' · ' + bilanz.slice(1).map(esc).join(' · ') : '') +
    '<span class="wkhint">Antippen zum Aufklappen ▾</span>';

  const gruppe = (key, titel)=>{
    const rows = z.filter(e=> e.grp === key);
    if(!rows.length) return '';
    return `<div class="wkgrp"><div class="wkhead">${titel}</div>` +
      rows.map(e=>
        `<div class="wkrow"><span class="wkem">${e.ic}</span>` +
        `<span class="wkkm">${num(e.km)} km</span>` +
        `<span class="wktxt">${esc(e.txt)}</span></div>`).join('') +
      `</div>`;
  };

  document.getElementById('werkstattWrap').innerHTML =
    `<div class="wknote">${esc(WERKSTATT.intro)}</div>` +
    gruppe('defekt', 'Defekte &amp; Verluste') +
    gruppe('wartung', 'Wartung') +
    `<div class="wkbilanz">${bilanz.map(esc).join(' · ')} — und trotzdem dabei.</div>`;
}

function fuelSichtbar(c){
  if(c.ferry && (c.ferry.state === 'onboard' || c.ferry.state === 'done')) return true;
  const dep = bookedDeparture();
  return !!(dep && c.now >= dep.ab);
}

/* Läuft die Überfahrt gerade? Dann zeigt das Panel die Karte des ZIELLANDES
   statt der des zuletzt gemessenen — er ist unterwegs dorthin, und genau das
   ist in dieser Nacht die interessante Auskunft. */
function fuelAufSee(c){
  if(c.ferry && c.ferry.state === 'onboard') return true;
  if(c.ferry && c.ferry.state === 'done') return false;
  const dep = bookedDeparture();
  return !!(dep && c.now >= dep.ab && c.now < dep.an);
}

function renderFuel(c){
  const det = document.getElementById('fuelDetails');
  // Andenken-Zustand: er isst nicht mehr unterwegs — das Panel hätte sonst
  // dauerhaft weitergezeigt (fuelSichtbar() schaltet nach der Fähre nie
  // wieder ab, siehe dort).
  if(istAngekommen(c) || !fuelSichtbar(c)){ det.hidden = true; return; }
  det.hidden = false;

  /* Die Fähre hat ihn getragen, nicht er sich selbst — ihre km fließen nicht
     in "erfahren" ein. Abgezogen wird, was der Tracker selbst zwischen
     Ablegen und Landen an km gutgeschrieben hat (kmAt() über die echten
     GPS-Zeiten aus ferryCrossing(), nicht die Fahrplanzeiten — die Spur weiß
     es genauer als der Fahrplan). In der Praxis wenig: der Tracker zählte
     für die ganze Überfahrt nur ein paar km, vermutlich mangels Fixen auf
     offener See — aber genau die sollen hier draußen bleiben. */
  let kmErfahren = c.km;
  if(c.ferry && c.ferry.state === 'done'){
    const bT = new Date(c.ferry.boardTs).getTime()/1000, lT = new Date(c.ferry.landTs).getTime()/1000;
    const vor = kmAt(c.list, bT), nach = kmAt(c.list, lT);
    if(vor != null && nach != null) kmErfahren = Math.max(kmErfahren - Math.max(nach - vor, 0), 0);
  }

  const kcal = fuelKcal(kmErfahren, c.climbUp);
  const land = fuelLand(c);
  const idx = land ? FUEL.laender.indexOf(land) : -1;
  const aufSee = fuelAufSee(c);
  // Auf See zeigt die Karte das nächste Land, sonst das aktuelle.
  const ziel = aufSee && idx >= 0 ? FUEL.laender[idx+1] || null : null;
  const karte = ziel || land;

  /* Gezählt wird in der Währung des Landes, in dem die Kilometer entstanden
     sind — auf See also weiter in Zimtschnecken, nicht schon in Pączki. */
  const w = land || FUEL.laender[0];
  const stueck = Math.round(kcal / w.kcal);

  const schwarm = Array.from({length: Math.min(stueck, FUEL.swarmMax)}, (_, i)=>
    `<i style="--r:${(i*37 % 19) - 9}deg;--y:${(i*23 % 5) - 2}px">${w.em}</i>`).join('');

  /* Tagesleistung aus derselben Quelle wie der Einschätzungskasten weiter
     oben — effortBetween() über das Fenster seit Mitternacht, das eine
     dazwischen liegende Fähre wieder herausrechnet (siehe Kommentar dort). */
  let heute = '';
  if(PROFILE && PROFILE.chunks && PROFILE.chunks.length){
    const mitternacht = new Date(c.now.getFullYear(), c.now.getMonth(), c.now.getDate()).getTime()/1000;
    const eff = effortBetween(mitternacht, c.now.getTime()/1000);
    if(eff){
      const kmH = eff.km * c.kmScale;
      const hmH = eff.up;
      const kcalH = fuelKcal(kmH, hmH);
      if(kmH >= 5) heute = `<div class="fuelsub">Heute: <b>${num(Math.round(kcalH))} kcal</b>
        aus ${num(Math.round(kmH))} km und ↑ ${num(Math.round(hmH))} hm
        — ${num(Math.round(kcalH / w.kcal))} ${esc(w.pl)}.</div>`;
    }
  }

  /* Ausblick auf die Reststrecke. Die Höhenmeter dafür sind hochgerechnet und
     damit die einzige geschätzte Zahl im Panel — der bisherige Schnitt
     stammt aus Skandinavien, der Balkan ist deutlich bergiger. Also
     ausdrücklich als Untergrenze ausgewiesen, nicht als Prognose verkauft. */
  let rest = '';
  if(c.rest > 0 && c.climbKm > 0){
    const restRouted = c.kmScale > 0 ? c.rest / c.kmScale : c.rest;
    const restHm = restRouted * (c.climbUp / c.climbKm);
    const restKcal = fuelKcal(c.rest, restHm);
    const zielLand = FUEL.laender[FUEL.laender.length-1];
    rest = `Bis Kalamata liegen noch rund <b>${num(Math.round(restKcal/1000))}.000 kcal</b> vor ihm
      — etwa ${num(Math.round(restKcal / zielLand.kcal))} ${esc(zielLand.pl)}. Mit dem
      bisherigen Höhenschnitt gerechnet; über den Balkan wird es eher mehr.`;
  }
  /* Auf Hunderter gerundet, nicht auf Tausender: bei Tausendern ergaben die
     drei Zahlen im Satz für den Leser keine Summe mehr (40.594 + 11.000
     stand neben 51.000, weil 10.622 einmal auf- und einmal abgerundet wurde).
     Wer nachrechnet, soll aufgehen sehen, was dasteht. */
  const tage = Math.max(c.raceH / 24, 0);
  const basal = tage * FUEL.grundumsatzTag;
  const h100 = v => num(Math.round(v/100)*100);
  const grund = `Dazu kommt der Grundumsatz von rund ${h100(basal)} kcal
    in ${num(Math.round(tage*10)/10)} Tagen — zusammen also grob
    <b>${h100(kcal+basal)} kcal</b>, die er unterwegs essen muss.`;

  document.getElementById('fuelSum').innerHTML =
    `Verpflegung · <b>${num(Math.round(kcal))} kcal ≈ ${num(stueck)} ${esc(w.pl)}</b>`;

  const kopf = ziel
    ? `${ziel.flag} Nach der Überfahrt in <b>${esc(ziel.nm)}</b> auf der Speisekarte`
    : karte ? `${karte.flag} In <b>${esc(karte.nm)}</b> auf der Speisekarte` : '';

  const zeilen = karte ? karte.karte.map(([em, nm, was, kc])=>
    `<div class="fmrow"><span class="em">${em}</span><span>${esc(nm)}</span>
       <span class="dots"></span><span class="kc">${num(kc)} kcal</span>
       <span class="was">${esc(was)}</span></div>`).join('') : '';

  const notiz = karte && karte.notiz ? `<div class="fmnote">${karte.notiz}</div>` : '';

  /* Die noch kommenden Länder als Ausblick — ohne Kalorien, das ist hier
     Vorfreude und keine Information. Gezählt wird ab dem Land NACH dem der
     Speisekarte, nicht ab dem aktuellen: sonst stünde auf See Polen zweimal
     da, einmal als Karte und einmal als Häppchen. */
  const kIdx = karte ? FUEL.laender.indexOf(karte) : idx;
  const kommende = kIdx >= 0 ? FUEL.laender.slice(kIdx+1) : [];
  const chips = kommende.length ? `<div class="fuelnext">
      <div class="fmhead">Danach auf der Route</div>
      <div class="fnrow">${kommende.map(l=>
        `<span class="fnchip"><span class="fl">${l.flag}</span>${esc(l.nm)}
           · ${l.em} ${esc(l.snack)}</span>`).join('')}</div>
    </div>` : '';

  document.getElementById('fuelWrap').innerHTML = `
    <div class="fuelhero">
      <div class="fuelbig"><span class="fuelnum">${num(Math.round(kcal))}</span>
        <span class="fuelunit">kcal erfahren</span></div>
      <div class="fuelsub">Das sind rund <b>${num(stueck)} ${esc(w.pl)}</b>
        ${w.em} seit Trondheim.</div>
      <div class="fuelswarm">${schwarm}</div>
      ${heute}
      <div class="fuelrest">${rest}<br>${grund}</div>
    </div>
    ${(karte && !istZieltag(c)) ? `<div class="fuelmenu"><div class="fmhead">${kopf}</div>${zeilen}${notiz}</div>` : ''}
    ${chips}`;
}

/* Das Log wächst über drei Wochen auf hunderte Zeilen und schob Karte und
   Fußzeile immer weiter nach unten. Offen stehen deshalb nur die neuesten
   `LOG_HEAD` Meldungen, der Rest liegt hinter einem Klapper — dieselbe Haltung
   wie bei der Karte: tiefere Daten einen Klick entfernt, nicht auf der ersten
   Bildschirmseite.
   Bewusst KEIN <details>: das darf keine <tr> umschließen, und zwei getrennte
   Tabellen bekämen unterschiedliche Spaltenbreiten. Also ein zweites <tbody>
   in derselben Tabelle plus Knopf darunter. */
const LOG_HEAD = 3;
let LOG_ALL = false;   // überlebt das 60s-Re-Render, sonst klappt es dauernd zu

/* Pausen aus der Spur, gecacht — findStops() läuft sonst bei jedem der
   60s-Renderdurchläufe über alle Spurpunkte. Der Cache hängt an `updated`
   aus track.json, fällt also mit jeder neu geladenen Spur. */
let STOPS = null, STOPS_KEY = null;
function trackStops(){
  if(!TRACK) return [];
  if(STOPS_KEY !== TRACK.updated){ STOPS = findStops(TRACK.points); STOPS_KEY = TRACK.updated; }
  return STOPS;
}

/* Eine im Track gefundene Stehphase, deren Ende der LETZTE Spurpunkt ist, gilt
   als „läuft noch“ — aber nur, solange der frischere Live-Fix nicht
   widerspricht. Hinkt der GPX-Export hinterher (siehe „Der Export arbeitet in
   Stapeln“ in CLAUDE.md), endet die Spur mitten in einer alten Stehphase,
   während `data.live` längst Fahrt meldet: am 28.07.2026 stand die Spur ab
   21:51 Uhr in Ottmachau still, der Export lieferte die Nacht- und Frühfahrt
   erst gegen 07:15 nach — bis dahin behaupteten Positionslog UND Tagesstreifen
   eine laufende Pause, obwohl der Live-Fix seit 05:31 fuhr (18,8 km/h). Der
   gemeldete Rückstand war real und lag beim Anbieter (generate.php sendet
   `no-store`, wird also nicht bei uns gecacht; ein Cache-Buster verbietet sich,
   er löst 403 aus). Also nutzen wir wie in renderLive() das frischere Tempo als
   Korrektiv: ist der Live-Fix jünger als das Spurende und zeigt er Fahrt, ist
   die Pause vorbei — ihr Ende kennen wir nur noch nicht aus der Spur. Fehlt der
   Live-Fix oder ist er selbst alt, bleibt die Pause laufend (wir wissen es
   dann nicht besser). */
function liveWiderlegtStand(letzterPunkt){
  const lv = S.live;
  return !!(lv && lv.ts
    && new Date(lv.ts).getTime()/1000 > letzterPunkt
    && lv.speed != null && Number(lv.speed) > LIVE_STEHT_KMH);
}

/* Die tatsächliche Fährüberfahrt aus der Spur lesen. Gesucht ist der
   Nord→Süd-Übergang durch das Ostsee-Band (FERRY.seeband): der letzte Punkt
   auf der schwedischen Seite ist die Abfahrt, der erste danach auf der
   polnischen Seite die Ankunft, alles dazwischen (falls es überhaupt Punkte
   gibt) die Mittsee-Spur. Das trägt in beiden Wirklichkeiten: dünne Punkte
   über Wasser ODER eine reine Funkloch-Lücke, bei der der Tracker erst in
   Polen wieder meldet — dann sind board und land direkt benachbart und die
   gerade Linie dazwischen IST die Überfahrt.
   Kein kmScale, keine Punkt-zu-Strecke-Distanz: reiner Koordinatenvergleich
   im Band. Gecacht wie trackStops() über TRACK.updated. */
let FERRY_CACHE = null, FERRY_KEY = null;
let FERRY_OVERRIDE = null;   // Debug-Hook tcr84Faehre(), siehe unten
function ferryCrossing(){
  if(FERRY_OVERRIDE !== null) return FERRY_OVERRIDE || null;
  if(!TRACK) return null;
  if(FERRY_KEY === TRACK.updated) return FERRY_CACHE;
  FERRY_KEY = TRACK.updated;
  FERRY_CACHE = computeFerryCrossing(TRACK.points);
  return FERRY_CACHE;
}
function computeFerryCrossing(pts){
  const sb = FERRY.seeband;
  const nord = p => p[0] >= sb.latNord && p[1] >= sb.lonWest && p[1] <= sb.lonOst;
  const sued = p => p[0] <= sb.latSued && p[1] >= sb.lonWest && p[1] <= sb.lonOst;
  // Der letzte schwedische Punkt vor einem späteren polnischen: das ist die
  // Abfahrt. Rückwärts vom Fund des ersten Süd-Punkts, damit ein früher Abstecher
  // in den Längengrad-Streifen nicht als Board zählt.
  let iBoard = -1, iLand = -1;
  for(let i = 0; i < pts.length; i++){
    if(iBoard < 0){ if(nord(pts[i])) iBoard = i; continue; }
    if(nord(pts[i])) iBoard = i;            // schiebt bis zum letzten Nord-Punkt vor
    else if(sued(pts[i])){ iLand = i; break; }
  }
  if(iBoard < 0) return null;
  const boardPt = pts[iBoard];
  // Läuft die Spur nach dem Board weiter, ohne je die Südseite zu erreichen,
  // ist er entweder noch an Bord (Punkt im Band) oder gar nicht losgefahren.
  if(iLand < 0){
    const rest = pts.slice(iBoard + 1);
    const imBand = rest.filter(p => p[1] >= sb.lonWest && p[1] <= sb.lonOst
                                 && p[0] < sb.latNord && p[0] > sb.latSued);
    if(!imBand.length) return null;          // noch am Hafen, keine Überfahrt
    const letzter = imBand[imBand.length - 1];
    if(metersBetween(boardPt, letzter) < sb.mindKm * 1000 / 3) return null;
    return ferryInfo('onboard', boardPt, letzter, imBand);
  }
  const landPt = pts[iLand];
  if(metersBetween(boardPt, landPt) < sb.mindKm * 1000) return null;
  const mid = pts.slice(iBoard + 1, iLand);
  return ferryInfo('done', boardPt, landPt, mid);
}
function ferryInfo(state, boardPt, endPt, midPts){
  const boardTs = localIso(new Date(boardPt[3] * 1000));
  const landTs = state === 'done' ? localIso(new Date(endPt[3] * 1000)) : null;
  // Nächstgelegener Hafen zum Abfahrtspunkt.
  let hafen = null, hd = Infinity;
  FERRY.haefen.forEach(h => {
    if(!h.pos) return;
    const d = metersBetween(boardPt, h.pos);
    if(d < hd){ hd = d; hafen = h; }
  });
  // Die Abfahrt, deren Fahrplanzeit am nächsten an der echten Abfahrt liegt
  // (±3 h) — nur für den Linien-Namen, nicht für die Zeiten selbst.
  let dep = null;
  if(hafen){
    const bMs = new Date(boardTs).getTime();
    let dd = 3 * 3.6e6;
    hafen.ab.forEach(a => {
      const diff = Math.abs(new Date(`${a.d}T${a.t}`).getTime() - bMs);
      if(diff < dd){ dd = diff; dep = a; }
    });
  }
  return { state, boardTs, landTs, boardPt, landPt: state === 'done' ? endPt : null,
           midPts: midPts || [], hafen, dep };
}

function renderLog(c){
  const el = document.getElementById('log');
  if(!c.list.length){ el.innerHTML = '<div class="empty">Noch keine Positionen erfasst.</div>'; return; }
  const cols = EDIT ? 5 : 4;

  /* Das Log protokolliert Bewegung: unter `minKmDelta` (1 km) entsteht kein
     Eintrag. Steht der Fahrer, klafft darin eine Lücke — in der Nacht vom
     20. auf den 21.07.2026 achteinhalb Stunden zwischen zwei Zeilen, mit
     „1,8 km/h“ daneben und ohne jeden Hinweis, dass der Stillstand die
     eigentliche Information war. Kopfzeile und Karte wussten davon, das Log
     nicht. Dieselbe Quelle wie die Kartenmarker (findStops über die echte
     Spur), damit nicht zwei Stellen verschiedene Pausen behaupten.
     Was die Pause verursacht hat, steht hier nicht und ist aus der Spur auch
     nicht ableitbar — deshalb nur „Pause“, nie „Schlaf“. */
  const letzterPunkt = TRACK ? TRACK.points[TRACK.points.length-1][3] : null;
  /* Einsortiert nach der MITTE der Pause, nicht nach ihrem Beginn: sie
     überspannt oft eine Meldung (der Tracker meldet ja weiter, während er
     steht). Nach dem Beginn einsortiert landete die Nacht vom 20.07. unter
     der 19:05-Zeile — also gerade nicht in der Lücke, die sie erklärt. */
  const widerlegt = liveWiderlegtStand(letzterPunkt);
  const pausen = (vonMs, bisMs) => trackStops()
    .filter(s => { const mitte = (s.from + s.to)/2*1000; return mitte > vonMs && mitte <= bisMs; })
    .sort((a,b) => b.from - a.from)
    .map(s => {
      const laeuft = s.to === letzterPunkt && !widerlegt;
      return `<tr class="logPause"><td colspan="${cols}">⏸ Pause
        <span class="pv">${dhm(laeuft ? (Date.now()/1000 - s.from)/60 : s.mins)}</span> ·
        ${hhmm(s.from)}–${laeuft ? 'läuft noch' : hhmm(s.to)+' Uhr'}</td></tr>`;
    }).join('');

  const rows = [...c.list].reverse().map((e,i,arr)=>{
    const prev = arr[i+1];
    let d = '–';
    if(prev){
      const dh = (new Date(e.ts)-new Date(prev.ts))/3.6e6;
      d = dh>0 ? one((Number(e.km)-Number(prev.km))/dh)+' km/h' : '–';
    }
    const hasGps = e.lat!=null && e.lon!=null;
    const cl = prev ? climbBetween(prev.ts, e.ts) : null;
    const detailId = 'det'+e.id;
    const main = `<tr class="logRow${hasGps?' hasDetail':''}" ${hasGps?`data-target="${detailId}"`:''}>
      <td class="num">${fmt(e.ts)}</td>
      <td class="num">${num(Number(e.km))} km</td>
      <td class="num">${d}</td>
      <td>${esc(e.place||'')}${e.note? (e.place?' · ':'')+'<span style="color:var(--muted)">'+esc(e.note)+'</span>':''}${hasGps?' <span class="gpsMark">▾ GPS</span>':''}</td>
      ${EDIT?`<td style="text-align:right"><button class="del" data-id="${e.id}" aria-label="Meldung löschen">×</button></td>`:''}
    </tr>`;
    const detail = hasGps ? `<tr class="logDetail" id="${detailId}" style="display:none"><td colspan="${cols}">
        <div class="dk">
          <span>${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}</span>
          ${e.ele!=null?`<span>${num(Number(e.ele))} m ü. NN</span>`:''}
          ${cl?`<span>↑ ${num(cl.up)} / ↓ ${num(cl.down)} hm seit davor</span>`:''}
          ${e.speed!=null?`<span>${one(e.speed)} km/h bei Erfassung</span>`:''}
          <a href="https://www.google.com/maps?q=${e.lat},${e.lon}" target="_blank" rel="noopener">Google Maps ↗</a>
        </div>
      </td></tr>` : '';
    /* Absteigend sortiert: die Pausen zwischen dieser und der VORHERIGEN
       Meldung stehen unter dieser Zeile. Sie hängen bewusst am selben
       Array-Element wie der Eintrag — sonst risse der Klapper unten die
       Pause von ihrem Zeitraum weg. Über der neuesten Meldung steht, was
       seither passiert ist (typisch: die laufende Pause). */
    const davor = prev ? new Date(prev.ts).getTime() : 0;
    const oben = i === 0 ? pausen(new Date(e.ts).getTime(), Infinity) : '';
    return oben + main + detail + pausen(davor, new Date(e.ts).getTime());
  });
  const alt = rows.length - LOG_HEAD;
  el.innerHTML = `<table><thead><tr><th>Zeit</th><th>Stand</th><th>Schnitt seit davor</th><th>Ort / Notiz</th>${EDIT?'<th></th>':''}</tr></thead>` +
    `<tbody>${rows.slice(0, LOG_HEAD).join('')}</tbody>` +
    (alt > 0 ? `<tbody id="logOlder"${LOG_ALL?'':' hidden'}>${rows.slice(LOG_HEAD).join('')}</tbody>` : '') +
    `</table>` +
    (alt > 0 ? `<button class="logMore" id="logMore">${LOG_ALL
      ? '▴ Ältere ausblenden' : `▾ ${alt} ältere ${alt===1?'Meldung':'Meldungen'}`}</button>` : '');
  const more = document.getElementById('logMore');
  if(more) more.onclick = ()=>{ LOG_ALL = !LOG_ALL; renderLog(c); };
  el.querySelectorAll('tr.logRow.hasDetail').forEach(r=> r.onclick = (ev)=>{
    if(ev.target.closest('.del')) return;
    const d = document.getElementById(r.dataset.target);
    if(d) d.style.display = d.style.display==='none' ? 'table-row' : 'none';
  });
  el.querySelectorAll('.del').forEach(b=> b.onclick = async (ev)=>{
    ev.stopPropagation();
    S.entries = S.entries.filter(x=> x.id!==b.dataset.id);
    DIRTY = true; await store.set(JSON.stringify(S)); render();
  });
}

/* ---------- Wetter am aktuellen Standort ----------
   Läuft komplett unabhängig vom data.json-Poll (eigenes Intervall), ist aber an die
   Koordinaten der letzten GPS-Meldung gekoppelt. Quelle: Open-Meteo (kein Key, CORS-fähig). */
const WX_CODES = {
  0:['☀️','klar'],1:['🌤️','überw. klar'],2:['⛅','wolkig'],3:['☁️','bedeckt'],
  45:['🌫️','Nebel'],48:['🌫️','Nebel'],
  51:['🌦️','Niesel'],53:['🌦️','Niesel'],55:['🌦️','Niesel'],
  56:['🌧️','gefr. Niesel'],57:['🌧️','gefr. Niesel'],
  61:['🌧️','Regen'],63:['🌧️','Regen'],65:['🌧️','Starkregen'],
  66:['🌧️','gefr. Regen'],67:['🌧️','gefr. Regen'],
  71:['🌨️','Schnee'],73:['🌨️','Schnee'],75:['❄️','Starkschnee'],77:['❄️','Schneegriesel'],
  80:['🌦️','Schauer'],81:['🌦️','Schauer'],82:['⛈️','starke Schauer'],
  85:['🌨️','Schneeschauer'],86:['🌨️','Schneeschauer'],
  95:['⛈️','Gewitter'],96:['⛈️','Gewitter mit Hagel'],99:['⛈️','Gewitter mit Hagel']
};
// Codes, bei denen etwas vom Himmel kommt — trägt sowohl die Overlay-Stimmung
// als auch (zusammen mit `precipitation`) die Regen-Erkennung. Schnee zählt
// bewusst nicht mit: das Overlay kennt bisher nur Regenstreifen, kein Schnee-
// Bild, und ein Regenlook bei Schneefall wäre eine falsche Behauptung.
const WX_REGEN_CODES = new Set([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99]);
const windDir = deg => ['N','NO','O','SO','S','SW','W','NW'][Math.round(deg/45)%8];
let WX = null, wxLat = null, wxLon = null, wxKey = null;
async function loadWeather(lat, lon){
  try{
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,precipitation,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
      `&wind_speed_unit=kmh&timezone=auto`;
    const res = await fetch(url);
    if(!res.ok) return;
    WX = (await res.json()).current;
    renderWeather();
  }catch(e){ /* letzter bekannter Stand bleibt stehen, kein Fehler an die Nutzerin */ }
}
/* Regenbox: echte <i>-Tropfen statt Flächenmuster, siehe style.css. Wird nur
   angelegt, während `is-raining` aktiv ist, und respektiert reduced-motion
   selbst — keine Box ist ehrlicher als eine, die stillsteht. */
function syncRainOverlay(active){
  const bar = document.getElementById('nowbar');
  if(!bar) return;
  let box = bar.querySelector('.rainBox');
  if(!active || matchMedia('(prefers-reduced-motion:reduce)').matches){
    if(box) box.remove();
    return;
  }
  if(box) return;
  box = document.createElement('div');
  box.className = 'rainBox';
  let html = '';
  for(let i=0;i<26;i++){
    const left = (Math.random()*100).toFixed(1);
    const dur = (0.5+Math.random()*0.45).toFixed(2);
    const delay = (-Math.random()*dur).toFixed(2);
    const rot = (6+Math.random()*8).toFixed(1);
    const op = (0.35+Math.random()*0.45).toFixed(2);
    html += `<i style="left:${left}%;animation-duration:${dur}s;animation-delay:${delay}s;` +
      `transform:rotate(${rot}deg);opacity:${op}"></i>`;
  }
  box.innerHTML = html;
  bar.appendChild(box);
}
let WX_SCENE_OVERRIDE = null;   // Debug-Hook tcr84Wetter(), siehe unten
function renderWeather(){
  const el = document.getElementById('wxLine');
  if(!el || !WX){
    if(el){ el.style.display='none'; syncNowbar(); }
    document.body.classList.remove('is-raining','is-night','is-sunny');
    syncRainOverlay(false);
    return;
  }
  const code = WX_CODES[WX.weather_code] || ['','—'];
  // Böen fließen weiter in die Warnfarbe ein (bei ≥45 wird die Windangabe rot),
  // werden aber nicht mehr als Zahl angezeigt: „Böen 20“ war ohne Kontext nicht
  // zu deuten und blähte die Zeile auf. Weniger Text, gleiche Aussage.
  const gust = WX.wind_gusts_10m;
  const windy = WX.wind_speed_10m >= 30 || (gust!=null && gust >= 45);
  el.style.display = 'flex';
  el.innerHTML =
    `<span>${code[0]} ${code[1]}</span>` +
    `<span class="wxval">${one(WX.temperature_2m)}° <span style="color:var(--muted)">(gefühlt ${one(WX.apparent_temperature)}°)</span></span>` +
    `<span class="${windy?'wxwarn':'wxval'}">💨 ${num(WX.wind_speed_10m)} km/h aus ${windDir(WX.wind_direction_10m)}</span>` +
    (WX.precipitation>0 ? `<span class="wxval">🌧️ ${one(WX.precipitation)} mm/h</span>` : '');
  /* Dieselbe Wetterlage auch als Stimmung um die Jetzt-Zeile: Regen zieht als
     Streifen darüber, Nacht bringt Sterne und Mond, klarer Tag einen warmen
     Sonnenschimmer. `is_day` kommt direkt von Open-Meteo statt aus der
     lokalen Uhrzeit — das trifft Polarnacht/Mitternachtssonne auf der
     norwegischen Etappe richtig, eine reine Stunden-Heuristik hätte das nicht. */
  const auto = { night: WX.is_day === 0, raining: WX_REGEN_CODES.has(WX.weather_code) || WX.precipitation > 0 };
  auto.sunny = !auto.night && !auto.raining && (WX.weather_code === 0 || WX.weather_code === 1);
  const scene = WX_SCENE_OVERRIDE || auto;
  document.body.classList.toggle('is-raining', scene.raining);
  document.body.classList.toggle('is-night', scene.night);
  document.body.classList.toggle('is-sunny', scene.sunny);
  syncRainOverlay(scene.raining);
  syncNowbar();
}
function maybeLoadWeather(c){
  const withGps = [...c.list].reverse().find(e=> e.lat!=null && e.lon!=null);
  if(!withGps){ WX=null; wxKey=null; renderWeather(); return; }
  wxLat = withGps.lat; wxLon = withGps.lon;
  const key = wxLat.toFixed(3)+','+wxLon.toFixed(3);
  if(key !== wxKey){ wxKey = key; loadWeather(wxLat, wxLon); }
}
setInterval(()=>{ if(wxLat!=null) loadWeather(wxLat, wxLon); }, 900000);

/* ---------- Rückenwind schicken ----------

   Das einzige Element, mit dem Zuschauer etwas TUN können statt nur zu lesen.
   Der Knopf schickt eine Böe, ein Zähler sammelt sie. Es ist ausdrücklich
   Spaß und keine Statistik — aber der Zähler ist echt, und das ist die
   Bedingung dafür, dass er dastehen darf. Ein plausibel hochlaufender
   Fantasiezähler wäre die eine Sorte Zahl, die dieses Board nirgends zeigt.

   WARUM EINE FREMDE STELLE: Ein geteilter Zähler braucht einen Ort, an dem
   alle Besucher dieselbe Zahl sehen. GitHub Pages liefert nur aus und nimmt
   nichts entgegen, `data.json` ist allein über Git beschreibbar, und
   localStorage kennt jeder Besucher nur für sich. Also ein winziger
   Cloudflare Worker, dessen ganze Aufgabe „zähl hoch und gib heraus“ ist —
   Quelltext und Einrichtung in tools/wind-worker.js. Fehlt `api`, versteckt
   sich der Streifen ganz: lieber kein Knopf als einer, der ins Leere greift.

   DER ECHTE WIND STEHT DANEBEN, und das ist der eigentliche Witz. Das Board
   kennt die gemessene Windrichtung (Open-Meteo) und rechnet aus der Spur den
   tatsächlichen Fahrtkurs — es weiß also, ob ihm gerade wirklich etwas
   entgegenbläst. Der Knopf wird dadurch komisch statt beliebig: man pustet
   gegen etwas Bestimmtes. Nirgends darf daraus die Behauptung werden, die
   Klicks hätten den Wind gedreht; das Board freut sich mit, es rechnet nicht
   nach.

   Der Kurs kommt NICHT aus zwei benachbarten Spurpunkten — die liegen fünf
   Minuten auseinander, und bei einer Pause oder GPS-Rauschen zeigt ihre
   Verbindung in eine zufällige Richtung. Gesucht wird rückwärts der erste
   Punkt mit `kursMeter` Abstand; darunter ist keine Fahrtrichtung erkennbar,
   dann schweigt das Panel über die Windlage, statt eine zu erfinden. */
const WIND = {
  /* Worker-URL aus tools/wind-worker.js — ohne sie bleibt der Streifen
     verborgen. Sie ist öffentlich und darf das sein: der Worker kann nichts
     außer hochzählen, und er bremst Massenklicks selbst. */
  api: 'https://tcr84-wind.schaedlich-max.workers.dev',
  cooldownStd: 3,       // so lange, bis dieselbe Person wieder pusten darf
  kursMeter: 2000,      // Mindestabstand für einen belastbaren Fahrtkurs
  flauteKmh: 8,         // darunter ist die Windrichtung keine Aussage
  gegenGrad: 60,        // Abweichung Kurs↔Wind bis hierhin: Gegenwind
  rueckenGrad: 120,     // darüber: Rückenwind. Dazwischen: von der Seite
};
const WIND_KEY = 'tcr84:wind';
let WIND_N = { total: 0, heute: 0, da: false };
let WIND_SENDET = false;
let WIND_DEMO = false;   // Debug-Hook tcr84Wind(), siehe unten

/* Kurs von a nach b in Grad (0 = Nord). Standardformel für die Anfangspeilung
   auf der Kugel; über wenige Kilometer wäre auch die ebene Näherung genau
   genug, aber die hier ist nicht teurer. */
function bearingBetween(a, b){
  const rad = d => d*Math.PI/180;
  const φ1 = rad(a[0]), φ2 = rad(b[0]), Δλ = rad(b[1]-a[1]);
  const y = Math.sin(Δλ)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(y, x)*180/Math.PI + 360) % 360;
}

function fahrtKurs(){
  const p = TRACK && TRACK.points;
  if(!p || p.length < 2) return null;
  const ziel = p[p.length-1];
  for(let i = p.length-2; i >= 0; i--){
    if(metersBetween(p[i], ziel) >= WIND.kursMeter) return bearingBetween(p[i], ziel);
  }
  return null;   // steht oder Spur zu kurz — dann gibt es keine Fahrtrichtung
}

/* Windlage aus gemessenem Wind und gefahrenem Kurs.
   `wind_direction_10m` ist meteorologisch die Richtung, AUS der es weht;
   `kurs` die Richtung, IN die er fährt. Ein Nordwind (0°) bei Fahrt nach
   Süden (180°) ergibt die volle Differenz von 180° — also Rückenwind. */
let WX_OVERRIDE = null;   // Debug-Hook tcr84Wind(), siehe unten
function windLage(){
  const dir = WX_OVERRIDE ? WX_OVERRIDE.dir : (WX ? WX.wind_direction_10m : null);
  const kmh = WX_OVERRIDE ? WX_OVERRIDE.speed : (WX ? WX.wind_speed_10m : null);
  if(dir == null || kmh == null) return null;
  if(kmh < WIND.flauteKmh) return { art:'flaute', kmh };
  const kurs = fahrtKurs();
  if(kurs == null) return { art:'unbekannt', kmh };
  const diff = Math.abs(((dir - kurs + 540) % 360) - 180);
  const art = diff <= WIND.gegenGrad ? 'gegen'
            : diff >= WIND.rueckenGrad ? 'ruecken' : 'seite';
  return { art, kmh, kurs, diff };
}

const windRest = ()=>{
  try{
    const t = Number(localStorage.getItem(WIND_KEY)) || 0;
    return Math.max(t + WIND.cooldownStd*3.6e6 - Date.now(), 0);
  }catch(e){ return 0; }
};

async function windLaden(){
  if(WIND_DEMO || !WIND.api) return;
  try{
    const r = await fetch(WIND.api, { cache:'no-store' });
    if(!r.ok) return;
    const j = await r.json();
    WIND_N = { total: Number(j.total)||0, heute: Number(j.heute)||0, da: true };
    renderWind();
  }catch(e){ /* Zähler bleibt auf dem letzten Stand, der Knopf funktioniert weiter */ }
}

async function windSenden(){
  if(WIND_SENDET || windRest() > 0) return;
  WIND_SENDET = true;
  boeen();
  // Sofort hochzählen, ohne auf die Antwort zu warten: der Knopf soll sich
  // anfühlen, als käme die Böe augenblicklich an. Die echte Zahl aus der
  // Antwort überschreibt das gleich darauf.
  WIND_N.total++; WIND_N.heute++; WIND_N.da = true;
  try{ localStorage.setItem(WIND_KEY, String(Date.now())); }catch(e){}
  renderWind();
  if(WIND_DEMO || !WIND.api){ WIND_SENDET = false; return; }
  try{
    const r = await fetch(WIND.api, { method:'POST', cache:'no-store' });
    const j = await r.json().catch(()=> null);
    if(j && j.total != null) WIND_N = { total:Number(j.total), heute:Number(j.heute)||0, da:true };
  }catch(e){ /* die Böe zählt lokal trotzdem — beim nächsten Laden gleicht es sich ab */ }
  WIND_SENDET = false;
  renderWind();
}

/* Ein paar Böen über den Streifen wehen lassen. Die Elemente räumen sich nach
   der Animation selbst weg; ohne das sammeln sich über eine lange Sitzung
   hunderte tote <i> im DOM an. */
function boeen(){
  const box = document.getElementById('windGust');
  if(!box) return;
  for(let i = 0; i < 7; i++){
    const el = document.createElement('i');
    el.textContent = i % 3 === 0 ? '🍃' : '💨';
    el.style.top = `${8 + (i*37) % 62}%`;
    el.style.animationDelay = `${i*70}ms`;
    el.style.setProperty('--dy', `${((i*53) % 19) - 9}px`);
    box.appendChild(el);
    setTimeout(()=> el.remove(), 1800 + i*70);
  }
}

function renderWind(){
  const bar = document.getElementById('windBar');
  if(!bar) return;
  if(!WIND.api && !WIND_DEMO){ bar.hidden = true; return; }
  bar.hidden = false;

  const btn = document.getElementById('windBtn');
  /* Andenken-Zustand: er braucht keinen Rückenwind mehr, aber die Pille am
     Kopf soll nicht einfach verschwinden — sie wird zum Zugang auf die
     Finisher-Karte (siehe der geteilte Klick-Handler auf #windBtn unten) und
     der Endstand des Zählers bleibt als Dank stehen, statt weiter hochzuzählen. */
  if(istAngekommen(compute())){
    btn.disabled = false;
    btn.querySelector('.wbem').textContent = '🏁';
    btn.querySelector('.wbtxt').textContent = 'Finisher-Karte';
    document.getElementById('windTxt').innerHTML = (WIND_N.da && WIND_N.total > 0)
      ? `<span class="zahl">${num(WIND_N.total)}</span> × Rückenwind geschickt — danke fürs Mitfahren.`
      : 'Danke fürs Mitfahren.';
    return;
  }
  const rest = windRest();
  btn.disabled = rest > 0;
  /* Vorher stand im gesperrten Zustand nur „wieder in 2 h 38 min“ — ein
     Satzfragment ohne Verb, das direkt neben dem Satz zur echten Windlage
     stand („Gerade bläst es ihm mit 20 km/h ins Gesicht“). Auf dem schmalen
     Handy-Layout rutschen Knopf und Satz optisch zusammen, und „wieder in
     2 h 38 min“ liest sich dann wie eine Fortsetzung der Wettervorhersage,
     nicht wie ein Button-Zustand. Der Knopf bekommt jetzt einen fest
     stehenden, in sich verständlichen Text; die Zeitangabe wandert in den
     Fließtext darunter, wo ein ganzer Satz sie eindeutig macht. */
  btn.querySelector('.wbem').textContent = rest > 0 ? '✅' : '🌬️';
  btn.querySelector('.wbtxt').textContent = rest > 0 ? 'Schon gepustet' : 'Rückenwind schicken';

  const lage = windLage();
  /* Der Satz zur Wetterlage kommt zuerst — er sagt, wogegen gepustet wird.
     „Unbekannt“ heißt: er steht gerade oder die Spur ist zu kurz für einen
     Kurs; dann bleibt es bei der nackten Windstärke. */
  let satz = '';
  if(lage){
    const kmh = num(Math.round(lage.kmh));
    if(lage.art === 'gegen')       satz = `Gerade bläst es ihm mit <b>${kmh} km/h</b> ins Gesicht.`;
    else if(lage.art === 'ruecken')satz = `Läuft: <b>${kmh} km/h</b> von hinten. Irgendwas macht ihr richtig.`;
    else if(lage.art === 'seite')  satz = `Wind von der Seite, <b>${kmh} km/h</b> — halb so wild.`;
    else if(lage.art === 'flaute') satz = `Windstill da draußen. Genießt er bestimmt.`;
    else                           satz = `Wind mit <b>${kmh} km/h</b>.`;
  }

  const t = WIND_N.total;
  /* „X Böen geschickt“ sagt nicht, WOFÜR — direkt unter dem Satz zur echten
     Windlage („bläst ihm mit 24 km/h ins Gesicht“) liest sich das wie eine
     Bestätigung derselben Böe, nicht wie ihr Gegenmittel. „Rückenwind“ muss
     im Zähler selbst stehen, nicht nur am Knopf darüber, den man nach dem
     ersten Klick nicht mehr liest. */
  const zaehler = !WIND_N.da && !WIND_DEMO ? ''
    : t === 0 ? 'Noch kein Rückenwind geschickt — sei der Erste.'
    : `<span class="zahl">${num(t)}</span> × Rückenwind für ihn geschickt` +
      (WIND_N.heute > 0 ? ` · ${num(WIND_N.heute)} heute` : '');
  // Ein ganzer Satz statt eines Fragments am Knopf — und ausdrücklich „für
  // dich“, damit klar bleibt, dass die Sperre persönlich ist (dein Gerät hat
  // vor Kurzem gepustet), nicht ein globales Limit für alle Besucher.
  const sperre = rest > 0 ? `Du kannst in ${dhm(rest/6e4)} wieder pusten.` : '';

  document.getElementById('windTxt').innerHTML =
    [satz, zaehler, sperre].filter(Boolean).join('<br>');
}

document.addEventListener('click', e=>{
  if(!(e.target.closest && e.target.closest('#windBtn'))) return;
  // Nach der Ankunft öffnet dieselbe Pille die Finisher-Karte statt eine Böe
  // zu schicken — der Knopf bleibt derselbe, sein Zweck wechselt einmalig.
  if(istAngekommen(compute())) openFinaleCard(compute());
  else windSenden();
});
// Der Knopf zählt seine Sperre in Minuten herunter; ohne eigenen Takt stünde
// bis zum nächsten render() eine veraltete Restzeit da.
setInterval(renderWind, 30000);
setInterval(windLaden, 120000);

/* ---------- Zurufe (Grußwand) ----------
   Das Geschwister des Rückenwind-Knopfs, und deshalb steht es hier daneben:
   beide sind Dinge, die ein Besucher TUN kann, und beide haben dieselbe
   Bauform „externer Worker oder gar nicht da“. Der Unterschied ist, was
   ankommt — der Wind ist eine Zahl, ein Satz mit Namen ist ein Mensch.

   Jeder Zuruf verfällt nach 36 Stunden. Das ist der Zweck, nicht der Preis:
   Manuel liest im Rennen Frisches, kein Gästebuch, und was schiefgeht, räumt
   sich selbst weg. Die Wand ist absichtlich kein Archiv.

   WARUM EIN SCHLÜSSEL JE ZURUF: siehe den Kopf von tools/zuruf-worker.js. Die
   Kurzfassung: KV kennt kein atomares „lies, ändere, schreib“. Beim
   Rückenwind kostet das eine Böe, die niemand vermisst; bei einer Liste unter
   einem Schlüssel kostete es den ganzen Zuruf eines Fremden, still, während
   beide Absender ein „Geschickt!“ gesehen haben. Nie zu einer Liste umbauen.

   ESC() IST HIER DIE SCHÄRFSTE KANTE IM BOARD. Alles andere, was durch esc()
   geht, kommt von Nominatim oder aus einem Teil-Link; das hier hat ein Fremder
   getippt, mit voller Absicht und in ein Feld, das dafür da ist.
   `tcr84Zurufe('boese')` prüft das nach jeder Änderung in einer Zeile.

   PREFERS-REDUCED-MOTION, die eine neue Entscheidung: alle anderen Stellen im
   Board schalten dabei Schmuck ab — Konfetti, Böen, das wippende Rad, den
   Regen. Eine Rotation ist kein Schmuck, sie trägt Inhalt; sie einfach
   anzuhalten hieße, siebzehn Zurufe auf einen zu reduzieren. Also wird nicht
   die Bewegung abgeschaltet, sondern die Darstellung getauscht: kein Kasten,
   keine Punkte, kein Timer, die Liste steht direkt da. Als Regel für später —
   trägt eine Animation Inhalt, ist ihr reduced-motion-Ersatz ein anderes
   Layout, kein Standbild. */
const ZURUF = {
  /* Worker-URL aus tools/zuruf-worker.js — ohne sie bleibt das Panel samt
     Überschrift verborgen. Dieselbe Haltung wie beim Rückenwind: lieber keine
     Wand als eine, an die man nichts hängen kann. */
  api: 'https://tcr84-zurufe.schaedlich-max.workers.dev',
  maxText: 180,       // muss zu MAX_TEXT im Worker passen
  maxName: 20,        // dito MAX_NAME
  ladenSek: 120,      // Abgleich mit dem Worker
  frischMin: 30,      // so lange trägt ein Zuruf die „neu“-Marke
  nachhallSek: 90,    // so lange halten wir eigene Zurufe, die list() noch nicht kennt
  cooldownStd: 6,     // so lange, bis dieselbe Person wieder schreiben darf
};
/* Das Löschrecht. Bewusst ein eigener Hash-Parameter und NICHT an `#edit`
   gehängt: `#edit` ist ein lokaler Modus (data.json gegen localStorage, ein
   Formular, das nirgendwo hinschreibt) und obendrein ratbar und dokumentiert —
   jeder kann ihn einschalten. Löschen ist eine entfernte, endgültige Handlung
   an der Nachricht eines Fremden. Ein Flag, das beides bedeutet, wäre eine
   Falle. Beide zusammen gehen trotzdem: `#zuruf=abc&edit`. */
const ZURUF_TOKEN = hashParam('zuruf');
/* Zwei Bremsen, zwei Ebenen: der Worker lässt maximal 5 POSTs je IP-Hash und
   Stunde durch (tools/zuruf-worker.js) — das ist die harte Grenze gegen eine
   Schleife im Terminal. Diese hier ist die Spielregel fürs Board, genau wie
   WIND_KEY beim Rückenwind: nach dem Absenden sperrt der Knopf sich selbst
   sichtbar für sechs Stunden, damit gar nicht erst der Eindruck entsteht, man
   könnte im Minutentakt schreiben. localStorage, also umgehbar (privates
   Fenster, anderes Gerät) — das ist in Ordnung, die scharfe Grenze zieht der
   Worker. */
const ZURUF_SPERRE_KEY = 'tcr84:zurufSperre';
const zurufSperreRest = () => {
  try{
    const t = Number(localStorage.getItem(ZURUF_SPERRE_KEY)) || 0;
    return Math.max(t + ZURUF.cooldownStd*3.6e6 - Date.now(), 0);
  }catch(e){ return 0; }
};
let ZURUF_N = { list: [], da: false };
/* Modulvariablen, alle aus demselben Grund: render() läuft im 60-Sekunden-Takt
   und baut das Panel jedes Mal neu. Läge der Zustand lokal, schnappte die
   Rotation jede Minute auf Null zurück und das Formular fiele beim Tippen zu.
   Gleiches Muster wie LOG_ALL, FER_SCEN und PUFFER_IDX — dort steht die
   Begründung ausführlich. */
let ZURUF_IDX = 0;
let ZURUF_HAND = false;    // selbst geblättert? dann bleibt der Automat aus
let ZURUF_OFFEN = false;   // Formular offen
let ZURUF_SENDET = false;
let ZURUF_DEMO = false;    // Debug-Hook tcr84Zurufe(), siehe unten
let ZURUF_ZEIG_DEL = false;// dito
let ZURUF_TIMER = null;
const zurufRuhe = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
const zurufDarfLoeschen = () => Boolean(ZURUF_TOKEN) || ZURUF_ZEIG_DEL;
const zurufIdx = () => {
  const n = ZURUF_N.list.length;
  return n ? ((ZURUF_IDX % n) + n) % n : 0;
};

async function zurufeLaden(){
  if(ZURUF_DEMO || !ZURUF.api) return;
  try{
    const r = await fetch(ZURUF.api, { cache:'no-store' });
    if(!r.ok) return;
    const j = await r.json();
    zurufeUebernehmen(Array.isArray(j.zurufe) ? j.zurufe : []);
    renderZurufe();
  }catch(e){ /* die Wand bleibt auf dem letzten Stand, der Knopf funktioniert weiter */ }
}

function zurufeUebernehmen(vomServer){
  /* Eigene, gerade geschriebene Zurufe behalten, die der Server noch nicht
     listet: KVs list() ist eventual consistent und hinkt bis zu einer Minute
     nach. Ohne das verschwände der eigene Zuruf für eine Minute wieder und
     käme dann von selbst zurück — was aussieht, als wäre er verlorengegangen.
     Älter als nachhallSek und immer noch nicht gelistet heißt dagegen wirklich
     weg (gelöscht oder abgelaufen), dann fällt er raus. */
  const kennt = new Set(vomServer.map(z=> z.k));
  const eigene = ZURUF_N.list.filter(z=>
    z.mein && !kennt.has(z.k) && Date.now() - z.ts < ZURUF.nachhallSek*1000);

  /* Auf denselben ZURUF zeigen, nicht auf denselben Index. Kommt ein fremder
     Zuruf oben dazu, rutscht der gerade gelesene sonst eine Stelle weiter und
     die Rotation springt bei jedem Abgleich unmerklich vor. Und wer bei
     Nummer sieben liest, wird nicht auf Null zurückgerissen, nur weil jemand
     etwas geschrieben hat — der neue kommt beim nächsten Umlauf und trägt bis
     dahin die „neu“-Marke. */
  const stand = ZURUF_N.list[zurufIdx()];
  ZURUF_N = { list: [...eigene, ...vomServer], da: true };
  if(stand){
    const i = ZURUF_N.list.findIndex(z=> z.k === stand.k);
    if(i >= 0) ZURUF_IDX = i;
  }
}

/* Bewusst NICHT optimistisch, anders als windSenden() ein paar Zeilen weiter
   oben. Die Böe darf sofort hochzählen, weil ein Klick sich augenblicklich
   anfühlen soll und eine verlorene Böe unsichtbar bleibt. Ein Zuruf wird
   wieder gelesen — ihn zu zeigen, bevor der Server ihn angenommen hat, hieße
   riskieren, jemandem etwas anzuzeigen, das nie gespeichert wurde. Und wenn
   der Text bei einem Fehler im Feld stehen bleibt, ist die eine Sekunde
   Wartezeit nichts gegen die dreißig Sekunden Tippen davor. */
async function zurufSenden(){
  if(ZURUF_SENDET) return;
  const feldT = document.getElementById('zurufText');
  const feldN = document.getElementById('zurufName');
  const msg = document.getElementById('zurufMsg');
  const t = (feldT.value || '').trim().slice(0, ZURUF.maxText);
  const n = (feldN.value || '').trim().slice(0, ZURUF.maxName);
  if(!t){ msg.className = 'msg err'; msg.textContent = 'Da steht noch nichts.'; feldT.focus(); return; }

  ZURUF_SENDET = true;
  const knopf = document.getElementById('zurufSenden');
  knopf.disabled = true; knopf.textContent = 'wird geschickt…';
  msg.className = 'msg'; msg.textContent = '';

  if(ZURUF_DEMO || !ZURUF.api){
    ZURUF_N.list.unshift({ k:'k:'+Date.now()+'-demo00', t, n, ts:Date.now(), mein:true });
    ZURUF_IDX = 0; zurufFertig(true, 'Angekommen. Danke!'); return;
  }
  try{
    const r = await fetch(ZURUF.api, {
      method:'POST', cache:'no-store',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ t, n }),
    });
    const j = await r.json().catch(()=> null);
    if(r.ok && j && j.zuruf){
      // Die einzige Stelle, an der die Rotation springen darf: das ist die
      // Bestätigung, die eine Erfolgsmeldung sonst nur behaupten würde.
      ZURUF_N.list.unshift({ ...j.zuruf, mein:true });
      ZURUF_N.da = true; ZURUF_IDX = 0;
      zurufFertig(true, 'Angekommen. Danke!');
    }else if(r.status === 429){
      zurufFertig(false, (j && j.error) || 'Gerade schon mehrere von hier — bitte später nochmal.');
    }else{
      zurufFertig(false, (j && j.error) || 'Hat nicht geklappt. Nochmal versuchen?');
    }
  }catch(e){
    zurufFertig(false, 'Keine Verbindung. Der Text bleibt stehen — nochmal versuchen?');
  }
}

function zurufFertig(ok, satz){
  ZURUF_SENDET = false;
  const knopf = document.getElementById('zurufSenden');
  knopf.disabled = false; knopf.textContent = 'Abschicken';
  const msg = document.getElementById('zurufMsg');
  msg.className = ok ? 'msg' : 'msg err';
  msg.textContent = satz;
  if(ok){
    try{ localStorage.setItem(ZURUF_SPERRE_KEY, String(Date.now())); }catch(e){}
    document.getElementById('zurufText').value = '';
    document.getElementById('zurufName').value = '';
    zurufFormular(false);
    setTimeout(()=>{ const m = document.getElementById('zurufMsg'); if(m) m.textContent = ''; }, 4000);
  }
  renderZurufe();
}

async function zurufLoeschen(k){
  if(!zurufDarfLoeschen()) return;
  if(!confirm('Diesen Zuruf löschen? Das ist endgültig.')) return;
  ZURUF_N.list = ZURUF_N.list.filter(z=> z.k !== k);
  if(ZURUF_IDX >= ZURUF_N.list.length) ZURUF_IDX = 0;
  renderZurufe();
  if(ZURUF_DEMO || !ZURUF.api || !ZURUF_TOKEN) return;
  try{
    await fetch(ZURUF.api, {
      method:'DELETE', cache:'no-store',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ k, token: ZURUF_TOKEN }),
    });
  }catch(e){ /* lokal ist er weg; der nächste Abgleich holt ihn zurück, falls es nicht durchkam */ }
}

/* Eine Karte. Der Kommentar, der hier am meisten trägt: z.t und z.n hat ein
   Fremder getippt. esc() (ganz oben) ersetzt < > & und ", ABER KEIN
   Apostroph — deshalb steht jeder Attributwert hier in doppelten
   Anführungszeichen. z.k kommt vom Worker und ist harmlos, geht trotzdem
   durch esc(): „der Worker erzeugt das“ ist ein Versprechen aus einer anderen
   Datei, und Versprechen sind kein Escaping. */
function zurufKarte(z){
  const alterMin = (Date.now() - z.ts) / 6e4;
  const frisch = alterMin < ZURUF.frischMin;
  return `<blockquote class="zurufcard">
    <p class="zuruftxt">${esc(z.t)}</p>
    <footer class="zurufwer">${z.n ? '— <b>'+esc(z.n)+'</b>' : '— <span class="zurufanon">anonym</span>'}
      <span class="zurufzeit">· vor ${dhm(alterMin)}</span>${frisch ? ' <span class="zurufneu">· neu</span>' : ''}</footer>
    ${zurufDarfLoeschen() ? `<button class="zurufdel" type="button" data-k="${esc(z.k)}" aria-label="Diesen Zuruf löschen">×</button>` : ''}
  </blockquote>`;
}

/* Der gesperrte Knopf braucht einen eigenständigen Satz, keinen Fragment-Text
   — dieselbe Lektion wie beim Rückenwind (siehe dort, 25.07.2026): eine nackte
   Zeitangabe direkt am Knopf liest sich wie eine Fortsetzung von irgendwas
   danebenstehendem, kein Button-Zustand. Deshalb ein eigenes Element mit einem
   vollständigen, personalisierten Satz statt einer Zahl im Knopftext.
   Eigene Funktion statt Teil von renderZurufe(): die Sperre zählt in Stunden
   herunter und braucht ihren eigenen, langsameren Takt (siehe der Aufruf bei
   setInterval weiter unten) — ihn an die volle Rotation/Formular-Neuzeichnung
   zu hängen wäre unnötig teuer. */
function zurufSperreAnzeige(){
  const btn = document.getElementById('zurufOeffnen');
  const info = document.getElementById('zurufSperre');
  if(!btn || !info) return;
  const rest = zurufSperreRest();
  btn.disabled = rest > 0;
  if(!ZURUF_OFFEN) btn.textContent = rest > 0 ? '✅ Schon geschrieben' : 'Etwas dazuschreiben';
  info.hidden = rest <= 0;
  info.textContent = rest > 0 ? `Du kannst in ${dhm(rest/6e4)} wieder schreiben.` : '';
}

function renderZurufe(){
  const wrap = document.getElementById('zurufWrap');
  if(!wrap) return;
  if(!ZURUF.api && !ZURUF_DEMO){ wrap.hidden = true; return; }
  wrap.hidden = false;
  zurufSperreAnzeige();

  const box = document.getElementById('zurufBox');
  const nav = document.getElementById('zurufNav');
  const n = ZURUF_N.list.length;
  const ruhe = zurufRuhe();
  // Andenken-Zustand: die Wand bleibt das Herzstück, nur ihre Einladung
  // wechselt von „schick ihm was mit" zu „sag ihm Danke". compute() hier ist
  // dieselbe kleine Zusatzkosten wie bei renderWind — die Wand hat sonst
  // keinen Bezug zum Rennstand (siehe render()) und bekommt ihn nur dafür.
  const angekommen = istAngekommen(compute());
  const oeffnenBtn = document.getElementById('zurufOeffnen');
  if(oeffnenBtn && !ZURUF_OFFEN) oeffnenBtn.textContent = angekommen ? 'Sag ihm Danke' : 'Etwas dazuschreiben';

  /* Ein Kasten ohne Text sieht aus wie ein Ladefehler — der leere Zustand ist
     deshalb immer ein Satz, in derselben Stimme wie beim Rückenwind
     („Noch kein Rückenwind geschickt — sei der Erste.“). */
  if(!n){
    box.hidden = false;
    box.innerHTML = ZURUF_N.da || ZURUF_DEMO
      ? (angekommen
          ? '<div class="empty">Er ist angekommen. Sag ihm Danke — der erste Zuruf ist deiner.</div>'
          : '<div class="empty">Noch nichts an der Wand. Der erste Zuruf ist deiner.</div>')
      : '<div class="empty">Zurufe werden geladen…</div>';
    nav.innerHTML = '';
    document.getElementById('zurufMeta').textContent = '';
    zurufTakt();
    return;
  }

  /* Bei reduced motion tritt eine ruhige, vollständige Liste an die Stelle des
     einzelnen rotierenden Kastens — nicht der Kasten selbst gefriert auf einem
     Zuruf (siehe der Kopfkommentar oben zu prefers-reduced-motion). Keine
     zweite Liste daneben: die Pfeile decken das Durchsehen der übrigen Zurufe
     bereits ab, ein zusätzlicher Ausklapp-Block darunter zeigte nur, was der
     Kasten (bzw. bei Ruhe die Liste) ohnehin schon zeigt oder einen Klick
     entfernt ist. */
  box.hidden = false;
  box.innerHTML = ruhe
    ? `<div class="zurufliste">${ZURUF_N.list.map(zurufKarte).join('')}</div>`
    : zurufKarte(ZURUF_N.list[zurufIdx()]);

  /* Pfeile und Punktreihe sind dieselben wie an der Puffer-Kachel (.pnav /
     .pdots) — das ist schon das Karussell-Idiom dieses Boards. Auf Touch gibt
     es kein Hover und damit keine Pause, die Pfeile sind dort also nicht
     Zierde, sondern der einzige Weg, einen Zuruf sofort und ohne Warten
     anzusehen — das deckt auch das Durchsehen aller Zurufe ab, eine
     zusätzliche Liste darunter wäre reine Dopplung. */
  nav.innerHTML = (ruhe || n < 2) ? '' :
    `<button type="button" data-zdir="-1" aria-label="Vorheriger Zuruf">‹</button>
     <div class="pdots">${ZURUF_N.list.slice(0, 12).map((_,i)=>
       `<i class="${i === zurufIdx() ? 'on' : ''}"></i>`).join('')}</div>
     <button type="button" data-zdir="1" aria-label="Nächster Zuruf">›</button>`;

  /* Kein „3 neu seit deinem letzten Besuch“: das bräuchte Zustand je Besucher
     im localStorage und beantwortet eine Frage, die niemand gestellt hat — wer
     auf ein Board schaut, verfolgt keinen Feed. Frische trägt stattdessen die
     Marke an der Karte. */
  const frischN = ZURUF_N.list.filter(z=> Date.now() - z.ts < 3.6e6).length;
  document.getElementById('zurufMeta').innerHTML =
    [`${num(n)} ${n === 1 ? 'Zuruf' : 'Zurufe'}`,
     frischN ? `${num(frischN)} aus der letzten Stunde` : '',
     zurufDarfLoeschen() ? 'Löschmodus' : ''].filter(Boolean).join(' · ');

  zurufTakt();
}

/* Kette statt setInterval, weil die Verweildauer am Inhalt hängt. Ein fester
   Takt kann nur eins von beidem: lang genug für 180 Zeichen (dann klebt ein
   Fünfwort-Zuruf zwölf Sekunden auf dem Schirm) oder angenehm für kurze (dann
   wird der längste abgeschnitten). Das Panel existiert dafür, dass die Sätze
   GELESEN werden — 180 Zeichen bekommen 11,1 s, 40 Zeichen 4,8 s.
   Immer erst clearTimeout: sonst stapeln der 60-Sekunden-render() und ein
   Klick auf den Pfeil drei laufende Ketten übereinander und der Kasten
   flackert. ZURUF_HAND wird nie von selbst zurückgesetzt — wer steuert, dem
   nimmt die Maschine das Steuer nicht wieder weg. */
function zurufTakt(){
  clearTimeout(ZURUF_TIMER); ZURUF_TIMER = null;
  if(zurufRuhe() || ZURUF_HAND || ZURUF_OFFEN || document.hidden) return;
  if(ZURUF_N.list.length < 2) return;
  const len = ZURUF_N.list[zurufIdx()].t.length;
  ZURUF_TIMER = setTimeout(()=>{ ZURUF_IDX = zurufIdx() + 1; renderZurufe(); },
                           Math.min(12000, Math.max(4500, 3000 + len*45)));
}

function zurufFormular(auf){
  ZURUF_OFFEN = auf;
  const form = document.getElementById('zurufForm');
  form.hidden = !auf;
  document.getElementById('zurufOeffnen').textContent = auf ? 'Doch nicht' : 'Etwas dazuschreiben';
  if(auf){ zurufRest(); document.getElementById('zurufText').focus(); }
  zurufTakt();
}

function zurufRest(){
  const feld = document.getElementById('zurufText');
  const el = document.getElementById('zurufRest');
  if(!feld || !el) return;
  const rest = ZURUF.maxText - feld.value.length;
  el.textContent = `noch ${rest} Zeichen`;
  el.className = 'zurufrest' + (rest <= 20 ? ' knapp' : '');
}

/* Delegiert wie beim Rückenwind, damit die Bindungen die innerHTML-Neubauten
   überleben. Das Formular ist statisches Markup und wird von renderZurufe()
   nie angefasst — ein per innerHTML gebautes Formular löschte im
   60-Sekunden-Takt einen halb getippten Satz. Was der Besucher tippt, lebt
   außerhalb des Renderpfads. */
document.addEventListener('click', e=>{
  const t = e.target;
  if(!t.closest) return;
  if(t.closest('#zurufOeffnen')){ if(zurufSperreRest() <= 0) zurufFormular(!ZURUF_OFFEN); return; }
  if(t.closest('#zurufAbbruch')){ zurufFormular(false); return; }
  if(t.closest('#zurufSenden')){ zurufSenden(); return; }
  const del = t.closest('.zurufdel');
  if(del){ zurufLoeschen(del.dataset.k); return; }
  const pfeil = t.closest('#zurufNav button');
  if(pfeil){
    ZURUF_HAND = true;
    ZURUF_IDX = zurufIdx() + Number(pfeil.dataset.zdir);
    renderZurufe();
  }
});
document.addEventListener('input', e=>{ if(e.target.id === 'zurufText') zurufRest(); });
/* Anhalten, solange jemand liest oder tippt. Der versteckte Tab ist der
   wichtigste der drei: ohne ihn läuft die Kette im Hintergrund weiter und der
   Kasten steht beim Zurückkommen irgendwo mitten im Umlauf. */
document.addEventListener('visibilitychange', zurufTakt);
document.addEventListener('mouseover', e=>{ if(e.target.closest && e.target.closest('#zurufBox')) { clearTimeout(ZURUF_TIMER); ZURUF_TIMER = null; } });
document.addEventListener('mouseout', e=>{ if(e.target.closest && e.target.closest('#zurufBox')) zurufTakt(); });
document.addEventListener('focusin', e=>{ if(e.target.closest && e.target.closest('#zurufWrap')) { clearTimeout(ZURUF_TIMER); ZURUF_TIMER = null; } });
document.addEventListener('focusout', e=>{ if(e.target.closest && e.target.closest('#zurufWrap')) zurufTakt(); });
setInterval(zurufeLaden, ZURUF.ladenSek * 1000);
// Die Sperre zählt ihre Restzeit herunter; ohne eigenen Takt stünde bis zum
// nächsten render() (60s) eine veraltete Angabe da — dieselbe Begründung wie
// beim Rückenwind-Knopf.
setInterval(zurufSperreAnzeige, 30000);

/* ---------- Karte (Leaflet, wird erst beim Öffnen nachgeladen) ---------- */
let mapObj = null, mapLayer = null, mapFitted = false;

/* Punktgrößen hängen am Zoom, und zwar aus einem inhaltlichen Grund: über ganz
   Skandinavien liegen 40 Meldungen ein paar Bildschirmpixel auseinander. Feste
   Radien verschmelzen dort zu einer grauen Kette, die ausgerechnet die Spur
   verdeckt, auf die sie zeigen soll — und einzeln anklickbar sind sie in dieser
   Stufe ohnehin nicht. Weit draußen also klein bis unauffällig, beim
   Hereinzoomen wachsen sie in ihre Rolle hinein. Die aktuelle Position bleibt
   in jeder Stufe der größte Punkt, sie ist der Zweck der Karte. */
const DOT_SIZE = { pos:[6,9], stop:[3.5,7], entry:[1.5,4] };   // [Zoom ≤5, Zoom ≥11]
const dotRadius = ([klein, gross], z) =>
  klein + (gross - klein) * Math.max(0, Math.min(1, (z - 5) / 6));
let mapDots = [];   // [marker, art] — bei jedem renderMap neu gefüllt
function applyDotSizes(){
  if(!mapObj || !mapObj._loaded) return;
  const z = mapObj.getZoom();
  mapDots.forEach(([m, art])=> m.setRadius(dotRadius(DOT_SIZE[art], z)));
}
function ensureLeaflet(cb){
  if(window.L){ cb(); return; }
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(css);
  const js = document.createElement('script');
  js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  js.onload = cb;
  document.head.appendChild(js);
}
/* Die aufgezeichnete Spur wird erst beim Öffnen der Karte geholt — sie ist die
   größte Datei im Repo und für den Rest des Boards nicht nötig. Gleiche Logik
   wie beim Nachladen von Leaflet selbst. */
let TRACK = null;
/* Holt die Spur neu und wirft die davon abgeleiteten Caches weg. Erst am Ende
   zuweisen: bei einem Fehler bleibt die alte Spur stehen, statt dass Karte und
   Log kurz leer sind. */
async function refreshTrack(){
  try{
    const res = await fetch('track.json', {cache:'no-cache'});
    if(!res.ok) return false;
    const j = await res.json();
    if(!Array.isArray(j.points) || !j.points.length) return false;
    TRACK = j; TRACK_KM = null; STOPS_KEY = null;
    return true;
  }catch(e){ return false; }   // Karte funktioniert auch ohne, dann eben nur mit den Meldungen
}
async function ensureTrack(){
  if(TRACK) return TRACK;
  await refreshTrack();
  return TRACK;
}

const R_EARTH = 6371000;
function metersBetween(a, b){
  const rad = d => d*Math.PI/180;
  const dLat = rad(b[0]-a[0]), dLon = rad(b[1]-a[1]);
  const x = Math.sin(dLat/2)**2 + Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2;
  return 2*R_EARTH*Math.asin(Math.sqrt(x));
}

/* Pausen aus der Spur: aufeinanderfolgende Punkte, die im Umkreis von 150 m um
   den Beginn der Ansammlung bleiben. Bleibt der Fahrer dort länger als 40
   Minuten, ist das eine Pause — beim TCR die eigentlich interessante
   Information — wobei die Spur nur zeigt, DASS er stand, nie warum: Schlaf,
   Reifenpanne und Supermarkt sehen darin identisch aus. Deshalb heißt es
   überall neutral „Pause", nie „Schlaf".
   Ein Ausfall des Trackers sieht anders aus: dann liegt der nächste Punkt weit
   entfernt und bildet gar keine Ansammlung. */
function findStops(points, minMinutes = 40, radiusM = 150){
  const stops = [];
  let i = 0;
  while(i < points.length){
    let j = i + 1;
    while(j < points.length){
      if(metersBetween(points[i], points[j]) < radiusM){ j++; continue; }
      /* Ein einzelner Ausreißer (schlechter GPS-Fix) darf eine durchgehende
         Pause nicht beenden: reicht der übernächste Punkt wieder in den
         Radius, wird der eine schlechte Fix übersprungen statt die Pause zu
         zerreißen. Nacht 30./31.07.2026: ein 162-m-Ausreißer riss eine
         433-Minuten-Pause in zwei Stücke (122 + 239 min) mit 71 Minuten
         dazwischen, die in keiner Pause mehr auftauchten. Zwei echte
         Bestandsfälle (27.07. 157,7 m / 29.07. 30-km-Sprung) zeigten
         dieselbe Ursache in milderer Form. Echte Aufbrüche erzeugen mehrere
         aufeinanderfolgende Punkte weit weg, nicht nur einen — die bleiben
         weiterhin ein Cluster-Ende. */
      if(j+1 < points.length && metersBetween(points[i], points[j+1]) < radiusM){ j += 2; continue; }
      break;
    }
    const mins = (points[j-1][3] - points[i][3]) / 60;
    if(j > i+1 && mins >= minMinutes){
      stops.push({lat:points[i][0], lon:points[i][1], from:points[i][3], to:points[j-1][3], mins});
      i = j;
    } else i = (j > i+1) ? j : i+1;
  }
  return stops;
}
/* Kilometer → Position auf der Karte. Das Höhenprofil kennt nur Kilometer und
   Höhe, die Spur nur Koordinaten und Zeit — verbunden werden sie über die
   aufsummierte Länge der Spur. Die liegt (Sehnen zwischen Punkten im Abstand
   von 1,6 km) etwas unter der echten Streckenlänge, deshalb wird am Ende auf
   die Renn-Kilometer normiert statt mit absoluten Metern gerechnet. */
let TRACK_KM = null;
function trackKmIndex(){
  if(TRACK_KM || !TRACK) return TRACK_KM;
  const p = TRACK.points;
  let cum = 0;
  const arr = [[0, p[0][0], p[0][1]]];
  for(let i=1;i<p.length;i++){
    cum += metersBetween(p[i-1], p[i]);
    arr.push([cum, p[i][0], p[i][1]]);
  }
  TRACK_KM = {arr, total: cum};
  return TRACK_KM;
}
function latLonAtKm(km, totalKm){
  const idx = trackKmIndex();
  if(!idx || !(totalKm > 0)) return null;
  const target = km / totalKm * idx.total;
  const a = idx.arr;
  if(target <= 0) return [a[0][1], a[0][2]];
  for(let i=1;i<a.length;i++){
    if(a[i][0] >= target){
      const span = a[i][0] - a[i-1][0];
      const f = span > 0 ? (target - a[i-1][0]) / span : 0;
      return [a[i-1][1] + (a[i][1]-a[i-1][1])*f, a[i-1][2] + (a[i][2]-a[i-1][2])*f];
    }
  }
  return [a[a.length-1][1], a[a.length-1][2]];
}

/* Der Marker, den das gekoppelte Höhenprofil über die Karte schiebt. Bewusst
   ein hohler heller Ring statt eines gefüllten Punktes — gefüllte Punkte sind
   auf dieser Karte schon vergeben (Pausen hell, aktuelle Position Messing),
   und ein Zeiger soll sich von echten Orten unterscheiden. */
let mapHoverMarker = null;
function showMapPosition(km, totalKm){
  if(!mapObj || !TRACK) return;
  const pos = latLonAtKm(km, totalKm);
  if(!pos) return;
  if(!mapHoverMarker){
    mapHoverMarker = L.circleMarker(pos, {
      radius: 9, color:'#E9E4D8', weight: 3, fill: false, interactive: false
    }).addTo(mapObj);
  } else mapHoverMarker.setLatLng(pos);
}
function hideMapPosition(){
  if(mapHoverMarker && mapObj){ mapObj.removeLayer(mapHoverMarker); mapHoverMarker = null; }
}

const hhmm = unix => new Date(unix*1000).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
// Erst runden, dann zerlegen — sonst wird aus 119,6 min „1 h 60 min“.
/* Wie dur(), aber mit Minuten auch oberhalb einer Stunde — für Stellen, an
   denen die Minute die Aussage ist (Fähr-Countdown, Standzeiten).
   Volle Stunden bleiben ohne Minutenteil: „3 h 0 min“ liest sich wie ein
   Anzeigefehler, und die Null trägt nichts, was „3 h“ nicht schon sagt. */
const dhm = mins => { const m = Math.round(mins);
  if(m < 60) return `${m} min`;
  const h = Math.floor(m/60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`; };

function renderMap(c){
  const marks = c.list.filter(e=> e.lat!=null && e.lon!=null);
  const trk = TRACK ? TRACK.points : null;
  const wrap = document.getElementById('mapWrap');
  if(!marks.length && !trk){ wrap.innerHTML = '<div class="empty">Noch keine GPS-Daten.</div>'; return; }
  if(!mapObj){
    wrap.innerHTML = '';
    mapObj = L.map('mapWrap');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapObj);
    mapObj.on('zoomend load', applyDotSizes);
  }
  if(mapLayer) mapObj.removeLayer(mapLayer);
  const group = L.layerGroup();
  mapDots = [];

  // Die echte Spur, wenn vorhanden — sonst die alte Notlösung, eine Gerade
  // zwischen den stündlichen Meldungen.
  const latlngs = trk ? trk.map(p=> [p[0], p[1]]) : marks.map(p=> [p.lat, p.lon]);
  // Dunkle Unterlage, damit die Linie auf bunten Kartenkacheln lesbar bleibt.
  L.polyline(latlngs, {color:'#0C1620', weight:6, opacity:.55}).addTo(group);
  L.polyline(latlngs, {color:'#D9A441', weight:3}).addTo(group);

  /* Die Fährüberfahrt als eigener, gestrichelter Abschnitt übers Wasser — die
     einzige Stelle der Spur, die nicht gefahren wurde. Bei einer Funkloch-Lücke
     ist das schlicht die Gerade board→land, sonst folgt sie den Mittsee-Punkten.
     Ein ⛴️ auf der Mitte trägt Abfahrt und Ankunft in der Sprechblase. */
  const fer = c.ferry;
  if(fer && fer.boardPt){
    const wasser = [ [fer.boardPt[0], fer.boardPt[1]],
      ...fer.midPts.map(p=> [p[0], p[1]]) ];
    if(fer.landPt) wasser.push([fer.landPt[0], fer.landPt[1]]);
    L.polyline(wasser, {color:'#0C1620', weight:6, opacity:.55}).addTo(group);
    L.polyline(wasser, {color:'#BCD7DE', weight:3, dashArray:'2 7'}).addTo(group);
    const mitte = wasser[Math.floor(wasser.length/2)];
    const linie = fer.dep ? `<br>${esc(fer.dep.linie)}` : '';
    const anTxt = fer.state === 'done'
      ? ` → an ${hhmm(fer.landPt[3])}`
      : ' · unterwegs';
    L.marker(mitte, {icon: L.divIcon({className:'ferIcon', html:'⛴️',
        iconSize:[24,24], iconAnchor:[12,12]})})
      .bindPopup(`<strong>Fähre nach ${esc(FERRY.ziel)}</strong><br>` +
        `ab ${hhmm(fer.boardPt[3])}${anTxt}${linie}`)
      .addTo(group);
  }

  /* Pausen. Die letzte kann noch laufen — die liegt dann zwangsläufig unter
     dem Messingpunkt der aktuellen Position und bekäme einen unerreichbaren
     eigenen Marker. Ihre Angaben wandern deshalb in dessen Sprechblase. */
  let laufendePause = null;
  if(trk){
    const stops = findStops(trk);
    stops.forEach(s=>{
      if(s.to === trk[trk.length-1][3]){ laufendePause = s; return; }
      const m = L.circleMarker([s.lat, s.lon], {
        radius: 6, color:'#0C1620', fillColor:'#BCD7DE', fillOpacity:1, weight:2
      }).bindPopup(`<strong>Pause · ${dhm(s.mins)}</strong><br>${hhmm(s.from)}–${hhmm(s.to)} Uhr`)
        .addTo(group);
      mapDots.push([m, 'stop']);
    });
  }

  /* Die eigenen Meldungen als kleine Punkte, die aktuelle Position in Messing.
     Die Meldungspunkte tragen bewusst KEINEN Rand: der Rand zählt zur
     sichtbaren Größe, und genau die soll hier zurücktreten. */
  marks.forEach((p,i)=>{
    const last = i===marks.length-1;
    const m = L.circleMarker([p.lat,p.lon], {
      radius: last?7:3.5, color: last?'#0C1620':'#7F98A6', fillColor: last?'#D9A441':'#7F98A6',
      fillOpacity: last?1:.85, weight: last?2:0, stroke: last
    }).bindPopup(
      `<strong>${num(Number(p.km))} km</strong>${p.place?'<br>'+esc(p.place):''}<br>${fmt(p.ts)}` +
      (last && laufendePause
        ? `<br><span style="color:var(--brass)">Pause seit ${hhmm(laufendePause.from)} Uhr · ${dhm(laufendePause.mins)}</span>`
        : '')
    ).addTo(group);
    mapDots.push([m, last ? 'pos' : 'entry']);
  });

  /* Zielmarker: sonst gibt es Kalamata nur in der Leiter, nicht auf der
     Karte. Nur am Zieltag und nur bis zur Ankunft — danach übernimmt der
     bestehende Zieleinlauf-Feiermoment (showCelebration). */
  if(istZieltag(c) && c.rest > 0){
    const kal = c.st.cps.find(cp=> cp.nm === 'Kalamata');
    if(kal && kal.pos){
      L.marker(kal.pos, {icon: L.divIcon({className:'zielIcon',
          html:'<span class="zielRing"></span>🏁', iconSize:[26,26], iconAnchor:[13,13]})})
        .bindPopup('<strong>Ziel · Kalamata</strong>').addTo(group);
    }
  }

  group.addTo(mapObj);
  mapLayer = group;
  // Nur beim ersten Zeichnen einpassen: renderMap läuft im 60s-Takt mit, ein
  // fitBounds bei jedem Durchlauf würde herangezoomte Ansichten wegreißen.
  // Am Zieltag zählt nicht die Gesamtstrecke, sondern die lokale Bewegung —
  // die Karte startet dann direkt nah am Fahrer statt an der ganzen Route.
  if(!mapFitted){
    if(istZieltag(c) && marks.length) mapObj.setView([marks[marks.length-1].lat, marks[marks.length-1].lon], 13);
    else mapObj.fitBounds(latlngs, {padding:[24,24]});
    mapFitted = true;
  }
  /* Zweimal, und das ist nötig: beim Öffnen des <details> hat der Container im
     ersten Moment noch keine Größe, die Karte hat dann noch keine Ansicht und
     damit keinen Zoom, den man lesen könnte. Der Nachschlag nach
     invalidateSize() holt genau diesen ersten Durchgang nach. */
  applyDotSizes();
  setTimeout(()=>{ mapObj.invalidateSize(); applyDotSizes(); }, 50);
  // Das gekoppelte Höhenprofil darunter, gleiche Kilometer-Achse wie die Karte.
  renderMapProfile(c);
}
async function checkMapDetails(){
  if(!document.getElementById('mapDetails').open){ hideMapPosition(); return; }
  await ensureTrack();
  ensureLeaflet(()=> renderMap(compute()));
}
document.getElementById('mapDetails').addEventListener('toggle', checkMapDetails);

function renderSource(c){
  const line = document.getElementById('sourceLine');
  const stand = c.last ? 'Stand ' + fmt(c.last.ts) : 'noch kein Stand';
  line.innerHTML = `${stand} · Start 19.07.2026, 20:00 CEST · Limit 08.08.2026 ·
    <a href="https://www.followmychallenge.com/live/tcrno12/" target="_blank" rel="noopener">Live-Tracker</a> ·
    <a href="https://dotwatcher.cc/race/transcontinental-race-no12-2026" target="_blank" rel="noopener">DotWatcher</a>`;
  /* Andenken-Zustand, öffentliche Ansicht: der Footer räumt sich auf, statt
     dauerhaft „stündlich vom Live-Tracker abgefragt" zu behaupten — das
     Rennen ist vorbei, die Abfragen sind es auch. Die Ehrlichkeits-Notiz zur
     Startnummer bleibt stehen: sie ist bewusst gesetzt (siehe CLAUDE.md), kein
     Rest zum Wegräumen. Im Bearbeiten-Modus bleibt die volle Quellen-Angabe
     stehen — wer hier noch etwas nachträgt, braucht sie weiterhin. */
  if(istAngekommen(c) && c.last && !EDIT){
    document.getElementById('foot').innerHTML =
      `🏁 Manuel ist am ${fmt(c.last.ts)} in Kalamata angekommen, nach ${dur(new Date(c.last.ts)-c.start)} Rennzeit.
       Das war die letzte Aktualisierung — das Board bleibt als Andenken an diese Fahrt stehen.<br>
       Zuordnung Startnummer 84 zu Manuel Kaufer nicht unabhängig verifiziert. Kilometer der Kontrollpunkte sind Schätzwerte.`;
    return;
  }
  document.getElementById('foot').innerHTML = EDIT
    ? `Bearbeiten-Modus. Quelle gerade: <code>${SOURCE}</code>. Änderungen sind erst öffentlich, wenn du
       <code>data.json</code> im Repo ersetzt oder den frischen Link verschickst.<br>
       Zuordnung Startnummer 84 zu Manuel Kaufer nicht unabhängig verifiziert. Kilometer der Kontrollpunkte sind Schätzwerte.`
    : `Werte werden seit dem 20.07.2026 automatisiert stündlich vom offiziellen Live-Tracker abgefragt
       (erkennbar an „GPS" bei der Meldung); vereinzelte Einträge sind von Hand nachgetragen. Quelle: <code>${SOURCE}</code>.<br>
       Das Höhenprofil folgt der aufgezeichneten Spur des Trackers, die Höhenmeter darin sind gerechnet — wie genau, steht ausklappbar unter dem Höhenprofil.<br>
       Zuordnung Startnummer 84 zu Manuel Kaufer nicht unabhängig verifiziert. Kilometer der Kontrollpunkte sind Schätzwerte.`;
}

/* ---------- Feiermoment beim Kontrollpunkt ----------
   Erreicht Manuel einen Kontrollpunkt, bekommt jeder, der das Board öffnet,
   einmal Konfetti und einen grünen Haken — aber wirklich nur EINMAL je Gerät
   und Kontrollpunkt, sonst wäre es beim dritten Nachschauen an dem Tag eine
   Belästigung. Gemerkt wird das in `localStorage`; `render()` läuft im
   60-Sekunden-Takt, ohne diese Sperre ginge das Konfetti minütlich wieder los.

   Zwei Fälle bleiben bewusst ohne Feier: ein Kontrollpunkt (oder Land), der
   länger als 24 h zurückliegt (`cpReached`/`ccReached` sind dann null —
   niemand soll Tage später eine schale Feier sehen), und ein Gerät, auf dem
   localStorage blockiert ist (privates Fenster). Für den zweiten Fall gibt es
   `SEEN_MEM` als Notnagel: dann hält die Sperre wenigstens, solange der Tab
   offen ist. Länder teilen sich denselben Speicher wie Kontrollpunkte, unter
   dem Schlüssel `cc_<Ländercode>` — zwei getrennte Listen hätten hier nichts
   gewonnen. */
const SEEN_KEY = 'tcr84:cpSeen';
const SEEN_MEM = new Set();
function seenCps(){
  try{ return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch(e){ return new Set(); }
}
function markCpSeen(nm){
  SEEN_MEM.add(nm);
  try{ localStorage.setItem(SEEN_KEY, JSON.stringify([...seenCps(), nm])); }catch(e){}
}

let celebrating = false;
/* Der Zieleinlauf bekommt eine eigene Gesehen-Marke statt sich die von
   Kontrollpunkten/Ländern zu teilen (SEEN_KEY) — zwei Gründe: er hängt an
   `istAngekommen()`, nicht an einem 24h-Fenster (könnte sonst Tage nach der
   Ankunft nochmal auslösen, wenn jemand localStorage löscht), und er muss
   der ccReached-/cpReached-Prüfung unten IMMER vorgehen. Ohne eigenen Vorrang
   könnte eine gleichzeitig frische Griechenland-Grenzfeier (`ccReached`) den
   größten Moment des ganzen Boards verdrängen — dieselbe Konkurrenz, die
   maybeCelebrate für CP/Land längst kennt, hier nur mit höherem Einsatz. */
const ZIEL_SEEN_KEY = 'tcr84:zielSeen';
let ZIEL_SEEN_MEM = false;
function zielSeen(){
  if(ZIEL_SEEN_MEM) return true;
  try{ return localStorage.getItem(ZIEL_SEEN_KEY) === '1'; }catch(e){ return false; }
}
function markZielSeen(){
  ZIEL_SEEN_MEM = true;
  try{ localStorage.setItem(ZIEL_SEEN_KEY, '1'); }catch(e){}
}
function maybeCelebrate(c){
  if(celebrating) return;
  /* `istAngekommen()` allein reicht für den einmaligen, unwiderruflichen
     Popup NICHT — das ist reiner Kilometerstand (`rest===0`), und genau der
     hat hier schon einmal 51 km danebengelegen (CP2b Chopok, 29.07.2026) und
     eine ganze Zieleinlauf-Feier vorzeitig ausgelöst (CP3 Sarajevo,
     01.08.2026, siehe CLAUDE.md). Jeder andere Kontrollpunkt — inklusive der
     alten, generischen Kalamata-Fassung über showCelebration — verlangt
     deshalb eine Spur-Bestätigung (`cpHit()`/`cpHits`), bevor er als erreicht
     gilt. Der Finale-Popup bekommt dieselbe zweite Meinung: erst wenn BEIDE
     einig sind (Kilometerstand UND Spur), zündet er. Die kosmetischen
     Andenken-Zweige (renderLive/renderFuel/…) bleiben bewusst bei der
     einfachen `istAngekommen()`-Prüfung — die sind reversibel und korrigieren
     sich beim nächsten Rendergang von selbst, der Popup nicht. */
  const zielCp = c.st.cps.find(cp=> Number(cp.km) >= c.total);
  if(istAngekommen(c) && zielCp && c.cpHits.has(zielCp) && c.last && !zielSeen()){
    celebrating = true;
    setTimeout(()=>{ markZielSeen(); showFinale(c); }, 600);
    return;
  }
  let ev = null, isCc = false, nm = null;
  if(c.ccReached){
    const ccNm = `cc_${c.ccReached.cc}`;
    if(!SEEN_MEM.has(ccNm) && !seenCps().has(ccNm)){ ev = c.ccReached; isCc = true; nm = ccNm; }
  }
  if(!ev && c.cpReached){
    const cpNm = c.cpReached.cp.nm;
    if(!SEEN_MEM.has(cpNm) && !seenCps().has(cpNm)){ ev = c.cpReached; isCc = false; nm = cpNm; }
  }
  if(!ev) return;
  celebrating = true;
  setTimeout(()=>{ markCpSeen(nm); showCelebration(c, ev, isCc); }, 600);
}

/* Konfetti aus ~80 winzigen <i>, jedes mit eigener Falldauer, Drift und
   Drehung über CSS-Variablen — eine gemeinsame Keyframe-Regel, kein
   Animations-Loop in JS und keine Bibliothek. Räumt sich selbst wieder ab. */
function confettiRain(gold){
  if(matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  // Das Finale bekommt eine reinere Messing-Palette statt des bunten CP-Mixes
  // — derselbe Regen, nur festlicher für den einen Moment, den es nur einmal gibt.
  const cols = gold ? ['#D9A441','#E6B458','#F3D68A','#BCD7DE'] : ['#D9A441','#BCD7DE','#86B08C','#E9E4D8'];
  let html = '';
  for(let i=0;i<80;i++){
    const w = (5+Math.random()*6).toFixed(1), h = (7+Math.random()*7).toFixed(1);
    html += `<i style="left:${(Math.random()*100).toFixed(1)}%;width:${w}px;height:${h}px;` +
      `background:${cols[i%cols.length]};${Math.random()<.35?'border-radius:50%;':''}` +
      `--dx:${(Math.random()*90-45).toFixed(0)}px;--rot:${(Math.random()*900-300).toFixed(0)}deg;` +
      `animation-duration:${(2.6+Math.random()*2).toFixed(2)}s;` +
      `animation-delay:${(Math.random()*1.3).toFixed(2)}s;` +
      `opacity:${(.6+Math.random()*.4).toFixed(2)}"></i>`;
  }
  box.innerHTML = html;
  document.body.appendChild(box);
  setTimeout(()=> box.remove(), 7000);
}

function showCelebration(c, r, isCc){
  const ziel = !isCc && Number(r.cp.km) >= c.total;
  const cum = cumClimbAt(new Date(r.ts).getTime()/1000);
  const cps = c.st.cps.filter(x=> Number(x.km) > 0 && Number(x.km) < c.total);
  const idx = !isCc ? cps.findIndex(x=> Number(x.km) === Number(r.cp.km)) : -1;
  const naechster = !isCc ? c.st.cps.find(x=> Number(x.km) > Number(r.cp.km)) : null;
  const punkte = isCc ? '' : [...cps.map(x=> ({fin:false, on: Number(x.km) <= Number(r.cp.km)})),
                  {fin:true, on: ziel}]
    .map(p=> `<i class="${p.fin?'fin':''}${p.on?' on':''}"></i>`).join('');
  // Länder-Feier greift dieselbe Liste wie das Verpflegungs-Panel, damit
  // Flagge und Snack nirgends ein zweites Mal gepflegt werden müssen.
  const land = isCc ? FUEL.laender.find(s => s.cc === r.cc) : null;
  const titleNm = isCc ? (land ? land.nm : r.cc) : r.cp.nm;
  const ov = document.createElement('div');
  ov.className = 'celebrate';
  ov.setAttribute('role','dialog');
  ov.setAttribute('aria-modal','true');
  ov.setAttribute('aria-label', isCc ? 'Ländergrenze passiert: ' + titleNm : (ziel ? 'Ziel erreicht: ' : 'Kontrollpunkt erreicht: ') + titleNm);
  ov.innerHTML = `
    <div class="celPanel">
      <svg class="celMark" viewBox="0 0 60 60" aria-hidden="true">
        <circle class="cm-c" cx="30" cy="30" r="27"/>
        <path class="cm-k" d="M18 31.5 L26.5 40 L43 21"/>
      </svg>
      <div class="celEyebrow">${isCc ? 'Ländergrenze passiert' : (ziel ? 'Zieleinlauf'
        : idx >= 0 ? `Kontrollpunkt ${idx+1} von ${cps.length}` : 'Kontrollpunkt erreicht')}</div>
      <h3>${isCc && land ? land.flag+' ' : ''}${esc(titleNm)}</h3>
      <div class="celSub">
        ${isCc ? `Manuel ist in ${esc(titleNm)} eingefahren.` : (ziel ? 'Manuel ist angekommen. 4.800 Kilometer quer durch Europa.'
               : 'Manuel hat den Kontrollpunkt passiert.')}<br>
        ${fmt(r.ts)} · nach ${dur(new Date(r.ts)-c.start)} Rennzeit
      </div>
      <div class="celStats">
        <div><b>${num(Number(isCc ? r.km : r.cp.km))}</b>km gefahren</div>
        ${cum ? `<div><b>${num(Math.round(cum.up))}</b>hm bergauf</div>` : ''}
      </div>
      <div class="celPath" aria-hidden="true">${punkte}</div>
      ${isCc && land
        ? `<div class="celNext">Ab jetzt auf der Karte: <b>${land.em} ${esc(land.snack)}</b></div>`
        : (!ziel && naechster
            ? `<div class="celNext">Als Nächstes: <b>${esc(naechster.nm)}</b> · ${num(Number(naechster.km)-Number(r.cp.km))} km</div>`
            : '')}
      <button class="celClose" id="celClose">${isCc ? 'Willkommen!' : (ziel ? 'Was für eine Fahrt!' : 'Weiter geht’s!')}</button>
    </div>`;
  document.body.appendChild(ov);
  confettiRain();

  const zu = ()=>{
    ov.remove(); celebrating = false;
    document.removeEventListener('keydown', beiTaste);
  };
  const beiTaste = e=>{ if(e.key === 'Escape') zu(); };
  ov.querySelector('#celClose').onclick = zu;
  ov.onclick = e=>{ if(e.target === ov) zu(); };   // Klick daneben schließt auch
  document.addEventListener('keydown', beiTaste);
  ov.querySelector('#celClose').focus();
}

/* ---------- Das Finale ----------
   Der Zieleinlauf lief bis hierhin über dieselbe showCelebration() wie jeder
   Kontrollpunkt — mit einer hartkodierten „4.800 Kilometer"-Zeile und ohne
   eigenen Vorrang gegen eine gleichzeitige Länderfeier (siehe maybeCelebrate
   oben). Das hier ist der eigenständige, große Moment: Auftakt → der ganze
   Streckenverlauf zeichnet sich einmal nach → die Kennzahlen zählen hoch →
   die teilbare Finisher-Karte. Jede Stufe ist überspringbar, und die Karte
   bleibt danach über die Kopf-Pille erreichbar (siehe renderWind/openFinaleCard). */

/* Kennzahlen der Finisher-Karte — eine Funktion, zwei Abnehmer (der finale
   Popup und die später über die Kopf-Pille wieder aufrufbare Karte), damit
   beide garantiert dieselben Zahlen zeigen. */
function finisherStats(c){
  const seen = new Set(c.list.filter(e=> e.cc).map(e=> e.cc));
  // FUEL.laender steht bereits in Routenreihenfolge NO→...→GR (siehe dort) —
  // filtern statt aus den Einträgen selbst sortieren, damit ein Wiedereintritt
  // (Grenzstreifen Kosovo/Nordmazedonien) kein Land doppelt zählt.
  const laender = FUEL.laender.filter(l=> seen.has(l.cc));
  return {
    raceTime: dur(new Date(c.last.ts) - c.start),
    km: Math.round(c.km),
    hm: c.climbUp,
    avg: c.avg,
    rank: S.live ? S.live.rank : null,
    laender,
    arrivalTs: c.last.ts
  };
}

/* Die Karte als HTML — dieselbe Vorlage für den letzten Schritt des Popups
   UND für openFinaleCard() (Kopf-Pille, jederzeit danach). Kein esc() nötig:
   alles hier sind eigene Konstanten oder Zahlen, kein Fremdtext (anders als
   die Grußwand). Erscheint die Flaggenreihe zu voll, ist die Alternative aus
   demselben Datensatz gebaut — kein zweiter Rechenweg. */
function finaleCardHtml(c){
  const st = finisherStats(c);
  const flagsOk = st.laender.length > 0 && st.laender.length <= 14;
  return `
    <div class="finaleCard" id="finaleCardEl">
      <div class="fcTop">
        <div class="fcEyebrow">Transcontinental No12 · Trondheim → Kalamata</div>
        <div class="fcName">Manuel Kaufer · #84</div>
      </div>
      <div class="fcBand">
        <div class="fcStats">
          <div><b>${st.raceTime}</b><span>Rennzeit</span></div>
          <div><b>${num(st.km)}</b><span>km</span></div>
          <div><b>${num(st.hm)}</b><span>Höhenmeter</span></div>
        </div>
        ${flagsOk
          ? `<div class="fcFlags">${st.laender.map(l=> l.flag).join('')}</div>`
          : `<div class="fcSub">Ø-Schnitt ${one(st.avg)} km/h${st.rank!=null? ' · Platz '+st.rank : ''}</div>`}
        <div class="fcDate">${fmt(st.arrivalTs)}</div>
      </div>
    </div>
    <div class="btnrow finaleBtns">
      <button id="finShare" type="button">Teilen</button>
      <button id="finSave" class="ghost" type="button">Speichern</button>
      <button id="finClose" class="ghost" type="button">Schließen</button>
    </div>`;
}

/* Dieselbe Karte auf ein <canvas> — für Teilen/Speichern existiert im Board
   sonst nichts Vergleichbares, das ist komplett neu. Fehlt finish.jpg (404),
   bleibt der dunkle Verlauf stehen statt eines kaputten Bildes — `img.onerror`
   löst genauso auf wie `onload`, nur ohne drawImage. */
async function finaleCanvas(c){
  const st = finisherStats(c);
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0C1620';
  ctx.fillRect(0, 0, W, H);
  await new Promise(resolve=>{
    const img = new Image();
    img.onload = ()=>{
      const s = Math.max(W/img.width, H/img.height);
      const iw = img.width*s, ih = img.height*s;
      ctx.drawImage(img, (W-iw)/2, (H-ih)/2, iw, ih);
      resolve();
    };
    img.onerror = resolve;
    img.src = 'finish.jpg';
  });
  const gTop = ctx.createLinearGradient(0, 0, 0, 280);
  gTop.addColorStop(0, 'rgba(6,12,18,.82)'); gTop.addColorStop(1, 'rgba(6,12,18,0)');
  ctx.fillStyle = gTop; ctx.fillRect(0, 0, W, 280);

  /* Von UNTEN nach oben verankert (Datum zuerst, dann Flaggen, Label, Zahl) —
     genau das Muster, das die Karte auf dem Bildschirm über
     `justify-content:space-between` bekommt (siehe .finaleCard in style.css).
     Der erste Versuch rechnete von einem festen `laneY = H-400` nach unten;
     das ließ das ganze Werteband zu hoch sitzen, mit ungenutztem dunklen
     Streifen darunter — im Bildschirm sitzt der Block dicht am Kartenrand,
     im Download hing er in der Mitte. Von unten aus verankert trifft beides
     denselben Abstand zum Rand. */
  const dateY = H - 50;
  const flagsY = dateY - 64;
  const labelY = flagsY - 66;
  const numberY = labelY - 32;

  /* Das Werteband braucht verlässlichen Kontrast, egal was im Foto darunter
     liegt — am 06.08.2026 lag ausgerechnet der helle Gehweg genau unter den
     Zahlen, und Messing auf hellem Grau ist kaum zu lesen. Deshalb ein kurzer
     Übergang, dann eine durchgehend dunkle Fläche ab kurz vor der ersten Zahl
     bis zum unteren Rand — keine sanfte Gradiente mehr, die je nach Foto
     zufällig hell oder dunkel unter den Zahlen landet. */
  const bandTop = numberY - 70;
  const gBot = ctx.createLinearGradient(0, bandTop, 0, bandTop+70);
  gBot.addColorStop(0, 'rgba(6,12,18,0)'); gBot.addColorStop(1, 'rgba(6,12,18,.92)');
  ctx.fillStyle = gBot; ctx.fillRect(0, bandTop, W, 70);
  ctx.fillStyle = 'rgba(6,12,18,.92)';
  ctx.fillRect(0, bandTop+70, W, H-(bandTop+70));

  /* Zentriert, wie die Karte auf dem Bildschirm auch — die erbt text-align:
     center von .celPanel (siehe style.css). Download und Bildschirm müssen
     dieselbe Karte zeigen; ctx.fillText() kennt kein CSS-Erbe, das muss hier
     von Hand nachgebaut werden. */
  ctx.textAlign = 'center';
  const cx = W/2;
  // Zusätzliche Sicherung: ein dunkler Schlagschatten hinter jedem Text, für
  // den Fall, dass die Fläche oben trotzdem mal knapper ausfällt (anderes
  // Foto, anderer Zuschnitt) — dieselbe Technik wie bei Story-Overlays.
  ctx.shadowColor = 'rgba(0,0,0,.75)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#BCD7DE';
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.fillText('TRANSCONTINENTAL NO12 · TRONDHEIM → KALAMATA', cx, 90);
  ctx.fillStyle = '#fff';
  ctx.font = '700 54px "Space Grotesk", sans-serif';
  ctx.fillText('Manuel Kaufer · #84', cx, 158);

  const cols = [['RENNZEIT', st.raceTime], ['KM', num(st.km)], ['HÖHENMETER', num(st.hm)]];
  const colW = (W-112) / 3;
  cols.forEach(([lbl, val], i)=>{
    const x = 56 + i*colW + colW/2;   // Mitte der Spalte, nicht ihr linker Rand
    ctx.fillStyle = '#D9A441';
    ctx.font = '700 50px "IBM Plex Mono", monospace';
    ctx.fillText(val, x, numberY);
    ctx.fillStyle = '#7F98A6';
    ctx.font = '600 17px "IBM Plex Mono", monospace';
    ctx.fillText(lbl, x, labelY);
  });

  ctx.fillStyle = '#BCD7DE';
  const flagsOk = st.laender.length > 0 && st.laender.length <= 14;
  if(flagsOk){
    ctx.font = '46px sans-serif';
    ctx.fillText(st.laender.map(l=> l.flag).join(''), cx, flagsY);
  } else {
    ctx.font = '600 22px "IBM Plex Mono", monospace';
    ctx.fillText(`Ø-Schnitt ${one(st.avg)} km/h${st.rank!=null? ' · Platz '+st.rank : ''}`, cx, flagsY);
  }
  ctx.fillStyle = '#7F98A6';
  ctx.font = '500 20px "IBM Plex Mono", monospace';
  ctx.fillText(fmt(st.arrivalTs), cx, dateY);

  // JPEG statt PNG: die Karte ist ein Foto ohne Transparenz, PNG verlustfrei
  // komprimiert ein Graustufenfoto in dieser Auflösung auf 2-3 MB — für ein
  // Bild, das über WhatsApp/Insta geteilt werden soll, unnötig schwer.
  return new Promise(resolve=> cv.toBlob(resolve, 'image/jpeg', 0.9));
}

function finaleDownload(blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'manuel-kaufer-tcr12.jpg';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 4000);
}
async function finaleShare(c){
  const blob = await finaleCanvas(c);
  if(!blob) return;
  const file = new File([blob], 'manuel-kaufer-tcr12.jpg', {type:'image/jpeg'});
  if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
    try{
      await navigator.share({files:[file], title:'Manuel Kaufer · TCR No12', text:'Angekommen in Kalamata!'});
      return;
    }catch(e){ /* abgebrochen oder nicht unterstützt — Download bleibt der Fallback */ }
  }
  finaleDownload(blob);
}
async function finaleSave(c){
  const blob = await finaleCanvas(c);
  if(blob) finaleDownload(blob);
}
function wireFinaleCard(ov, c, zu){
  ov.querySelector('#finShare').onclick = ()=> finaleShare(c);
  ov.querySelector('#finSave').onclick = ()=> finaleSave(c);
  ov.querySelector('#finClose').onclick = zu;
  ov.querySelector('#finClose').focus();
}

/* Die Karte jederzeit danach ansehen — Zugang über die Kopf-Pille (siehe
   renderWind), keine neue Feier, kein Konfetti, kein celebrating-Vorrang vor
   einer echten Feier nötig (die kann nach der Ankunft ohnehin nicht mehr
   kommen — cpHits/ccReached haben dann nichts Neues mehr zu melden). */
function openFinaleCard(c){
  if(celebrating) return;
  celebrating = true;
  const ov = document.createElement('div');
  ov.className = 'celebrate finale';
  ov.setAttribute('role','dialog');
  ov.setAttribute('aria-modal','true');
  ov.setAttribute('aria-label','Finisher-Karte');
  ov.innerHTML = `<div class="celPanel finalePanel">${finaleCardHtml(c)}</div>`;
  document.body.appendChild(ov);
  const zu = ()=>{ ov.remove(); celebrating = false; document.removeEventListener('keydown', beiTaste); };
  const beiTaste = e=>{ if(e.key === 'Escape') zu(); };
  ov.onclick = e=>{ if(e.target === ov) zu(); };
  document.addEventListener('keydown', beiTaste);
  wireFinaleCard(ov, c, zu);
}

/* Der einmalige Zieleinlauf-Popup. Stufenkette über setTimeout/requestAnimationFrame
   (dasselbe Muster wie zurufTakt für „Verweildauer hängt am Inhalt", hier
   „Verweildauer ist die halbe Freude"). Jede Stufe überspringbar → landet
   direkt auf der Karte, dem einzigen Zustand, der bleiben soll. */
function showFinale(c){
  const ov = document.createElement('div');
  ov.className = 'celebrate finale';
  ov.setAttribute('role','dialog');
  ov.setAttribute('aria-modal','true');
  ov.setAttribute('aria-label','Zieleinlauf: Kalamata');
  document.body.appendChild(ov);

  const reduced = matchMedia('(prefers-reduced-motion:reduce)').matches;
  let cancelled = false, raf = null;
  const timers = [];
  const wait = (ms, fn)=>{ timers.push(setTimeout(()=>{ if(!cancelled) fn(); }, ms)); };
  const stopClocks = ()=>{ timers.forEach(clearTimeout); timers.length = 0; if(raf) cancelAnimationFrame(raf); raf = null; };

  const zu = ()=>{
    if(cancelled) return;
    cancelled = true;
    stopClocks();
    ov.remove(); celebrating = false;
    document.removeEventListener('keydown', beiTaste);
  };
  const beiTaste = e=>{ if(e.key === 'Escape') zu(); };
  document.addEventListener('keydown', beiTaste);

  function panel(inner, {skip=true} = {}){
    ov.innerHTML = `<div class="celPanel finalePanel">${inner}
      ${skip ? `<button class="finaleSkip" id="finSkip" type="button">Überspringen</button>` : ''}</div>`;
    ov.onclick = e=>{ if(e.target === ov) zu(); };
    const skipBtn = ov.querySelector('#finSkip');
    if(skipBtn) skipBtn.onclick = ()=>{ stopClocks(); stageCard(); };
  }

  function stageAuftakt(){
    panel(`
      <div class="finaleFlagWrap">
        <svg class="celMark finaleMark" viewBox="0 0 60 60" aria-hidden="true">
          <circle class="cm-c" cx="30" cy="30" r="27"/>
          <path class="cm-k" d="M18 31.5 L26.5 40 L43 21"/>
        </svg>
        <div class="finaleFlag" aria-hidden="true">🏁</div>
      </div>
      <div class="celEyebrow">Zieleinlauf</div>
      <h3>Kalamata erreicht</h3>
      <div class="celSub">Manuel ist angekommen.</div>`);
    confettiRain(true);
    if(reduced){ wait(50, stageCard); return; }
    wait(2800, stageReplay);
  }

  function stageReplay(){
    const pts = TRACK && TRACK.points;
    if(!pts || pts.length < 2){ stageCounts(); return; }
    let minLat=Infinity, maxLat=-Infinity, minLon=Infinity, maxLon=-Infinity;
    for(const p of pts){
      if(p[0]<minLat) minLat=p[0]; if(p[0]>maxLat) maxLat=p[0];
      if(p[1]<minLon) minLon=p[1]; if(p[1]>maxLon) maxLon=p[1];
    }
    const W=340, H=380, pad=26;
    const spanLat=(maxLat-minLat)||1, spanLon=(maxLon-minLon)||1;
    const s = Math.min((W-2*pad)/spanLon, (H-2*pad)/spanLat);
    const X = lon => pad + (lon-minLon)*s;
    const Y = lat => pad + (maxLat-lat)*s;   // Norden oben
    const d = pts.map((p,i)=> `${i?'L':'M'}${X(p[1]).toFixed(1)},${Y(p[0]).toFixed(1)}`).join('');
    const startXY = [X(pts[0][1]), Y(pts[0][0])];
    panel(`
      <div class="celEyebrow">Trondheim → Kalamata</div>
      <svg id="finReplaySvg" viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <path id="finRoute" class="finRoute" d="${d}"/>
        <circle id="finDot" class="finDot" r="4.5" cx="${startXY[0]}" cy="${startXY[1]}"/>
        <text class="finLbl" x="${startXY[0]}" y="${Math.max(startXY[1]-10,10)}">Trondheim</text>
        <text class="finLbl fin" x="${X(pts[pts.length-1][1])}" y="${Math.max(Y(pts[pts.length-1][0])-10,10)}">Kalamata</text>
      </svg>
      <div class="celSub">4.800 Kilometer quer durch Europa.</div>`);
    const path = ov.querySelector('#finRoute');
    const dot = ov.querySelector('#finDot');
    const len = path.getTotalLength();
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    const DUR = 11000;
    let t0 = null;
    const frame = ts=>{
      if(cancelled) return;
      if(t0 == null) t0 = ts;
      const t = Math.min((ts-t0)/DUR, 1);
      path.style.strokeDashoffset = String(len*(1-t));
      const pt = path.getPointAtLength(len*t);
      dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
      if(t < 1) raf = requestAnimationFrame(frame);
      else wait(600, stageCounts);
    };
    raf = requestAnimationFrame(frame);
  }

  function stageCounts(){
    const st = finisherStats(c);
    panel(`
      <div class="celEyebrow">Was für eine Fahrt</div>
      <div class="finaleCounts">
        <div><b id="cntTime">0</b><span>Rennzeit</span></div>
        <div><b id="cntKm">0</b><span>km</span></div>
        <div><b id="cntHm">0</b><span>Höhenmeter</span></div>
      </div>`);
    const raceMs = new Date(c.last.ts) - c.start;
    const elTime = ov.querySelector('#cntTime'), elKm = ov.querySelector('#cntKm'), elHm = ov.querySelector('#cntHm');
    if(reduced){
      elTime.textContent = st.raceTime; elKm.textContent = num(st.km); elHm.textContent = num(st.hm);
      wait(900, stageCard);
      return;
    }
    const DUR = 1800;
    let t0 = null;
    const frame = ts=>{
      if(cancelled) return;
      if(t0 == null) t0 = ts;
      const t = Math.min((ts-t0)/DUR, 1);
      const e = 1 - Math.pow(1-t, 3);   // ease-out — die letzten Meter dürfen sich Zeit lassen
      elTime.textContent = dur(raceMs*e);
      elKm.textContent = num(Math.round(st.km*e));
      elHm.textContent = num(Math.round(st.hm*e));
      if(t < 1) raf = requestAnimationFrame(frame);
      else wait(900, stageCard);
    };
    raf = requestAnimationFrame(frame);
  }

  function stageCard(){
    panel(finaleCardHtml(c), {skip:false});
    wireFinaleCard(ov, c, zu);
  }

  stageAuftakt();
}

/* Verletzungs-Hinweis — dasselbe Muster wie maybeCelebrate/markCpSeen, aber
   eigene Gesehen-Marke (auf HINWEIS.id) und eigener SEEN_MEM-Notnagel für
   Fenster mit blockiertem localStorage. Teilt den `celebrating`-Mutex, damit
   Hinweis und Feier nie gleichzeitig aufgehen. */
const HINWEIS_SEEN_KEY = 'tcr84:hinweisSeen';
const HINWEIS_SEEN_MEM = new Set();
function markHinweisSeen(){
  HINWEIS_SEEN_MEM.add(HINWEIS.id);
  try{ localStorage.setItem(HINWEIS_SEEN_KEY, HINWEIS.id); }catch(e){}
}
function maybeHinweis(){
  if(celebrating || !HINWEIS || !HINWEIS.id) return;
  let seen = HINWEIS_SEEN_MEM.has(HINWEIS.id);
  try{ if(localStorage.getItem(HINWEIS_SEEN_KEY) === HINWEIS.id) seen = true; }catch(e){}
  if(seen) return;
  celebrating = true;
  setTimeout(()=>{ markHinweisSeen(); showHinweis(); }, 600);
}

/* Wie showCelebration, aber leise: 🙏 statt Haken, KEIN confettiRain, keine
   Statistik-/Fortschrittszeile. Der Knopf führt zur Grußwand (öffnet das
   Zuruf-Formular, sofern nicht die 6-h-Sperre läuft), ein leiser Zweitlink zum
   Werkstatt-Logbuch. */
function showHinweis(){
  const ov = document.createElement('div');
  ov.className = 'celebrate';
  ov.setAttribute('role','dialog');
  ov.setAttribute('aria-modal','true');
  ov.setAttribute('aria-label', HINWEIS.titel);
  ov.innerHTML = `
    <div class="celPanel">
      <div class="celEmoji" aria-hidden="true">${HINWEIS.em}</div>
      <div class="celEyebrow">${esc(HINWEIS.eyebrow)}</div>
      <h3>${esc(HINWEIS.titel)}</h3>
      <div class="celSub celProse">${esc(HINWEIS.text)}</div>
      <button class="celClose" id="hinClose">${esc(HINWEIS.cta)}</button>
      <button class="celLink" id="hinWerkstatt" type="button">Alles dazu im Werkstatt-Logbuch</button>
    </div>`;
  document.body.appendChild(ov);

  const zu = ()=>{
    ov.remove(); celebrating = false;
    document.removeEventListener('keydown', beiTaste);
  };
  const beiTaste = e=>{ if(e.key === 'Escape') zu(); };
  const scrollZu = sel=>{ const el = document.querySelector(sel); if(el) el.scrollIntoView({behavior:'smooth', block:'start'}); };
  ov.querySelector('#hinClose').onclick = ()=>{
    zu();
    scrollZu('#zurufWrap');
    // Formular nur öffnen, wenn keine eigene Zuruf-Sperre läuft — sonst bloß hin.
    if(typeof zurufSperreRest === 'function' && zurufSperreRest() <= 0) zurufFormular(true);
  };
  ov.querySelector('#hinWerkstatt').onclick = ()=>{
    zu();
    const det = document.getElementById('werkstattDetails');
    if(det && det.hidden === false) det.open = true;
    scrollZu('#werkstattDetails');
  };
  ov.onclick = e=>{ if(e.target === ov) zu(); };   // Klick daneben schließt auch
  document.addEventListener('keydown', beiTaste);
  ov.querySelector('#hinClose').focus();
}

/* Zum Ausprobieren und Vorführen in der Browser-Konsole:
     tcr84Hinweis()       den Verletzungs-Hinweis on demand zeigen
     tcr84HinweisReset()  Gesehen-Marke löschen, dann poppt er beim Laden neu */
window.tcr84Hinweis = ()=>{
  if(celebrating) return 'ein Modal ist schon offen — erst schließen.';
  celebrating = true; showHinweis(); return 'ok';
};
window.tcr84HinweisReset = ()=>{
  HINWEIS_SEEN_MEM.clear();
  try{ localStorage.removeItem(HINWEIS_SEEN_KEY); }catch(e){}
  return 'zurückgesetzt — beim nächsten Laden poppt der Hinweis wieder.';
};

/* Zum Ausprobieren und Vorführen in der Browser-Konsole:
     tcr84Feier()             letzten passierten Kontrollpunkt nochmal feiern
     tcr84Feier('CP1 Flåm')   einen bestimmten
     tcr84Feier('Kalamata')   die Zielfassung ansehen
     tcr84FeierReset()        Gesehen-Markierungen löschen, dann feiert es echt neu */
window.tcr84Feier = nm=>{
  const c = compute();
  const cp = nm ? c.st.cps.find(x=> x.nm === nm) : (c.cpReached || {}).cp;
  if(!cp) return 'kein Kontrollpunkt gefunden — Namen prüfen: ' + c.st.cps.map(x=>x.nm).join(', ');
  if(celebrating) return 'ein Modal ist schon offen — erst schließen.';
  // Kalamata bekommt seit dem Finale eine eigene, größere Fassung (showFinale)
  // statt der generischen CP-Feier — dieselbe Weiche wie in maybeCelebrate.
  if(Number(cp.km) >= c.total){
    celebrating = true;
    showFinale(c);
    return 'ok — Zielfassung (showFinale)';
  }
  celebrating = true;
  showCelebration(c, {cp, ts: (c.cpReached && c.cpReached.ts) || (c.last||{}).ts || c.st.start});
  return 'ok';
};
window.tcr84FeierReset = ()=>{
  SEEN_MEM.clear();
  try{ localStorage.removeItem(SEEN_KEY); }catch(e){}
  return 'zurückgesetzt — beim nächsten erreichten Kontrollpunkt feiert es wieder.';
};
/* Dieselbe Feier fürs Land, ohne auf die nächste echte Grenze zu warten:
     tcr84Grenze('SE')   Feier so, als wäre er gerade nach Schweden eingefahren
     tcr84Grenze()       zuletzt erreichtes Land nochmal */
window.tcr84Grenze = cc=>{
  const c = compute();
  const code = cc ? String(cc).toUpperCase() : (c.ccReached || {}).cc;
  const land = code ? FUEL.laender.find(x=> x.cc === code) : null;
  if(!land) return 'unbekannt — ' + FUEL.laender.map(x=> x.cc).join(', ');
  celebrating = true;
  showCelebration(c, { cc: land.cc, ts: (c.ccReached && c.ccReached.ts) || (c.last||{}).ts || c.st.start,
    km: (c.ccReached && c.ccReached.km) || c.km }, true);
  return 'ok';
};
/* Der Zieltag-Look (Verpflegung ohne Speisekarte, Karte auf den Fahrer
   gezoomt, „Rest bis Kalamata" pulst, Ankunftszeit-Kachel, Höhenprofil auf
   „Heute", Zielmarker) schaltet sich erst ab ZIELTAG_AB automatisch ein —
   zum Vorführen vorher:
     tcr84Zieltag('an')   Zieltag-Look erzwingen, unabhängig vom Datum
     tcr84Zieltag('off')  Override aus, echte Datumsprüfung wieder aktiv */
window.tcr84Zieltag = was=>{
  if(!was || was === 'off'){ ZIELTAG_OVERRIDE = null; render(); return 'Zieltag-Override aus.'; }
  if(was === 'an'){ ZIELTAG_OVERRIDE = true; render(); return 'Zieltag-Override: an'; }
  return "unbekannt — 'an' oder 'off'";
};
/* Das Finale zum Vorführen, unabhängig vom echten Zielstand:
     tcr84Finale()           die volle Sequenz einmal komplett durchspielen
     tcr84Angekommen('an')   den dauerhaften Andenken-Zustand des ganzen
                             Boards erzwingen (Live-Zeile, Kopf-Pille, Fähre/
                             Verpflegung aus, Grußwand-Text, Footer)
     tcr84Angekommen('off')  Override aus, `c.rest===0` entscheidet wieder */
window.tcr84Finale = ()=>{
  if(celebrating) return 'ein Modal ist schon offen — erst schließen.';
  celebrating = true;
  showFinale(compute());
  return 'ok';
};
window.tcr84Angekommen = was=>{
  if(!was || was === 'off'){ ANGEKOMMEN_OVERRIDE = null; render(); return 'Angekommen-Override aus.'; }
  if(was === 'an'){ ANGEKOMMEN_OVERRIDE = true; render(); return 'Angekommen-Override: an'; }
  return "unbekannt — 'an' oder 'off'";
};
/* Die echte Überfahrt steht erst in ~1 Woche an — bis dahin lässt sich die
   Fähr-Anzeige nur über einen synthetischen Stand ausprobieren:
     tcr84Faehre('onboard')  gerade an Bord (Live-Zeile ⛴️, Karte, Panel-Status)
     tcr84Faehre('done')     gerade gelandet (bleibt 24 h stehen)
     tcr84Faehre('off')      Override aus, echte Erkennung wieder aktiv */
window.tcr84Faehre = state=>{
  if(!state || state === 'off'){ FERRY_OVERRIDE = null; render(); return 'Fähr-Override aus.'; }
  const now = Date.now() / 1000;
  const tb = FERRY.haefen.find(h=> h.nm === 'Trelleborg').pos;
  const zp = FERRY.zielPos;
  const mid = [(tb[0]+zp[0])/2, (tb[1]+zp[1])/2];
  if(state === 'onboard'){
    const m = [mid[0], mid[1], 0, now - 1.5*3600];
    FERRY_OVERRIDE = ferryInfo('onboard', [tb[0], tb[1], 0, now - 3*3600], m, [m]);
  } else if(state === 'done'){
    FERRY_OVERRIDE = ferryInfo('done', [tb[0], tb[1], 0, now - 9*3600],
      [zp[0], zp[1], 0, now - 2*3600], [[mid[0], mid[1], 0, now - 5.5*3600]]);
  } else return "unbekannt — 'onboard', 'done' oder 'off'";
  render();
  return 'Fähr-Override: ' + state;
};
/* Dasselbe für die Verpflegung: die Speisekarte eines Landes ansehen, ohne
   dorthin zu fahren. Neun der elf Länder liegen noch Wochen voraus, und ihre
   Karten sind das einzige am Panel, was sich nicht von selbst durchprobiert.
     tcr84Land('BA')   Panel so, als stünde er in Bosnien
     tcr84Land()       Liste der Ländercodes
     tcr84Land('off')  zurück auf das gemessene Land
   Sichtbar ist das Panel erst ab dem Ablegen — zum Ausprobieren davor also
   mit tcr84Faehre('done') kombinieren. */
window.tcr84Land = cc=>{
  if(cc === 'off'){ FUEL_OVERRIDE = null; render(); return 'Land-Override aus.'; }
  if(!cc) return 'Ländercodes: ' + FUEL.laender.map(l=> `${l.cc} ${l.nm}`).join(' · ');
  const l = FUEL.laender.find(x=> x.cc === String(cc).toUpperCase());
  if(!l) return 'unbekannt — ' + FUEL.laender.map(x=> x.cc).join(', ');
  FUEL_OVERRIDE = l;
  render();
  return `Land-Override: ${l.flag} ${l.nm}`;
};
/* Der Rückenwind-Streifen zum Ausprobieren, solange kein Worker eingerichtet
   ist — und um die vier Windlagen zu sehen, ohne aufs Wetter zu warten:
     tcr84Wind('demo')    Streifen mit erfundenem Zählerstand einschalten
     tcr84Wind('gegen')   Windlage erzwingen: gegen | ruecken | seite | flaute
     tcr84Wind('frei')    die Drei-Stunden-Sperre aufheben
     tcr84Wind('off')     alles zurück
   Die erfundene Zahl bleibt ausdrücklich im Testmodus: sobald `WIND.api`
   steht, kommt sie vom Worker, und niemand sieht je einen Fantasiezähler. */
window.tcr84Wind = was=>{
  if(!was || was === 'off'){
    WIND_DEMO = false; WX_OVERRIDE = null;
    try{ localStorage.removeItem(WIND_KEY); }catch(e){}
    render(); return 'Wind-Demo aus.';
  }
  if(was === 'frei'){
    try{ localStorage.removeItem(WIND_KEY); }catch(e){}
    renderWind(); return 'Sperre aufgehoben — der Knopf geht wieder.';
  }
  if(was === 'demo'){
    WIND_DEMO = true;
    if(!WIND_N.da) WIND_N = { total: 1247, heute: 47, da: true };
    render(); return 'Wind-Demo an (erfundener Zählerstand).';
  }
  const kurs = fahrtKurs();
  if(kurs == null) return 'kein Fahrtkurs in der Spur — Windlage nicht erzwingbar';
  const dreh = { gegen: 0, seite: 90, ruecken: 180 }[was];
  if(was === 'flaute'){ WX_OVERRIDE = { speed: 3, dir: kurs }; }
  else if(dreh == null) return "unbekannt — 'demo', 'gegen', 'ruecken', 'seite', 'flaute', 'frei' oder 'off'";
  else WX_OVERRIDE = { speed: 24, dir: (kurs + dreh) % 360 };
  WIND_DEMO = true;
  render();
  return `Windlage erzwungen: ${was}`;
};
/* Die Grußwand zum Ausprobieren, solange kein Worker eingerichtet ist:
     tcr84Zurufe('demo')      Wand mit erfundenen Zurufen
     tcr84Zurufe('leer')      den Leer-Zustand ansehen
     tcr84Zurufe('lang')      ein Zuruf über die vollen 180 Zeichen — passt er?
     tcr84Zurufe('boese')     Skript-Versuche, Anführungszeichen, Apostroph
     tcr84Zurufe('loeschen')  Löschknöpfe einblenden, ohne Token im Hash
     tcr84Zurufe('halt')      Rotation an/aus
     tcr84Zurufe('frei')      die Sechs-Stunden-Sperre zum Schreiben aufheben
     tcr84Zurufe('off')       alles zurück
   'boese' ist der wichtigste davon und hat im Board kein Vorbild: ein Hook,
   der eine Sicherheitseigenschaft in einer Zeile nachprüfbar macht. Erwartet
   wird, dass alles als sichtbarer TEXT dasteht — kein Alert, kein zerrissenes
   Layout, und das data-k des Löschknopfs unbeschädigt. Nach jeder Änderung an
   zurufKarte() einmal laufen lassen.
   Die erfundenen Zurufe bleiben ausdrücklich im Testmodus: sobald ZURUF.api
   steht, kommen sie vom Worker, und niemand sieht je eine Fantasiewand. */
const ZURUF_DEMOS = [
  { t:'Zieh durch, Manuel! Wir schauen jeden Morgen als Erstes hier rein.', n:'Familie Kaufer' },
  { t:'Die Auffahrt gestern war brutal. Respekt.', n:'Jonas' },
  { t:'Rückenwind aus Leipzig! 💪', n:'Steffi' },
  { t:'Denk an die Pausen. Der Puffer ist da, damit du ihn benutzt.', n:'Doc' },
  { t:'Bin 2024 dieselbe Ecke gefahren — nach dem Pass wird es endlich flach. Halte durch, das Schlimmste liegt hinter dir und der Rest ist Genuss.', n:'Andi' },
  { t:'Kaffee und Kuchen stehen bereit, wenn du zurück bist.', n:'' },
  { t:'Cap 84 forever.', n:'ein Dotwatcher' },
  { t:'Meine Klasse verfolgt dich auf der Karte. Die Kinder fragen jeden Tag, wo du jetzt bist.', n:'Frau Berger' },
];
window.tcr84Zurufe = was=>{
  const setzen = (liste)=>{
    const jetzt = Date.now();
    ZURUF_N = { list: liste.map((z,i)=> ({ ...z, k:`k:${jetzt-i*900000}-demo${String(i).padStart(2,'0')}`,
                                           ts: jetzt - i*900000 })), da:true };
    ZURUF_IDX = 0; ZURUF_DEMO = true; render();
  };
  if(!was || was === 'off'){
    ZURUF_DEMO = false; ZURUF_ZEIG_DEL = false; ZURUF_HAND = false;
    ZURUF_N = { list: [], da: false }; ZURUF_IDX = 0;
    zurufFormular(false); render(); zurufeLaden();
    return 'Zuruf-Demo aus.';
  }
  if(was === 'demo'){ setzen(ZURUF_DEMOS); return `Zuruf-Demo an (${ZURUF_DEMOS.length} erfundene Zurufe).`; }
  if(was === 'leer'){ setzen([]); return 'Leer-Zustand. So sieht die Wand aus, bevor jemand schreibt.'; }
  if(was === 'lang'){
    // Auf exakt maxText aufgefüllt, nicht „ungefähr lang“: die min-height im
    // CSS ist auf genau diese Länge gerechnet, ein 140-Zeichen-Test würde sie
    // bestehen und die eigentliche Frage offenlassen.
    let t = 'Wir denken jeden Tag an dich und verfolgen jede Etappe. Der Berg gestern war der schwerste, ab hier wird es leichter — halte durch, du schaffst das, und wir warten hier auf dich';
    t = (t + ' ' + 'x'.repeat(ZURUF.maxText)).slice(0, ZURUF.maxText);
    setzen([{ t, n:'Maximallänge' }]);
    return `Ein Zuruf mit ${t.length} Zeichen (das Maximum). Bei 360 px Breite prüfen: passt er in die min-height, ohne dass der Kasten wächst?`;
  }
  if(was === 'boese'){
    setzen([
      { t:'<img src=x onerror=alert(1)>', n:'<b>fett?</b>' },
      { t:'"><script>alert(1)</script>', n:'" onmouseover="alert(1)' },
      { t:"' onclick='alert(1)", n:"O'Brien" },
      { t:'Anführungszeichen: " " " und & und < >', n:'&amp;' },
      { t:'‮reversed text‬', n:'RTL' },
    ]);
    return 'Fünf Angriffsversuche als Zurufe. Erwartet: alles als Text sichtbar, kein Alert, Layout heil, data-k intakt.';
  }
  if(was === 'loeschen'){
    ZURUF_ZEIG_DEL = !ZURUF_ZEIG_DEL; render();
    return ZURUF_ZEIG_DEL
      ? 'Löschknöpfe an (nur zur Ansicht — ohne echtes Token löscht der Worker nichts).'
      : 'Löschknöpfe aus.';
  }
  if(was === 'halt'){
    ZURUF_HAND = !ZURUF_HAND; renderZurufe();
    return ZURUF_HAND ? 'Rotation angehalten.' : 'Rotation läuft wieder.';
  }
  if(was === 'frei'){
    try{ localStorage.removeItem(ZURUF_SPERRE_KEY); }catch(e){}
    zurufSperreAnzeige();
    return 'Sperre aufgehoben — der Knopf geht wieder.';
  }
  return "unbekannt — 'demo', 'leer', 'lang', 'boese', 'loeschen', 'halt', 'frei' oder 'off'";
};
/* Die Overlay-Stimmung um die Jetzt-Zeile erzwingen, ohne aufs passende
   Wetter zu warten:
     tcr84Wetter('sonne')  klarer Tag, Sonnenschimmer
     tcr84Wetter('regen')  Regenstreifen
     tcr84Wetter('nacht')  Sterne + Mond
     tcr84Wetter('klar')   weder noch (bewölkter Tag)
     tcr84Wetter('off')    zurück auf den gemessenen Zustand
   Setzt voraus, dass das Wetter schon einmal geladen hat — ohne WX gibt es
   keine Zeile, an die sich die Stimmung hängen könnte. */
window.tcr84Wetter = was=>{
  if(!was || was === 'off'){ WX_SCENE_OVERRIDE = null; renderWeather(); return 'Wetter-Overlay: automatisch.'; }
  const szenen = {
    sonne:{night:false,raining:false,sunny:true},
    regen:{night:false,raining:true,sunny:false},
    nacht:{night:true,raining:false,sunny:false},
    klar:{night:false,raining:false,sunny:false},
  };
  const s = szenen[was];
  if(!s) return "unbekannt — 'sonne', 'regen', 'nacht', 'klar' oder 'off'";
  WX_SCENE_OVERRIDE = s;
  renderWeather();
  return 'Wetter-Overlay erzwungen: ' + was;
};

function render(){
  const c = compute();
  renderMetrics(c); renderLive(c); renderLadder(c); renderProfile(c); renderDays(c);
  renderZurufe();   // ohne c — die Zurufe haben mit dem Rennstand nichts zu tun
  renderFerry(c); renderFuel(c); renderWerkstatt(c); renderWind(); renderLog(c); renderSource(c);
  maybeLoadWeather(c);
  maybeCelebrate(c);
  maybeHinweis();   // nach der Feier: ein echter Kontrollpunkt hat Vorrang
  if(EDIT) renderDirty();
  if(mapObj && document.getElementById('mapDetails').open) renderMap(c);
}

/* ---------- Bearbeiten ---------- */
function buildEditor(){
  document.getElementById('editArea').innerHTML = `
    <div class="editbox">
      <div class="eyebrow" style="margin-bottom:12px">Position melden</div>
      <div class="form">
        <div><label for="fTime">Zeitpunkt</label><input id="fTime" type="datetime-local"></div>
        <div><label for="fKm">Gesamt-km</label><input id="fKm" type="number" step="1" min="0" inputmode="numeric" placeholder="620"></div>
        <div><label for="fPlace">Ort</label><input id="fPlace" type="text" placeholder="Flåm"></div>
        <div><label for="fNote">Notiz</label><input id="fNote" type="text" placeholder="CP1 gestempelt, Regen"></div>
        <div><button id="add">Eintragen</button></div>
      </div>
      <div class="msg" id="msg"></div>
      <div id="dirty"></div>
      <div class="btnrow">
        <button id="copyJson" class="ghost">data.json kopieren</button>
        <button id="copyLink" class="ghost">Teil-Link kopieren</button>
        <button id="showJson" class="ghost">JSON anzeigen</button>
      </div>
      <textarea id="jsonOut" style="display:none" readonly></textarea>
    </div>

    <details>
      <summary>Renn-Parameter</summary>
      <div class="setbody">
        <p style="font-size:13px;color:var(--muted);margin:12px 0 0">
          Kilometer der Kontrollpunkte sind Schätzungen, TCR hat freie Routenwahl. Sobald die echte Route bekannt ist, hier korrigieren.
        </p>
        <div class="setgrid" id="settings"></div>
        <div class="btnrow">
          <button id="saveSet">Parameter übernehmen</button>
          <button id="reset" class="ghost">Alles zurücksetzen</button>
        </div>
      </div>
    </details>`;

  document.getElementById('add').onclick = addEntry;
  document.getElementById('copyJson').onclick = ()=> copy(JSON.stringify(payload(), null, 2), 'data.json kopiert. Jetzt im Repo ersetzen.');
  document.getElementById('copyLink').onclick = ()=>{
    const base = location.origin + location.pathname;
    copy(base + '#d=' + packLink(payload()), 'Teil-Link kopiert. Der zeigt genau diesen Stand.');
  };
  document.getElementById('showJson').onclick = ()=>{
    const t = document.getElementById('jsonOut');
    t.style.display = t.style.display==='none' ? 'block' : 'none';
    t.value = JSON.stringify(payload(), null, 2);
  };
  document.getElementById('saveSet').onclick = async ()=>{
    const st = S.settings;
    st.totalKm = Number(document.getElementById('sTotal').value)||st.totalKm;
    st.start = document.getElementById('sStart').value || st.start;
    st.deadline = document.getElementById('sDl').value || st.deadline;
    st.cps.forEach((c,i)=>{ const v=document.getElementById('sCp'+i).value; if(v!=='') c.km=Number(v); });
    DIRTY = true; await store.set(JSON.stringify(S)); renderSettings(); render();
  };
  document.getElementById('reset').onclick = async ()=>{
    if(!confirm('Alle Meldungen und Parameter löschen?')) return;
    S = { settings: structuredClone(DEFAULTS), entries: [] };
    DIRTY = true; await store.del(); renderSettings(); render();
  };
  renderSettings(); setNow();
}
function payload(){ return { settings:S.settings, entries:S.entries, updated:new Date().toISOString() }; }
function copy(text, ok){
  navigator.clipboard.writeText(text).then(
    ()=> note(ok),
    ()=> { const t=document.getElementById('jsonOut'); t.style.display='block'; t.value=text; t.select();
           note('Zwischenablage blockiert. Text steht unten, von Hand kopieren.', true); }
  );
}
function note(t, err){
  const m = document.getElementById('msg');
  if(!m) return;
  m.textContent = t||''; m.className = 'msg' + (err?' err':'');
}
function renderDirty(){
  const d = document.getElementById('dirty');
  if(!d) return;
  d.innerHTML = DIRTY
    ? `<div style="border-left:3px solid var(--brass);padding:8px 12px;margin-top:12px;background:var(--panel2);font-size:13.5px">
         Geändert, aber noch nicht veröffentlicht. Der Fanclub sieht den neuen Stand erst nach
         <em>data.json kopieren</em> und Ersetzen im Repo.</div>`
    : '';
}
function renderSettings(){
  const st = S.settings;
  const f = (id,l,v,t='text') => `<div><label for="${id}">${esc(l)}</label><input id="${id}" type="${t}" value="${esc(v)}"></div>`;
  const el = document.getElementById('settings'); if(!el) return;
  el.innerHTML = f('sTotal','Gesamtstrecke km',st.totalKm,'number') +
    f('sStart','Start',st.start,'datetime-local') + f('sDl','Zeitlimit',st.deadline,'datetime-local') +
    st.cps.map((c,i)=> f('sCp'+i, c.nm+' km', c.km, 'number')).join('');
}
function setNow(){
  const d = new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  const el = document.getElementById('fTime'); if(el) el.value = d.toISOString().slice(0,16);
}
async function addEntry(){
  note('');
  const ts = document.getElementById('fTime').value;
  const km = document.getElementById('fKm').value;
  if(!ts){ note('Zeitpunkt fehlt.', true); return; }
  if(km==='' || isNaN(Number(km))){ note('Kilometerstand fehlt.', true); return; }
  const prev = sorted().filter(e=> new Date(e.ts) <= new Date(ts)).pop();
  if(prev && Number(km) < Number(prev.km)){
    note('Der Stand liegt unter der Meldung davor. Rückwärts geht es im Rennen nicht, bitte prüfen.', true); return;
  }
  S.entries.push({ id:String(Date.now()), ts, km:Number(km),
    place:document.getElementById('fPlace').value.trim(),
    note:document.getElementById('fNote').value.trim() });
  DIRTY = true;
  await store.set(JSON.stringify(S));
  ['fKm','fPlace','fNote'].forEach(i=> document.getElementById(i).value='');
  setNow(); render();
  note('Eingetragen. Zum Veröffentlichen data.json kopieren.');
}

/* ---------- Start ---------- */
(async function init(){
  await loadAll();
  await loadProfile();
  if(EDIT){
    // im Bearbeiten-Modus haben lokale, ungespeicherte Änderungen Vorrang vor data.json
    try{
      const raw = await store.get();
      if(raw){ const local = JSON.parse(raw);
        if((local.entries||[]).length >= S.entries.length){ adopt(local); SOURCE = 'lokal'; DIRTY = true; } }
    }catch(e){}
    buildEditor();
  }
  render();
  if(document.getElementById('mapDetails').open) checkMapDetails();
  setInterval(render, 60000);
  /* Anders als windLaden() bewusst AUSSERHALB von if(!EDIT): der Besitzer
     löscht von derselben Seite, auf der er bearbeitet. Die Wand im
     Bearbeiten-Modus abzuschalten hieße, das Löschtoken ausgerechnet dort
     wirkungslos zu machen, wo er sitzt. */
  zurufeLaden();
  if(!EDIT){
    setInterval(async ()=>{ if(await loadRemote()) render(); }, 300000);
    // Profil in eigenem, langsamerem Takt — es ist die größte Datei und
    // ändert sich nur, wenn eine neue Stunde Fahrt ausgewertet wurde.
    setInterval(async ()=>{ if(await loadProfile()) render(); }, 900000);
    /* Die Spur erst NACH dem ersten Zeichnen, aber ohne auf die Karte zu
       warten: sie liefert die Pausenzeilen im Log, und die beantworten die
       Frage, warum das Log stundenlang stillsteht. Die mobile Startansicht
       bleibt trotzdem leicht — der erste Rendergang läuft ohne sie. */
    refreshTrack().then(ok=>{ if(ok) render(); });
    setInterval(async ()=>{ if(await refreshTrack()) render(); }, 900000);
    // Der Zählerstand ist unabhängig von allem anderen und darf den ersten
    // Rendergang nicht aufhalten — der Streifen steht auch ohne ihn schon da.
    windLaden();
  }
})();
