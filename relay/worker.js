// 3D sky relay
//
// Web browsers are not allowed to read the free flight networks directly, because those networks do not give web pages
// that permission. This relay is the go-between: the 3D sky page asks the relay, the relay asks the flight network, and
// the relay hands the answer back with the permission a browser needs.
//
// It runs as a Cloudflare Worker on the free plan. It only passes on three kinds of question (aircraft around a point,
// one flight by callsign, one aircraft by registration), so it cannot be used to reach anything else.

const NETWORKS = ['https://api.adsb.lol', 'https://api.airplanes.live'];
const ALLOWED = /^\/v2\/(point\/-?\d{1,2}(\.\d{1,4})?\/-?\d{1,3}(\.\d{1,4})?\/\d{1,3}|callsign\/[A-Za-z0-9]{2,8}|reg\/[A-Za-z0-9-]{2,8})$/;
const OPEN = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' };

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: OPEN });
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('3D sky relay is running.', { headers: { ...OPEN, 'Content-Type': 'text/plain; charset=utf-8' } });
    if (request.method !== 'GET' || !ALLOWED.test(url.pathname)) return new Response('Not found', { status: 404, headers: OPEN });

    // Several people watching the same sky share one answer for a few seconds, which goes easy on the flight network.
    const key = new Request('https://sky3d-relay.invalid' + url.pathname), cache = caches.default;
    const kept = await cache.match(key);
    if (kept) return kept;

    for (const network of NETWORKS) {
      try {
        const answer = await fetch(network + url.pathname, { headers: { Accept: 'application/json', 'User-Agent': '3d-sky-relay (github.com/Deaconcg65/sky3d)' } });
        if (!answer.ok) continue;
        const out = new Response(await answer.text(), { headers: { ...OPEN, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=4' } });
        ctx.waitUntil(cache.put(key, out.clone()));
        return out;
      } catch (e) { /* try the next network */ }
    }
    return new Response('{"error":"The flight networks did not answer."}', { status: 502, headers: { ...OPEN, 'Content-Type': 'application/json; charset=utf-8' } });
  },
};
