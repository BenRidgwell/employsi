#!/usr/bin/env python3
"""Geocode registered head offices for the non-Perth Australian roster.

WHY ONLY ADDRESSES ARE EVER LOOKED UP
Geocoding by COMPANY NAME does not work and is not safe. Measured over a
20-company sample: 7 matched (35%), and among those, "Macquarie Group" resolved
to Macquarie TECHNOLOGY Group's building on Market Street — a different listed
company — and "Rio Tinto" to a suburban commercial site in Belmont rather than
its office. A near-miss like that is worse than the generated fan, because the
fan is visibly approximate while a wrong building looks authoritative. ASX's
public API carries no address field either.

So the addresses come from scripts/au-addresses.csv, which is validated
externally and is the source of truth, and the geocoder is only ever asked to
resolve an ADDRESS.

THE ONE CHECK THAT GATES A WRITE is the street match: the road Nominatim
reports must be the road the address named. That is the check that would have
caught the Macquarie case — right city, wrong building. A result failing it is
REPORTED and LEFT OUT, so the company keeps its honest fan position instead of
gaining a false one.

Distance from the plotted city is REPORTED, NOT FILTERED. Around seventeen of
these registered offices are genuinely in another town — Bega Cheese in Bega,
nib and Hunter Water in Newcastle, Bendigo Bank in Bendigo, WorkSafe and GMHBA
in Geelong, the NDIA in Geelong — and a metro bounding box would reject that
correct data as if it were geocoder error.

Usage: python3 scripts/geocode-au.py [--dry-run]
"""
from __future__ import annotations
import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'src/employsi/data/auRealCoords.ts')
UA = 'employsi-geocode/1.0 (https://github.com/BenRidgwell/employsi)'
DRY = '--dry-run' in sys.argv[1:]

ADDR_CSV = os.path.join(HERE, 'au-addresses.csv')

# City centres, used only to REPORT how far a resolved office is from the city
# it is plotted in. Not a filter: several registered offices are genuinely in
# another town — Bega Cheese in Bega, nib in Newcastle, the NDIA in Geelong —
# and those are correct data, not geocoder errors.
CITY_CENTRE = {
    'sydney': (151.2093, -33.8688), 'melbourne': (144.9631, -37.8136),
    'brisbane': (153.0251, -27.4698), 'adelaide': (138.6007, -34.9285),
    'perth': (115.8605, -31.9523), 'canberra': (149.1300, -35.2809),
    'darwin': (130.8456, -12.4634), 'hobart': (147.3272, -42.8821),
}


def load_addresses():
    """id -> (city, address), from the supplied CSV.

    The addresses are validated externally and are the source of truth. This
    script's job is to catch GEOCODING error — a lookup that lands on the wrong
    building — not to second-guess the addresses themselves.
    """
    out = {}
    with open(ADDR_CSV, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            addr = (row.get('registered_address') or '').strip()
            cid = (row.get('company_id') or '').strip()
            city = (row.get('city') or '').strip()
            if addr and cid and city:
                out[cid] = (city, addr)
    return out


STREET_WORD = (r"(street|road|avenue|drive|circuit|crescent|parade|place|highway|"
               r"terrace|way|lane|esplanade|boulevard|close|court|quay|mall|walk|st|rd|ave)")


def street_of(addr):
    """The road name in an address, wherever in the string it sits.

    A third of the supplied addresses lead with a floor or a building —
    "Level 34, Australia Square, 264-278 George Street, Sydney NSW 2000" — so
    taking the first comma-segment yields "level 34" and every one of them
    would be rejected. Scan the segments for the one that names a road.
    """
    for seg in addr.split(','):
        seg = seg.strip()
        m = re.search(r"([A-Za-z][A-Za-z'\-\s]{2,30}?\s+" + STREET_WORD + r")\b", seg, re.I)
        if m:
            return m.group(1).strip().lower()
    return ''


def nominatim(query: str):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': query, 'format': 'json', 'limit': 1, 'countrycodes': 'au',
         'addressdetails': 1})
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> int:
    ADDRESSES = load_addresses()
    out: dict[str, list] = {}
    rejected: list[str] = []
    far: list[str] = []
    for i, (cid, (city, addr)) in enumerate(sorted(ADDRESSES.items()), 1):
        try:
            res = nominatim(addr)
        except Exception as e:
            rejected.append(f'{cid}: lookup failed ({e})')
            time.sleep(1.2)
            continue
        if not res:
            rejected.append(f'{cid}: no match for {addr!r}')
            time.sleep(1.2)
            continue
        hit = res[0]
        lon, lat = float(hit['lon']), float(hit['lat'])
        road = (hit.get('address') or {}).get('road', '') or ''
        want = street_of(addr)

        if want and want not in road.lower():
            # Right city, wrong street: exactly the Macquarie failure.
            rejected.append(f'{cid}: asked for {want!r}, geocoder returned {road!r} — {addr}')
        else:
            out[cid] = [round(lon, 6), round(lat, 6)]
            cx, cy = CITY_CENTRE.get(city, (lon, lat))
            km = (((lon - cx) * 88) ** 2 + ((lat - cy) * 111) ** 2) ** 0.5
            if km > 120:
                far.append(f'{cid} ({city}): {km:.0f} km out — {addr}')
        time.sleep(1.2)

    print(f'\nresolved {len(out)} / {len(ADDRESSES)}')
    if far:
        print(f'\nresolved but far from the plotted city ({len(far)}) — regional head '
              'offices, written as supplied:')
        for r in far:
            print(f'  {r}')
    if rejected:
        print(f'\nrejected ({len(rejected)}), left on the fan rather than written:')
        for r in rejected:
            print(f'  {r}')
    if DRY:
        return 0

    body = ['/**',
            ' * Verified registered head-office coordinates, non-Perth Australia.',
            ' *',
            ' * GENERATED by scripts/geocode-au.py from scripts/au-addresses.csv — do',
            ' * not hand-edit; correct the address in that CSV and re-run.',
            ' *',
            ' * Every coordinate here was geocoded from an ADDRESS, never from a company',
            ' * name, and then checked to land on the street the address named. Name',
            ' * search was measured at 35% coverage with false positives that put a',
            ' * company on a similarly-named firm\'s building, which is why it is not used.',
            ' *',
            ' * A few of these are a long way from the city the company is plotted in.',
            ' * That is correct: Bega Cheese really is registered in Bega, nib in',
            ' * Newcastle, the NDIA in Geelong. Distance is reported by the script, not',
            ' * used to reject.',
            ' *',
            ' * Companies absent from this table keep their generated fan position, which',
            ' * is approximate but honest. Extending this table is how they get fixed.',
            ' */',
            'export const AU_REAL_COORDS: Record<string, [number, number]> = {']
    for cid, (lon, lat) in sorted(out.items()):
        body.append(f'  "{cid}": [{lon}, {lat}], // {ADDRESSES[cid][1]}')
    body.append('};')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(body) + '\n')
    print(f'wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
