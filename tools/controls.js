// Drives the version 3.6 controls in Chromium against tools/sim.js: fly heading, key ownership, search, click and follow behavior.
// usage: node tools/sim.js 8090 (in another window), then node tools/controls.js. Prints PASS or FAIL per check.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8090/net/?routeApi=/mock/routeset&posApi=/mock/v2/&dpr=1&sky=day&wx=clear&netApi=/mock/v2/');
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
  console.log('errors:', errs.join(' ; ') || 'none');
  await browser.close();
})();
