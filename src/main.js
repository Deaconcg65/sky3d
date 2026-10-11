// 3D sky channel. One page that reads the aircraft list from a readsb or dump1090 receiver and flies a camera through it.
import * as THREE from 'three';
import { R_EARTH, FT, KT, MI, D2R, clamp, lerp, smooth, angDiff, lerpAng, gcDist, bearing, sunPosition, sunTimes, fmtInt, prettyType } from './util.js';
import { VEX, proj, setOrigin, project, localFrame, Segments, Ground, Sky, WeatherLayer, PlaneMesh, modelFor, makeLabel } from './scene.js';
import { AIRLINES, IATA2ICAO, paintFor } from './airlines.js';

const Q = new URLSearchParams(location.search);
// __NET__ is set when the page is built: true in the network edition, false in the home edition.
// Because it is fixed at build time, every part of the code that depends on it is left out of the home edition altogether.
const GEO = JSON.parse(document.getElementById('geo-data').textContent);
const AIRPORTS = JSON.parse(document.getElementById('airport-data').textContent);
const AP = {}; for (const a of AIRPORTS) { AP[a[0]] = a; if (a[1]) AP[a[1]] = a; }
const $ = (id) => document.getElementById(id);

// ---------- settings ----------
const PRESETS = [
  ['MID', 'Midway between LaGuardia and Kennedy'], ['KJFK', 'Kennedy'], ['KLGA', 'LaGuardia'], ['KEWR', 'Newark'], ['KHPN', 'White Plains'],
  ['KBDR', 'Bridgeport'], ['KHVN', 'New Haven'], ['KISP', 'Islip'], ['KTEB', 'Teterboro'], ['KSWF', 'Stewart'], ['KBDL', 'Hartford Bradley'],
];
if (__NET__) PRESETS.push(['KBOS', 'Boston'], ['KPHL', 'Philadelphia'], ['KDCA', 'Washington National'], ['KATL', 'Atlanta'], ['KMIA', 'Miami'], ['KORD', 'Chicago O\'Hare'], ['KDFW', 'Dallas Fort Worth'],
  ['KDEN', 'Denver'], ['KLAX', 'Los Angeles'], ['KSFO', 'San Francisco'], ['KSEA', 'Seattle']);
const DEFAULTS = { center: 'MID', other: '', radius: 30, follow: '', pace: 20, captions: true, sky: 'real', trail: 5, wx: 'real', corner: true, lights: 'arr', src: 'blend' };
const S = Object.assign({}, DEFAULTS);
try { Object.assign(S, JSON.parse(localStorage.getItem('sky3d') || '{}')); } catch (e) { /* storage unavailable */ }
for (const k of Object.keys(DEFAULTS)) if (Q.has(k)) { const v = Q.get(k); S[k] = typeof DEFAULTS[k] === 'number' ? +v : typeof DEFAULTS[k] === 'boolean' ? v !== '0' && v !== 'false' : v; }
const save = () => { try { localStorage.setItem('sky3d', JSON.stringify(S)); } catch (e) { /* ignore */ } };
let home = null;   // receiver position, if the receiver has one set

