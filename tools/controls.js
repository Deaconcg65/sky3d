// Drives the version 3.6 controls and the version 3.7 watch list in Chromium against tools/sim.js: fly heading, key ownership, search,
// click and follow behavior, watch list alerts.
// usage: node tools/sim.js 8090 (in another window), then node tools/controls.js. Prints PASS or FAIL per check.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  // one browser context for the main page, so a second copy of the page can be opened beside it with the same saved settings
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage(); const errs = [];
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
  // ---------- version 3.7.1: My places takes an address, and the notes follow Keep my places ----------
  const q1 = await placeAsked(), n1 = await page.evaluate(() => window.__sky.S.places.length);
  await page.fill('#f-pname', 'Home'); await page.fill('#f-pll', 'Sunset Hill Rd, Redding, CT'); await page.click('#f-places button[type=submit]'); await page.waitForTimeout(800);
  const addr = await page.evaluate(() => ({ rows: document.querySelectorAll('#pll-list .place').length, adds: [...document.querySelectorAll('#pll-list button')].map((b) => b.textContent), note: document.getElementById('places-note').textContent, n: window.__sky.S.places.length }));
  ok('an address in the second My places box is looked up and the answers are listed to pick from', (await placeAsked()) === q1 + 1 && addr.rows === 3 && addr.adds.every((t) => t === 'Add') && /as Home/.test(addr.note) && addr.n === n1, JSON.stringify(addr));
  const q2 = await placeAsked(); await page.fill('#f-pll', '12 Route 7, Redding, CT'); await page.click('#f-places button[type=submit]'); await page.waitForTimeout(600);
  const num = await page.evaluate(() => ({ rows: document.querySelectorAll('#pll-list .place').length, n: window.__sky.S.places.length }));
  ok('an address with two numbers in it is looked up, not read as a latitude and longitude', (await placeAsked()) === q2 + 1 && num.rows === 3 && num.n === n1, JSON.stringify(num));
  await page.click('#pll-list .place:nth-child(2) button'); await page.waitForTimeout(400);
  const home = await page.evaluate(() => { const s = window.__sky.S, pl = s.places.find((x) => x.n === 'Home'); return { pl, rows: document.querySelectorAll('#pll-list .place').length, name: document.getElementById('f-pname').value, where: document.getElementById('f-pll').value, note: document.getElementById('places-note').textContent }; });
  ok('Add puts the picked answer in My places under the typed name', home.pl && Math.abs(home.pl.lat - 38.2494) < 1e-4 && home.rows === 0 && !home.name && !home.where && /^Home added\. It is kept on this device only\.$/.test(home.note), JSON.stringify(home));
  await page.fill('#f-pname', 'Fairfield CT'); await page.fill('#f-pll', ''); await page.click('#f-places button[type=submit]'); await page.waitForTimeout(500);
  await page.click('#pll-list .place:nth-child(1) button'); await page.waitForTimeout(300);
  const twice = await page.evaluate(() => ({ note: document.getElementById('places-note').textContent, n: window.__sky.S.places.filter((x) => Math.abs(x.lat - 41.1414) < 1e-3).length }));
  ok('an address typed in the name box alone is looked up too, and a place already in the list is not added twice', /already in My places as Fairfield/.test(twice.note) && twice.n === 1, JSON.stringify(twice));
  await page.fill('#f-pname', ''); await page.fill('#f-lookq', 'fairfield ct'); await page.press('#f-lookq', 'Enter'); await page.waitForTimeout(500);
  await page.click('#look-list .place:nth-child(3) button'); await page.waitForTimeout(400);
  const kn = [await page.evaluate(() => document.getElementById('look-note').textContent)];
  await page.click('#f-keep'); await page.waitForTimeout(200); kn.push(await page.evaluate(() => document.getElementById('look-note').textContent));
  await page.click('#f-keep'); await page.waitForTimeout(200); kn.push(await page.evaluate(() => ({ note: document.getElementById('look-note').textContent, keep: window.__sky.S.keep, ticked: document.getElementById('f-keep').checked })));
  ok('the note under Find a place changes when Keep my places is unticked and ticked again', /kept on this device only\.$/.test(kn[0]) && /until you close this page\.$/.test(kn[1]) && /kept on this device only\.$/.test(kn[2].note) && kn[2].keep === true && kn[2].ticked, JSON.stringify(kn));
  for (let k = 0; k < 2; k++) { await page.evaluate(() => { const b = [...document.querySelectorAll('#places button')].find((x) => /^Remove (Home|<img)/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); }); await page.waitForTimeout(300); }   // one at a time: the list is drawn again after each Remove
  ok('the places added for these checks are removed again', await page.evaluate((n) => window.__sky.S.places.length === n, n1));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // ---------- version 3.7.1: My places are kept, also with the page open twice ----------
  // a second copy of the page in the same browser adds a place; the first copy then changes a setting, which used to save its old list over it
  const tab2 = await ctx.newPage(); tab2.on('pageerror', (e) => errs.push('PAGEERROR (second copy): ' + e.message));
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
  const wsync = await page.evaluate(async () => { const s = window.__sky; s.S.watch = ['N2RF', 'N7XX']; s.watchState.set('N7XX', { seenAt: performance.now() / 1000, where: null, asked: 0, netOk: true, alerted: true }); s.dismissWatch('N7XX'); const o = JSON.parse(localStorage.getItem('sky3d') || '{}'); o.watch = ['N2RF', 'N7XX']; localStorage.setItem('sky3d', JSON.stringify(o)); return true; });   // stored too, so the other copy's write below is a real change and the browser tells this copy
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
  // the Search button stays on screen; pressing it with My places open swaps one window for the other
  await page.keyboard.press('p'); await page.waitForTimeout(200); await page.evaluate(() => document.getElementById('findbtn').click()); await page.waitForTimeout(300);
  const swap = await page.evaluate(() => ({ mine: !document.getElementById('mine').hidden, find: !document.getElementById('find').hidden, typing: document.activeElement === document.getElementById('find-q') }));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok('Search with My places open closes My places and opens search, ready to type', !swap.mine && swap.find && swap.typing, JSON.stringify(swap));
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
  // version 3.11: one flight number out and back (RPA 4555 flies LGA to XNA and back): never the same airport at both ends
  const loops = await page.evaluate(() => {
    const L = window.__sky.routeLeg, ap = (c, lat, lon) => ({ icao: c, iata: c.slice(1), name: c, lat, lon });
    const rt = { _airports: [ap('KLGA', 40.78, -73.87), ap('KXNA', 36.28, -94.31), ap('KLGA', 40.78, -73.87)] };
    const at = (altFt, vrate, lat, lon, track) => ({ ground: false, altFt, vrate, rLat: lat, rLon: lon, track });
    const names = (l) => l ? l.map((a) => a.icao).join('-') : 'none';
    return { out: names(L(rt, at(12075, 1500, 40.4, -75.5, 250))), back: names(L(rt, at(30000, 0, 38.5, -85, 70))), sideways: names(L(rt, at(30000, 0, 38.5, -85, 160))), climbing: names(L(rt, at(2500, 1500, 40.75, -73.95, 300))), landing: names(L(rt, at(2000, -900, 40.72, -73.80, 40))),
      same: names(L({ _airports: [ap('KLGA', 40.78, -73.87), ap('KLGA', 40.78, -73.87)] }, at(12075, 1500, 40.9, -73.5, 60))) };
  });
  ok('a flight number that flies out and back shows the leg the aircraft is on, and never the same airport at both ends', loops.out === 'KLGA-KXNA' && loops.back === 'KXNA-KLGA' && loops.sideways === 'none' && loops.climbing === 'KLGA-KXNA' && loops.landing === 'KXNA-KLGA' && loops.same === 'none', JSON.stringify(loops));
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
    // Kennedy to LaGuardia is about 17 km: a new wide shot starts, with no jump and no fade at any point
    const shotBefore = s.shot; s.S.center = 'KLGA'; s.applyCenter();
    const short = { started: s.shot !== shotBefore, kind: s.shot.kind, jump: s.shot.jump, maxFade: 0 };
    for (let i = 0; i < 40; i++) { await wait(200); short.maxFade = Math.max(short.maxFade, +getComputedStyle(document.getElementById('jump')).opacity); }
    s.S.center = 'KLAX'; s.applyCenter(); const jump = s.shot.jump, d0 = s.pose.dist, start = { lat: s.pose.lat, lon: s.pose.lon };
    let maxFade = 0, maxDist = 0, crossedSeen = false, early = false;
    for (let i = 0; i < 50; i++) {
      await wait(200); const f = +getComputedStyle(document.getElementById('jump')).opacity; maxFade = Math.max(maxFade, f); maxDist = Math.max(maxDist, s.pose.dist);
      const mid = Math.abs(s.pose.lat - start.lat) > 0.5 && Math.abs(s.pose.lat - 33.94) > 0.5;   // somewhere between New York and Los Angeles
      if (mid && f < 0.99) crossedSeen = true;
      if (maxFade < 0.99 && Math.abs(s.pose.lat - 33.94) < 0.6) early = true;   // at the new place before the view had faded
    }
    const end = { lat: s.pose.lat, fade: +getComputedStyle(document.getElementById('jump')).opacity };
    return { jump, rose: maxDist > d0 * 2, maxFade, crossedSeen, early, arrived: Math.abs(end.lat - 33.94) < 0.6, clear: end.fade === 0, short, sky: !!sky };
  });
  { const far = Object.assign({}, jumped); delete far.short; ok('moving the sky far away rises, fades while crossing, and comes down at the new place', far.jump && far.rose && far.maxFade >= 0.99 && !far.crossedSeen && !far.early && far.arrived && far.clear, JSON.stringify(far)); }
  ok('a short move still glides without a fade', jumped.short.started && jumped.short.kind === 'wide' && jumped.short.jump === false && jumped.short.maxFade === 0, JSON.stringify(jumped.short));
  // ---------- version 3.8.1: the shape picker reads whole type codes, not just their start ----------
  const shapes = await page.evaluate(() => { const f = window.__sky.modelFor, out = {};
    for (const [cat, t] of [['A1', 'C172'], ['', 'C172'], ['', 'C177'], ['', 'C17'], ['', 'H25B'], ['', 'H60'], ['', 'H500'], ['', 'A318'], ['', 'A319'], ['', 'A310'], ['', 'B744'], ['', 'A388'], ['A7', '']]) out[cat + ':' + t] = f(cat, t);
    return out; });
  ok('a Cessna 172 or 177 is drawn as a small plane, the C-17 as a four-engine jet, and the 747 and A380 each as their own shape', shapes['A1:C172'] === 'light' && shapes[':C172'] === 'light' && shapes[':C177'] === 'light' && shapes[':C17'] === 'heavy' && shapes[':B744'] === 'b747' && shapes[':A388'] === 'a380', JSON.stringify(shapes));
  ok('a Hawker H25B is drawn as a business jet, while H60, H500 and category A7 stay helicopters', shapes[':H25B'] === 'biz' && shapes[':H60'] === 'heli' && shapes[':H500'] === 'heli' && shapes['A7:'] === 'heli', JSON.stringify(shapes));
  ok('the A318 and A319 are drawn as narrow bodies and the A310 as a wide body', shapes[':A318'] === 'jet' && shapes[':A319'] === 'jet' && shapes[':A310'] === 'heavy2', JSON.stringify(shapes));
  // ---------- version 3.8.1: the keyboard comes back to the sky, and the fly keys show while flying ----------
  const keyState = () => page.evaluate(() => ({ panel: document.body.classList.contains('panel'), mine: !document.getElementById('mine').hidden, kind: window.__sky.shot.kind, focus: document.activeElement.tagName, keys: document.getElementById('flykeys').classList.contains('on') }));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.keyboard.press('s'); await page.waitForTimeout(400); await page.click('#f-cap'); await page.click('#f-cap');
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(600);
  const fk1 = await keyState();
  ok('after ticking a setting, an arrow key closes the settings and takes the controls', !fk1.panel && fk1.kind === 'fly' && fk1.focus === 'BODY', JSON.stringify(fk1));
  ok('in fly mode the fly keys show in the corner', fk1.keys, JSON.stringify(fk1));
  await page.waitForTimeout(7500);
  const fk2 = await keyState();
  ok('the fly keys stay while the keys are in use, not only the first seven seconds', fk2.kind === 'fly' && fk2.keys, JSON.stringify(fk2));
  // version 3.11: the box fades 12 seconds after the last key, though fly mode goes on (Chris: it came up with the mouse and never went away)
  await page.waitForTimeout(5500);
  const fk2b = await keyState();
  ok('12 seconds after the last key the fly keys fade, while fly mode goes on', fk2b.kind === 'fly' && !fk2b.keys, JSON.stringify(fk2b));
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(400);
  const fk2c = await keyState();
  ok('the next fly key brings the fly keys back', fk2c.kind === 'fly' && fk2c.keys, JSON.stringify(fk2c));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  const fk3 = await keyState();
  ok('the fly keys go away when fly mode ends', fk3.kind !== 'fly' && !fk3.keys, JSON.stringify(fk3));
  // the mouse alone: a drag takes the controls without the key box, and the small scrolls a Magic Mouse or trackpad sends while the mouse moves do not take them at all
  await page.mouse.move(420, 330);
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 3); await page.mouse.move(420 + i * 4, 330 + i * 2); await page.waitForTimeout(100); }   // three seconds of touches: more than enough in all, never enough in one half second
  await page.waitForTimeout(400);
  const ms1 = await keyState();
  ok('small scroll touches while the mouse moves do not take the controls or bring up the fly keys', ms1.kind !== 'fly' && !ms1.keys, JSON.stringify(ms1));
  // this comes about four seconds after the last fly key of the time at the controls before, so it also shows that a new time starts with no key pressed
  await page.mouse.wheel(0, 120); await page.waitForTimeout(400);
  const ms2 = await keyState();
  ok('a real turn of the mouse wheel still zooms by taking the controls, without the fly keys, even just after a time at the controls that used keys', ms2.kind === 'fly' && !ms2.keys, JSON.stringify(ms2));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await page.mouse.move(400, 320); await page.mouse.down(); await page.mouse.move(470, 340, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
  const ms3 = await keyState();
  ok('a drag takes the controls without bringing up the fly keys', ms3.kind === 'fly' && !ms3.keys, JSON.stringify(ms3));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await page.keyboard.press('s'); await page.waitForTimeout(400); await page.focus('#f-cap'); await page.evaluate(() => document.body.classList.remove('panel'));
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(400);
  const fk4 = await keyState();
  ok('a setting still holding the keyboard after the settings closed no longer swallows the arrows', fk4.kind === 'fly' && fk4.focus === 'BODY', JSON.stringify(fk4));
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.keyboard.press('s'); await page.waitForTimeout(400); await page.click('#f-cap'); await page.click('#f-cap');
  await page.mouse.click(60, 200); await page.waitForTimeout(400);
  const fk5 = await keyState();
  ok('a click on the sky closes the settings and gives the keyboard back', !fk5.panel && fk5.focus === 'BODY', JSON.stringify(fk5));
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(400);
  ok('after that click the arrows take the controls', (await keyState()).kind === 'fly'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.keyboard.press('p'); await page.waitForTimeout(400); await page.mouse.click(60, 200); await page.waitForTimeout(400);
  const fk6 = await keyState();
  ok('a click on the sky closes My places and gives the keyboard back', !fk6.mine && fk6.focus === 'BODY', JSON.stringify(fk6));
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  // ---------- version 3.9: the camera has one owner at a time ----------
  const owners = await page.evaluate(() => {
    const s = window.__sky, out = [], ps = [...s.planes.values()].filter((q) => q.lat !== null && q.opacity > 0.5 && q.callsign() && !q.remote);
    const note = (step) => out.push(step + ':' + s.cameraOwner());
    s.setFollow(''); s.autoTour(); note('start');
    s.enterFly(); note('F'); s.lockOn(ps[0]); note('double click'); s.enterFly(); note('F again');
    s.setFollow(ps[1].callsign()); s.matchFollow(); s.follow.hex = s.matchFollow().hex; s.follow.state = 'on'; note('follow from fly');
    s.enterFly(); note('F while following'); s.leaveControls(); note('Escape while following');
    s.autoTour(); note('A while following'); s.setFollow(''); note('stop following');
    return out.join(' ');
  });
  ok('the camera has one owner at a time and each key hands it on as before', owners === 'start:tour F:fly double click:lock F again:fly follow from fly:follow F while following:fly Escape while following:follow A while following:tour stop following:tour', owners);
  // ---------- version 3.9: a click on an airport code centers the sky there ----------
  await page.evaluate(() => { const s = window.__sky; s.S.center = 'MID'; s.applyCenter(false); s.goWide(); });
  await page.waitForTimeout(9000);
  // a label on screen with no aircraft right under it. Aircraft keep landing beside the big airports, so a label that is busy now
  // is often clear a moment later: look again for up to 20 seconds before calling it missing, and say what was seen if none clears.
  let spot = null, seen = null;
  for (let tries = 0; tries < 20 && !spot; tries++) {
    if (tries) await page.waitForTimeout(1000);
    const r = await page.evaluate(() => {
      const s = window.__sky, cam = s.camera, w = innerWidth, h = innerHeight, n = { labels: 0, onScreen: 0, inBox: 0, hit: 0, busy: 0 }; cam.updateMatrixWorld();
      for (const l of s.labels) {
        if (!l.a) continue; n.labels++; const v = l.sprite.position.clone().project(cam); if (v.z > 1 || v.z < -1) continue; n.onScreen++;
        const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h - 0.9 * 0.021 * h;
        if (x < 40 || x > w - 420 || y < 40 || y > h - 80) continue; n.inBox++;
        if (s.airportLabelAt(x, y) !== l.a) continue; n.hit++;
        const busy = [...s.planes.values()].some((p) => { if (p.lat === null || p.opacity < 0.3) return false; const q = p.pos.clone().project(cam); return Math.hypot((q.x * 0.5 + 0.5) * w - x, (-q.y * 0.5 + 0.5) * h - y) < 24; });
        if (busy) { n.busy++; continue; }
        return { spot: { x, y, code: l.a[0] } };
      }
      return { n, kind: s.cameraOwner() };
    });
    if (r.spot) spot = r.spot; else seen = r;
  }
  if (!spot) ok('an airport code label is on screen to click', false, 'none found ' + JSON.stringify(seen));
  else {
    await page.mouse.click(spot.x, spot.y); await page.waitForTimeout(500);
    const after = await page.evaluate(() => { const s = window.__sky; return { center: s.S.center, other: s.S.other, clicked: !!s.clicked }; });
    ok('a click on an airport code label centers the sky on that airport', (after.center === spot.code || (after.center === 'OTHER' && after.other === spot.code)) && !after.clicked, JSON.stringify({ spot, after }));
  }
  // an aircraft right under the pointer still gets the click, even where a label is close by
  await page.waitForTimeout(8000);
  const planeFirst = await page.evaluate(() => {
    const s = window.__sky, cam = s.camera, w = innerWidth, h = innerHeight, before = s.S.center + ':' + s.S.other; cam.updateMatrixWorld();
    const p = [...s.planes.values()].find((q) => { if (q.lat === null || q.opacity < 0.5 || !q.fresh(performance.now() / 1000)) return false; const v = q.pos.clone().project(cam); return v.z < 1 && v.z > -1 && Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.8; });
    if (!p) return { none: true };
    const v = p.pos.clone().project(cam); s.clickAt((v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h);
    return { got: s.clicked === p, same: before === s.S.center + ':' + s.S.other };
  });
  ok('a click right on an aircraft shows that aircraft and does not move the sky', planeFirst.got && planeFirst.same, JSON.stringify(planeFirst));
  await page.evaluate(() => { const s = window.__sky; s.S.center = 'MID'; s.save(); s.applyCenter(false); });
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  // ---------- version 3.9: realistic shapes ----------
  const shp = await page.evaluate(() => {
    const s = window.__sky, out = {};
    for (const k of ['b747', 'a380', 'heavy', 'light', 'jet']) {
      const m = new s.PlaneMesh(k, s.paintFor('BAW1', 'abc123', k)); const g = m.mesh.geometry; g.computeBoundingBox();
      const b = g.boundingBox, pos = g.attributes.position.array; let frontTop = -1, rearTop = -1;
      for (let i = 0; i < pos.length; i += 3) { const x = pos[i], y = pos[i + 1], z = pos[i + 2]; if (Math.abs(x) > 0.03) continue; if (z > 0.2 && z < 0.35) frontTop = Math.max(frontTop, y); if (z > -0.25 && z < -0.05) rearTop = Math.max(rearTop, y); }
      out[k] = { frontTop: +frontTop.toFixed(3), rearTop: +rearTop.toFixed(3), front: +b.max.z.toFixed(3), len: m.len }; m.dispose && m.dispose();
    }
    return out;
  });
  ok('the 747 has a hump: its body is taller over the front than over the rear, unlike the plain four-engine jet', shp.b747.frontTop > shp.b747.rearTop + 0.01 && Math.abs(shp.heavy.frontTop - shp.heavy.rearTop) < 0.005, JSON.stringify(shp));
  ok('the A380 has a double deck the whole length: taller than the 747 over the rear and as tall at the front', shp.a380.rearTop > shp.b747.rearTop + 0.01 && shp.a380.frontTop >= shp.b747.frontTop - 0.005, JSON.stringify(shp));
  ok('the small plane has a propeller at its nose, ahead of where its body ends', shp.light.front > 0.5, JSON.stringify(shp.light));
  // ---------- version 3.9: the shape follows the aircraft type even while the camera rides on that aircraft ----------
  const ride = await page.evaluate(async () => {
    const s = window.__sky, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    s.setFollow('');
    const p = [...s.planes.values()].find((q) => q.lat !== null && q.opacity > 0.5 && q.mesh && q.kind !== 'light' && q.kind !== 'heli' && !q.remote);
    if (!p) return { none: true };
    const was = { type: p.type, category: p.category, kind: p.kind };
    s.lockOn(p); await wait(7500);   // the glide in to a locked aircraft takes 6 seconds, so measure only once it has finished
    const d0 = s.pose.dist;
    p.type = 'C172'; p.category = 'A1'; p.tPaint = 0;   // the type arrives while the camera is riding on it
    await wait(300); const soon = p.kind, d1 = s.pose.dist;
    await wait(5000); const d2 = s.pose.dist;
    p.type = was.type; p.category = was.category; p.tPaint = 0; await wait(300);
    const back = p.kind; s.autoTour();
    return { was: was.kind, soon, back, jump: +(Math.abs(d1 - d0) / d0).toFixed(3), settled: +(d2 / d0).toFixed(3) };
  });
  ok('a Cessna 172 gets its small-plane shape as soon as its type is known, even with the camera riding on it, and the camera eases in instead of jumping', !ride.none && ride.soon === 'light' && ride.jump < 0.08 && ride.settled < 0.85 && ride.back === ride.was, JSON.stringify(ride));
  await page.waitForTimeout(500);
  // ---------- version 3.9: business jets get their own shape ----------
  const biz = await page.evaluate(() => {
    const s = window.__sky, kinds = {};
    for (const t of ['C25C', 'C56X', 'C680', 'C700', 'CL35', 'GLF6', 'GLEX', 'E55P', 'LJ45', 'FA7X', 'H25B', 'PC24', 'HDJT', 'C172', 'B738', 'A320', 'C17', 'E75L']) kinds[t] = s.modelFor('', t);
    const m = new s.PlaneMesh('biz', s.paintFor('N345MG', 'a1b2c3', 'biz')), pos = m.mesh.geometry.attributes.position.array;
    let rearHigh = 0, underWing = 0, finTop = -1, tailWide = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (z < -0.18 && z > -0.33 && Math.abs(x) > 0.06 && Math.abs(x) < 0.11 && y > 0.01) rearHigh++;   // engine pods beside the rear of the body
      if (z > -0.05 && z < 0.15 && Math.abs(x) > 0.1 && Math.abs(x) < 0.3 && y < -0.035) underWing++;  // anything hanging under the wings
      if (Math.abs(x) < 0.01 && z < -0.4) finTop = Math.max(finTop, y);
      if (y > 0.18 && z < -0.44) tailWide = Math.max(tailWide, Math.abs(x));                              // the tailplane on top of the fin
    }
    const out = { kinds, rearHigh, underWing, finTop: +finTop.toFixed(3), tailWide: +tailWide.toFixed(3), len: m.len }; m.dispose && m.dispose(); return out;
  });
  const bizTypes = ['C25C', 'C56X', 'C680', 'C700', 'CL35', 'GLF6', 'GLEX', 'E55P', 'LJ45', 'FA7X', 'H25B', 'PC24', 'HDJT'];
  ok('Citations, Challengers, Gulfstreams, Phenoms, Learjets, Falcons, Hawkers, the PC-24 and the HondaJet are drawn as business jets; the Cessna 172, the airliners and the C-17 are not', bizTypes.every((t) => biz.kinds[t] === 'biz') && biz.kinds.C172 === 'light' && biz.kinds.B738 === 'jet' && biz.kinds.A320 === 'jet' && biz.kinds.C17 === 'heavy' && biz.kinds.E75L === 'jet', JSON.stringify(biz.kinds));
  ok('the business jet has its engines at the back of the body, nothing under its wings, a tailplane on top of the fin, and is drawn smaller than an airliner', biz.rearHigh > 10 && biz.underWing === 0 && biz.finTop > 0.19 && biz.tailWide > 0.15 && biz.len < 1, JSON.stringify(biz));
  // ---------- version 3.11: the 757, twin turboprops, and a helicopter with skids and a tail rotor ----------
  const s311 = await page.evaluate(() => {
    const s = window.__sky, kinds = {};
    for (const t of ['B752', 'B753', 'B738', 'A321', 'B763', 'AT72', 'AT76', 'DH8D', 'D328', 'J328', 'SF34', 'SB20', 'E120', 'JS41', 'BE20', 'B350', 'BE9L', 'PC12', 'TBM9', 'C208', 'E75L', 'CRJ9']) kinds[t] = s.modelFor('', t);
    const body = (k) => { const m = new s.PlaneMesh(k, s.paintFor('UAL1', 'abc123', k)), pos = m.mesh.geometry.attributes.position.array; let r = 0, propFront = 0, wingHi = 0, wingLo = 0, skid = 0;
      for (let i = 0; i < pos.length; i += 3) { const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        if (Math.abs(x) < 0.005 && z > -0.25 && z < 0.34) r = Math.max(r, y);                                   // how tall the body is in the middle
        if (Math.abs(x) > 0.07 && Math.abs(x) < 0.27 && z > 0.22) propFront++;                                 // propellers ahead of the wing, beside the body
        if (Math.abs(x) > 0.55 && Math.abs(x) < 0.63 && z > -0.05 && z < 0.15) { if (y > 0.035) wingHi++; else if (y < -0.015) wingLo++; }
        if (y < -0.12) skid++; }
      const out = { r: +r.toFixed(3), propFront, wingHi, wingLo, skid, len: m.len, tailRotor: !!m.tailRotor }; m.dispose && m.dispose(); return out; };
    return { kinds, b757: body('b757'), jet: body('jet'), turbo: body('turbo'), turbolow: body('turbolow'), kingair: body('kingair'), heli: body('heli') };
  });
  ok('the 757 gets its own shape, and the 737, A321, 767 and regional jets do not', s311.kinds.B752 === 'b757' && s311.kinds.B753 === 'b757' && s311.kinds.B738 === 'jet' && s311.kinds.A321 === 'jet' && s311.kinds.B763 === 'heavy2' && s311.kinds.E75L === 'jet' && s311.kinds.CRJ9 === 'jet', JSON.stringify(s311.kinds));
  ok('the 757 is longer and slimmer than the plain twin jet', s311.b757.len > s311.jet.len + 0.1 && s311.b757.r < s311.jet.r - 0.005, JSON.stringify({ b757: s311.b757, jet: s311.jet }));
  ok('ATRs, Dash 8s and Dorniers are twin turboprops with the wing on top; Saabs, the Brasilia and the Jetstream 41 have it below; King Airs have it below; the PC-12, TBM and Caravan are small planes; the Dornier 328JET keeps its jets', ['AT72', 'AT76', 'DH8D', 'D328'].every((t) => s311.kinds[t] === 'turbo') && ['SF34', 'SB20', 'E120', 'JS41'].every((t) => s311.kinds[t] === 'turbolow') && ['BE20', 'B350', 'BE9L'].every((t) => s311.kinds[t] === 'kingair') && ['PC12', 'TBM9', 'C208'].every((t) => s311.kinds[t] === 'light') && s311.kinds.J328 !== 'turbo', JSON.stringify(s311.kinds));
  ok('the twin turboprop has a propeller in front of each engine, its wing above the body, the Saab shape and the King Air their wing below', s311.turbo.propFront > 20 && s311.turbo.wingHi > 10 && s311.turbo.wingLo === 0 && s311.kingair.propFront > 20 && s311.kingair.wingLo > 10 && s311.kingair.wingHi === 0 && s311.kingair.len < s311.turbo.len && s311.turbolow.wingLo > 10 && s311.turbolow.wingHi === 0 && s311.turbolow.propFront > 20 && s311.turbolow.len === s311.turbo.len, JSON.stringify({ turbo: s311.turbo, turbolow: s311.turbolow, kingair: s311.kingair }));
  ok('the helicopter stands on skids and has a rotor on its tail', s311.heli.skid > 20 && s311.heli.tailRotor, JSON.stringify(s311.heli));
  // ---------- version 3.12: the aircraft gallery, military paint and fun paint ----------
  await page.keyboard.press('Escape'); await page.mouse.move(400, 300); await page.keyboard.press('g');
  await page.waitForFunction(() => { const g = window.__sky.gallery; return g && g.isOpen && g.cards.length && g.cards.every((c) => c.drawn); }, null, { timeout: 20000 }).catch(() => {});
  const gal = await page.evaluate(() => {
    const s = window.__sky, g = s.gallery, kinds = g.cards.map((c) => c.kind), want = Object.keys(s.MODELS).concat('heavy2');
    const lit = (cv) => { const x = cv.getContext('2d'), d = x.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; };
    const f0 = s.renderer.info.render.frame;
    return { open: g.isOpen, n: document.querySelectorAll('#gal-shapes figure').length, missing: want.filter((k) => kinds.indexOf(k) === -1), blank: g.cards.filter((c) => lit(c.cv) < 500).map((c) => c.kind), f0,
      titles: [...document.querySelectorAll('#gal-shapes figcaption b')].map((b) => b.textContent) };
  });
  await page.waitForTimeout(600);
  const galF1 = await page.evaluate(() => window.__sky.renderer.info.render.frame);
  ok('G opens the gallery with a card for every shape the sky draws, each with a picture of the aircraft', gal.open && gal.n === 12 && gal.missing.length === 0 && gal.blank.length === 0, JSON.stringify(gal));
  ok('while the gallery is open the sky behind it is not drawn', galF1 === gal.f0, gal.f0 + ' then ' + galF1);
  await page.keyboard.press('s');
  const galKeys = await page.evaluate(() => ({ panel: document.body.classList.contains('panel'), open: window.__sky.gallery.isOpen }));
  ok('with the gallery open, other keys do nothing', !galKeys.panel && galKeys.open, JSON.stringify(galKeys));
  await page.click('#gallery [data-tab="paint"]');
  await page.waitForFunction(() => window.__sky.gallery.cards.slice(0, 4).every((c) => c.drawn), null, { timeout: 15000 }).catch(() => {});
  const galPaint = await page.evaluate(() => {
    const names = [...document.querySelectorAll('#gal-paint figcaption b')].map((b) => b.textContent), chips = document.querySelectorAll('#gal-paint .gchips span').length;
    return { n: names.length, names, chips, heads: [...document.querySelectorAll('#gal-paint h2')].map((h) => h.textContent) };
  });
  ok('the paint page shows the airlines with their own paint, the regionals in their partner\'s paint, military aircraft, and the airlines known only by a tail colour',
    galPaint.n > 50 && ['Delta Air Lines', 'Endeavor Air', 'Lufthansa', 'Military aircraft', 'Military helicopter'].every((n) => galPaint.names.indexOf(n) !== -1) && galPaint.chips > 20 && galPaint.heads.indexOf('Military') !== -1, JSON.stringify({ n: galPaint.n, chips: galPaint.chips, heads: galPaint.heads }));
  await page.click('#gallery [data-tab="fun"]');
  await page.click('#gal-fun button[data-fun="bee"]');
  const fun = await page.evaluate(() => {
    const s = window.__sky, unknown = s.paintFor('ZZZ999', 'abc001', 'jet', { fun: s.S.fun }), small = s.paintFor('N12345', 'abc002', 'light', { fun: s.S.fun }), delta = s.paintFor('DAL123', 'abc003', 'jet', { fun: s.S.fun }), deltaPlain = s.paintFor('DAL123', 'abc003', 'jet');
    const mil = s.paintFor('RCH123', 'ae0001', 'heavy', { mil: true, fun: s.S.fun }), milHeli = s.paintFor('', 'ae0002', 'heli', { mil: true });
    const saved = JSON.parse(localStorage.getItem('sky3d') || '{}').fun;
    return { fun: s.S.fun, select: document.getElementById('f-fun').value, saved, inUse: document.querySelector('#gal-fun button[data-fun="bee"]').textContent, unknownTop: unknown[0], smallTop: small[0], deltaSame: JSON.stringify(delta) === JSON.stringify(deltaPlain), milTop: mil[0], milHeliTop: milHeli[0] };
  });
  ok('Use this on a fun paint sets it for aircraft with no airline paint, saves it and shows it in the settings; airline and military paint stay as they are',
    fun.fun === 'bee' && fun.select === 'bee' && fun.saved === 'bee' && fun.inUse === 'In use' && fun.unknownTop === 0xffc400 && fun.smallTop === 0xffc400 && fun.deltaSame && fun.milTop === 0x6e757b && fun.milHeliTop === 0x4b5320, JSON.stringify(fun));
  await page.keyboard.press('g');
  const galShut = await page.evaluate(() => window.__sky.gallery.isOpen);
  ok('G closes the gallery', !galShut);
  // a military aircraft from the flight network, marked in its records, wears military grey in the sky; Escape also closes the gallery
  const milSky = await page.evaluate(async () => {
    const s = window.__sky; s.setFun('');
    const near = s.pose; s.ingest([{ hex: 'ae0f01', flight: 'RCH871  ', t: 'C17', category: 'A5', dbFlags: 1, lat: near.lat + 0.05, lon: near.lon + 0.05, alt_baro: 18000, gs: 380, track: 90, seen: 0.1, seen_pos: 0.2 },
      { hex: 'a0f002', flight: 'N55XY   ', t: 'C172', category: 'A1', dbFlags: 0, lat: near.lat - 0.05, lon: near.lon - 0.05, alt_baro: 3000, gs: 100, track: 90, seen: 0.1, seen_pos: 0.2 }], Date.now() / 1000, 2);
    await new Promise((r) => setTimeout(r, 1500));
    const m = s.planes.get('ae0f01'), c = s.planes.get('a0f002');
    s.openGallery('shapes'); const opened = s.gallery.isOpen;
    return { mil: m && m.mil, milPaint: m ? s.paintOf(m, s.modelFor(m.category, m.type))[0] : null, civ: c && c.mil, civPaint: c ? s.paintOf(c, 'light')[0] : null, drawn: !!(m && m.mesh), opened };
  });
  await page.keyboard.press('Escape');
  const escShut = await page.evaluate(() => window.__sky.gallery.isOpen);
  ok('an aircraft its records mark as military wears military grey in the sky; one not marked keeps its usual paint', milSky.mil === true && milSky.milPaint === 0x6e757b && milSky.drawn && milSky.civ === false && milSky.civPaint !== null && milSky.civPaint !== 0x6e757b, JSON.stringify(milSky));
  ok('Escape closes the gallery', milSky.opened && !escShut);
  // ---------- version 3.9: the caption names both ends of the trip ----------
  const words = await page.evaluate(() => {
    const s = window.__sky, A = { name: 'Palm Beach International', location: 'West Palm Beach', iata: 'PBI', icao: 'KPBI', lat: 26.6832, lon: -80.0956 }, B = { name: 'Hartsfield Jackson Atlanta International', location: 'Atlanta', iata: 'ATL', icao: 'KATL', lat: 33.6367, lon: -84.4281 };
    const text = (p) => { const d = document.createElement('div'); d.innerHTML = s.routeHtml([A, B], Object.assign({ ground: false, vrate: 0 }, p)); return d.textContent.replace(/\s+/g, ' ').trim(); };
    return { up: text({ altFt: 1575, vrate: 1800, rLat: 26.72, rLon: -80.15 }), high: text({ altFt: 31000, rLat: 30.5, rLon: -82.3 }), down: text({ altFt: 2500, vrate: -900, rLat: 33.7, rLon: -84.3 }) };
  });
  ok('the route line always names both ends, with Departing or Arriving in front when the aircraft is low beside one of them', words.up === 'Departing West Palm Beach PBI to Atlanta ATL' && words.high === 'West Palm Beach PBI to Atlanta ATL' && words.down === 'Arriving West Palm Beach PBI to Atlanta ATL', JSON.stringify(words));
  // ---------- version 3.9: routes are asked of the relay first, which asks the route services from home ----------
  const rel = await browser.newPage({ viewport: { width: 640, height: 360 } }); rel.on('pageerror', (e) => errs.push('PAGEERROR (routes through the relay): ' + e.message));
  await rel.goto(PAGE.replace('routeApi=/mock/routeset&', '') + '&relay=/mock'); await rel.waitForTimeout(5000);
  const viaRelay = await rel.evaluate(async () => {
    const s = window.__sky; await fetch('/ctl/routeasks?reset=1'); s.routes.clear();
    const ps = [...s.planes.values()].filter((q) => q.lat !== null && /^[A-Z]{2,3}\d/.test(q.callsign())).slice(0, 3);
    const got = []; for (const p of ps) { const r = await s.getRoute(p); got.push(!!(r && r._airports && r._airports.length >= 2)); }
    const n = await (await fetch('/ctl/routeasks')).json();
    return { asked: ps.length, got, n };
  });
  ok('with a relay beside the page, routes are asked of the relay and not of the route services directly', viaRelay.asked > 0 && viaRelay.got.some(Boolean) && viaRelay.n.relay >= viaRelay.asked && viaRelay.n.direct === 0, JSON.stringify(viaRelay));
  // ---------- version 3.10: regional airlines under their partner's name, and altitudes near the ground ----------
  const regional = await page.evaluate(() => { const f = window.__sky.partnerOf, ap = (a, b) => [{ iata: a }, { iata: b }], k = (x) => (x ? x.key || (x.some ? 'some' : '?') : 'own');
    return { rpaBos: k(f('RPA5604', ap('MEM', 'BOS'))), rpaNone: k(f('RPA5604', null)), rpaLga: k(f('RPA5400', ap('LGA', 'ROC'))), rpa4466: k(f('RPA4466', ap('LGA', 'BOS'))), rpa4466n: k(f('RPA4466', null)), rpa4555: k(f('RPA4555', null)), ash: k(f('ASH6285', null)), ash4400: k(f('ASH4400', [{ iata: 'LGA' }, { iata: 'BOS' }])), skwDen: k(f('SKW3000', ap('DEN', 'BIL'))), skwSea: k(f('SKW3000', ap('SEA', 'GEG'))), edv: k(f('EDV5000', null)), qxe: k(f('QXE2100', null)), dal: k(f('DAL1311', ap('PBI', 'ATL'))), tail: k(f('N345MG', null)) }; });
  ok('a regional airline that flies for several partners is named from its flight number where that is known (RPA 4466 LGA to BOS and RPA 4555 are American; Mesa, part of Republic, is always United), then for the one whose hub is on its route, and otherwise flies for a partner', regional.rpaBos === 'DAL' && regional.rpaNone === 'some' && regional.rpaLga === 'some' && regional.rpa4466 === 'AAL' && regional.rpa4466n === 'AAL' && regional.rpa4555 === 'AAL' && regional.ash === 'UAL' && regional.ash4400 === 'UAL' && regional.skwDen === 'UAL' && regional.skwSea === 'some' && regional.edv === 'DAL' && regional.qxe === 'ASA' && regional.dal === 'own' && regional.tail === 'own', JSON.stringify(regional));
  // ---------- version 3.11: a photo of the aircraft in the caption, from Planespotters.net ----------
  const ph = await browser.newPage({ viewport: { width: 960, height: 540 } }); ph.on('pageerror', (e) => errs.push('PAGEERROR (photos): ' + e.message));
  await ph.goto(PAGE + '&photoApi=/mock/photos/'); await ph.waitForTimeout(5000);
  await ph.evaluate(() => { const s = window.__sky; s.setFollow(''); const p = [...s.planes.values()].find((q) => q.lat !== null && q.opacity > 0.5 && q.callsign()); s.lockOn(p); });
  await ph.waitForFunction(() => document.getElementById('cap').classList.contains('on'), null, { timeout: 15000 }).catch(() => {});
  const btnShown = await ph.evaluate(() => !document.getElementById('photobtn').hidden && document.body.classList.contains('hasphoto'));
  await ph.keyboard.press('i');
  await ph.waitForFunction(() => !document.getElementById('photo-credit').hidden, null, { timeout: 10000 }).catch(() => {});
  const good = await ph.evaluate(() => { const c = document.getElementById('photo-credit'), a = c.querySelector('a'); return { open: !document.getElementById('photo').hidden, title: document.getElementById('photo-title').textContent, credit: c.textContent, imgs: c.querySelectorAll('img').length, link: a && a.href, target: a && a.target, rel: a && a.rel, src: document.getElementById('photo-img').getAttribute('src') }; });
  ok('the I key opens a photo of the aircraft in the caption, with the photographer named as plain text and a link to its Planespotters.net page', btnShown && good.open && good.title.length > 0 && /^Photo © Pat Spotter <img/.test(good.credit) && good.imgs === 0 && /^https:\/\/www\.planespotters\.net\/photo\//.test(good.link || '') && good.target === '_blank' && /noopener/.test(good.rel || '') && /^https:\/\/t\.plnspttrs\.net\//.test(good.src || ''), JSON.stringify(Object.assign(good, { btnShown })));
  await ph.keyboard.press('Escape');
  const shut = await ph.evaluate(() => document.getElementById('photo').hidden);
  // the same aircraft under another identity: one with no photo, and one whose answer points somewhere other than Planespotters
  const tryHex = (hex) => ph.evaluate(async (h) => { const s = window.__sky, p = s.capPlane, was = p.hex; p.hex = h; document.getElementById('photobtn').click();
    for (let i = 0; i < 40 && /Looking/.test(document.getElementById('photo-note').textContent); i++) await new Promise((r) => setTimeout(r, 250));
    const out = { note: document.getElementById('photo-note').textContent, credit: document.getElementById('photo-credit').hidden, src: document.getElementById('photo-img').getAttribute('src') };
    document.getElementById('photo-close').click(); p.hex = was; return out; }, hex);
  const none = await tryHex('eeeee0'), evil = await tryHex('bad001');
  ok('Escape closes the photo, an aircraft with no photo says so, and a photo from anywhere but Planespotters is not shown', shut && /no photo/.test(none.note) && none.credit && !none.src && /no photo/.test(evil.note) && evil.credit && !evil.src, JSON.stringify({ shut, none, evil }));
  await ph.close();
  // the network edition with a relay asks the relay for photos, not Planespotters directly
  await sim('/ctl/photoasks?reset=1');
  await rel.evaluate(() => { const s = window.__sky; s.setFollow(''); const p = [...s.planes.values()].find((q) => q.lat !== null && q.opacity > 0.5 && q.callsign()); s.lockOn(p); });
  await rel.waitForFunction(() => document.getElementById('cap').classList.contains('on'), null, { timeout: 15000 }).catch(() => {});
  await rel.keyboard.press('i');
  await rel.waitForFunction(() => !document.getElementById('photo-credit').hidden, null, { timeout: 10000 }).catch(() => {});
  const relPh = await sim('/ctl/photoasks'), relCredit = await rel.evaluate(() => { const c = document.getElementById('photo-credit'); const t = c.hidden ? '' : c.textContent; document.getElementById('photo-close').click(); return t; });
  ok('with a relay beside the page, photos are asked of the relay and not of Planespotters directly', relPh.relay > 0 && relPh.hex === 0 && relPh.reg === 0 && /Pat Spotter/.test(relCredit), JSON.stringify(Object.assign(relPh, { relCredit })));
  const low = await page.evaluate(() => { const w = window.__sky.altWords; return { neg: w(false, -150, 25), low: w(false, 75, 25), up: w(false, 2450, 25), ground: w(true, 0, 25) }; });
  ok('an aircraft reading below zero or within 100 feet of it is near the ground, not at minus so many feet', low.neg === 'near the ground' && low.low === 'near the ground' && low.up === '2,450 feet' && low.ground === 'on the ground', JSON.stringify(low));
  // the count in the corner: the antenna's own aircraft are counted at home, and not while the sky shown is far away
  const atHome = await rel.evaluate(() => document.getElementById('k-src').textContent);
  const hadHome = await rel.evaluate(() => { const s = window.__sky, had = s.home; if (!had) s.home = { lat: 41.16, lon: -73.13 }; s.S.center = 'OTHER'; s.S.other = 'KLAX'; s.applyCenter(false); return !!had; });   // a receiver in Connecticut, where the stand-in antenna is
  await rel.waitForTimeout(3000);
  const farAway = await rel.evaluate(() => document.getElementById('k-src').textContent);
  await rel.evaluate((had) => { const s = window.__sky; if (!had) s.home = null; s.S.center = 'MID'; s.S.other = ''; s.applyCenter(false); }, hadHome);
  ok('the corner counts the antenna aircraft at home, and says the antenna is far away while the sky shown is somewhere else', / by /.test(atHome) && /far from here/.test(farAway) && !/ by /.test(farAway), JSON.stringify({ atHome, farAway }));
  // a question to the flight network that is never answered is given up after 15 seconds, so the page asks again, and the corner
  // stops counting the network as answering; once the network answers again its aircraft come back
  await rel.evaluate(() => fetch('/ctl/hangnet?on=1')); await rel.waitForTimeout(18000);
  const netHang = await rel.evaluate(() => ({ fails: window.__sky.net.fails, busy: window.__sky.net.busy, i: window.__sky.net.i }));
  await rel.evaluate(() => fetch('/ctl/hangnet?on=0')); await rel.waitForTimeout(8000);
  const netBack = await rel.evaluate(() => ({ answered: performance.now() / 1000 - window.__sky.net.lastGood < 8 || window.__sky.net.fails === 0, text: document.getElementById('k-src').textContent }));
  ok('a question to the flight network that never gets an answer is given up, and the network aircraft come back once it answers again', (netHang.fails >= 1 || netHang.i > 0) && netBack.answered && /[1-9]\d* more from the flight network/.test(netBack.text), JSON.stringify({ netHang, netBack }));
  await rel.close(); await page.bringToFront();
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
  const badAt = Date.now(); await satBad.goto(PAGE + '&sat=1&satApi=/mock/satfail/{z}/{y}/{x}.png');
  // a slow machine can take a while to collect 12 failures, and the note under the setting is refreshed every 2 seconds
  await satBad.waitForFunction(() => window.__sky && window.__sky.sat.down && /not loading/.test(document.getElementById('sat-note').textContent), null, { timeout: 45000 }).catch(() => {});
  const badSecs = Math.round((Date.now() - badAt) / 1000);
  const down = await satBad.evaluate(() => { const s = window.__sky; return { down: s.sat.down, failed: s.sat.failed, asked: s.sat.asked, land: s.ground.land.geometry.index ? s.ground.land.geometry.index.count : 0, landShown: s.ground.land.visible, note: document.getElementById('sat-note').textContent }; });
  await satBad.waitForTimeout(3000);
  const later = await satBad.evaluate(() => window.__sky.sat.asked);
  // five minutes on, it tries again without the view having to move (the wait is cut short here)
  const retried = await satBad.evaluate(async () => { const g = window.__sky.sat, before = g.asked; g.downUntil = 0; await new Promise((r) => setTimeout(r, 2000)); return g.asked > before; });
  ok('after the pause, the page asks the photo service again on its own', retried);
  ok('when the photo service does not answer, the drawn map stays and the page stops asking', down.down && down.failed >= 12 && down.land > 0 && down.landShown && /not loading/.test(down.note) && later === down.asked, JSON.stringify(Object.assign(down, { later, secs: badSecs })));
  await satBad.close();
  // a short outage after some photos loaded: the missing ones are asked for again, when switched off and on and a minute later by themselves
  const satSome = await browser.newPage({ viewport: { width: 960, height: 540 } }); satSome.on('pageerror', (e) => errs.push('PAGEERROR (satellite outage): ' + e.message));
  await sim('/ctl/satsome?down=1'); await satSome.goto(PAGE + '&sat=1&satApi=/mock/satsome/{z}/{y}/{x}.png');
  await satSome.waitForFunction(() => { const g = window.__sky && window.__sky.sat; return g && g.loaded > 0 && !g.busy && !g.queue.length && [...g.cache.values()].some((t) => t.bad); }, null, { timeout: 45000 }).catch(() => {});
  const holes = () => satSome.evaluate(() => { const g = window.__sky.sat; return { loaded: g.loaded, failed: g.failed, asked: g.asked, down: g.down, holes: [...g.cache.values()].filter((t) => t.bad && g.want.has(t.k)).length }; });
  const part = await holes();
  const toggled = await satSome.evaluate(async (need) => { const s = window.__sky, before = s.sat.asked; s.S.sat = false; s.applySat(); s.S.sat = true; s.applySat(); for (let i = 0; i < 120 && s.sat.asked - before < need; i++) await new Promise((r) => setTimeout(r, 250)); return s.sat.asked - before; }, part.holes);
  ok('photos that failed during a short outage are asked for again when the setting is switched off and on', part.loaded > 0 && part.holes > 0 && !part.down && toggled >= part.holes, JSON.stringify(Object.assign(part, { toggled })));
  await sim('/ctl/satsome?down=0');
  // a minute on, the missing photos are asked for again by themselves (the wait is cut short here)
  await satSome.evaluate(() => { const g = window.__sky.sat; for (const t of g.cache.values()) t.retry = 0; g.retryAt = 0.001; });
  // a photo asked for again stops counting as missing the moment it is asked for, so wait until the new ones have actually arrived
  await satSome.waitForFunction((had) => { const g = window.__sky.sat; return g.loaded > had && !g.busy && !g.queue.length && ![...g.cache.values()].some((t) => t.bad && g.want.has(t.k)); }, part.loaded, { timeout: 30000 }).catch(() => {});
  const healed = await holes();
  ok('once the outage is over, the missing photos fill in on their own', healed.holes === 0 && healed.loaded > part.loaded, JSON.stringify(healed));
  await satSome.close();
  console.log('errors:', errs.join(' ; ') || 'none');
  await browser.close();
})();
