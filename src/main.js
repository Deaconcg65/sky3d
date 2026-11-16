// 3D sky channel. One page that reads the aircraft list from a readsb or dump1090 receiver and flies a camera through it.
import * as THREE from 'three';
import { R_EARTH, FT, KT, MI, D2R, clamp, lerp, smooth, angDiff, lerpAng, gcDist, bearing, sunPosition, sunTimes, fmtInt, prettyType } from './util.js';
import { VEX, proj, setOrigin, project, localFrame, Segments, Ground, Sky, WeatherLayer, PlaneMesh, modelFor, makeLabel, SatGround } from './scene.js';
import { AIRLINES, IATA2ICAO, paintFor, partnerOf } from './airlines.js';

const Q = new URLSearchParams(location.search);
// __NET__ is set when the page is built: true in the network edition, false in the home edition.
// Because it is fixed at build time, every part of the code that depends on it is left out of the home edition altogether.
const GEO = JSON.parse(document.getElementById('geo-data').textContent);
const AIRPORTS = JSON.parse(document.getElementById('airport-data').textContent);
const AP = {}; for (const a of AIRPORTS) { AP[a[0]] = a; if (a[1]) AP[a[1]] = a; }
const $ = (id) => document.getElementById(id);

// ---------- settings ----------
const PRESETS = [
  ['MID', 'New York, between LaGuardia and Kennedy'], ['KJFK', 'Kennedy'], ['KLGA', 'LaGuardia'], ['KEWR', 'Newark'], ['KHPN', 'White Plains'],
  ['KBDR', 'Bridgeport'], ['KHVN', 'New Haven'], ['KISP', 'Islip'], ['KTEB', 'Teterboro'], ['KSWF', 'Stewart'], ['KBDL', 'Hartford Bradley'],
];
if (__NET__) PRESETS.push(['KBOS', 'Boston'], ['KMKE', 'Milwaukee'], ['KPHL', 'Philadelphia'], ['KDCA', 'Washington National'], ['KATL', 'Atlanta'], ['KMIA', 'Miami'], ['KORD', 'Chicago O\'Hare'], ['KDFW', 'Dallas Fort Worth'],
  ['KDEN', 'Denver'], ['KLAX', 'Los Angeles'], ['KSFO', 'San Francisco'], ['KSEA', 'Seattle']);
const DEFAULTS = { center: 'MID', other: '', radius: 30, follow: '', pace: 20, captions: true, sky: 'real', trail: 5, wx: 'real', corner: true, lights: 'arr', src: 'blend', relay: '', netmax: 130, clickSecs: 15, flyBack: 30, places: [], keep: null, watch: null, watchSound: true, watchNote: false, sat: false };
// SHARED: the page was opened at a secure web address, which is how a receiver is shared with people outside the house.
// At home it is opened at the receiver's own plain address.
const SHARED = Q.has('shared') ? Q.get('shared') !== '0' : location.protocol === 'https:';
const ANT = SHARED ? "this site's antenna" : 'your antenna';
const S = Object.assign({}, DEFAULTS);
try { Object.assign(S, JSON.parse(localStorage.getItem('sky3d') || '{}')); } catch (e) { /* storage unavailable */ }
for (const k of Object.keys(DEFAULTS)) if (Q.has(k) && typeof DEFAULTS[k] !== 'object') { const v = Q.get(k); S[k] = typeof DEFAULTS[k] === 'number' ? +v : typeof DEFAULTS[k] === 'boolean' ? v !== '0' && v !== 'false' : v; }
// The viewer's own places ("My House" and so on). They live in this browser and nowhere else: they are never sent to the
// receiver or saved on it. On a shared address they are not even kept in the browser unless the viewer asks for that, so
// nothing is left behind on a borrowed or public computer. Without "keep", they last until the page is closed.
const placeList = () => (Array.isArray(S.places) ? S.places : []);
if (Q.has('keep')) S.keep = Q.get('keep') !== '0'; else if (typeof S.keep !== 'boolean') S.keep = !SHARED || placeList().length > 0;
// Version 3.7: the watch list, the viewer's own aircraft to be told about. It starts with N2RF on the receiver's own screens
// and empty for guests on the shared address, so a guest's page asks the flight networks about nothing it was not told to.
const WATCH_MAX = 10;
function watchKey(text) {
  const s = String(text || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/^-+|-+$/g, '');
  if (!/^[A-Z0-9-]{2,8}$/.test(s)) return '';
  return s.indexOf('-') === -1 ? parseFlight(s).slice(0, 8) : s;   // DL1234 becomes DAL1234, as in Follow; a registration with a dash keeps it
}
S.watch = Array.isArray(S.watch) ? [...new Set(S.watch.map(watchKey).filter(Boolean))].slice(0, WATCH_MAX) : (SHARED ? [] : ['N2RF']);
const save = () => {
  try {
    const out = Object.assign({}, S);
    if (!S.keep) { out.places = []; if (/^P\d+$/.test(out.center)) out.center = DEFAULTS.center; }
    localStorage.setItem('sky3d', JSON.stringify(out));
  } catch (e) { /* ignore */ }
};
// Version 3.7.1: every copy of this page open in the same browser (another tab or window) keeps its own settings in memory and
// saves all of them at once, so a copy opened earlier used to write its old list of places over a place just added in another
// one. Each copy now takes in what another copy saved to the lists that grow, My places and the watch list, as it happens.
window.addEventListener('storage', (e) => {
  if (e.key !== 'sky3d' || !e.newValue) return;
  let o; try { o = JSON.parse(e.newValue); } catch (err) { return; }
  if (!o || typeof o !== 'object') return;
  if (typeof o.keep === 'boolean' && o.keep !== S.keep && !Q.has('keep')) { S.keep = o.keep; $('f-keep').checked = S.keep; keepNotes(); }
  if (S.keep && Array.isArray(o.places)) {
    const fine = o.places.filter((pl) => pl && typeof pl.n === 'string' && Number.isFinite(pl.lat) && Number.isFinite(pl.lon)).slice(0, 20);
    const was = /^P\d+$/.test(S.center) ? placeList()[+S.center.slice(1)] : null;
    S.places = fine;
    if (was) {   // stay on the same place here, wherever it now sits in the list; if the other copy removed it, go back to the start
      const i = fine.findIndex((pl) => pl.n === was.n && Math.abs(pl.lat - was.lat) < 1e-6 && Math.abs(pl.lon - was.lon) < 1e-6);
      S.center = i === -1 ? DEFAULTS.center : 'P' + i;
      if (i === -1) applyCenter(false);
    }
    buildCenterOptions(); renderPlaces(); rebuildLabels(); if (!$('mine').hidden) renderMine();
  }
  if (Array.isArray(o.watch)) {
    const next = [...new Set(o.watch.map(watchKey).filter(Boolean))].slice(0, WATCH_MAX);
    for (const key of watchList()) if (next.indexOf(key) === -1) { watchState.delete(key); dismissWatch(key); }   // removed in the other copy: clear it here as Remove does
    S.watch = next; renderWatch();
  }
});
let home = null;   // receiver position, if the receiver has one set
// Reads a latitude and longitude as copied from Google Maps (40.6892, -74.0445) or Google Earth (40°41'21"N 74°02'40"W).
function parseLatLon(text) {
  const s = String(text || '').replace(/[\u2032\u2019]/g, "'").replace(/[\u2033\u201d]/g, '"').replace(/''/g, '"');
  const re = /(-?\d+(?:\.\d+)?)\s*\u00b0?\s*(?:(\d+(?:\.\d+)?)\s*')?\s*(?:(\d+(?:\.\d+)?)\s*")?\s*([NSEWnsew])?/g, vals = [];
  let m; while ((m = re.exec(s)) && vals.length < 3) { if (!m[0].trim()) { re.lastIndex++; continue; } const neg = m[1][0] === '-', v = Math.abs(+m[1]) + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600, h = (m[4] || '').toUpperCase(); vals.push({ v: (neg || h === 'S' || h === 'W') ? -v : v, h }); }
  if (vals.length !== 2) return null;
  let [a, b] = vals; if ((a.h === 'E' || a.h === 'W') && (b.h === 'N' || b.h === 'S')) [a, b] = [b, a];
  return Math.abs(a.v) <= 90 && Math.abs(b.v) <= 180 ? { lat: +a.v.toFixed(5), lon: +b.v.toFixed(5) } : null;
}

function centerPoint() {
  if (S.center === 'MID') { const a = AP.KJFK, b = AP.KLGA; return { lat: (a[4] + b[4]) / 2, lon: (a[5] + b[5]) / 2, name: 'New York', short: 'the midpoint of LaGuardia and Kennedy' }; }
  if (/^P\d+$/.test(S.center)) { const pl = placeList()[+S.center.slice(1)]; if (pl) return { lat: pl.lat, lon: pl.lon, name: pl.n, short: pl.n }; }
  if (S.center === 'HOME' && home) return { lat: home.lat, lon: home.lon, name: 'home', short: 'home' };
  const code = S.center === 'OTHER' ? S.other.trim().toUpperCase() : S.center;
  const a = AP[code] || AP['K' + code];
  if (a) { const p = PRESETS.find((x) => x[0] === a[0]); return { lat: a[4], lon: a[5], name: p ? p[1] : a[2], short: p ? p[1] : a[2] }; }
  const k = AP.KJFK, l = AP.KLGA; return { lat: (k[4] + l[4]) / 2, lon: (k[5] + l[5]) / 2, name: 'New York', short: 'the midpoint of LaGuardia and Kennedy' };
}
let C = centerPoint();
const radiusKm = () => (S.radius > 0 ? S.radius * MI : 0);

// ---------- renderer and scene ----------
THREE.ColorManagement.enabled = false;
const canvas = $('sky');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
let DPR = Math.min(window.devicePixelRatio || 1, Q.has('dpr') ? +Q.get('dpr') : 2);
renderer.setPixelRatio(DPR);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xa9c8de, 0.0024);
const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 12000);
const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.0); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.0); scene.add(sun); scene.add(sun.target);
const sky = new Sky(scene);
const weather = new WeatherLayer();
setOrigin(C.lat, C.lon);
const ground = new Ground(scene, GEO, AIRPORTS);
// Version 3.8: satellite photos on the ground, off unless the viewer switches them on. EOxCloudless (Sentinel-2) tiles are free
// for personal, non-commercial use with the credit line shown, and need no key. The viewer's browser fetches them itself.
const SAT_API = Q.get('satApi') || 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg';
const sat = new SatGround(scene, SAT_API, renderer);
const DAY_LAND = new THREE.Color(0x7f9a78), SAT_TINT = new THREE.Color(); let satK = -1, satT = -100;
const trails = new Segments(60000, { width: 2.2, color: 0xffffff, opacity: 1, depthTest: true, renderOrder: 8 });
const drops = new Segments(600, { width: 1.0, color: 0xffffff, opacity: 1, depthTest: true, renderOrder: 7 });
scene.add(trails.mesh); scene.add(drops.mesh);
const planeLayer = new THREE.Group(); scene.add(planeLayer);
const labelLayer = new THREE.Group(); scene.add(labelLayer);
const allLines = [...ground.lines, trails, drops];

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  for (const s of allLines) s.resize(w, h, DPR);
  sky.starU.dpr.value = DPR;
}
window.addEventListener('resize', resize);

let labels = [];
function rebuildLabels() {
  for (const l of labels) { labelLayer.remove(l.sprite); l.sprite.material.map.dispose(); l.sprite.material.dispose(); }
  labels = [];
  const want = new Set();
  for (const a of AIRPORTS) if (a[7] === 2 && a[1] && gcDist(proj.lat0, proj.lon0, a[4], a[5]) < 320) want.add(a[0]);
  const code = S.center === 'OTHER' ? S.other.trim().toUpperCase() : S.center; const ca = AP[code] || AP['K' + code]; if (ca) want.add(ca[0]);
  for (const id of want) { const a = AP[id]; const sprite = makeLabel(a[1] || a[0]); project(a[4], a[5], 0.05, sprite.position); labelLayer.add(sprite); labels.push({ sprite, a }); }
  for (const pl of placeList()) if (gcDist(proj.lat0, proj.lon0, pl.lat, pl.lon) < 600) { const sprite = makeLabel(pl.n); project(pl.lat, pl.lon, 0.75, sprite.position); labelLayer.add(sprite); labels.push({ sprite, a: null }); }
  ground.setMarks(placeList());
}
function reorigin(lat, lon) {
  setOrigin(lat, lon); ground.rebuild(); ground.setRing(C.lat, C.lon, radiusKm()); rebuildLabels();
}

// ---------- look of the sky and ground by sun height ----------
const hex = (h) => new THREE.Color(h);
const KEYS = [
  { e: -12, zenith: hex(0x04060f), horizon: hex(0x0c1730), haze: hex(0x080f20), water: hex(0x050a15), land: hex(0x0d1622), coast: hex(0x5b8fba), coastA: 0.55, trail: hex(0xcfe6ff), body: hex(0x66728a), stars: 1, night: 1, sunI: 0.35, hemiI: 0.95, glow: 0, runway: hex(0xffd08a), label: 0.5 },
  { e: -5, zenith: hex(0x10173a), horizon: hex(0xb8654f), haze: hex(0x4a3b52), water: hex(0x18223f), land: hex(0x272c3d), coast: hex(0x93a9c9), coastA: 0.55, trail: hex(0xffe3c8), body: hex(0x8c93a6), stars: 0.4, night: 0.85, sunI: 0.6, hemiI: 0.9, glow: 0.5, runway: hex(0xffdca8), label: 0.55 },
  { e: -1, zenith: hex(0x1f2c5e), horizon: hex(0xe08c60), haze: hex(0x7a5d6c), water: hex(0x26325c), land: hex(0x3a3649), coast: hex(0xd9bcb4), coastA: 0.58, trail: hex(0xffe9d2), body: hex(0xcbb5b0), stars: 0.06, night: 0.6, sunI: 1.3, hemiI: 1.2, glow: 0.9, runway: hex(0xffe6c0), label: 0.6 },
  { e: 2, zenith: hex(0x33558f), horizon: hex(0xf0b07a), haze: hex(0xc39c86), water: hex(0x3d5c82), land: hex(0x67664f), coast: hex(0xf4e2c6), coastA: 0.6, trail: hex(0xfff2dc), body: hex(0xf3e6d6), stars: 0, night: 0.35, sunI: 2.2, hemiI: 1.5, glow: 1, runway: hex(0xfff0d8), label: 0.62 },
  { e: 16, zenith: hex(0x2a69b0), horizon: hex(0xb7d6ec), haze: hex(0xa5c5dc), water: hex(0x3b74a2), land: hex(0x7b9675), coast: hex(0xeef5ea), coastA: 0.7, trail: hex(0xffffff), body: hex(0xf7f8f8), stars: 0, night: 0, sunI: 2.6, hemiI: 2.0, glow: 0.7, runway: hex(0xfffaf0), label: 0.66 },
];
// Morning light is cooler and pinker than evening light, so dawn has its own colours for the three twilight steps.
const DAWN = {
  '-5': { zenith: 0x141c40, horizon: 0x8a5a86, haze: 0x3c3a5a },
  '-1': { zenith: 0x27407a, horizon: 0xe8a0a0, haze: 0x7d6a86, coast: 0xdcc4cc, body: 0xcdb8c0, trail: 0xffe6e0 },
  '2': { zenith: 0x3f6aa8, horizon: 0xf6cdb0, haze: 0xc9aaa4, body: 0xf4e6de },
};
const KEYS_DAWN = KEYS.map((k) => { const d = DAWN[String(k.e)], o = Object.assign({}, k); if (d) for (const n of Object.keys(d)) o[n] = hex(d[n]); return o; });
const look = { zenith: hex(0), horizon: hex(0), haze: hex(0), water: hex(0), land: hex(0), coast: hex(0), trail: hex(0), body: hex(0), runway: hex(0), coastA: 0.6, stars: 0, night: 0, sunI: 1, hemiI: 1, glow: 0, label: 0.6 };
const sunDir = new THREE.Vector3(0, 1, 0), sunNow = { el: 0, az: 0, rise: 0.5 };
const LC = new THREE.Color(), WHITE = new THREE.Color(1, 1, 1);
const FIXED_SUN = { day: { el: 38, az: 150, rise: 0.5 }, dawn: { el: -2.2, az: 98, rise: 1 }, dusk: { el: -2.5, az: 262, rise: 0 }, night: { el: -30, az: 330, rise: 0 } };
function updateLook(lat, lon, date) {
  const sp = FIXED_SUN[S.sky] || sunPosition(date, lat, lon);
  sunNow.el = sp.el; sunNow.az = sp.az; sunNow.rise = sp.rise;
  const e = sp.el; let i = 0; while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const a = KEYS[i], b = KEYS[i + 1], a2 = KEYS_DAWN[i], b2 = KEYS_DAWN[i + 1], t = smooth(clamp((e - a.e) / (b.e - a.e), 0, 1));
  for (const k of ['zenith', 'horizon', 'haze', 'water', 'land', 'coast', 'trail', 'body', 'runway']) { look[k].copy(a[k]).lerp(b[k], t); LC.copy(a2[k]).lerp(b2[k], t); look[k].lerp(LC, sp.rise); }
  for (const k of ['coastA', 'stars', 'night', 'sunI', 'hemiI', 'glow', 'label']) look[k] = lerp(a[k], b[k], t);
  // weather: heavy cloud greys the sky and flattens the light, fog and falling rain or snow thicken the haze, lying snow whitens the land
  const W = wxNow, up = wxAlt(), day = 1 - look.night, heavy = smooth(clamp((W.cover - 0.45) / 0.55, 0, 1)), ov = heavy * up;
  LC.setRGB(lerp(0.035, 0.53, day), lerp(0.045, 0.57, day), lerp(0.06, 0.62, day)); look.zenith.lerp(LC, ov * 0.88);
  LC.setRGB(lerp(0.07, 0.7, day), lerp(0.08, 0.73, day), lerp(0.1, 0.77, day)); look.horizon.lerp(LC, ov * 0.85); look.haze.lerp(LC, ov * 0.8);
  look.stars *= 1 - clamp(W.cover * 1.25, 0, 1) * up; look.glow *= 1 - ov * 0.9; look.sunI *= 1 - heavy * 0.6;
  for (const c of [look.water, look.land]) { LC.setScalar(((c.r + c.g + c.b) / 3) * 0.94); c.lerp(LC, heavy * 0.42); }
  if (W.snowGround > 0.01) { LC.copy(look.body).multiplyScalar(0.92); look.land.lerp(LC, W.snowGround * 0.78); }
  scene.fog.density = 0.0024 * (1 + (1.4 * W.fog + 0.45 * Math.max(W.rain, W.snow)) * up);
  const su = sky.uniforms; su.cover.value = clamp(W.cover, 0, 1) * up;
  su.cloudLit.value.copy(look.body).multiplyScalar((1 - 0.62 * look.night) * (1 - 0.2 * heavy - 0.12 * Math.max(W.rain, W.snow)));
  su.cloudShade.value.copy(su.cloudLit.value).multiplyScalar(0.66).lerp(look.zenith, 0.22);
  const el = Math.max(sp.el, -6) * D2R, az = sp.az * D2R;
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  su.zenith.value.copy(look.zenith); su.horizon.value.copy(look.horizon); su.haze.value.copy(look.haze);
  su.sunDir.value.copy(sunDir); su.glow.value = look.glow;
  su.sunColor.value.set(1.0, lerp(0.62, 0.93, clamp(e / 20, 0, 1)), lerp(0.36, 0.8, clamp(e / 20, 0, 1)));
  if (sp.rise > 0.5 && e < 12) su.sunColor.value.lerp(LC.setRGB(1.0, 0.8, 0.74), (sp.rise - 0.5) * 2 * clamp(1 - e / 12, 0, 1) * 0.7);   // a rosier sun in the morning
  sky.starU.opacity.value = look.stars;
  scene.fog.color.copy(look.haze);
  ground.waterMat.color.copy(look.water); ground.landMat.color.copy(look.land);
  { // the photos darken with the drawn land at dusk and at night
    const lum = (c) => c.r * 0.3 + c.g * 0.59 + c.b * 0.11, k = Math.round(clamp(lum(look.land) / lum(DAY_LAND), 0.05, 1.15) * 100) / 100;
    if (k !== satK) { satK = k; sat.setTint(SAT_TINT.setScalar(k)); }
  }
  ground.coast.mat.uniforms.color.value.copy(look.coast); ground.coast.mat.uniforms.opacity.value = look.coastA;
  ground.borders.mat.uniforms.color.value.copy(look.coast); ground.borders.mat.uniforms.opacity.value = look.coastA * 0.22;
  ground.runways.mat.uniforms.color.value.copy(look.runway);
  ground.ring.mat.uniforms.color.value.copy(look.coast); ground.ring.mat.uniforms.opacity.value = 0.2;
  trails.mat.uniforms.color.value.copy(look.trail); drops.mat.uniforms.color.value.copy(look.trail);
  hemi.intensity = look.hemiI; hemi.color.copy(look.horizon).lerp(WHITE, 0.5); hemi.groundColor.copy(look.land).lerp(look.water, 0.5);
  sun.intensity = look.sunI; sun.color.copy(su.sunColor.value).lerp(WHITE, clamp(e / 25, 0, 1));
  for (const l of labels) l.sprite.material.opacity = look.label;
  for (const s of allLines) s.mat.uniforms.fogDensity.value = scene.fog.density;
  for (const s of ground.lines) s.mat.uniforms.fogDensity.value = scene.fog.density * 1.7;   // shore lines thin out sooner so the horizon stays calm
}

