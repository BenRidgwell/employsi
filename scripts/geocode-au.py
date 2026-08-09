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
import subprocess
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
    """(city, id) -> address, from the supplied CSV.

    KEYED BY CITY AND COMPANY, not company alone. The CSV has always carried one
    row per city a company is plotted in, and this used to key by company — so
    the last row silently won and every other city's address was discarded. That
    was invisible while coordinates were company-keyed too; it stops being
    invisible the moment a company has a real office in more than one city.

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
                out[(city, cid)] = addr
    return out


def plotted_cities() -> dict[str, int]:
    """company id -> how many cities the map plots it in.

    Read from CITY_COMPANIES through bun, because it decides the OUTPUT KEY and
    guessing it would reintroduce the bug this change exists to fix: a company
    on one map gets a plain company-keyed coordinate, a company on several gets
    only city-scoped ones. Give the Commonwealth Bank a plain key off its
    Adelaide address and its Sydney, Melbourne, Brisbane and Perth pins all move
    to Adelaide.
    """
    script = f'''
    import {{ CITY_COMPANIES }} from "{ROOT}/src/employsi/data/mapboxGeo";
    const n: Record<string, number> = {{}};
    for (const list of Object.values(CITY_COMPANIES)) {{
      for (const c of list) n[c.id] = (n[c.id] ?? 0) + 1;
    }}
    console.log(JSON.stringify(n));
    '''
    path = os.path.join('/tmp', '_plotted_cities.ts')
    open(path, 'w').write(script)
    p = subprocess.run(['bun', 'run', path], capture_output=True, timeout=180)
    if p.returncode != 0:
        sys.exit(f'could not read CITY_COMPANIES: {p.stderr.decode()[:300]}')
    return json.loads(p.stdout.decode().strip().splitlines()[-1])


# SQUARE was missing and Adelaide is built around five of them. Without it
# "200 Victoria Square" was not recognised as a street line at all, so the whole
# address went to the geocoder with "Level 9, State Administration Centre" still
# attached and matched nothing — four SA agencies sat on the fan because of one
# absent word. The rest here are the other Australian street types that appear in
# addresses and were equally missing.
STREET_WORD = (r"(street|road|avenue|drive|circuit|crescent|parade|place|highway|"
               r"terrace|way|lane|esplanade|boulevard|close|court|quay|mall|walk|"
               r"square|circus|grove|rise|loop|row|gardens|promenade|arcade|"
               r"st|rd|ave|sq)")


def street_segments(addr):
    """The address from its first road-naming segment onward.

    A third of the supplied addresses lead with a floor, a unit or a building —
    "Level 34, Australia Square, 264-278 George Street, Sydney NSW 2000",
    "Nishi Building, 2 Phillip Law Street, Canberra ACT 2601" — and Nominatim
    returns NO MATCH AT ALL for those, because it has no notion of a storey and
    the building name is not in its index. Measured: sent whole, 265 of 625
    addresses failed to resolve, and nearly all of them were of this shape.
    Dropping the segments in front of the road turns them into queries it can
    answer.

    Returns '' when no segment names a road (a few addresses are just a
    locality, e.g. "Girgarre VIC 3624"); the caller then sends the whole string.
    """
    segs = [s.strip() for s in addr.split(',') if s.strip()]
    # A NUMBERED segment wins over an earlier unnumbered one. Building names
    # routinely end in a street word — "Manunda Place, 38 Cavenagh Street" — and
    # taking the first match made "Manunda Place" the street, so the gate below
    # demanded the geocoder return Manunda Place, rejected the correct Cavenagh
    # Street answer, and left the NT Department of Health on the fan with a
    # perfectly good address. A real street line starts with its number.
    numbered = [i for i, seg in enumerate(segs)
                if re.match(STREET_NUMBER, seg) and re.search(r"\b" + STREET_WORD + r"\b", seg, re.I)]
    if numbered:
        return segs[numbered[0]:]
    for i, seg in enumerate(segs):
        if re.search(r"\b" + STREET_WORD + r"\b", seg, re.I):
            return segs[i:]
    return []


# Street numbers as they actually appear: "12", "2A", "264-278", "1/22", "10-12A".
STREET_NUMBER = r"^\d+[A-Za-z]?(?:\s*[-/]\s*\d+[A-Za-z]?)*\s+"


def street_of(addr):
    """The road name an address claims, lower-cased, for the match check.

    The leading number has to come off FIRST. "2A Venture Road" fed straight to
    the name pattern matches from the "A", yielding "a venture road", which then
    fails to appear in the geocoder's "Venture Road" and rejects a result that
    was in fact correct.
    """
    segs = street_segments(addr)
    if not segs:
        return ''
    seg = re.sub(STREET_NUMBER, '', segs[0]).strip()
    m = re.search(r"([A-Za-z][A-Za-z'\-\s]{2,30}?\s+" + STREET_WORD + r")\b", seg, re.I)
    return m.group(1).strip().lower() if m else ''


def nominatim(query: str):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': query, 'format': 'json', 'limit': 1, 'countrycodes': 'au',
         'addressdetails': 1})
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def queries_for(addr):
    """The lookups to try, in order, stopping at the first that returns a hit.

    1. From the road onward — drops "Level 8", "Suite 4", "Nishi Building".
    2. Road plus locality, postcode dropped. Some of these registered postcodes
       are the company's PO box rather than the street's, and Nominatim scores
       a conflicting postcode as a miss rather than ignoring it.
    3. The address exactly as supplied, in case the road scan guessed wrong.

    Every candidate still faces the same street-match gate, so a looser query
    cannot smuggle in a wrong building — it can only fail to find one.
    """
    segs = street_segments(addr)
    out = []
    if segs:
        out.append(', '.join(segs))
        if len(segs) > 1:
            loose = re.sub(r"\s*\b\d{4}\b\s*$", '', segs[-1]).strip()
            cand = ', '.join(segs[:-1] + ([loose] if loose else []))
            if cand not in out:
                out.append(cand)
    if addr not in out:
        out.append(addr)
    # 4. LAST RESORT: the street without its number. OSM has no house numbers on
    #    many Australian streets, and for some — "19 The Mall, Darwin",
    #    "76 The Esplanade, Darwin" — a numbered query returns NOTHING rather
    #    than the road, so the whole address is rejected and the company falls
    #    back to a fan position bearing no relation to where it is. The street
    #    centroid is less precise than a building and far better than that; the
    #    street-match gate still applies, so it can only land on the named road.
    #    21 of Adelaide's entries already sit at street level for the same
    #    reason, accepted because the road matched.
    if segs:
        bare = re.sub(STREET_NUMBER, '', segs[0]).strip()
        cand = ', '.join([bare] + segs[1:])
        if bare and cand not in out:
            out.append(cand)
    return out


# Coordinates confirmed by hand, used INSTEAD of a lookup.
#
# This is not a loophole in the no-name-search rule above. That rule bans asking
# the geocoder to find a COMPANY, because it answers with a similarly-named
# firm's building. These are the opposite case: a user-supplied address whose
# location is a NAMED PLACE — a precinct, a cemetery, a theatre — where the
# street line alone resolves to the middle of a road and the place itself
# resolves exactly. Each was checked against OpenStreetMap and the match type it
# returned is recorded, so the claim can be re-tested rather than believed.
PINNED: dict[str, tuple[float, float, str]] = {
    # BHP IS PLOTTED IN SIX CITIES AND CAN HOLD ONE COORDINATE. realCoord() is
    # keyed by company id, so whatever is here is where BHP's pin sits in Perth,
    # Melbourne, Adelaide, Brisbane, Manila and Kuala Lumpur alike — it was at
    # 171 Collins Street, Melbourne, which put it 654 km off-frame on the
    # Adelaide map and further on the others. Pinned to the Adelaide office at
    # the user's instruction; the CSV still records Melbourne as the registered
    # office, because that remains true and is not this file's job to overwrite.
    # A per-city coordinate is the real fix and is a larger change than this.
    'bhp': (138.598754, -34.926787, 'OSM "GPO Exchange, 10 Franklin Street" [building]'),
    # Lot Fourteen is a precinct on the old RAH site; "North Terrace and Frome
    # Rd" is a corner, and a corner geocodes to a road.
    'adelaide-axe': (138.608529, -34.919318, 'OSM "Lot 14, Adelaide" [institutional]'),
    # The building is named in the address and IS in OSM; the street number is
    # not. Sits inside Lot Fourteen, ~30 m from Archer above.
    'aps-australian-space-agency': (138.608774, -34.920494, 'OSM "McEwin Building" [building]'),
    # King William Road has no number for the Centre; the Centre is an amenity.
    'sa-gov-adelaide-festival-centre-trust': (138.597791, -34.919576,
                                              'OSM "Adelaide Festival Centre" [amenity]'),
    # Browning Street is the frontage of a 60-hectare cemetery; the park is the
    # place, and the road centroid is 500 m from it.
    'sa-gov-adelaide-cemeteries-authority': (138.610278, -34.857389,
                                             'OSM "Enfield Memorial Park & Crematorium" [cemetery]'),
    # Darwin. "Parliament House, Mitchell Street" has no number and Mitchell
    # Street is a kilometre long; the building is mapped by name.
    'nt-gov-department-of-legislative-assembly': (130.842857, -12.466656,
                                                 'OSM "NT Parliament House, State Square" [office]'),
    # "Berrimah Farm, Makagon Road" — the farm is a research precinct, mapped
    # under its full name, and Makagon Road runs past several of them.
    'nt-gov-department-of-agriculture-and-fisheries': (130.929498, -12.444127,
                                                      'OSM "Berrimah Research Farm" [amenity]'),
    # "19 The Mall" is 19 SMITH STREET MALL — Darwin's pedestrian mall, which the
    # addresses shorten to "The Mall" and OSM does not. A numbered query for
    # "The Mall" found Bradshaw Terrace, a different street entirely, which the
    # street-match gate correctly rejected; that is why both departments sat on
    # the fan. OSM carries house number 19 on Smith Street Mall under its
    # ground-floor tenant, which is the building the Charles Darwin Centre is.
    # Two floors of one building, so both share the coordinate — realCoord()
    # nudges the second pin ~20 m so neither becomes unclickable.
    'nt-gov-department-of-tourism-and-hospitality': (130.843114, -12.464606,
                                                    'OSM house number 19, Smith Street Mall [shop]'),
    'nt-gov-department-of-treasury-and-finance': (130.843114, -12.464606,
                                                 'OSM house number 19, Smith Street Mall [shop]'),
    # "Torrens Parade Ground, Victoria Drive" — a named parade ground, mapped
    # under its own name; Victoria Drive runs the length of the parklands.
    'sa-gov-history-trust-of-south-australia': (138.600475, -34.917793,
                                               'OSM "Torrens Parade Ground" [amenity]'),
    # Main North Road through Clare IS Horrocks Highway — the road was renamed
    # and OSM carries the new name, so the street-match gate rejected an answer
    # that was correct. Pinned rather than teaching the gate about road aliases,
    # which would weaken it everywhere to fix one address.
    'sa-gov-northern-and-yorke-landscape-board': (138.613308, -33.834961,
                                                 'OSM Horrocks Highway (= Main North Road), Clare'),
    # CBA's Adelaide address is a CORNER — "North Terrace and Frome Street" —
    # which names an intersection rather than a building, and geocodes to
    # nothing. That corner is the Lot Fourteen precinct, already resolved for
    # Archer Materials and the Space Agency, so it is pinned to the same point;
    # realCoord() nudges co-located pins onto a ring so all three stay
    # clickable. Keyed to Adelaide only: CBA is drawn on five maps.
    'adelaide:sydney-cba': (138.608529, -34.919318, 'OSM "Lot 14, Adelaide" [institutional]'),
    # "Festival Tower, Station Road, Adelaide" — Adelaide's Station Road is
    # short and unnumbered in OSM, and there is another Station Road at
    # Blackwood 13 km south, which is what a road-name query returns. The tower
    # is mapped under its own name at 1 Festival Drive.
    'adelaide:sydney-org': (138.598067, -34.920687, 'OSM "Festival Tower" [building], postcode 5000'),
}

# Standing notes emitted above an entry, so an explanation survives the next
# regeneration. The file says "do not hand-edit" and means it: a note written
# into the output is deleted by the following run, silently, and the reason a
# coordinate looks wrong goes with it. This one was already there and was lost
# the first time the merge path ran.
NOTES: dict[str, list[str]] = {
    'sydney-rmd': ["ResMed's Australian head office. The global HQ is 9001 Spectrum Center",
                   'Blvd, San Diego — this roster plots where a company employs, and the ANZ',
                   'workforce its careers board recruits into is based here.'],
}

# --only id,id: regenerate just these and keep every other entry as it stands.
# Without it a one-address correction re-queries all 625, which is 25 minutes of
# somebody else's rate limit and re-rolls every coordinate in the file against
# whatever OSM says today — a change nobody asked for, attached to one they did.
ONLY = set((_opt_only := [a for a in sys.argv[1:]]) and
           (sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else []))


def existing_coords() -> dict[str, list]:
    """What the generated file already holds, so --only can merge into it."""
    if not os.path.exists(OUT):
        return {}
    txt = open(OUT, encoding='utf-8').read()
    # THE COLON IS PART OF THE KEY. City-scoped entries look like
    # "adelaide:sydney-wbc", and a character class without ':' still matched the
    # tail — so the merge read that key back as plain "sydney-wbc" and rewrote
    # it unscoped, quietly undoing the scoping the previous run had done. It was
    # only visible because Westpac's Sydney pin moved to Adelaide.
    found = {m.group(1): [float(m.group(2)), float(m.group(3))]
             for m in re.finditer(r'"([A-Za-z0-9_:-]+)":\s*\[(-?[\d.]+),\s*(-?[\d.]+)\]', txt)}
    # Same guard as gen-linkedin-logos: a tolerant pattern is still a pattern,
    # so the count is checked against the file rather than trusted. Merging
    # against a short map deletes every entry it could not see.
    entries = len(re.findall(r'^\s*"?[A-Za-z0-9_:-]+"?:\s*\[', txt, re.M))
    if len(found) < entries:
        raise RuntimeError(
            f'read {len(found)} of {entries} stored coordinates — the parser no longer '
            'understands the file it wrote. Refusing to merge, because a short map '
            'silently deletes the entries it could not see.')
    return found


def main() -> int:
    ADDRESSES = load_addresses()
    out: dict[str, list] = existing_coords() if ONLY else {}
    if ONLY:
        sys.stderr.write(f'--only: regenerating {len(ONLY)} of {len(out)} stored entries\n')
    rejected: list[str] = []
    far: list[str] = []
    NCITIES = plotted_cities()

    def key_for(city: str, cid: str) -> str:
        """Where this coordinate is written.

        A company on ONE map keeps its plain company key — nothing about it is
        ambiguous and every existing reader still finds it. A company on
        SEVERAL gets city-scoped keys only, so its Adelaide office cannot become
        its Sydney pin. realCoord() in mapboxGeo.ts reads "<city>:<id>" first
        and falls back to "<id>".
        """
        return cid if NCITIES.get(cid, 1) <= 1 else f'{city}:{cid}'

    for (city, cid), addr in sorted(ADDRESSES.items()):
        if ONLY and cid not in ONLY:
            continue
        pin = PINNED.get(f'{city}:{cid}') or PINNED.get(cid)
        if pin:
            lon, lat, why = pin
            out[key_for(city, cid)] = [lon, lat]
            print(f'  pinned {key_for(city, cid)}: {lon},{lat} — {why}')
            continue
        res, err = [], None
        for q in queries_for(addr):
            try:
                res = nominatim(q)
            except Exception as e:
                err = e
                res = []
            time.sleep(1.2)
            if res:
                break
        if not res:
            rejected.append(f'{cid}: lookup failed ({err})' if err
                            else f'{cid}: no match for {addr!r}')
            continue
        hit = res[0]
        lon, lat = float(hit['lon']), float(hit['lat'])
        road = (hit.get('address') or {}).get('road', '') or ''
        want = street_of(addr)

        # "The Esplanade" is what the address says and "Esplanade" is what OSM
        # calls it; a leading definite article is a naming convention, not a
        # different street, and comparing it literally rejected a correct answer.
        got = re.sub(r'^the\s+', '', road.lower())
        want = re.sub(r'^the\s+', '', want)
        # POSTCODE, checked alongside the street name. Matching only the road
        # name accepts the RIGHT STREET IN THE WRONG SUBURB, and Australian
        # street names repeat constantly: "Station Road, Adelaide SA 5000"
        # returns Station Road at Blackwood, postcode 5051, thirteen kilometres
        # south — a perfectly formed coordinate for a different place, which is
        # how Origin Energy came to be pinned at a suburban railway station.
        # Only applied when the address states a postcode and the geocoder
        # returns one; a missing value on either side proves nothing.
        want_pc = (re.search(r'\b(?:NSW|VIC|QLD|SA|WA|NT|ACT|TAS)\s+(\d{4})\b', addr)
                   or [None, ''])[1]
        got_pc = (hit.get('address') or {}).get('postcode', '') or ''
        if want and want not in got:
            # Right city, wrong street: exactly the Macquarie failure.
            rejected.append(f'{cid}: asked for {want!r}, geocoder returned {road!r} — {addr}')
        elif want_pc and got_pc and want_pc != got_pc:
            rejected.append(f'{cid}: right street name, wrong place — postcode {got_pc} '
                            f'not {want_pc} — {addr}')
        else:
            out[key_for(city, cid)] = [round(lon, 6), round(lat, 6)]
            cx, cy = CITY_CENTRE.get(city, (lon, lat))
            km = (((lon - cx) * 88) ** 2 + ((lat - cy) * 111) ** 2) ** 0.5
            if km > 120:
                far.append(f'{cid} ({city}): {km:.0f} km out — {addr}')
        time.sleep(1.2)

    # A MULTI-CITY COMPANY MUST NOT KEEP A PLAIN KEY. realCoord() falls back
    # from "<city>:<id>" to "<id>", so one left behind by an earlier run — or by
    # the merge, which carries every stored key forward — becomes the coordinate
    # for every city that has no scoped entry. That is exactly how Westpac's
    # Sydney pin ended up on its Adelaide office: the scoped key was correct and
    # a stale plain key underneath it won everywhere else.
    # ONLY when a scoped key actually exists to replace it. A partial --only run
    # regenerates a handful of companies, so dropping every multi-city plain key
    # would strip Santos, Rio, South32 and Woodside of the only coordinate they
    # have and send them to the fan on every map — deleting good data to fix a
    # different company. Measured: the unconditional version dropped 12 keys and
    # 5 of them had no replacement.
    scoped = {k.split(':', 1)[1] for k in out if ':' in k}
    stale = [k for k in out if ':' not in k and NCITIES.get(k, 1) > 1 and k in scoped]
    for k in stale:
        del out[k]
    if stale:
        print(f'dropped {len(stale)} plain keys for companies drawn on more than one map '
              f'(they fall back to the fan where no city-scoped address exists): '
              + ', '.join(sorted(stale)))

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
        # An id carried over by --only may no longer have a CSV row (a company
        # dropped from the roster keeps its coordinate until someone removes it).
        # Annotating it is a nicety; crashing the whole write over a missing
        # comment is not.
        for line in NOTES.get(cid.split(':', 1)[-1], []):
            body.append(f'  // {line}')
        base = cid.split(':', 1)[1] if ':' in cid else cid
        hit = next((a for (c, i), a in ADDRESSES.items() if i == base
                    and (':' not in cid or c == cid.split(':', 1)[0])), None)
        note = hit or 'no address row (merged from a previous run)'
        body.append(f'  "{cid}": [{lon}, {lat}], // {note}')
    body.append('};')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(body) + '\n')
    print(f'wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
