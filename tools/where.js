// Checks the location line of version 3.12.2 without a browser: node tools/where.js
// It reads the place list the page carries (build/towns.txt) and the code that turns a position into words (src/where.js).
const fs = require('fs'), path = require('path');
let failed = 0;
const ok = (label, good, detail) => { if (!good) failed++; console.log((good ? 'ok    ' : 'FAIL  ') + label + (detail ? '   ' + detail : '')); };
(async () => {
  const { parseTowns, nearestPlaces, whereText, point, NEAR_NM, FAR_NM } = await import(path.join(__dirname, '../src/where.js'));
  const { bearing, angDiff, gcDist } = await import(path.join(__dirname, '../src/util.js'));
  const text = fs.readFileSync(path.join(__dirname, '../build/towns.txt'), 'utf8'), T = parseTowns(text);
  ok('the place list has the expected size', T.n > 30000 && T.n < 60000, T.n + ' places');
  ok('the place list holds nothing the page could mistake for markup', !/[<>&]/.test(text));
  ok('small towns near home are in the list', ['Danbury', 'Ridgefield', 'Bethel', 'Newtown'].every((n) => T.name.some((x, i) => x === n && T.regions[T.reg[i]] === 'CT')));
  ok('compass points', ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'].join() === [0, 45, 90, 135, 180, 225, 270, 315, 359].map(point).join() && point(22) === 'N' && point(23) === 'NE');
  const over = whereText(nearestPlaces(T, 41.3948, -73.454));
  ok('right over Danbury it says so', over === 'Over Danbury, CT', over);
  // 12 nm north-east of Danbury: one town, within 25 nm, the direction measured from the town to the aircraft
  const d = 12 * 1.852 / 6371, b = 45 * Math.PI / 180, la1 = 41.3948 * Math.PI / 180, lo1 = -73.454 * Math.PI / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b)), lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  const near = nearestPlaces(T, la2 * 180 / Math.PI, lo2 * 180 / Math.PI), nt = whereText(near);
  ok('near a town: one place, within 25 nm, "nm <point> of <town>, <state>"', near.length === 1 && near[0].nm <= NEAR_NM && /^\d+ nm (N|NE|E|SE|S|SW|W|NW) of [^,]+, [A-Z]{2}$/.test(nt), nt);
  const check = near[0], from = bearing(T.lat[check.i], T.lon[check.i], la2 * 180 / Math.PI, lo2 * 180 / Math.PI);
  ok('the direction is from the town to the aircraft', point(from) === check.dir, check.dir + ' at ' + from.toFixed(0));
  // out over the Atlantic: three places, all beyond 25 nm, each at least 90 degrees round the compass from the others
  for (const [name, lat, lon, least] of [['the Atlantic', 42, -55, 3], ['the Gulf of Mexico', 26, -90, 3], ['the Pacific off California', 33, -128, 1]]) {
    const far = nearestPlaces(T, lat, lon), dirs = far.map((x) => bearing(lat, lon, T.lat[x.i], T.lon[x.i]));
    const apart = dirs.every((a, i) => dirs.every((c, j) => i === j || Math.abs(angDiff(a, c)) >= 90));
    const nearestFirst = far.length && far[0].nm === Math.min(...Array.from(T.lat, (_, i) => gcDist(lat, lon, T.lat[i], T.lon[i]) / 1.852));
    ok('over ' + name + ': up to three places in different directions, the nearest first, none past ' + FAR_NM + ' nm but the first', far.length >= least && far.length <= 3 && far.every((x) => x.nm > NEAR_NM) && far.slice(1).every((x) => x.nm <= FAR_NM) && apart && nearestFirst, whereText(far));
  }
  ok('a position that is not a number gives no line', nearestPlaces(T, NaN, 0).length === 0 && nearestPlaces(null, 40, -73).length === 0);
  const t0 = Date.now(); for (let i = 0; i < 20; i++) nearestPlaces(T, 30 + i, -60 - i); const ms = (Date.now() - t0) / 20;
  ok('fast enough to work out every few seconds', ms < 60, ms.toFixed(1) + ' ms each');
  console.log('errors:', failed ? failed : 'none');
  process.exitCode = failed ? 1 : 0;
})();