// ---------- weather ----------
// The real weather for the place on screen comes from the free Open-Meteo service. Only a rounded position is sent
// (the nearest quarter of a degree, about 17 miles), never anything from the antenna.
const WX_API = Q.get('wxApi') || 'https://api.open-meteo.com/v1/forecast';
const WX_CODES = {   // World Meteorological Organization weather codes: words, strength of rain, strength of snow
  0: ['Clear', 0, 0], 1: ['Mostly clear', 0, 0], 2: ['Partly cloudy', 0, 0], 3: ['Overcast', 0, 0], 45: ['Fog', 0, 0], 48: ['Freezing fog', 0, 0],
  51: ['Light drizzle', 0.15, 0], 53: ['Drizzle', 0.25, 0], 55: ['Heavy drizzle', 0.35, 0], 56: ['Freezing drizzle', 0.2, 0], 57: ['Freezing drizzle', 0.35, 0],
  61: ['Light rain', 0.35, 0], 63: ['Rain', 0.65, 0], 65: ['Heavy rain', 1, 0], 66: ['Freezing rain', 0.4, 0], 67: ['Heavy freezing rain', 0.8, 0],
  71: ['Light snow', 0, 0.35], 73: ['Snow', 0, 0.65], 75: ['Heavy snow', 0, 1], 77: ['Snow grains', 0, 0.25],
  80: ['Light showers', 0.4, 0], 81: ['Showers', 0.7, 0], 82: ['Heavy showers', 1, 0], 85: ['Snow showers', 0, 0.5], 86: ['Heavy snow showers', 0, 1],
  95: ['Thunderstorm', 0.9, 0], 96: ['Thunderstorm with hail', 1, 0], 99: ['Thunderstorm with hail', 1, 0],
};
// wind: miles an hour. from: the compass direction the wind blows from, in degrees.
const WX_PRESETS = {
  clear: {}, cloud: { cover: 0.55, wind: 8, from: 250 }, overcast: { cover: 1, wind: 6, from: 200 }, rain: { cover: 1, rain: 0.65, wind: 10, from: 110 },
  storm: { cover: 1, rain: 1, wind: 24, from: 210, storm: 1 }, snow: { cover: 1, snow: 0.7, wind: 7, from: 30, snowGround: 1 },
  wind: { cover: 0.3, wind: 32, from: 300 }, fog: { cover: 0.85, fog: 1, wind: 2, from: 90 },
};
const WXN = ['cover', 'rain', 'snow', 'fog', 'storm', 'snowGround', 'wE', 'wN'];
const wxNow = { cover: 0, rain: 0, snow: 0, fog: 0, storm: 0, snowGround: 0, wE: 0, wN: 0 }, wxTarget = Object.assign({}, wxNow);
const wxInfo = { ok: false, text: '', tempF: null, wind: 0, from: 0, gust: 0 };
const wxCache = new Map(); let wxBusy = false, wxLastCall = -1e9, wxSnap = true, flashT = -100, flashNext = 0;
function setWeather(w) {
  const mph = w.wind || 0, to = ((w.from || 0) + 180) * D2R;
  Object.assign(wxTarget, { cover: w.cover || 0, rain: w.rain || 0, snow: w.snow || 0, fog: w.fog || 0, storm: w.storm || 0, snowGround: w.snowGround || 0, wE: Math.sin(to) * mph, wN: Math.cos(to) * mph });
}
function readWeather(c) {
  const K = WX_CODES[c.weather_code] || ['', 0, 0], num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  let cover = num(c.cloud_cover) !== null ? c.cloud_cover / 100 : [0, 0.2, 0.5, 1][c.weather_code] || 0;
  if (K[1] > 0 || K[2] > 0) cover = Math.max(cover, 0.85);
  const vis = num(c.visibility), fog = Math.max(c.weather_code === 45 || c.weather_code === 48 ? 1 : 0, vis !== null ? clamp(1 - vis / 6000, 0, 1) * 0.8 : 0);
  return { cover, rain: K[1], snow: K[2], fog, storm: c.weather_code >= 95 ? 1 : 0, snowGround: clamp(Math.max((num(c.snow_depth) || 0) / 0.04, K[2] >= 0.6 ? 0.5 : 0), 0, 1),
    wind: num(c.wind_speed_10m) || 0, from: num(c.wind_direction_10m) || 0, gust: num(c.wind_gusts_10m) || 0, tempF: num(c.temperature_2m), text: K[0] };
}
function applyWeather() {
  if (S.wx !== 'real') { setWeather(WX_PRESETS[S.wx] || {}); wxInfo.ok = false; return; }
  const key = (Math.round(pose.lat * 4) / 4).toFixed(2) + ',' + (Math.round(pose.lon * 4) / 4).toFixed(2), hit = wxCache.get(key), t = nowS();
  if (hit && hit.w) { setWeather(hit.w); Object.assign(wxInfo, hit.w, { ok: true }); }
  if ((hit && t - hit.t < 600) || wxBusy || t - wxLastCall < 20 || MANUAL && !Q.has('wxApi')) return;
  wxBusy = true; wxLastCall = t; const [la, lo] = key.split(',');
  wxCache.set(key, { t, w: hit ? hit.w : null });
  getJSON(WX_API + '?latitude=' + la + '&longitude=' + lo + '&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,snow_depth&wind_speed_unit=mph&temperature_unit=fahrenheit')
    .then((d) => { if (d && d.current) wxCache.set(key, { t: nowS(), w: readWeather(d.current) }); })
    .catch(() => { const c = wxCache.get(key); if (c) c.t = nowS() - 480; if (!wxCache.get(key).w) wxInfo.ok = false; })   // try again in two minutes
    .then(() => { wxBusy = false; });
}
// How much of the weather the camera is under: all of it near the ground, none of it up at cruising height, above the clouds.
function wxAlt() { return 1 - smooth(clamp((pose.alt - 4) / 3.5, 0, 1)); }
function updateWeather(t, dt) {
  const k = wxSnap ? 1 : clamp(dt / 5, 0, 1); wxSnap = false;
  for (const n of WXN) wxNow[n] = lerp(wxNow[n], wxTarget[n], k);
  const up = wxAlt(), mph = Math.hypot(wxNow.wE, wxNow.wN), aspect = camera.aspect, day = 1 - look.night;
  // the part of the wind that blows across the picture, left to right, as the camera sees it
  const right = (pose.az - 90) * D2R, across = wxNow.wE * Math.sin(right) + wxNow.wN * Math.cos(right);
  weather.rain.set(dt, t, clamp(across / 26, -1.4, 1.4), -1, 2.3, wxNow.rain > 0.02 ? (0.1 + 0.9 * wxNow.rain) * up : 0, 0.22 + 0.3 * day, aspect);
  weather.snow.set(dt, t, clamp(across / 9, -2.5, 2.5), -1, 0.27 + 0.12 * wxNow.snow + Math.abs(across) / 60, wxNow.snow > 0.02 ? (0.12 + 0.88 * wxNow.snow) * up : 0, 0.5 + 0.4 * day, aspect);
  const windy = smooth(clamp((mph - 13) / 20, 0, 1)) * up * clamp(Math.abs(across) / Math.max(mph, 1) * 1.6, 0, 1);
  weather.wind.set(dt, t, across >= 0 ? 1 : -1, -0.05, 0.3 + mph / 40, windy > 0.02 ? 1 : 0, windy * (0.17 + 0.17 * day), aspect);
  const sd = sky.uniforms.drift.value; sd.x += (wxNow.wE * 0.0007 + 0.0012) * dt; sd.y -= wxNow.wN * 0.0007 * dt;
  // lightning: a soft double flicker in the cloud, never a hard flash
  if (wxNow.storm > 0.5 && up > 0.3 && t > flashNext) { flashT = t; flashNext = t + 7 + Math.random() * 16; }
  const ft = t - flashT, f = ft < 0 || ft > 2 ? 0 : Math.exp(-ft * 9) + (ft > 0.22 ? 0.7 * Math.exp(-(ft - 0.22) * 7) : 0);
  sky.uniforms.flash.value = f * 0.5 * up; hemi.intensity = look.hemiI * (1 + f * 0.5 * up);
}

// ---------- the time, the sun and the weather, in words in the corner ----------
const fmtClock = (d) => (d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase() : '');
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const sunDay = { key: '', rise: null, set: null };
function updateCorner(date) {
  const el = $('corner'); el.classList.toggle('on', !!S.corner); if (!S.corner) return;
  const key = date.toDateString() + '|' + (Math.round(pose.lat * 2) / 2) + '|' + (Math.round(pose.lon * 2) / 2);
  if (sunDay.key !== key) { Object.assign(sunDay, sunTimes(date, pose.lat, pose.lon), { key }); }
  const e = sunNow.el, phase = S.sky !== 'real' ? 'Sky held at ' + S.sky : e >= 3 ? 'Daytime' : e < -6 ? 'Nighttime' : sunNow.rise > 0.5 ? 'Dawn' : 'Dusk';
  const set = (id, text) => { const n = $(id); if (n._t !== text) { n._t = text; n.textContent = text; n.hidden = !text; } };
  set('k-time', fmtClock(date)); set('k-phase', phase);
  set('k-sun', sunDay.rise && sunDay.set ? 'Sunrise ' + fmtClock(sunDay.rise) + '   Sunset ' + fmtClock(sunDay.set) : '');
  let w = '';
  if (S.wx !== 'real') w = S.wx === 'clear' ? '' : 'Weather held at ' + ({ cloud: 'partly cloudy', storm: 'thunderstorm', wind: 'windy' }[S.wx] || S.wx);
  else if (wxInfo.ok) {
    w = (wxInfo.tempF !== null ? Math.round(wxInfo.tempF) + '° ' : '') + wxInfo.text;
    w += wxInfo.wind < 3 ? ', calm' : ', wind from the ' + COMPASS[Math.round(wxInfo.from / 45) % 8] + ' at ' + Math.round(wxInfo.wind) + ' mph';
    if (wxInfo.gust > wxInfo.wind + 9) w += ', gusts to ' + Math.round(wxInfo.gust);
  }
  set('k-wx', w);
  if (__NET__) {
    // While the sky shown is far from the receiver, count only the aircraft around it, so the antenna's own aircraft back home
    // are not counted as if they were here, and say that the antenna is far away
    const t = nowS(), reach = netRadiusNm() * 1.852 * 1.25, mid = netCenter(), away = !!(dataBase && home && gcDist(mid.lat, mid.lon, home.lat, home.lon) > reach);
    let ant = 0, nw = 0;
    for (const p of planes.values()) if (p.fresh(t) && !p.remote && (!away || gcDist(mid.lat, mid.lon, p.lat, p.lon) < reach)) { if (p.tAnt && t - p.tAnt < 20) ant++; else nw++; }
    const pl = (n) => n + (n === 1 ? ' aircraft' : ' aircraft');
    const far = away && ant === 0;   // say the antenna is far away only when it hears nothing around the sky shown
    set('k-src', S.src === 'antenna' ? (dataBase ? (far ? ANT[0].toUpperCase() + ANT.slice(1) + ' is far from here' : pl(ant) + ' heard by ' + ANT) : '') : !dataBase || S.src === 'network' ? (netAnswering() ? pl(nw) + ' from the flight network' : '') : far ? (netAnswering() ? pl(nw) + ' from the flight network, ' + ANT + ' is far from here' : ANT[0].toUpperCase() + ANT.slice(1) + ' is far from here') : netAnswering() ? ant + ' by ' + ANT + ', ' + nw + ' more from the flight network' : pl(ant) + ' heard by ' + ANT);
  }
}

// ---------- aircraft ----------
const planes = new Map();
const pendingHistory = new Map();
let clockOffset = null;            // receiver clock seconds minus page seconds
const MANUAL = Q.get('clock') === 'manual'; let vt = 0, fakeT = null;   // test hook: lets a test drive time step by step
const nowS = () => (MANUAL ? vt : performance.now() / 1000);
const TV = new THREE.Vector3();

class Plane {
  constructor(hexId) {
    this.hex = hexId; this.flight = ''; this.lat = null; this.lon = null; this.altFt = 0; this.gs = 0; this.track = 0; this.vrate = 0; this.turn = 0;
    this.tPos = 0; this.tSeen = nowS(); this.ground = false; this.category = ''; this.type = ''; this.reg = ''; this.desc = '';
    this.err = [0, 0, 0]; this.derr = [0, 0, 0]; this.vel = [0, 0, 0]; this.tErr = -100; this.rLat = 0; this.rLon = 0; this.rAlt = 0; this.rHdg = 0; this.rPitch = 0; this.rRoll = 0;
    this.hdgVel = 0; this.opacity = 0; this.born = nowS(); this.trail = []; this.mesh = null; this.kind = null; this.remote = false; this.pos = new THREE.Vector3(); this.info = null;
  }
  callsign() { return (this.flight || '').trim(); }
  extrap(t, out) {
    const dt = clamp(t - this.tPos, 0, 40), d = this.gs * KT * dt, trk = (this.track + this.turn * dt * 0.5) * D2R;
    out[0] = this.lat + (d * Math.cos(trk)) / 111.19; out[1] = this.lon + (d * Math.sin(trk)) / (111.19 * Math.cos(this.lat * D2R));
    out[2] = Math.max(0, this.altFt + clamp(this.vrate * dt / 60, -3000, 3000)) * FT; return out;
  }
  report(ac, tPos) {
    const t = nowS(), had = this.lat !== null, before = had ? this.render(t, [0, 0, 0]) : null;
    const newTrack = ac.track != null ? ac.track : (ac.true_heading != null ? ac.true_heading : this.track);
    if (had && tPos > this.tPos + 0.5) { const w = angDiff(this.track, newTrack) / (tPos - this.tPos); this.turn = clamp(lerp(this.turn, w, 0.5), -3.5, 3.5); if (Math.abs(this.turn) < 0.15) this.turn = 0; }
    this.lat = ac.lat; this.lon = ac.lon; this.track = newTrack; this.gs = ac.gs != null ? ac.gs : (ac.tas != null ? ac.tas : this.gs);
    const alt = ac.alt_baro === 'ground' ? 'ground' : (ac.alt_baro != null ? ac.alt_baro : ac.alt_geom);
    this.ground = alt === 'ground'; this.altFt = this.ground ? 0 : (typeof alt === 'number' ? alt : this.altFt);
    this.vrate = ac.baro_rate != null ? ac.baro_rate : (ac.geom_rate != null ? ac.geom_rate : 0);
    this.tPos = tPos;
    if (before) {
      // carry both the position and the speed across the new report, so nothing ever lurches
      const e = this.extrap(t, [0, 0, 0]), trk = this.track * D2R, sp = this.gs * KT;
      const dn = (before[0] - e[0]) * 111.19, de = (before[1] - e[1]) * 111.19 * Math.cos(this.lat * D2R), da = before[2] - e[2];
      if (Math.hypot(dn, de) < 6) {
        this.err = [dn, de, da]; this.tErr = t;
        const lim = (v) => clamp(v, -0.12, 0.12);
        this.derr = this.velOk ? [lim(this.vel[0] - sp * Math.cos(trk)), lim(this.vel[1] - sp * Math.sin(trk)), lim(this.vel[2] - (this.vrate * FT) / 60)] : [0, 0, 0];
      } else { this.err = [0, 0, 0]; this.derr = [0, 0, 0]; this.trail.length = 0; }
    } else { this.rHdg = this.track; }
  }
  render(t, out) {
    this.extrap(t, out);
    const T = 2.2, u = (t - this.tErr) / T;
    if (u < 1) {
      const h0 = 2 * u * u * u - 3 * u * u + 1, h1 = (u * u * u - 2 * u * u + u) * T;
      const n = this.err[0] * h0 + this.derr[0] * h1, e = this.err[1] * h0 + this.derr[1] * h1, a = this.err[2] * h0 + this.derr[2] * h1;
      out[0] += n / 111.19; out[1] += e / (111.19 * Math.cos(out[0] * D2R)); out[2] += a;
    }
    return out;
  }
  fresh(t) { return this.lat !== null && t - this.tPos < (this.remote ? 45 : this.src === 'net' ? 30 : 20); }
}