function centerPoint() {
  if (S.center === 'MID') { const a = AP.KJFK, b = AP.KLGA; return { lat: (a[4] + b[4]) / 2, lon: (a[5] + b[5]) / 2, name: 'New York', short: 'the midpoint of LaGuardia and Kennedy' }; }
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
    const t = nowS(); let ant = 0, nw = 0; for (const p of planes.values()) if (p.fresh(t) && !p.remote) { if (p.src === 'ant') ant++; else nw++; }
    const pl = (n) => n + (n === 1 ? ' aircraft' : ' aircraft');
    set('k-src', S.src === 'antenna' ? (dataBase ? pl(ant) + ' heard by your antenna' : '') : !dataBase || S.src === 'network' ? (net.ok ? pl(nw) + ' from the flight network' : '') : net.ok ? ant + ' by your antenna, ' + nw + ' more from the flight network' : pl(ant) + ' heard by your antenna');
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
    // the callsign or the aircraft type often arrives a few seconds after the first position, so repaint once it is known
    p.tPaint = t; const kind = modelFor(p.category, p.type);
    if (kind !== p.kind && (shot.plane === p || (prevShot && prevShot.plane === p))) { /* the camera is riding on this aircraft: change its shape later, so the view never jumps */ }
    else if (kind !== p.kind) { planeLayer.remove(p.mesh.group); p.mesh.dispose(); p.mesh = new PlaneMesh(kind, paintFor(p.callsign(), p.hex, kind)); p.kind = kind; planeLayer.add(p.mesh.group); }
    else { const c = paintFor(p.callsign(), p.hex, kind); p.mesh.paint.forEach((col, i) => col.set(c[i])); }
    p.paintKey = p.callsign() + '|' + p.kind;
  }
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
      if (tPos > p.tPos + 0.05) { p.report(ac, tPos); p.src = kind === 0 ? 'ant' : 'net'; }
    }
  }
}

