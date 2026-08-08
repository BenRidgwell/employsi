#!/usr/bin/env python3
"""Geocode the Perth-plotted entities that don't yet have a verified head-office
coordinate, and merge them into src/employsi/data/perthRealCoords.ts.

Why: mapboxGeo places a Perth pin at PERTH_REAL_COORDS[id] when present, else at
a generated fan position around the CBD — i.e. an arbitrary spot. Three groups
were affected (see the audit in the session notes):
  • Tier A — listed juniors given rounded suburb-level guesses (all of West Perth
    clustered on near-identical coordinates);
  • Tier B — the Top-150 private companies plotted in Perth, and the WA gov
    agencies with no geocode: both fully fanned.

Each entity below carries its REAL registered head-office street address (from
the company's own site / ASX or agency contact page). We geocode that address via
OpenStreetMap Nominatim, then SANITY-CHECK every result against the Perth metro
bounding box — a geocoder that silently returns the centroid of another state is
worse than the fan, so anything outside the box (or not found) is reported and
left out rather than written.

Usage: python3 scripts/geocode-perth.py [--dry-run]
Re-run any time; existing verified coordinates are preserved unless --overwrite.
"""
from __future__ import annotations
import json
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = __file__.rsplit('/scripts/', 1)[0]
OUT = f'{ROOT}/src/employsi/data/perthRealCoords.ts'
UA = 'employsi-geocoder/1.0 (labour-market map; contact via repo)'

# Perth metropolitan bounding box (lng_min, lat_min, lng_max, lat_max) — generous
# enough for Henderson/Kwinana in the south and Joondalup in the north.
BOX = (115.55, -32.60, 116.20, -31.55)