const ARR3 = [0, 0, 0], P_F = new THREE.Vector3(), P_C = new THREE.Vector3();
const P_E = new THREE.Vector3(), P_N = new THREE.Vector3(), P_U = new THREE.Vector3(), P_Nn = new THREE.Vector3(), P_M = new THREE.Matrix4(), P_Q = new THREE.Quaternion(), P_QL = new THREE.Quaternion(), P_EU = new THREE.Euler();
function updatePlane(p, t, dt, night) {
  const target = p.fresh(t) ? 1 : 0;
  p.opacity = clamp(p.opacity + (target - p.opacity > 0 ? dt / 2.5 : -dt / 3.5), 0, 1);
  if (p.lat === null) return;
  p.render(t, ARR3);
  const gap = t - (p.tFrame || 0);   // true time since this aircraft was last drawn; a long gap means the speed estimate cannot be trusted
  if (gap > 0 && gap < 0.3) { p.vel[0] = ((ARR3[0] - p.rLat) * 111.19) / gap; p.vel[1] = ((ARR3[1] - p.rLon) * 111.19 * Math.cos(ARR3[0] * D2R)) / gap; p.vel[2] = (ARR3[2] - p.rAlt) / gap; p.velOk = true; } else p.velOk = false;
  p.tFrame = t; p.rLat = ARR3[0]; p.rLon = ARR3[1]; p.rAlt = ARR3[2];
  const hd = p.track + p.turn * clamp(t - p.tPos, 0, 20);
  { // heading eases like a weighted needle, so the camera that rides on it never twitches when a new report lands
    const om = 2 / 1.3, x = om * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x), ch = -angDiff(p.rHdg, hd), tmp = (p.hdgVel + om * ch) * dt;
    p.hdgVel = (p.hdgVel - om * tmp) * ex; p.rHdg = hd + (ch + tmp) * ex;
  }
  const climb = Math.atan2((p.vrate * FT / 60) * VEX, Math.max(p.gs * KT, 0.03));
  p.rPitch = lerp(p.rPitch, clamp(climb, -0.35, 0.35), clamp(dt * 1.2, 0, 1));
  const bank = Math.atan((p.gs * KT * 1000 * p.turn * D2R) / 9.81);
  p.rRoll = lerp(p.rRoll, clamp(bank, -0.6, 0.6), clamp(dt * 1.2, 0, 1));
  project(p.rLat, p.rLon, p.rAlt, p.pos);
  if (!p.mesh) {
    const kind = modelFor(p.category, p.type);
    p.mesh = new PlaneMesh(kind, paintFor(p.callsign(), p.hex, kind)); p.kind = kind; p.paintKey = p.callsign() + '|' + kind; planeLayer.add(p.mesh.group);
  } else if (p.paintKey !== p.callsign() + '|' + modelFor(p.category, p.type) && t - (p.tPaint || 0) > 5) {
    // the callsign or the aircraft type often arrives a few seconds after the first position, so repaint once it is known.
    // The new shape goes on at once, even with the camera riding on this aircraft (version 3.9): the camera's distance
    // follows the new size slowly (camLen below), so the view never jumps.
    p.tPaint = t; const kind = modelFor(p.category, p.type);
    if (kind !== p.kind) { planeLayer.remove(p.mesh.group); p.mesh.dispose(); p.mesh = new PlaneMesh(kind, paintFor(p.callsign(), p.hex, kind)); p.kind = kind; planeLayer.add(p.mesh.group); }
    else { const c = paintFor(p.callsign(), p.hex, kind); p.mesh.paint.forEach((col, i) => col.set(c[i])); }
    p.paintKey = p.callsign() + '|' + p.kind;
  }
  // An aircraft heard without its type: look it up in the receiver's tables, so it has its own shape before the camera comes to it.
  // This is checked every frame, not only when the shape is first made, because the tables may still be loading when the
  // first aircraft are drawn. dbLookup marks the aircraft (p.info) at once, so each one is looked up only once.
  if (!p.type && !p.info && db) dbLookup(p);
  p.camLen = p.camLen ? lerp(p.camLen, p.mesh.len, clamp(dt * 0.5, 0, 1)) : p.mesh.len;   // the size the camera keeps its distance by, easing to a new shape over a few seconds
  const g = p.mesh.group; g.position.copy(p.pos);
  const dist = camera.position.distanceTo(p.pos);
  const L = 0.264 * Math.pow(Math.max(dist, 0.5), 0.485) * p.mesh.len;
  g.scale.setScalar(L); p.size = L;
  localFrame(p.rLat, p.rLon, p.rAlt, p.pos, P_E, P_N, P_U); P_M.makeBasis(P_E, P_U, P_Nn.copy(P_N).negate()); P_Q.setFromRotationMatrix(P_M);
  P_EU.set(-p.rPitch, Math.PI - p.rHdg * D2R, -p.rRoll, 'YXZ'); g.quaternion.copy(P_Q).multiply(P_QL.setFromEuler(P_EU));
  // Landing lights. The receiver does not say whether they are on, so they are judged from the flight itself: they come on when an
  // aircraft is descending below 5,000 feet and stay on until it climbs away. They show only at dusk, at night and at dawn.
  if (p.ground || p.altFt > 5500 || p.vrate > 500) p.landOn = false; else if (p.altFt < 5000 && p.vrate < -200) p.landOn = true;
  const wantLights = S.lights === 'off' ? 0 : (p.landOn || (S.lights === 'both' && !p.ground && p.altFt < 5000 && p.altFt > 0)) ? smooth(clamp((night - 0.2) / 0.3, 0, 1)) : 0;
  p.landLevel = lerp(p.landLevel || 0, wantLights, clamp(dt * 1.5, 0, 1)); if (p.landLevel < 0.005) p.landLevel = 0;
  let ahead = 0; if (p.landLevel > 0) { P_F.set(0, 0, 1).applyQuaternion(g.quaternion); ahead = P_F.dot(P_C.copy(camera.position).sub(p.pos).normalize()); }
  p.mesh.update(t, p.opacity, night, look.body, clamp((dist - 20) / 150, 0, 1), p.landLevel, ahead);
  // trail samples
  const last = p.trail[p.trail.length - 1];
  if (p.fresh(t) && (!last || t - last.t > 2.5)) p.trail.push({ t, lat: p.rLat, lon: p.rLon, alt: p.rAlt, v: new THREE.Vector3(), ep: -1 });
  const maxAge = Math.max(S.trail, 0.01) * 60; while (p.trail.length && t - p.trail[0].t > 660) p.trail.shift();
  p.trailAge = maxAge;
}
function removePlane(p) { if (p.mesh) { planeLayer.remove(p.mesh.group); p.mesh.dispose(); } planes.delete(p.hex); }

// kind 0: this receiver's own antenna. kind 1: one followed flight looked up on the internet. kind 2: the flight network's list for an area.
function ingest(list, serverNow, kind = 0) {
  const t = nowS(), remote = kind === 1, area = kind === 2;
  if (kind === 0) { const off = serverNow - t; clockOffset = clockOffset === null ? off : (Math.abs(off - clockOffset) > 5 ? off : lerp(clockOffset, off, 0.05)); }
  if (__NET__ && kind === 0 && S.src === 'network') return;
  for (const ac of list) {
    if (!ac.hex || ac.hex[0] === '~') continue;
    let p = planes.get(ac.hex);
    if (!p) {
      if (ac.lat == null) continue;
      p = new Plane(ac.hex); planes.set(ac.hex, p); p.src = kind === 0 ? 'ant' : 'net';
      const h = pendingHistory.get(ac.hex); if (h) { p.trail = h; pendingHistory.delete(ac.hex); }
    }
    // names and types are welcome from anywhere, even for an aircraft the antenna is tracking
    if (ac.flight) p.flight = ac.flight; if (ac.category) p.category = ac.category;
    if (ac.t) p.type = ac.t; if (ac.r) p.reg = ac.r; if (ac.desc) p.desc = ac.desc;
    if (remote && !p.remote && p.fresh(t)) continue;         // the antenna's own data wins while it has the aircraft
    if (area && p.src === 'ant' && t - p.tPos < 6) continue;   // the same rule for the flight network: it only fills in what the antenna is not hearing
    if (area && p.remote && p.fresh(t)) p.remote = false;
    if (!area) p.remote = remote;
    p.tSeen = t;
    if (ac.lat != null && ac.lon != null) {
      const tPos = t - (ac.seen_pos != null ? ac.seen_pos : 0);
      if (kind === 0) p.tAnt = t;   // the antenna heard this aircraft just now, whichever source ends up drawing it
      if (tPos > p.tPos + 0.05) { p.report(ac, tPos); p.src = kind === 0 ? 'ant' : 'net'; }
    }
  }
}

// ---------- the flight network (network edition only) ----------
// A free community network of receivers. It is asked only for the aircraft around the place on screen, every few seconds.
// Nothing from this receiver's antenna is sent to it.
const NET_CAP = 130;
// Web browsers are not allowed to read these flight networks directly, because the networks do not give pages that permission.
// So the page goes through a relay: a small helper on the receiver (relay/relay.py) that fetches the list over the home
// internet connection and hands it on. The relay has to run at home, because the networks turn away shared cloud hosting.
// Unless another address is typed into the settings, the page looks for the relay on the receiver it was opened from, port 8099.
const DEFAULT_RELAY = '';
const relayBase = () => {
  const r = (Q.get('relay') || S.relay || DEFAULT_RELAY || '').trim().replace(/\/+$/, ''); if (/^(https?:\/\/|\/)/.test(r)) return r;
  if (!location.hostname || /github\.io$/.test(location.hostname)) return '';   // a plain copy on a file host has no relay beside it
  return location.protocol === 'https:' ? location.origin + '/sky-relay' : 'http://' + location.hostname + ':8099';   // through a secure tunnel the relay sits under the same address
};
const point = (base) => (la, lo, r) => base + 'point/' + la + '/' + lo + '/' + r;
function netSources() {
  const direct = [
    { name: 'ADSB.lol', every: 5, url: point(Q.get('netApi') || 'https://api.adsb.lol/v2/') },
    { name: 'airplanes.live', every: 10, url: point('https://api.airplanes.live/v2/') },
    { name: 'adsb.fi', every: 10, url: (la, lo, r) => 'https://opendata.adsb.fi/api/v2/lat/' + la + '/lon/' + lo + '/dist/' + r },
  ];
  const rb = Q.has('netApi') && !Q.has('relay') ? '' : relayBase(); return rb ? [{ name: 'the relay', every: 5, url: point(rb + '/v2/') }].concat(direct) : direct;
}
const net = { i: 0, ok: null, last: -1e9, lastGood: -1e9, fails: 0, busy: false, name: '', left: 0 };
const NET_WAIT_MS = 15000;   // a question to the flight network not answered by then is given up
// the network counts as answering only while an answer came in the last 40 seconds, whatever is still on its way
const netAnswering = () => net.ok === true && nowS() - net.lastGood < 40;
// When several people watch the same sky the relay hands out one shared answer and says how many seconds old it is.
// Adding that to each aircraft's own age puts it where it is now, not where it was.
function aged(list, d) { const age = +d.relay_age || 0; if (age > 0) for (const a of list) a.seen_pos = (a.seen_pos || 0) + age; return list; }
// the middle of the area asked about: the centre of the sky, or a followed flight once it has left that area
function netCenter() { const far = followOwns() && gcDist(C.lat, C.lon, pose.lat, pose.lon) > 60; return far ? { lat: pose.lat, lon: pose.lon } : { lat: C.lat, lon: C.lon }; }
function netRadiusNm() { const mi = S.radius > 0 ? Math.max(S.radius * 1.5, 40) : 140; return Math.round(clamp(mi * 0.869, 35, 130)); }
async function netTick(force) {
  if (!__NET__ || S.src === 'antenna' || net.busy || (!MANUAL && document.hidden)) return;
  const list0 = netSources(), t = nowS();
  // The relay at home is the way that works best: a network asked straight from the browser is a stand-in for a short while only,
  // so go back to the relay a minute after leaving it
  if (net.i % list0.length !== 0 && list0[0].name === 'the relay' && t - net.left > 60) { net.i = 0; net.fails = 0; }
  const src = list0[net.i % list0.length]; if (!force && t - net.last < src.every) return;
  net.busy = true; net.last = t;
  // ask around the centre of the sky, or around a followed flight once it has left that area
  const { lat: la, lon: lo } = netCenter();
  try {
    // The question is rounded to a tenth of a degree, about seven miles, and reaches a little wider to make up for it. So the exact
    // spot on screen, which may be somebody's house, never leaves this browser, and people watching the same area share one answer.
    // An answer that never comes would hold every later question back for good, while the corner still showed the network as
    // working (a computer waking from sleep, or a connection the tunnel dropped, can leave a question hanging), so give up after 15 seconds.
    const stop = typeof AbortController === 'function' ? new AbortController() : null, timer = stop && setTimeout(() => stop.abort(), NET_WAIT_MS);
    let d; try { d = await getJSON(src.url((Math.round(la * 10) / 10).toFixed(1), (Math.round(lo * 10) / 10).toFixed(1), netRadiusNm() + 5) + (MANUAL && fakeT ? '?t=' + fakeT : ''), stop ? { signal: stop.signal } : null); } finally { if (timer) clearTimeout(timer); }
    const list = (d.ac || d.aircraft || []).filter((a) => a && a.lat != null && a.lon != null && a.alt_baro !== 'ground');
    aged(list, d);
    for (const a of list) a._d = gcDist(la, lo, a.lat, a.lon);
    list.sort((x, y) => x._d - y._d);
    if (S.src !== 'antenna') ingest(list.slice(0, clamp(Math.round(S.netmax) || NET_CAP, 10, NET_CAP)), 0, 2);   // the nearest ones, up to the limit chosen in the settings
    net.ok = true; net.fails = 0; net.lastGood = nowS(); net.name = src.name;
  } catch (e) {
    net.fails++; if (nowS() - net.lastGood > 40) net.ok = false;
    if (net.fails >= 2 && !Q.has('netApi')) { if (net.i % list0.length === 0) net.left = nowS(); net.i = (net.i + 1) % list0.length; net.fails = 0; }   // try the next one
  }
  net.busy = false;
}

// ---------- receiver data ----------
const DATA_BASES = Q.has('data') ? [Q.get('data')] : ['/tar1090/data/', '/data/', '/skyaware/data/', 'data/'];
let dataBase = null, lastGood = 0, pollFails = 0, tarBase = Q.get('tar') || '/tar1090/';
async function getJSON(url, opts) { const r = await fetch(url, Object.assign({ cache: 'no-store' }, opts || {})); if (!r.ok) throw new Error(r.status); return r.json(); }
async function poll() {
  try {
    if (!dataBase) {
      for (const b of DATA_BASES) { try { const d = await getJSON(b + 'aircraft.json'); if (d && d.aircraft) { dataBase = b; ingest(d.aircraft, d.now); lastGood = nowS(); afterFirstData(); break; } } catch (e) { /* try the next place */ } }
    } else { const d = await getJSON(dataBase + 'aircraft.json'); ingest(d.aircraft, d.now); lastGood = nowS(); }
  } catch (e) { /* shown by the status line */ }
  if (!dataBase) pollFails++;
  setTimeout(poll, dataBase ? 1000 : 4000);
}
let db = null;   // aircraft type and airline tables kept by the tar1090 map page
async function afterFirstData() {
  try { const r = await getJSON(dataBase + 'receiver.json'); if (r && typeof r.lat === 'number' && typeof r.lon === 'number') { home = { lat: r.lat, lon: r.lon }; buildCenterOptions(); if (S.center === 'HOME') applyCenter(false); } } catch (e) { /* no home position */ }
  loadHistory();
  try {
    const v = await getJSON(tarBase + 'version.json'); const folder = tarBase + 'db-' + v.databaseVersion + '/';
    db = { folder, shards: {}, types: null, ops: null };
    getJSON(folder + 'icao_aircraft_types2.js', { cache: 'default' }).then((d) => { db.types = d; }).catch(() => {});
    getJSON(folder + 'operators.js', { cache: 'default' }).then((d) => { db.ops = d; }).catch(() => {});
  } catch (e) { db = null; }
}
async function loadHistory() {
  try {
    const base = tarBase + 'chunks/'; const c = await getJSON(base + 'chunks.json'); const names = (c.chunks || []).slice(-6);
    const t = nowS();
    for (const name of names) {
      let d; try { d = await getJSON(base + name); } catch (e) { continue; }
      for (const f of d.files || []) {
        if (!f || !f.aircraft || clockOffset === null) continue;
        for (const a of f.aircraft) {
          if (!Array.isArray(a) || a[4] == null || a[5] == null || typeof a[1] !== 'number') continue;
          const ts = f.now - (a[6] || 0) - clockOffset; if (t - ts > 620 || ts > t) continue;
          const s = { t: ts, lat: a[4], lon: a[5], alt: a[1] * FT, v: new THREE.Vector3(), ep: -1 };
          const p = planes.get(a[0]); let arr = p ? (p._hist || (p._hist = [])) : pendingHistory.get(a[0]);
          if (!arr) { arr = []; pendingHistory.set(a[0], arr); }
          arr.push(s);
        }
      }
    }
    const tidy = (arr) => { arr.sort((x, y) => x.t - y.t); return arr.filter((s, i) => i === 0 || s.t - arr[i - 1].t > 1); };
    for (const p of planes.values()) if (p._hist) { const first = p.trail.length ? p.trail[0].t : Infinity; p.trail = tidy(p._hist.filter((s) => s.t < first)).concat(p.trail); p._hist = null; }
    for (const [k, arr] of pendingHistory) pendingHistory.set(k, tidy(arr));
  } catch (e) { /* no history available, trails simply start now */ }
}
async function dbLookup(p) {
  if (p.info) return p.info; const info = p.info = { type: p.type, reg: p.reg, long: p.desc };
  if (db && (!info.type || !info.long)) {
    try {
      const icao = p.hex.toUpperCase();
      for (let level = 1; level <= 5; level++) {
        const bkey = icao.slice(0, level), dkey = icao.slice(level);
        const data = await (db.shards[bkey] || (db.shards[bkey] = getJSON(db.folder + bkey + '.js', { cache: 'default' }).catch((err) => { delete db.shards[bkey]; throw err; })));
        if (data[dkey]) { const e = data[dkey]; info.reg = info.reg || e[0] || ''; info.type = info.type || e[1] || ''; info.long = info.long || e[3] || ''; break; }
        if (!(data.children && data.children.indexOf(bkey + dkey[0]) !== -1)) break;
      }
    } catch (e) { /* unknown aircraft */ }
  }
  if (!info.long && info.type && db && db.types && db.types[info.type]) info.long = db.types[info.type][0];
  if (info.type && !p.type) { p.type = info.type; }
  return info;
}
function airlineName(cs) {
  if (!/^[A-Z]{3}\d/.test(cs)) return '';
  const k = cs.slice(0, 3); if (AIRLINES[k]) return AIRLINES[k][1];
  if (db && db.ops && db.ops[k] && db.ops[k].n) return db.ops[k].n;
  return '';
}

