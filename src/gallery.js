// ---------- the aircraft gallery (version 3.12) ----------
// G opens a window with every shape the sky draws, the airline and military paint it knows, and the fun paints. Each picture is
// drawn by one small renderer of its own and copied onto the card, so the gallery costs one extra drawing surface however many
// cards it shows, and the sky behind it is not drawn while it is open.
import * as THREE from 'three';
import { MODELS, PlaneMesh } from './scene.js';
import { AIRLINES, LIVERY, PAINT_AS, FUN, FUN_KEYS, paintFor } from './airlines.js';

// Every shape, in the order a plane geek would look for them, with the aircraft that get it and what is still plain about it.
// The type codes are the ones modelFor in src/scene.js sends to each shape; keep the two in step.
export const SHAPES = [
  { key: 'jet', name: 'Narrow body twin jet', who: 'Airbus A220 and A320 family, Boeing 737, Embraer E-Jets, Bombardier CRJ, and any jet not listed below', codes: 'A20N A21N A319 A320 A321 B737 B738 B739 B38M B39M BCS1 BCS3 E170 E75L E190 CRJ7 CRJ9', plain: 'One shape for all of these for now: the E-Jets and CRJs keep the A320 and 737 body, wings and engines under the wing, though a CRJ has its engines at the back and a T-tail.' },
  { key: 'heavy2', name: 'Wide body twin jet', who: 'Boeing 767, 777 and 787, Airbus A300, A310, A330 and A350, and the three-engine MD-11 and DC-10', codes: 'B763 B772 B77W B788 B789 A332 A333 A339 A359 A35K MD11', plain: 'Drawn as the narrow body, a third larger. It needs its own wider body and larger engines, and the MD-11 its third engine in the tail.' },
  { key: 'b757', name: 'Boeing 757', who: 'Boeing 757-200 and -300', codes: 'B752 B753', plain: 'A longer, slimmer body, a sharper nose and bigger engines than the 737.' },
  { key: 'b747', name: 'Boeing 747', who: 'Every 747, passenger and freighter', codes: 'B741 B742 B744 B748 B74F', plain: 'Four engines and the hump of the upper deck over the front third of the body.' },
  { key: 'a380', name: 'Airbus A380', who: 'Airbus A380', codes: 'A388', plain: 'Four engines and a full-length double deck, taller than it is wide.' },
  { key: 'heavy', name: 'Four-engine heavy', who: 'Airbus A340, Ilyushin Il-96, Antonov An-124, C-5M Galaxy, C-17 Globemaster, B-52, KC-135', codes: 'A342 A343 A346 IL96 A124 C5M C17 B52 K35R', plain: 'One four-engine airliner shape for all of these. The C-17 and C-5 have a high wing and a T-tail, and the B-52 eight engines; those come with the refining.' },
  { key: 'biz', name: 'Business jet', who: 'Citation, Challenger, Gulfstream, Global, Phenom, Learjet, Falcon, Hawker, Pilatus PC-24, HondaJet', codes: 'C25A C56X C68A CL35 CL60 GLF5 GLF6 GL7T E55P LJ45 FA7X H25B PC24 HDJT', plain: 'Engines on pods at the back and a T-tail. A Falcon 7X or 900 has three engines and is drawn with two.' },
  { key: 'turbo', name: 'Twin turboprop, high wing', who: 'ATR 42 and 72, Dash 8, Dornier 328, Fokker 50, CASA C-212 and CN-235, Twin Otter', codes: 'AT45 AT76 DH8A DH8D D328 F50 C212 CN35 DHC6', plain: 'The wing on top of the body with an engine and propeller on each side.' },
  { key: 'turbolow', name: 'Twin turboprop, low wing', who: 'Saab 340 and 2000, Embraer Brasilia, Jetstream 31 and 41, Metro', codes: 'SF34 SB20 E120 JS31 JS32 JS41 SW4', plain: 'Airliner sized, with the wing below the body.' },
  { key: 'kingair', name: 'King Air class twin', who: 'King Air, Beech 1900 and 99, Piaggio Avanti, Cessna Conquest, MU-2, Cheyenne', codes: 'BE20 BE30 B350 BE9L B190 P180 C441 MU2 PAY3', plain: 'A smaller twin turboprop with the wing below. The Avanti has its propellers at the back, still to come.' },
  { key: 'light', name: 'Light single', who: 'Cessna 150 to 210, Piper, Cirrus, Diamond, Bonanza, Mooney, and the PC-12 and TBM single turboprops', codes: 'C150 C172 C182 C208 P28A PA46 SR22 DA40 BE36 M20P PC12 TBM9', plain: 'One high wing single for all of these. The Cirrus, Piper Cherokee, Diamond, Bonanza and Mooney are low wing; that comes with the refining.' },
  { key: 'heli', name: 'Helicopter', who: 'Every helicopter: Airbus H125 to H160, Bell, Robinson, Sikorsky S-76 and S-92, Leonardo AW109 and AW139, Black Hawk', codes: 'AS50 EC35 H60 B06 B407 R44 S76 S92 A109 A139 UH60', plain: 'A cabin with skids and a tail rotor. Types on wheels, like the S-76 and AW139, still get skids.' },
];

