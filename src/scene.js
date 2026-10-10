// Everything drawn in 3D: projection, ground, sky, lines, aircraft shapes.
import * as THREE from 'three';
import { R_EARTH, D2R, gcDist, clamp } from './util.js';

export const VEX = 2.5;   // altitude is drawn this many times taller than life so layers of traffic read clearly

// ---------- projection: latitude and longitude to a flat local frame around an origin ----------
export const proj = { lat0: 40.7, lon0: -73.83, s0: 0, c0: 1, epoch: 0 };
export function setOrigin(lat, lon) {
  proj.lat0 = lat; proj.lon0 = lon; proj.s0 = Math.sin(lat * D2R); proj.c0 = Math.cos(lat * D2R); proj.epoch++;
}
// x east, y up, z south. Far ground drops away with the curve of the Earth.
export function project(lat, lon, altKm, out) {
  const p = lat * D2R, dl = (lon - proj.lon0) * D2R, sp = Math.sin(p), cp = Math.cos(p), cdl = Math.cos(dl);
  const cc = clamp(proj.s0 * sp + proj.c0 * cp * cdl, -1, 1), c = Math.acos(cc);
  const k = c < 1e-9 ? 1 : c / Math.sin(c);
  const d = R_EARTH * c;
  const x = R_EARTH * k * cp * Math.sin(dl), z = -R_EARTH * k * (proj.c0 * sp - proj.s0 * cp * cdl), y = -(d * d) / (2 * R_EARTH);
  if (altKm) {   // height goes along the local vertical, which leans outward away from the origin
    const nx = x / R_EARTH, nz = z / R_EARTH, inv = (altKm * VEX) / Math.sqrt(nx * nx + 1 + nz * nz);
    out.x = x + nx * inv; out.y = y + inv; out.z = z + nz * inv;
  } else { out.x = x; out.y = y; out.z = z; }
  return out;
}
// local east, north and up directions at a point, in scene coordinates
const LF = { x: 0, y: 0, z: 0 };
export function localFrame(lat, lon, altKm, P, E, N, U) {
  project(lat + 0.02, lon, altKm, LF);
  N.set(LF.x - P.x, LF.y - P.y, LF.z - P.z).normalize();
  U.set(P.x / R_EARTH, 1, P.z / R_EARTH).normalize();
  E.crossVectors(N, U).normalize(); U.crossVectors(E, N).normalize();
}

// ---------- screen-space lines with a soft edge and a fade along their length ----------
const SEG_VS = `
attribute vec3 iStart; attribute vec3 iEnd; attribute vec2 iAlpha;
uniform vec2 resolution; uniform float width;
varying float vAlpha; varying float vSide; varying float vDepth;
void main() {
  vec4 s = modelViewMatrix * vec4(iStart, 1.0);
  vec4 e = modelViewMatrix * vec4(iEnd, 1.0);
  float near = -0.02;
  if (s.z > near && e.z > near) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (s.z > near) s = e + (s - e) * ((near - e.z) / (s.z - e.z));
  if (e.z > near) e = s + (e - s) * ((near - s.z) / (e.z - s.z));
  vec4 cs = projectionMatrix * s; vec4 ce = projectionMatrix * e;
  vec2 ns = cs.xy / cs.w; vec2 ne = ce.xy / ce.w;
  vec2 dir = (ne - ns) * resolution; float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 c = mix(cs, ce, position.x);
  vec2 off = nrm * position.y * (width * 0.5 + 1.0);
  c.xy += off / resolution * 2.0 * c.w;
  gl_Position = c;
  vAlpha = mix(iAlpha.x, iAlpha.y, position.x);
  vSide = position.y * (width * 0.5 + 1.0);
  vDepth = -mix(s.z, e.z, position.x);
}`;
const SEG_FS = `
uniform vec3 color; uniform float opacity; uniform float width; uniform float fogDensity;
varying float vAlpha; varying float vSide; varying float vDepth;
void main() {
  float edge = 1.0 - smoothstep(width * 0.5 - 0.6, width * 0.5 + 0.6, abs(vSide));
  float f = exp(-fogDensity * fogDensity * vDepth * vDepth);
  float a = opacity * vAlpha * edge * f;
  if (a < 0.003) discard;
  gl_FragColor = vec4(color, a);
}`;