// ---------- routes and far-away positions from the internet ----------
const ROUTE_APIS = Q.has('routeApi') ? Q.get('routeApi').split(',').filter(Boolean) : ['https://adsb.im/api/0/routeset', 'https://api.adsb.lol/api/0/routeset'];
const POS_API = Q.get('posApi') || 'https://api.adsb.lol/v2/';
const routes = new Map();
// a route worth keeping: two or more airports, and not marked by the service as impossible for where the aircraft is
const goodRoute = (rt) => rt && Array.isArray(rt._airports) && rt._airports.length >= 2 && rt._airports.every((a) => a && typeof a === 'object') && rt.plausible !== false ? rt : null;
// Each route service keeps its own table, so a flight one of them does not know is asked of the next one too.
// Web browsers may not be allowed to read the route services directly (the same rule that keeps them from the flight
// networks), so a page with a relay beside it asks the relay first (version 3.9), and the relay asks them from home.
// Only when the relay cannot answer does the page ask the services itself.
const routeRelay = () => (Q.has('routeApi') ? '' : relayBase());
async function askRoutes(list) {   // list: [{ callsign, lat, lng }]. Returns the routes found by callsign, and the callsigns a service answered for, found or not.
  const got = new Map(), answered = new Set(); let left = list;
  const rb = routeRelay();
  if (rb) {
    const parts = []; for (let i = 0; i < left.length; i += 10) parts.push(left.slice(i, i + 10));
    let settled = new Set();
    await Promise.all(parts.map(async (part) => {
      try {
        const items = part.map((w) => w.callsign + ',' + w.lat.toFixed(2) + ',' + w.lng.toFixed(2)).join(';');
        const arr = await getJSON(rb + '/routes/' + items); if (!Array.isArray(arr)) return;
        for (const x of arr) {
          if (!x || !part.some((w) => w.callsign === x.callsign)) continue;
          settled.add(x.callsign); answered.add(x.callsign); const good = goodRoute(x); if (good) got.set(x.callsign, good);
        }
      } catch (e) { /* the relay is not there or could not ask: the page asks the services itself */ }
    }));
    left = left.filter((w) => !settled.has(w.callsign));   // a flight the relay answered for, found or not, is settled
  }
  if (!left.length) return { got, answered };
  for (const url of ROUTE_APIS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ planes: left }) });
      if (!r.ok) continue; const arr = await r.json(); if (!Array.isArray(arr)) continue; for (const w of left) answered.add(w.callsign);   // a service that answers, answers for every flight it was asked about
      const one = left.length === 1 ? arr.find((x) => x && x.callsign === left[0].callsign) || arr[0] : null;
      for (const x of one ? [Object.assign({}, one, { callsign: left[0].callsign })] : arr) {
        if (!x || !x.callsign) continue; const good = goodRoute(x); if (good && left.some((w) => w.callsign === x.callsign)) got.set(x.callsign, good);
      }
      left = left.filter((w) => !got.has(w.callsign)); if (!left.length) break;
    } catch (e) { /* try the next service */ }
  }
  return { got, answered };
}
async function getRoute(p) {
  const cs = p.callsign(); if (!cs || !/^[A-Z]{2,3}\d/.test(cs)) return null;
  const c = routes.get(cs); if (c && nowS() < c.until) return c.route;
  routes.set(cs, { route: c ? c.route : null, until: nowS() + 30 });
  const { got, answered } = await askRoutes([{ callsign: cs, lat: +p.rLat.toFixed(3), lng: +p.rLon.toFixed(3) }]);
  const good = got.get(cs);
  if (good) { routes.set(cs, { route: good, until: nowS() + 6 * 3600 }); return good; }
  if (answered.has(cs)) routes.set(cs, { route: null, until: nowS() + 600 });
  return null;
}
// The part of a route to show. A flight number can make stops (Los Angeles, New York, Boston), so an aircraft low to the ground
// has to be near one of its airports, and then the leg it is on is shown: from the stop before when it is coming down, to the
// next stop when it is climbing away. The route table is kept by volunteers and airlines reuse flight numbers, so a low
// aircraft near none of its airports has another flight's route on file, and nothing is shown.
function routeLeg(rt, p) {
  const leg = pickLeg(rt, p);
  return leg && leg[0] && leg[1] && typeof leg[0] === 'object' && typeof leg[1] === 'object' ? leg : null;   // never an airport that is missing
}
function pickLeg(rt, p) {
  const ap = rt && rt._airports; if (!ap || ap.length < 2) return null;
  const first = ap[0], last = ap[ap.length - 1];
  if (p.ground || p.altFt >= 6000) return [first, last];
  let at = -1, best = 120;
  ap.forEach((a, i) => { if (!a || !isFinite(a.lat) || !isFinite(a.lon)) return; const d = gcDist(a.lat, a.lon, p.rLat, p.rLon); if (d <= best) { best = d; at = i; } });
  if (at === -1) return null;
  if (ap.length === 2) return [first, last];
  if (at > 0 && (p.vrate < -200 || at === ap.length - 1)) return [ap[at - 1], ap[at]];
  if (at < ap.length - 1 && (p.vrate > 300 || at === 0)) return [ap[at], ap[at + 1]];
  return [first, last];
}
const follow = { want: '', reg: '', hex: null, lastRemote: 0, state: 'off', since: 0, netOk: true, tour: false };   // tour: the viewer pressed A, so the followed flight waits
// Follow has the camera only while a flight is found and the viewer has not paused it with A
function followOwns() { return follow.state === 'on' && !follow.tour; }
function parseFlight(s) {
  s = (s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!s) return '';
  const m = s.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/); if (m && IATA2ICAO[m[1]] && !/^[A-Z]{3}/.test(s)) return IATA2ICAO[m[1]] + m[2];
  return s;
}
function setFollow(text) {
  // a tail number written with a dash (9H-ABC, C-GABC) keeps it for the flight networks' registration question, which needs it
  const dashed = String(text || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  follow.tour = false; follow.want = parseFlight(text); follow.reg = /^[A-Z0-9]{1,3}-[A-Z0-9]{1,5}$/.test(dashed) ? dashed : ''; follow.hex = null; follow.state = follow.want ? 'looking' : 'off'; follow.since = nowS(); follow.lastRemote = 0;
  S.follow = follow.reg || follow.want; save(); $('f-flight').value = S.follow; $('f-stop').hidden = !follow.want;
  const o = cameraOwner(); if (follow.want && (o === 'lock' || o === 'fly')) leaveControls();   // a flight the viewer asks to follow takes the camera from a locked aircraft or fly mode

}
// Follow and the watch list recognize an aircraft the same way: callsign, reported registration, registration from the
// aircraft table, or hex code, with dashes ignored
const bareReg = (r) => String(r || '').toUpperCase().replace(/-/g, '');
function planeMatches(p, bare) { return p.callsign() === bare || bareReg(p.reg) === bare || bareReg(p.info && p.info.reg) === bare || p.hex.toUpperCase() === bare; }
function matchFollow() {
  const w = bareReg(follow.want), t = nowS(); let best = null;
  for (const p of planes.values()) { if (!p.fresh(t)) continue; if (planeMatches(p, w)) { if (!best || (best.remote && !p.remote)) best = p; } }
  return best;
}
async function followTick() {
  if (!follow.want) return; const t = nowS();
  const p = matchFollow();
  if (p) { follow.hex = p.hex; follow.state = 'on'; }
  const needNet = !p || p.remote;
  if (needNet && t - follow.lastRemote > (p ? 5 : 12)) {
    follow.lastRemote = t;
    try {
      const posApi = __NET__ && relayBase() && !Q.has('posApi') ? relayBase() + '/v2/' : POS_API;
      const d = await getJSON(posApi + 'callsign/' + encodeURIComponent(follow.want) + (MANUAL && fakeT ? '?t=' + fakeT : '')); follow.netOk = true;
      let ac = aged((d.ac || d.aircraft || []).filter((a) => a.lat != null), d);
      if (!ac.length && (follow.reg || /^[A-Z]-?[A-Z0-9]{3,5}$|^N\d/.test(follow.want))) { const d2 = await getJSON(posApi + 'reg/' + encodeURIComponent(follow.reg || follow.want)); ac = aged((d2.ac || d2.aircraft || []).filter((a) => a.lat != null), d2); }
      if (ac.length) ingest([ac[0]], 0, 1);
    } catch (e) { follow.netOk = false; }
  }
  if (follow.state === 'on' && !p) {
    const old = follow.hex && planes.get(follow.hex);
    if (!old || t - old.tPos > 90) { follow.state = 'looking'; follow.since = t; }
  }
}

// ---------- watch list (version 3.7) ----------
// Each aircraft on the list is looked for among the aircraft the page is tracking, every second. In the network edition the flight
// networks are also asked about it through the relay, one aircraft at a time, so each one is asked about every two minutes or so,
// and never while the page is already tracking it. The relay allows about 15 single-flight questions a minute for everyone
// watching together, which is why the list is short. An alert comes when an aircraft on the list is seen after not being seen,
// and again only once it has been out of sight for 20 minutes. Alerts happen only while this page is open.
const watchState = new Map();   // per entry: when it was last seen, where, when the networks were last asked, and whether an alert has been given
const WATCH_GONE = 20 * 60, WATCH_EVERY = 120, WATCH_GAP = 15;
const watch = { busy: false, next: 0 };
const watchList = () => (Array.isArray(S.watch) ? S.watch : []);
function wstate(key) { let st = watchState.get(key); if (!st) { st = { seenAt: -1e9, where: null, asked: -1e9, netOk: null, alerted: false }; watchState.set(key, st); } return st; }
// A flight number with an airline code goes to the networks as a callsign, anything else as a registration (tail number)
const watchAsCallsign = (key) => /^[A-Z]{3}\d{1,4}[A-Z]{0,2}$/.test(key);
function watchSeen(key, st, where) {
  st.seenAt = nowS(); st.where = where;
  if (!st.alerted) { st.alerted = true; watchAlert(key, st); }
}
async function watchTick() {
  const list = watchList(), t = nowS(); if (document.body.classList.contains('panel')) renderWatchStatus(); if (!list.length) return;
  for (const key of list) {
    const st = wstate(key), bare = key.replace(/-/g, ''); let p = null;
    for (const q of planes.values()) if (q.fresh(t) && planeMatches(q, bare) && (!p || (p.remote && !q.remote))) p = q;
    if (p) watchSeen(key, st, { lat: p.lat, lon: p.lon, alt: p.altFt, ground: p.ground, type: (p.info && p.info.long) || p.desc || p.type, heard: p.src === 'ant' && !p.remote && !!p.tAnt && t - p.tAnt < 20 });
    if (st.alerted && t - st.seenAt > WATCH_GONE) st.alerted = false;
  }
  if (!__NET__ || watch.busy || t < watch.next) return;
  // ask about the aircraft that was asked about longest ago, among those the page is not tracking right now
  const due = list.filter((k) => t - wstate(k).seenAt > 30).sort((a, b) => wstate(a).asked - wstate(b).asked)[0];
  watch.next = t + Math.max(WATCH_GAP, WATCH_EVERY / list.length);
  if (!due) return;
  const st = wstate(due); st.asked = t; watch.busy = true;
  try {
    const api = relayBase() && !Q.has('posApi') ? relayBase() + '/v2/' : (Q.has('posApi') ? POS_API : '');
    if (api) {
      const d = await getJSON(api + (watchAsCallsign(due) ? 'callsign/' : 'reg/') + encodeURIComponent(due) + (MANUAL && fakeT ? '?t=' + fakeT : ''));
      const ac = aged((d.ac || d.aircraft || []).filter((a) => a && a.lat != null && a.lon != null), d).find((a) => (a.seen_pos || 0) < 120);
      st.netOk = true;
      if (ac && watchList().indexOf(due) !== -1) {
        const ground = ac.alt_baro === 'ground', alt = typeof ac.alt_baro === 'number' ? ac.alt_baro : (typeof ac.alt_geom === 'number' ? ac.alt_geom : 0);
        watchSeen(due, st, { lat: +ac.lat, lon: +ac.lon, alt, ground, type: ac.desc || ac.t || '', heard: false });
      }
    } else st.netOk = false;   // a copy with no relay beside it cannot ask the flight networks
  } catch (e) { st.netOk = false; }
  watch.busy = false;
}
function watchWhere(w) {
  if (!w) return '';
  const bits = [];
  const type = prettyType(String(w.type || '')); if (type) bits.push(type);
  bits.push(altWords(w.ground, w.alt || 0, 100));
  if (w.heard) bits.push('heard by ' + ANT);
  const near = nearestAirport(w.lat, w.lon, 60), miles = gcDist(C.lat, C.lon, w.lat, w.lon) / MI;
  if (near) bits.push('near ' + (near[3] || near[2]));
  if (miles >= 5) bits.push(fmtInt(miles) + ' miles from ' + C.name);
  return bits.join(', ');
}
// The alert: a line at the top of the page that stays until it is dismissed, a short chime, and a notification from the browser
// when the page is in the background and the viewer has allowed that. Everything shown is set with textContent.
function watchAlert(key, st) {
  const box = $('watch'); let row = [...box.children].find((r) => r.dataset.key === key);
  if (!row) {
    row = document.createElement('div'); row.className = 'w-row'; row.dataset.key = key;
    const text = document.createElement('span'), go = document.createElement('button'), close = document.createElement('button');
    go.type = 'button'; go.textContent = 'Follow'; go.onclick = () => { go.blur(); setFollow(key); dismissWatch(key); };
    close.type = 'button'; close.className = 'quiet'; close.textContent = 'Dismiss'; close.setAttribute('aria-label', 'Dismiss the alert for ' + key); close.onclick = () => { close.blur(); dismissWatch(key); };
    row.appendChild(text); row.appendChild(go); row.appendChild(close); box.appendChild(row);
  }
  const where = watchWhere(st.where), line = key + (st.where && st.where.ground ? ' has been seen' : ' is in the air') + (where ? ': ' + where : '');
  row.firstChild.textContent = line; box.hidden = false; watchTitle();
  chime();
  if (S.watchNote && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification('3D sky watch list', { body: line, tag: 'sky3d-' + key }); n.onclick = () => { window.focus(); n.close(); }; } catch (e) { /* not allowed here */ }
  }
  renderWatchStatus();
}
function dismissWatch(key) { const box = $('watch'); for (const r of [...box.children]) if (r.dataset.key === key) r.remove(); box.hidden = !box.children.length; watchTitle(); }
function watchTitle() { const first = $('watch').firstChild; document.title = first ? first.dataset.key + ' spotted - 3D sky' : '3D sky'; }
// a browser plays sound only after the viewer has touched the page, so the sound is made ready on the first key or click
let audio = null;
function unlockAudio() {
  window.removeEventListener('pointerdown', unlockAudio); window.removeEventListener('keydown', unlockAudio);
  try { const A = window.AudioContext || window.webkitAudioContext; if (A && !audio) audio = new A(); if (audio && audio.state === 'suspended') audio.resume().catch(() => {}); } catch (e) { audio = null; }
}
window.addEventListener('pointerdown', unlockAudio); window.addEventListener('keydown', unlockAudio);
function chime() {
  if (!S.watchSound || !audio || audio.state !== 'running') return;
  try {
    const t0 = audio.currentTime;
    for (const [f, d] of [[880, 0], [1175, 0.2]]) {
      const o = audio.createOscillator(), g = audio.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.2, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.4);
      o.connect(g); g.connect(audio.destination); o.start(t0 + d); o.stop(t0 + d + 0.45);
    }
  } catch (e) { /* no sound */ }
}
// the list in the settings: one row per aircraft, with what is known about it
function watchStatus(key) {
  const st = watchState.get(key), t = nowS();
  if (st && t - st.seenAt < 60) return 'Seen now: ' + watchWhere(st.where);
  if (st && st.seenAt > 0) { const m = Math.round((t - st.seenAt) / 60); return 'Last seen ' + (m < 2 ? 'a minute' : fmtInt(m) + ' minutes') + ' ago'; }
  if (!__NET__) return 'Not heard by ' + ANT + ' since this page opened';
  if (!st || st.asked < 0) return 'Waiting to check';
  if (st.netOk === false) return 'Could not check the flight networks just now';
  return 'Not seen since this page opened';
}
function renderWatch() {
  const box = $('watchlist'); box.innerHTML = '';
  watchList().forEach((key) => {
    const row = document.createElement('div'); row.className = 'place'; row.dataset.key = key;
    const name = document.createElement('span'); name.textContent = key; const status = document.createElement('small'); status.textContent = watchStatus(key);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'quiet'; del.textContent = 'Remove'; del.setAttribute('aria-label', 'Remove ' + key + ' from the watch list');
    del.onclick = () => { S.watch = watchList().filter((k) => k !== key); watchState.delete(key); dismissWatch(key); save(); renderWatch(); $('f-wadd').focus(); };
    name.appendChild(status); row.appendChild(name); row.appendChild(del); box.appendChild(row);
  });
}
function renderWatchStatus() { for (const row of $('watchlist').children) { const s = row.querySelector('small'), v = watchStatus(row.dataset.key); if (s && s.textContent !== v) s.textContent = v; } }
function addWatch() {
  const input = $('f-wadd'), note = $('watch-note'), key = watchKey(input.value);
  if (!key) { note.textContent = 'Type a tail number such as N2RF or a flight number such as DL1234.'; return; }
  if (watchList().indexOf(key) !== -1) { note.textContent = key + ' is already on the list.'; return; }
  if (watchList().length >= WATCH_MAX) { note.textContent = 'That is the limit of ' + WATCH_MAX + ' aircraft. Remove one first.'; return; }
  S.watch = watchList().concat([key]); save(); input.value = '';
  note.textContent = key + ' added. You will get an alert on this page when it is seen.';
  watch.next = 0; renderWatch();
}

