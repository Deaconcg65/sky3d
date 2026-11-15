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
    this.marks = new Segments(2400, { width: 1.8, color: 0xffd08a, opacity: 0.95, renderOrder: 5 }); this.group.add(this.marks.mesh);   // the viewer's own places
    this.lines = [this.borders, this.coast, this.runways, this.ring, this.marks];
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
  // a small ring on the ground and a thin pin standing on it, for each of the viewer's own places
  setMarks(places) {
    this.marks.reset();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), n = 36, dr = 0.9 / R_EARTH;
    for (const pl of places || []) {
      if (gcDist(proj.lat0, proj.lon0, pl.lat, pl.lon) > 600) continue;
      const p1 = pl.lat * D2R, pt = (i, out) => {
        const br = (i / n) * Math.PI * 2, p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(br));
        const l2 = pl.lon * D2R + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
        return project(p2 / D2R, l2 / D2R, 0.02, out);
      };
      for (let i = 0; i < n; i++) { pt(i, a); pt(i + 1, b); this.marks.add(a.x, a.y, a.z, b.x, b.y, b.z, 1, 1); }
      project(pl.lat, pl.lon, 0.02, a); project(pl.lat, pl.lon, 0.7, b); this.marks.add(a.x, a.y, a.z, b.x, b.y, b.z, 1, 0.5);
    }
    this.marks.commit();
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

// ---------- satellite ground (version 3.8, off unless the viewer switches it on) ----------
// Photo tiles laid over the drawn ground around the spot on screen: a fine level near the middle and a coarse one around it.
// The viewer's own browser fetches them straight from the photo service; nothing goes through the receiver. While a tile is
// loading, or if the service does not answer, the drawn ground underneath shows, so the page never goes blank.
const tileLon = (x, z) => (x / 2 ** z) * 360 - 180;
const tileLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) / D2R;
const lonTile = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latTile = (lat, z) => { const r = clamp(lat, -85, 85) * D2R; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };
export class SatGround {
  constructor(scene, url, renderer) {
    this.url = url; this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    this.cache = new Map(); this.want = new Set(); this.queue = []; this.busy = 0; this.MAX = 140; this.on = false;
    this.asked = 0; this.loaded = 0; this.failed = 0; this.down = false; this.downUntil = 0; this.retryAt = 0; this.key = '';
    this.tint = new THREE.Color(1, 1, 1); this.aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    this.loader = new THREE.TextureLoader(); this.loader.setCrossOrigin('anonymous');
    this.v = new THREE.Vector3();
  }
  setOn(on) {
    this.on = !!on; this.group.visible = this.on; this.queue.length = 0; this.key = '';
    if (this.on) { this.retryAt = 0; for (const t of this.cache.values()) t.bad = false; }   // switched on again: every missing photo gets another try
  }
  setTint(c) { this.tint.copy(c); for (const t of this.cache.values()) if (t.mesh) t.mesh.material.color.copy(c); }
  shown() { let n = 0; for (const t of this.cache.values()) if (t.mesh && t.mesh.visible) n++; return n; }
  // lat, lon: the spot the camera looks at; spanKm: about how much ground is in view around it; now: seconds
  update(lat, lon, spanKm, now) {
    if (!this.on) return;
    // a photo that failed is asked for again a minute later, if it is still wanted, so a short outage does not leave holes for good
    const clock = performance.now() / 1000;
    if (this.retryAt && clock > this.retryAt) {
      this.retryAt = 0; this.key = '';
      for (const t of this.cache.values()) if (t.bad) { if (t.retry <= clock) t.bad = false; else this.retryAt = this.retryAt ? Math.min(this.retryAt, t.retry) : t.retry; }
    }
    if (this.down && performance.now() / 1000 > this.downUntil) { this.down = false; this.failed = 0; this.key = ''; for (const [k, t] of this.cache) if (t.bad) this.cache.delete(k); }   // try again, even if the view has not moved
    const wide = Math.max(Math.cos(lat * D2R), 0.2) * 40075;
    const zf = clamp(Math.floor(Math.log2(wide / (spanKm / 6))), 4, 13), zc = Math.max(zf - 2, 2);
    // each level: its zoom, the tile under the spot, how many tiles out from it, and its draw order (fine over coarse)
    const levels = [[zf, spanKm, 2.6], [zc, spanKm * 3, 2.5]].map(([z, span, order]) => ({ z, order, cx: lonTile(lon, z), cy: latTile(lat, z), r: Math.ceil(span / 2 / (wide / 2 ** z)) }));
    const key = levels.map((L) => L.z + ':' + Math.floor(L.cx * 4) + ':' + Math.floor(L.cy * 4) + ':' + L.r).join('/') + ':' + proj.epoch;
    if (key === this.key) return; this.key = key;
    const want = new Set(); this.want = want; this.queue.length = 0;
    for (const { z, order, cx, cy, r } of levels) {
      const n = 2 ** z;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = (((Math.floor(cx) + dx) % n) + n) % n, y = Math.floor(cy) + dy; if (y < 0 || y >= n) continue;
        const k = z + '/' + x + '/' + y; want.add(k);
        let t = this.cache.get(k);
        if (!t) { t = { z, x, y, k, order, mesh: null, bad: false, loading: false, ep: -1, used: now }; this.cache.set(k, t); }
        t.order = order; if (t.mesh) t.mesh.renderOrder = order;   // a tile can be the fine level one moment and the coarse one the next
        t.used = now; t.d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + (z === zc ? -0.5 : 0);   // the coarse level comes first, so the whole view fills in quickly
        if (t.mesh) { if (t.ep !== proj.epoch) this.place(t); }
        else if (!t.bad && !t.loading && !this.down) this.queue.push(t);
      }
    }
    for (const t of this.cache.values()) if (t.mesh) t.mesh.visible = want.has(t.k);
    this.queue.sort((a, b) => a.d - b.d);
    // keep the most recently wanted tiles and let go of the rest
    if (this.cache.size > this.MAX) {
      const old = [...this.cache.values()].filter((t) => !want.has(t.k) && !t.loading).sort((a, b) => a.used - b.used);
      for (const t of old.slice(0, this.cache.size - this.MAX)) this.drop(t);
    }
    this.pump();
  }
  pump() {
    while (this.busy < 6 && this.queue.length && this.on && !this.down) {
      const t = this.queue.shift(); if (t.mesh || t.loading || t.bad) continue;
      t.loading = true; this.busy++; this.asked++;
      const src = this.url.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
      this.loader.load(src, (tex) => {
        t.loading = false; this.busy--; this.loaded++;
        if (!this.cache.has(t.k)) { tex.dispose(); this.pump(); return; }
        tex.anisotropy = this.aniso; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        const mat = new THREE.MeshBasicMaterial({ map: tex, color: this.tint, depthTest: false, depthWrite: false, fog: true, side: THREE.DoubleSide });
        t.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); t.mesh.renderOrder = t.order; t.mesh.frustumCulled = false;
        this.place(t); this.group.add(t.mesh); t.mesh.visible = this.want.has(t.k); this.pump();
      }, undefined, () => {
        t.loading = false; t.bad = true; this.busy--; this.failed++;
        t.retry = performance.now() / 1000 + 60; if (!this.retryAt || t.retry < this.retryAt) this.retryAt = t.retry;
        // a service that answers nothing at all is left alone for five minutes, and the drawn ground stays
        if (this.failed >= 12 && this.loaded === 0) { this.down = true; this.downUntil = performance.now() / 1000 + 300; this.queue.length = 0; }
        this.pump();
      });
    }
  }
  place(t) {
    const N = 8, pos = [], uv = [], idx = [], v = this.v;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      project(tileLat(t.y + j / N, t.z), tileLon(t.x + i / N, t.z), 0, v); pos.push(v.x, v.y, v.z); uv.push(i / N, 1 - j / N);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    t.mesh.geometry.dispose(); t.mesh.geometry = g; t.ep = proj.epoch;
  }
  drop(t) { if (t.mesh) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.map.dispose(); t.mesh.material.dispose(); } this.cache.delete(t.k); }
}