export class Segments {
  constructor(capacity, { width = 1.5, color = 0xffffff, opacity = 1, depthTest = false, renderOrder = 4, additive = false } = {}) {
    this.cap = capacity; this.count = 0;
    this.start = new Float32Array(capacity * 3); this.end = new Float32Array(capacity * 3); this.alpha = new Float32Array(capacity * 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aS = new THREE.InstancedBufferAttribute(this.start, 3); this.aE = new THREE.InstancedBufferAttribute(this.end, 3); this.aA = new THREE.InstancedBufferAttribute(this.alpha, 2);
    for (const a of [this.aS, this.aE, this.aA]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iStart', this.aS); g.setAttribute('iEnd', this.aE); g.setAttribute('iAlpha', this.aA);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SEG_VS, fragmentShader: SEG_FS, transparent: true, depthTest, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { resolution: { value: new THREE.Vector2(1, 1) }, width: { value: width }, color: { value: new THREE.Color(color) }, opacity: { value: opacity }, fogDensity: { value: 0.002 } },
    });
    this.cssWidth = width;
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder;
  }
  reset() { this.count = 0; }
  add(ax, ay, az, bx, by, bz, a0 = 1, a1 = 1) {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.start[i * 3] = ax; this.start[i * 3 + 1] = ay; this.start[i * 3 + 2] = az;
    this.end[i * 3] = bx; this.end[i * 3 + 1] = by; this.end[i * 3 + 2] = bz;
    this.alpha[i * 2] = a0; this.alpha[i * 2 + 1] = a1;
  }
  commit() {
    this.mesh.geometry.instanceCount = this.count;
    for (const a of [this.aS, this.aE, this.aA]) { a.needsUpdate = true; }
  }
  resize(w, h, dpr) { this.mat.uniforms.resolution.value.set(w * dpr, h * dpr); this.mat.uniforms.width.value = this.cssWidth * dpr; }
}

// ---------- ground: water, land, lakes, shorelines, state lines, runways ----------
function decode(r, q) {
  const n = r.length >> 1, out = new Float64Array(n * 2); let x = 0, y = 0;
  for (let i = 0; i < n; i++) { x += r[i * 2]; y += r[i * 2 + 1]; out[i * 2] = x / q; out[i * 2 + 1] = y / q; }
  return out;
}
function ringToPts(ll) {
  let n = ll.length >> 1;
  if (n > 1 && ll[0] === ll[n * 2 - 2] && ll[1] === ll[n * 2 - 1]) n--;
  const pts = []; for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(ll[i * 2], ll[i * 2 + 1]));
  return pts;
}
function prepTile(t, q) {
  if (t._ready) return; t._ready = true;
  t.land = []; t.lake = [];
  const tri = (rings, into) => {
    const contour = ringToPts(decode(rings[0], q)); if (contour.length < 3) return;
    const holes = rings.slice(1).map((h) => ringToPts(decode(h, q))).filter((h) => h.length >= 3);
    let faces; try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { return; }
    const all = contour.concat(...holes), ll = new Float64Array(all.length * 2);
    all.forEach((p, i) => { ll[i * 2] = p.x; ll[i * 2 + 1] = p.y; });
    const idx = new Uint32Array(faces.length * 3); faces.forEach((f, i) => { idx[i * 3] = f[0]; idx[i * 3 + 1] = f[1]; idx[i * 3 + 2] = f[2]; });
    into.push({ ll, idx });
  };
  (t.p || []).forEach((rings) => tri(rings, t.land));
  (t.k || []).forEach((ring) => tri([ring], t.lake));
  t.coast = (t.l || []).map((r) => decode(r, q));
  t.border = (t.b || []).map((r) => decode(r, q));
  t.p = t.k = t.l = t.b = null;
}

