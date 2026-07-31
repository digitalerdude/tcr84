/**
 * Zurufe — die Grußwand des tcr84-Dotwatch-Boards.
 *
 * Geschwister von `wind-worker.js`, und aus demselben Grund vorhanden: das
 * Board liegt auf GitHub Pages und kann nichts entgegennehmen. Der Rückenwind
 * sammelt eine Zahl, das hier sammelt Sätze — und ein Satz mit Namen ist das,
 * was bei Manuel wirklich ankommt.
 *
 * Keine Nutzer, keine Sitzungen, keine personenbezogenen Daten. Die IP wird nur
 * als Bremse benutzt und nie gespeichert (der Schlüssel ist ein Hash davon und
 * verfällt von selbst). Der Name ist das, was jemand ins Feld getippt hat, und
 * wird nirgends geprüft — ein Name ist hier keine Identität, sondern eine
 * Unterschrift unter einen Gruß.
 *
 * Jeder Zuruf verfällt nach 48 Stunden. Das ist keine Aufräumroutine, sondern
 * der Zweck: Manuel soll Frisches lesen, kein Gästebuch abarbeiten — und was
 * schiefgeht, räumt sich selbst weg.
 *
 * ── EINRICHTEN (Cloudflare-Dashboard, kein CLI nötig) ────────────────────────
 *  1. Kostenlosen Account auf dash.cloudflare.com anlegen (oder den vom
 *     Rückenwind-Zähler weiterbenutzen).
 *  2. Storage & Databases → KV → "Create a namespace", Name: `tcr84-zurufe`.
 *  3. Compute (Workers) → "Create" → "Start from Hello World" → Name z. B.
 *     `tcr84-zurufe`, dann "Deploy" und anschließend "Edit code":
 *     den gesamten Inhalt dieser Datei einfügen und "Deploy" drücken.
 *  4. Im Worker → Settings → "Bindings" → "Add binding" → KV namespace:
 *       Variable name: ZURUFE        Namespace: tcr84-zurufe
 *     Speichern (der Worker startet danach neu).
 *  5. Im Worker → Settings → "Variables and Secrets" → "Add" → Typ **Secret**,
 *     Name `ZURUF_TOKEN`, Wert aus `openssl rand -hex 16`. Dieser Wert kommt
 *     NICHT ins Repo. Er wandert in ein privates Lesezeichen:
 *       https://digitalerdude.github.io/tcr84/#zuruf=<Token>
 *     Damit — und nur damit — erscheinen im Board die Löschknöpfe.
 *  6. Die Worker-URL kopieren (Form: https://tcr84-zurufe.<subdomain>.workers.dev)
 *     und in app.js bei `ZURUF.api` eintragen. Fertig.
 *
 * Prüfen lässt sich das ohne Board:
 *     curl https://tcr84-zurufe.<subdomain>.workers.dev
 *       → {"zurufe":[],"n":0,...}
 *     curl -X POST https://tcr84-zurufe.<subdomain>.workers.dev \
 *          -H 'Content-Type: application/json' -d '{"t":"Hau rein!","n":"Max"}'
 *       → {"ok":true,"zuruf":{"k":"k:...","t":"Hau rein!","n":"Max","ts":...}}
 *     curl -X DELETE https://tcr84-zurufe.<subdomain>.workers.dev \
 *          -H 'Content-Type: application/json' -d '{"k":"k:...","token":"<Token>"}'
 *       → {"ok":true,"k":"k:..."}
 *
 * ── WAS ES BEWUSST NICHT KANN ───────────────────────────────────────────────
 * · Keine Vorprüfung, keine Warteschlange, kein Wortfilter. Die 48 Stunden SIND
 *   die Moderation, der Löschweg ist der Notausgang. Eine deutsche Wortliste
 *   wäre entweder zu kurz, um zu greifen, oder lang genug, um "Scheiß Gegenwind
 *   heute, halt durch!" wegzufiltern — und genau solche Sätze gehören dorthin.
 * · `list()` ist eventual consistent, bis zu ~60 Sekunden. Ein gerade
 *   geschriebener Zuruf kann im nächsten GET noch fehlen. Das ist KV, kein
 *   Fehler; das Board hält eigene Zurufe deshalb kurz lokal fest.
 * · Keine Paginierung, `limit:200`. Wer in 48 Stunden 200 Zurufe bekommt, hat
 *   ein schöneres Problem, als diese Datei löst.
 * · Kein Bearbeiten. Ein Zuruf ist da oder weg.
 * · Metadaten sind bei 1024 Bytes hart gedeckelt — siehe unten, das ist der
 *   physische Grund für die 180 Zeichen.
 * · Gelöschtes verschwindet für jemanden, der die Seite schon offen hat, erst
 *   beim nächsten Abruf (2 Minuten).
 * · Das Token steht im URL-Fragment. Fragmente gehen NIE an einen Server —
 *   deshalb der Hash und keine Query. Es steht dafür in der Browser-History und
 *   auf jedem geteilten Bildschirm: Schutz gegen Fremde, nicht gegen
 *   Über-die-Schulter-Schauen. Wechseln heißt Secret im Dashboard ändern; alte
 *   Lesezeichen hören dann auf zu wirken, und das ist die ganze Prozedur.
 */

