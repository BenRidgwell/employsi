#!/usr/bin/env python3
"""Geocode registered head offices for the non-Perth Australian roster.

WHY THE ADDRESSES ARE WRITTEN OUT HERE
Geocoding by COMPANY NAME does not work and is not safe. Measured over a
20-company sample: 7 matched (35%), and among those, "Macquarie Group" resolved
to Macquarie TECHNOLOGY Group's building on Market Street — a different listed
company — and "Rio Tinto" to a suburban commercial site in Belmont rather than
its office. A near-miss like that is worse than the generated fan, because the
fan is visibly approximate while a wrong building looks authoritative. ASX's
public API carries no address field either.

So each entry below carries a real registered head-office street address, and
the geocoder is only ever asked to resolve an ADDRESS.

EVERY RESULT IS CHECKED TWICE before it is written:
  1. it must land inside the metro bounding box of the city the company is
     plotted in — a geocoder that quietly returns another state is the failure
     mode that matters here; and
  2. the road Nominatim reports must match the street in the address we asked
     for. This is the check that would have caught the Macquarie case: right
     city, wrong building.
Anything failing either test is REPORTED and LEFT OUT rather than written, so
the company keeps its honest fan position instead of gaining a false one.

This is a FIRST TRANCHE of the larger roster — the names most likely to be
looked at. It is meant to be extended; add an entry only with a real address.

Usage: python3 scripts/geocode-au.py [--dry-run]
"""
from __future__ import annotations
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

# Metro bounding boxes: (west, south, east, north)
CITY_BOX = {
    'sydney': (150.5, -34.2, 151.5, -33.4),
    'melbourne': (144.4, -38.3, 145.6, -37.4),
    'brisbane': (152.6, -28.0, 153.4, -27.0),
    'adelaide': (138.3, -35.3, 139.0, -34.6),
}

# id -> (city, registered head-office address)
ADDRESSES: dict[str, tuple[str, str]] = {
    # ── Sydney ────────────────────────────────────────────────────────────
    'sydney-cba': ('sydney', '201 Sussex Street, Sydney NSW 2000'),
    'sydney-wbc': ('sydney', '275 Kent Street, Sydney NSW 2000'),
    'sydney-mqg': ('sydney', '50 Martin Place, Sydney NSW 2000'),
    'sydney-qan': ('sydney', '10 Bourke Road, Mascot NSW 2020'),
    'sydney-wow': ('sydney', '1 Woolworths Way, Bella Vista NSW 2153'),
    'sydney-scg': ('sydney', '85 Castlereagh Street, Sydney NSW 2000'),
    'sydney-gmg': ('sydney', '60 Castlereagh Street, Sydney NSW 2000'),
    'sydney-asx': ('sydney', '20 Bridge Street, Sydney NSW 2000'),
    'sydney-bxb': ('sydney', '123 Pitt Street, Sydney NSW 2000'),
    'sydney-shl': ('sydney', '14 Giffnock Avenue, Macquarie Park NSW 2113'),
    'sydney-coh': ('sydney', '1 University Avenue, Macquarie University NSW 2109'),
    'sydney-qbe': ('sydney', '388 George Street, Sydney NSW 2000'),
    'sydney-org': ('sydney', '264 George Street, Sydney NSW 2000'),
    'sydney-agl': ('sydney', '200 George Street, Sydney NSW 2000'),
    'sydney-apa': ('sydney', '580 George Street, Sydney NSW 2000'),
    'sydney-llc': ('sydney', '300 Barangaroo Avenue, Barangaroo NSW 2000'),
    'sydney-dow': ('sydney', '39 Delhi Road, North Ryde NSW 2113'),
    'sydney-wor': ('sydney', '141 Walker Street, North Sydney NSW 2060'),
    'sydney-iag': ('sydney', '201 Sussex Street, Sydney NSW 2000'),
    'sydney-evn': ('sydney', '175 Liverpool Street, Sydney NSW 2000'),
    # ── Melbourne ─────────────────────────────────────────────────────────
    'melbourne-nab': ('melbourne', '395 Bourke Street, Melbourne VIC 3000'),
    'melbourne-anz': ('melbourne', '833 Collins Street, Docklands VIC 3008'),
    'melbourne-tls': ('melbourne', '242 Exhibition Street, Melbourne VIC 3000'),
    'melbourne-csl': ('melbourne', '655 Elizabeth Street, Melbourne VIC 3000'),
    'melbourne-col': ('melbourne', '800 Toorak Road, Hawthorn East VIC 3123'),
    'melbourne-ori': ('melbourne', '62 Lygon Street, Carlton VIC 3053'),
    'melbourne-rea': ('melbourne', '511 Church Street, Richmond VIC 3121'),
    'melbourne-cpu': ('melbourne', '452 Johnston Street, Abbotsford VIC 3067'),
    'melbourne-tcl': ('melbourne', '727 Collins Street, Docklands VIC 3008'),
    # ── Sydney, second tranche ────────────────────────────────────────────
    'sydney-all': ('sydney', '85 Epping Road, North Ryde NSW 2113'),
    'sydney-amp': ('sydney', '33 Alfred Street, Sydney NSW 2000'),
    'sydney-cgf': ('sydney', '5 Martin Place, Sydney NSW 2000'),
    'sydney-chc': ('sydney', '1 Martin Place, Sydney NSW 2000'),
    'sydney-dxs': ('sydney', '264 George Street, Sydney NSW 2000'),
    'sydney-gpt': ('sydney', '25 Martin Place, Sydney NSW 2000'),
    'sydney-hvn': ('sydney', '1 Homebush Bay Drive, Homebush West NSW 2140'),
    'sydney-mgr': ('sydney', '200 George Street, Sydney NSW 2000'),
    'sydney-rhc': ('sydney', '126 Phillip Street, Sydney NSW 2000'),
    'sydney-sgp': ('sydney', '133 Castlereagh Street, Sydney NSW 2000'),
    'sydney-tpg': ('sydney', '177 Pacific Highway, North Sydney NSW 2060'),
    'sydney-ald': ('sydney', '29 Bourke Road, Alexandria NSW 2015'),
    # ── Melbourne, second tranche ─────────────────────────────────────────
    'melbourne-mpl': ('melbourne', '720 Bourke Street, Docklands VIC 3008'),
    'melbourne-jbh': ('melbourne', '60 City Road, Southbank VIC 3006'),
    'melbourne-car': ('melbourne', '449 Punt Road, Richmond VIC 3121'),
    'melbourne-ann': ('melbourne', '678 Victoria Street, Richmond VIC 3121'),
    'melbourne-alx': ('melbourne', '141 Flinders Lane, Melbourne VIC 3000'),
    'melbourne-tah': ('melbourne', '727 Collins Street, Docklands VIC 3008'),
    'melbourne-vcx': ('melbourne', '1341 Dandenong Road, Chadstone VIC 3148'),
    'melbourne-cwy': ('melbourne', '441 St Kilda Road, Melbourne VIC 3004'),
    # ── Brisbane, second tranche ──────────────────────────────────────────
    'brisbane-flt': ('brisbane', '275 Grey Street, South Brisbane QLD 4101'),
    'brisbane-dmp': ('brisbane', '485 Kingsford Smith Drive, Hamilton QLD 4007'),
    'brisbane-nxt': ('brisbane', '100 Creek Street, Brisbane QLD 4000'),
    'aow': ('brisbane', '111 Eagle Street, Brisbane QLD 4000'),
    # ── Adelaide ──────────────────────────────────────────────────────────
    'beach': ('adelaide', '80 Flinders Street, Adelaide SA 5000'),
    'adelaide-abc': ('adelaide', '157 Grenfell Street, Adelaide SA 5000'),
    'adelaide-cda': ('adelaide', '2 Second Avenue, Mawson Lakes SA 5095'),
    # ── Brisbane ──────────────────────────────────────────────────────────
    'brisbane-sun': ('brisbane', '80 Ann Street, Brisbane QLD 4000'),
}