# id → (label, full street address). Addresses are the entities' own published
# head offices. Where a company shares a serviced-office tower (common for the
# small WA juniors), that tower IS the registered head office.
TARGETS: dict[str, tuple[str, str]] = {
    # ── Tier A: listed juniors previously placed at rounded suburb points ──
    'pdn': ('Paladin Energy', '502 Hay Street, Subiaco, Western Australia 6008'),
    'wgx': ('Westgold Resources', '28 The Esplanade, Perth, Western Australia 6000'),
    'stx': ('Strike Energy', '5 Ord Street, West Perth, Western Australia 6005'),
    'alk': ('Alkane Resources', '89 Burswood Road, Burswood, Western Australia 6100'),
    'rrl': ('Regis Resources', 'Level 1, 1 Sleat Road, Applecross, Western Australia 6153'),
    'pru': ('Perseus Mining', '14 Ventnor Avenue, West Perth, Western Australia 6005'),
    'rms': ('Ramelius Resources', '140 Greenhill Road, Unley, South Australia'),  # checked below
    'gmd': ('Genesis Minerals', '3 Rheola Street, West Perth, Western Australia 6005'),
    'gor': ('Gold Road Resources', '20 Kings Park Road, West Perth, Western Australia 6005'),
    'cmm': ('Capricorn Metals', '1 Sleat Road, Applecross, Western Australia 6153'),
    'dyl': ('Deep Yellow', '502 Hay Street, Subiaco, Western Australia 6008'),
    'bmn': ('Bannerman Energy', '18 Richardson Street, West Perth, Western Australia 6005'),
    'boe': ('Boss Energy', '15 Rheola Street, West Perth, Western Australia 6005'),
    'cvn': ('Carnarvon Energy', '1 Sleat Road, Applecross, Western Australia 6153'),
    'cxo': ('Core Lithium', '5 Sleat Road, Applecross, Western Australia 6153'),
    'sgq': ('St George Mining', '18 Richardson Street, West Perth, Western Australia 6005'),
    'del': ('Delorean Corporation', '5 Wallace Way, Fremantle, Western Australia 6160'),
    'swm': ('Seven West Media', '50 Hasler Road, Osborne Park, Western Australia 6017'),
    'sw1': ('Swift Networks', '1/1 Sarich Court, Osborne Park, Western Australia 6017'),

    # ── Tier B: Top-150 private companies plotted in Perth ──
    # 'Hancock Place' is the building name and defeats the geocoder; the street
    # address alone (20 Kings Park Rd) resolves to the same tower.
    'pvt-hancock-prospecting': ('Hancock Prospecting', '20 Kings Park Road, West Perth, Western Australia 6005'),
    'pvt-cbh-group': ('CBH Group', '30 Delhi Street, West Perth, Western Australia 6005'),
    'pvt-vgw-holdings': ('VGW Holdings', '18 Kings Park Road, West Perth, Western Australia 6005'),
    'pvt-swift-holdings-investments': ('Swift Holdings', '1 Sarich Court, Osborne Park, Western Australia 6017'),
    'pvt-st-john-of-god-health-care': ('St John of God Health Care', '12 Salvado Road, Subiaco, Western Australia 6008'),
    'pvt-hbf': ('HBF Health', '570 Wellington Street, Perth, Western Australia 6000'),
    'pvt-abn': ('ABN Group', '52 Frobisher Street, Osborne Park, Western Australia 6017'),
    'pvt-rac-of-wa': ('RAC of WA', '832 Wellington Street, West Perth, Western Australia 6005'),
    'pvt-georgiou': ('Georgiou Group', '68 Hasler Road, Osborne Park, Western Australia 6017'),
    'pvt-bgc': ('BGC Australia', '22 Sheffield Road, Welshpool, Western Australia 6106'),
    'pvt-cjd-equipment': ('CJD Equipment', '16 Ledgar Road, Balcatta, Western Australia 6021'),
    'pvt-john-hughes-group': ('John Hughes Group', '49 Shepperton Road, Victoria Park, Western Australia 6100'),
    'pvt-perron-group': ('Perron Group', '154 Hay Street, Subiaco, Western Australia 6008'),
    'pvt-perth-airport': ('Perth Airport', '2 George Wiencke Drive, Perth Airport, Western Australia 6105'),
    'pvt-craig-mostyn': ('Craig Mostyn Group', '3 Cowcher Place, Belmont, Western Australia 6104'),

    # ── Tier B: WA government agencies with no geocode ──
    'perth-gov-arts-and-culture-trust': ('Arts and Culture Trust', '825 Hay Street, Perth, Western Australia 6000'),
    'perth-gov-central-regional-tafe': ('Central Regional TAFE', '20 Sanford Street, Geraldton, Western Australia 6530'),
    'perth-gov-department-of-creative-industries-tourism-and-sport': ('Dept Creative Industries, Tourism and Sport', '140 William Street, Perth, Western Australia 6000'),
    'perth-gov-department-of-housing-and-works': ('Dept Housing and Works', '99 Plain Street, East Perth, Western Australia 6004'),
    'perth-gov-department-of-local-government-industry-regulation-and-safety': ('Dept Local Government, Industry Regulation and Safety', '140 William Street, Perth, Western Australia 6000'),
    'perth-gov-department-of-transport-and-major-infrastructure': ('Dept Transport and Major Infrastructure', '140 William Street, Perth, Western Australia 6000'),
    'perth-gov-department-of-treasury-and-finance': ('Dept Treasury and Finance', '200 St Georges Terrace, Perth, Western Australia 6000'),
    'perth-gov-legal-practice-board': ('Legal Practice Board', '55 St Georges Terrace, Perth, Western Australia 6000'),
    # Belmont, not Osborne Park — the stored coordinate was 11 km out.
    # Mapbox resolves this address exactly (relevance 0.91); as with
    # MyLeave below, do not --overwrite it with a Nominatim centroid.
    'perth-gov-construction-training-fund': ('Construction Training Fund', '104 Belgravia Street, Belmont, Western Australia 6104'),
    'perth-gov-mental-health-commission': ('Mental Health Commission', '1 Nash Street, Perth, Western Australia 6000'),
    # Moved to the CBD (Level 1, 503 Murray Street) from Bayswater — about 7 km.
    # NOMINATIM CANNOT CONFIRM THIS ONE: it resolves no house number on Murray
    # Street and hands back a street-segment centroid, and the segments it
    # offers are spread over 1.5 km (115.848–115.865), which is a worse answer
    # than the address deserves. The stored coordinate came from Mapbox's
    # geocoder instead, which returns the address exactly — "503 Murray Street,
    # Perth Western Australia 6000" at relevance 0.91. A default run preserves
    # it; --overwrite would replace it with the centroid, so don't.
    'perth-gov-myleave': ('MyLeave', '503 Murray Street, Perth, Western Australia 6000'),
    'perth-gov-north-regional-tafe': ('North Regional TAFE', '2 Cable Beach Road, Broome, Western Australia 6725'),
    'perth-gov-state-solicitors-office': ("State Solicitor's Office", '141 St Georges Terrace, Perth, Western Australia 6000'),
}