// ---------- sky dome with sun glow and stars ----------
export class Sky {
  constructor(scene) {
    this.uniforms = {
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, haze: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(1, 0.9, 0.75) }, glow: { value: 0 },
      cover: { value: 0 }, cloudLit: { value: new THREE.Color(1, 1, 1) }, cloudShade: { value: new THREE.Color(0.7, 0.72, 0.76) }, drift: { value: new THREE.Vector2() }, flash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false, uniforms: this.uniforms,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 haze; uniform vec3 sunDir; uniform vec3 sunColor; uniform float glow;
        uniform float cover; uniform vec3 cloudLit; uniform vec3 cloudShade; uniform vec2 drift; uniform float flash; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; } return s; }
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          float t = pow(smoothstep(-0.06, 0.9, h), 0.6);
          vec3 col = mix(horizon, zenith, t);
          col = mix(haze, col, smoothstep(-0.16, 0.0, h));
          float sd = max(dot(d, sunDir), 0.0);
          float low = smoothstep(-0.25, 0.1, h);
          float c = 0.0;
          if (cover > 0.01 && h > 0.0) {   // a drifting layer of cloud, thinning toward the horizon
            vec2 uv = d.xz / (h + 0.14) * 0.9 - drift;
            float n = fbm(uv), thr = mix(0.74, 0.2, cover);
            c = smoothstep(thr, thr + 0.24, n) * smoothstep(0.0, 0.1, h);
            vec3 cc = mix(cloudShade, cloudLit, smoothstep(thr, thr + 0.5, n) * 0.6 + 0.4 * pow(sd, 3.0));
            col = mix(col, cc, c * 0.94);
          }
          col += sunColor * (pow(sd, 900.0) * 1.2 + pow(sd, 48.0) * 0.35 + pow(sd, 6.0) * 0.22) * glow * low * (1.0 - c * 0.85);
          col += vec3(0.55, 0.6, 0.72) * flash * (0.45 + 0.55 * c) * smoothstep(-0.2, 0.3, h);
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

