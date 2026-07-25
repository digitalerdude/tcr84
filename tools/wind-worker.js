/**
 * Rückenwind-Zähler für das tcr84-Dotwatch-Board.
 *
 * Das Board liegt auf GitHub Pages und kann nichts entgegennehmen — jeder
 * geteilte Zähler braucht deshalb eine Stelle außerhalb. Das hier ist diese
 * Stelle, und sie tut mit Absicht genau eine Sache: eine Zahl hochzählen und
 * herausgeben. Keine Nutzer, keine Sitzungen, keine personenbezogenen Daten;
 * die IP wird nur als Bremse gegen Massenklicks benutzt und nie gespeichert
 * (der Schlüssel ist ein Hash davon und verfällt nach drei Stunden von selbst).
 *
 * ── EINRICHTEN (Cloudflare-Dashboard, kein CLI nötig) ────────────────────────
 *  1. Kostenlosen Account auf dash.cloudflare.com anlegen.
 *  2. Storage & Databases → KV → "Create a namespace", Name: `tcr84-wind`.
 *  3. Compute (Workers) → "Create" → "Start from Hello World" → Name z. B.
 *     `tcr84-wind`, dann "Deploy" und anschließend "Edit code":
 *     den gesamten Inhalt dieser Datei einfügen und "Deploy" drücken.
 *  4. Im Worker → Settings → "Bindings" → "Add binding" → KV namespace:
 *       Variable name: WIND          Namespace: tcr84-wind
 *     Speichern (der Worker startet danach neu).
 *  5. Die Worker-URL kopieren (Form: https://tcr84-wind.<subdomain>.workers.dev)
 *     und in index.html bei `WIND.api` eintragen. Fertig.
 *
 * Prüfen lässt sich das ohne Board:
 *     curl https://tcr84-wind.<subdomain>.workers.dev        → {"total":0,...}
 *     curl -X POST https://tcr84-wind.<subdomain>.workers.dev → {"total":1,...}
 *
 * ── WAS ES BEWUSST NICHT KANN ───────────────────────────────────────────────
 * KV ist am selben Schlüssel auf rund einen Schreibvorgang pro Sekunde
 * begrenzt und kennt kein atomares "lies, erhöhe, schreib". Klicken zwei
 * Leute in derselben Sekunde, kann eine Böe verlorengehen. Für einen
 * Spaßzähler ist das der richtige Tausch: Durable Objects wären atomar,
 * brauchen aber wrangler und eine Konfigurationsdatei, und der Gegenwert
 * wäre eine Böe, die niemand vermisst.
 */

const ERLAUBTE_ORIGINS = [
  'https://digitalerdude.github.io',
  'http://localhost:8731',
  'http://127.0.0.1:8731',
];

/* Feste +02:00 statt einer Zeitzonen-Bibliothek: das Rennen (19.07.–08.08.2026)
   liegt vollständig in der Sommerzeit, und der Tageswechsel des Zählers soll
   dort liegen, wo Manuel und die Zuschauer ihn erleben — nicht um 2 Uhr früh
   in UTC. Für ein Rennen über den Zeitumstellungstermin müsste das anders
   gelöst werden; dieselbe Einschränkung steht so im Wächter-Workflow. */
function heuteKey() {
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  return 'tag:' + d.toISOString().slice(0, 10);
}

async function ipHash(ip, salt) {
  const buf = new TextEncoder().encode(salt + '|' + ip);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest).slice(0, 10)]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function korsHeaders(origin) {
  const erlaubt = ERLAUBTE_ORIGINS.includes(origin) ? origin : ERLAUBTE_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': erlaubt,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const json = (obj, status, kors) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...kors },
});

/* Pro IP und Drei-Stunden-Fenster. Großzügig angesetzt (nicht 1), weil hinter
   einer IP eine ganze Familie, ein Büro oder ein Mobilfunk-NAT stecken kann —
   das clientseitige Drei-Stunden-Limit im Board ist die eigentliche Spielregel,
   das hier ist nur die Grenze gegen jemanden mit einer Schleife im Terminal. */
const MAX_PRO_IP = 20;
const FENSTER_SEK = 3 * 3600;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const kors = korsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: kors });
    if (!env.WIND) return json({ error: 'KV-Binding WIND fehlt — siehe Schritt 4' }, 500, kors);

    const tagKey = heuteKey();

    if (request.method === 'GET') {
      const [total, heute] = await Promise.all([
        env.WIND.get('total'),
        env.WIND.get(tagKey),
      ]);
      return json({ total: Number(total) || 0, heute: Number(heute) || 0 }, 200, kors);
    }

    if (request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unbekannt';
      // Das Salz macht die Hashes an diesen Zähler gebunden — ohne es lässt
      // sich aus einem Schlüssel nicht auf eine IP zurückrechnen.
      const rlKey = 'rl:' + await ipHash(ip, 'tcr84-rueckenwind');
      const bisher = Number(await env.WIND.get(rlKey)) || 0;

      const [totalRoh, heuteRoh] = await Promise.all([
        env.WIND.get('total'),
        env.WIND.get(tagKey),
      ]);
      const total = Number(totalRoh) || 0;
      const heute = Number(heuteRoh) || 0;

      if (bisher >= MAX_PRO_IP) {
        return json({ total, heute, gebremst: true }, 429, kors);
      }

      // Der Tageszähler bekommt eine TTL von zwei Tagen: er wird nur am
      // laufenden Tag gelesen, und so räumt sich der Namespace von selbst auf,
      // statt über drei Wochen 21 tote Schlüssel anzusammeln.
      await Promise.all([
        env.WIND.put('total', String(total + 1)),
        env.WIND.put(tagKey, String(heute + 1), { expirationTtl: 2 * 86400 }),
        env.WIND.put(rlKey, String(bisher + 1), { expirationTtl: FENSTER_SEK }),
      ]);

      return json({ total: total + 1, heute: heute + 1 }, 200, kors);
    }

    return json({ error: 'nur GET und POST' }, 405, kors);
  },
};