const ERLAUBTE_ORIGINS = [
  'https://digitalerdude.github.io',
  'http://localhost:8731',
  'http://127.0.0.1:8731',
];

const MAX_TEXT = 180;         // muss zu ZURUF.maxText in app.js passen
const MAX_NAME = 20;          // dito ZURUF.maxName
const TTL_SEK = 48 * 3600;    // Halbwertszeit eines Zurufs
const MAX_BODY = 4096;        // Byte, bevor überhaupt gelesen wird
const MAX_META = 900;         // Byte, mit Luft unter KVs harter 1024-Grenze
const LISTE_MAX = 200;

/* Pro IP und Stunde. Der Rückenwind-Zähler darf mit 20 pro 3 h locker sitzen —
   ein Klick kostet nichts. Ein Zuruf kostet die Bildschirmzeit aller anderen:
   fünf in einer Stunde sind für eine Person schon ungewöhnlich viel Tipperei,
   und hinter einer IP kann trotzdem eine Familie oder ein Mobilfunk-NAT
   stecken, deshalb nicht 1. Es ist eine Bremse gegen eine Schleife im
   Terminal, kein Kontingent für Begeisterung. */
const MAX_PRO_IP = 5;
const FENSTER_SEK = 3600;

/* Anderes Salz als der Rückenwind-Zähler, und das ist kein Detail: mit
   demselben ließen sich die Hashes beider Namespaces gegeneinander abgleichen
   und derselbe Besucher über zwei Funktionen hinweg wiedererkennen. Getrennte
   Salze machen das unmöglich, statt es nur zu unterlassen. */
const SALZ = 'tcr84-zurufe';

async function ipHash(ip) {
  const buf = new TextEncoder().encode(SALZ + '|' + ip);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest).slice(0, 10)]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function korsHeaders(origin) {
  const erlaubt = ERLAUBTE_ORIGINS.includes(origin) ? origin : ERLAUBTE_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': erlaubt,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const json = (obj, status, kors) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...kors },
});

/* Vergleich in konstanter Zeit. Ein `===` auf Zeichenketten bricht beim ersten
   Unterschied ab und verrät damit über die Antwortzeit, wie viele Zeichen
   stimmten. Das ist hier keine reale Bedrohung — aber es kostet vier Zeilen
   und nimmt eine ganze Frageklasse vom Tisch, statt sie beantworten zu müssen. */