def street_of(addr: str) -> str:
    """The road part of '123 Some Street, Suburb STATE 1234'."""
    first = addr.split(',')[0]
    return re.sub(r'^\d+[a-zA-Z]?\s+', '', first).strip().lower()


def nominatim(query: str):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': query, 'format': 'json', 'limit': 1, 'countrycodes': 'au',
         'addressdetails': 1})
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> int:
    out: dict[str, list] = {}
    rejected: list[str] = []
    for i, (cid, (city, addr)) in enumerate(sorted(ADDRESSES.items()), 1):
        box = CITY_BOX[city]
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

        if not (box[0] < lon < box[2] and box[1] < lat < box[3]):
            rejected.append(f'{cid}: {lon:.5f},{lat:.5f} outside the {city} box — {addr}')
        elif want and want not in road.lower():
            # Right city, wrong street: exactly the Macquarie failure.
            rejected.append(f'{cid}: asked for {want!r}, geocoder returned {road!r} — {addr}')
        else:
            out[cid] = [round(lon, 6), round(lat, 6)]
            print(f'  {cid:16} {lon:.6f},{lat:.6f}  {road}')
        time.sleep(1.2)

    print(f'\nresolved {len(out)} / {len(ADDRESSES)}')
    if rejected:
        print('rejected (left on the fan rather than written):')
        for r in rejected:
            print(f'  {r}')
    if DRY:
        return 0

    body = ['/**',
            ' * Verified registered head-office coordinates, non-Perth Australia.',
            ' *',
            ' * GENERATED by scripts/geocode-au.py from the street addresses written out',
            ' * in that script — do not hand-edit; add the address there and re-run.',
            ' *',
            ' * Every coordinate here was geocoded from an ADDRESS, never from a company',
            ' * name, and then checked to land inside its city\'s metro box AND on the',
            ' * street the address named. Name search was measured at 35% coverage with',
            ' * false positives that put a company on a similarly-named firm\'s building,',
            ' * which is why it is not used.',
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
