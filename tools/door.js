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

  // 3b. typed places (version 3.7): only the words go out, the answer is cut to a name and a position, and answers are kept
  const placed = async () => JSON.parse((await get('/ctl/placeasked', {}, SIM)).text);
  const pl0 = (await placed()).asked;
  const pl = await get('/sky-relay/place/' + encodeURIComponent('Fairfield,  CT'), OUT), plj = JSON.parse(pl.text || '{}'), sent = await placed();
  check('a typed place is looked up and answered', pl.status === 200 && Array.isArray(plj.places) && plj.places.length === 3 && plj.places[0].lat === 41.1414, 'got ' + pl.status + ' ' + pl.text.slice(0, 80));
  check('only the typed words, tidied, go to the place finder, with the relay named', sent.last && sent.last.q === 'Fairfield, CT' && /3d-sky-relay/.test(sent.last.agent) && sent.last.keys === 'format,limit,q', JSON.stringify(sent.last));
  check('a place answer holds a name and a position and nothing else', plj.places && plj.places.every((x) => Object.keys(x).sort().join() === 'kind,lat,lon,name' && isFinite(x.lat)), JSON.stringify(plj).slice(0, 120));
  const plAgain = await get('/sky-relay/place/fairfield%2C%20ct', { 'CF-Connecting-IP': '203.0.113.20' });
  check('the same words again are answered from what was kept, for anyone', plAgain.status === 200 && (await placed()).asked === pl0 + 1, 'asked ' + ((await placed()).asked - pl0) + ' time(s)');
  const quick = await get('/sky-relay/place/Bridgeport', { 'CF-Connecting-IP': '203.0.113.21' });
  check('a second new place within a second waits its turn', quick.status === 503, 'got ' + quick.status);
  await sleep(1100); const later = await get('/sky-relay/place/Bridgeport', { 'CF-Connecting-IP': '203.0.113.21' });
  check('and is answered a second later', later.status === 200, 'got ' + later.status);
  for (const [bad, why] of [['a', 'one letter'], ['%00abc', 'a control character'], ['%FF%FEab', 'not text'], ['x'.repeat(101), 'over 100 letters'], ['ab/cd', 'a slash']]) {
    const r = await get('/sky-relay/place/' + bad, OUT); check('a place with ' + why + ' is refused', r.status === 404, 'got ' + r.status);
  }
  await sleep(1100);

  // 3c. aircraft photos (version 3.11): only the transponder code and registration go out, the answer is cut to the photo's
  // address, size, photographer and page, anything not on Planespotters is refused, and answers are kept
  const photoAsked = async () => JSON.parse((await get('/ctl/photoasks', {}, SIM)).text);
  const ph0 = await photoAsked();
  const ph = await get('/sky-relay/photo/abc123/N12345', OUT), phj = JSON.parse(ph.text || '{}');
  check('a photo of one aircraft is looked up and answered', ph.status === 200 && phj.photo && /^https:\/\/t\.plnspttrs\.net\//.test(phj.photo.src) && /^https:\/\/www\.planespotters\.net\/photo\//.test(phj.photo.link), 'got ' + ph.status + ' ' + ph.text.slice(0, 120));
  check('a photo answer holds the address, size, photographer and page and nothing else', phj.photo && Object.keys(phj.photo).sort().join() === 'by,h,link,src,w' && phj.photo.w === 420, JSON.stringify(phj));
  const phAgain = await get('/sky-relay/photo/abc123', { 'CF-Connecting-IP': '203.0.113.30' }), ph1 = await photoAsked();
  check('the same aircraft again is answered from what was kept, for anyone', phAgain.status === 200 && ph1.hex === ph0.hex + 1, JSON.stringify(ph1));
  await sleep(2100); const evil = JSON.parse((await get('/sky-relay/photo/bad001', OUT)).text || '{}');
  check('a photo that points anywhere but Planespotters is not handed on', evil.photo === null, JSON.stringify(evil));
  await sleep(2100); const noPh = await get('/sky-relay/photo/eeeee0/N00000', OUT), nonej = JSON.parse(noPh.text || '{}'), ph2 = await photoAsked();
  check('an aircraft with no photo is asked by its registration too, and answered with none', noPh.status === 200 && nonej.photo === null && ph2.reg === ph1.reg + 1, JSON.stringify({ nonej, ph2 }));
  for (const [bad, why] of [['ABC123', 'capital letters'], ['abc12', 'five characters'], ['abc123/n1', 'a registration of two characters with small letters'], ['abc123/' + 'N'.repeat(11), 'a registration over ten characters']]) {
    const r = await get('/sky-relay/photo/' + bad, OUT); check('a photo question with ' + why + ' is refused', r.status === 404, 'got ' + r.status);
  }
  let quickPh = 0; for (const h of ['a00001', 'a00002', 'a00003', 'a00004', 'a00005', 'a00006', 'a00007']) { const r = await get('/sky-relay/photo/' + h, { 'CF-Connecting-IP': '203.0.113.' + (40 + quickPh) }); if (r.status === 503) quickPh++; }
  check('many new aircraft at once: Planespotters is asked only as often as allowed, and the rest are told to wait', quickPh >= 2, quickPh + ' told to wait');
  // an aircraft with no photo by its hex code is asked about a second time by its registration: that second question counts against the same allowance
  await sleep(8500); const ph3 = await photoAsked();
  for (let i = 1; i <= 6; i++) await get('/sky-relay/photo/eeee0' + i + '/N0000' + i, { 'CF-Connecting-IP': '203.0.113.' + (60 + i) });
  const ph4 = await photoAsked(), phSent = ph4.hex + ph4.reg - ph3.hex - ph3.reg;
  check('aircraft with no photo by hex code: the questions by registration count against the same allowance', phSent <= 5, phSent + ' questions to Planespotters for 6 aircraft, allowance 4 at once');
  await sleep(2100);
  // a photo found by registration belongs to that registration only: another viewer's registration, or none, never sees it
  await sleep(6500); const pv = (h, ip) => get('/sky-relay/photo/' + h, { 'CF-Connecting-IP': '203.0.113.' + ip }).then((r) => JSON.parse(r.text || '{}').photo);
  const byReg = await pv('eeee10/N12345', 81); await sleep(2100); const noReg = await pv('eeee10', 82); await sleep(2100); const otherReg = await pv('eeee10/N00009', 83);
  check('a photo found by one viewer\'s registration is not shown for the same hex code with no registration or another one', !!byReg && noReg === null && otherReg === null, JSON.stringify({ byReg: !!byReg, noReg, otherReg }));
  await sleep(2100); const missFirst = await pv('eeee11', 84); await sleep(2100); const thenReg = await pv('eeee11/N12345', 85);
  check('a hex code with no photo, asked first with no registration, is still asked about by registration later', missFirst === null && !!thenReg, JSON.stringify({ missFirst, thenReg: !!thenReg }));
  await sleep(2100);

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
