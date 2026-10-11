// Checks the weather layer in numbers: which marks are showing for each weather choice, and that lightning flickers in a storm.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const wx of ['clear', 'cloud', 'overcast', 'rain', 'storm', 'snow', 'wind', 'fog']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const errs = [];
    page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
    await page.goto('http://localhost:8090' + (process.env.SKY_PATH || '/sky/') + '?clock=manual&dpr=1&sky=day&wx=' + wx);
    const r = await page.evaluate(() => {
      const s = window.__sky; let flash = 0, flashes = 0, was = 0;
      for (let i = 0; i < 60 * 60; i++) { s.step(1 / 60, false); const f = s.sky.uniforms.flash.value; if (f > flash) flash = f; if (f > 0.2 && was <= 0.2) flashes++; was = f; }
      const w = s.weather, sh = (f) => (f.mesh.visible ? +(f.u.amount.value * f.u.opacity.value).toFixed(2) : 0);
      return { rain: sh(w.rain), snow: sh(w.snow), wind: sh(w.wind), cover: +s.sky.uniforms.cover.value.toFixed(2), fog: +(s.scene.fog.density / 0.0024).toFixed(2), flashes, flashPeak: +flash.toFixed(2) };
    });
    console.log(wx.padEnd(9), JSON.stringify(r), errs.join(' ; ')); await page.close();
  }
  await browser.close();
})();
