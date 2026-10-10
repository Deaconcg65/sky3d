// Small helpers: geodesy, sun position, text formatting.
export const R_EARTH = 6371.0;          // km
export const FT = 0.0003048;            // km per foot
export const KT = 0.000514444;          // km per second per knot
export const MI = 1.609344;             // km per statute mile
export const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const angDiff = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
export const lerpAng = (a, b, t) => a + angDiff(a, b) * t;

export function gcDist(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R, dp = p2 - p1;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}
export function destPoint(lat, lon, brg, dist) {
  const d = dist / R_EARTH, b = brg * D2R, p1 = lat * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = lon * D2R + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 * R2D, ((l2 * R2D + 540) % 360) - 180];
}

// Sun elevation and azimuth in degrees for a date and place (NOAA approximation, good to a fraction of a degree).
export function sunPosition(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5, n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, eps = (23.439 - 0.0000004 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = ((gmst * 15 + lon) * D2R) - ra, p = lat * D2R;
  const el = Math.asin(Math.sin(p) * Math.sin(dec) + Math.cos(p) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(p) - Math.sin(p) * Math.cos(ha));
  return { el: el * R2D, az: (az * R2D + 360) % 360 };
}

export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

const SMALL = { DE: 'De', DA: 'Da', DU: 'Du', VAN: 'Van', DER: 'der', AIR: 'Air' };
export function prettyType(s) {
  if (!s) return '';
  return s.trim().split(/\s+/).map((w) => {
    if (SMALL[w]) return SMALL[w];
    if (/^[A-Z]{4,}$/.test(w)) return w[0] + w.slice(1).toLowerCase();
    return w;
  }).join(' ');
}
