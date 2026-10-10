#!/usr/bin/env python3
"""Cut Natural Earth land, lakes and state lines into small tiles and write compact JSON.
Run as: python3 -I geo.py <geo dir> <out json>"""
import json, sys, math
from shapely.geometry import shape, box, Polygon, MultiPolygon, LineString, MultiLineString, GeometryCollection
from shapely.ops import unary_union
from shapely import make_valid

GEO, OUT = sys.argv[1], sys.argv[2]

def load(name):
    with open(f"{GEO}/{name}.geojson") as f:
        return json.load(f)["features"]

A = (-80.0, 36.0, -66.0, 47.0)      # detailed box, north-east United States
B = (-170.0, 5.0, -50.0, 75.0)      # medium box, North America
boxA, boxB = box(*A), box(*B)
world = box(-180, -90, 180, 90)

def polys(g):
    if g.is_empty: return []
    if isinstance(g, Polygon): return [g]
    if isinstance(g, (MultiPolygon, GeometryCollection)):
        out = []
        for p in g.geoms: out += polys(p)
        return out
    return []

def lines(g):
    if g.is_empty: return []
    if isinstance(g, LineString): return [g]
    if isinstance(g, (MultiLineString, GeometryCollection)):
        out = []
        for p in g.geoms: out += lines(p)
        return out
    return []

def union(features, clip, flt=None):
    gs = []
    for f in features:
        if flt and not flt(f): continue
        g = make_valid(shape(f["geometry"]))
        if not g.intersects(clip): continue
        g = g.intersection(clip)
        if not g.is_empty: gs.append(g)
    return unary_union(gs) if gs else Polygon()

def enc(coords, q):
    """delta-encoded quantized ints: [x0,y0,dx,dy,...]"""
    out, px, py = [], 0, 0
    for x, y in coords:
        ix, iy = round(x * q), round(y * q)
        if out and ix == px and iy == py: continue
        out += [ix - px, iy - py]
        px, py = ix, iy
    return out

def tiles(land, lakes, borders, region, cell, tol, q, minarea, exclude=None):
    """Return list of tiles: {c:[lon,lat] centre, p:[[ring,hole,...],...], l:[coast lines], k:[lake polys], b:[border lines]}"""
    out = []
    w, s, e, n = region
    land_s = land.simplify(tol, preserve_topology=True) if tol else land
    lakes_s = lakes.simplify(tol, preserve_topology=True) if tol and not lakes.is_empty else lakes
    coast = land_s.boundary
    # remove the artificial edges of the clip region from the coastline
    frame = box(*region).boundary.buffer(1e-6)
    coast = coast.difference(frame)
    if exclude is not None:
        coast = coast.difference(exclude.boundary.buffer(1e-6))
    x = w
    npts = 0
    while x < e - 1e-9:
        y = s
        while y < n - 1e-9:
            c = box(x, y, min(x + cell, e), min(y + cell, n))
            if exclude is not None:
                c = c.difference(exclude)
                if c.is_empty:
                    y += cell; continue
            t = {"c": [round(x + cell / 2, 3), round(y + cell / 2, 3)], "p": [], "l": [], "k": [], "b": []}
            for p in polys(land_s.intersection(c)):
                if p.area < minarea: continue
                rings = [enc(p.exterior.coords, q)] + [enc(h.coords, q) for h in p.interiors if Polygon(h).area >= minarea]
                if len(rings[0]) >= 8: t["p"].append(rings)
            for l in lines(coast.intersection(c)):
                r = enc(l.coords, q)
                if len(r) >= 4: t["l"].append(r)
            if not lakes_s.is_empty:
                for p in polys(lakes_s.intersection(c)):
                    if p.area < minarea: continue
                    r = enc(p.exterior.coords, q)
                    if len(r) >= 8: t["k"].append(r)
            if borders is not None and not borders.is_empty:
                for l in lines(borders.intersection(c)):
                    r = enc(l.coords, q)
                    if len(r) >= 4: t["b"].append(r)
            if t["p"] or t["l"] or t["k"] or t["b"]:
                for key in ("p", "l", "k", "b"):
                    if not t[key]: del t[key]
                npts += sum(len(r) for k in t if k != "c" for item in t[k] for r in (item if k == "p" else [item])) // 2
                out.append(t)
            y += cell
        x += cell
    return out, npts

