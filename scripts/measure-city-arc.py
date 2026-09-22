#!/usr/bin/env python3
"""Solve a CITY_PLACEMENT arc against a city's real water geometry.

rosters.ts describes how every measured arc in CITY_PLACEMENT was arrived at,
but the solver itself lived outside the repo, so a new waterfront city could
not be added without redoing it from the description. This is that solver.

THE METHOD, matching the note in rosters.ts. For each bearing we walk outwards
from the anchor until a point falls in water; that gives the dry radius on that
bearing. The arc is the contiguous run of bearings maximising the wedge's AREA
-- the quantity that decides how far apart pins end up -- subject to a floor of
340 m so a fan never collapses into a stack. Where the arc alone still reaches
water, maxKm pulls the radius in to the measured dry limit.

The walk stops at 1,150 m because that is the widest fan the app ever draws:
spreadCoordsCity caps at `min(1.15, 0.4 + 0.055*sqrt(n))` km, so dry land beyond
it cannot hold a pin and must not inflate a wedge's score.

WATER IS TWO DIFFERENT THINGS IN OSM, and only one of them is a polygon. Rivers,
bays, harbours and reservoirs are closed ways (natural=water, natural=bay,
waterway=riverbank, landuse=reservoir) and a point-in-polygon test settles them
-- that is all Perth's Swan River or Sydney's Darling Harbour ever needed. The
open SEA is not a polygon at all: it is implied by natural=coastline ways, drawn
by convention with land on the LEFT of the direction of travel. A city on a
strait or an island -- Johor Bahru, George Town -- is bounded almost entirely by
that second kind, so a solver testing only polygons calls the sea dry land and
cheerfully fans pins into it. Both tests are applied here.

Usage:
  python3 scripts/measure-city-arc.py --name penang --at 100.3293,5.4141
  python3 scripts/measure-city-arc.py --name johorbahru --at 103.7614,1.4655 --n 60
"""
import argparse, math, os, subprocess, sys

WATER_TAGS = (("natural", "water"), ("natural", "bay"),
              ("waterway", "riverbank"), ("landuse", "reservoir"))
FLOOR_M = 340.0     # rosters.ts: a fan must never collapse into a stack
WALK_M = 1150.0     # spreadCoordsCity's hard ceiling on fan radius
STEP_M = 10.0


def _get(box, depth=0):
    """Fetch one bbox, splitting it when the API says it holds too many nodes.

    The map API refuses any box holding more than 50,000 nodes, and a dense
    city centre passes that well inside the radius we need, so a single request
    is not enough on its own. Splitting keeps every request legal while still
    covering the whole box.
    """
    w, s_, e, n = box
    url = "https://api.openstreetmap.org/api/0.6/map?bbox=%f,%f,%f,%f" % box
    out = b""
    for _ in range(3):
        p = subprocess.run(["curl", "-s", "--max-time", "120",
                            "-A", "employsi-hub-placement/1.0", url],
                           capture_output=True)
        if p.returncode == 0 and p.stdout.lstrip()[:5] == b"<?xml":
            return [p.stdout]
        out = p.stdout or b""
        if b"too many nodes" in out:
            break
    if depth >= 4:
        sys.exit("bbox still too large after %d splits" % depth)
    mx, my = (w + e) / 2.0, (s_ + n) / 2.0
    parts = []
    for q in ((w, s_, mx, my), (mx, s_, e, my), (w, my, mx, n), (mx, my, e, n)):
        parts.extend(_get(q, depth + 1))
    return parts