// The airline paint the sky knows, grouped the way a plane geek reads a departures board.
const GROUPS = [
  ['United States', ['AAL', 'DAL', 'UAL', 'SWA', 'JBU', 'ASA', 'NKS', 'FFT', 'HAL', 'AAY', 'SCX', 'VXP']],
  ['Regionals, in their partner\'s paint', Object.keys(PAINT_AS)],
  ['Canada', ['ACA', 'WJA', 'POE']],
  ['Europe', ['BAW', 'VIR', 'EIN', 'DLH', 'AFR', 'KLM', 'SWR', 'IBE', 'TAP', 'ITY', 'FIN', 'THY']],
  ['Middle East', ['UAE', 'QTR', 'ETD']],
  ['Asia and the Pacific', ['CPA', 'SIA', 'JAL', 'ANA', 'KAL', 'CCA', 'CSN', 'EVA', 'QFA', 'ANZ']],
  ['Latin America', ['AVA', 'TAM']],
  ['Cargo', ['FDX', 'UPS']],
];
const hex6 = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

export class Gallery {
  constructor($) {
    this.$ = $; this.box = $('gallery'); this.tab = 'shapes'; this.cards = []; this.spin = null; this.built = {}; this.t0 = 0;
    this.onFun = null;   // set by the page: called with a fun paint key when the viewer picks one
    for (const b of this.box.querySelectorAll('[data-tab]')) b.addEventListener('click', () => this.show(b.dataset.tab));
    $('gallery-close').addEventListener('click', () => this.close());
    this.box.addEventListener('pointerdown', (e) => { if (e.target === this.box) this.close(); });
  }
  get isOpen() { return !this.box.hidden; }
  // one small renderer for every card, made the first time the gallery opens
  ready() {
    if (this.renderer) return;
    this.W = 360; this.H = 216;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.pr = Math.min(window.devicePixelRatio || 1, 2); this.renderer.setPixelRatio(this.pr); this.renderer.setSize(this.W, this.H, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x3a4250, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9); sun.position.set(2, 3, 2.5); this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(26, this.W / this.H, 0.05, 50);
    this.white = new THREE.Color(1, 1, 1);
  }
  open(tab) {
    this.ready(); this.box.hidden = false; this.show(tab || this.tab);
    const b = this.box.querySelector('[data-tab="' + this.tab + '"]'); if (b) b.focus();
  }
  close() { if (this.box.hidden) return; this.box.hidden = true; this.spin = null; const ae = document.activeElement; if (ae && this.box.contains(ae) && ae.blur) ae.blur(); }
  toggle() { if (this.isOpen) this.close(); else this.open(); }
  show(tab) {
    this.tab = tab;
    for (const b of this.box.querySelectorAll('[data-tab]')) { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.classList.toggle('on', on); }
    for (const id of ['shapes', 'paint', 'fun']) this.$('gal-' + id).hidden = id !== tab;
    if (!this.built[tab]) { this.built[tab] = true; this['build_' + tab](); }
    this.cards = [...this.$('gal-' + tab).querySelectorAll('canvas')].map((c) => c.card);
    for (const c of this.cards) c.drawn = false;
  }
  // a card: a picture of one aircraft in one paint, a title and a few lines under it
  card(parent, kind, paint, title, lines) {
    const el = document.createElement('figure'); el.className = 'gcard';
    const cv = document.createElement('canvas'); cv.width = this.W * this.pr; cv.height = this.H * this.pr; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', title);
    const cap = document.createElement('figcaption'); const b = document.createElement('b'); b.textContent = title; cap.appendChild(b);
    for (const l of lines) { if (!l) continue; const s = document.createElement('span'); s.textContent = l; cap.appendChild(s); }
    el.appendChild(cv); el.appendChild(cap); parent.appendChild(el);
    const card = cv.card = { cv, el, kind, paint, angle: 0.75, drawn: false };
    el.addEventListener('pointerenter', () => { this.spin = card; }); el.addEventListener('pointerleave', () => { if (this.spin === card) this.spin = null; card.drawn = false; });
    return card;
  }
  build_shapes() {
    const grid = this.$('gal-shapes');
    for (const s of SHAPES) {
      this.card(grid, s.key, paintFor('', 'gallery', s.key), s.name, [s.who, 'Type codes: ' + s.codes, s.plain]);
    }
  }
  build_paint() {
    const box = this.$('gal-paint');
    for (const [name, keys] of GROUPS) {
      const h = document.createElement('h2'); h.textContent = name; box.appendChild(h);
      const grid = document.createElement('div'); grid.className = 'ggrid'; box.appendChild(grid);
      for (const k of keys) {
        const al = AIRLINES[k]; if (!al) continue; const as = PAINT_AS[k];
        this.card(grid, 'jet', paintFor(k + '1', k, 'jet'), al[1], [k + (al[0] ? ', ' + al[0] : ''), as && AIRLINES[as] ? 'Flies in ' + AIRLINES[as][1] + ' paint' : '']);
      }
    }
    const h = document.createElement('h2'); h.textContent = 'Military'; box.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'ggrid'; box.appendChild(grid);
    this.card(grid, 'heavy', paintFor('', 'mil', 'heavy', { mil: true }), 'Military aircraft', ['Plain grey, the way most US transports, tankers and patrol aircraft are painted', 'Known from the aircraft\'s own records, not guessed']);
    this.card(grid, 'heli', paintFor('', 'mil', 'heli', { mil: true }), 'Military helicopter', ['Army olive drab']);
    // airlines known only by one tail colour: a chip each, not a picture, to keep the gallery light
    const rest = Object.keys(AIRLINES).filter((k) => !LIVERY[k] && !PAINT_AS[k] && !GROUPS.some((g) => g[1].indexOf(k) !== -1));
    const h2 = document.createElement('h2'); h2.textContent = 'Known by their tail colour only'; box.appendChild(h2);
    const p = document.createElement('p'); p.className = 'gnote'; p.textContent = 'These fly white with the tail and engines in this colour until their own paint is added.'; box.appendChild(p);
    const chips = document.createElement('div'); chips.className = 'gchips'; box.appendChild(chips);
    for (const k of rest) { const s = document.createElement('span'); const dot = document.createElement('i'); dot.style.background = hex6(AIRLINES[k][2]); s.appendChild(dot); s.appendChild(document.createTextNode(AIRLINES[k][1])); chips.appendChild(s); }
  }
  build_fun() {
    const grid = this.$('gal-fun-grid');
    const pick = (key) => { if (this.onFun) this.onFun(key); this.markFun(key); };
    const add = (key, name, paint, line) => {
      const c = this.card(grid, 'jet', paint, name, [line]);
      const b = document.createElement('button'); b.type = 'button'; b.dataset.fun = key; b.textContent = 'Use this'; b.addEventListener('click', () => pick(key)); c.el.querySelector('figcaption').appendChild(b);
    };
    add('', 'Plain', paintFor('', 'gallery', 'jet'), 'White with a grey tail, or one trim colour on a small aircraft, as before');
    for (const k of FUN_KEYS) add(k, FUN[k].name, paintFor('', 'gallery', 'jet', { fun: k }), '');
    add('random', 'A different one on each aircraft', paintFor('', 'gallery2', 'jet', { fun: 'random' }), 'Picked from the paints above, the same each time for one aircraft');
  }
  markFun(key) { for (const b of this.$('gal-fun').querySelectorAll('button[data-fun]')) { const on = b.dataset.fun === (key || ''); b.textContent = on ? 'In use' : 'Use this'; b.classList.toggle('on', on); } }
  // draw one card into its own picture
  draw(card, time) {
    const m = card.kind === 'heavy2' ? MODELS.jet : MODELS[card.kind];
    if (!card.mesh) card.mesh = new PlaneMesh(card.kind, card.paint);
    const pm = card.mesh;
    this.scene.add(pm.group);
    pm.group.rotation.set(0, card.angle, 0); pm.group.position.set(0, 0, 0); pm.group.scale.setScalar(1);
    pm.update(time, 1, 0.15, this.white, 0);
    // fit the aircraft to the card: its length or its wingspan, whichever is wider on screen
    const span = Math.max(1.0, (m.tips || 0.5) * 2.1), d = span / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.min(this.camera.aspect, 1.6) * 1.12;
    this.camera.position.set(0, d * 0.32, d); this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(pm.group);
    const x = card.cv.getContext('2d'); x.clearRect(0, 0, card.cv.width, card.cv.height); x.drawImage(this.renderer.domElement, 0, 0, card.cv.width, card.cv.height);
    card.drawn = true;
  }
  // called from the page's own frame while the gallery is open: draws the cards not yet drawn that are on screen, a few a frame,
  // and turns the one under the mouse
  frame(time) {
    if (!this.isOpen || !this.renderer) return;
    let n = 0; const top = 0, bottom = window.innerHeight;
    for (const c of this.cards) {
      if (c.drawn) continue; const r = c.cv.getBoundingClientRect(); if (r.bottom < top || r.top > bottom) continue;
      this.draw(c, time); if (++n >= 4) break;
    }
    if (this.spin) { this.spin.angle += 0.012; this.draw(this.spin, time); }
  }
  dispose() { for (const c of this.cards) if (c.mesh) c.mesh.dispose(); }
}
