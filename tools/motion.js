// Drives the page with a step-by-step clock at 60 frames a second and measures how smooth the camera and aircraft are.
const { chromium } = require('playwright');
(async () => {
  const secs = +(process.argv[2] || 80), query = process.argv[3] || '', js = process.argv[4] || '';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8090' + (process.env.SKY_PATH || '/sky/') + '?clock=manual&routeApi=/mock/routeset&posApi=/mock/v2/&dpr=1&' + query);
  const r = await page.evaluate(async ({ secs, js }) => {
    const s = window.__sky, T0 = Date.now() / 1000; let vt = 0; if (js) eval(js);
    const cam = [], kinds = [], jl = {}, spikes = []; let prevPos = new Map(), planeJumps = 0, worstPlane = 0, centerDev = 0, steps = 0, prevC = null, prevV = null, worstAcc = 0, worstAccAt = 0, maxSpeed = 0, maxSpeedAt = 0;
    const v3 = s.camera.position.clone();
    for (let i = 0; i < secs * 60; i++) {
      if (i % 60 === 0) { await s.feed((T0 + vt).toFixed(3)); if (s.follow.want) await s.followTick(); }
      s.step(1 / 60, false); vt += 1 / 60; steps++;
      const po = s.pose, ee = po.el * Math.PI / 180, aa = po.az * Math.PI / 180; const C = [(po.lon + 73.8) * 111.19 * Math.cos(po.lat * Math.PI / 180) + po.dist * Math.cos(ee) * Math.sin(aa), (po.lat - 40.7) * 111.19 - po.dist * Math.cos(ee) * Math.cos(aa), po.alt * 2.5 + po.dist * Math.sin(ee)];
      if (prevC) { const v = [C[0] - prevC[0], C[1] - prevC[1], C[2] - prevC[2]]; const sp = Math.hypot(...v) * 60; if (sp > maxSpeed) { maxSpeed = sp; maxSpeedAt = vt; }
        if (prevV) { const acc = Math.hypot(v[0] - prevV[0], v[1] - prevV[1], v[2] - prevV[2]) * 3600; const rel = acc / (sp + 0.5); if (rel > worstAcc) { worstAcc = rel; worstAccAt = vt; } if (rel > 3) spikes.push(vt.toFixed(2) + ':' + rel.toFixed(1)); } prevV = v; }
      prevC = C;
      if (kinds[kinds.length - 1] !== s.shot.kind) { kinds.push(vt.toFixed(1) + ':' + s.shot.kind); kinds.push(s.shot.kind); }
      for (const p of s.planes.values()) { if (p.lat === null || p.opacity < 0.9) { prevPos.delete(p.hex); continue; } const q = prevPos.get(p.hex); const cur = [p.rLat, p.rLon];
        if (q) { const d = Math.hypot((cur[0] - q[0]) * 111.19, (cur[1] - q[1]) * 111.19 * Math.cos(cur[0] * Math.PI / 180)); const exp = p.gs * 0.000514444 / 60; const ratio = d / Math.max(exp, 1e-5); if (ratio > 2.5 || ratio < 0.3) { planeJumps++; jl[p.hex + (p.remote ? ':remote' : '')] = (jl[p.hex + (p.remote ? ':remote' : '')] || 0) + 1; } if (ratio > worstPlane) worstPlane = ratio; } prevPos.set(p.hex, cur); }
      if (s.shot.kind === 'visit' && s.shot.plane && vt - s.shot.t0 > s.shot.dur + 0.5) { s.camera.updateMatrixWorld(); v3.copy(s.shot.plane.pos).project(s.camera); centerDev = Math.max(centerDev, Math.hypot(v3.x, v3.y)); }
    }
    return { steps, kinds: kinds.filter((x, i) => i % 2 === 0), camMaxSpeedKmS: +maxSpeed.toFixed(1), maxSpeedAt: +maxSpeedAt.toFixed(1), worstRelAccel: +worstAcc.toFixed(2), worstAccAt: +worstAccAt.toFixed(2), planeJumps, worstPlaneRatio: +worstPlane.toFixed(2), visitCenterDeviation: +centerDev.toFixed(4), planes: s.planes.size, jl, spikes: spikes.slice(0, 12), nSpikes: spikes.length, trailSegs: s.trails.count, coastSegs: s.ground.coast.count };
  }, { secs, js });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();
