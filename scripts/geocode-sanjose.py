#!/usr/bin/env python3
"""Geocode the San Jose / Silicon Valley head offices and write
src/employsi/data/sanJoseRealCoords.ts.

Why this list exists: the roster had every Bay Area company pinned to San
Francisco, but most of the big technology names are not in San Francisco at all
— they are in Santa Clara County, which is a SEPARATE metropolitan area (the
San Jose-Sunnyvale-Santa Clara MSA, CBSA 41940) with its own BLS labour-market
statistics. Apple is in Cupertino, Alphabet in Mountain View, Nvidia and Intel
in Santa Clara, Adobe and Cisco in San Jose. Plotting them on San Francisco put
them 60-80 km from their real offices and attributed their demand to the wrong
metro.

The county line is what decides it, not the postal address's vibe:
  • Santa Clara County  → San Jose MSA  (this file)
  • San Mateo County    → San Francisco MSA (Meta/Menlo Park, Gilead/Foster
    City, Equinix/Redwood City stay in San Francisco)
  • Alameda County      → San Francisco MSA (Lam Research/Fremont stays)

Each address below is the company's own published corporate headquarters. As
with the Perth geocoder, every result is checked against a bounding box before
it is written — a geocoder that quietly returns the centroid of another state is
worse than no coordinate at all.

Usage: python3 scripts/geocode-sanjose.py [--dry-run] [--overwrite]
"""
from __future__ import annotations
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = __file__.rsplit('/scripts/', 1)[0]
OUT = f'{ROOT}/src/employsi/data/sanJoseRealCoords.ts'
UA = 'employsi-geocoder/1.0 (labour-market map; contact via repo)'

# Santa Clara County / South Bay bounding box (lng_min, lat_min, lng_max, lat_max)
# — wide enough for Palo Alto in the north-west and Morgan Hill in the south,
# tight enough to reject anything that lands in San Francisco or out of state.
BOX = (-122.25, 36.90, -121.55, 37.55)

# roster id → (display name, published head-office address).
TARGETS: dict[str, tuple[str, str]] = {
    'sanjose-aapl': ('Apple', '1 Apple Park Way, Cupertino, California 95014'),
    'sanjose-googl': ('Alphabet (Google)', '1600 Amphitheatre Parkway, Mountain View, California 94043'),
    'sanjose-nvda': ('Nvidia', '2788 San Tomas Expressway, Santa Clara, California 95051'),
    'sanjose-avgo': ('Broadcom', '3421 Hillview Avenue, Palo Alto, California 94304'),
    'sanjose-amd': ('AMD', '2485 Augustine Drive, Santa Clara, California 95054'),
    'sanjose-nflx': ('Netflix', '121 Albright Way, Los Gatos, California 95032'),
    'sanjose-adbe': ('Adobe', '345 Park Avenue, San Jose, California 95110'),
    'sanjose-csco': ('Cisco Systems', '170 West Tasman Drive, San Jose, California 95134'),
    'sanjose-intc': ('Intel', '2200 Mission College Boulevard, Santa Clara, California 95054'),
    'sanjose-amat': ('Applied Materials', '3050 Bowers Avenue, Santa Clara, California 95054'),
    'sanjose-intu': ('Intuit', '2700 Coast Avenue, Mountain View, California 94043'),
    'sanjose-panw': ('Palo Alto Networks', '3000 Tannery Way, Santa Clara, California 95054'),
    'sanjose-now': ('ServiceNow', '2225 Lawson Lane, Santa Clara, California 95054'),
    'sanjose-pypl': ('PayPal', '2211 North First Street, San Jose, California 95131'),
    'sanjose-klac': ('KLA Corporation', '1 Technology Drive, Milpitas, California 95035'),
    'sanjose-snps': ('Synopsys', '675 Almanor Avenue, Sunnyvale, California 94085'),
    'sanjose-cdns': ('Cadence Design Systems', '2655 Seely Avenue, San Jose, California 95134'),
    'sanjose-hpq': ('HP Inc.', '1501 Page Mill Road, Palo Alto, California 94304'),
    'sanjose-isrg': ('Intuitive Surgical', '1020 Kifer Road, Sunnyvale, California 94086'),
}