export class Ground {
  constructor(scene, geo, airports) {
    this.geo = geo; this.airports = airports;
    this.group = new THREE.Group(); scene.add(this.group);
    // water: a wide cap that follows the curve of the Earth
    const rings = [0, 20, 60, 120, 200, 320, 480, 650, 860], seg = 96, pos = [], idx = [];
    pos.push(0, 0, 0);
    for (let r = 1; r < rings.length; r++) for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2, d = rings[r]; pos.push(Math.sin(a) * d, -(d * d) / (2 * R_EARTH) - 0.01, Math.cos(a) * d);
    }
    for (let s = 0; s < seg; s++) idx.push(0, 1 + s, 1 + ((s + 1) % seg));
    for (let r = 1; r < rings.length - 1; r++) for (let s = 0; s < seg; s++) {
      const a = 1 + (r - 1) * seg + s, b = 1 + (r - 1) * seg + ((s + 1) % seg), c = a + seg, d = b + seg; idx.push(a, c, b, b, c, d);
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wg.setIndex(idx);
    const flat = (color, order) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, fog: true, side: THREE.DoubleSide });
    this.waterMat = flat(0x3d77a6); this.landMat = flat(0x7f9a78); this.lakeMat = this.waterMat;
    this.water = new THREE.Mesh(wg, this.waterMat); this.water.renderOrder = 0; this.water.frustumCulled = false; this.group.add(this.water);
    this.land = new THREE.Mesh(new THREE.BufferGeometry(), this.landMat); this.land.renderOrder = 1; this.land.frustumCulled = false; this.group.add(this.land);
    this.lakes = new THREE.Mesh(new THREE.BufferGeometry(), this.lakeMat); this.lakes.renderOrder = 2; this.lakes.frustumCulled = false; this.group.add(this.lakes);
    this.borders = new Segments(30000, { width: 1.0, color: 0xffffff, opacity: 0.12, renderOrder: 3 });
    this.coast = new Segments(140000, { width: 1.25, color: 0xeef5ea, opacity: 0.8, renderOrder: 4 });
    this.runways = new Segments(8000, { width: 2.2, color: 0xfff1d6, opacity: 0.95, renderOrder: 5 });
    this.ring = new Segments(400, { width: 1.2, color: 0xffffff, opacity: 0.16, renderOrder: 5 });
    for (const s of [this.borders, this.coast, this.runways, this.ring]) this.group.add(s.mesh);
    this.lines = [this.borders, this.coast, this.runways, this.ring];
    this.v = new THREE.Vector3();
  }
  rebuild() {
    const { lat0, lon0 } = proj, v = this.v;
    const landPos = [], landIdx = [], lakePos = [], lakeIdx = [];
    this.coast.reset(); this.borders.reset(); this.runways.reset();
    const LIMIT2 = 850 * 850, far = (pos, i) => pos[i * 3] * pos[i * 3] + pos[i * 3 + 2] * pos[i * 3 + 2] > LIMIT2;
    const addPolys = (list, pos, idx) => {
      for (const pg of list) {
        const base = pos.length / 3, n = pg.ll.length >> 1;
        for (let i = 0; i < n; i++) { project(pg.ll[i * 2 + 1], pg.ll[i * 2], 0, v); pos.push(v.x, v.y, v.z); }
        // leave out anything past the horizon haze, which would otherwise be painted over the foreground
        for (let i = 0; i < pg.idx.length; i += 3) {
          const a = base + pg.idx[i], b = base + pg.idx[i + 1], c = base + pg.idx[i + 2];
          if (far(pos, a) || far(pos, b) || far(pos, c)) continue;
          idx.push(a, b, c);
        }
      }
    };
    const addLines = (list, seg) => {
      for (const ll of list) {
        const n = ll.length >> 1; let px = 0, py = 0, pz = 0;
        for (let i = 0; i < n; i++) {
          project(ll[i * 2 + 1], ll[i * 2], 0, v);
          if (i > 0 && v.x * v.x + v.z * v.z < LIMIT2) seg.add(px, py, pz, v.x, v.y, v.z, 1, 1);
          px = v.x; py = v.y; pz = v.z;
        }
      }
    };
    const levels = [['top', 600, 0.45], ['hi', 850, 0.9], ['mid', 850, 4.5], ['lo', 850, 13]];
    for (const [name, range, half] of levels) {
      const lvl = this.geo[name]; if (!lvl) continue;
      for (const t of lvl.t) {
        const d = gcDist(lat0, lon0, t.c[1], t.c[0]);
        if (d > range + half * 111 * 1.5) continue;
        prepTile(t, lvl.q);
        addPolys(t.land, landPos, landIdx); addPolys(t.lake, lakePos, lakeIdx);
        addLines(t.coast, this.coast); addLines(t.border, this.borders);
      }
    }
    const setGeo = (mesh, pos, idx) => {
      mesh.geometry.dispose(); const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); mesh.geometry = g;
    };
    setGeo(this.land, landPos, landIdx); setGeo(this.lakes, lakePos, lakeIdx);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const ap of this.airports) {
      if (gcDist(lat0, lon0, ap[4], ap[5]) > 600) continue;
      for (const r of ap[8]) { project(r[0], r[1], 0.02, a); project(r[2], r[3], 0.02, b); this.runways.add(a.x, a.y, a.z, b.x, b.y, b.z, 1, 1); }
    }
    this.coast.commit(); this.borders.commit(); this.runways.commit();
  }
  setRing(lat, lon, radiusKm) {
    this.ring.reset();
    if (radiusKm > 0) {
      const a = new THREE.Vector3(), b = new THREE.Vector3(), n = 180, dr = radiusKm / R_EARTH, p1 = lat * D2R;
      const pt = (i, out) => {
        const br = (i / n) * Math.PI * 2, p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(br));
        const l2 = lon * D2R + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
        return project(p2 / D2R, l2 / D2R, 0.02, out);
      };
      for (let i = 0; i < n; i++) { if (i % 2) continue; pt(i, a); pt(i + 1, b); this.ring.add(a.x, a.y, a.z, b.x, b.y, b.z, 1, 1); }
    }
    this.ring.commit();
  }
}

