const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('http://localhost:8090/sky/?routeApi=/mock/routeset&posApi=/mock/v2/&dpr=1&sky=day');
  const st = () => page.evaluate(() => ({ panel: document.body.classList.contains('panel'), center: window.__sky.S.center, radius: window.__sky.S.radius, follow: window.__sky.follow.want + '/' + window.__sky.follow.state, shot: window.__sky.shot.kind, stopHidden: document.getElementById('f-stop').hidden, stored: localStorage.getItem('sky3d'), origin: [window.__sky.proj.lat0.toFixed(2), window.__sky.proj.lon0.toFixed(2)], ring: window.__sky.ground.ring.count, msg: document.getElementById('msg').className + ':' + document.getElementById('msg').innerText }));
  await page.waitForTimeout(3000); await page.keyboard.press('s'); await page.waitForTimeout(800); console.log('open', JSON.stringify(await st()));
  await page.selectOption('#f-center', 'KBDR'); await page.selectOption('#f-radius', '50'); await page.selectOption('#f-pace', '12'); await page.selectOption('#f-trail', '10'); await page.waitForTimeout(1500); console.log('bdr', JSON.stringify(await st()));
  await page.selectOption('#f-center', 'OTHER'); await page.fill('#f-other', 'phl'); await page.waitForTimeout(1500); console.log('phl', JSON.stringify(await st()), await page.textContent('#other-note'));
  await page.selectOption('#f-center', 'MID'); await page.fill('#f-flight', 'dl 2210'); await page.click('#f-follow button[type=submit]'); await page.keyboard.press('Escape'); await page.waitForTimeout(30000); console.log('follow', JSON.stringify(await st()));
  await page.screenshot({ path: 'build/shots/ui_follow.png' });
  await page.keyboard.press('s'); await page.click('#f-stop'); await page.keyboard.press('Escape'); await page.waitForTimeout(4000); console.log('stopped', JSON.stringify(await st()));
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(2000); await page.keyboard.press(' '); await page.waitForTimeout(14000); console.log('held', JSON.stringify(await st()));
  await page.keyboard.press('w'); await page.waitForTimeout(1500); console.log('wide', JSON.stringify(await st()));
  await page.reload(); await page.waitForTimeout(2500); console.log('reloaded', JSON.stringify(await st()));
  console.log('errors:', errs.join(' ; ') || 'none');
  await browser.close();
})();
