// Checks the network edition: how many aircraft come from the antenna and how many from the flight network under each
// "Aircraft from" choice, with and without a receiver in reach. Run with the stand-in receiver (tools/sim.js) going.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const run = async (label, query, secs, shot) => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }); const errs = [];
    page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
    await page.goto('http://localhost:8090/net/?clock=manual&routeApi=/mock/routeset&posApi=/mock/v2/&netApi=/mock/v2/&dpr=1&wx=clear&sky=day&pace=30&' + query);
    const r = await page.evaluate(async (secs) => {
      const s = window.__sky, T0 = Date.now() / 1000 - 30; let vt = 0, flips = 0; const last = new Map();
      for (let i = 0; i < secs * 60; i++) {
        if (i % 60 === 0) await s.feed((T0 + vt).toFixed(3));
        s.step(1 / 60, false); vt += 1 / 60;
        for (const p of s.planes.values()) { const was = last.get(p.hex); if (was && was !== p.src) flips++; last.set(p.hex, p.src); }
      }
      s.step(0.0001, true);
      const t = vt, live = [...s.planes.values()].filter((p) => p.lat !== null && p.opacity > 0.5);
      const ant = live.filter((p) => p.src === 'ant'), nw = live.filter((p) => p.src === 'net');
      const low = (a) => a.filter((p) => p.altFt < 2000).length;
      return { shown: live.length, antenna: ant.length, network: nw.length, antennaBelow2000ft: low(ant), networkBelow2000ft: low(nw), changedHands: flips, netOk: s.net.ok,
        corner: document.getElementById('corner').innerText.replace(/\n/g, ' | '), cap: document.getElementById('cap').innerText.replace(/\n/g, ' | '), msg: document.getElementById('msg').className + ':' + document.getElementById('msg').innerText };
    }, secs);
    if (shot) { await page.waitForTimeout(1500); await page.evaluate('window.__sky.step(0.0001, true)'); await page.screenshot({ path: shot }); }
    console.log(label.padEnd(26), JSON.stringify(r), errs.join(' ; ')); await page.close();
  };
  await run('antenna and network', 'src=blend', 40, 'build/shots/blend.png');
  await run('antenna only', 'src=antenna', 40);
  await run('network only', 'src=network', 40);
  await run('no receiver in reach', 'src=blend&noant=1', 40, 'build/shots/noant.png');
  await run('no receiver, antenna only', 'src=antenna&noant=1', 12);
  await browser.close();
})();
