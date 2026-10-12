// Checks "My places" for privacy, with the page opened through the front door (relay/relay.py) the way a guest would open it.
// Run with the stand-in receiver and the relay going, as described at the top of tools/door.js.
const { chromium } = require('playwright');
const DOOR = 'http://localhost:' + (process.argv[2] || 8099), SIM = 'http://localhost:' + (process.argv[3] || 8090);
const HOUSE = { name: 'My House', text: '40.68920, -74.04450', lat: '40.689', lon: '74.044' };   // the example spot from the settings panel, a statue in New York harbor
let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log((ok ? 'ok    ' : 'FAIL  ') + label + (detail ? '   ' + detail : '')); };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const open = async (ctx, query) => {
    const page = await ctx.newPage(); page.urls = []; page.errs = [];
    page.on('request', (r) => page.urls.push(r.url())); page.on('pageerror', (e) => page.errs.push(e.message));
    await page.goto(DOOR + '/sky/?dpr=1&sky=day&wxApi=' + encodeURIComponent(SIM + '/mock/wx') + '&routeApi=' + encodeURIComponent(SIM + '/mock/routeset') + '&' + query);
    await page.waitForTimeout(2500); return page;
  };
  const state = (page) => page.evaluate(() => ({ places: window.__sky.S.places.map((p) => p.n), center: window.__sky.S.center, keep: window.__sky.S.keep, stored: JSON.parse(localStorage.getItem('sky3d') || 'null'),
    options: [...document.getElementById('f-center').options].map((o) => o.textContent), note: document.getElementById('places-note').textContent, ticked: document.getElementById('f-keep').checked,
    relayRow: getComputedStyle(document.querySelector('.home-only') || document.body).display, src: document.getElementById('f-src') ? document.getElementById('f-src').options[0].textContent : '' }));
  const addHouse = async (page) => { await page.keyboard.press('s'); await page.fill('#f-pname', HOUSE.name); await page.fill('#f-pll', HOUSE.text); await page.click('#f-places button[type=submit]'); await page.waitForTimeout(400); await page.click('#places .place button'); await page.keyboard.press('Escape'); };

  // 1. a guest on the shared address
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  let page = await open(ctx, 'shared=1&relay=/sky-relay');
  let s = await state(page);
  check('a guest starts with no places and nothing kept', s.places.length === 0 && s.keep === false && !s.ticked);
  check('the relay address setting is hidden from a guest', s.relayRow === 'none');
  check('the wording speaks of the site\'s antenna, not "my antenna"', /This site's antenna/.test(s.src), s.src);
  await addHouse(page); await page.waitForTimeout(13000);
  s = await state(page);
  check('the guest can add a place and go there', s.places[0] === HOUSE.name && s.center === 'P0' && s.options[0] === HOUSE.name, s.note);
  check('nothing about the place is stored in the browser', s.stored && s.stored.places.length === 0 && s.stored.center === 'MID' && !JSON.stringify(s.stored).includes('40.68'), JSON.stringify({ places: s.stored.places, center: s.stored.center }));
  const leaks = page.urls.filter((u) => u.includes(HOUSE.lat) || u.includes(HOUSE.lon) || u.includes('40.68') || u.includes('74.04') || /My(%20|\+| )?House/i.test(u));
  check('the exact spot and its name are in no request to anywhere', leaks.length === 0, leaks.slice(0, 3).join(' '));
  const points = [...new Set(page.urls.filter((u) => u.includes('/v2/point/')).map((u) => u.split('/v2/point/')[1].split('?')[0]))];
  check('the flight network is asked about a rounded place', points.includes('40.7/-74.0/44') && points.every((p) => /^-?\d+\.\d\/-?\d+\.\d\/\d+$/.test(p)), points.join('  '));
  const wx = [...new Set(page.urls.filter((u) => u.includes('/mock/wx')).map((u) => (u.match(/latitude=([-\d.]+)&longitude=([-\d.]+)/) || []).slice(1).join(',')))];
  check('the weather is asked for a rounded place', wx.length > 0 && wx.every((w) => /^-?\d+\.(00|25|50|75),-?\d+\.(00|25|50|75)$/.test(w)), wx.join('  '));
  const hosts = [...new Set(page.urls.map((u) => new URL(u).origin))];
  check('the page talks only to its own address and the weather and route services', hosts.every((h) => h === DOOR || h === SIM), hosts.join('  '));
  const view = await page.evaluate(() => { const k = window.__sky, live = [...k.planes.values()].filter((p) => p.lat !== null && p.opacity > 0.5); return { ant: live.filter((p) => p.src === 'ant').length, net: live.filter((p) => p.src === 'net').length, corner: document.getElementById('corner').innerText.split('\n').pop(), msg: document.getElementById('msg').classList.contains('on') ? document.getElementById('msg').innerText : '' }; });
  check('through the front door the guest sees the antenna and the flight network together', view.ant > 0 && view.net > 0 && /by this site's antenna, \d+ more from the flight network/.test(view.corner), view.corner + (view.msg ? ' | ' + view.msg : ''));
  await page.screenshot({ path: 'build/shots/guest_place.png' });
  await page.reload(); await page.waitForTimeout(2500); s = await state(page);
  check('after the page is closed and opened again the place is gone', s.places.length === 0 && s.center === 'MID' && !s.options.includes(HOUSE.name));
  check('no errors on the page', page.errs.length === 0, page.errs.join(' ; '));

  // 2. a guest who chooses to keep their places
  await addHouse(page); await page.keyboard.press('s'); await page.check('#f-keep'); await page.waitForTimeout(300); s = await state(page);
  check('ticking the box keeps the place on this device', s.keep === true && s.stored.places.length === 1 && s.stored.center === 'P0', s.note);
  await page.reload(); await page.waitForTimeout(2500); s = await state(page);
  check('and it is still there next time', s.places[0] === HOUSE.name && s.center === 'P0' && s.ticked);
  await page.keyboard.press('s'); await page.uncheck('#f-keep'); await page.waitForTimeout(300); s = await state(page);
  check('unticking the box wipes it from the device at once, and keeps it on screen until the page closes', s.stored.places.length === 0 && s.stored.center === 'MID' && s.places.length === 1, s.note);
  await ctx.close();

  // 3. another guest, in another browser, never sees the first guest's places
  ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); page = await open(ctx, 'shared=1&relay=/sky-relay'); s = await state(page);
  check('a second guest sees none of the first guest\'s places', s.places.length === 0 && !s.options.includes(HOUSE.name));
  await ctx.close();

  // 4. at home nothing changes: places are kept as before
  ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); page = await open(ctx, 'shared=0'); s = await state(page);
  check('at home the box starts ticked and the relay setting shows', s.keep === true && s.ticked && s.relayRow !== 'none' && /My antenna/.test(s.src));
  await addHouse(page); await page.waitForTimeout(300); await page.reload(); await page.waitForTimeout(2500); s = await state(page);
  check('at home a place is kept, as it was before', s.places[0] === HOUSE.name && s.center === 'P0');
  await ctx.close();

  // 5. someone who saved places on a shared address before this version keeps them
  ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); page = await ctx.newPage(); await page.goto(DOOR + '/robots.txt');
  await page.evaluate(() => localStorage.setItem('sky3d', JSON.stringify({ center: 'P0', places: [{ n: 'Old place', lat: 40.9, lon: -73.5 }] })));
  page = await open(ctx, 'shared=1&relay=/sky-relay'); s = await state(page);
  check('places saved before this version are not thrown away', s.places[0] === 'Old place' && s.keep === true && s.ticked && s.center === 'P0');
  await ctx.close();

  await browser.close();
  console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll places checks passed');
  process.exit(failed ? 1 : 0);
})();