// ---------- the flight network (network edition only) ----------
// A free community network of receivers. It is asked only for the aircraft around the place on screen, every few seconds.
// Nothing from this receiver's antenna is sent to it.
const NET_CAP = 130;
const NET_SOURCES = !__NET__ ? null : [
  { name: 'ADSB.lol', every: 5, url: (la, lo, r) => (Q.get('netApi') || 'https://api.adsb.lol/v2/') + 'point/' + la + '/' + lo + '/' + r },
  { name: 'airplanes.live', every: 10, url: (la, lo, r) => 'https://api.airplanes.live/v2/point/' + la + '/' + lo + '/' + r },
  { name: 'adsb.fi', every: 10, url: (la, lo, r) => 'https://opendata.adsb.fi/api/v2/lat/' + la + '/lon/' + lo + '/dist/' + r },
];
const net = { i: 0, ok: null, last: -1e9, lastGood: -1e9, fails: 0, busy: false, name: '' };
function netRadiusNm() { const mi = S.radius > 0 ? Math.max(S.radius * 1.5, 40) : 140; return Math.round(clamp(mi * 0.869, 35, 130)); }
async function netTick(force) {
  if (!__NET__ || S.src === 'antenna' || net.busy || (!MANUAL && document.hidden)) return;
  const t = nowS(), src = NET_SOURCES[net.i]; if (!force && t - net.last < src.every) return;
  net.busy = true; net.last = t;
  // ask around the centre of the sky, or around a followed flight once it has left that area
  const far = follow.state === 'on' && gcDist(C.lat, C.lon, pose.lat, pose.lon) > 60, la = far ? pose.lat : C.lat, lo = far ? pose.lon : C.lon;
  try {
    const d = await getJSON(src.url(la.toFixed(3), lo.toFixed(3), netRadiusNm()) + (MANUAL && fakeT ? '?t=' + fakeT : ''));
    const list = (d.ac || d.aircraft || []).filter((a) => a && a.lat != null && a.lon != null && a.alt_baro !== 'ground');
    for (const a of list) a._d = gcDist(la, lo, a.lat, a.lon);
    list.sort((x, y) => x._d - y._d);
    if (S.src !== 'antenna') ingest(list.slice(0, NET_CAP), 0, 2);
    net.ok = true; net.fails = 0; net.lastGood = nowS(); net.name = src.name;
  } catch (e) {
    net.fails++; if (nowS() - net.lastGood > 40) net.ok = false;
    if (net.fails >= 2 && !Q.has('netApi')) { net.i = (net.i + 1) % NET_SOURCES.length; net.fails = 0; }   // try the next network
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
  try { const r = await getJSON(dataBase + 'receiver.json'); if (r && typeof r.lat === 'number' && typeof r.lon === 'number') { home = { lat: r.lat, lon: r.lon }; buildCenterOptions(); if (S.center === 'HOME') applyCenter(); } } catch (e) { /* no home position */ }
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
        const data = db.shards[bkey] || (db.shards[bkey] = await getJSON(db.folder + bkey + '.js', { cache: 'default' }));
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
const ROUTE_APIS = Q.has('routeApi') ? [Q.get('routeApi')] : ['https://adsb.im/api/0/routeset', 'https://api.adsb.lol/api/0/routeset'];
const POS_API = Q.get('posApi') || 'https://api.adsb.lol/v2/';
const routes = new Map();
async function getRoute(p) {
  const cs = p.callsign(); if (!cs || !/^[A-Z]{2,3}\d/.test(cs)) return null;
  const c = routes.get(cs); if (c && nowS() < c.until) return c.route;
  routes.set(cs, { route: c ? c.route : null, until: nowS() + 30 });
  const body = JSON.stringify({ planes: [{ callsign: cs, lat: +p.rLat.toFixed(3), lng: +p.rLon.toFixed(3) }] });
  for (const url of ROUTE_APIS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body });
      if (!r.ok) continue; const arr = await r.json(); const rt = Array.isArray(arr) ? arr.find((x) => x && x.callsign === cs) || arr[0] : null;
      const good = rt && rt._airports && rt._airports.length >= 2 && rt.plausible !== false ? rt : null;
      routes.set(cs, { route: good, until: nowS() + 6 * 3600 }); return good;
    } catch (e) { /* try the next service */ }
  }
  return null;
}
const follow = { want: '', hex: null, lastRemote: 0, state: 'off', since: 0, netOk: true };
function parseFlight(s) {
  s = (s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!s) return '';
  const m = s.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/); if (m && IATA2ICAO[m[1]] && !/^[A-Z]{3}/.test(s)) return IATA2ICAO[m[1]] + m[2];
  return s;
}
function setFollow(text) {
  follow.want = parseFlight(text); follow.hex = null; follow.state = follow.want ? 'looking' : 'off'; follow.since = nowS(); follow.lastRemote = 0;
  S.follow = follow.want; save(); $('f-flight').value = follow.want; $('f-stop').hidden = !follow.want;

}
function matchFollow() {
  const w = follow.want, t = nowS(); let best = null;
  for (const p of planes.values()) { if (!p.fresh(t)) continue; if (p.callsign() === w || (p.reg || '').replace(/-/g, '') === w || p.hex.toUpperCase() === w) { if (!best || (best.remote && !p.remote)) best = p; } }
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
      const d = await getJSON(POS_API + 'callsign/' + encodeURIComponent(follow.want) + (MANUAL && fakeT ? '?t=' + fakeT : '')); follow.netOk = true;
      let ac = (d.ac || []).filter((a) => a.lat != null);
      if (!ac.length && /^[A-Z]-?[A-Z0-9]{3,5}$|^N\d/.test(follow.want)) { const d2 = await getJSON(POS_API + 'reg/' + encodeURIComponent(follow.want)); ac = (d2.ac || []).filter((a) => a.lat != null); }
      if (ac.length) ingest([ac[0]], 0, 1);
    } catch (e) { follow.netOk = false; }
  }
  if (follow.state === 'on' && !p) {
    const old = follow.hex && planes.get(follow.hex);
    if (!old || t - old.tPos > 90) { follow.state = 'looking'; follow.since = t; }
  }
}