// ---------- camera ----------
// A pose is where the camera looks (lat, lon, altitude) and where it sits around that point (compass angle, height angle, distance).
const pose = { lat: C.lat, lon: C.lon, alt: 0, az: 200, el: 26, dist: 160 };
function newShot(kind, plane) {
  return { kind, plane: plane || null, t0: nowS(), dur: 0.01, hold: 8, side: Math.random() < 0.5 ? -1 : 1, az0: pose.az, azU: null, sub: 0, tSub: nowS(), subT: 0, subFrom: null, swing: 40 + Math.random() * 50, elBase: 7 + Math.random() * 9, frozen: null, lock: false };
}
let shot = newShot('wide'), prevShot = null;
shot.az0 = 200;
let paused = false; const recent = [];
// Version 3.6: taking the controls. In fly mode the camera is wherever the viewer puts it; fly.last is when they last touched it.
const fly = { lat: 0, lon: 0, alt: 0, az: 200, el: 25, dist: 100, last: 0, since: 0, keysAt: -1e9 };
const held = new Set();                 // keys held down right now
let clicked = null, clickUntil = 0;     // an aircraft the viewer clicked, and when its details go away again
const hold = () => paused || nowS() < clickUntil;
function wideDist() { const r = radiusKm() || 150; return clamp(r * 2.5, 75, 420); }
function begin(kind, dur, plane) {
  const t = nowS(), blending = prevShot && t - shot.t0 < shot.dur;
  // glide from wherever the previous shot would have carried on to, so nothing ever stops dead
  prevShot = blending ? { kind: 'frozen', frozen: Object.assign({}, pose), azU: pose.az } : shot;
  shot = newShot(kind, plane); shot.dur = dur;
}
function goWide() { begin('wide', 9); shot.hold = 6; hideCaption(); }
function startVisit(p) { begin('visit', 10, p); recent.push(p.hex); while (recent.length > 5) recent.shift(); prepareCaption(p); }
function startFollow(p) { begin('follow', clamp(9 + gcDist(pose.lat, pose.lon, p.rLat, p.rLon) / 50, 11, 24), p); prepareCaption(p); }
// ---------- who has the camera ----------
// The camera has one owner at a time, and this is the only place that says which:
//   fly     the viewer has the controls (F, an arrow key, a drag)
//   lock    the viewer double-clicked an aircraft or picked a search result, and the camera stays with it
//   follow  a flight being followed has been found and A has not paused it
//   tour    the auto tour: wide views, and visits to one aircraft after another
// The director in updateCamera, Escape and Follow all ask cameraOwner, and every change of owner goes through takeCamera,
// so a new way to take the camera (the watch list, the gallery) is one more case here rather than flags spread through the code.
function cameraOwner() { return shot.kind === 'fly' ? 'fly' : shot.lock ? 'lock' : followOwns() && planes.get(follow.hex) ? 'follow' : 'tour'; }
function takeCamera(owner, p) {
  const t = nowS();
  if (owner === 'fly') {
    fly.last = t; if (shot.kind === 'fly') return;
    Object.assign(fly, { lat: pose.lat, lon: pose.lon, alt: pose.alt, az: pose.az, el: pose.el, dist: pose.dist, since: t });
    paused = false; hideCaption(); begin('fly', 0.01); prevShot = null;   // start exactly where the camera is, with no glide
    return;
  }
  clicked = null; clickUntil = 0; paused = false;
  if (owner === 'lock') { begin('visit', 6, p); shot.lock = true; recent.push(p.hex); while (recent.length > 5) recent.shift(); prepareCaption(p); }
  else if (owner === 'follow') { follow.tour = false; const fp = planes.get(follow.hex); if (fp) startFollow(fp); else goWide(); }
  else goWide();
}
function enterFly() { takeCamera('fly'); }
// Zoom in on one aircraft and stay with it until the viewer says otherwise (double click, a search result)
function lockOn(p) { takeCamera('lock', p); }
// A hands the camera to the tour and pauses Follow until a flight is followed again
function autoTour() { if (follow.want) follow.tour = true; takeCamera('tour'); }
// leaving fly mode or a locked aircraft: go back to following a flight if one is being followed, otherwise to the tour
function leaveControls() { takeCamera(followOwns() && planes.get(follow.hex) ? 'follow' : 'tour'); }
function flyStep(dt) {
  if (shot.kind !== 'fly') return;
  const mv = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0), turn = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
  if (!mv && !turn) return;
  fly.last = fly.keysAt = nowS();
  const scale = Math.max(fly.dist, 2);   // the farther out the camera is, the faster it moves
  if (turn) fly.az -= turn * 50 * dt;   // the camera faces the compass heading of minus its orbit angle, so turning right lowers the angle
  if (mv) {
    if (held.has('Shift')) fly.alt = clamp(fly.alt + mv * scale * 0.05 * dt, 0, 14);
    else { const a = -fly.az * D2R, d = mv * scale * 0.08 * dt; fly.lat += (d * Math.cos(a)) / 111.19; fly.lon += (d * Math.sin(a)) / (111.19 * Math.cos(fly.lat * D2R)); }
  }
}
const FLY_KEYS_SECS = 12, WHEEL_TAKE = 60;
function zoomFly(f) { enterFly(); fly.dist = clamp(fly.dist * f, 0.15, 700); fly.last = nowS(); }
const PV = new THREE.Vector3();
// the aircraft nearest to a point on the screen, if one is close enough to mean it
function planeAt(x, y, reach = 42) {
  const t = nowS(), w = window.innerWidth, h = window.innerHeight; let best = null, bd = 1e9;
  camera.updateMatrixWorld();
  for (const p of planes.values()) {
    if (p.lat === null || p.opacity < 0.3 || !p.fresh(t)) continue;
    PV.copy(p.pos).project(camera); if (PV.z > 1 || PV.z < -1) continue;
    const sx = (PV.x * 0.5 + 0.5) * w, sy = (-PV.y * 0.5 + 0.5) * h; if (sx < 0 || sx > w || sy < 0 || sy > h) continue;
    const d = Math.hypot(sx - x, sy - y);
    if (d < bd) { bd = d; best = p; }
  }
  return bd < reach ? best : null;
}
// The airport whose code label is under the pointer. Labels sit just above their airport and keep the same size on screen:
// each is 0.021 of the screen's height tall, drawn from 0.4 to 1.4 of its height above the airport's own point.
function airportLabelAt(x, y) {
  const w = window.innerWidth, h = window.innerHeight, lh = 0.021 * h; let best = null, bd = 1e9;
  camera.updateMatrixWorld();
  for (const l of labels) {
    if (!l.a || l.sprite.material.opacity < 0.05) continue;
    PV.copy(l.sprite.position).project(camera); if (PV.z > 1 || PV.z < -1) continue;
    const sx = (PV.x * 0.5 + 0.5) * w, sy = (-PV.y * 0.5 + 0.5) * h, lw = lh * l.sprite.userData.aspect;
    const top = sy - 1.4 * lh - 4, bottom = sy - 0.4 * lh + 4;
    if (x < sx - lw / 2 - 4 || x > sx + lw / 2 + 4 || y < top || y > bottom) continue;
    const d = Math.hypot(x - sx, y - (top + bottom) / 2); if (d < bd) { bd = d; best = l.a; }
  }
  return best;
}
// Make an airport the center of the sky, the way picking it from the list does, with the usual move there
function centerOnAirport(a) {
  if (PRESETS.some((x) => x[0] === a[0])) S.center = a[0]; else { S.center = 'OTHER'; S.other = a[0]; $('f-other').value = S.other; $('other-note').textContent = a[2] + (a[3] ? ', ' + a[3] : ''); }
  save(); buildCenterOptions(); applyCenter();
}
// A click on an aircraft shows its details. An aircraft right under the pointer comes first, then an airport code label,
// which centers the sky on that airport, then the nearest aircraft within reach, so a label never steals a click meant for a
// plane landing beside it, and a plane passing near a label does not stop the label from working.
function clickAt(x, y) {
  const near = planeAt(x, y, 16);
  if (!near) { const a = airportLabelAt(x, y); if (a) { clicked = null; clickUntil = 0; centerOnAirport(a); return; } }
  const p = near || planeAt(x, y);
  if (!p) { clickUntil = 0; return; }   // a click on empty sky puts the details away
  clicked = p; clickUntil = nowS() + S.clickSecs; prepareCaption(p);
}
function updatePick() {
  const ring = $('pick'), p = clicked && nowS() < clickUntil ? clicked : null;
  if (p && p.lat !== null && p.opacity > 0.1) {
    PV.copy(p.pos).project(camera);
    if (PV.z < 1 && PV.z > -1) { ring.style.transform = `translate(${(PV.x * 0.5 + 0.5) * window.innerWidth}px, ${(-PV.y * 0.5 + 0.5) * window.innerHeight}px)`; ring.hidden = false; return; }
  }
  if (!ring.hidden) ring.hidden = true;
}
function candidates() {
  const t = nowS(), r = radiusKm(), out = [];
  for (const p of planes.values()) {
    if (!p.fresh(t) || p.remote || p.ground || p.opacity < 0.5 || p.altFt < 400) continue;
    if (r > 0 && gcDist(C.lat, C.lon, p.rLat, p.rLon) > r) continue;
    out.push(p);
  }
  return out;
}
function pickNext() {
  const c = candidates(); if (!c.length) return null;
  let pool = c.filter((p) => recent.indexOf(p.hex) === -1); if (!pool.length) pool = c.filter((p) => p.hex !== recent[recent.length - 1]); if (!pool.length) pool = c;
  return pool[Math.floor(Math.random() * pool.length)];
}
function visitDist(p) { return 3.1 * (p.mesh ? Math.pow(p.camLen || p.mesh.len, 0.8) : 1); }
// where a shot wants the camera at time t; the compass angle is kept continuous so the camera never swings the long way round
function livePose(sh, t, out, ref) {
  if (sh.kind === 'frozen') return Object.assign(out, sh.frozen);
  const el = t - sh.t0; let az;
  if (sh.kind === 'fly') { out.lat = fly.lat; out.lon = fly.lon; out.alt = fly.alt; az = fly.az; out.el = fly.el; out.dist = fly.dist; }
  else if (sh.kind === 'wide' || !sh.plane || sh.plane.lat === null) {
    out.lat = C.lat; out.lon = C.lon; out.alt = 0; az = sh.az0 + el * 0.9; out.el = 25 + 3 * Math.sin(t * 0.05); out.dist = wideDist();
  } else {
    const p = sh.plane, d = visitDist(p) * (sh.lock ? 0.6 : 1);
    out.lat = p.rLat; out.lon = p.rLon; out.alt = p.rAlt;
    if (sh.kind === 'visit') {
      const k = Math.min(el / Math.max(sh.dur + S.pace, 1), sh.lock ? 1 : 1e9);
      az = p.rHdg + 180 + sh.side * (25 + sh.swing * k); out.el = sh.elBase + 3 * Math.sin(el * 0.11); out.dist = d;
    } else {
      az = p.rHdg + 180 + sh.side * (30 + el * 1.3);
      const want = (n) => { const m = n % 3; return m === 2 ? [95, 34] : m === 1 ? [d * 4.5, 16] : [d, 9 + 2 * Math.sin(el * 0.1)]; };
      const [wd, we] = want(sh.sub);
      if (sh.subFrom) { const u = smooth((t - sh.subT) / 12); out.dist = Math.exp(lerp(Math.log(sh.subFrom[0]), Math.log(wd), u)); out.el = lerp(sh.subFrom[1], we, u); if (u >= 1) sh.subFrom = null; }
      else { out.dist = wd; out.el = we; }
    }
  }
  sh.azU = sh.azU === null ? (ref !== undefined ? ref + angDiff(ref, az) : az) : sh.azU + angDiff(sh.azU, az);
  out.az = sh.azU;
  return out;
}
const TP = {}, FP = {};
function setFade(f) { const el = $('jump'); if (!el) return; const v = f.toFixed(2); if (el._v === v) return; el._v = v; el.style.opacity = v; if (f > 0) el.style.background = scene.fog.color.getStyle(); }
const B_E = new THREE.Vector3(), B_N = new THREE.Vector3(), B_U = new THREE.Vector3(), B_M = new THREE.Matrix4(), B_Q = new THREE.Quaternion(), CAMQ = new THREE.Quaternion();
function updateCamera(t) {
  // what to look at next
  const el = t - shot.t0;
  const owner = cameraOwner();
  if (owner === 'fly') { if (S.flyBack > 0 && t - fly.last > S.flyBack) leaveControls(); }
  else if (owner === 'lock') { const lp = shot.plane; if (!lp || !planes.has(lp.hex) || lp.opacity < 0.25 || !lp.fresh(t)) leaveControls(); }
  else if (owner === 'follow') {
    if (shot.kind !== 'follow' || shot.plane !== planes.get(follow.hex)) { if (el > shot.dur) startFollow(planes.get(follow.hex)); }
    else if (el > shot.dur && t - shot.tSub > 38) { livePose(shot, t, TP); shot.subFrom = [TP.dist, TP.el]; shot.sub++; shot.tSub = t; shot.subT = t; }
  } else if (shot.kind === 'wide') {
    if (el > shot.dur + shot.hold && !hold()) { const p = pickNext(); if (p) startVisit(p); }
  } else if (shot.kind === 'visit') {
    const p = shot.plane, gone = !planes.has(p.hex) || p.opacity < 0.25 || !p.fresh(t);
    if (gone || (!hold() && el > shot.dur + S.pace)) goWide();
  } else goWide();
  const s = smooth((t - shot.t0) / shot.dur); let fade = 0;
  if (s >= 1 || !prevShot) { livePose(shot, t, pose); prevShot = null; }
  else if (shot.jump) {
    // a long move: rise, fade while crossing, come down (see applyCenter)
    livePose(prevShot, t, FP); livePose(shot, t, TP);
    const u = (t - shot.t0) / shot.dur, there = u >= 0.5, P = there ? TP : FP;
    pose.lat = P.lat; pose.lon = P.lon; pose.alt = P.alt; pose.az = P.az;
    if (calm()) { pose.dist = P.dist; pose.el = P.el; fade = clamp((0.45 - Math.abs(u - 0.5)) / 0.3, 0, 1); }
    else {
      const high = clamp(Math.max(FP.dist, TP.dist) * 3.5, 400, 2400), k = there ? smooth((u - 0.6) / 0.4) : smooth(u / 0.4);
      const a = there ? high : P.dist, b = there ? P.dist : high, ea = there ? 72 : P.el, eb = there ? P.el : 72;
      pose.dist = Math.exp(lerp(Math.log(a), Math.log(b), k)); pose.el = lerp(ea, eb, k);
      fade = clamp((0.2 - Math.abs(u - 0.5)) / 0.1, 0, 1);   // fully faded from 0.4 to 0.6, while the camera moves across
    }
  } else {
    livePose(prevShot, t, FP); livePose(shot, t, TP, FP.az);
    const sf = smooth((t - shot.t0) / (shot.dur * 0.72));
    pose.lat = lerp(FP.lat, TP.lat, sf); pose.lon = lerp(FP.lon, TP.lon, sf); pose.alt = lerp(FP.alt, TP.alt, sf);
    pose.az = lerp(FP.az, TP.az, s);
    // rise a little in the middle of a long move so it reads as a glide, not a cut
    const far = gcDist(FP.lat, FP.lon, TP.lat, TP.lon), arc = Math.sin(Math.PI * s);
    pose.dist = Math.exp(lerp(Math.log(FP.dist), Math.log(TP.dist), s)) * (1 + arc * clamp(far / 400, 0, 0.25));
    pose.el = lerp(FP.el, TP.el, s) + arc * 4;
  }
  setFade(fade);
  if (gcDist(proj.lat0, proj.lon0, pose.lat, pose.lon) > 150) reorigin(pose.lat, pose.lon);
  // place the camera in the local east, north, up frame of the point it looks at, so moving the map origin never shows
  project(pose.lat, pose.lon, pose.alt, TV);
  localFrame(pose.lat, pose.lon, pose.alt, TV, B_E, B_N, B_U);
  const a = pose.az * D2R, e = clamp(pose.el, 2, 88) * D2R, ce = Math.cos(e) * pose.dist;
  camera.position.copy(TV).addScaledVector(B_E, ce * Math.sin(a)).addScaledVector(B_N, -ce * Math.cos(a)).addScaledVector(B_U, Math.sin(e) * pose.dist);
  camera.up.copy(B_U); camera.lookAt(TV);
  camera.near = clamp(pose.dist * 0.02, 0.05, 2); camera.updateProjectionMatrix();
  B_M.makeBasis(B_E, B_U, B_N.clone().negate()); B_Q.setFromRotationMatrix(B_M);
  sky.follow(camera.position, B_Q);
  sun.position.copy(sunDir).applyQuaternion(B_Q).multiplyScalar(1000).add(TV); sun.target.position.copy(TV);
}

// ---------- the nearest airport, and listening to its air traffic control ----------
function nearestAirport(lat, lon, maxKm) {
  let best = null, bd = maxKm;
  for (const a of AIRPORTS) { if (!a[1] || Math.abs(a[4] - lat) > 1.2) continue; const d = gcDist(lat, lon, a[4], a[5]) * (a[7] === 2 ? 1 : 1.6); if (d < bd) { bd = d; best = a; } }   // a major airport wins over a small field a little closer
  return best;
}
// The page does not play the audio itself: LiveATC's streams are theirs. The control opens LiveATC's own page for the airport in a new tab.
let listenAp = null;
function updateListen() {
  listenAp = nearestAirport(pose.lat, pose.lon, 90); const b = $('listen'), text = listenAp ? 'Listen to ' + (listenAp[1] || listenAp[0]) : '';
  if (b._t !== text) { b._t = text; b.textContent = text; b.hidden = !text; if (listenAp) b.title = 'Opens LiveATC.net for ' + listenAp[2] + ' in a new tab'; }
}
function openListen() { if (listenAp) window.open('https://www.liveatc.net/search/?icao=' + encodeURIComponent(listenAp[0]), '_blank', 'noopener'); }