def fetch(lon, lat, radius=1600, cache=None):
    """Pull the bbox straight from the OSM API rather than from Overpass.

    Overpass is the natural tool and the first version of this used it, but
    from a sandboxed network it is not dependable: tiny node queries answer,
    and every geometry query -- even one coastline way clipped to a 1.5 km box
    -- times out against all three public mirrors. The map API answers the same
    box in seconds because it is a flat bbox extract with no query planner in
    front of it. It also returns every node referenced by a way it returns,
    including nodes outside the box, so a way crossing the boundary still
    arrives with complete geometry.

    The default radius is 1.6 km rather than something generous: the walk stops
    at 1.15 km, and the margin only has to be wide enough that the nearest
    coastline segment to a probed point is inside the box.
    """
    import xml.etree.ElementTree as ET

    dlat = radius / 110540.0
    dlon = radius / (111320.0 * math.cos(math.radians(lat)))
    box = (lon - dlon, lat - dlat, lon + dlon, lat + dlat)
    if cache and os.path.exists(cache):
        blobs = [open(cache, "rb").read()]
    else:
        blobs = _get(box)
        if cache:
            open(cache, "wb").write(blobs[0] if len(blobs) == 1 else b"")

    nodes, ways = {}, []
    for blob in blobs:
        root = ET.fromstring(blob)
        for nd in root.iter("node"):
            nodes[nd.get("id")] = (float(nd.get("lon")), float(nd.get("lat")))
        for w in root.iter("way"):
            ways.append(({t.get("k"): t.get("v") for t in w.findall("tag")},
                         [r.get("ref") for r in w.findall("nd")]))

    polys, coast = [], []
    for tags, refs in ways:
        pts = [nodes[r] for r in refs if r in nodes]
        if len(pts) < 2:
            continue
        if tags.get("natural") == "coastline":
            coast.append(pts)
        elif any(tags.get(k) == v for k, v in WATER_TAGS):
            if len(pts) >= 4 and pts[0] == pts[-1]:
                polys.append(pts)
    return polys, coast


class Frame:
    """Local metre frame centred on the anchor."""

    def __init__(self, lon, lat):
        self.lon, self.lat = lon, lat
        self.mx = 111320.0 * math.cos(math.radians(lat))
        self.my = 110540.0

    def to_m(self, lon, lat):
        return ((lon - self.lon) * self.mx, (lat - self.lat) * self.my)

    def at(self, bearing_deg, r_m):
        rad = math.radians(bearing_deg)
        return (self.lon + math.sin(rad) * r_m / self.mx,
                self.lat + math.cos(rad) * r_m / self.my)


def in_poly(pt, poly, bbox):
    x, y = pt
    if not (bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3]):
        return False
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            if x1 + (y - y1) / (y2 - y1) * (x2 - x1) > x:
                inside = not inside
    return inside


