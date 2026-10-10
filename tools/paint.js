// Draws a line-up of aircraft in their paint, for checking liveries by eye.
// usage: node paint.js <out.png> <comma list of callsign prefixes> [sky] [view: side|top|under]
const { chromium } = require('playwright');
(async () => {
  const [, , out, list = 'AAL,DAL,UAL,JBU,SWA,ACA', sky = 'day', view = 'side', lit = '0.1,0,0'] = process.argv;   // lit: time in the flash cycle, landing lights 0 to 1, camera ahead -1 to 1
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('console: ' + m.text()); });
  await page.goto('http://localhost:8090/sky/?clock=manual&dpr=1&wx=clear&corner=0&sky=' + sky);
  await page.evaluate(({ list, view, lit }) => {
    window.__lit = lit; const s = window.__sky; s.step(0.5, false);
    const names = list.split(','), cols = Math.min(4, Math.ceil(Math.sqrt(names.length))), rows = Math.ceil(names.length / cols);
    for (const c of s.scene.children) if (c.type === 'Group' || c.type === 'Mesh') c.visible = c.type === 'Mesh' && c.renderOrder === -10;
    names.forEach((n, i) => {
      const kind = n.includes(':') ? n.split(':')[1] : 'jet', cs = n.split(':')[0];
      const m = new s.PlaneMesh(kind, s.paintFor(cs === 'N' ? 'N123AB' : cs + '123', 'a' + i + 'b' + i, kind));
      m.group.position.set((i % cols - (cols - 1) / 2) * 1.35, 1000 - (Math.floor(i / cols) - (rows - 1) / 2) * 0.62, 0);
      m.group.rotation.set(0, view === 'side' ? Math.PI / 2 - 0.5 : Math.PI / 2, 0); m.phase = 0;
      const [tt, land, ahead] = (window.__lit || '0.1,0,0').split(',').map(Number);
      m.update(tt, 1, s.look.night, s.look.body, 0, land, ahead); s.scene.add(m.group);
    });
    const d = Math.max(cols * 1.35 / 1.7, rows * 0.62 / 0.62) * 1.75;
    if (view === 'top') { s.camera.position.set(0, 1000 + d, 0.01); } else if (view === 'under') { s.camera.position.set(0, 1000 - d * 0.5, d * 0.85); } else s.camera.position.set(0, 1000 + d * 0.22, d);
    s.camera.up.set(0, 1, 0); s.camera.lookAt(0, 1000, 0); s.camera.near = 0.05; s.camera.updateProjectionMatrix();
    s.renderer.render(s.scene, s.camera);
  }, { list, view, lit });
  await page.waitForTimeout(500);
  await page.screenshot({ path: out });
  await browser.close();
})();
