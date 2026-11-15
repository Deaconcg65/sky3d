// Drives the version 3.6 controls and the version 3.7 watch list in Chromium against tools/sim.js: fly heading, key ownership, search,
// click and follow behavior, watch list alerts.
// usage: node tools/sim.js 8090 (in another window), then node tools/controls.js. Prints PASS or FAIL per check.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const PAGE = 'http://localhost:8090/net/?routeApi=/mock/routeset&posApi=/mock/v2/&dpr=1&sky=day&wx=clear&netApi=/mock/v2/&placeApi=/mock/place/';
  await page.goto(PAGE);
  const kind = () => page.evaluate(() => window.__sky.shot.kind);
  const ok = (label, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : ''));
  await page.waitForTimeout(7000);
  // 1. fly heading at four orbit angles
  await page.keyboard.press('f'); await page.waitForTimeout(300);
  for (const az of [0, 90, 180, 270]) {
    await page.evaluate((a) => { const s = window.__sky; s.fly.az = a; s.fly.el = 30; s.fly.dist = 20; s.fly.last = performance.now() / 1000; s.__lat = s.fly.lat; s.__lon = s.fly.lon; }, az);
    await page.waitForTimeout(400);
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1200); await page.keyboard.up('ArrowUp');
    const r = await page.evaluate(() => { const s = window.__sky, T = s.camera.position.constructor; const t = new T(), n = new T(), e = new T();
      s.project(s.pose.lat, s.pose.lon, s.pose.alt, t); s.project(s.pose.lat + 0.1, s.pose.lon, s.pose.alt, n); s.project(s.pose.lat, s.pose.lon + 0.1 / Math.cos(s.pose.lat * Math.PI / 180), s.pose.alt, e);
      n.sub(t).setY(0).normalize(); e.sub(t).setY(0).normalize(); const look = new T(); s.camera.getWorldDirection(look); look.setY(0).normalize();
      const view = (Math.atan2(look.dot(e), look.dot(n)) * 180 / Math.PI + 360) % 360;
      const dN = s.fly.lat - s.__lat, dE = (s.fly.lon - s.__lon) * Math.cos(s.fly.lat * Math.PI / 180), move = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360; return { view, move }; });
    const diff = Math.abs(((r.view - r.move + 540) % 360) - 180);
    ok('forward follows the view at orbit angle ' + az, diff < 8, `view ${r.view.toFixed(0)} moved ${r.move.toFixed(0)}`);
  }
  // right turn raises the view heading
  const h0 = await page.evaluate(() => { const s = window.__sky; const T = s.camera.position.constructor, look = new T(); s.camera.getWorldDirection(look); return Math.atan2(look.x, -look.z) * 180 / Math.PI; });
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(500); await page.keyboard.up('ArrowRight'); await page.waitForTimeout(200);
  const h1 = await page.evaluate(() => { const s = window.__sky; const T = s.camera.position.constructor, look = new T(); s.camera.getWorldDirection(look); return Math.atan2(look.x, -look.z) * 180 / Math.PI; });
  ok('right arrow turns right (clockwise from above)', (((h1 - h0 + 540) % 360) - 180) > 5, `scene yaw ${h0.toFixed(0)} to ${h1.toFixed(0)}`);
  // drag right makes the scene follow the pointer: view turns left
  const before = await page.evaluate(() => window.__sky.fly.az);
  await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.move(740, 360, { steps: 4 }); await page.mouse.up();
  const after = await page.evaluate(() => window.__sky.fly.az); ok('drag right raises orbit angle (scene follows the pointer)', after > before, `${before.toFixed(1)} to ${after.toFixed(1)}`);
  // 3. held key after Escape
  await page.keyboard.down('ArrowUp'); await page.keyboard.press('Escape'); await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowUp'); await page.waitForTimeout(400); await page.keyboard.up('ArrowUp');
  ok('held key does not retake the controls after Escape', (await kind()) !== 'fly', await kind());
  // 4. help owns the keyboard
  await page.keyboard.press('f'); await page.waitForTimeout(200); const az0 = await page.evaluate(() => window.__sky.fly.az);
  await page.keyboard.press('h'); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(600); await page.keyboard.up('ArrowRight'); const az1 = await page.evaluate(() => window.__sky.fly.az);
  ok('help open: held arrow does not steer', Math.abs(az1 - az0) < 0.5, `${az0.toFixed(1)} ${az1.toFixed(1)}`); await page.keyboard.press('Escape');
  await page.keyboard.press('a'); await page.waitForTimeout(500);
  // 5. settings own the keyboard
  await page.keyboard.press('s'); await page.waitForTimeout(500); await page.keyboard.press('f'); await page.waitForTimeout(300);
  ok('settings open: f does not start fly mode', (await kind()) !== 'fly', await kind()); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('Escape closes settings', await page.evaluate(() => !document.body.classList.contains('panel')));
  // 6. search then Tab then Escape
  await page.keyboard.press('/'); await page.waitForTimeout(500); await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
  ok('search closes with Escape after Tab', await page.evaluate(() => document.getElementById('find').hidden));
  // 8 and 10. registration from the database, 737 MAX alias
  await page.evaluate(() => { const ps = [...window.__sky.planes.values()].filter((p) => p.lat !== null && p.opacity > 0.3); ps[0].reg = ''; ps[0].info = { reg: 'N771ZZ', long: '', type: '' }; ps[1].type = 'B350'; ps[1].desc = 'BEECH 350'; });
  await page.keyboard.press('/'); await page.waitForTimeout(400); await page.fill('#find-q', 'n771zz'); await page.waitForTimeout(300);
  ok('tail number from the aircraft database is searchable', (await page.locator('#find li').count()) === 1);
  await page.fill('#find-q', '737 max'); await page.waitForTimeout(300); const txt = await page.evaluate(() => [...document.querySelectorAll('#find li')].map((l) => l.innerText).join(' ')); ok('B350 is not a 737 MAX', !/Beech|BEECH/.test(txt) && true, txt.slice(0, 60));
  // aria
  await page.fill('#find-q', 'delta'); await page.waitForTimeout(300); await page.keyboard.press('ArrowDown');
  const aria = await page.evaluate(() => ({ ad: document.getElementById('find-q').getAttribute('aria-activedescendant'), sel: document.querySelector('#find li[aria-selected=true]') && document.querySelector('#find li[aria-selected=true]').id }));
  ok('search exposes the active result', aria.ad === aria.sel && !!aria.ad, JSON.stringify(aria));
  // 5. stale aircraft chosen
  await page.evaluate(() => { for (const p of window.__sky.planes.values()) if ((p.flight || '').startsWith('DAL')) p.tPos -= 200; });
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  ok('stale aircraft: no lock, search stays open', await page.evaluate(() => !window.__sky.shot.lock && !document.getElementById('find').hidden), await page.evaluate(() => document.getElementById('find-note').textContent.slice(0, 50)));
  await page.keyboard.press('Escape');
  // 6 short screen
  await page.setViewportSize({ width: 667, height: 375 }); await page.keyboard.press('/'); await page.waitForTimeout(400); await page.fill('#find-q', 'n'); await page.waitForTimeout(500);
  const box = await page.evaluate(() => { const f = document.getElementById('find').getBoundingClientRect(), u = document.getElementById('find-list'); return { bottom: f.bottom, vh: innerHeight, scrolls: u.scrollHeight > u.clientHeight }; });
  ok('short screen: search box fits and its list scrolls', box.bottom <= box.vh && box.scrolls, JSON.stringify(box)); await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1280, height: 720 });
  // 2. A while following
  const cs = await page.evaluate(() => { const p = [...window.__sky.planes.values()].find((q) => q.lat !== null && q.opacity > 0.5 && q.callsign() && !q.remote); window.__sky.setFollow(p.callsign()); return p.callsign(); });
  await page.waitForTimeout(8000); const k1 = await kind(); await page.keyboard.press('a'); await page.waitForTimeout(16000); const k2 = await kind();
  ok('A leaves a followed flight alone', k1 === 'follow' && k2 !== 'follow', `following ${cs}: ${k1} then ${k2}`);
  // after A pauses Follow, the tour keys work again (Codex review of 05b5935)
  await page.keyboard.press('n'); await page.waitForTimeout(500); const k3 = await kind();
  await page.keyboard.press('w'); await page.waitForTimeout(500); const k4 = await kind();
  ok('after A, N visits another aircraft and W pulls back', k3 === 'visit' && k4 === 'wide', `${k3} then ${k4}`);
  // Escape out of a held, locked aircraft resumes the tour (Codex review of 05b5935)
  await page.evaluate(() => { const s = window.__sky; s.setFollow(''); const p = [...s.planes.values()].find((q) => q.lat !== null && q.opacity > 0.5); s.lockOn(p); });
  await page.waitForTimeout(300); await page.keyboard.press(' '); const held1 = await page.evaluate(() => window.__sky.paused);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const after2 = await page.evaluate(() => ({ paused: window.__sky.paused, kind: window.__sky.shot.kind }));
  ok('Escape from a held aircraft clears the hold', held1 && !after2.paused && after2.kind === 'wide', JSON.stringify(after2));
  // the same after fly mode
  await page.keyboard.press('f'); await page.waitForTimeout(200); await page.keyboard.press(' '); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('Escape from fly mode clears the hold', await page.evaluate(() => !window.__sky.paused && window.__sky.shot.kind === 'wide'));
  // a new Follow takes the camera from a locked aircraft (Codex review of 4b6cb9d)
  const two = await page.evaluate(() => { const s = window.__sky; const ps = [...s.planes.values()].filter((q) => q.lat !== null && q.opacity > 0.5 && q.callsign() && !q.remote); s.lockOn(ps[0]); s.setFollow(ps[1].callsign()); return [ps[0].callsign(), ps[1].callsign(), s.shot.lock]; });
  await page.waitForTimeout(16000);
  const k5 = await page.evaluate(() => ({ kind: window.__sky.shot.kind, lock: window.__sky.shot.lock, plane: window.__sky.shot.plane && window.__sky.shot.plane.callsign() }));
  ok('a new Follow releases a locked aircraft', !two[2] && k5.kind === 'follow' && k5.plane === two[1], JSON.stringify({ two, k5 }));
  await page.evaluate(() => window.__sky.setFollow(''));
  // while following, a click then N or W must not leave the followed flight without its caption (Codex review of 4a15953)
  await page.waitForTimeout(2000);
  const cap = await page.evaluate(() => { const s = window.__sky; const ps = [...s.planes.values()].filter((q) => q.lat !== null && q.opacity > 0.5 && q.callsign() && !q.remote); s.setFollow(ps[0].callsign()); return [ps[0].callsign(), ps[1].callsign()]; });
  await page.waitForTimeout(16000);
  for (const key of ['n', 'w']) {
    await page.evaluate((cs) => { const s = window.__sky; const p = [...s.planes.values()].find((q) => q.callsign() === cs); const v = p.pos.clone().project(s.camera); s.clickAt((v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight); }, cap[1]);
    await page.waitForTimeout(300); await page.keyboard.press(key); await page.waitForTimeout(800);
    const c = await page.evaluate(() => ({ kind: window.__sky.shot.kind, clicked: !!window.__sky.clicked, flight: document.getElementById('c-flight').textContent }));
    ok('following: click then ' + key.toUpperCase() + ' puts the followed caption back', c.kind === 'follow' && !c.clicked && c.flight.replace(/\s/g, '').indexOf(cap[0].slice(3)) !== -1, JSON.stringify(c));
  }
  await page.evaluate(() => window.__sky.setFollow(''));
  // ---------- version 3.7: the watch list ----------
  // N2RF is on the list from the start here (the receiver's own screen), and the stand-in network has it over Pennsylvania
  const sim = (p) => page.evaluate((u) => fetch(u).then((r) => r.json()), 'http://localhost:8090' + p);
  await page.waitForFunction(() => !!document.querySelector('#watch .w-row[data-key="N2RF"]'), null, { timeout: 30000 }).catch(() => {});
  const w1 = await page.evaluate(() => ({ list: window.__sky.S.watch, row: (document.querySelector('#watch .w-row[data-key="N2RF"] span') || {}).textContent || '', title: document.title }));
  ok('watch list starts with N2RF and alerts when the networks see it', w1.list[0] === 'N2RF' && /^N2RF is in the air: .*41,000 feet/.test(w1.row) && /N2RF/.test(w1.title), JSON.stringify(w1));
  const asked0 = (await sim('/ctl/regasked')).asked; await page.waitForTimeout(12000); const asked1 = (await sim('/ctl/regasked')).asked;
  ok('an aircraft seen in the last 30 seconds is not asked about again', asked1 === asked0, `${asked0} then ${asked1}`);
  await page.click('#watch .w-row[data-key="N2RF"] button.quiet'); await page.waitForTimeout(300);
  ok('Dismiss removes the alert and puts the title back', await page.evaluate(() => !document.querySelector('#watch .w-row') && document.getElementById('watch').hidden && document.title === '3D sky'));
  await page.evaluate(() => { const s = window.__sky; s.watchState.get('N2RF').seenAt -= 40; s.watch.next = 0; return s.watchTick(); }); await page.waitForTimeout(500);
  ok('no second alert while the aircraft stays in sight', await page.evaluate(() => !document.querySelector('#watch .w-row')));
  // gone for 20 minutes, then back: a new alert, and Follow on it follows the aircraft
  await page.evaluate(() => { const s = window.__sky, st = s.watchState.get('N2RF'); st.seenAt -= 1300; return s.watchTick().then(() => { st.seenAt = -1e9; s.watch.next = 0; return s.watchTick(); }); }); await page.waitForTimeout(500);
  const back = await page.evaluate(() => !!document.querySelector('#watch .w-row[data-key="N2RF"]'));
  await page.click('#watch .w-row[data-key="N2RF"] button:not(.quiet)').catch(() => {}); await page.waitForTimeout(300);
  ok('back after 20 minutes out of sight: a new alert, and Follow follows it', back && await page.evaluate(() => window.__sky.follow.want === 'N2RF' && !document.querySelector('#watch .w-row')));
  await page.evaluate(() => window.__sky.setFollow(''));
  // an aircraft whose tail number comes only from the aircraft table (not its own report): the watch list finds it, and Follow on the alert follows that same aircraft
  const dbw = await page.evaluate(async () => {
    const s = window.__sky, t = performance.now() / 1000; const p = [...s.planes.values()].find((q) => q.fresh(t) && q.src === 'ant' && !q.remote && /^[A-Z]{3}\d/.test(q.callsign()) && q.opacity > 0.5);
    if (!p) return null; p.info = Object.assign({}, p.info || {}, { reg: 'N7DB' }); s.S.watch = ['N7DB']; await s.watchTick();
    const row = document.querySelector('#watch .w-row[data-key="N7DB"] button:not(.quiet)'); if (row) row.click(); await new Promise((r) => setTimeout(r, 50));
    const m = s.matchFollow(); const out = { hex: p.hex, alerted: !!row, want: s.follow.want, matched: m && m.hex }; s.setFollow(''); s.S.watch = ['N2RF']; s.watchState.delete('N7DB'); return out;
  });
  ok('a tail number known only from the aircraft table: the watch list alerts and Follow finds that aircraft', dbw && dbw.alerted && dbw.want === 'N7DB' && dbw.matched === dbw.hex, JSON.stringify(dbw));
  // a dashed tail number that starts with a digit, from a watch alert found only through the networks: Follow asks by registration with the dash and finds it
  const mt = await page.evaluate(async () => { const s = window.__sky; s.setFollow('9H-ABC'); s.follow.lastRemote = -1e9; await s.followTick(); await s.followTick(); const out = { want: s.follow.want, reg: s.follow.reg, saved: s.S.follow, state: s.follow.state, hex: s.follow.hex }; s.setFollow(''); return out; });
  ok('Follow on a tail number like 9H-ABC asks by registration and follows that aircraft', mt.reg === '9H-ABC' && mt.saved === '9H-ABC' && mt.state === 'on' && mt.hex === '4d2001', JSON.stringify(mt));
  // add an aircraft the antenna is hearing, through the settings: the alert comes from the page's own aircraft, with no network question
  const local = await page.evaluate(() => { const p = [...window.__sky.planes.values()].find((q) => q.fresh(performance.now() / 1000) && q.src === 'ant' && !q.remote && /^[A-Z]{3}\d/.test(q.callsign()) && q.opacity > 0.5); return p && p.callsign(); });
  const asked2 = (await sim('/ctl/regasked')).asked;
  await page.keyboard.press('s'); await page.waitForTimeout(400); await page.fill('#f-wadd', local.toLowerCase()); await page.press('#f-wadd', 'Enter'); await page.waitForTimeout(1500);
  const w2 = await page.evaluate((cs) => ({ list: window.__sky.S.watch, row: (document.querySelector('#watch .w-row[data-key="' + cs + '"] span') || {}).textContent || '', status: [...document.querySelectorAll('#watchlist small')].map((x) => x.textContent) }), local);
  ok('adding a flight the antenna hears alerts at once, marked as heard by the antenna', w2.list.includes(local) && /heard by your antenna/.test(w2.row) && w2.status.some((x) => /^Seen now/.test(x)) && (await sim('/ctl/regasked')).asked === asked2, JSON.stringify(w2).slice(0, 200));
  await page.fill('#f-wadd', local); await page.press('#f-wadd', 'Enter'); await page.waitForTimeout(200);
  ok('the same aircraft is not added twice', await page.evaluate((cs) => window.__sky.S.watch.filter((k) => k === cs).length === 1 && /already on the list/.test(document.getElementById('watch-note').textContent), local));
  await page.click('#watchlist .place[data-key="' + local + '"] button'); await page.waitForTimeout(300);
  ok('Remove takes it off the list and clears its alert', await page.evaluate((cs) => !window.__sky.S.watch.includes(cs) && !document.querySelector('#watch .w-row[data-key="' + cs + '"]'), local));
  const lim = await page.evaluate(() => { const s = window.__sky; s.S.watch = ['N2RF']; for (let i = 0; i < 12; i++) { document.getElementById('f-wadd').value = 'N' + (100 + i) + 'AB'; s.addWatch(); } return { n: s.S.watch.length, note: document.getElementById('watch-note').textContent }; });
  ok('the list holds at most 10 aircraft', lim.n === 10 && /limit of 10/.test(lim.note), JSON.stringify(lim));
  await page.evaluate(() => { window.__sky.S.watch = ['N2RF']; }); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // ---------- version 3.7: finding a typed place ----------
  const placeAsked = async () => (await sim('/ctl/placeasked')).asked;
  await page.keyboard.press('s'); await page.waitForTimeout(400);
  const q0 = await placeAsked(); await page.fill('#f-lookq', 'Fairfield CT'); await page.waitForTimeout(800);
  ok('typing alone sends nothing to the place finder', (await placeAsked()) === q0 && !(await page.locator('#look-list .place').count()));
  await page.press('#f-lookq', 'Enter'); await page.waitForTimeout(800);
  const look = await page.evaluate(() => ({ n: document.querySelectorAll('#look-list .place').length, imgs: document.querySelectorAll('#look-list img').length, text: document.getElementById('look-list').textContent }));
  ok('Enter looks the place up once and shows the answers as plain text', (await placeAsked()) === q0 + 1 && look.n === 3 && look.imgs === 0 && /<img src=x/.test(look.text), JSON.stringify(look).slice(0, 160));
  await page.fill('#f-lookq', 'fairfield  ct'); await page.press('#f-lookq', 'Enter'); await page.waitForTimeout(500);
  ok('the same words again are answered from what this page kept', (await placeAsked()) === q0 + 1 && (await page.locator('#look-list .place').count()) === 3);
  await page.click('#look-list .place button'); await page.waitForTimeout(800);
  const went = await page.evaluate(() => { const s = window.__sky.S, i = +String(s.center).slice(1); return { center: s.center, place: s.places[i], list: document.querySelectorAll('#look-list .place').length }; });
  ok('Go there adds the place to My places and centers the sky on it', /^P\d+$/.test(went.center) && went.place && went.place.n === 'Fairfield' && Math.abs(went.place.lat - 41.1414) < 1e-4 && went.list === 0, JSON.stringify(went));
  await page.fill('#f-lookq', 'jfk'); await page.press('#f-lookq', 'Enter'); await page.waitForTimeout(400);
  ok('an airport code is found on the page, with no outside question', (await placeAsked()) === q0 + 1 && /Kennedy/.test(await page.evaluate(() => document.getElementById('look-list').textContent)));
  await page.click('#look-list .place button'); await page.waitForTimeout(500);
  ok('Go there on an airport centers the sky on it', await page.evaluate(() => window.__sky.S.center === 'KJFK'));
  await page.fill('#f-lookq', 'zzzz nowhere'); await page.press('#f-lookq', 'Enter'); await page.waitForTimeout(600);
  ok('nothing found says so', /Nothing found/.test(await page.evaluate(() => document.getElementById('look-note').textContent)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // ---------- version 3.7.1: My places are kept, also with the page open twice ----------
  // a second copy of the page in the same browser adds a place; the first copy then changes a setting, which used to save its old list over it
  const tab2 = await page.context().newPage(); tab2.on('pageerror', (e) => errs.push('PAGEERROR (second copy): ' + e.message));
  await tab2.goto(PAGE); await tab2.waitForTimeout(4000);
  await tab2.keyboard.press('s'); await tab2.waitForTimeout(400); await tab2.fill('#f-pname', 'My House'); await tab2.fill('#f-pll', '40.6892, -74.0445'); await tab2.click('#f-places button[type=submit]'); await tab2.waitForTimeout(400); await tab2.keyboard.press('Escape');
  await page.bringToFront(); await page.waitForTimeout(500);
  const first = await page.evaluate(() => ({ places: window.__sky.S.places.map((p) => p.n), shown: [...document.querySelectorAll('#places .place span')].map((x) => x.firstChild.textContent) }));
  ok('a place added in another copy of the page shows up in this one', first.places.includes('My House') && first.places.includes('Fairfield') && first.shown.includes('My House'), JSON.stringify(first));
  await page.keyboard.press('c'); await page.waitForTimeout(200); await page.keyboard.press('c'); await page.waitForTimeout(300);
  await tab2.reload(); await tab2.waitForTimeout(4000);
  const kept = await tab2.evaluate(() => ({ keep: window.__sky.S.keep, places: window.__sky.S.places.map((p) => p.n), stored: (JSON.parse(localStorage.getItem('sky3d') || '{}').places || []).map((p) => p.n), ticked: document.getElementById('f-keep').checked }));
  ok('My places are still there after the page is opened again, here at the receiver\'s own address', kept.keep === true && kept.ticked && kept.places.includes('My House') && kept.places.includes('Fairfield') && kept.stored.includes('My House'), JSON.stringify(kept));
  // removing a watched aircraft in the other copy clears its alert here too, so adding it back alerts again
  const wsync = await page.evaluate(async () => { const s = window.__sky; s.S.watch = ['N2RF', 'N7XX']; s.watchState.set('N7XX', { seenAt: performance.now() / 1000, where: null, asked: 0, netOk: true, alerted: true }); s.dismissWatch('N7XX'); return true; });
  await tab2.evaluate(() => { const o = JSON.parse(localStorage.getItem('sky3d')); o.watch = ['N2RF']; localStorage.setItem('sky3d', JSON.stringify(o)); });
  await page.waitForTimeout(400);
  const wafter = await page.evaluate(() => ({ list: window.__sky.S.watch, state: window.__sky.watchState.has('N7XX'), row: !!document.querySelector('#watch .w-row[data-key="N7XX"]') }));
  ok('a watched aircraft removed in another copy is cleared here too', wsync && wafter.list.join() === 'N2RF' && !wafter.state && !wafter.row, JSON.stringify(wafter));
  await tab2.close();
  // ---------- version 3.7.1: P opens My places ----------
  await page.bringToFront(); await page.keyboard.press('p'); await page.waitForTimeout(300);
  const mine = await page.evaluate(() => ({ open: !document.getElementById('mine').hidden, names: [...document.querySelectorAll('#mine-list button')].map((b) => b.textContent), help: [...document.querySelectorAll('#help-dl dt')].some((d) => d.textContent === 'P') }));
  ok('P opens a window with just my places, and the help lists P', mine.open && mine.names.length === 2 && mine.names.some((n) => /^Fairfield/.test(n)) && mine.names.some((n) => /^My House/.test(n)) && mine.help, JSON.stringify(mine));
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(400); await page.keyboard.up('ArrowUp');
  ok('with My places open, the arrow keys do not steer', await page.evaluate(() => window.__sky.shot.kind !== 'fly' && !window.__sky.held.size));
  await page.click('#mine-list button:has-text("My House")'); await page.waitForTimeout(600);
  const moved = await page.evaluate(() => { const s = window.__sky.S, i = /^P\d+$/.test(s.center) ? +s.center.slice(1) : -1; return { closed: document.getElementById('mine').hidden, center: s.center, name: i >= 0 && s.places[i].n, picked: document.getElementById('f-center').value }; });
  ok('one click on a place closes the window and moves the sky there', moved.closed && moved.name === 'My House' && moved.picked === moved.center, JSON.stringify(moved));
  await page.keyboard.press('p'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const esc = await page.evaluate(() => document.getElementById('mine').hidden);
  await page.keyboard.press('p'); await page.waitForTimeout(200); await page.keyboard.press('p'); await page.waitForTimeout(200);
  ok('Escape closes My places, and so does P again', esc && await page.evaluate(() => document.getElementById('mine').hidden));
  // My places open while another copy removes a place: the window shows the new list, and each button still goes to the place it names
  const synced = await page.evaluate(async () => {
    const s = window.__sky, wait = (ms) => new Promise((r) => setTimeout(r, ms)); s.openMine(); await wait(200);
    const before = [...document.querySelectorAll('#mine-list button')].map((b) => b.textContent);
    const o = JSON.parse(localStorage.getItem('sky3d')); const left = o.places.filter((p) => p.n !== 'Fairfield');
    window.dispatchEvent(new StorageEvent('storage', { key: 'sky3d', newValue: JSON.stringify(Object.assign({}, o, { places: left })) }));
    await wait(200);
    const after = [...document.querySelectorAll('#mine-list button')].map((b) => b.textContent);
    const btn = [...document.querySelectorAll('#mine-list button')].find((b) => /^My House/.test(b.textContent)); if (btn) btn.click(); await wait(300);
    const i = /^P\d+$/.test(s.S.center) ? +s.S.center.slice(1) : -1;
    return { before, after, went: i >= 0 && s.S.places[i] && s.S.places[i].n, closed: document.getElementById('mine').hidden };
  });
  ok('My places open while another copy removes a place shows the new list, and its buttons still go where they say', synced.before.length === 2 && synced.after.length === 1 && synced.went === 'My House' && synced.closed, JSON.stringify(synced));
  // ---------- version 3.7.1: where a flight comes from ----------
  // a flight number with a stop on the way: low and coming down at New York, the caption shows the leg from Los Angeles, not Los Angeles to Boston
  const legs = await page.evaluate(() => {
    const L = window.__sky.routeLeg, ap = (c, lat, lon) => ({ icao: c, iata: c.slice(1), name: c, lat, lon });
    const rt = { _airports: [ap('KLAX', 33.94, -118.41), ap('KJFK', 40.64, -73.78), ap('KBOS', 42.36, -71.01)] };
    const at = (altFt, vrate, lat, lon) => ({ ground: false, altFt, vrate, rLat: lat, rLon: lon });
    const names = (l) => l ? l.map((a) => a.icao).join('-') : 'none';
    return { down: names(L(rt, at(1800, -900, 40.62, -73.85))), up: names(L(rt, at(2500, 1500, 40.66, -73.70))), high: names(L(rt, at(35000, 0, 40, -90))), lost: names(L(rt, at(2000, -800, 39.0, -77.0))), broken: names(L({ _airports: [null, ap('KJFK', 40.64, -73.78)] }, at(35000, 0, 40, -90))) };
  });
  ok('a flight with a stop shows the leg it is on, and a route nowhere near is not trusted', legs.down === 'KLAX-KJFK' && legs.up === 'KJFK-KBOS' && legs.high === 'KLAX-KBOS' && legs.lost === 'none' && legs.broken === 'none', JSON.stringify(legs));
  // the first route service does not know a flight: the second one is asked, so its origin can still be shown
  const rtab = await browser.newPage({ viewport: { width: 640, height: 360 } }); rtab.on('pageerror', (e) => errs.push('PAGEERROR (two route services): ' + e.message));
  await rtab.goto(PAGE.replace('routeApi=/mock/routeset', 'routeApi=/mock/routeset-none,/mock/routeset')); await rtab.waitForTimeout(5000);
  const asked = await rtab.evaluate(async () => {
    const s = window.__sky; await s.prefetchRoutes(); const pre = [...s.routes.values()].filter((c) => c.route).length;
    const p = [...s.planes.values()].find((q) => s.routes.get(q.callsign()) && s.routes.get(q.callsign()).route); s.routes.clear();
    const one = p ? await s.getRoute(p) : null; return { pre, one: !!(one && one._airports.length >= 2) };
  });
  ok('when the first route service does not know a flight, the second one is asked', asked.pre > 0 && asked.one, JSON.stringify(asked));
  await rtab.close();
  // ---------- version 3.7.1: moving the sky far away rises, fades and comes down instead of gliding across ----------
  await page.bringToFront();
  const jumped = await page.evaluate(async () => {
    const s = window.__sky, wait = (ms) => new Promise((r) => setTimeout(r, ms)), sky = document.getElementById('sky');
    s.S.center = 'KJFK'; s.applyCenter(); await wait(9000);
    s.S.center = 'KLAX'; s.applyCenter(); const jump = s.shot.jump, d0 = s.pose.dist, start = { lat: s.pose.lat, lon: s.pose.lon };
    let maxFade = 0, maxDist = 0, crossedSeen = false, early = false;
    for (let i = 0; i < 50; i++) {
      await wait(200); const f = +getComputedStyle(document.getElementById('jump')).opacity; maxFade = Math.max(maxFade, f); maxDist = Math.max(maxDist, s.pose.dist);
      const mid = Math.abs(s.pose.lat - start.lat) > 0.5 && Math.abs(s.pose.lat - 33.94) > 0.5;   // somewhere between New York and Los Angeles
      if (mid && f < 0.99) crossedSeen = true;
      if (maxFade < 0.99 && Math.abs(s.pose.lat - 33.94) < 0.6) early = true;   // at the new place before the view had faded
    }
    const end = { lat: s.pose.lat, fade: +getComputedStyle(document.getElementById('jump')).opacity };
    s.S.center = 'KLGA'; s.applyCenter(); const shortJump = s.shot.jump;
    return { jump, rose: maxDist > d0 * 2, maxFade, crossedSeen, early, arrived: Math.abs(end.lat - 33.94) < 0.6, clear: end.fade === 0, shortJump, sky: !!sky };
  });
  ok('moving the sky far away rises, fades while crossing, and comes down at the new place', jumped.jump && jumped.rose && jumped.maxFade >= 0.99 && !jumped.crossedSeen && !jumped.early && jumped.arrived && jumped.clear, JSON.stringify(jumped));
  ok('a short move still glides without a fade', jumped.shortJump === false, JSON.stringify(jumped));
  // ---------- version 3.8: satellite photos on the ground ----------
  // off by default: no photo is asked for and no credit line shows
  const satPage = await browser.newPage({ viewport: { width: 960, height: 540 } }); satPage.on('pageerror', (e) => errs.push('PAGEERROR (satellite): ' + e.message));
  await satPage.goto(PAGE + '&satApi=/mock/sat/{z}/{y}/{x}.png'); await satPage.waitForTimeout(4000);
  const satOff = await satPage.evaluate(() => ({ on: window.__sky.S.sat, asked: window.__sky.sat.asked, credit: !document.getElementById('satcredit').hidden }));
  ok('satellite photos are off to start, and nothing is asked for', satOff.on === false && satOff.asked === 0 && !satOff.credit, JSON.stringify(satOff));
  await satPage.keyboard.press('s'); await satPage.waitForTimeout(400); await satPage.click('#f-sat'); await satPage.keyboard.press('Escape'); await satPage.waitForTimeout(5000);
  const satOn = await satPage.evaluate(() => { const s = window.__sky; return { on: s.S.sat, saved: JSON.parse(localStorage.getItem('sky3d') || '{}').sat, loaded: s.sat.loaded, shown: s.sat.shown(), cached: s.sat.cache.size, credit: !document.getElementById('satcredit').hidden, link: document.querySelector('#satcredit a').href }; });
  ok('switched on, photos load around the view and the credit line shows', satOn.on && satOn.saved === true && satOn.loaded > 10 && satOn.shown > 10 && satOn.cached <= 140 && satOn.credit && /cloudless\.eox\.at/.test(satOn.link), JSON.stringify(satOn));
  // zooming out over the same spot widens the set of photos wanted
  const widen = await satPage.evaluate(() => { const g = window.__sky.sat, t = performance.now() / 1000; g.update(40.7, -73.83, 100, t); const a = g.want.size; g.update(40.7, -73.83, 150, t); return { a, b: g.want.size }; });
  ok('zooming out over the same spot asks for the wider ring of photos', widen.b > widen.a, JSON.stringify(widen));
  // moving the sky far away fetches photos for the new place too
  const satMoved = await satPage.evaluate(async () => { const s = window.__sky, before = s.sat.loaded; s.S.center = 'KBOS'; s.applyCenter(); await new Promise((r) => setTimeout(r, 11000)); return { more: s.sat.loaded - before, shown: s.sat.shown(), cached: s.sat.cache.size }; });
  ok('after moving to another place, photos load there, and old ones are let go', satMoved.more > 0 && satMoved.shown > 10 && satMoved.cached <= 140, JSON.stringify(satMoved));
  await satPage.keyboard.press('s'); await satPage.waitForTimeout(400); await satPage.click('#f-sat'); await satPage.keyboard.press('Escape'); await satPage.waitForTimeout(800);
  const satOff2 = await satPage.evaluate(() => ({ on: window.__sky.S.sat, visible: window.__sky.sat.group.visible, credit: !document.getElementById('satcredit').hidden }));
  ok('switched off again, the photos and the credit line go away', !satOff2.on && !satOff2.visible && !satOff2.credit, JSON.stringify(satOff2));
  await satPage.close();
  // a photo service that does not answer: the drawn map stays, the page says so, and it stops asking for a while
  const satBad = await browser.newPage({ viewport: { width: 960, height: 540 } }); satBad.on('pageerror', (e) => errs.push('PAGEERROR (satellite down): ' + e.message));
  await satBad.goto(PAGE + '&sat=1&satApi=/mock/satfail/{z}/{y}/{x}.png'); await satBad.waitForTimeout(7000);
  const down = await satBad.evaluate(() => { const s = window.__sky; return { down: s.sat.down, failed: s.sat.failed, asked: s.sat.asked, land: s.ground.land.geometry.index ? s.ground.land.geometry.index.count : 0, landShown: s.ground.land.visible, note: document.getElementById('sat-note').textContent }; });
  await satBad.waitForTimeout(3000);
  const later = await satBad.evaluate(() => window.__sky.sat.asked);
  // five minutes on, it tries again without the view having to move (the wait is cut short here)
  const retried = await satBad.evaluate(async () => { const g = window.__sky.sat, before = g.asked; g.downUntil = 0; await new Promise((r) => setTimeout(r, 2000)); return g.asked > before; });
  ok('after the pause, the page asks the photo service again on its own', retried);
  ok('when the photo service does not answer, the drawn map stays and the page stops asking', down.down && down.failed >= 12 && down.land > 0 && down.landShown && /not loading/.test(down.note) && later === down.asked, JSON.stringify(Object.assign(down, { later })));
  await satBad.close();
  console.log('errors:', errs.join(' ; ') || 'none');
  await browser.close();
})();