# Campus addresses that OSM does not carry at building level; fall back to the
# street/city, which still lands within a few hundred metres.
BROADEN_FALLBACK = True


def geocode(query: str):
    url = ('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
           + urllib.parse.quote(query))
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for attempt in range(3):
        try:
            j = json.loads(urllib.request.urlopen(req, timeout=25).read())
            if j:
                return round(float(j[0]['lon']), 6), round(float(j[0]['lat']), 6)
            return None
        except Exception:  # noqa: BLE001
            time.sleep(2 * (attempt + 1))
    return None


def in_box(pt) -> bool:
    return bool(pt) and BOX[0] <= pt[0] <= BOX[2] and BOX[1] <= pt[1] <= BOX[3]


def broaden(addr: str) -> str:
    """Drop the street number, keeping street + city — still far better than a fan."""
    return re.sub(r'^\d+[A-Za-z]?\s+', '', addr, count=1)


def load_existing() -> dict:
    if not os.path.exists(OUT):
        return {}
    out = {}
    for m in re.finditer(r'"([^"]+)":\s*\[([-\d.]+),\s*([-\d.]+)\]', open(OUT).read()):
        out[m.group(1)] = (float(m.group(2)), float(m.group(3)))
    return out


def main() -> int:
    dry = '--dry-run' in sys.argv
    overwrite = '--overwrite' in sys.argv
    existing = load_existing()
    resolved, failed = {}, []

    for i, (cid, (label, addr)) in enumerate(TARGETS.items(), 1):
        if cid in existing and not overwrite:
            continue
        pt = geocode(addr)
        if not in_box(pt) and BROADEN_FALLBACK:
            alt = geocode(broaden(addr))
            pt = alt if in_box(alt) else None
        if in_box(pt):
            resolved[cid] = pt
            sys.stderr.write(f'  [{i:2}/{len(TARGETS)}] {label:24} {pt}\n')
        else:
            failed.append((cid, label, addr))
            sys.stderr.write(f'  [{i:2}/{len(TARGETS)}] {label:24} NOT RESOLVED\n')
        time.sleep(1.2)  # Nominatim asks for <=1 req/sec

    merged = dict(existing)
    merged.update(resolved)
    if dry:
        sys.stderr.write(f'\n(dry run) would write {len(merged)} coords '
                         f'({len(resolved)} new)\n')
        return 0

    L = ['// Real head-office coordinates for the San Jose / Silicon Valley roster,',
         '// geocoded from each company\'s published corporate address via OpenStreetMap',
         '// (Nominatim) and bounds-checked against Santa Clara County.',
         '//',
         '// These companies were previously pinned to San Francisco. They are in the',
         '// San Jose-Sunnyvale-Santa Clara metro — a different labour market with its',
         '// own BLS statistics — so both their map position and the metro their demand',
         '// counts towards were wrong. Anything not listed falls back to the generated',
         '// fan around the city centre.',
         '//',
         '// Regenerate with: python3 scripts/geocode-sanjose.py',
         '',
         'export const SAN_JOSE_REAL_COORDS: Record<string, [number, number]> = {']
    for k in sorted(merged):
        lng, lat = merged[k]
        L.append(f'  "{k}": [{lng}, {lat}],')
    L.append('};')
    open(OUT, 'w').write('\n'.join(L) + '\n')

    sys.stderr.write(f'\nWrote {len(merged)} coordinates ({len(resolved)} new) -> {OUT}\n')
    if failed:
        sys.stderr.write('Left on the generated fan (address not resolvable):\n')
        for cid, label, addr in failed:
            sys.stderr.write(f'  · {label} — {addr}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
