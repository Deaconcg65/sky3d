// Checks the relay as a front door: what an outsider can and cannot reach, that the antenna's location clues are removed,
// that pages on other sites are refused, and that the limits hold.
// Run with the stand-in receiver and the relay going:
//   SIM_SITE=1 node tools/sim.js 8090
//   SKY3D_WEB=http://127.0.0.1:8090 SKY3D_PAGE=build/sky3d-network.html SKY3D_RELAY_TEST=http://127.0.0.1:8090/mock python3 relay/relay.py
const http = require('http'), net = require('net'), os = require('os'), zlib = require('zlib');
const PORT = +(process.argv[2] || 8099), SIM = +(process.argv[3] || 8090);
const get = (path, headers = {}, port = PORT, method = 'GET') => new Promise((done) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: Object.assign({ Host: 'sky.example' }, headers) }, (res) => {
    const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => {
      let body = Buffer.concat(parts); if (res.headers['content-encoding'] === 'gzip' && body.length) { try { body = zlib.gunzipSync(body); } catch (e) { /* leave as is */ } }
      done({ status: res.statusCode, headers: res.headers, text: body.toString('utf8'), bytes: Buffer.concat(parts).length });
    });
  });
  req.on('error', (e) => done({ status: 0, headers: {}, text: String(e), bytes: 0 })); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// sends bytes exactly as given, for requests no well-behaved program would write
const raw = (text) => new Promise((done) => { let got = ''; const c = net.connect(PORT, '127.0.0.1', () => c.write(text)); c.on('data', (d) => got += d); c.on('close', () => done(got)); c.on('error', () => done(got)); setTimeout(() => c.destroy(), 4000); });
const lanAddress = () => { for (const list of Object.values(os.networkInterfaces())) for (const a of list) if (a.family === 'IPv4' && !a.internal) return a.address; return null; };
const getFrom = (host, path, headers = {}) => new Promise((done) => { const req = http.request({ host, port: PORT, path, headers }, (res) => { let t = ''; res.on('data', (c) => t += c); res.on('end', () => done({ status: res.statusCode, text: t })); }); req.on('error', (e) => done({ status: 0, text: String(e) })); req.end(); });
const FACTS = ['hex', 'type', 'flight', 'r', 't', 'desc', 'category', 'alt_baro', 'alt_geom', 'gs', 'tas', 'track', 'true_heading', 'baro_rate', 'geom_rate', 'lat', 'lon', 'seen', 'seen_pos', 'squawk', 'emergency'];
let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log((ok ? 'ok    ' : 'FAIL  ') + label + (detail ? '   ' + detail : '')); };
const OUT = { 'CF-Connecting-IP': '203.0.113.7' };   // what a request looks like when it arrives through the tunnel from outside

