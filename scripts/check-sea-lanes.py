#!/usr/bin/env python3
"""
Verify that every container-ship lane in WorldMapbox.tsx stays on water.

The ships used to run in a straight line between two hub cities, which sailed
them across continents — and three of those "ports" were inland (Ganzhou,
Johannesburg, and a Houston→London line that crosses Florida). The lanes are now
waypoint paths, and this checks the claim rather than trusting the eye: each
segment is sampled at 800 points and every sample is tested against a global
land mask.

Longitudes are taken as continuous (the Pacific lane runs past 180 rather than
wrapping) and normalised here before the lookup, matching how Mapbox renders it.

    pip install global-land-mask numpy
    python3 scripts/check-sea-lanes.py

Exits non-zero if any sample falls on land, so it can gate a change to the
lanes. Not part of `npm test` — it needs Python and the mask dataset.
"""
import re
import sys
from pathlib import Path

try:
    from global_land_mask import globe
except ImportError:  # pragma: no cover - developer tooling
    sys.exit("global-land-mask is not installed: pip install global-land-mask numpy")

SOURCE = Path(__file__).resolve().parent.parent / "src/employsi/components/WorldMapbox.tsx"
SAMPLES = 800


def normalise(lon: float) -> float:
    while lon > 180:
        lon -= 360
    while lon < -180:
        lon += 360
    return lon


def lanes():
    src = SOURCE.read_text()
    block = src[src.index("const SHIP_LANES") : src.index("// One traveler, resolved to a path")]
    for m in re.finditer(r'name:\s*"([^"]+)".*?path:\s*\[(.*?)\n    \],', block, re.S):
        pts = [
            (float(a), float(b))
            for a, b in re.findall(r"\[\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]", m.group(2))
        ]
        yield m.group(1), pts


def main() -> int:
    found = 0
    checked = 0
    for name, pts in lanes():
        checked += 1
        bad = []
        for i in range(len(pts) - 1):
            (x1, y1), (x2, y2) = pts[i], pts[i + 1]
            for k in range(SAMPLES + 1):
                t = k / SAMPLES
                lon = normalise(x1 + (x2 - x1) * t)
                lat = y1 + (y2 - y1) * t
                if globe.is_land(lat, lon):
                    bad.append((i, round(lon, 2), round(lat, 2)))
        status = "CLEAN" if not bad else f"{len(bad)} ON LAND, first {bad[0]}"
        print(f"{name:48} {len(pts):2} waypoints  {status}")
        found += len(bad)
    if not checked:
        print("No lanes parsed — has SHIP_LANES moved?")
        return 1
    print(f"\n{checked} lanes, {found} land samples")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
