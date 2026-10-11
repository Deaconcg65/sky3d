// Opens the network edition with the real clock, the way a person would, with and without a receiver in reach.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [label, q, wait] of [['receiver and network', 'netApi=/mock/v2/', 24], ['no receiver', 'netApi=/mock/v2/&data=/nowhere/', 24], ['no receiver, antenna only', 'netApi=/mock/v2/&data=/nowhere/&src=antenna', 14], ['network down, receiver up', 'netApi=/nowhere/', 20], ['both down', 'netApi=/nowhere/&data=/nowhere/', 50]]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const errs = [];
    page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
    await page.goto('http://localhost:8090/net/?routeApi=/mock/routeset&posApi=/mock/v2/&dpr=1&wx=clear&sky=day&' + q); await page.waitForTimeout(wait * 1000);
    const r = await page.evaluate(() => { const s = window.__sky, live = [...s.planes.values()].filter((p) => p.lat !== null && p.opacity > 0.5);
      return { shown: live.length, antenna: live.filter((p) => p.src === 'ant').length, network: live.filter((p) => p.src === 'net').length, shot: s.shot.kind, corner: document.getElementById('corner').innerText.split('\n').pop(), msg: document.getElementById('msg').className + ':' + document.getElementById('msg').innerText }; });
    console.log(label.padEnd(26), JSON.stringify(r), errs.join(' ; ')); await page.close();
  }
  await browser.close();
})();