# A few entities are genuinely NOT in the Perth metro box (regional TAFEs serve
# the north/mid-west; Ramelius is registered interstate). Plot them at their WA
# metro presence instead of dropping them off the Perth map entirely.
METRO_FALLBACK = {
    # Ramelius is registered in SA but runs its WA operations from Applecross.
    'rms': '4 Sleat Road, Applecross, Western Australia 6153',
    # Regional TAFEs are headquartered in Geraldton / Broome; plot their Perth
    # metropolitan office so they still appear on the Perth local view.
    'perth-gov-central-regional-tafe': '25 Aberdeen Street, Perth, Western Australia 6000',
    'perth-gov-north-regional-tafe': '25 Aberdeen Street, Perth, Western Australia 6000',
}


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


def load_existing() -> dict:
    txt = open(OUT).read()
    out = {}
    for m in re.finditer(r'"([^"]+)":\s*\[([-\d.]+),\s*([-\d.]+)\]', txt):
        out[m.group(1)] = (float(m.group(2)), float(m.group(3)))
    return out


def broaden(addr: str) -> str:
    """Drop the street number / unit — suburb-level is still far better than a fan."""
    return re.sub(r'^[^,]*?(\d+[A-Za-z]?\s+)?', '', addr, count=1) if ',' in addr else addr


def main() -> int:
    dry = '--dry-run' in sys.argv
    overwrite = '--overwrite' in sys.argv
    existing = load_existing()
    resolved, failed = {}, []

    for i, (cid, (label, addr)) in enumerate(TARGETS.items(), 1):
        if cid in existing and not overwrite:
            continue
        pt = geocode(addr)
        if not in_box(pt):
            # try the metro fallback, then a broadened query
            alt = METRO_FALLBACK.get(cid)
            if alt:
                pt = geocode(alt)
            if not in_box(pt):
                pt2 = geocode(broaden(addr))
                pt = pt2 if in_box(pt2) else None
        if in_box(pt):
            resolved[cid] = pt
            sys.stderr.write(f'  [{i:2}/{len(TARGETS)}] {label:44} {pt}\n')
        else:
            failed.append((cid, label, addr))
            sys.stderr.write(f'  [{i:2}/{len(TARGETS)}] {label:44} NOT RESOLVED\n')
        time.sleep(1.2)  # Nominatim asks for <=1 req/sec

    merged = dict(existing)
    merged.update(resolved)
    if dry:
        sys.stderr.write(f'\n(dry run) would write {len(merged)} coords '
                         f'({len(resolved)} new/updated)\n')
        return 0

    L = ['// Real head-office coordinates for Perth-plotted entities, geocoded from each',
         '// body\'s head-office street address via OpenStreetMap (Nominatim). Government',
         '// agencies + several companies were confirmed by the user; the remaining',
         '// listed companies use their public registered-office address. Anything not',
         '// listed falls back to the generated fan around the CBD.',
         '//',
         '// Regenerate/extend with: python3 scripts/geocode-perth.py',
         '',
         'export const PERTH_REAL_COORDS: Record<string, [number, number]> = {']
    for k in sorted(merged):
        lng, lat = merged[k]
        L.append(f'  "{k}": [{lng}, {lat}],')
    L.append('};')
    open(OUT, 'w').write('\n'.join(L) + '\n')

    sys.stderr.write(f'\nWrote {len(merged)} coordinates ({len(resolved)} new) -> {OUT}\n')
    if failed:
        sys.stderr.write('Left on the CBD fan (address not resolvable):\n')
        for cid, label, addr in failed:
            sys.stderr.write(f'  · {label} — {addr}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
