// Stand-in receiver for testing: serves the page plus a simulated aircraft list in the same shape the readsb decoder writes.
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'), PORT = +(process.argv[2] || 8090);
const D2R = Math.PI / 180, NM = 1.852;
const gc = (a, b) => { const p1 = a[0] * D2R, p2 = b[0] * D2R, dl = (b[1] - a[1]) * D2R; const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };
const brg = (a, b) => { const p1 = a[0] * D2R, p2 = b[0] * D2R, dl = (b[1] - a[1]) * D2R; return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D2R + 360) % 360; };
const HOME = [41.16, -73.13];   // pretend receiver site for the simulation: Bridgeport airport, Connecticut

// [lat, lon, altitude ft, speed kt]
const FLOWS = [
  { name: 'JFK arr east', every: 170, cat: 'A3', to: 'KJFK', pts: [[41.25, -71.6, 17000, 310], [41.0, -72.3, 12000, 290], [40.86, -72.95, 7000, 250], [40.8, -73.35, 4000, 210], [40.75, -73.62, 2600, 180], [40.68, -73.74, 900, 150], [40.645, -73.775, 20, 135]],
    fl: [['DAL', 'KATL', 'B739'], ['JBU', 'KBOS', 'A320'], ['BAW', 'EGLL', 'B77W', 'A5'], ['AAL', 'KMIA', 'B738'], ['AFR', 'LFPG', 'A359', 'A5'], ['DAL', 'KDTW', 'A321'], ['EIN', 'EIDW', 'A21N'], ['JBU', 'KFLL', 'A321'], ['UAE', 'OMDB', 'A388', 'A5']] },
  { name: 'JFK arr south', every: 260, cat: 'A3', to: 'KJFK', pts: [[39.5, -73.95, 16000, 300], [40.1, -73.85, 9000, 270], [40.42, -73.62, 4500, 220], [40.6, -73.5, 2600, 190], [40.67, -73.62, 1800, 170], [40.66, -73.73, 700, 145], [40.645, -73.775, 20, 135]],
    fl: [['AAL', 'KCLT', 'A321'], ['JBU', 'MDPC', 'A320'], ['DAL', 'KMCO', 'B752'], ['AVA', 'SKBO', 'B788', 'A5'], ['JBU', 'KTPA', 'BCS3']] },
  { name: 'JFK dep', every: 200, cat: 'A3', from: 'KJFK', pts: [[40.63, -73.79, 100, 160], [40.6, -73.9, 2600, 210], [40.52, -73.82, 6000, 250], [40.58, -73.25, 13000, 300], [40.8, -72.2, 22000, 380], [41.1, -70.8, 31000, 450]],
    fl: [['DAL', 'EGLL', 'A333', 'A5'], ['VIR', 'EGLL', 'A35K', 'A5'], ['JBU', 'KBOS', 'E190'], ['DLH', 'EDDF', 'B748', 'A5'], ['AAL', 'LEMD', 'B772', 'A5'], ['KLM', 'EHAM', 'B789', 'A5']] },
  { name: 'LGA arr north', every: 150, cat: 'A3', to: 'KLGA', pts: [[41.75, -73.5, 15000, 300], [41.3, -73.62, 9000, 260], [41.02, -73.72, 5000, 220], [40.9, -73.8, 2800, 180], [40.82, -73.855, 900, 145], [40.782, -73.875, 20, 130]],
    fl: [['DAL', 'KBOS', 'BCS1'], ['RPA', 'KPIT', 'E75L'], ['AAL', 'KORD', 'B738'], ['EDV', 'KBUF', 'CRJ9'], ['SWA', 'KMDW', 'B38M'], ['UAL', 'KORD', 'A319'], ['JIA', 'KDCA', 'CRJ7'], ['ACA', 'CYYZ', 'BCS3']] },
  { name: 'LGA dep', every: 165, cat: 'A3', from: 'KLGA', pts: [[40.77, -73.86, 100, 150], [40.8, -73.75, 3200, 220], [40.98, -73.45, 9000, 270], [41.4, -72.9, 17000, 330], [41.95, -72.15, 25000, 400]],
    fl: [['DAL', 'KBOS', 'A220'], ['AAL', 'KBOS', 'E175'], ['JBU', 'KBOS', 'A320'], ['RPA', 'KPWM', 'E170'], ['ACA', 'CYUL', 'E75L']] },
  { name: 'EWR arr', every: 180, cat: 'A3', to: 'KEWR', pts: [[41.5, -74.45, 14000, 300], [41.1, -74.2, 7000, 250], [40.9, -74.12, 3500, 200], [40.78, -74.14, 1500, 160], [40.7, -74.165, 20, 135]],
    fl: [['UAL', 'KORD', 'B739'], ['UAL', 'KSFO', 'B77W', 'A5'], ['UAL', 'KDEN', 'A21N'], ['GJS', 'KROC', 'CRJ7'], ['UAL', 'EGLL', 'B764', 'A5'], ['NKS', 'KFLL', 'A20N']] },
  { name: 'EWR dep', every: 210, cat: 'A3', from: 'KEWR', pts: [[40.68, -74.175, 100, 160], [40.72, -74.3, 4000, 230], [40.82, -74.8, 12000, 300], [40.95, -75.7, 23000, 390], [41.1, -76.6, 32000, 440]],
    fl: [['UAL', 'KLAX', 'B752'], ['UAL', 'KIAH', 'B738'], ['FDX', 'KMEM', 'B763', 'A5'], ['UAL', 'KSFO', 'B789', 'A5']] },
  { name: 'cruise NE-SW', every: 240, cat: 'A3', pts: [[42.5, -70.9, 36000, 440], [41.5, -72.6, 36000, 440], [40.5, -74.4, 36000, 440], [39.4, -76.0, 36000, 440]],
    fl: [['JBU', 'KBOS', 'A321', 'A3', 'KDCA'], ['AAL', 'KBOS', 'A321', 'A3', 'KPHL'], ['DAL', 'KBOS', 'B739', 'A3', 'KATL'], ['SWA', 'KPVD', 'B737', 'A3', 'KBWI']] },
  { name: 'cruise SW-NE', every: 300, cat: 'A3', pts: [[39.2, -75.4, 37000, 470], [40.4, -73.6, 37000, 470], [41.3, -72.0, 37000, 470], [42.3, -70.2, 37000, 470]],
    fl: [['AAL', 'KDCA', 'A319', 'A3', 'KBOS'], ['UPS', 'KSDF', 'B748', 'A5', 'EDDK'], ['DAL', 'KATL', 'A339', 'A5', 'EHAM']] },
  { name: 'HPN bizjet', every: 420, cat: 'A2', to: 'KHPN', pts: [[41.6, -74.6, 11000, 280], [41.3, -74.0, 6000, 240], [41.15, -73.78, 2500, 170], [41.07, -73.71, 500, 125]],
    fl: [['EJA', 'KPBI', 'C68A', 'A2'], ['LXJ', 'KTEB', 'E55P', 'A2'], ['EJA', 'KMDW', 'CL35', 'A2']] },
  { name: 'GA sound', every: 500, cat: 'A1', pts: [[41.3, -72.7, 3500, 115], [41.2, -73.0, 3500, 115], [41.12, -73.3, 3000, 110], [41.0, -73.6, 2500, 110], [41.05, -73.9, 2500, 105]],
    fl: [['N', '', 'C172', 'A1'], ['N', '', 'SR22', 'A1'], ['N', '', 'P28A', 'A1']] },
  { name: 'heli', every: 380, cat: 'A7', pts: [[40.7, -74.01, 900, 95], [40.76, -73.96, 1100, 100], [40.83, -73.93, 1200, 100], [40.95, -73.75, 1500, 110], [41.06, -73.7, 600, 80]],
    fl: [['BTQ', '', 'B407', 'A7'], ['N', '', 'S76', 'A7']] },
];
for (const f of FLOWS) {
  f.cum = [0]; for (let i = 1; i < f.pts.length; i++) { const v = (f.pts[i - 1][3] + f.pts[i][3]) / 2 * NM / 3600; f.cum.push(f.cum[i - 1] + gc(f.pts[i - 1], f.pts[i]) / v); }
  f.dur = f.cum[f.cum.length - 1];
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// smoothed position: blend headings near waypoints by sampling slightly ahead and behind
function at(f, u) {
  u = Math.max(0, Math.min(f.dur - 0.001, u)); let i = 1; while (f.cum[i] < u) i++;
  const a = f.pts[i - 1], b = f.pts[i], k = (u - f.cum[i - 1]) / (f.cum[i] - f.cum[i - 1]);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}
function smoothAt(f, u) {
  const w = 14, n = 7; let la = 0, lo = 0, al = 0, sp = 0;
  for (let j = 0; j < n; j++) { const p = at(f, u + (j / (n - 1) - 0.5) * 2 * w); la += p[0]; lo += p[1]; al += p[2]; sp += p[3]; }
  return [la / n, lo / n, al / n, sp / n];
}
function snapshot(T, opts = {}) {
  const out = [];
  FLOWS.forEach((f, fi) => {
    const off = (hash(f.name) % 1000) / 1000 * f.every;
    const k1 = Math.floor((T - off) / f.every), k0 = Math.ceil((T - off - f.dur) / f.every);
    for (let k = k0; k <= k1; k++) {
      let u = T - (off + k * f.every); if (u < 17 || u > f.dur - 16) continue;
      const spec = f.fl[((k % f.fl.length) + f.fl.length) % f.fl.length], id = hash(f.name + ':' + k);
      const id0 = hash(f.name + ':' + k), hex0 = 'a' + (id0 % 0xfffff).toString(16).padStart(5, '0');
      const seen = ((hash(hex0 + Math.floor(T)) % 100) / 100) * 0.9, ur = u; u = u - seen;
      const p = smoothAt(f, u), q = smoothAt(f, u + 2), p0 = smoothAt(f, u - 2);
      const dnm = gc(HOME, p) / NM, floor = Math.pow(dnm, 2) * 1.15;
      if (!opts.all && p[2] < floor) continue;
      const hex = 'a' + (id % 0xfffff).toString(16).padStart(5, '0');
      const num = spec[0] === 'N' ? String(100 + id % 899) + String.fromCharCode(65 + id % 26) + String.fromCharCode(65 + (id >> 5) % 26) : String(1 + id % 2800);
      const ac = { hex, type: 'adsb_icao', flight: (spec[0] + num).padEnd(8, ' '), alt_baro: Math.round(p[2] / 25) * 25, alt_geom: Math.round(p[2] / 25) * 25 + 150, gs: +p[3].toFixed(1), track: +brg(p0, q).toFixed(2),
        baro_rate: Math.round((q[2] - p0[2]) / 4 * 60 / 64) * 64, category: spec[3] || f.cat, lat: +p[0].toFixed(6), lon: +p[1].toFixed(6), seen_pos: +seen.toFixed(3), seen: +(seen * 0.5).toFixed(1), messages: 500 + Math.floor(u * 3), rssi: -12 - dnm / 6 };
      if (id % 3 === 0) { ac.t = spec[2]; ac.r = 'N' + (100 + id % 800) + 'XX'; }
      ac._route = [f.from || spec[1], f.to || spec[4] || spec[1]]; if (f.from) ac._route = [f.from, spec[1]]; else if (f.to) ac._route = [spec[1], f.to]; else ac._route = [spec[1], spec[4]];
      ac._type = spec[2];
      out.push(ac);
    }
  });
  return out;
}
const strip = (a) => { const o = Object.assign({}, a); delete o._route; delete o._type; return o; };
const AIRPORTS = JSON.parse(fs.readFileSync(path.join(root, 'build/airports.json'), 'utf8')); const AP = {}; for (const a of AIRPORTS) AP[a[0]] = a;
const apObj = (id) => { const a = AP[id]; return a ? { name: a[2], icao: a[0], iata: a[1], location: a[3], lat: a[4], lon: a[5], countryiso2: 'US' } : null; };
// one far flight for follow tests: Atlanta to Boston, somewhere over Virginia
function farFlight(T) {
  const f = { pts: [[33.64, -84.43, 34000, 455], [36.5, -79.5, 35000, 455], [39.0, -76.2, 35000, 455], [41.0, -73.3, 35000, 440], [42.36, -71.0, 3000, 250]] };
  f.cum = [0]; for (let i = 1; i < f.pts.length; i++) { const v = (f.pts[i - 1][3] + f.pts[i][3]) / 2 * NM / 3600; f.cum.push(f.cum[i - 1] + gc(f.pts[i - 1], f.pts[i]) / v); } f.dur = f.cum[f.cum.length - 1];
  const u = 2600 + (T % 3000), p = smoothAt(f, u), q = smoothAt(f, u + 2), p0 = smoothAt(f, u - 2);
  return { hex: 'a4d2c1', type: 'adsb_icao', flight: 'DAL2210 ', r: 'N301DV', t: 'BCS1', desc: 'AIRBUS A-220-100', alt_baro: Math.round(p[2] / 25) * 25, gs: +p[3].toFixed(1), track: +brg(p0, q).toFixed(2), baro_rate: 0, category: 'A3', lat: +p[0].toFixed(6), lon: +p[1].toFixed(6), seen_pos: 0.4, seen: 0.1, messages: 9000 };
}
const DBDIR = path.join(root, 'dl/db');
function dbFile(name) {
  const fp = path.join(DBDIR, path.basename(name));
  if (!fs.existsSync(fp)) { try { execFileSync('curl', ['-sS', '-f', '-m', '30', '-o', fp, 'https://raw.githubusercontent.com/wiedehopf/tar1090-db/master/db/' + path.basename(name)]); } catch (e) { return null; } }
  return fs.existsSync(fp) ? fs.readFileSync(fp) : null;
}
let stall = false, stallNet = false, netAsked = 0;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), T = u.searchParams.has('t') ? +u.searchParams.get('t') : Date.now() / 1000;
  const json = (o, extra) => { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, extra || {})); res.end(typeof o === 'string' || Buffer.isBuffer(o) ? o : JSON.stringify(o)); };
  if (u.pathname === '/sky/' || u.pathname === '/sky/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(root, 'build/sky3d.html'))); }
  if (u.pathname === '/net/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(root, 'build/sky3d-network.html'))); }
  // stand-in for the flight network: every aircraft in the area, including the low ones the pretend antenna cannot hear
  if (u.pathname.startsWith('/mock/v2/point/')) { netAsked++; if (stallNet) { res.writeHead(503); return res.end(); } const all = snapshot(T, { all: true }).map(strip).map((a) => Object.assign({ t: 'B738', desc: 'BOEING 737-800' }, a)); return json({ ac: all, msg: 'No error', now: Math.round(T * 1000), total: all.length }, { 'Access-Control-Allow-Origin': '*' }); }
  if (u.pathname === '/ctl/netasked') return json({ asked: netAsked });   // how many times the stand-in flight network has been asked about an area
  if (u.pathname === '/ctl/stallnet') { stallNet = u.searchParams.get('on') === '1'; return json({ stallNet }); }
  if (u.pathname === '/ctl/stall') { stall = u.searchParams.get('on') === '1'; return json({ stall }); }
  if (u.pathname === '/tar1090/data/aircraft.json') { if (stall) { res.writeHead(503); return res.end(); } return json({ now: +T.toFixed(1), messages: 1234567, aircraft: snapshot(T).map(strip).map((x) => Object.assign(x, { rssi: -12.3, r_dst: +(gc(HOME, [x.lat, x.lon]) / NM).toFixed(1), r_dir: +brg(HOME, [x.lat, x.lon]).toFixed(1), rr_lat: +HOME[0].toFixed(1), rr_lon: +HOME[1].toFixed(1), mlat: [], nav_modes: ['autopilot'] })) }); }
  if (u.pathname === '/tar1090/data/receiver.json') return json(Object.assign({ version: 'sim', refresh: 1000, history: 0 }, process.env.SIM_SITE ? { lat: HOME[0], lon: HOME[1], site: { lat: HOME[0], lon: HOME[1] } } : {}));   // SIM_SITE=1: a receiver whose position is set
  if (u.pathname === '/tar1090/version.json') return json({ tar1090Version: 'sim', databaseVersion: 'sim' });
  if (u.pathname.startsWith('/tar1090/db-sim/')) { const b = dbFile(u.pathname.split('/').pop()); if (!b) { res.writeHead(404); return res.end(); } return json(b, { 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=1209600' }); }
  if (u.pathname === '/tar1090/chunks/chunks.json') return json({ chunks: ['chunk_1.gz', 'chunk_2.gz', 'current_large.gz', 'current_small.gz'], chunks_all: [] });
  if (u.pathname.startsWith('/tar1090/chunks/')) {
    const name = u.pathname.split('/').pop(), spans = { 'chunk_1.gz': [600, 320], 'chunk_2.gz': [320, 160], 'current_large.gz': [160, 24], 'current_small.gz': [24, 0] }[name] || [0, 0];
    const files = []; for (let back = spans[0]; back > spans[1]; back -= 8) { const t = T - back; files.push({ now: +t.toFixed(1), messages: 1, aircraft: snapshot(t).map((a) => [a.hex, a.alt_baro, a.gs, a.track, a.lat, a.lon, a.seen_pos, a.type, a.flight, a.messages]) }); }
    return json(zlib.gzipSync(JSON.stringify({ files })), { 'Content-Encoding': 'gzip' });
  }
  if (u.pathname === '/mock/routeset') {
    let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
      let planes = []; try { planes = JSON.parse(body).planes; } catch (e) { /* */ }
      const all = snapshot(T, { all: true });
      const out = planes.map((p) => {
        const ac = all.find((a) => a.flight.trim() === p.callsign); let codes = ac ? ac._route : null; if (p.callsign === 'DAL2210') codes = ['KATL', 'KBOS'];
        const aps = codes ? codes.map(apObj).filter(Boolean) : [];
        return aps.length >= 2 ? { callsign: p.callsign, number: p.callsign.slice(3), airline_code: p.callsign.slice(0, 3), airport_codes: codes.join('-'), _airports: aps, plausible: true } : { callsign: p.callsign, airport_codes: 'unknown', _airports: [] };
      });
      json(out, { 'Access-Control-Allow-Origin': '*' });
    }); return;
  }
  if (u.pathname === '/mock/wx') {   // stand-in for the weather service: steady rain with a west wind
    return json({ latitude: +u.searchParams.get('latitude'), longitude: +u.searchParams.get('longitude'), current: { time: '2026-10-10T12:00', temperature_2m: 52.4, weather_code: 63, cloud_cover: 100, wind_speed_10m: 14.2, wind_direction_10m: 262, wind_gusts_10m: 27.5, visibility: 9000, snow_depth: 0 } }, { 'Access-Control-Allow-Origin': '*' });
  }
  if (u.pathname === '/mock/v2/callsign/REDIR') { res.writeHead(302, { Location: 'http://127.0.0.1:' + PORT + '/tar1090/data/aircraft.json' }); return res.end(); }   // a flight network that tries to point the relay back at the receiver
  if (u.pathname.startsWith('/mock/v2/callsign/')) { const cs = decodeURIComponent(u.pathname.split('/').pop()); return json({ ac: cs === 'DAL2210' ? [farFlight(T)] : [], msg: 'No error', now: Math.round(T * 1000), total: cs === 'DAL2210' ? 1 : 0 }); }
  if (u.pathname.startsWith('/mock/v2/')) return json({ ac: [], msg: 'No error', now: Math.round(T * 1000), total: 0 });
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log('sim on', PORT));