// ---------- sky dome with sun glow and stars ----------
export class Sky {
  constructor(scene) {
    this.uniforms = {
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, haze: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(1, 0.9, 0.75) }, glow: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false, uniforms: this.uniforms,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 haze; uniform vec3 sunDir; uniform vec3 sunColor; uniform float glow; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          float t = pow(smoothstep(-0.06, 0.9, h), 0.6);
          vec3 col = mix(horizon, zenith, t);
          col = mix(haze, col, smoothstep(-0.16, 0.0, h));
          float sd = max(dot(d, sunDir), 0.0);
          float low = smoothstep(-0.25, 0.1, h);
          col += sunColor * (pow(sd, 900.0) * 1.2 + pow(sd, 48.0) * 0.35 + pow(sd, 6.0) * 0.22) * glow * low;
          gl_FragColor = vec4(col, 1.0); }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), mat); this.dome.renderOrder = -10; this.dome.frustumCulled = false; scene.add(this.dome);
    const n = 1400, pos = new Float32Array(n * 3), sz = new Float32Array(n), ph = new Float32Array(n);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < n; i++) {
      const y = rnd() * 0.98 + 0.02, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 4800; pos[i * 3 + 1] = y * 4800; pos[i * 3 + 2] = Math.sin(a) * r * 4800;
      sz[i] = 0.7 + Math.pow(rnd(), 6) * 2.4; ph[i] = rnd() * 6.283;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('size', new THREE.BufferAttribute(sz, 1)); sg.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
    this.starU = { opacity: { value: 0 }, time: { value: 0 }, dpr: { value: 1 } };
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.starU,
      vertexShader: 'attribute float size; attribute float phase; uniform float time; uniform float dpr; varying float vA; void main(){ vA = (0.72 + 0.28 * sin(time * 0.9 + phase)) * smoothstep(0.0, 0.1, normalize(position).y); gl_PointSize = size * dpr * 1.6; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float opacity; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.2, 1.0, d)) * vA * opacity; gl_FragColor = vec4(0.86, 0.91, 1.0, a); }',
    }));
    this.stars.renderOrder = -9; this.stars.frustumCulled = false; scene.add(this.stars);
  }
  follow(camPos, q) { this.dome.position.copy(camPos); this.stars.position.copy(camPos); this.dome.quaternion.copy(q); this.stars.quaternion.copy(q); }
}

