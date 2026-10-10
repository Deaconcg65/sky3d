// usage: node shot.js <out prefix> <query string> <comma list of seconds to capture at> [js to run at start]
const { chromium } = require('playwright');
(async () => {
  const [, , out, query = '', times = '6', js = ''] = process.argv;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const logs = []; page.on('console', (m) => logs.push(m.type() + ': ' + m.text())); page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8090/sky/?routeApi=/mock/routeset&posApi=/mock/v2/&dpr=1&' + query);
  if (js) await page.evaluate(js);
  let prev = 0;
  for (const s of times.split(',').map(Number)) { await page.waitForTimeout((s - prev) * 1000); prev = s; await page.screenshot({ path: `${out}_${s}.png` }); }
  const info = await page.evaluate(() => ({ planes: window.__sky ? window.__sky.planes.size : -1, shot: window.__sky && window.__sky.shot.kind, pose: window.__sky && window.__sky.pose, cap: document.getElementById('cap').innerText, msg: document.getElementById('msg').innerText }));
  console.log(JSON.stringify(info)); console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
})();
