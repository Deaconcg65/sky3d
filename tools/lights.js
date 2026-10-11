// Checks the landing lights: counts aircraft showing them, then visits one arriving aircraft and takes a picture.
// usage: node lights.js <out prefix> [sky] [lights setting]
const { chromium } = require('playwright');
(async () => {
  const [, , out, sky = 'night', lights = 'arr'] = process.argv;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8090' + (process.env.SKY_PATH || '/sky/') + '?clock=manual&routeApi=/mock/routeset&posApi=/mock/v2/&dpr=1&wx=clear&pace=60&center=KJFK&radius=15&sky=' + sky + '&lights=' + lights);
  await page.evaluate(`window.__vt = 0; window.__T0 = Date.now() / 1000 - 30; window.__adv = async (to) => { const s = window.__sky; while (window.__vt < to) { if (Math.round(window.__vt * 60) % 60 === 0) await s.feed((window.__T0 + window.__vt).toFixed(3)); s.step(1 / 60, false); window.__vt += 1 / 60; } s.step(0.0001, true); };`);
  await page.evaluate('window.__adv(7)'); await page.waitForTimeout(1500); await page.evaluate('window.__sky.step(0.0001, true)'); await page.screenshot({ path: out + '_wide.png' });
  const info = await page.evaluate(() => {
    const s = window.__sky, all = [...s.planes.values()].filter((p) => p.lat !== null && p.opacity > 0.5);
    const lit = all.filter((p) => p.landLevel > 0.5), low = all.filter((p) => !p.ground && p.altFt < 5000);
    const pick = lit.filter((p) => p.mesh && p.mesh.key === 'jet').sort((a, b) => a.altFt - b.altFt)[Math.floor(lit.length / 3)] || lit[0];
    if (pick) s.startVisit(pick);
    return { planes: all.length, below5000: low.length, lit: lit.length, litList: lit.map((p) => p.callsign() + ' ' + p.altFt + 'ft ' + p.vrate), unlitLow: low.filter((p) => p.landLevel < 0.5).map((p) => p.callsign() + ' ' + p.altFt + 'ft ' + p.vrate), visiting: pick ? pick.callsign() : null };
  });
  console.log(JSON.stringify(info));
  for (const t of [22, 40]) { await page.evaluate(`window.__adv(${t})`); await page.waitForTimeout(1800); await page.evaluate('window.__sky.step(0.0001, true)'); await page.screenshot({ path: `${out}_${t}.png` }); }
  await browser.close();
})();
