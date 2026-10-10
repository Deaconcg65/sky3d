import csv, json, sys
GEO, OUT = sys.argv[1], sys.argv[2]
B = (-170.0, 5.0, -50.0, 75.0)
A = (-80.0, 36.0, -66.0, 47.0)
keep = {}
for r in csv.DictReader(open(f"{GEO}/ourairports_airports.csv", encoding="utf-8")):
    t = r["type"]
    if t not in ("large_airport", "medium_airport", "small_airport"): continue
    try: lat, lon = float(r["latitude_deg"]), float(r["longitude_deg"])
    except ValueError: continue
    inB = B[0] <= lon <= B[2] and B[1] <= lat <= B[3]
    inA = A[0] <= lon <= A[2] and A[1] <= lat <= A[3]
    iata = r["iata_code"].strip()
    ok = (t == "large_airport") or (t == "medium_airport" and inA and iata) or (t == "small_airport" and inA and iata and r["scheduled_service"] == "yes")
    if not ok: continue
    name = r["name"].replace(" International Airport", " International").replace(" Airport", "").strip()
    keep[r["ident"]] = {"id": r["ident"], "ia": iata, "n": name, "c": r["municipality"], "la": round(lat, 4), "lo": round(lon, 4),
                        "e": int(float(r["elevation_ft"] or 0)), "s": {"large_airport": 2, "medium_airport": 1, "small_airport": 0}[t], "r": []}
nr = 0
for r in csv.DictReader(open(f"{GEO}/ourairports_runways.csv", encoding="utf-8")):
    a = keep.get(r["airport_ident"])
    if not a or r["closed"] == "1": continue
    try:
        c = [float(r["le_latitude_deg"]), float(r["le_longitude_deg"]), float(r["he_latitude_deg"]), float(r["he_longitude_deg"])]
    except ValueError: continue
    if (r["surface"] or "").upper().startswith(("WATER", "TURF", "GRASS")): continue
    a["r"].append([round(v, 5) for v in c] + [int(float(r["width_ft"] or 150))])
    nr += 1
out = [[a["id"], a["ia"], a["n"], a["c"], a["la"], a["lo"], a["e"], a["s"], a["r"]] for a in keep.values()]
json.dump(out, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
print(len(out), "airports", nr, "runways", file=sys.stderr)
for k in ("KJFK", "KLGA", "KEWR", "KHPN", "KBDR", "KHVN", "KISP", "KTEB", "KSWF", "KBDL", "KOXC", "KDXR"):
    a = keep.get(k); print(k, a and (a["ia"], a["n"], a["c"], a["s"], len(a["r"])), file=sys.stderr)
