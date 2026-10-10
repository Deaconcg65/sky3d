// usage: node render.js <out prefix> <query> <comma list of virtual seconds to capture> [js at start]
const { chromium } = require('playwright');
(async () => {
  const [, , out, query = '', times = '20', js = ''] = process.argv;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8090/sky/?clock=manual&routeApi=/mock/routeset&posApi=/mock/v2/&dpr=1&' + query);
  await page.evaluate(`window.__vt = 0; window.__T0 = Date.now() / 1000 - 30; window.__adv = async (to) => { const s = window.__sky; while (window.__vt < to) { if (Math.round(window.__vt * 60) % 60 === 0) { await s.feed((window.__T0 + window.__vt).toFixed(3)); if (s.follow.want) await s.followTick(); } s.step(1 / 60, false); window.__vt += 1 / 60; } s.step(0.0001, true); }; ${js}`);
  for (const s of times.split(',').map(Number)) { await page.evaluate(`window.__adv(${s})`); await page.waitForTimeout(2200); await page.evaluate('window.__sky.step(0.0001, true)'); await page.screenshot({ path: `${out}_${s}.png` }); }
  const info = await page.evaluate(() => ({ shot: window.__sky.shot.kind, cap: document.getElementById('cap').innerText.replace(/\n/g, ' | '), msg: document.getElementById('msg').className + ':' + document.getElementById('msg').innerText }));
  console.log(JSON.stringify(info));
  await browser.close();
})();
