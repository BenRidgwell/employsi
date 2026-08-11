#!/usr/bin/env python3
"""Generate src/employsi/data/worldOutline.ts — a coastline path for the company
card's hot-spot map.

The card needs a flat world to put bubbles on, and Mapbox is not an option
inside a 440px panel that already has two Mapbox canvases behind it. So the
coastline ships as one static SVG path.

Source is Natural Earth 1:110m land, via the world-atlas package (public
domain). It is fetched once and cached; nothing schedules this and the corpus
does not move.

    python3 scripts/gen-world-outline.py

Three things this has to get right, each of which produced a visible defect
first time round:

  * ANTIMERIDIAN. A ring stepping from +179 to -179 has moved one degree in the
    world and half a map in this projection. Drawn naively it sweeps a bar
    straight across the image. Rings are split at the crossing.
  * CLOSED-RING SIMPLIFICATION. Douglas-Peucker assumes an open line. Handed a
    ring whose first and last points coincide it measures every vertex against
    a zero-length baseline, finds distance 0 everywhere, and collapses the whole
    landmass to two points. Rings are split in half before simplifying.
  * ANTARCTICA. It holds no hub and ate a fifth of the height, so the
    projection stops at 60S.
"""
import json
import math
import os
import sys
import urllib.request

SRC = "https://unpkg.com/world-atlas@2.0.2/land-110m.json"
CACHE = "/tmp/land-110m.json"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "employsi", "data", "worldOutline.ts")

# The viewBox the card draws into, and the latitudes it spans.
W, H = 360.0, 170.0
LAT_TOP, LAT_BOT = 84.0, -60.0
# Rings smaller than this in viewBox units are below a pixel on a 440px card.
MIN_AREA = 0.9
# Douglas-Peucker tolerance, in viewBox units. At 360 units across a ~384px
# card, 0.35 is about a third of a pixel.
EPS = 0.35

sys.setrecursionlimit(20000)


def load():
    if not os.path.exists(CACHE):
        print(f"fetching {SRC}")
        with urllib.request.urlopen(SRC, timeout=60) as r:
            open(CACHE, "wb").write(r.read())
    return json.load(open(CACHE))


def main():
    topo = load()
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]

    def arc(i):
        """TopoJSON arcs are delta-encoded; a negative index means reversed."""
        rev = i < 0
        if rev:
            i = ~i
        x = y = 0
        out = []
        for dx, dy in topo["arcs"][i]:
            x += dx
            y += dy
            out.append((x * sx + tx, y * sy + ty))
        return out[::-1] if rev else out

    def proj(lng, lat):
        return ((lng + 180.0) / 360.0 * W, (LAT_TOP - lat) / (LAT_TOP - LAT_BOT) * H)

    def area(pts):
        a = 0.0
        for i in range(len(pts)):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % len(pts)]
            a += x1 * y2 - x2 * y1
        return abs(a) / 2

    def rdp(pts, eps):
        if len(pts) < 3:
            return pts
        (x1, y1), (x2, y2) = pts[0], pts[-1]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy)
        dmax, idx = 0.0, 0
        for i in range(1, len(pts) - 1):
            x0, y0 = pts[i]
            d = (
                abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
                if norm
                else math.hypot(x0 - x1, y0 - y1)
            )
            if d > dmax:
                dmax, idx = d, i
        if dmax > eps:
            return rdp(pts[: idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
        return [pts[0], pts[-1]]

    def simplify_ring(pts, eps):
        if pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 4:
            return pts
        h = len(pts) // 2
        return rdp(pts[: h + 1], eps)[:-1] + rdp(pts[h:] + [pts[0]], eps)[:-1]

    paths = []
    for poly in topo["objects"]["land"]["geometries"][0]["arcs"]:
        for ring in poly:
            raw = []
            for i in ring:
                raw.extend(arc(i))
            lonlat = [(lo, max(LAT_BOT, min(LAT_TOP, la))) for lo, la in raw if la >= LAT_BOT - 2]
            if len(lonlat) < 4:
                continue
            segs, cur = [], [lonlat[0]]
            for prev, nxt in zip(lonlat, lonlat[1:]):
                if abs(nxt[0] - prev[0]) > 180:
                    segs.append(cur)
                    cur = [nxt]
                else:
                    cur.append(nxt)
            segs.append(cur)
            for seg in segs:
                pts = [proj(lo, la) for lo, la in seg]
                if len(pts) < 4 or area(pts) < MIN_AREA:
                    continue
                s = simplify_ring(pts, EPS)
                if len(s) < 4:
                    continue
                paths.append("M" + "L".join(f"{round(x, 1):g} {round(y, 1):g}" for x, y in s) + "Z")

    d = "".join(paths)
    body = f"""// GENERATED — do not edit by hand. Run scripts/gen-world-outline.py.
//
// Natural Earth 1:110m land (public domain, via world-atlas), projected
// equirectangular into a {W:.0f}x{H:.0f} viewBox and simplified for a 440px card.
// Antarctica is cropped: the projection spans {LAT_TOP:.0f}N to {abs(LAT_BOT):.0f}S, because no hub
// sits below that and it was taking a fifth of the height.
//
// Rings: {len(paths)}.

/** Latitude span of the projection, so callers place points the same way. */
export const WORLD_LAT_TOP = {LAT_TOP};
export const WORLD_LAT_BOT = {LAT_BOT};
/** viewBox the path is drawn in. */
export const WORLD_W = {W:.0f};
export const WORLD_H = {H:.0f};

/** lng/lat to viewBox coordinates, matching the projection above. */
export function worldProject(lng: number, lat: number): [number, number] {{
  return [
    ((lng + 180) / 360) * WORLD_W,
    ((WORLD_LAT_TOP - lat) / (WORLD_LAT_TOP - WORLD_LAT_BOT)) * WORLD_H,
  ];
}}

export const WORLD_OUTLINE =
  "{d}";
"""
    with open(OUT, "w") as f:
        f.write(body)
    print(f"wrote {os.path.relpath(OUT)} — {len(paths)} rings, {len(d)} path chars")


if __name__ == "__main__":
    main()