res = {}

# finest: GSHHG full-resolution shoreline around New York and southern New England,
# with the Hudson River (missing from GSHHG above midtown) taken from Natural Earth 10m
import numpy as np
H = (-76.5, 38.8, -69.5, 43.2)
boxH = box(*H)
GD = sys.argv[3]
def gshhg(res, clip):
    w, s_, e, n_ = clip.bounds
    dat = open(f"{GD}/gshhs_{res}.dat", "rb")
    land, lake = [], []
    for line in open(f"{GD}/gshhsmeta_{res}.dat"):
        p = line.split(); typ = int(p[0]); npts = int(p[2]); south = float(p[3]); north = float(p[4]); off = int(p[5]); nb = int(p[6])
        if north < s_ or south > n_ or npts < 4: continue
        dat.seek(off); a = np.frombuffer(dat.read(nb), dtype="<f4").reshape(npts, 2)
        lon = a[:, 0].astype("f8"); lon[lon > 180] -= 360
        if lon.max() < w or lon.min() > e: continue
        g = make_valid(Polygon(np.column_stack([lon, a[:, 1].astype("f8")]))).intersection(clip)
        if g.is_empty: continue
        (land if typ in (1, 3) else lake).append((typ, g))
    l1 = unary_union([g for t, g in land if t == 1])
    l2 = unary_union([g for t, g in lake if t == 2]) if lake else Polygon()
    l3 = unary_union([g for t, g in land if t == 3]) if any(t == 3 for t, g in land) else Polygon()
    return unary_union([l1.difference(l2), l3])
landH = gshhg("f", boxH)
ne10 = union(load("ne10land"), boxH)
corridor = box(-74.06, 40.755, -73.84, 41.34)
hudson = corridor.difference(ne10)
hudson = unary_union([p for p in polys(hudson) if p.area > 1e-4]).buffer(-0.004).buffer(0.002)
landH = landH.difference(hudson)
with open(f"{GEO}/cb_state_500k.json") as f:
    states = [make_valid(shape(ft["geometry"])) for ft in json.load(f)["features"]]
states = [s.intersection(boxH) for s in states if s.intersects(boxH)]
stU = unary_union(states)
allb = unary_union([s.boundary for s in states])
bordersH = allb.difference(stU.boundary.buffer(2e-5)).difference(boxH.boundary.buffer(1e-6))
bordersH = bordersH.intersection(landH.buffer(-0.0008)).simplify(0.002)
t, n = tiles(landH, Polygon(), bordersH, H, 0.5, 0.0006, 10000, 2e-7)
res["top"] = {"q": 10000, "t": t}; print("top tiles", len(t), "points", n, file=sys.stderr)

# detailed: 10m land in box A, minus box H
land10 = union(load("ne10land"), boxA)
lakes10 = union(load("ne_10m_lakes"), boxA, lambda f: (f["properties"].get("scalerank") or 9) <= 6)
bl = load("ne_50m_admin_1_states_provinces_lines")
borders = unary_union([shape(f["geometry"]) for f in bl])
bordersA = borders.intersection(boxA).simplify(0.004)
t, n = tiles(land10, lakes10, bordersA, A, 1.0, 0.0022, 10000, 2e-6, exclude=boxH)
res["hi"] = {"q": 10000, "t": t}; print("hi tiles", len(t), "points", n, file=sys.stderr)

# medium: 50m land in box B, minus box A
land50 = union(load("ne50land"), boxB)
lakes50 = union(load("ne_50m_lakes"), boxB)
bordersB = borders.intersection(boxB).simplify(0.02)
t, n = tiles(land50, lakes50, bordersB, B, 5.0, 0.02, 1000, 4e-4, exclude=boxA)
res["mid"] = {"q": 1000, "t": t}; print("mid tiles", len(t), "points", n, file=sys.stderr)

# low: 110m land for the rest of the world
land110 = union(load("ne_110m_land"), world)
t, n = tiles(land110, Polygon(), None, (-180, -90, 180, 90), 15.0, 0.0, 100, 1e-2, exclude=boxB)
res["lo"] = {"q": 100, "t": t}; print("lo tiles", len(t), "points", n, file=sys.stderr)

with open(OUT, "w") as f:
    json.dump(res, f, separators=(",", ":"))