// ---------- rain, snow and wind, drawn flat over the picture ----------
// Each kind is one cloud of small marks that is moved entirely on the graphics card. The page only tells it how far the
// marks have travelled so far (off) and which way they are heading (dir), so a change in wind bends the fall smoothly.
const FALL_VS = `
attribute vec4 seed; uniform vec2 off; uniform vec2 dir; uniform float amount; uniform float len; uniform float width; uniform float aspect; uniform float round; uniform float time;
varying float vA; varying vec2 vUv;
void main() {
  float depth = 0.4 + 0.6 * seed.z;
  vec2 c = (fract(seed.xy + off * depth) * 2.0 - 1.0) * vec2(aspect * 1.15, 1.15);
  vec2 perp = vec2(-dir.y, dir.x), p;
  if (round > 0.5) { c.x += sin(time * (0.5 + seed.w) + seed.w * 40.0) * 0.022 * depth; float r = width * (0.45 + 1.2 * seed.z * seed.z); p = c + position.xy * r; }
  else p = c + dir * (position.x - 0.5) * len * depth + perp * position.y * width * depth;
  gl_Position = vec4(p.x / aspect, p.y, 0.0, 1.0);
  vA = step(seed.w, amount) * (0.3 + 0.7 * seed.z); vUv = position.xy;
}`;
const FALL_FS = `
uniform vec3 color; uniform float opacity; uniform float round; varying float vA; varying vec2 vUv;
void main() {
  float a = round > 0.5 ? 1.0 - smoothstep(0.25, 1.0, length(vUv)) : (1.0 - abs(vUv.y)) * sin(3.14159 * clamp(vUv.x, 0.0, 1.0));
  a *= vA * opacity; if (a < 0.004) discard;
  gl_FragColor = vec4(color, a);
}`;
class Fall {
  constructor(n, { round = false, len = 0.1, width = 0.002, color = 0xffffff } = {}) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(round ? [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0] : [0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(n * 4); let sd = 11 + n; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < n * 4; i++) seed[i] = rnd();
    g.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = n;
    this.u = { off: { value: new THREE.Vector2() }, dir: { value: new THREE.Vector2(0, -1) }, amount: { value: 0 }, len: { value: len }, width: { value: width }, aspect: { value: 1.78 },
      round: { value: round ? 1 : 0 }, time: { value: 0 }, color: { value: new THREE.Color(color) }, opacity: { value: 0 } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: FALL_VS, fragmentShader: FALL_FS, uniforms: this.u, transparent: true, depthTest: false, depthWrite: false }));
    this.mesh.frustumCulled = false; this.mesh.visible = false;
  }
  // slant: sideways drift for each unit of fall. speed: screen heights a second. amount: share of the marks shown, 0 to 1.
  set(dt, time, dx, dy, speed, amount, opacity, aspect) {
    const l = Math.hypot(dx, dy) || 1, u = this.u; dx /= l; dy /= l;
    u.dir.value.set(dx, dy); u.off.value.x = (u.off.value.x + (dx * speed * dt) / (2.3 * aspect)) % 64; u.off.value.y = (u.off.value.y + (dy * speed * dt) / 2.3) % 64;
    u.amount.value = amount; u.opacity.value = opacity; u.aspect.value = aspect; u.time.value = time;
    this.mesh.visible = amount > 0.004 && opacity > 0.004;
  }
}
export class WeatherLayer {
  constructor() {
    this.scene = new THREE.Scene(); this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.rain = new Fall(1100, { len: 0.085, width: 0.0016, color: 0xd5dee8 });
    this.snow = new Fall(900, { round: true, width: 0.0075, color: 0xffffff });
    this.wind = new Fall(56, { len: 0.42, width: 0.0021, color: 0xffffff });
    for (const f of [this.wind, this.rain, this.snow]) this.scene.add(f.mesh);
  }
  get active() { return this.rain.mesh.visible || this.snow.mesh.visible || this.wind.mesh.visible; }
}

