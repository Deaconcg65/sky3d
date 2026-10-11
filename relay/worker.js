// 3D sky relay, version 2
//
// Web browsers are not allowed to read the free flight networks directly, because those networks do not give web pages
// that permission. This relay is the go-between: the 3D sky page asks the relay, the relay asks a flight network, and
// the relay hands the answer back with the permission a browser needs.
//
// It runs as a Cloudflare Worker on the free plan. It only passes on three kinds of question (aircraft around a point,
// one flight by callsign, one aircraft by registration), so it cannot be used to reach anything else.
// Opening the relay's address followed by /check shows which flight networks are answering it.

const NETWORKS = [
  { name: 'adsb.lol', point: (a, o, r) => `https://api.adsb.lol/v2/point/${a}/${o}/${r}`, callsign: (c) => `https://api.adsb.lol/v2/callsign/${c}`, reg: (c) => `https://api.adsb.lol/v2/reg/${c}` },
  { name: 'adsb.fi', point: (a, o, r) => `https://opendata.adsb.fi/api/v2/lat/${a}/lon/${o}/dist/${r}`, callsign: (c) => `https://opendata.adsb.fi/api/v2/callsign/${c}`, reg: (c) => `https://opendata.adsb.fi/api/v2/registration/${c}` },
  { name: 'airplanes.live', point: (a, o, r) => `https://api.airplanes.live/v2/point/${a}/${o}/${r}`, callsign: (c) => `https://api.airplanes.live/v2/callsign/${c}`, reg: (c) => `https://api.airplanes.live/v2/reg/${c}` },
  { name: 'adsb.one', point: (a, o, r) => `https://api.adsb.one/v2/point/${a}/${o}/${r}`, callsign: (c) => `https://api.adsb.one/v2/callsign/${c}`, reg: (c) => `https://api.adsb.one/v2/reg/${c}` },
];
const POINT = /^\/v2\/point\/(-?\d{1,2}(?:\.\d{1,4})?)\/(-?\d{1,3}(?:\.\d{1,4})?)\/(\d{1,3})$/;
const CALLSIGN = /^\/v2\/callsign\/([A-Za-z0-9]{2,8})$/;
const REG = /^\/v2\/reg\/([A-Za-z0-9-]{2,8})$/;
const OPEN = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' };
const ASK = { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; 3d-sky-relay; +https://github.com/Deaconcg65/sky3d)' } };
const json = (body, status = 200, extra = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body, null, 1), { status, headers: { ...OPEN, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
let best = 0;   // the network that answered last time is asked first next time

async function ask(address) {
  const started = Date.now();
  try {
    const answer = await fetch(address, { ...ASK, signal: AbortSignal.timeout(7000) });
    const text = await answer.text();
    let count = null; try { const d = JSON.parse(text); const list = d.ac || d.aircraft; if (Array.isArray(list)) count = list.length; } catch (e) { /* not a list of aircraft */ }
    return { ok: answer.ok && count !== null, status: answer.status, ms: Date.now() - started, aircraft: count, text };
  } catch (e) { return { ok: false, status: 0, ms: Date.now() - started, aircraft: null, text: String(e) }; }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: OPEN });
    const url = new URL(request.url), path = url.pathname;
    if (request.method !== 'GET') return new Response('Not found', { status: 404, headers: OPEN });
    if (path === '/') return new Response('3D sky relay is running.', { headers: { ...OPEN, 'Content-Type': 'text/plain; charset=utf-8' } });
    if (path === '/check') {   // which flight networks answer this relay, asked for the sky over New York
      const report = {};
      for (const n of NETWORKS) { const a = await ask(n.point('40.71', '-73.83', '5')); report[n.name] = { answered: a.ok, status: a.status, milliseconds: a.ms, aircraft: a.aircraft, says: a.ok ? '' : a.text.slice(0, 160) }; }
      return json(report);
    }
    let m, make;
    if ((m = path.match(POINT))) make = (n) => n.point(m[1], m[2], m[3]);
    else if ((m = path.match(CALLSIGN))) make = (n) => n.callsign(m[1].toUpperCase());
    else if ((m = path.match(REG))) make = (n) => n.reg(m[1].toUpperCase());
    else return new Response('Not found', { status: 404, headers: OPEN });

    // Several people watching the same sky share one answer for a few seconds, which goes easy on the flight networks.
    const key = new Request('https://sky3d-relay.invalid' + path), cache = caches.default;
    const kept = await cache.match(key);
    if (kept) return kept;

    const tried = [];
    for (let i = 0; i < NETWORKS.length; i++) {
      const index = (best + i) % NETWORKS.length, n = NETWORKS[index], a = await ask(make(n));
      if (a.ok) {
        best = index;
        const out = json(a.text, 200, { 'Cache-Control': 'public, max-age=4', 'X-Flight-Network': n.name });
        ctx.waitUntil(cache.put(key, out.clone()));
        return out;
      }
      tried.push(n.name + ' ' + a.status);
    }
    return json({ error: 'The flight networks did not answer.', tried }, 502);
  },
};