function gleichKonstant(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Ein Schlüssel JE ZURUF — niemals eine JSON-Liste unter einem Schlüssel.
   KV kennt kein atomares "lies, ändere, schreib" und schafft am selben
   Schlüssel rund einen Schreibvorgang pro Sekunde; `wind-worker.js`
   dokumentiert das selbst und nimmt es hin, weil eine verlorene Böe niemand
   vermisst. Hier wäre der Preis ein anderer: schreiben zwei Leute gleichzeitig,
   verschwände der KOMPLETTE Zuruf eines Fremden — still, während beide Absender
   ein "Geschickt!" gesehen haben. Getrennte Schlüssel haben das Problem nicht,
   und die 48 Stunden kommen dadurch je Zuruf gratis: kein Aufräumjob, den
   jemand vergessen könnte laufen zu lassen.

   Die Zufallsendung hinter der Millisekunde ist Teil davon — ohne sie teilen
   sich zwei Zurufe aus derselben Millisekunde einen Schlüssel, also derselbe
   Fehler eine Größenordnung tiefer wieder eingebaut.

   13-stellige Millisekunden sortieren lexikographisch = chronologisch (und tun
   das bis ins Jahr 2286). Kein `padStart` nötig; wer eins einbaut, baut nichts. */
function neuerSchluessel() {
  const r = [...crypto.getRandomValues(new Uint8Array(6))]
    .map(b => (b % 36).toString(36)).join('');
  return `k:${Date.now()}-${r}`;
}
const SCHLUESSEL_FORM = /^k:\d{13}-[a-z0-9]{6}$/;

/* Text säubern. Zwei Dinge daran sind Absicht:
   - Steuerzeichen fliegen ganz raus (unsichtbar, nur Ärger).
   - Whitespace wird zu einem einzigen Leerzeichen eingefaltet. Das killt
     gewollte Zeilenumbrüche — hingenommen: 180 Zeichen brauchen keinen Absatz,
     und ohne die Regel wäre ein Zuruf aus 180 Umbrüchen ein unsichtbarer
     Beitrag, der den Kasten im Board aufreißt. */
function saeubern(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/* Zeichenmaß und Bytemaß sind zwei verschiedene Lineale: der Besucher zählt
   Zeichen, KV zählt Bytes, und Umlaute und Emoji liegen dazwischen. 180
   Zeichen passen praktisch immer in die 1024 Bytes der Metadaten — praktisch
   ist aber nicht immer, deshalb hier der Rückfall, der byteweise kürzt. */
function metaPassend(meta) {
  const groesse = m => new TextEncoder().encode(JSON.stringify(m)).length;
  if (groesse(meta) <= MAX_META) return meta;
  let t = meta.t;
  while (t.length > 0 && groesse({ ...meta, t }) > MAX_META) t = t.slice(0, -1);
  return { ...meta, t };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const kors = korsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: kors });
    if (!env.ZURUFE) return json({ error: 'KV-Binding ZURUFE fehlt — siehe Schritt 4' }, 500, kors);

    /* ---------- lesen ---------- */
    if (request.method === 'GET') {
      // Ein einziger list()-Aufruf bedient den ganzen Abruf, weil die Nutzlast
      // in den Metadaten steckt und mitgeliefert wird. Läge sie im Wert, wären
      // das bei 40 Zurufen 40 zusätzliche get()-Aufrufe je Seitenaufruf.
      // Das Präfix hält die Rate-Limit-Schlüssel (rl:) draußen, die im selben
      // Namespace liegen.
      const res = await env.ZURUFE.list({ prefix: 'k:', limit: LISTE_MAX });
      const zurufe = res.keys
        .filter(k => k.metadata && typeof k.metadata.t === 'string')
        .map(k => ({ k: k.name, t: k.metadata.t, n: k.metadata.n || '', ts: k.metadata.ts || 0 }))
        .reverse();   // neueste zuerst
      return json({ zurufe, n: zurufe.length, stand: Date.now() }, 200, kors);
    }

    /* ---------- schreiben ---------- */
    if (request.method === 'POST') {
      // Der Längentest steht VOR dem Body-Lesen. Er ist der eigentliche Schutz
      // (Speicher), die Zeichenzahl weiter unten ist nur Kosmetik dagegen.
      const laenge = Number(request.headers.get('content-length') || 0);
      if (laenge > MAX_BODY) return json({ error: 'Zu viel Text' }, 400, kors);

      let body = null;
      try { body = await request.json(); } catch (e) { /* bleibt null */ }
      if (!body || typeof body !== 'object') return json({ error: 'Kein gültiger Zuruf' }, 400, kors);

      const t = saeubern(body.t, MAX_TEXT);
      const n = saeubern(body.n, MAX_NAME);
      if (!t) return json({ error: 'Leerer Zuruf' }, 400, kors);

      const ip = request.headers.get('CF-Connecting-IP') || 'unbekannt';
      const rlKey = 'rl:' + await ipHash(ip);
      const bisher = Number(await env.ZURUFE.get(rlKey)) || 0;
      if (bisher >= MAX_PRO_IP) {
        return json({ gebremst: true, error: 'Gleich mehrere Zurufe von hier — bitte später nochmal.' }, 429, kors);
      }

      const k = neuerSchluessel();
      const meta = metaPassend({ t, n, ts: Date.now() });
      await Promise.all([
        env.ZURUFE.put(k, '', { expirationTtl: TTL_SEK, metadata: meta }),
        env.ZURUFE.put(rlKey, String(bisher + 1), { expirationTtl: FENSTER_SEK }),
      ]);

      return json({ ok: true, zuruf: { k, ...meta } }, 201, kors);
    }

    /* ---------- löschen ---------- */
    if (request.method === 'DELETE') {
      // Das Token steht im Body, nicht in der URL: eine Query landet in
      // Cloudflares Request-Logs und in jedem Proxy dazwischen, ein Body nicht.
      // Content-Type ist ohnehin schon erlaubt, es kostet also keinen weiteren
      // Preflight-Header.
      let body = null;
      try { body = await request.json(); } catch (e) { /* bleibt null */ }
      if (!body || typeof body !== 'object') return json({ error: 'Kein gültiger Auftrag' }, 400, kors);
      if (!env.ZURUF_TOKEN) return json({ error: 'Secret ZURUF_TOKEN fehlt — siehe Schritt 5' }, 500, kors);
      if (!gleichKonstant(String(body.token || ''), env.ZURUF_TOKEN)) {
        return json({ error: 'Token stimmt nicht' }, 403, kors);
      }
      // Form prüfen, BEVOR gelöscht wird: sonst kann der Token-Inhaber
      // versehentlich einen rl:-Schlüssel oder eine künftige Schlüsselart
      // treffen, die zufällig im selben Namespace wohnt.
      const k = String(body.k || '');
      if (!SCHLUESSEL_FORM.test(k)) return json({ error: 'Schlüssel sieht nicht aus wie ein Zuruf' }, 400, kors);

      await env.ZURUFE.delete(k);
      return json({ ok: true, k }, 200, kors);
    }

    return json({ error: 'nur GET, POST und DELETE' }, 405, kors);
  },
};