// ---------- aircraft photo (version 3.11) ----------
// A photo of the aircraft in the caption, from Planespotters.net, shown with its photographer's name and a link to its page there,
// as Planespotters asks. Only the aircraft's transponder code and registration are sent. The network edition asks the relay first,
// which keeps answers for a day and asks Planespotters for everyone at once; without a relay, or when it cannot answer, the page
// asks Planespotters itself. Either way the photo is loaded by the viewer's browser from Planespotters.
const PHOTO_SRC = /^https:\/\/[a-z0-9.-]{1,60}\.plnspttrs\.net\/[A-Za-z0-9/_.-]{1,200}$/, PHOTO_PAGE = /^https:\/\/www\.planespotters\.net\/photo\/[A-Za-z0-9/_.-]{1,200}$/;
const photoKept = new Map();   // by transponder code: { t, photo }
let photoFor = null;           // the aircraft whose photo window is open
function cleanPhoto(ph) { return ph && typeof ph.src === 'string' && PHOTO_SRC.test(ph.src) && typeof ph.link === 'string' && PHOTO_PAGE.test(ph.link) && typeof ph.by === 'string' ? { src: ph.src, link: ph.link, by: ph.by.slice(0, 80), w: ph.w, h: ph.h } : null; }
function fromPlanespotters(data) {   // the first usable photo in Planespotters' own answer
  for (const ph of (data && Array.isArray(data.photos) ? data.photos : [])) {
    const t = ph && (ph.thumbnail_large || ph.thumbnail); if (!t) continue;
    const c = cleanPhoto({ src: t.src, link: ph.link, by: ph.photographer, w: t.size && t.size.width, h: t.size && t.size.height }); if (c) return c;
  }
  return null;
}
async function findPhoto(p) {
  const hex = (p.hex || '').toLowerCase(), reg = ((p.info && p.info.reg) || p.reg || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10), t = nowS();
  if (!/^[0-9a-f]{6}$/.test(hex)) return null;
  const hit = photoKept.get(hex); if (hit && t - hit.t < (hit.photo ? 86400 : 3600)) return hit.photo;
  let photo, known = false;
  const rb = __NET__ && !Q.has('photoApi') ? relayBase() : '';
  if (rb) { try { const d = await getJSON(rb + '/photo/' + hex + (reg.length >= 2 ? '/' + reg : '')); photo = cleanPhoto(d.photo); known = true; } catch (e) { /* the relay could not answer: ask Planespotters directly */ } }
  if (!known) {
    const base = Q.get('photoApi') || 'https://api.planespotters.net/pub/photos/';
    photo = fromPlanespotters(await getJSON(base + 'hex/' + hex));
    if (!photo && reg.length >= 2) photo = fromPlanespotters(await getJSON(base + 'reg/' + encodeURIComponent(reg)));
  }
  photoKept.set(hex, { t, photo: photo || null }); if (photoKept.size > 500) photoKept.delete(photoKept.keys().next().value);
  return photo || null;
}
function openPhoto() {
  const p = capPlane; if (!p || !capShown) return;
  closeMine(); if (!$('find').hidden) closeFind();
  photoFor = p; const name = $('c-flight').textContent || p.hex.toUpperCase(), what = $('c-air').textContent;
  $('photo-title').textContent = what ? name + ', ' + what : name;
  const img = $('photo-img'), credit = $('photo-credit'), note = $('photo-note');
  img.hidden = true; img.removeAttribute('src'); credit.hidden = true; credit.textContent = ''; note.textContent = 'Looking for a photo on Planespotters.net...';
  $('photo').hidden = false; $('photo-close').focus();
  findPhoto(p).then((ph) => {
    if (photoFor !== p || $('photo').hidden) return;
    if (!ph) { note.textContent = 'Planespotters.net has no photo of this aircraft.'; return; }
    note.textContent = '';
    img.onload = () => { if (photoFor === p) img.hidden = false; }; img.onerror = () => { if (photoFor === p) note.textContent = 'The photo did not load. Planespotters.net may be busy.'; };
    if (ph.w && ph.h) { img.width = ph.w; img.height = ph.h; }
    img.alt = 'Photo of ' + $('photo-title').textContent; img.src = ph.src;
    const a = document.createElement('a'); a.href = ph.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Planespotters.net';
    credit.append('Photo \u00a9 ' + ph.by + ', ', a); credit.hidden = false;
  }).catch(() => { if (photoFor === p && !$('photo').hidden) note.textContent = 'Planespotters.net did not answer. Try again in a moment.'; });
}
function closePhoto() { const w = $('photo'); if (w.hidden) return; w.hidden = true; photoFor = null; const ae = document.activeElement; if (ae && w.contains(ae) && ae.blur) ae.blur(); }

