const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const url of ['file://' + require('path').join(__dirname, '..', 'build', 'sky3d.html'), 'http://localhost:8090/sky/']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const errs = [];
    page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
    await page.goto(url); await page.waitForTimeout(url.startsWith('file') ? 9000 : 26000);
    const info = await page.evaluate(() => ({ planes: window.__sky.planes.size, shot: window.__sky.shot.kind, cap: document.getElementById('cap').className + ':' + document.getElementById('cap').innerText.replace(/\n/g, ' | '), msg: document.getElementById('msg').className + ':' + document.getElementById('msg').innerText }));
    console.log(url, JSON.stringify(info), errs.join(' ; ')); await page.close();
  }
  await browser.close();
})();