(async () => {
  // 1. what is reachable
  for (const [path, want] of [
    ['/', 302], ['/sky', 302], ['/sky/', 200], ['/robots.txt', 200],
    ['/tar1090/data/aircraft.json', 200], ['/tar1090/data/receiver.json', 200], ['/tar1090/chunks/chunks.json', 200], ['/tar1090/chunks/chunk_1.gz', 200],
    ['/tar1090/version.json', 200], ['/sky-relay/', 200], ['/sky-relay/v2/point/40.71/-73.83/60', 200], ['/sky-relay/v2/callsign/DAL2210', 200],
    // and what is not: the map page, other data, the test controls, tricks with the path
    ['/tar1090/', 404], ['/tar1090/index.html', 404], ['/tar1090/data/stats.json', 404], ['/tar1090/data/aircraft.json/../receiver.json', 404],
    ['/tar1090/chunks/..%2f..%2fdata%2freceiver.json', 404], ['/tar1090/chunks/../../ctl/stall', 404], ['/sky/../tar1090/', 404], ['/ctl/stall', 404], ['/mock/v2/point/1/1/1', 404],
    ['/sky-relay/check', 404], ['/check', 404], ['/sky-relay/v2/point/40.71/-73.83/60/extra', 404], ['/sky-relay/v2/point/99/-73.83/60', 404], ['//evil.example/', 404], ['http://evil.example/', 404],
    ['/sky-relay/tar1090/data/aircraft.json', 404], ['/graphs1090/', 404], ['/' + 'a'.repeat(400), 404],
  ]) { const r = await get(path, OUT); check((path.length > 60 ? path.slice(0, 57) + '...' : path).padEnd(62) + ' ' + want, r.status === want, r.status === want ? '' : 'got ' + r.status); }
  const post = await get('/sky/', OUT, PORT, 'POST'); check('POST is refused'.padEnd(62), post.status === 501 || post.status === 405, 'got ' + post.status);
  const self = await get('/check'); check('/check is refused from the receiver itself, where the tunnel arrives'.padEnd(62), self.status === 404);
  const lan = lanAddress();
  if (lan) {
    const inside = await getFrom(lan, '/check'); check('/check answers another computer inside the house'.padEnd(62), inside.status === 200 && /stand-in/.test(inside.text), 'asked from ' + lan.replace(/\d+$/, 'x'));
    const posing = await getFrom(lan, '/check', { 'X-Forwarded-For': '203.0.113.7' }); check('/check is refused when a request has been forwarded'.padEnd(62), posing.status === 404);
  } else console.log('skip  no second network address here, so /check from inside the house could not be tried');

  // 2. the page itself
  const page = await get('/sky/', Object.assign({ 'Accept-Encoding': 'gzip' }, OUT));
  check('the page is the network edition, sent compressed', /network edition/.test(page.text) && page.headers['content-encoding'] === 'gzip', Math.round(page.bytes / 1024) + ' KB on the wire');
  check('search engines are told not to list it', /noindex/.test(page.headers['x-robots-tag'] || ''));
  const again = await get('/sky/', Object.assign({ 'If-None-Match': page.headers.etag }, OUT)); check('an unchanged page is not sent twice', again.status === 304);
  const loc = await get('/', OUT); check('the bare address forwards to /sky/', loc.headers.location === '/sky/');

  // 3. location clues are removed, and the same data is still there
  const direct = JSON.parse((await get('/tar1090/data/aircraft.json', {}, SIM)).text), through = JSON.parse((await get('/tar1090/data/aircraft.json', OUT)).text);
  const has = (list, k) => list.some((a) => k in a);
  check('stand-in receiver does report distance, direction and signal', has(direct.aircraft, 'r_dst') && has(direct.aircraft, 'r_dir') && has(direct.aircraft, 'rssi'));
  check('stand-in receiver also reports a rough position guessed from its own', has(direct.aircraft, 'rr_lat') && has(direct.aircraft, 'rr_lon'));
  check('front door removes distance, direction, signal and the guessed position', !/r_dst|r_dir|rssi|rr_lat|rr_lon/.test(JSON.stringify(through)));
  const extras = [...new Set(through.aircraft.flatMap((a) => Object.keys(a)))].filter((k) => !FACTS.includes(k));
  check('only the listed facts about each aircraft come through', extras.length === 0 && Object.keys(through).sort().join() === 'aircraft,messages,now', extras.join(' '));
  check('aircraft positions still come through', through.aircraft.length > 0 && through.aircraft.length === direct.aircraft.length && has(through.aircraft, 'lat') && has(through.aircraft, 'flight'), through.aircraft.length + ' aircraft');
  const rd = JSON.parse((await get('/tar1090/data/receiver.json', {}, SIM)).text), rt = JSON.parse((await get('/tar1090/data/receiver.json', OUT)).text);
  check('stand-in receiver does report its own position', typeof rd.lat === 'number' && typeof rd.lon === 'number');
  check('stand-in receiver does report its own position, twice over', typeof rd.site.lat === 'number');
  check('front door removes the receiver position wherever it sits', !/lat|lon|site/.test(JSON.stringify(rt)) && rt.version === 'sim', JSON.stringify(rt));
  const chunk = JSON.parse((await get('/tar1090/chunks/chunk_1.gz', OUT)).text); check('history comes through, cut to position and height', Array.isArray(chunk.files) && chunk.files.length > 0 && chunk.files.every((f) => f.aircraft.every((a) => Array.isArray(a) && a.length <= 7)) && typeof chunk.files[0].aircraft[0][4] === 'number');
  const netAns = JSON.parse((await get('/sky-relay/v2/point/40.7/-73.8/60', OUT)).text), netExtras = [...new Set(netAns.ac.flatMap((a) => Object.keys(a)))].filter((k) => !FACTS.includes(k));
  check('flight network answers are cut to the same listed facts', netAns.ac.length > 0 && netExtras.length === 0, netExtras.join(' '));
  const redir = await get('/sky-relay/v2/callsign/REDIR', OUT);
  check('a flight network cannot point the relay back at the receiver', redir.status === 502 && !/rssi|r_dst|hex/.test(redir.text), 'got ' + redir.status);

  // 4. pages on other sites are refused; the page from the same address is not
  const p = '/sky-relay/v2/point/40.7/-73.8/60';
  const other = await get(p, Object.assign({ Origin: 'https://some-other-site.example' }, OUT)); check('a page on another site is refused', other.status === 403 && !other.headers['access-control-allow-origin']);
  const nul = await get(p, Object.assign({ Origin: 'null' }, OUT)); check('a page opened from a file is refused', nul.status === 403);
  const same = await get(p, Object.assign({ Origin: 'https://sky.example' }, OUT)); check('the page from the same address is answered', same.status === 200 && same.headers['access-control-allow-origin'] === 'https://sky.example');
  const home = await get('/v2/point/40.7/-73.8/60', { Host: '192.168.1.50:8099', Origin: 'http://192.168.1.50' }); check('at home, the page on port 80 may use the relay on port 8099', home.status === 200 && home.headers['access-control-allow-origin'] === 'http://192.168.1.50');
  const none = await get(p, OUT); check('no leftover permission for any site', none.status === 200 && !none.headers['access-control-allow-origin']);
  const bent = await raw('GET /sky-relay/ HTTP/1.0\r\nHost: sky.example\r\n injected\r\nOrigin: http://sky.example\r\n injected\r\nCF-Connecting-IP: 203.0.113.7\r\n\r\n');
  check('an Origin carrying a line break is refused, not echoed', / 403 /.test(bent.split('\r\n')[0]) && !/injected/.test(bent.split('\r\n\r\n')[0]), bent.split('\r\n')[0]);

  // 5. questions are rounded, shared, and marked with their age
  const asked = async () => JSON.parse((await get('/ctl/netasked', {}, SIM)).text).asked;
  await sleep(4500); const n0 = await asked();
  const a1 = await get('/sky-relay/v2/point/42.3612/-71.0571/58', OUT), a2 = await get('/sky-relay/v2/point/42.3588/-71.0551/60', { 'CF-Connecting-IP': '203.0.113.8' });
  await sleep(1200); const a3 = await get('/sky-relay/v2/point/42.36/-71.06/60', { 'CF-Connecting-IP': '203.0.113.9' });
  const n1 = await asked(), j3 = JSON.parse(a3.text);
  check('three viewers near one another cost one question to the flight network', a1.status === 200 && a2.status === 200 && a3.status === 200 && n1 - n0 === 1, 'asked ' + (n1 - n0) + ' time(s)');
  check('a shared answer says how old it is', j3.relay_age >= 1 && j3.relay_age < 4 && Array.isArray(j3.ac), 'relay_age ' + j3.relay_age);

  // 6. the flight networks are never asked faster than the allowance, whatever arrives
  await sleep(9000); const m0 = await asked(), t0 = Date.now(); let ok200 = 0, busy = 0, limited = 0;
  for (let i = 0; i < 400; i++) {   // 400 different skies from 40 different viewers, as fast as they can be sent
    const r = await get('/sky-relay/v2/point/' + (10 + (i % 60)).toFixed(1) + '/' + (-120 + Math.floor(i / 60) * 3).toFixed(1) + '/60', { 'CF-Connecting-IP': '198.51.100.' + (i % 40) });
    if (r.status === 200) ok200++; else if (r.status === 503) busy++; else if (r.status === 429) limited++;
  }
  const secs = (Date.now() - t0) / 1000, m1 = await asked(), allowance = 6 + 0.75 * secs + 1;
  check('a flood of 400 different questions reaches the flight network only ' + (m1 - m0) + ' times in ' + secs.toFixed(1) + ' s', m1 - m0 <= allowance && busy > 300, 'answered ' + ok200 + ', told to wait ' + busy);

  // 7. one viewer cannot use up the allowance for everybody
  await sleep(12000); const g0 = await asked(); let mine = 0;
  for (let i = 0; i < 12; i++) { const r = await get('/sky-relay/v2/point/' + (-40 + i).toFixed(1) + '/20.0/60', { 'CF-Connecting-IP': '198.18.0.1' }); if (r.status === 200) mine++; }
  const g1 = await asked(), fair = await get('/sky-relay/v2/point/55.0/10.0/60', { 'CF-Connecting-IP': '198.18.0.2' });
  check('one viewer asking for 12 different skies at once gets ' + mine + ', and the next viewer is still answered', mine <= 5 && g1 - g0 === mine && fair.status === 200, 'next viewer got ' + fair.status);

  // 8. one viewer cannot hammer it
  let seen429 = 0, first429 = -1; for (let i = 0; i < 260; i++) { const r = await get('/tar1090/data/aircraft.json', { 'CF-Connecting-IP': '192.0.2.50' }); if (r.status === 429) { seen429++; if (first429 < 0) first429 = i; } }
  check('one viewer sending 260 requests in a burst is slowed down', seen429 > 50 && first429 >= 140, 'first refusal at request ' + first429 + ', ' + seen429 + ' refused');
  const bystander = await get('/tar1090/data/aircraft.json', { 'CF-Connecting-IP': '192.0.2.51' }); check('other viewers are not affected', bystander.status === 200);
  console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll front door checks passed');
  process.exit(failed ? 1 : 0);
})();