// ---------- aircraft shapes ----------
function pushGeo(arr, geo, m) {
  const g = geo.index ? geo.toNonIndexed() : geo; if (m) g.applyMatrix4(m);
  const p = g.attributes.position.array; for (let i = 0; i < p.length; i++) arr.push(p[i]);
}
// a thin slab between four corner points, given thickness along t
function slab(arr, A, B, C, D, t) {
  const h = new THREE.Vector3(...t).multiplyScalar(0.5);
  const P = [A, B, C, D].map((p) => new THREE.Vector3(...p));
  const top = P.map((p) => p.clone().add(h)), bot = P.map((p) => p.clone().sub(h));
  const quad = (a, b, c, d) => { for (const v of [a, b, c, a, c, d]) arr.push(v.x, v.y, v.z); };
  quad(top[0], top[1], top[2], top[3]); quad(bot[3], bot[2], bot[1], bot[0]);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(top[j], top[i], bot[i], bot[j]); }
}
function body(arr, profile, seg = 14) {
  const pts = profile.map(([z, r]) => new THREE.Vector2(r, z));
  const g = new THREE.LatheGeometry(pts, seg); g.rotateX(Math.PI / 2);
  pushGeo(arr, g);
}
function finish(bodyArr, accentArr) {
  const g = new THREE.BufferGeometry(), all = new Float32Array(bodyArr.length + accentArr.length);
  all.set(bodyArr, 0); all.set(accentArr, bodyArr.length);
  g.setAttribute('position', new THREE.BufferAttribute(all, 3));
  g.addGroup(0, bodyArr.length / 3, 0); g.addGroup(bodyArr.length / 3, accentArr.length / 3, 1);
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
const mirror = (p) => [-p[0], p[1], p[2]];
function jet(engines = 2) {
  const b = [], a = [];
  body(b, [[-0.5, 0.004], [-0.47, 0.016], [-0.36, 0.036], [-0.22, 0.05], [0.33, 0.05], [0.41, 0.044], [0.46, 0.031], [0.49, 0.014], [0.5, 0.0]]);
  const wing = [[0.045, -0.03, 0.12], [0.045, -0.03, -0.07], [0.5, 0.015, -0.2], [0.5, 0.015, -0.145]];
  slab(b, ...wing, [0, 0.012, 0]); slab(b, ...wing.map(mirror).reverse(), [0, 0.012, 0]);
  const stab = [[0.02, 0.012, -0.37], [0.02, 0.012, -0.46], [0.19, 0.022, -0.5], [0.19, 0.022, -0.455]];
  slab(b, ...stab, [0, 0.008, 0]); slab(b, ...stab.map(mirror).reverse(), [0, 0.008, 0]);
  slab(a, [0, 0.04, -0.33], [0, 0.04, -0.475], [0, 0.2, -0.52], [0, 0.2, -0.455], [0.012, 0, 0]);
  const eng = (x, z) => { const g = new THREE.CylinderGeometry(0.026, 0.022, 0.1, 10); g.rotateX(Math.PI / 2); g.translate(x, -0.058, z); pushGeo(a, g); };
  eng(0.17, 0.05); eng(-0.17, 0.05);
  if (engines === 4) { eng(0.31, -0.03); eng(-0.31, -0.03); }
  return finish(b, a);
}
function light() {
  const b = [], a = [];
  body(b, [[-0.5, 0.006], [-0.3, 0.022], [-0.05, 0.05], [0.2, 0.058], [0.36, 0.05], [0.46, 0.032], [0.5, 0.0]], 10);
  const wing = [[0.0, 0.06, 0.2], [0.0, 0.06, 0.04], [0.62, 0.075, 0.06], [0.62, 0.075, 0.17]];
  slab(b, ...wing, [0, 0.014, 0]); slab(b, ...wing.map(mirror).reverse(), [0, 0.014, 0]);
  const stab = [[0.0, 0.01, -0.38], [0.0, 0.01, -0.48], [0.22, 0.01, -0.48], [0.22, 0.01, -0.41]];
  slab(b, ...stab, [0, 0.01, 0]); slab(b, ...stab.map(mirror).reverse(), [0, 0.01, 0]);
  slab(a, [0, 0.02, -0.34], [0, 0.02, -0.5], [0, 0.2, -0.52], [0, 0.2, -0.44], [0.012, 0, 0]);
  return finish(b, a);
}
function heli() {
  const b = [], a = [];
  body(b, [[-0.12, 0.02], [-0.02, 0.085], [0.14, 0.1], [0.3, 0.085], [0.4, 0.04], [0.42, 0.0]], 12);
  body(b, [[-0.5, 0.008], [-0.1, 0.025]], 8);
  slab(a, [0, 0.0, -0.44], [0, 0.0, -0.5], [0, 0.14, -0.52], [0, 0.14, -0.47], [0.012, 0, 0]);
  const g = new THREE.CylinderGeometry(0.5, 0.5, 0.004, 28); g.translate(0, 0.13, 0.12); pushGeo(a, g);
  return finish(b, a);
}
let dot = null;
function dotTexture() {
  if (dot) return dot;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.85)'); g.addColorStop(0.45, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  dot = new THREE.CanvasTexture(c); return dot;
}
const GEOS = {};
export const MODELS = {
  jet: { make: () => jet(2), len: 1.0, tips: 0.5, tipY: 0.015, tipZ: -0.17, tail: -0.5 },
  heavy: { make: () => jet(4), len: 1.45, tips: 0.5, tipY: 0.015, tipZ: -0.17, tail: -0.5 },
  light: { make: light, len: 0.5, tips: 0.62, tipY: 0.075, tipZ: 0.11, tail: -0.5 },
  heli: { make: heli, len: 0.5, tips: 0.1, tipY: 0.0, tipZ: 0.1, tail: -0.5 },
};
export function modelFor(category, type) {
  const t = (type || '').toUpperCase();
  if (category === 'A7' || /^(H\d|EC\d|AS\d|B06|B407|B429|R22|R44|R66|S76|S92|A109|A139|A169|UH|H60)/.test(t)) return 'heli';
  if (/^(B74|A38|A34|IL96|A124|C5M|C17|B52|K35)/.test(t)) return 'heavy';
  if (category === 'A5' || /^(B77|B78|A33|A35|B76|MD11|DC10|A30|A31)/.test(t)) return 'heavy2';
  if (category === 'A1' || /^(C1[5-9]\d|C2\d\d|P28|PA\d|SR2|DA4|BE3[3-6]|BE5|M20|C82|C72)/.test(t)) return 'light';
  return 'jet';
}
export class PlaneMesh {
  constructor(kind, accent) {
    const twin = kind === 'heavy2'; const key = twin ? 'jet' : kind; const m = MODELS[key];
    this.model = m; this.len = twin ? 1.3 : m.len;
    if (!GEOS[key]) GEOS[key] = m.make();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xf7f8f8, roughness: 0.55, metalness: 0.05, flatShading: true, transparent: true, fog: true });
    this.accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6, metalness: 0.05, flatShading: true, transparent: true, fog: true });
    this.mesh = new THREE.Mesh(GEOS[key], [this.bodyMat, this.accentMat]); this.mesh.renderOrder = 10;
    this.group = new THREE.Group(); this.group.add(this.mesh); this.group.rotation.order = 'YXZ';
    const sp = (color, x, y, z, s) => {
      const mat = new THREE.SpriteMaterial({ map: dotTexture(), color, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false });
      const o = new THREE.Sprite(mat); o.position.set(x, y, z); o.scale.setScalar(s); o.renderOrder = 12; o.userData.s = s; this.group.add(o); return o;
    };
    this.red = sp(0xff3b30, m.tips, m.tipY, m.tipZ, 0.11); this.green = sp(0x30ff6a, -m.tips, m.tipY, m.tipZ, 0.11);
    this.white = sp(0xffffff, 0, 0.03, m.tail, 0.1);
    this.strobeL = sp(0xffffff, m.tips, m.tipY, m.tipZ, 0.34); this.strobeR = sp(0xffffff, -m.tips, m.tipY, m.tipZ, 0.34);
    this.beacon = sp(0xff4030, 0, 0.075, 0.0, 0.2);
    this.phase = Math.random() * 10;
  }
  // night: 0 day to 1 night. opacity: fade in and out. far: 0 near to 1 far (lights swell with distance so far aircraft stay visible as points)
  update(time, opacity, night, bodyColor, far) {
    this.bodyMat.opacity = opacity; this.accentMat.opacity = opacity; this.bodyMat.color.copy(bodyColor);
    this.accentMat.emissive.copy(this.accentMat.color).multiplyScalar(0.12 * night);
    const base = (0.12 + 0.88 * night) * opacity, swell = (0.55 + 0.45 * night) * (1 + far * 1.6 * night);
    const t = (time + this.phase) % 1.6, flash = (t < 0.06 || (t > 0.18 && t < 0.24)) ? 1 : 0, bt = (time * 0.8 + this.phase) % 1.3, bflash = bt < 0.12 ? 1 : 0;
    this.red.material.opacity = base; this.green.material.opacity = base; this.white.material.opacity = base * 0.9;
    for (const s of [this.red, this.green, this.white]) s.scale.setScalar(s.userData.s * swell);
    this.strobeL.material.opacity = this.strobeR.material.opacity = flash * (0.07 + 0.93 * night) * opacity;
    this.strobeL.scale.setScalar(0.34 * swell); this.strobeR.scale.setScalar(0.34 * swell);
    this.beacon.material.opacity = bflash * (0.06 + 0.94 * night) * opacity;
    this.mesh.visible = opacity > 0.01; this.group.visible = opacity > 0.01;
  }
  dispose() { this.bodyMat.dispose(); this.accentMat.dispose(); for (const s of [this.red, this.green, this.white, this.strobeL, this.strobeR, this.beacon]) s.material.dispose(); }
}

// ---------- small text labels that stay the same size on screen ----------
export function makeLabel(text) {
  const c = document.createElement('canvas'), x = c.getContext('2d'), px = 44;
  const font = `500 ${px}px "Avenir Next", Avenir, "Helvetica Neue", "Segoe UI", Roboto, sans-serif`;
  x.font = font; const w = Math.ceil(x.measureText(text).width + 24); c.width = w; c.height = px + 20;
  x.font = font; x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 8; x.fillText(text, 12, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false, opacity: 0.6 });
  const s = new THREE.Sprite(mat); s.center.set(0.5, -0.4); s.renderOrder = 6; s.userData.aspect = c.width / c.height;
  return s;
}