// ---------- caption ----------
let capPlane = null, capShown = false, capRoute = null, capInfo = null;
function hideCaption() { capShown = false; $('cap').classList.remove('on'); }
function prepareCaption(p) {
  capPlane = p; capRoute = null; capInfo = null; capShown = false; $('cap').classList.remove('on');
  getRoute(p).then((r) => { if (capPlane === p) capRoute = r; });
  dbLookup(p).then((i) => { if (capPlane === p) capInfo = i; });
}
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function placeName(a) { return ((String(a.location || a.name || '')).split(/[,(/]/)[0].trim()) || a.iata || a.icao || 'unknown'; }
// Both ends of the trip, always (version 3.9), with a word in front when the aircraft is low beside one of them.
function routeHtml(leg, p) {
  const [a, b] = leg, low = !p.ground && p.altFt < 4500, nearA = low && gcDist(a.lat, a.lon, p.rLat, p.rLon) < 32, nearB = low && gcDist(b.lat, b.lon, p.rLat, p.rLon) < 32;
  const word = nearA && !(nearB && p.vrate < -200) ? 'Departing' : nearB ? 'Arriving' : '';
  return `${word ? `<span style="margin-left:0">${word}</span> ` : ''}${esc(placeName(a))} <i>${esc(a.iata || a.icao)}</i> <span>to</span> ${esc(placeName(b))} <i>${esc(b.iata || b.icao)}</i>`;
}
function updateCaption(t) {
  if (clicked && t >= clickUntil) { clicked = null; if ((shot.kind === 'visit' || shot.kind === 'follow') && shot.plane && capPlane !== shot.plane) prepareCaption(shot.plane); }
  const cl = !!clicked && capPlane === clicked;
  const p = capPlane, active = p && (cl || ((shot.kind === 'visit' || shot.kind === 'follow') && shot.plane === p));
  const show = active && (S.captions || cl) && (cl || (t - shot.t0) > shot.dur * 0.55);
  if (show) {
    const cs = p.callsign(), al = airlineName(cs), info = capInfo || {};
    const known = routes.get(cs), leg = routeLeg(capRoute || (known && known.route), p);   // a route that came in after the caption asked (version 3.9) is shown too
    // A regional airline is shown the way its passengers know it: the partner's name and flight number (version 3.10 adds
    // the ones that fly for several partners, named from the route), or that it is flying for a partner when that is not known.
    const own = /^[A-Z]{3}\d/.test(cs) ? cs.slice(0, 3) : '', pt = partnerOf(cs, leg), partner = pt && pt.key && AIRLINES[pt.key], ownName = AIRLINES[own] ? AIRLINES[own][1] : al || own;
    $('c-air').textContent = partner ? partner[1] + ', operated by ' + ownName : pt && pt.some ? ownName + ', flying for a partner' : al || (cs ? (/^[A-Z]{3}\d/.test(cs) ? '' : 'Private aircraft') : 'Unidentified aircraft');   // a callsign that is a tail number, not an airline's: say so rather than leave the line empty
    $('c-flight').textContent = cs ? (partner ? partner[0] + ' ' + cs.slice(3) : cs.replace(/^([A-Z]{3})(\d)/, '$1 $2')) : (info.reg || p.hex.toUpperCase());
    let route = '';
    if (!leg && !p.ground && p.altFt < 4500) {   // no route to trust, but low beside an airport: say what can be seen
      const near = nearestAirport(p.rLat, p.rLon, 32);
      if (near) route = `<span style="margin-left:0">${p.vrate < -200 ? 'Arriving at' : p.vrate > 300 ? 'Departing' : 'Near'}</span> ${esc(near[3] || near[2])} <i>${esc(near[1] || near[0])}</i>`;
    }
    if (leg) route = routeHtml(leg, p);
    else if (!route && !p.ground && /^[A-Z]{3}\d/.test(cs)) route = '<span style="margin-left:0">Route not known</span>';   // an airline flight with no route found: say so rather than leave the line empty (version 3.10)
    if ($('c-route')._h !== route) { $('c-route').innerHTML = route; $('c-route')._h = route; }
    const trend = p.vrate > 350 ? 'climbing' : p.vrate < -350 ? 'descending' : '';
    const bits = [];
    const long = prettyType(info.long || '') || info.type || p.type || ''; if (long) bits.push(esc(long));
    bits.push(altWords(p.ground, p.altFt, 25) + (trend && !p.ground && p.altFt > 100 ? ' ' + trend : ''));
    if (p.gs > 1) bits.push(`${fmtInt(p.gs * 1.15078)} mph`);
    const h = bits.map((b) => `<b>${b}</b>`).join('');
    if ($('c-data')._h !== h) { $('c-data').innerHTML = h; $('c-data')._h = h; }
    if (__NET__) { const mark = dataBase && S.src === 'blend' && !p.remote ? (p.tAnt && t - p.tAnt < 20 ? 'Heard by ' + ANT : 'From the flight network') : ''; const n = $('c-src'); if (n._t !== mark) { n._t = mark; n.textContent = mark; n.hidden = !mark; } }
    let prog = '';
    if (shot.kind === 'follow' && leg) {
      const [a, b] = leg;
      const done = gcDist(a.lat, a.lon, p.rLat, p.rLon), left = gcDist(p.rLat, p.rLon, b.lat, b.lon), frac = clamp(done / Math.max(done + left, 1), 0, 1);
      $('c-bar').style.width = (frac * 100).toFixed(1) + '%';
      const mins = p.gs > 60 ? (left / (p.gs * 1.852)) * 60 : null;
      prog = `${fmtInt(left / MI)} miles to go` + (mins ? `, about ${mins >= 90 ? (mins / 60).toFixed(1).replace('.0', '') + ' hours' : fmtInt(Math.max(mins, 1)) + ' minutes'}` : '');
      if (p.remote) prog += '. Beyond ' + ANT + ', position from ADSB.lol';
    } else if (shot.kind === 'follow' && p.remote) prog = 'Beyond ' + ANT + ', position from ADSB.lol';
    $('c-prog').hidden = !(shot.kind === 'follow' && leg); $('c-progtext').textContent = prog; $('c-progtext').hidden = !prog;
  }
  if (show !== capShown) { capShown = show; $('cap').classList.toggle('on', show); }
  if ($('photobtn')._on !== show) { $('photobtn')._on = show; $('photobtn').hidden = !show; document.body.classList.toggle('hasphoto', show); }   // the Photo button shows while a caption does
  // quiet status line
  let msg = '';
  const netOn = __NET__ && S.src !== 'antenna';
  if (__NET__ && !dataBase && netOn) msg = net.ok === false || (net.ok === true && !netAnswering()) ? (relayBase() || Q.has('netApi') ? 'The flight network is not answering. Trying again.' : 'This copy cannot reach the flight network by itself. The network edition needs its relay, which runs on a receiver at home.') : '';
  else if (!dataBase) msg = pollFails >= 2 ? (__NET__ ? 'No receiver found here. To watch without one, open the settings and choose the flight network under "Aircraft from".' : 'No receiver found. Open this page from the address of the Raspberry Pi, not from the downloaded file.') : '';
  else if (t - lastGood > 15 && !(netOn && netAnswering())) msg = 'The receiver has stopped answering. Trying again.';
  else if (follow.want && follow.state === 'looking' && t - follow.since > 4) msg = follow.netOk ? `Looking for ${follow.want}. It is not in the air within reach yet.` : `Looking for ${follow.want} with ${ANT} only. The internet lookup did not answer.`;
  else if (shot.kind === 'wide' && t - shot.t0 > shot.dur + shot.hold + 3 && !paused && !candidates().length) msg = planes.size ? `No aircraft within ${S.radius} miles of ${C.short} right now.` : 'No aircraft heard right now.';
  else if (paused && shot.kind === 'visit') msg = 'Holding on this aircraft. Press the space bar to move on.';
  else if (shot.lock && t - shot.t0 < 9) msg = 'Staying with this aircraft. Press A for the auto tour, or Escape.';
  else if (shot.kind === 'fly' && t - fly.since < 7) msg = 'You have the controls. Drag to look around, arrow keys to move, plus and minus to zoom, A for the auto tour.';
  else if (t - bootT < 14 && shot.kind === 'wide') msg = 'Press H to see what the keys do.';
  // The fly keys show while the keys are in use and fade 12 seconds after the last one (version 3.11). In 3.8.1 they stayed for all of
  // fly mode, and a drag or a scroll with the mouse also starts fly mode, so a viewer using only the mouse had the box up for good.
  const keysOn = shot.kind === 'fly' && t - (fly.keysAt || -1e9) < FLY_KEYS_SECS; if ($('flykeys')._on !== keysOn) { $('flykeys')._on = keysOn; $('flykeys').classList.toggle('on', keysOn); }
  if ($('msg')._t !== msg) { $('msg')._t = msg; if (msg) $('msg').textContent = msg; $('msg').classList.toggle('on', !!msg); }
}

// ---------- settings panel ----------
function buildCenterOptions() {
  const sel = $('f-center'); sel.innerHTML = '';
  const add = (v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o); };
  placeList().forEach((pl, i) => add('P' + i, pl.n));
  for (const [v, label] of PRESETS) add(v, label);
  if (home) add('HOME', 'Home');
  add('OTHER', 'Another airport');
  sel.value = S.center; if (sel.value !== S.center) { S.center = 'MID'; sel.value = 'MID'; }
  $('row-other').hidden = S.center !== 'OTHER';
}
function renderPlaces() {
  const box = $('places'); box.innerHTML = '';
  placeList().forEach((pl, i) => {
    const row = document.createElement('div'); row.className = 'place';
    const name = document.createElement('span'); name.textContent = pl.n; const where = document.createElement('small'); where.textContent = pl.lat.toFixed(4) + ', ' + pl.lon.toFixed(4);
    const go = document.createElement('button'); go.type = 'button'; go.className = 'quiet'; go.textContent = 'Go there'; go.onclick = () => { S.center = 'P' + i; save(); buildCenterOptions(); applyCenter(); };
    const del = document.createElement('button'); del.type = 'button'; del.className = 'quiet'; del.textContent = 'Remove'; del.setAttribute('aria-label', 'Remove ' + pl.n);
    del.onclick = () => {
      const cur = /^P\d+$/.test(S.center) ? +S.center.slice(1) : -1; S.places = placeList().filter((_, j) => j !== i);
      if (cur === i) S.center = 'MID'; else if (cur > i) S.center = 'P' + (cur - 1);
      save(); buildCenterOptions(); renderPlaces(); if (cur === i) applyCenter(); else rebuildLabels();
    };
    name.appendChild(where); row.appendChild(name); row.appendChild(go); row.appendChild(del); box.appendChild(row);
  });
}
function addPlace() {
  const note = $('places-note'), typedName = $('f-pname').value.trim().slice(0, 28);
  let where = $('f-pll').value.trim(), name = typedName;
  // Version 3.7.1: the second box takes an address, a city or a zip code as well as a latitude and longitude. Anything that is
  // not a latitude and longitude is looked up the way Find a place does, and the answers are shown under the box to pick from.
  // Someone who types an address in the name box and leaves the second box empty gets it looked up too.
  if (!where && typedName) { where = typedName; name = ''; }
  if (!where) { note.textContent = 'Type an address, a city or a latitude and longitude in the second box.'; return; }
  // only text made of numbers, degree and minute marks and the letters N, S, E and W counts as a latitude and longitude, so an
  // address with two numbers in it (12 Route 7) is looked up rather than read as 12, 7
  const ll = /^[\s\d.,;:+\-\u00b0'"\u2032\u2033\u2019\u201dNSEWnsew]+$/.test(where) ? parseLatLon(where) : null;
  if (!ll) { lookPlace(MINE, where, name); return; }
  addMine(name || 'My place', ll.lat, ll.lon);
}
function addMine(name, lat, lon) {
  const note = $('places-note'), list = placeList(), at = list.findIndex((pl) => Math.abs(pl.lat - lat) < 0.0005 && Math.abs(pl.lon - lon) < 0.0005);
  if (at !== -1) { note.textContent = 'That place is already in My places as ' + list[at].n + '.'; return; }
  if (list.length >= 20) { note.textContent = 'That is the limit of 20 places. Remove one first.'; return; }
  S.places = list.concat([{ n: name.slice(0, 28), lat: +(+lat).toFixed(5), lon: +(+lon).toFixed(5) }]); save();
  $('f-pname').value = ''; $('f-pll').value = ''; $('pll-list').innerHTML = ''; mineAdded = name.slice(0, 28); note.textContent = mineNote();
  buildCenterOptions(); renderPlaces(); rebuildLabels();
}
// The notes that say how long a place is kept are written again when Keep my places changes, so they never disagree with the box.
let mineAdded = '', lookAdded = '';
const mineNote = () => mineAdded + (S.keep ? ' added. It is kept on this device only.' : ' added. It will be forgotten when you close this page.');
function keepNotes() {   // a note left from before the box changed is written again to match it
  if (lookAdded && $('look-note').textContent.indexOf(lookAdded + ' is in My places') === 0) $('look-note').textContent = lookNote();
  if (mineAdded && $('places-note').textContent.indexOf(mineAdded + ' added.') === 0) $('places-note').textContent = mineNote();
}
const lookNote = () => lookAdded + (S.keep ? ' is in My places, kept on this device only.' : ' is in My places until you close this page.');
// ---------- finding a typed place (version 3.7) ----------
// An airport code is found in the airport list on this page. In the network edition anything else is looked up through the
// relay on the receiver, which asks the OpenStreetMap place finder: only the typed words are sent, only when the viewer
// presses Enter or Find, and the place finder sees the receiver's address, not the viewer's. Answers are kept here as well.
// The home edition has no relay, so it searches the airport list by code, name or city only. A place picked from the
// results joins My places, with the same rules for keeping it on this device.
const placeCache = new Map();
const placeApi = () => (__NET__ ? (Q.get('placeApi') || (relayBase() ? relayBase() + '/place/' : '')) : '');
function airportsMatching(text) {
  const words = text.toLowerCase().split(' ').filter(Boolean);
  return AIRPORTS.filter((a) => { const h = (a[2] + ' ' + (a[3] || '') + ' ' + (a[1] || '') + ' ' + a[0]).toLowerCase(); return words.every((w) => h.indexOf(w) !== -1); })
    .sort((x, y) => (y[7] || 0) - (x[7] || 0)).slice(0, 5)
    .map((a) => ({ name: a[2], sub: [a[3], a[1] || a[0]].filter(Boolean).join(', '), lat: a[4], lon: a[5], code: a[0] }));
}
const LOOK = { list: 'look-list', note: 'look-note', seq: 0 }, MINE = { list: 'pll-list', note: 'places-note', seq: 0, mine: true };
async function lookPlace(at = LOOK, typed, name = '') {
  const text = String(typed == null ? $('f-lookq').value : typed).replace(/\s+/g, ' ').trim().slice(0, 100), note = $(at.note), seq = ++at.seq, up = text.toUpperCase();
  const show = (list, msg) => { if (seq === at.seq) { showLook(list, at, name); note.textContent = msg; } };
  const pick = at.mine ? 'Pick the right one to add it to My places' + (name ? ' as ' + name : '') + '.' : 'Pick one to center the sky there. It joins My places.';
  if (text.length < 2) return show([], 'Type at least two letters.');
  const a = /^[A-Z0-9]{3,4}$/.test(up) ? AP[up] || AP['K' + up] : null;
  if (a) return show([{ name: a[2], sub: [a[3], a[1] || a[0]].filter(Boolean).join(', '), lat: a[4], lon: a[5], code: a[0] }], at.mine ? pick : 'An airport on this page.');
  const api = placeApi();
  if (!api) { const list = airportsMatching(text); return show(list, list.length ? (at.mine ? 'Airports on this page that match. ' + pick : 'Airports on this page that match.') : __NET__ ? 'No airport on this page matches, and this copy has no relay to look up other places. A latitude and longitude always works.' : 'No airport on this page matches. This copy can only look up airports, so paste a latitude and longitude from Google Maps instead.'); }
  if (encodeURIComponent(text).length > 270) return show([], 'That is too long to look up. Try fewer words.');
  const key = text.toLowerCase(); let found = placeCache.get(key);
  if (!found) {
    show([], 'Looking up ' + text + '...');
    try {
      const d = await getJSON(api + encodeURIComponent(text));
      found = (Array.isArray(d && d.places) ? d.places : []).filter((p) => p && typeof p.name === 'string' && p.name.trim() && isFinite(+p.lat) && isFinite(+p.lon) && Math.abs(+p.lat) <= 90 && Math.abs(+p.lon) <= 180).slice(0, 5)
        .map((p) => { const parts = p.name.split(',').map((x) => x.trim()).filter(Boolean); return { name: parts[0] || p.name.trim(), sub: parts.slice(1).join(', '), lat: +p.lat, lon: +p.lon }; });
      if (placeCache.size > 100) placeCache.clear();
      placeCache.set(key, found);
    } catch (e) { return show([], e && e.message === '503' ? 'The place finder is busy. Try again in a moment.' : 'The place finder did not answer. Try again later, or paste a latitude and longitude.'); }
  }
  show(found, found.length ? pick : 'Nothing found for that. Try adding a state or a country, or paste a latitude and longitude.');
}
function showLook(list, at = LOOK, name = '') {
  const box = $(at.list); box.innerHTML = '';
  list.forEach((item) => {
    const row = document.createElement('div'); row.className = 'place';
    const label = document.createElement('span'); label.textContent = item.name; const sub = document.createElement('small'); sub.textContent = item.sub || item.lat.toFixed(4) + ', ' + item.lon.toFixed(4);
    const go = document.createElement('button'); go.type = 'button'; go.className = 'quiet';
    if (at.mine) { go.textContent = 'Add'; go.setAttribute('aria-label', 'Add ' + item.name + ' to My places'); go.onclick = () => addMine(name || item.name, item.lat, item.lon); }
    else { go.textContent = 'Go there'; go.setAttribute('aria-label', 'Go to ' + item.name); go.onclick = () => goPlace(item); }
    label.appendChild(sub); row.appendChild(label); row.appendChild(go); box.appendChild(row);
  });
}
function goPlace(item) {
  const note = $('look-note');
  if (item.code) {   // an airport: center on it the way the airport list does
    if (PRESETS.some((x) => x[0] === item.code)) S.center = item.code; else { S.center = 'OTHER'; S.other = item.code; $('f-other').value = S.other; $('other-note').textContent = item.name; }
    note.textContent = 'The sky is now centered on ' + item.name + '.';
  } else {
    const list = placeList(); let i = list.findIndex((pl) => Math.abs(pl.lat - item.lat) < 0.0005 && Math.abs(pl.lon - item.lon) < 0.0005);
    if (i === -1) {
      if (list.length >= 20) { note.textContent = 'My places is full at 20. Remove one first.'; return; }
      S.places = list.concat([{ n: item.name.slice(0, 28), lat: +item.lat.toFixed(5), lon: +item.lon.toFixed(5) }]); i = S.places.length - 1;
    }
    S.center = 'P' + i;
    lookAdded = item.name; note.textContent = lookNote();
  }
  save(); $('look-list').innerHTML = ''; $('f-lookq').value = ''; buildCenterOptions(); renderPlaces(); applyCenter();
}
// Moving the sky somewhere far away does not glide across the map, which can make a viewer feel sick: the camera rises out of
// the old place, the view fades to the sky's colour while it crosses, and it comes down into the new place. With the system's
// reduce motion setting on, it only fades. A short move still glides. byViewer is false when the page moves the sky by itself.
const JUMP_KM = 60;
const calm = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
function applyCenter(byViewer = true) {
  if (__NET__) setTimeout(() => netTick(true), 50);
  const from = { lat: pose.lat, lon: pose.lon }, was = { kind: 'frozen', frozen: Object.assign({}, pose), azU: pose.az };
  C = centerPoint(); reorigin(C.lat, C.lon); for (const p of planes.values()) for (const s of p.trail) s.ep = -1;
  if (shot.kind !== 'follow') {
    const jump = byViewer && gcDist(from.lat, from.lon, C.lat, C.lon) > JUMP_KM;
    begin('wide', jump ? (calm() ? 3 : 8) : 7); shot.hold = 5; shot.jump = jump; hideCaption();
    prevShot = was;   // start from where the camera is now: the old wide shot would already be measured from the new center
  }
}
function initPanel() {
  buildCenterOptions();
  $('f-other').value = S.other; $('f-radius').value = String(S.radius); $('f-pace').value = String(S.pace); $('f-cap').checked = !!S.captions; $('f-sky').value = S.sky; $('f-wx').value = S.wx; $('f-corner').checked = !!S.corner; $('f-lights').value = S.lights; if (__NET__) { $('f-src').value = S.src; $('f-relay').value = S.relay || ''; $('f-netmax').value = String(S.netmax); if ($('f-netmax').value !== String(S.netmax)) { S.netmax = 130; $('f-netmax').value = '130'; } $('f-relay').placeholder = relayBase() && !S.relay ? relayBase() : 'http://'; } $('f-trail').value = String(S.trail); $('f-flight').value = S.follow || '';
  $('f-center').onchange = (e) => { S.center = e.target.value; $('row-other').hidden = S.center !== 'OTHER'; save(); if (S.center !== 'OTHER' || AP[S.other.toUpperCase()] || AP['K' + S.other.toUpperCase()]) applyCenter(); };
  $('f-other').oninput = (e) => { S.other = e.target.value.trim().toUpperCase(); const ok = AP[S.other] || AP['K' + S.other]; $('other-note').textContent = ok ? ok[2] + (ok[3] ? ', ' + ok[3] : '') : (S.other.length >= 3 ? 'No airport found with that code' : ''); if (ok) { save(); applyCenter(); } };
  $('f-radius').onchange = (e) => { S.radius = +e.target.value; save(); ground.setRing(C.lat, C.lon, radiusKm());  };
  $('f-pace').onchange = (e) => { S.pace = +e.target.value; save(); };
  $('f-click').value = String(S.clickSecs); $('f-click').onchange = (e) => { S.clickSecs = +e.target.value; save(); };
  $('f-flyback').value = String(S.flyBack); $('f-flyback').onchange = (e) => { S.flyBack = +e.target.value; save(); };
  fillKeys(); $('help').onclick = () => toggleHelp(false); $('mine-close').onclick = () => closeMine();
  $('findbtn').onclick = () => { $('findbtn').blur(); openFind(); };
  $('photobtn').onclick = () => { $('photobtn').blur(); openPhoto(); }; $('photo-close').onclick = () => closePhoto();
  $('find-q').oninput = () => { findSel = 0; renderFind(); };
  canvasControls();
  $('f-cap').onchange = (e) => { S.captions = e.target.checked; save(); };
  $('f-sky').onchange = (e) => { S.sky = e.target.value; save(); };
  $('f-wx').onchange = (e) => { S.wx = e.target.value; save(); if (S.wx === 'real') setWeather({}); applyWeather(); updateCorner(simClock || new Date()); };
  $('f-corner').onchange = (e) => { S.corner = e.target.checked; save(); };
  $('f-sat').checked = !!S.sat; $('f-sat').onchange = (e) => { S.sat = e.target.checked; save(); applySat(); };
  $('f-lights').onchange = (e) => { S.lights = e.target.value; save(); };
  if (__NET__) $('f-relay').onchange = (e) => { S.relay = e.target.value.trim(); save(); net.i = 0; net.fails = 0; net.ok = null; net.lastGood = -1e9; netTick(true); };
  if (__NET__) $('f-netmax').onchange = (e) => { S.netmax = +e.target.value; save(); netTick(true); };
  if (__NET__) $('f-src').onchange = (e) => { S.src = e.target.value; save(); netTick(true); updateCorner(simClock || new Date()); };
  $('f-trail').onchange = (e) => { S.trail = +e.target.value; save(); };
  renderPlaces(); $('f-places').onsubmit = (e) => { e.preventDefault(); addPlace(); };
  $('f-look').onsubmit = (e) => { e.preventDefault(); lookPlace(); };   // only on Enter or Find, never as the viewer types
  $('f-keep').checked = !!S.keep; $('f-keep').onchange = (e) => { S.keep = e.target.checked; save(); keepNotes(); $('places-note').textContent = S.keep ? 'Your places will be kept on this device.' : 'Your places are no longer kept. They will be forgotten when you close this page.'; };
  if (SHARED) {   // a guest is not looking at an antenna of their own, and has no relay to point at
    document.body.classList.add('shared');
    if (__NET__) { const o = $('f-src').options; o[0].textContent = "This site's antenna and the flight network"; o[1].textContent = "This site's antenna only"; }
  }
  $('listen').onclick = () => openListen();
  $('f-follow').onsubmit = (e) => { e.preventDefault(); setFollow($('f-flight').value); $('f-flight').blur(); };
  $('f-stop').onclick = () => setFollow('');
  renderWatch(); $('f-watch').onsubmit = (e) => { e.preventDefault(); addWatch(); };
  $('f-wsound').checked = !!S.watchSound; $('f-wsound').onchange = (e) => { S.watchSound = e.target.checked; save(); if (S.watchSound) { unlockAudio(); chime(); } };
  // a browser shows notifications only for a page at a secure (https) address, and only after the viewer allows them
  const canNotify = 'Notification' in window && window.isSecureContext;
  if (!canNotify) { S.watchNote = false; $('f-wnote').disabled = true; $('wnote-note').textContent = 'Notifications need the secure address, the one that starts with https. Alerts still show on this page.'; }
  else if (Notification.permission === 'denied') S.watchNote = false;
  $('f-wnote').checked = !!S.watchNote;
  $('f-wnote').onchange = (e) => {
    if (!e.target.checked) { S.watchNote = false; save(); return; }
    Notification.requestPermission().then((r) => {
      S.watchNote = r === 'granted'; $('f-wnote').checked = S.watchNote; save();
      $('wnote-note').textContent = S.watchNote ? 'You will get a notification when this page is in the background.' : 'The browser did not allow notifications. Alerts still show on this page.';
    }).catch(() => { S.watchNote = false; $('f-wnote').checked = false; save(); });
  };
  $('gear').onclick = () => togglePanel();
  $('close').onclick = () => togglePanel(false);
  let idle = null;
  const wake = () => { document.body.classList.add('awake'); clearTimeout(idle); idle = setTimeout(() => { if (!document.body.classList.contains('panel')) document.body.classList.remove('awake'); }, 3500); };
  window.addEventListener('pointermove', wake); window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
  window.addEventListener('keydown', (e) => {
    // Keys pressed while a setting has the keyboard: in a box you type into, every key is typing, so only Escape closes the panel.
    // On a menu, a checkbox or a button, S and Escape still close the panel, and every other key is left for the control itself.
    let el = e.target;
    // A control inside a window that has since closed (the settings, My places, search or the help) still holding the keyboard swallowed
    // every key, so the arrows did nothing until the sky was clicked. Take the keyboard back from it and treat the key as the page's.
    if (el && el !== document.body && el.closest && el.blur && ((el.closest('#panel') && !document.body.classList.contains('panel')) || (el.closest('#mine') && $('mine').hidden) || (el.closest('#find') && $('find').hidden) || (el.closest('#help') && $('help').hidden))) { el.blur(); el = document.body; }
    const tag = el && el.tagName, typing = tag === 'INPUT' && el.type !== 'checkbox';
    if (e.key === 'Escape') { e.preventDefault(); escapeKey(); return; }   // Escape closes the topmost window first, wherever the keyboard focus is
    if (el && el.id === 'find-q') { findKey(e); return; }
    if (!$('photo').hidden) { if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); closePhoto(); } return; }   // with the photo open, only I and Escape do anything
    if (!$('mine').hidden) { if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); closeMine(); } return; }   // with My places open, only P and Escape do anything; Enter and Space work its buttons
    if (typing) { if (e.key === 'Escape') togglePanel(false); return; }
    // An arrow key with the settings open, on a checkbox or a button, closes the settings and moves the sky as usual: after ticking
    // a setting the sky is still in view beside the settings, and the arrows doing nothing there looked broken.
    const arrow = e.key.indexOf('Arrow') === 0 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (arrow && (tag === 'INPUT' || tag === 'BUTTON') && document.body.classList.contains('panel') && el.closest && el.closest('#panel')) togglePanel(false);
    else if (tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON') { if (e.key === 's' || e.key === 'S' || e.key === 'Escape') { e.preventDefault(); togglePanel(e.key === 'Escape' ? false : undefined); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave the browser's own shortcuts alone
    const k = e.key, flying = shot.kind === 'fly';
    if (k === 'h' || k === 'H' || k === '?') { e.preventDefault(); toggleHelp(); return; }
    if (!$('help').hidden) return;   // while the help is showing, only H, ? and Escape do anything
    if (document.body.classList.contains('panel')) { if (arrow) togglePanel(false); else { if (k === 's' || k === 'S') togglePanel(); return; } }   // with the settings open, only S, Escape and the arrows do anything
    if (!$('find').hidden) return;
    if (e.repeat && !flying && (k === 'f' || k.indexOf('Arrow') === 0)) return;   // a key held down from before Escape must not take the controls again
    // clicked details are ended by clickUntil = 0, so updateCaption puts the current shot's caption back even when Follow keeps the camera
    const nextAircraft = () => { clickUntil = 0; paused = false; const p = pickNext(); if (p && !followOwns()) startVisit(p); };
    if (k === ' ') { paused = !paused; e.preventDefault(); }
    else if (k === 'n' || (k === 'ArrowRight' && !flying)) nextAircraft();
    else if (k === 'a' || k === 'A') autoTour();
    else if (k === 'w' || k === 'W') { clickUntil = 0; paused = false; if (!followOwns() || flying || shot.lock) goWide(); }
    else if (k === 'f') { enterFly(); fly.keysAt = nowS(); }
    else if (k === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); }
    else if (k === '+' || k === '=') { zoomFly(0.8); fly.keysAt = nowS(); }
    else if (k === '-' || k === '_') { zoomFly(1.25); fly.keysAt = nowS(); }
    else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || (k === 'ArrowRight' && flying)) { e.preventDefault(); enterFly(); fly.keysAt = nowS(); }
    else if (k === '/') { e.preventDefault(); openFind(); }
    else if (k === 'p' || k === 'P') { e.preventDefault(); openMine(); }
    else if (k === 'l' || k === 'L') openListen();
    else if (k === 'i' || k === 'I') openPhoto();
    else if (k === 't' || k === 'T') { const TR = [0, 2, 5, 10]; S.trail = TR[(TR.indexOf(S.trail) + 1) % TR.length]; save(); $('f-trail').value = String(S.trail); }
    else if (k === 'c' || k === 'C') { S.captions = !S.captions; save(); $('f-cap').checked = S.captions; }
    else if (k === 's' || k === 'S' || k === 'Enter') togglePanel();
  });
  // which keys are down right now, for moving about in fly mode
  window.addEventListener('keydown', (e) => { const tag = document.activeElement && document.activeElement !== document.body ? document.activeElement.tagName : ''; if (tag === 'INPUT' || tag === 'SELECT' || !$('help').hidden || !$('find').hidden || !$('mine').hidden || !$('photo').hidden || document.body.classList.contains('panel')) return; held.add(e.key); });
  window.addEventListener('keyup', (e) => { held.delete(e.key); });
  window.addEventListener('blur', () => held.clear());
}
function escapeKey() {
  const ae = document.activeElement; if (ae && ae !== document.body && ae.blur) ae.blur();   // give the keyboard back to the page, so the other keys work again
  if (!$('help').hidden) toggleHelp(false);
  else if (!$('photo').hidden) closePhoto();
  else if (!$('find').hidden) closeFind();
  else if (!$('mine').hidden) closeMine();
  else if (document.body.classList.contains('panel')) togglePanel(false);
  else if (cameraOwner() === 'fly' || cameraOwner() === 'lock') leaveControls();
  else if (clicked) clickUntil = 0;
}
// ---------- the mouse: drag to look around, wheel to zoom, click for details, double click to stay with an aircraft ----------
function canvasControls() {
  let drag = null; canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    // a click on the sky closes the settings, My places and search, and takes the keyboard back from any control, so the keys work again
    if (document.body.classList.contains('panel')) togglePanel(false);
    closeMine(); closePhoto(); if (!$('find').hidden) closeFind();
    const ae = document.activeElement; if (ae && ae !== document.body && ae !== canvas && ae.blur) ae.blur();
    if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, az: 0, el: 0, moved: false }; try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* fine without it */ } });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) { const over = !planeAt(e.clientX, e.clientY, 16) && airportLabelAt(e.clientX, e.clientY); const cur = over ? 'pointer' : ''; if (canvas.style.cursor !== cur) canvas.style.cursor = cur; return; } const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) { if (Math.hypot(dx, dy) < 6) return; drag.moved = true; enterFly(); drag.az = fly.az; drag.el = fly.el; }
    fly.az = drag.az + dx * 0.25; fly.el = clamp(drag.el + dy * 0.25, 3, 88); fly.last = nowS();
  });
  const end = (e) => { if (!drag) return; const d = drag; drag = null; if (!d.moved && e.type === 'pointerup') clickAt(e.clientX, e.clientY); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', (e) => { const p = planeAt(e.clientX, e.clientY); if (p) lockOn(p); });
  // A Magic Mouse or a trackpad sends small scroll events when a finger only brushes it while the mouse moves. Those used to start fly mode,
  // so the camera stopped touring whenever the mouse was moved. Now the scroll has to add up to a real turn of the wheel (WHEEL_TAKE
  // within half a second) before it takes the controls; once flying, every scroll zooms as before.
  let wheelSum = 0, wheelT = 0;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); const t = nowS(), d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (shot.kind !== 'fly') { if (t - wheelT > 0.5) wheelSum = 0; wheelT = t; wheelSum += Math.abs(d); if (wheelSum < WHEEL_TAKE) return; wheelSum = 0; }
    zoomFly(Math.exp(clamp(d, -200, 200) * 0.0015));
  }, { passive: false });
}
// ---------- help and search ----------
const HELP = [
  ['A', 'Auto tour: pull back, then glide in on one aircraft after another. This pauses Follow until you follow a flight again'],
  ['W', 'Pull back to see the whole area'],
  ['F', 'Fly: take the controls. Drag with the mouse to look around'],
  ['Arrow keys', 'In fly mode, up and down move forward and back, left and right turn. Hold Shift with up or down to climb or descend'],
  ['+ and -', 'Zoom in and out. The mouse wheel does too'],
  ['Click', 'Click an aircraft to see its details for a while'],
  ['Double click', 'Zoom in on an aircraft and stay with it'],
  ['P', 'My places: pick one to move the sky there'],
  ['/', 'Search by airline, flight number, tail number, plane type, origin or destination'],
  ['Space bar', 'Hold on this aircraft, or move on'],
  ['Right arrow', 'Go to another aircraft, when not flying'],
  ['Escape', 'Close a window, or leave fly mode and go back to the auto tour'],
  ['T', 'Change how long the trails are'],
  ['C', 'Captions on or off'],
  ['Shift and F', 'Fill the screen'],
  ['L', 'Listen to air traffic control near the view, on LiveATC.net'],
  ['I', 'A photo of the aircraft in the caption, from Planespotters.net'],
  ['S', 'Open or close the settings'],
  ['H or ?', 'Show or hide this help'],
];
function fillKeys() {
  for (const id of ['keys-dl', 'help-dl']) {
    const dl = $(id); dl.innerHTML = '';
    for (const [k, v] of HELP) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; dl.appendChild(dt); dl.appendChild(dd); }
  }
}
function toggleHelp(on) { const h = $('help'), open = on === undefined ? h.hidden : on; h.hidden = !open; if (open) { held.clear(); closeFind(); closeMine(); document.body.classList.add('awake'); } }
// Version 3.7.1: P opens a small window with just the viewer's places, the same list as "Center the sky on". One click moves the sky there.
function openMine() { closePhoto();
  toggleHelp(false); closeFind(); document.body.classList.remove('panel'); held.clear(); document.body.classList.add('awake');
  renderMine(); $('mine').hidden = false;
  const first = $('mine-list').querySelector('button') || $('mine-close'); first.focus();
}
// Each button goes to the place it names, looked up when clicked, so a list changed in another copy of the page meanwhile never sends the sky to a different place
function renderMine() {
  const box = $('mine-list'), had = box.contains(document.activeElement); box.innerHTML = ''; const list = placeList(), cur = /^P\d+$/.test(S.center) ? +S.center.slice(1) : -1;
  list.forEach((pl, i) => {
    const b = document.createElement('button'); b.type = 'button';
    b.textContent = pl.n + (i === cur ? '  (here now)' : ''); b.setAttribute('aria-label', 'Go to ' + pl.n);
    b.onclick = () => {
      const j = placeList().findIndex((q) => q.n === pl.n && q.lat === pl.lat && q.lon === pl.lon);
      if (j === -1) { renderMine(); return; }
      closeMine(); S.center = 'P' + j; save(); buildCenterOptions(); applyCenter();
    };
    box.appendChild(b);
  });
  $('mine-note').textContent = list.length ? 'Click one to move the sky there. P or Escape closes this.' : 'No places yet. Press S, then add one under My places or with Find a place.';
  if (had) (box.querySelector('button') || $('mine-close')).focus();
}
function closeMine() { const m = $('mine'); if (m.hidden) return; m.hidden = true; const ae = document.activeElement; if (ae && m.contains(ae) && ae.blur) ae.blur(); }
let findSel = 0, findList = [], routesAsked = -1e9, findTimer = 0;
function openFind() { closePhoto();
  toggleHelp(false); closeMine(); document.body.classList.remove('panel'); held.clear(); $('find').hidden = false; clearInterval(findTimer); findTimer = setInterval(() => { if (!$('find').hidden) renderFind(); }, 2000); $('find-q').value = ''; findSel = 0; renderFind(); $('find-q').focus();
  let n = 0; for (const p of planes.values()) if (p.lat !== null && !p.info && n++ < 40) dbLookup(p).then(() => { if (!$('find').hidden) renderFind(); }, () => {});
  prefetchRoutes().then(() => { if (!$('find').hidden) renderFind(); });
}
function closeFind() { $('find').hidden = true; clearInterval(findTimer); $('find-q').blur(); }
// an aircraft chosen from the list may have dropped out of reach while the box was open
function pickFound(p) {
  if (!p || p.lat === null || !p.fresh(nowS()) || p.opacity < 0.1) { renderFind(); $('find-note').textContent = 'That aircraft is no longer being tracked. Pick another.'; return; }
  closeFind(); lockOn(p);
}
function markFound(i) {
  findSel = i; const kids = [...$('find-list').children];
  kids.forEach((li, j) => { li.className = j === i ? 'sel' : ''; li.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
  $('find-q').setAttribute('aria-activedescendant', kids.length ? 'find-opt-' + i : '');
  const li = kids[i]; if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
}
// Origins and destinations come from the same volunteer route table the caption uses. One request covers every aircraft on screen.
async function prefetchRoutes() {
  const t = nowS(); if (t - routesAsked < 20) return; routesAsked = t;
  const want = [];
  for (const p of planes.values()) {
    const cs = p.callsign(); if (p.lat === null || !p.fresh(t) || !/^[A-Z]{2,3}\d/.test(cs)) continue;
    const c = routes.get(cs); if (c && t < c.until) continue;
    if (!want.some((w) => w.callsign === cs)) want.push({ callsign: cs, lat: +p.rLat.toFixed(3), lng: +p.rLon.toFixed(3) });
    if (want.length >= 60) break;
  }
  if (!want.length) return;
  const { got, answered } = await askRoutes(want);
  for (const w of want) {
    const good = got.get(w.callsign);
    if (good) routes.set(w.callsign, { route: good, until: nowS() + 6 * 3600 });
    else if (answered.has(w.callsign)) routes.set(w.callsign, { route: null, until: nowS() + 600 });   // flights no service knows are asked again in ten minutes; flights nobody answered for, sooner
  }
}
// a route to trust, as the two airports of the leg being flown: the same guard the caption uses, so a wrong entry in the route
// table never turns up as a search result
function routeOf(p) { const c = routes.get(p.callsign()); return routeLeg(c && c.route, p); }
// Altitude in words. The pressure altitude a receiver hears is not corrected for the day's air pressure, so an aircraft close
// to the ground can read a little below zero (version 3.10): anything at or below 100 feet is said to be near the ground.
function altWords(ground, ft, step) { return ground ? 'on the ground' : ft <= 100 ? 'near the ground' : fmtInt(Math.round(ft / step) * step) + ' feet'; }
function flightLabel(p) {
  const cs = p.callsign(); if (!cs) return p.reg || p.hex.toUpperCase();
  const pt = partnerOf(cs, routeOf(p)), partner = pt && pt.key && AIRLINES[pt.key];
  return partner ? partner[0] + ' ' + cs.slice(3) : cs.replace(/^([A-Z]{3})(\d)/, '$1 $2');
}
// People search by the name on the side of the aircraft ("757", "A320"), the data carries a short code ("B752", "A320"), so spell out the common ones
const TYPE_WORDS = { A318: 'a318', A319: 'a319', A320: 'a320', A321: 'a321', A19N: 'a319 neo', A20N: 'a320 neo', A21N: 'a321 neo', A332: 'a330', A333: 'a330', A338: 'a330 neo', A339: 'a330 neo',
  A342: 'a340', A343: 'a340', A346: 'a340', A359: 'a350', A35K: 'a350', A388: 'a380', BCS1: 'a220', BCS3: 'a220', E170: 'e170 embraer', E75L: 'e175 embraer', E75S: 'e175 embraer', E190: 'e190 embraer', E195: 'e195 embraer',
  CRJ2: 'crj bombardier', CRJ7: 'crj bombardier', CRJ9: 'crj bombardier', GLF4: 'gulfstream g400', GLF5: 'gulfstream g500', GLF6: 'gulfstream g650', GA5C: 'gulfstream g500', GA6C: 'gulfstream g600',
  C25A: 'citation cj2', C25B: 'citation cj3', C25C: 'citation cj4', C525: 'citation cj1', C510: 'citation mustang', C550: 'citation', C56X: 'citation excel', C680: 'citation sovereign', C750: 'citation x',
  CL30: 'challenger', CL35: 'challenger', CL60: 'challenger', E55P: 'phenom', E50P: 'phenom', PC12: 'pilatus', C172: 'cessna skyhawk', SR22: 'cirrus' };
function typeWords(c) {
  if (!c) return ''; if (TYPE_WORDS[c]) return TYPE_WORDS[c];
  const m = /^B7(\d)\d$/.exec(c); if (m) return '7' + m[1] + '7 boeing';
  if (/^B3[789X]M$/.test(c)) return '737 max boeing';
  return '';
}
function searchText(p) {
  const cs = p.callsign(), own = /^[A-Z]{3}\d/.test(cs) ? cs.slice(0, 3) : '', ai = own && AIRLINES[own], rt = routeOf(p), pt = partnerOf(cs, rt), partner = pt && pt.key && AIRLINES[pt.key];
  const info = p.info || {};
  const ends = rt ? rt.map((a) => [a.iata, a.icao, a.name, a.location].join(' ')).join(' ') : '';
  const kind = p.category === 'A7' ? 'helicopter rotorcraft' : '';
  const h = [cs, ai ? ai[0] + cs.slice(3) : '', partner ? partner[0] + cs.slice(3) : '', airlineName(cs), partner ? partner[1] : '', p.reg, info.reg, p.hex, p.type, typeWords(p.type), p.desc, info.long, info.type, kind, ends].join(' ').toLowerCase();
  return h + ' ' + h.replace(/[- ]/g, '');   // also without dashes and spaces, so A320 finds A-320 and DL1234 finds DL 1234
}
function renderFind() {
  const q = $('find-q').value.trim().toLowerCase(), t = nowS(), ul = $('find-list'); ul.innerHTML = '';
  const live = [...planes.values()].filter((p) => p.lat !== null && p.fresh(t) && p.opacity > 0.05);
  findList = [];
  if (!q) $('find-note').textContent = `Searching the ${live.length} aircraft being tracked. Try an airline, a flight number, a tail number, a plane type such as 757, or an airport.`;
  else {
    const words = q.split(/\s+/);
    findList = live.filter((p) => { const h = searchText(p); return words.every((w) => h.indexOf(w) !== -1); });
    findList.sort((a, b) => gcDist(C.lat, C.lon, a.rLat, a.rLon) - gcDist(C.lat, C.lon, b.rLat, b.rLon));
    const n = findList.length; findList = findList.slice(0, 8);
    $('find-note').textContent = n ? `${n} found${n > 8 ? ', the 8 nearest the center shown' : ''}. Origins and destinations are known for some flights only.` : 'Nothing matches. Only aircraft the page is tracking are searched, and origins and destinations are known for some flights only.';
  }
  findSel = clamp(findSel, 0, Math.max(findList.length - 1, 0));
  findList.forEach((p, i) => {
    const li = document.createElement('li'), b = document.createElement('b'), s = document.createElement('small'), rt = routeOf(p), al = airlineName(p.callsign());
    b.textContent = flightLabel(p) + (al ? '  ' + al : '');
    const type = prettyType((p.info && p.info.long) || p.desc || '') || p.type || '';
    const route = rt ? placeName(rt[0]) + ' to ' + placeName(rt[1]) : (/^[A-Z]{2,3}\d/.test(p.callsign()) ? 'route not known' : '');
    s.textContent = [type, altWords(p.ground, p.altFt, 25), route].filter(Boolean).join('  \u00b7  ');
    li.appendChild(b); li.appendChild(s); li.id = 'find-opt-' + i; li.setAttribute('role', 'option');
    li.onmouseenter = () => markFound(i);
    li.onclick = () => pickFound(p);
    ul.appendChild(li);
  });
  markFound(findSel);
}
function findKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); markFound(Math.min(findSel + 1, findList.length - 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); markFound(Math.max(findSel - 1, 0)); }
  else if (e.key === 'Enter') { e.preventDefault(); pickFound(findList[findSel]); }
}
function togglePanel(on) {
  const b = document.body; const next = on === undefined ? !b.classList.contains('panel') : on; b.classList.toggle('panel', next); if (next) { b.classList.add('awake'); held.clear(); closeMine(); }
  // when the panel closes, take the keyboard back from whichever setting was last touched, so the space bar and the other keys work again
  if (!next && document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
}

// ---------- frame loop ----------
let fpsN = 0, fpsT = nowS(), slow = 0; const bootT = nowS();
let renderNext = true, lastT = nowS(), lookT = -100, simClock = Q.has('time') ? new Date(Q.get('time')) : null;
const A3 = new THREE.Vector3();
function applySat() { sat.setOn(S.sat); $('satcredit').hidden = !S.sat; satT = -100; satNote(); }
function satNote() {
  const n = $('sat-note'), text = S.sat && sat.down ? 'The satellite photos are not loading right now, so the drawn map is shown. The page tries again in a few minutes.' : 'Photos from EOxCloudless (Sentinel-2), loaded by this browser straight from EOX, not through the receiver. EOX can see which area is on screen. Free for personal, non-commercial use.';
  if (n._t !== text) { n._t = text; n.textContent = text; }
}
function frame() {
  const t = nowS(), dt = clamp(t - lastT, 0.001, 0.25); lastT = t;
  flyStep(dt); updateCamera(t);
  const date = simClock || new Date();
  updateLook(pose.lat, pose.lon, date); updateWeather(t, dt);
  if (t - lookT > 2) { lookT = t; applyWeather(); updateCorner(date); updateListen(); satNote(); }
  if (S.sat && t - satT > 0.5) { satT = t; sat.update(pose.lat, pose.lon, clamp(pose.dist * 3, 30, 600), t); }
  sky.starU.time.value = t;
  trails.reset(); drops.reset();
  const trailSec = S.trail * 60;
  for (const p of planes.values()) {
    updatePlane(p, t, dt, look.night);
    if (t - p.tSeen > 75 && p.opacity <= 0) { if (shot.plane !== p) removePlane(p); continue; }
    if (p.lat === null || p.opacity <= 0.01) continue;
    if (trailSec > 0 && p.trail.length) {
      let prev = null, pa = 0; const tr = p.trail;
      for (let i = 0; i < tr.length; i++) {
        const s = tr[i], age = t - s.t; if (age > trailSec) continue;
        if (s.ep !== proj.epoch) { project(s.lat, s.lon, s.alt, s.v); s.ep = proj.epoch; }
        const a = Math.pow(1 - age / trailSec, 1.4) * p.opacity * 0.9;
        if (prev && s.t - tr[i - 1].t < 45) trails.add(prev.x, prev.y, prev.z, s.v.x, s.v.y, s.v.z, pa, a);
        prev = s.v; pa = a;
      }
      if (prev && t - tr[tr.length - 1].t < 45) trails.add(prev.x, prev.y, prev.z, p.pos.x, p.pos.y, p.pos.z, pa, p.opacity * 0.9);
    }
    project(p.rLat, p.rLon, 0, A3);
    drops.add(p.pos.x, p.pos.y, p.pos.z, A3.x, A3.y, A3.z, 0.3 * p.opacity, 0.05 * p.opacity);
  }
  trails.commit(); drops.commit();
  const k = Math.tan((camera.fov * D2R) / 2) * 2 * 0.021;
  for (const l of labels) { l.sprite.scale.set(k * l.sprite.userData.aspect, k, 1); }
  updateCaption(t); updatePick();
  // if the screen cannot keep up, draw at a lower resolution rather than stutter
  fpsN++; if (!MANUAL && t - fpsT > 5) { const fps = fpsN / (t - fpsT); fpsN = 0; fpsT = t; if (fps < 24 && DPR > 0.75 && document.visibilityState === 'visible' && ++slow >= 2) { slow = 0; DPR = Math.max(0.75, DPR - 0.25); renderer.setPixelRatio(DPR); resize(); } else if (fps >= 24) slow = 0; }
  if (!MANUAL || renderNext) {
    renderer.render(scene, camera);
    if (weather.active) { renderer.autoClear = false; renderer.render(weather.scene, weather.camera); renderer.autoClear = true; }
  }
  if (!MANUAL) requestAnimationFrame(frame);
}

// ---------- start ----------
resize(); reorigin(C.lat, C.lon); applyWeather(); updateLook(C.lat, C.lon, simClock || new Date()); initPanel(); applySat();
if (S.follow) setFollow(S.follow);
if (!MANUAL) { poll(); setInterval(followTick, 1000); setInterval(watchTick, 1000); if (__NET__) { netTick(true); setInterval(netTick, 1000); } }
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setTimeout(() => location.reload(), 1500); });
try { if (navigator.wakeLock) { const lock = () => navigator.wakeLock.request('screen').catch(() => {}); lock(); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lock(); }); } } catch (e) { /* not supported */ }
window.__sky = { get home() { return home; }, set home(v) { home = v; }, save, modelFor, routeHtml, partnerOf, altWords, updateCaption, prepareCaption, get capPlane() { return capPlane; }, cameraOwner, leaveControls, airportLabelAt, centerOnAirport, get labels() { return labels; }, sat, applySat, applyCenter, routeLeg, getRoute, prefetchRoutes, fly, enterFly, lockOn, autoTour, clickAt, planeAt, openFind, openMine, routes, held, get clicked() { return clicked; }, get paused() { return paused; }, wxNow, wxInfo, weather, sky, sunNow, planes, pose, renderer, PlaneMesh, paintFor, ingest, get shot() { return shot; }, reorigin, project, S, follow, ground, scene, camera, proj, look, trails, startVisit, goWide, setFollow, followTick, matchFollow, watchTick, watchState, watch, addWatch, dismissWatch, lookPlace, setTime: (d) => { simClock = d ? new Date(d) : null; lookT = -100; },
  step: (dt, render) => { vt += dt; renderNext = !!render; frame(); },
  feed: async (T) => { fakeT = T; if (Q.get('noant') !== '1') { const d = await getJSON((dataBase || DATA_BASES[0]) + 'aircraft.json?t=' + T); if (!dataBase) { dataBase = DATA_BASES[0]; ingest(d.aircraft, d.now); lastGood = nowS(); await afterFirstData(); } else { ingest(d.aircraft, d.now); lastGood = nowS(); } } if (__NET__) await netTick(); },
  net, NET: __NET__ };
if (!MANUAL) requestAnimationFrame(frame);