class CoastIndex:
    """Uniform grid over coastline segments, so a side test is local.

    Scanning every segment for every probe is what makes the naive walk
    unusable here: a city on a strait pulls tens of thousands of segments and
    the walk probes tens of thousands of points. The grid turns each query into
    a look at a handful of nearby cells.

    OSM draws natural=coastline with land on the LEFT of the direction of
    travel, so a point to the RIGHT of the nearest segment is at sea.
    """

    CELL = 200.0

    def __init__(self, ways_m):
        self.segs = []
        for way in ways_m:
            for i in range(len(way) - 1):
                a, b = way[i], way[i + 1]
                if a != b:
                    self.segs.append((a[0], a[1], b[0] - a[0], b[1] - a[1]))
        self.grid = {}
        for idx, (ax, ay, dx, dy) in enumerate(self.segs):
            x0, x1 = sorted((ax, ax + dx))
            y0, y1 = sorted((ay, ay + dy))
            for cx in range(int(x0 // self.CELL), int(x1 // self.CELL) + 1):
                for cy in range(int(y0 // self.CELL), int(y1 // self.CELL) + 1):
                    self.grid.setdefault((cx, cy), []).append(idx)

    def _near(self, px, py, ring):
        cx, cy = int(px // self.CELL), int(py // self.CELL)
        out = []
        for i in range(cx - ring, cx + ring + 1):
            for j in range(cy - ring, cy + ring + 1):
                if ring == 0 or abs(i - cx) == ring or abs(j - cy) == ring:
                    out.extend(self.grid.get((i, j), ()))
        return out

    def seaward(self, pt):
        if not self.segs:
            return False
        px, py = pt
        best, best_d2, cand = None, float("inf"), []
        ring = 0
        while ring <= 40:
            cand = self._near(px, py, ring)
            for idx in cand:
                ax, ay, dx, dy = self.segs[idx]
                L2 = dx * dx + dy * dy
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2
                if d2 < best_d2:
                    best_d2, best = d2, (ax, ay, dx, dy)
            # Once something is found, widen far enough that no nearer segment
            # can hide in an untouched cell, then stop.
            if best is not None and (ring * self.CELL) ** 2 >= best_d2:
                break
            ring += 1
        if best is None:
            return False
        ax, ay, dx, dy = best
        return (dx * (py - ay) - dy * (px - ax)) < 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--at", required=True, help="lon,lat of the anchor")
    ap.add_argument("--n", type=int, default=120, help="fan size to validate")
    ap.add_argument("--cache", default="", help="file to cache the Overpass pull in")
    a = ap.parse_args()
    lon, lat = [float(v) for v in a.at.split(",")]
    fr = Frame(lon, lat)

    polys, coast = fetch(lon, lat, cache=(a.cache or None))
    polys_m = [[fr.to_m(*p) for p in poly] for poly in polys]
    boxes = [(min(q[0] for q in p), min(q[1] for q in p),
              max(q[0] for q in p), max(q[1] for q in p)) for p in polys_m]
    coast_m = [[fr.to_m(*p) for p in way] for way in coast]
    coast = CoastIndex(coast_m)
    print("%s: %d water polygons, %d coastline ways (%d segments)"
          % (a.name, len(polys_m), len(coast_m), len(coast.segs)))

    cache = {}

    def wet(lon_, lat_):
        p = fr.to_m(lon_, lat_)
        k = (round(p[0]), round(p[1]))
        v = cache.get(k)
        if v is None:
            v = any(in_poly(p, polys_m[i], boxes[i]) for i in range(len(polys_m))) \
                or coast.seaward(p)
            cache[k] = v
        return v

    if wet(lon, lat):
        sys.exit("ANCHOR IS IN WATER -- pick another anchor")

    dry = []
    for b in range(360):
        r = STEP_M
        while r <= WALK_M:
            if wet(*fr.at(b, r)):
                break
            r += STEP_M
        dry.append(min(r - STEP_M, WALK_M))

    ok = [i for i in range(360) if dry[i] >= FLOOR_M]
    if not ok:
        sys.exit("no bearing is dry to the %d m floor" % FLOOR_M)
    if len(ok) == 360:
        print("  full circle is dry to %.0f m -- no arc needed" % min(dry))
        return

    best = None
    for s in range(360):
        if dry[s] < FLOOR_M or dry[(s - 1) % 360] >= FLOOR_M:
            continue                      # only start a run at its first bearing
        r, span = WALK_M, 0
        while span < 360 and dry[(s + span) % 360] >= FLOOR_M:
            r = min(r, dry[(s + span) % 360])
            span += 1
            area = 0.5 * r * r * math.radians(span)
            if best is None or area > best[0]:
                best = (area, s, span, r)
    area, s, span, r = best
    arc = [s % 360, (s + span) % 360]
    print("  arc [%d, %d]  span %d deg  dry to %.0f m  wedge %.0f m2 (%.0f m2/pin at n=%d)"
          % (arc[0], arc[1], span, r, area, area / max(1, a.n), a.n))

    # Acceptance test: the real fan, at the real radius, must be entirely dry.
    # maxKm is for water, not for company count. spreadCoordsCity already
    # shrinks the fan for a small roster via `0.4 + 0.055*sqrt(n)`; pinning
    # that number into the data would freeze today's roster size into it and
    # keep the fan small after the city grows. So maxKm is emitted only when
    # the measured dry limit is tighter than the app's own 1.15 km ceiling,
    # and the validation below runs at the widest fan the app could draw.
    water_km = math.floor(r / 100) / 10.0
    maxkm = water_km if r < WALK_M else min(1.15, 0.4 + 0.055 * math.sqrt(max(1, a.n)))
    GR = (math.sqrt(5) - 1) / 2
    wetpins = 0
    for i in range(a.n):
        rr = math.sqrt((i + 0.5) / a.n) * maxkm * 1000
        deg = arc[0] + ((i * GR) % 1) * (span if span > 0 else 360)
        if wet(*fr.at(deg, rr)):
            wetpins += 1
    print("  fan of %d at maxKm %.2f: %d in water" % (a.n, maxkm, wetpins))
    emit = '{ anchor: [%.4f, %.4f], arc: [%d, %d]' % (lon, lat, arc[0], arc[1])
    if r < WALK_M:
        emit += ", maxKm: %.1f" % water_km
    print("  %s: %s }," % (a.name, emit))


if __name__ == "__main__":
    main()