// ---------- aircraft shapes ----------
// Every aircraft shape is cut into paint zones. One number per corner says which zone it belongs to, and each aircraft
// carries its own short list of colours, one per zone. That is how one shape wears many airlines.
export const ZONES = ['top', 'belly', 'stripe', 'aft', 'glass', 'wing', 'eng', 'tip', 'tail0', 'tail1', 'tail2'];
const ZI = {}; ZONES.forEach((z, i) => { ZI[z] = i; });
const newG = () => ({ p: [], n: [], z: [] });
function tri(G, zone, a, b, c, na, nb, nc) {
  for (const [v, n] of [[a, na], [b, nb], [c, nc]]) { G.p.push(v.x, v.y, v.z); G.n.push(n.x, n.y, n.z); G.z.push(zone); }
}
const QN = new THREE.Vector3(), QA = new THREE.Vector3(), QB = new THREE.Vector3();
function quad(G, zone, a, b, c, d) {
  QN.crossVectors(QA.subVectors(b, a), QB.subVectors(d, a)).normalize(); const n = QN.clone();
  tri(G, zone, a, b, c, n, n, n); tri(G, zone, a, c, d, n, n, n);
}
// a thin slab between four corner points, given thickness along t
function slab(G, zone, A, B, C, D, t) {
  const h = new THREE.Vector3(...t).multiplyScalar(0.5);
  const P = [A, B, C, D].map((p) => new THREE.Vector3(...p));
  const top = P.map((p) => p.clone().add(h)), bot = P.map((p) => p.clone().sub(h));
  quad(G, zone, top[0], top[1], top[2], top[3]); quad(G, zone, bot[3], bot[2], bot[1], bot[0]);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(G, zone, top[j], top[i], bot[i], bot[j]); }
}
function pushGeo(G, zone, geo) {
  const g = geo.index ? geo.toNonIndexed() : geo; const p = g.attributes.position.array, n = g.attributes.normal.array;
  for (let i = 0; i < p.length; i++) { G.p.push(p[i]); G.n.push(n[i]); } for (let i = 0; i < p.length / 3; i++) G.z.push(zone);
}
// A round body from tail to nose. profile rows are [z, radius, height of the centre line].
// Paint zones follow the way real aircraft are painted: upper body, a stripe at window height, belly, the rear body, the windshield.
function fuselage(G, profile, { seg = 20, aftZ = -0.26, glass = null, stripe = [90, 108] } = {}) {
  const ring = (i, j) => {
    const [z, r, yc = 0] = profile[i], a = (j / seg) * Math.PI * 2;
    const k0 = profile[Math.max(i - 1, 0)], k1 = profile[Math.min(i + 1, profile.length - 1)], slope = (k1[1] - k0[1]) / Math.max(k1[0] - k0[0], 1e-6);
    return { v: new THREE.Vector3(r * Math.sin(a), yc + r * Math.cos(a), z), n: new THREE.Vector3(Math.sin(a), Math.cos(a), -slope).normalize() };
  };
  for (let i = 0; i < profile.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j + 1), d = ring(i + 1, j);
    let deg = ((j + 0.5) / seg) * 360; if (deg > 180) deg = 360 - deg;     // 0 is the top of the body, 180 the bottom
    const zm = (profile[i][0] + profile[i + 1][0]) / 2;
    let zone = deg < stripe[0] ? ZI.top : deg < stripe[1] ? ZI.stripe : ZI.belly;
    if (zm < aftZ && zone !== ZI.belly) zone = ZI.aft;
    if (glass && zm > glass[0] && zm < glass[1] && deg < glass[2]) zone = ZI.glass;
    tri(G, zone, a.v, c.v, b.v, a.n, c.n, b.n); tri(G, zone, a.v, d.v, c.v, a.n, d.n, c.n);
  }
}
// the tail fin, cut into three bands from bottom to top so a tail can carry up to three colours
function fin(G, fb, rb, rt, ft, thick = 0.012) {
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
  const cuts = [0, 0.4, 0.72, 1];
  for (let b = 0; b < 3; b++) slab(G, ZI.tail0 + b, mix(fb, ft, cuts[b]), mix(rb, rt, cuts[b]), mix(rb, rt, cuts[b + 1]), mix(fb, ft, cuts[b + 1]), [thick, 0, 0]);
}
function finish(G) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(G.p), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(G.n), 3));
  g.setAttribute('zone', new THREE.BufferAttribute(new Float32Array(G.z), 1));
  g.computeBoundingSphere();
  return g;
}
const mirror = (p) => [-p[0], p[1], p[2]];
const both = (G, zone, pts, t) => { slab(G, zone, ...pts, t); slab(G, zone, ...pts.map(mirror).reverse(), t); };
// body: '747' adds the hump of the upper deck over the front third of the body; 'a380' adds a second deck the whole length,
// so the body is taller than it is wide from the nose to the tail, the way the A380 looks.
function jet(engines = 2, body = '') {
  const G = newG();
  fuselage(G, [[-0.5, 0.004, 0.03], [-0.47, 0.016, 0.024], [-0.36, 0.036, 0.011], [-0.22, 0.05, 0], [0.33, 0.05, 0], [0.4, 0.045, -0.001], [0.435, 0.038, -0.004], [0.465, 0.028, -0.008], [0.49, 0.014, -0.012], [0.5, 0.0, -0.014]],
    { glass: body === 'a380' ? null : [0.4, 0.465, 64] });
  if (body === '747') fuselage(G, [[-0.02, 0.004, 0.03], [0.04, 0.026, 0.032], [0.12, 0.034, 0.034], [0.34, 0.034, 0.034], [0.4, 0.03, 0.028], [0.44, 0.022, 0.02], [0.47, 0.008, 0.01], [0.48, 0.0, 0.006]], { glass: [0.42, 0.47, 50], stripe: [72, 84] });
  if (body === 'a380') fuselage(G, [[-0.44, 0.004, 0.044], [-0.38, 0.022, 0.04], [-0.26, 0.042, 0.034], [-0.18, 0.046, 0.034], [0.34, 0.046, 0.032], [0.41, 0.04, 0.026], [0.45, 0.032, 0.016], [0.475, 0.022, 0.006], [0.49, 0.01, -0.002], [0.495, 0.0, -0.006]], { glass: [0.44, 0.49, 70], stripe: [72, 86] });
  both(G, ZI.wing, [[0.045, -0.03, 0.12], [0.045, -0.03, -0.07], [0.5, 0.015, -0.2], [0.5, 0.015, -0.145]], [0, 0.012, 0]);
  both(G, ZI.tip, [[0.497, 0.017, -0.15], [0.497, 0.017, -0.2], [0.512, 0.07, -0.228], [0.512, 0.07, -0.2]], [0.006, 0, 0]);
  both(G, ZI.wing, [[0.02, 0.03, -0.37], [0.02, 0.03, -0.46], [0.19, 0.04, -0.5], [0.19, 0.04, -0.455]], [0, 0.008, 0]);
  fin(G, [0, 0.045, -0.33], [0, 0.04, -0.475], [0, 0.21, -0.52], [0, 0.21, -0.455]);
  const eng = (x, z) => {
    const g = new THREE.CylinderGeometry(0.026, 0.022, 0.1, 12); g.rotateX(Math.PI / 2); g.translate(x, -0.058, z); pushGeo(G, ZI.eng, g);
    const d = new THREE.CircleGeometry(0.021, 12); d.translate(x, -0.058, z + 0.0506); pushGeo(G, ZI.glass, d);
  };
  eng(0.17, 0.05); eng(-0.17, 0.05);
  if (engines === 4) { eng(0.31, -0.03); eng(-0.31, -0.03); }
  return finish(G);
}
function light() {
  const G = newG();
  // a single engine at the nose: a spinner and a two-blade propeller, standing still as it looks in a photo
  const spin = new THREE.ConeGeometry(0.018, 0.04, 10); spin.rotateX(Math.PI / 2); spin.translate(0, -0.006, 0.515); pushGeo(G, ZI.eng, spin);
  slab(G, ZI.glass, [-0.007, -0.12, 0.5], [0.007, -0.12, 0.5], [0.007, 0.11, 0.5], [-0.007, 0.11, 0.5], [0, 0, 0.006]);
  fuselage(G, [[-0.5, 0.006, 0.012], [-0.3, 0.022, 0.006], [-0.05, 0.05, 0], [0.2, 0.058, 0], [0.36, 0.05, -0.004], [0.46, 0.032, -0.008], [0.5, 0.0, -0.01]], { seg: 12, aftZ: -9, glass: [0.05, 0.3, 62], stripe: [75, 105] });
  both(G, ZI.wing, [[0.0, 0.06, 0.2], [0.0, 0.06, 0.04], [0.62, 0.075, 0.06], [0.62, 0.075, 0.17]], [0, 0.014, 0]);
  both(G, ZI.tip, [[0.62, 0.075, 0.17], [0.62, 0.075, 0.06], [0.66, 0.078, 0.07], [0.66, 0.078, 0.16]], [0, 0.014, 0]);
  both(G, ZI.wing, [[0.0, 0.02, -0.38], [0.0, 0.02, -0.48], [0.22, 0.02, -0.48], [0.22, 0.02, -0.41]], [0, 0.01, 0]);
  fin(G, [0, 0.025, -0.34], [0, 0.02, -0.5], [0, 0.2, -0.52], [0, 0.2, -0.44]);
  return finish(G);
}
function heli() {
  const G = newG();
  fuselage(G, [[-0.12, 0.02, 0], [-0.02, 0.085, 0], [0.14, 0.1, 0], [0.3, 0.085, -0.004], [0.4, 0.04, -0.02], [0.42, 0.0, -0.024]], { seg: 14, aftZ: -9, glass: [0.2, 0.41, 80], stripe: [80, 108] });
  fuselage(G, [[-0.5, 0.008, 0.03], [-0.1, 0.025, 0.01]], { seg: 8, aftZ: 9, stripe: [200, 200] });
  fin(G, [0, 0.03, -0.42], [0, 0.03, -0.5], [0, 0.17, -0.53], [0, 0.17, -0.47]);
  const mast = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6); mast.translate(0, 0.115, 0.12); pushGeo(G, ZI.glass, mast);
  return finish(G);
}
function rotorGeo() {
  const G = newG();
  slab(G, 0, [-0.5, 0, 0.018], [-0.5, 0, -0.018], [0.5, 0, -0.018], [0.5, 0, 0.018], [0, 0.004, 0]);
  slab(G, 0, [-0.018, 0, -0.5], [0.018, 0, -0.5], [0.018, 0, 0.5], [-0.018, 0, 0.5], [0, 0.004, 0]);
  return finish(G);
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
// tips: wing tip lights. beacons: the red flashing lights, one on top of the tail fin and one under the belly.
export const MODELS = {
  jet: { make: () => jet(2), len: 1.0, tips: 0.512, tipY: 0.05, tipZ: -0.2, tail: -0.5, tailY: 0.035, finTop: [0.225, -0.49], belly: [-0.062, 0.02] },
  b747: { make: () => jet(4, '747'), len: 1.45, tips: 0.512, tipY: 0.05, tipZ: -0.2, tail: -0.5, tailY: 0.035, finTop: [0.225, -0.49], belly: [-0.062, 0.02] },
  a380: { make: () => jet(4, 'a380'), len: 1.5, tips: 0.512, tipY: 0.05, tipZ: -0.2, tail: -0.5, tailY: 0.035, finTop: [0.225, -0.49], belly: [-0.062, 0.02] },
  heavy: { make: () => jet(4), len: 1.45, tips: 0.512, tipY: 0.05, tipZ: -0.2, tail: -0.5, tailY: 0.035, finTop: [0.225, -0.49], belly: [-0.062, 0.02] },
  light: { make: light, len: 0.5, tips: 0.66, tipY: 0.078, tipZ: 0.11, tail: -0.5, tailY: 0.02, finTop: [0.215, -0.48], belly: [-0.07, 0.1] },
  heli: { make: heli, len: 0.5, tips: 0.1, tipY: 0.0, tipZ: 0.1, tail: -0.5, tailY: 0.03, finTop: [0.185, -0.5], belly: [-0.112, 0.14] },
};
// Type codes are matched by their start, so a short code must not also be the start of another aircraft's code:
// C17 (the C-17) is the start of C172 and C177, H25B is a Hawker jet, not a helicopter, and A318 and A319 are narrow bodies.
export function modelFor(category, type) {
  const t = (type || '').toUpperCase();
  if (category === 'A7' || /^(H\d\d\d?$|EC\d|AS\d|B06|B407|B429|R22|R44|R66|S76|S92|A109|A139|A169|UH)/.test(t)) return 'heli';
  if (/^B74/.test(t)) return 'b747';
  if (/^A38/.test(t)) return 'a380';
  if (/^(A34|IL96|A124|C5M|C17$|B52|K35)/.test(t)) return 'heavy';
  if (category === 'A5' || /^(B77|B78|A33|A35|B76|MD11|DC10|A30|A310)/.test(t)) return 'heavy2';
  if (category === 'A1' || /^(C1[5-9]\d|C2\d\d|P28|PA\d|SR2|DA4|BE3[3-6]|BE5|M20|C82|C72)/.test(t)) return 'light';
  return 'jet';
}
// One material per aircraft. The shader looks up each corner's zone in that aircraft's own list of colours.
// The tail fin also glows a little at night, the way a real tail is lit by its logo lights.
function paintMaterial(paint, m) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.05, transparent: true, fog: true });
  // flash: x is how brightly the white wing tip strobes are lighting the aircraft right now, y the same for the red beacons
  const u = mat.userData.u = { paint: { value: paint }, flash: { value: new THREE.Vector2() }, pTip: { value: new THREE.Vector3(m.tips, m.tipY, m.tipZ) },
    pTop: { value: new THREE.Vector3(0, m.finTop[0], m.finTop[1]) }, pBelly: { value: new THREE.Vector3(0, m.belly[0], m.belly[1]) } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float zone;\nuniform vec3 paint[' + ZONES.length + '];\nvarying vec3 vPaint;\nvarying float vLit;\nvarying vec3 vObj;\nvarying vec3 vObjN;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPaint = paint[int(zone + 0.5)]; vLit = step(7.5, zone); vObj = position; vObjN = normal;');
    // The aircraft's own lights fall on its own skin: each flash is a small lamp at the place the light sits, lighting the surfaces that face it.
    sh.fragmentShader = 'varying vec3 vPaint;\nvarying float vLit;\nvarying vec3 vObj;\nvarying vec3 vObjN;\nuniform vec2 flash;\nuniform vec3 pTip;\nuniform vec3 pTop;\nuniform vec3 pBelly;\n'
      + 'float lamp(vec3 at, float reach) { vec3 d = at - vObj; float l = length(d); return (0.22 + 0.78 * max(dot(normalize(vObjN), d / max(l, 0.0001)), 0.0)) / (1.0 + (l * l) / (reach * reach)); }\n'
      + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vPaint;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vPaint * mix(0.34, 1.0, vLit);\n'
          + '  vec3 skin = mix(vPaint, vec3(1.0), 0.3);\n'
          + '  totalEmissiveRadiance += skin * vec3(1.0, 1.0, 1.0) * flash.x * (lamp(pTip, 0.26) + lamp(vec3(-pTip.x, pTip.y, pTip.z), 0.26));\n'
          + '  totalEmissiveRadiance += skin * vec3(1.0, 0.16, 0.1) * flash.y * (lamp(pTop, 0.2) + lamp(pBelly, 0.22));');
  };
  mat.customProgramCacheKey = () => 'sky3d-paint-2';
  return mat;
}
// the beam of the landing lights: a soft cone of light reaching ahead of the aircraft and a little downward
let beamGeo = null;
function beamGeometry() {
  if (beamGeo) return beamGeo;
  const g = new THREE.CylinderGeometry(0.012, 0.2, 1.25, 18, 1, true); g.translate(0, -0.625, 0); g.rotateX(-Math.PI / 2 + 0.07);   // apex at the lights, opening forward
  beamGeo = g; return g;
}
const BEAM_VS = 'varying float vAlong; varying vec3 vN; varying vec3 vV; void main(){ vAlong = 1.0 - uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }';
const BEAM_FS = 'uniform float opacity; varying float vAlong; varying vec3 vN; varying vec3 vV; void main(){ float edge = abs(dot(normalize(vN), normalize(vV))); float a = opacity * pow(1.0 - vAlong, 1.6) * smoothstep(0.0, 0.06, vAlong) * (0.35 + 0.65 * edge); gl_FragColor = vec4(1.0, 0.97, 0.9, a); }';
export class PlaneMesh {
  // paint: a list of colours, one per zone, in the order of ZONES
  constructor(kind, paint) {
    const twin = kind === 'heavy2'; const key = twin ? 'jet' : kind; const m = MODELS[key];
    this.model = m; this.len = twin ? 1.3 : m.len; this.key = key;
    if (!GEOS[key]) GEOS[key] = m.make();
    this.paint = paint.map((c) => new THREE.Color(c));
    this.mat = paintMaterial(this.paint, m);
    this.mesh = new THREE.Mesh(GEOS[key], this.mat); this.mesh.renderOrder = 10;
    this.group = new THREE.Group(); this.group.add(this.mesh); this.group.rotation.order = 'YXZ';
    this.rotor = null;
    if (key === 'heli') {
      if (!GEOS.rotor) GEOS.rotor = rotorGeo();
      this.rotorMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.7, transparent: true, fog: true });
      this.rotor = new THREE.Mesh(GEOS.rotor, this.rotorMat); this.rotor.position.set(0, 0.142, 0.12); this.rotor.renderOrder = 10; this.group.add(this.rotor);
    }
    const sp = (color, x, y, z, s, additive = true) => {
      const mat = new THREE.SpriteMaterial({ map: dotTexture(), color, transparent: true, depthWrite: false, depthTest: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false });
      const o = new THREE.Sprite(mat); o.position.set(x, y, z); o.scale.setScalar(s); o.renderOrder = 12; o.userData.s = s; this.group.add(o); return o;
    };
    this.red = sp(0xff3b30, m.tips, m.tipY, m.tipZ, 0.11); this.green = sp(0x30ff6a, -m.tips, m.tipY, m.tipZ, 0.11);
    this.white = sp(0xffffff, 0, m.tailY, m.tail, 0.1);
    this.strobeL = sp(0xffffff, m.tips, m.tipY, m.tipZ, 0.34); this.strobeR = sp(0xffffff, -m.tips, m.tipY, m.tipZ, 0.34);
    // The red beacons are drawn as solid red, not as added light, so they still read as red against a bright daytime sky.
    this.beaconTop = sp(0xff1f14, 0, m.finTop[0], m.finTop[1], 0.2, false); this.beaconBelly = sp(0xff1f14, 0, m.belly[0], m.belly[1], 0.2, false);
    this.glowTop = sp(0xff3a22, 0, m.finTop[0], m.finTop[1], 0.5); this.glowBelly = sp(0xff3a22, 0, m.belly[0], m.belly[1], 0.5);
    this.sprites = [this.red, this.green, this.white, this.strobeL, this.strobeR, this.beaconTop, this.beaconBelly, this.glowTop, this.glowBelly];
    this.landing = null; this.landLevel = 0;   // landing lights are only made for an aircraft the first time it needs them
    this.phase = Math.random() * 10;
  }
  makeLanding() {
    const m = this.model, k = this.key, z = k === 'light' ? 0.215 : k === 'heli' ? 0.4 : 0.128, x = k === 'jet' || k === 'heavy' || k === 'b747' || k === 'a380' ? 0.075 : 0, y = k === 'light' ? 0.062 : k === 'heli' ? -0.06 : -0.034;
    const mk = (px) => { const mat = new THREE.SpriteMaterial({ map: dotTexture(), color: 0xfff6e0, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false, opacity: 0 });
      const o = new THREE.Sprite(mat); o.position.set(px, y, z); o.renderOrder = 13; this.group.add(o); return o; };
    const lamps = x ? [mk(x), mk(-x)] : [mk(0)];
    const beamMat = new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, uniforms: { opacity: { value: 0 } }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(beamGeometry(), beamMat); beam.position.set(0, y, z); beam.renderOrder = 11; this.group.add(beam);
    this.landing = { lamps, beam, beamMat };
  }
  // night: 0 day to 1 night. opacity: fade in and out. far: 0 near to 1 far (lights swell with distance so far aircraft stay visible as points)
  // landing: 0 to 1, how far the landing lights are switched on. ahead: 1 when the camera is straight in front of the nose, -1 when straight behind.
  update(time, opacity, night, bodyColor, far, landing = 0, ahead = 0) {
    this.mat.opacity = opacity; this.mat.color.copy(bodyColor);
    this.mat.emissive.setScalar(0.3 * night);
    if (this.rotor) { this.rotorMat.opacity = opacity * 0.85; this.rotor.rotation.y = (time + this.phase) * 9.5; }
    const base = (0.12 + 0.88 * night) * opacity, swell = (0.55 + 0.45 * night) * (1 + far * 1.6 * night);
    const t = (time + this.phase) % 1.6, flash = (t < 0.06 || (t > 0.18 && t < 0.24)) ? 1 : 0;
    this.red.material.opacity = base; this.green.material.opacity = base; this.white.material.opacity = base * 0.9;
    for (const s of [this.red, this.green, this.white]) s.scale.setScalar(s.userData.s * swell);
    this.strobeL.material.opacity = this.strobeR.material.opacity = flash * (0.07 + 0.93 * night) * opacity;
    this.strobeL.scale.setScalar(0.34 * swell); this.strobeR.scale.setScalar(0.34 * swell);
    // red beacons: one flash a second, top and belly together, as bright by day as by night
    const bt = (time + this.phase * 0.37) % 1.0, b = bt < 0.05 ? bt / 0.05 : bt < 0.13 ? 1 : bt < 0.3 ? 1 - (bt - 0.13) / 0.17 : 0;
    const bs = (0.75 + 0.25 * night) * (1 + far * 1.2);
    this.beaconTop.material.opacity = this.beaconBelly.material.opacity = b * opacity;
    this.beaconTop.scale.setScalar(0.2 * bs); this.beaconBelly.scale.setScalar(0.2 * bs);
    this.glowTop.material.opacity = this.glowBelly.material.opacity = b * opacity * (0.1 + 0.6 * night);
    this.glowTop.scale.setScalar(0.5 * bs); this.glowBelly.scale.setScalar(0.5 * bs);
    // the flashes light the aircraft itself, more as the sky darkens and not at all by day
    const dark = night * night * (3 - 2 * night);
    this.mat.userData.u.flash.value.set(flash * dark * 0.8, b * dark * 0.55);
    // landing lights: a hard white glare from ahead, a softer glow from the side, and a beam reaching forward
    if (landing > 0.01 && !this.landing) this.makeLanding();
    if (this.landing) {
      const L = this.landing, on = landing * opacity, front = Math.max(0, ahead), glare = 0.3 + 0.7 * front * front;
      for (const o of L.lamps) { o.material.opacity = on * (0.45 + 0.55 * glare); o.scale.setScalar((0.16 + 0.5 * front * front * front) * (1 + far * 2.2)); o.visible = on > 0.01; }
      L.beamMat.uniforms.opacity.value = on * 0.2 * (1 - 0.5 * front); L.beam.visible = on > 0.01;
    }
    for (const o of this.sprites) o.visible = o.material.opacity > 0.012;   // a light that is dark this instant is not drawn at all, which matters with many aircraft
    this.mesh.visible = opacity > 0.01; this.group.visible = opacity > 0.01;
  }
  dispose() {
    this.mat.dispose(); if (this.rotorMat) this.rotorMat.dispose(); for (const s of this.sprites) s.material.dispose();
    if (this.landing) { for (const o of this.landing.lamps) o.material.dispose(); this.landing.beamMat.dispose(); }
  }
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