// ---------- camera ----------
// A pose is where the camera looks (lat, lon, altitude) and where it sits around that point (compass angle, height angle, distance).
const pose = { lat: C.lat, lon: C.lon, alt: 0, az: 200, el: 26, dist: 160 };
function newShot(kind, plane) {
  return { kind, plane: plane || null, t0: nowS(), dur: 0.01, hold: 8, side: Math.random() < 0.5 ? -1 : 1, az0: pose.az, azU: null, sub: 0, tSub: nowS(), subT: 0, subFrom: null, swing: 40 + Math.random() * 50, elBase: 7 + Math.random() * 9, frozen: null };
}
let shot = newShot('wide'), prevShot = null;
shot.az0 = 200;
let paused = false; const recent = [];
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
function visitDist(p) { return 3.1 * (p.mesh ? Math.pow(p.mesh.len, 0.8) : 1); }
// where a shot wants the camera at time t; the compass angle is kept continuous so the camera never swings the long way round
function livePose(sh, t, out, ref) {
  if (sh.kind === 'frozen') return Object.assign(out, sh.frozen);
  const el = t - sh.t0; let az;
  if (sh.kind === 'wide' || !sh.plane || sh.plane.lat === null) {
    out.lat = C.lat; out.lon = C.lon; out.alt = 0; az = sh.az0 + el * 0.9; out.el = 25 + 3 * Math.sin(t * 0.05); out.dist = wideDist();
  } else {
    const p = sh.plane, d = visitDist(p);
    out.lat = p.rLat; out.lon = p.rLon; out.alt = p.rAlt;
    if (sh.kind === 'visit') {
      const k = el / Math.max(sh.dur + S.pace, 1);
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
const B_E = new THREE.Vector3(), B_N = new THREE.Vector3(), B_U = new THREE.Vector3(), B_M = new THREE.Matrix4(), B_Q = new THREE.Quaternion(), CAMQ = new THREE.Quaternion();
function updateCamera(t) {
  // what to look at next
  const el = t - shot.t0;
  if (follow.state === 'on' && planes.get(follow.hex)) {
    if (shot.kind !== 'follow' || shot.plane !== planes.get(follow.hex)) { if (el > shot.dur) startFollow(planes.get(follow.hex)); }
    else if (el > shot.dur && t - shot.tSub > 38) { livePose(shot, t, TP); shot.subFrom = [TP.dist, TP.el]; shot.sub++; shot.tSub = t; shot.subT = t; }
  } else if (shot.kind === 'wide') {
    if (el > shot.dur + shot.hold && !paused) { const p = pickNext(); if (p) startVisit(p); }
  } else if (shot.kind === 'visit') {
    const p = shot.plane, gone = !planes.has(p.hex) || p.opacity < 0.25 || !p.fresh(t);
    if (gone || (!paused && el > shot.dur + S.pace)) goWide();
  } else goWide();
  const s = smooth((t - shot.t0) / shot.dur);
  if (s >= 1 || !prevShot) { livePose(shot, t, pose); prevShot = null; }
  else {
    livePose(prevShot, t, FP); livePose(shot, t, TP, FP.az);
    const sf = smooth((t - shot.t0) / (shot.dur * 0.72));
    pose.lat = lerp(FP.lat, TP.lat, sf); pose.lon = lerp(FP.lon, TP.lon, sf); pose.alt = lerp(FP.alt, TP.alt, sf);
    pose.az = lerp(FP.az, TP.az, s);
    // rise a little in the middle of a long move so it reads as a glide, not a cut
    const far = gcDist(FP.lat, FP.lon, TP.lat, TP.lon), arc = Math.sin(Math.PI * s);
    pose.dist = Math.exp(lerp(Math.log(FP.dist), Math.log(TP.dist), s)) * (1 + arc * clamp(far / 400, 0, 0.25));
    pose.el = lerp(FP.el, TP.el, s) + arc * 4;
  }
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

// ---------- caption ----------
let capPlane = null, capShown = false, capRoute = null, capInfo = null;
function hideCaption() { capShown = false; $('cap').classList.remove('on'); }
function prepareCaption(p) {
  capPlane = p; capRoute = null; capInfo = null; capShown = false; $('cap').classList.remove('on');
  getRoute(p).then((r) => { if (capPlane === p) capRoute = r; });
  dbLookup(p).then((i) => { if (capPlane === p) capInfo = i; });
}
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function placeName(a) { return ((a.location || a.name || '').split(/[,(/]/)[0].trim()) || a.iata || a.icao; }
function updateCaption(t) {
  const p = capPlane, active = p && (shot.kind === 'visit' || shot.kind === 'follow') && shot.plane === p;
  const show = active && S.captions && (t - shot.t0) > shot.dur * 0.55;
  if (show) {
    const cs = p.callsign(), al = airlineName(cs), info = capInfo || {};
    $('c-air').textContent = al || (cs ? '' : 'Unidentified aircraft');
    $('c-flight').textContent = cs ? cs.replace(/^([A-Z]{3})(\d)/, '$1 $2') : (info.reg || p.hex.toUpperCase());
    let route = '';
    if (capRoute) { const ap = capRoute._airports, a = ap[0], b = ap[ap.length - 1]; route = `${esc(placeName(a))} <i>${esc(a.iata || a.icao)}</i> <span>to</span> ${esc(placeName(b))} <i>${esc(b.iata || b.icao)}</i>`; }
    if ($('c-route')._h !== route) { $('c-route').innerHTML = route; $('c-route')._h = route; }
    const trend = p.vrate > 350 ? 'climbing' : p.vrate < -350 ? 'descending' : '';
    const bits = [];
    const long = prettyType(info.long || '') || info.type || p.type || ''; if (long) bits.push(esc(long));
    bits.push(p.ground ? 'on the ground' : `${fmtInt(Math.round(p.altFt / 25) * 25)} feet${trend ? ' ' + trend : ''}`);
    if (p.gs > 1) bits.push(`${fmtInt(p.gs * 1.15078)} mph`);
    const h = bits.map((b) => `<b>${b}</b>`).join('');
    if ($('c-data')._h !== h) { $('c-data').innerHTML = h; $('c-data')._h = h; }
    if (__NET__) { const mark = dataBase && S.src === 'blend' && !p.remote ? (p.src === 'ant' ? 'Heard by your antenna' : 'From the flight network') : ''; const n = $('c-src'); if (n._t !== mark) { n._t = mark; n.textContent = mark; n.hidden = !mark; } }
    let prog = '';
    if (shot.kind === 'follow' && capRoute) {
      const ap = capRoute._airports, a = ap[0], b = ap[ap.length - 1];
      const done = gcDist(a.lat, a.lon, p.rLat, p.rLon), left = gcDist(p.rLat, p.rLon, b.lat, b.lon), frac = clamp(done / Math.max(done + left, 1), 0, 1);
      $('c-bar').style.width = (frac * 100).toFixed(1) + '%';
      const mins = p.gs > 60 ? (left / (p.gs * 1.852)) * 60 : null;
      prog = `${fmtInt(left / MI)} miles to go` + (mins ? `, about ${mins >= 90 ? (mins / 60).toFixed(1).replace('.0', '') + ' hours' : fmtInt(Math.max(mins, 1)) + ' minutes'}` : '');
      if (p.remote) prog += '. Beyond your antenna, position from ADSB.lol';
    } else if (shot.kind === 'follow' && p.remote) prog = 'Beyond your antenna, position from ADSB.lol';
    $('c-prog').hidden = !(shot.kind === 'follow' && capRoute); $('c-progtext').textContent = prog; $('c-progtext').hidden = !prog;
  }
  if (show !== capShown) { capShown = show; $('cap').classList.toggle('on', show); }
  // quiet status line
  let msg = '';
  const netOn = __NET__ && S.src !== 'antenna';
  if (__NET__ && !dataBase && netOn) msg = net.ok === false ? 'The flight network is not answering. Trying again.' : '';
  else if (!dataBase) msg = pollFails >= 2 ? (__NET__ ? 'No receiver found here. To watch without one, open the settings and choose the flight network under "Aircraft from".' : 'No receiver found. Open this page from the address of the Raspberry Pi, not from the downloaded file.') : '';
  else if (t - lastGood > 15 && !(netOn && net.ok)) msg = 'The receiver has stopped answering. Trying again.';
  else if (follow.want && follow.state === 'looking' && t - follow.since > 4) msg = follow.netOk ? `Looking for ${follow.want}. It is not in the air within reach yet.` : `Looking for ${follow.want} with your antenna only. The internet lookup did not answer.`;
  else if (shot.kind === 'wide' && t - shot.t0 > shot.dur + shot.hold + 3 && !paused && !candidates().length) msg = planes.size ? `No aircraft within ${S.radius} miles of ${C.short} right now.` : 'No aircraft heard right now.';
  else if (paused && shot.kind === 'visit') msg = 'Holding on this aircraft. Press the space bar to move on.';
  if ($('msg')._t !== msg) { $('msg')._t = msg; if (msg) $('msg').textContent = msg; $('msg').classList.toggle('on', !!msg); }
}

// ---------- settings panel ----------
function buildCenterOptions() {
  const sel = $('f-center'); sel.innerHTML = '';
  const add = (v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o); };
  for (const [v, label] of PRESETS) add(v, label);
  if (home) add('HOME', 'Home');
  add('OTHER', 'Another airport');
  sel.value = S.center; if (sel.value !== S.center) { S.center = 'MID'; sel.value = 'MID'; }
  $('row-other').hidden = S.center !== 'OTHER';
}
function applyCenter() {
  if (__NET__) setTimeout(() => netTick(true), 50);
  C = centerPoint(); reorigin(C.lat, C.lon); for (const p of planes.values()) for (const s of p.trail) s.ep = -1;
  if (shot.kind !== 'follow') { begin('wide', 7); shot.hold = 5; hideCaption(); }
}
function initPanel() {
  buildCenterOptions();
  $('f-other').value = S.other; $('f-radius').value = String(S.radius); $('f-pace').value = String(S.pace); $('f-cap').checked = !!S.captions; $('f-sky').value = S.sky; $('f-wx').value = S.wx; $('f-corner').checked = !!S.corner; $('f-lights').value = S.lights; if (__NET__) $('f-src').value = S.src; $('f-trail').value = String(S.trail); $('f-flight').value = S.follow || '';
  $('f-center').onchange = (e) => { S.center = e.target.value; $('row-other').hidden = S.center !== 'OTHER'; save(); if (S.center !== 'OTHER' || AP[S.other.toUpperCase()] || AP['K' + S.other.toUpperCase()]) applyCenter(); };
  $('f-other').oninput = (e) => { S.other = e.target.value.trim().toUpperCase(); const ok = AP[S.other] || AP['K' + S.other]; $('other-note').textContent = ok ? ok[2] + (ok[3] ? ', ' + ok[3] : '') : (S.other.length >= 3 ? 'No airport found with that code' : ''); if (ok) { save(); applyCenter(); } };
  $('f-radius').onchange = (e) => { S.radius = +e.target.value; save(); ground.setRing(C.lat, C.lon, radiusKm());  };
  $('f-pace').onchange = (e) => { S.pace = +e.target.value; save(); };
  $('f-cap').onchange = (e) => { S.captions = e.target.checked; save(); };
  $('f-sky').onchange = (e) => { S.sky = e.target.value; save(); };
  $('f-wx').onchange = (e) => { S.wx = e.target.value; save(); if (S.wx === 'real') setWeather({}); applyWeather(); updateCorner(simClock || new Date()); };
  $('f-corner').onchange = (e) => { S.corner = e.target.checked; save(); };
  $('f-lights').onchange = (e) => { S.lights = e.target.value; save(); };
  if (__NET__) $('f-src').onchange = (e) => { S.src = e.target.value; save(); netTick(true); updateCorner(simClock || new Date()); };
  $('f-trail').onchange = (e) => { S.trail = +e.target.value; save(); };
  $('f-follow').onsubmit = (e) => { e.preventDefault(); setFollow($('f-flight').value); $('f-flight').blur(); };
  $('f-stop').onclick = () => setFollow('');
  $('gear').onclick = () => togglePanel();
  $('close').onclick = () => togglePanel(false);
  let idle = null;
  const wake = () => { document.body.classList.add('awake'); clearTimeout(idle); idle = setTimeout(() => { if (!document.body.classList.contains('panel')) document.body.classList.remove('awake'); }, 3500); };
  window.addEventListener('pointermove', wake); window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT/.test(e.target.tagName)) { if (e.key === 'Escape') togglePanel(false); return; }
    if (e.key === ' ') { paused = !paused; e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'n') { paused = false; const p = pickNext(); if (p && follow.state !== 'on') startVisit(p); }
    else if (e.key === 'w') { paused = false; if (follow.state !== 'on') goWide(); }
    else if (e.key === 's' || e.key === 'Enter') togglePanel();
    else if (e.key === 'Escape') togglePanel(false);
    else if (e.key === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); }
  });
}
function togglePanel(on) { const b = document.body; const next = on === undefined ? !b.classList.contains('panel') : on; b.classList.toggle('panel', next); if (next) b.classList.add('awake'); }

