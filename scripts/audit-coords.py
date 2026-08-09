#!/usr/bin/env python3
"""Audit plotted head-office coordinates against what is actually at them.

WHY REVERSE, NOT FORWARD
geocode-au.py already forward-geocodes an address to a point. This asks the
opposite question — what is AT the point we ended up with — because that is the
one a forward-only pipeline cannot answer about itself. A geocoder that cannot
find "Parliament House, North Terrace" does not fail; it silently returns the
CENTRE OF NORTH TERRACE, which looks like a perfectly good coordinate and puts
the pin a kilometre from the building. Measured on Adelaide: six companies at
one such point, spanning three genuinely different buildings.

Nominatim's `addresstype` and `place_rank` say which happened. A building or a
house is a real match; a `road` means the street was found but the number was
not; a `suburb`/`city` means only the locality was. The postcode it returns is
checked against the postcode in the address as a second, independent signal —
a point can sit on a building and still be the WRONG building.

Rate limit: Nominatim's usage policy is one request per second, and this obeys
it. An audit that gets the service blocked helps nobody.

Run: python3 scripts/audit-coords.py --city adelaide [--json out.json]
"""
from __future__ import annotations
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSV = os.path.join(HERE, 'au-addresses.csv')
UA = 'employsi-coord-audit/1.0 (labour-market map; contact via repo)'

args = sys.argv[1:]
CITY = args[args.index('--city') + 1] if '--city' in args else 'adelaide'
OUT = args[args.index('--json') + 1] if '--json' in args else None

# Precise enough to trust. Anything else means the geocoder answered a broader
# question than the one the address asked.
PRECISE = {'building', 'house', 'amenity', 'office', 'shop', 'tourism',
           'industrial', 'place', 'railway', 'aeroway'}
# An office is never in the middle of a park, a reserve or a river. When a pin
# reverse-geocodes to one of these it is not an imprecise address, it is a
# generated fan position that happened to land on open ground — which is what a
# reader notices first and trusts least.
OPEN_GROUND = {'leisure', 'park', 'garden', 'water', 'natural', 'landuse',
               'waterway', 'forest', 'grass', 'recreation_ground', 'pitch'}
VAGUE = {'road', 'suburb', 'city', 'town', 'village', 'postcode', 'state',
         'county', 'municipality', 'neighbourhood', 'hamlet', 'locality'}


def roster() -> list[dict]:
    """The city's plotted companies and their coordinates, read through bun so
    this cannot disagree with what the app draws."""
    # THE DRAWN COORDINATE, not the stored one. These differed for 306 government
    # agencies until 2026-08-09: only Perth consulted realCoord(), so every other
    # city drew a fan position while auRealCoords.ts held the right answer — and
    # an audit that reads the data file reports a map that is fine while the one
    # on screen is not. What the user sees is what has to be checked.
    script = f'''
    import {{ CITY_COMPANIES }} from "{ROOT}/src/employsi/data/mapboxGeo";
    import {{ AU_REAL_COORDS }} from "{ROOT}/src/employsi/data/auRealCoords";
    import {{ COMPANIES }} from "{ROOT}/src/employsi/data/companies";
    const name = new Map(COMPANIES.map((c) => [c.id, c.name]));
    const out = (CITY_COMPANIES[{json.dumps(CITY)}] ?? [])
      .map((c) => ({{ id: c.id, name: name.get(c.id) ?? c.id,
                      lon: c.coords[0], lat: c.coords[1],
                      pinned: Boolean(AU_REAL_COORDS[c.id]) }}));
    console.log(JSON.stringify(out));
    '''
    path = os.path.join('/tmp', f'_roster_{CITY}.ts')
    open(path, 'w').write(script)
    p = subprocess.run(['bun', 'run', path], capture_output=True, timeout=180)
    if p.returncode != 0:
        sys.exit(f'roster read failed: {p.stderr.decode()[:300]}')
    return json.loads(p.stdout.decode().strip().splitlines()[-1])


def addresses() -> dict[str, tuple[str, str]]:
    import csv as _csv
    out = {}
    with open(CSV, newline='', encoding='utf-8') as f:
        for row in _csv.DictReader(f):
            out[row['company_id']] = (row.get('registered_address', ''),
                                      row.get('address_confidence', ''))
    return out


def reverse(lat: float, lon: float) -> dict | None:
    url = ('https://nominatim.openstreetmap.org/reverse?'
           + urllib.parse.urlencode({'lat': lat, 'lon': lon, 'format': 'json',
                                     'zoom': 18, 'addressdetails': 1}))
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  reverse failed: {str(e)[:80]}\n')
        return None


def main() -> int:
    rows = roster()
    addr = addresses()
    sys.stderr.write(f'{len(rows)} plotted companies in {CITY} with a coordinate\n')
    results = []
    for i, c in enumerate(rows, 1):
        sys.stderr.write(f'[{i}/{len(rows)}] {c["id"]}... ')
        d = reverse(c['lat'], c['lon'])
        time.sleep(1.1)  # Nominatim: 1 req/s
        if not d:
            results.append({**c, 'verdict': 'lookup failed'})
            sys.stderr.write('lookup failed\n')
            continue
        atype = d.get('addresstype', '')
        a = d.get('address', {})
        # The postcode is the four digits AFTER the state, not the first four
        # digits in the string — "1459 Main North Road, Para Hills West SA 5096"
        # starts with a street number that matches \d{4} perfectly well and made
        # the first run report a postcode mismatch against 1459.
        want_pc = (re.search(r'\b(?:NSW|VIC|QLD|SA|WA|NT|ACT|TAS)\s+(\d{4})\b',
                             addr.get(c['id'], ('', ''))[0]) or [None, ''])[1]
        got_pc = a.get('postcode', '')
        flags = []
        if atype in OPEN_GROUND or (a.get('leisure') or a.get('natural')):
            flags.append(f'lands on open ground ({atype or a.get("leisure") or a.get("natural")})'
                         + ('' if c.get('pinned') else ' — no geocoded address, on the fan'))
        elif atype in VAGUE:
            flags.append(f'lands on a {atype}, not a building')
        elif atype not in PRECISE:
            flags.append(f'unrecognised match type "{atype}"')
        if want_pc and got_pc and want_pc != got_pc:
            flags.append(f'postcode {got_pc} != {want_pc} in the address')
        results.append({**c, 'addresstype': atype, 'display': d.get('display_name', '')[:110],
                        'postcode': got_pc, 'want_postcode': want_pc,
                        'address': addr.get(c['id'], ('', ''))[0],
                        'confidence': addr.get(c['id'], ('', ''))[1],
                        'flags': flags,
                        'verdict': 'CHECK' if flags else 'ok'})
        sys.stderr.write(('CHECK — ' + '; '.join(flags) if flags else 'ok') + '\n')

    bad = [r for r in results if r['verdict'] != 'ok']
    print(f'\n{len(results) - len(bad)} of {len(results)} land on a precise match.')
    print(f'{len(bad)} need a look:\n')
    for r in sorted(bad, key=lambda x: x['id']):
        print(f"  {r['id']}  ({r.get('name', '')})")
        print(f"      address in CSV : {r.get('address', '?')}  [{r.get('confidence', '?')}]")
        print(f"      point resolves : {r.get('display', '?')}")
        print(f"      why            : {'; '.join(r.get('flags', [r['verdict']]))}")
    if OUT:
        json.dump(results, open(OUT, 'w'), indent=2)
        print(f'\nwrote {OUT}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
