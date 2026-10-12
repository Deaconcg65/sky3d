// Checks that aircraft stay smooth when several people share one answer from the relay. A shared answer can be a few seconds
// old, and the page has to place each aircraft where it is now, not where it was when the answer was fetched.
// Run with the stand-in receiver and the relay going, as described at the top of tools/door.js.
//   node tools/aged.js [seconds] [relay port] [extra query]
const { chromium } = require('playwright'), http = require('http');
const secs = +(process.argv[2] || 40), DOOR = 'http://localhost:' + (process.argv[3] || 8099), extra = process.argv[4] || '';
(async () => {
  // other viewers watching the same sky, so that most of what the page receives is a shared answer
  const others = setInterval(() => { for (const reach of [44, 39]) http.get(DOOR + '/sky-relay/v2/point/40.7/-73.8/' + reach, { headers: { 'CF-Connecting-IP': '203.0.113.' + Math.floor(Math.random() * 200) } }, (r) => r.resume()).on('error', () => {}); }, 300);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } }); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(DOOR + '/sky/?dpr=1&sky=day&wx=clear&src=network&relay=/sky-relay&routeApi=/nowhere/&' + extra);
  await page.waitForTimeout(9000);
  const r = await page.evaluate((secs) => new Promise((done) => {
    const s = window.__sky, prev = new Map(), t0 = performance.now(); let frames = 0, samples = 0, jumps = 0, back = 0, worst = 0; const who = {}, log = [];
    const tick = () => {
      const now = performance.now(); frames++;
      for (const p of s.planes.values()) {
        if (p.lat === null || p.opacity < 0.9 || p.gs < 80) { prev.delete(p.hex); continue; }
        const q = prev.get(p.hex), cur = { t: p.tFrame * 1000, lat: p.rLat, lon: p.rLon };   // the page's own time for this drawing of the aircraft
        if (q && cur.t === q.t) continue;
        if (q && cur.t - q.t > 5 && cur.t - q.t < 1500) {
          const dn = (cur.lat - q.lat) * 111.19, de = (cur.lon - q.lon) * 111.19 * Math.cos(cur.lat * Math.PI / 180), dt = (cur.t - q.t) / 1000, trk = p.track * Math.PI / 180;
          const along = (dn * Math.cos(trk) + de * Math.sin(trk)) / dt, expect = p.gs * 0.000514444, ratio = Math.hypot(dn, de) / dt / expect; samples++;
          if (ratio > 2.5) { jumps++; who[p.hex] = (who[p.hex] || 0) + 1; if (log.length < 8) log.push(((now - t0) / 1000).toFixed(1) + 's ' + p.hex + ' moved ' + Math.hypot(dn, de).toFixed(2) + ' km in ' + dt.toFixed(2) + ' s'); } if (along < -0.2 * expect) back++; if (ratio > worst) worst = ratio;
        }
        prev.set(p.hex, cur);
      }
      if (now - t0 < secs * 1000) requestAnimationFrame(tick); else done({ framesPerSecond: +(frames / secs).toFixed(1), aircraft: s.planes.size, samples, lurches: jumps, movingBackwards: back, worstSpeedRatio: +worst.toFixed(2), aircraftThatLurched: Object.keys(who).length, corner: document.getElementById('corner').innerText.split('\n').pop(), first: log });
    };
    requestAnimationFrame(tick);
  }), secs);
  clearInterval(others);
  console.log(JSON.stringify(r), errs.join(' ; '));
  await browser.close();
  process.exit(r.samples > 500 && r.lurches === 0 && r.movingBackwards === 0 ? 0 : 1);
})();