// ---------- frame loop ----------
let fpsN = 0, fpsT = nowS(), slow = 0;
let renderNext = true, lastT = nowS(), lookT = -100, simClock = Q.has('time') ? new Date(Q.get('time')) : null;
const A3 = new THREE.Vector3();
function frame() {
  const t = nowS(), dt = clamp(t - lastT, 0.001, 0.25); lastT = t;
  updateCamera(t);
  const date = simClock || new Date();
  updateLook(pose.lat, pose.lon, date); updateWeather(t, dt);
  if (t - lookT > 2) { lookT = t; applyWeather(); updateCorner(date); }
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
  updateCaption(t);
  // if the screen cannot keep up, draw at a lower resolution rather than stutter
  fpsN++; if (!MANUAL && t - fpsT > 5) { const fps = fpsN / (t - fpsT); fpsN = 0; fpsT = t; if (fps < 24 && DPR > 0.75 && document.visibilityState === 'visible' && ++slow >= 2) { slow = 0; DPR = Math.max(0.75, DPR - 0.25); renderer.setPixelRatio(DPR); resize(); } else if (fps >= 24) slow = 0; }
  if (!MANUAL || renderNext) {
    renderer.render(scene, camera);
    if (weather.active) { renderer.autoClear = false; renderer.render(weather.scene, weather.camera); renderer.autoClear = true; }
  }
  if (!MANUAL) requestAnimationFrame(frame);
}

