// Version 3.12.2: where the followed flight is, in words, from a place list carried in the page (build/towns.txt, made by
// tools/towns.py from GeoNames). Nothing is asked of any service: the flight's position never leaves the browser.
// Near a town (within NEAR_NM) the line names that town: "12 nm NE of Danbury, CT". Farther out, which over open water is
// most of the time, it names the nearest place in up to three directions at least 90 degrees apart, like a navigator's fix.
// Distances are in nautical miles (Chris, November 23), and each direction is from the place to the aircraft.
import { gcDist, bearing, angDiff } from './util.js';

export const NM = 1.852;           // km per nautical mile
export const NEAR_NM = 25;         // Chris, November 23: the town line within 25, the three directions beyond
export const FAR_NM = 1500;        // a second or third place farther than this says nothing useful, so it is left off
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const point = (deg) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// The list as the page carries it: "@region" lines, then "name<TAB>lat<TAB>lon" lines in hundredths of a degree.
export function parseTowns(text) {
  const name = [], reg = [], regions = [], lat = [], lon = [];
  let r = -1;
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    if (line[0] === '@') { regions.push(line.slice(1)); r = regions.length - 1; continue; }
    const f = line.split('\t'); if (f.length !== 3 || r < 0) continue;
    const a = +f[1] / 100, o = +f[2] / 100; if (!isFinite(a) || !isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180) continue;
    name.push(f[0]); reg.push(r); lat.push(a); lon.push(o);
  }
  return { name, reg, regions, lat: Float64Array.from(lat), lon: Float64Array.from(lon), n: name.length };
}

const label = (T, i) => T.name[i] + (T.regions[T.reg[i]] ? ', ' + T.regions[T.reg[i]] : '');

// The places for a position: [{ i, nm, dir, text }], one when a town is near, otherwise up to three.
export function nearestPlaces(T, lat, lon) {
  if (!T || !T.n || !isFinite(lat) || !isFinite(lon)) return [];
  const dist = new Float64Array(T.n);
  let best = -1;
  for (let i = 0; i < T.n; i++) { dist[i] = gcDist(lat, lon, T.lat[i], T.lon[i]); if (best < 0 || dist[i] < dist[best]) best = i; }
  const pick = (i) => {
    const nm = dist[i] / NM, dir = point(bearing(T.lat[i], T.lon[i], lat, lon));
    return { i, nm, dir, text: nm < 1 ? 'Over ' + label(T, i) : Math.round(nm) + ' nm ' + dir + ' of ' + label(T, i) };
  };
  if (dist[best] / NM <= NEAR_NM) return [pick(best)];
  // the nearest place, then the nearest that lies at least 90 degrees round the compass from those already chosen
  const out = [best], toward = [bearing(lat, lon, T.lat[best], T.lon[best])];
  while (out.length < 3) {
    let next = -1;
    for (let i = 0; i < T.n; i++) {
      if (next >= 0 && dist[i] >= dist[next]) continue;
      const b = bearing(lat, lon, T.lat[i], T.lon[i]);
      if (toward.every((t) => Math.abs(angDiff(t, b)) >= 90)) next = i;
    }
    if (next < 0 || dist[next] / NM > FAR_NM) break;
    out.push(next); toward.push(bearing(lat, lon, T.lat[next], T.lon[next]));
  }
  return out.map(pick);
}
export const whereText = (list) => list.map((x) => x.text).join(' · ');