// ---------- start ----------
resize(); reorigin(C.lat, C.lon); applyWeather(); updateLook(C.lat, C.lon, simClock || new Date()); initPanel();
if (S.follow) setFollow(S.follow);
if (!MANUAL) { poll(); setInterval(followTick, 1000); if (__NET__) { netTick(true); setInterval(netTick, 1000); } }
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setTimeout(() => location.reload(), 1500); });
try { if (navigator.wakeLock) { const lock = () => navigator.wakeLock.request('screen').catch(() => {}); lock(); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lock(); }); } } catch (e) { /* not supported */ }
window.__sky = { wxNow, wxInfo, weather, sky, sunNow, planes, pose, renderer, PlaneMesh, paintFor, ingest, get shot() { return shot; }, reorigin, project, S, follow, ground, scene, camera, proj, look, trails, startVisit, goWide, setFollow, followTick, setTime: (d) => { simClock = d ? new Date(d) : null; lookT = -100; },
  step: (dt, render) => { vt += dt; renderNext = !!render; frame(); },
  feed: async (T) => { fakeT = T; if (Q.get('noant') !== '1') { const d = await getJSON((dataBase || DATA_BASES[0]) + 'aircraft.json?t=' + T); if (!dataBase) { dataBase = DATA_BASES[0]; ingest(d.aircraft, d.now); lastGood = nowS(); await afterFirstData(); } else { ingest(d.aircraft, d.now); lastGood = nowS(); } } if (__NET__) await netTick(); },
  net, NET: __NET__ };
if (!MANUAL) requestAnimationFrame(frame);
