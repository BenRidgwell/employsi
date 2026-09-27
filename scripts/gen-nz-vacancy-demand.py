#!/usr/bin/env python3
"""Regenerate src/employsi/data/nzVacancyDemand.ts from MBIE's "Jobs Online"
MONTHLY unadjusted series (May 2007 onward), the CSV with one row per month and
one column per region, industry and occupation group.

WHAT CHANGED, AND WHY THIS FILE REPLACED THE QUARTERLY READER (2026-09-27).
This used to read the "Jobs Online vacancies by occupation" release, which is
quarterly and splits occupation BY REGION — so Auckland had its own occupation
series. Three things were wrong with the result and all three are the release,
not the code:

  · QUARTERLY, FORWARD-FILLED. Each value was repeated across its three months,
    so every month-to-month movement in the output was an artefact of the fill.
    NZ online advertising is strongly seasonal — December runs at roughly half
    of November and January rebounds past it — and a forward-filled quarter
    erases exactly that.
  · IT STARTED AT DEC 2010. The monthly series starts May 2007, which brings the
    global financial crisis into view: the national index falls from 109.7 in
    May 2008 to 51.8 in April 2009, a halving the quarterly file never saw.
  · IT FELL BEHIND THE AXIS. IVI_MONTHS was extended to 2026-07 on 2026-09-21
    and this file was not regenerated, so its arrays were 243 long against a
    245-month axis and the last two months read as `undefined` in skillHeat.
    Monthly data that runs to 2026-08 cannot drift that way as easily, and
    check-vacancy-series.ts now asserts the length outright.

WHAT IT COSTS. The monthly release's occupation columns are NATIONAL; only the
totals are regional. So Auckland's occupation mix is no longer Auckland's own —
it is the national mix, rescaled month by month so the city's LEVEL follows its
own measured total:

    auckland_occ(m) = national_occ(m) x auckland_total(m) / national_total(m)

Both indices share the May 2007 = 100 base, so the factor is exactly 1 at the
base month and the rescale only ever expresses how Auckland has moved against
the country since. That is a real assumption — Auckland's occupation mix is not
the country's — and it is the one thing this file gives up for monthly detail.
It is stated in the generated header so nobody has to read this docstring to
find it.

WHY WELLINGTON IS NOT HERE, though the CSV carries it. The series is an INDEX,
not counts, so a city needs an anchor level from outside the file; Auckland has
one (ANCHOR_AUCKLAND below). Wellington would need the Auckland:Wellington ratio
of online ads at a known month, which this release does not publish — both
regions are separately based at 100 in May 2007, so their ratio today says only
how differently they have GROWN. Anchoring it off our own archive was
considered and rejected: our NZ scrape is government-heavy and so
Wellington-heavy, which would put Wellington at about 90% of Auckland when the
labour market is nearer a third. One published regional ad count, for any single
month, is the whole of what is missing.

Usage: python3 scripts/gen-nz-vacancy-demand.py path/to/jol-monthly.csv
"""
import csv
import json
import re
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from skills_taxonomy import load_categories  # noqa: E402

ROOT = __file__.rsplit('/scripts/', 1)[0]
TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'
IVI = f'{ROOT}/src/employsi/data/iviSkillDemand.ts'
OUT = f'{ROOT}/src/employsi/data/nzVacancyDemand.ts'
CITY = 'auckland'
# Realistic current Auckland online-vacancy level. UNCHANGED from the quarterly
# generator: the release is an index, the app wants levels, and changing this
# alongside the source change would make the two impossible to tell apart in the
# diff.
ANCHOR_AUCKLAND = 11000

# The CSV's own column headings. The eight occupation columns ARE the ANZSCO
# major groups — NZ shares the classification with Australia, so no crosswalk is
# needed here at all, which is the opposite of what the Asian releases need.
COL_TOTAL = 'TOTALS'
COL_CITY = 'Auckland'
OCC_COLS = [
    'Managers',
    'Professionals',
    'Technicians and Trades Workers',
    'Community and Personal Service Workers',
    'Clerical and Administrative Workers',
    'Sales Workers',
    'Machinery Operators and Drivers',
    'Labourers',
]

# skillsTaxonomy `cat` → ANZSCO major group. CARRIED OVER UNCHANGED from the
# quarterly generator, under its old group names, so that this rewrite changes
# the SOURCE and nothing else. Note that nothing maps to Managers: management
# skills sit in `Corporate`, which the original author put with Professionals,
# and moving them now would shift those skills' whole history for a reason
# unrelated to the new release.
CAT_TO_NZ = {
    'Digital': 'Professionals', 'Engineering': 'Professionals', 'Science': 'Professionals',
    'Health': 'Professionals', 'Education': 'Professionals', 'Financial': 'Professionals',
    'Creative': 'Professionals', 'Built Environment': 'Professionals', 'Public Sector': 'Professionals',
    'Sector': 'Professionals', 'Corporate': 'Professionals', 'Energy': 'Professionals',
    'Admin': 'Clerical and Administrative Workers',
    'Sales': 'Sales Workers', 'Property': 'Sales Workers',
    'Trades': 'Technicians and Trades Workers', 'Construction': 'Technicians and Trades Workers',
    'Care': 'Community and Personal Service Workers',
    'Community': 'Community and Personal Service Workers',
    'Personal': 'Community and Personal Service Workers',
    'Hospitality': 'Community and Personal Service Workers',
    'Safety': 'Community and Personal Service Workers',
    'Transport': 'Machinery Operators and Drivers',
    'Mining': 'Machinery Operators and Drivers',
    'Manufacturing': 'Machinery Operators and Drivers',
    'Agriculture': 'Labourers', 'Cleaning': 'Labourers',
}


def load_skills():
    """(skill, cat) pairs, from the one shared reader — see skills_taxonomy.py."""
    return load_categories(TAX)


def load_ivi_national():
    body = open(IVI).read().split('IVI_SKILL_NATIONAL', 1)[1].split('{', 1)[1].split('};', 1)[0]
    return {m.group(1): int(m.group(2)) for m in re.finditer(r'"([^"]+)":\s*(\d+)', body)}


def load_ivi_months():
    m = re.search(r'IVI_MONTHS: string\[\] = (\[.*?\]);', open(IVI).read(), re.S)
    return json.loads(m.group(1))


def read_jol(path):
    """month 'YYYY-MM' → {'total': float, 'city': float, occupation: float}."""
    out = {}
    with open(path, newline='') as fh:
        for row in csv.DictReader(fh):
            d = (row.get('ACTUAL_DATE') or '').strip()
            m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', d)
            if not m:
                raise SystemExit(f'unreadable ACTUAL_DATE {d!r} — expected dd/mm/yyyy')
            ym = f'{m.group(3)}-{int(m.group(2)):02d}'
            rec = {}
            for key, col in [('total', COL_TOTAL), ('city', COL_CITY)]:
                rec[key] = float(row[col])
            for occ in OCC_COLS:
                rec[occ] = float(row[occ])
            # A zero national total would make the regional factor infinite. The
            # index cannot be zero by construction, so this is a corrupt-file
            # guard rather than a real case — and a silent inf here would reach
            # the app as a skill with no history at all.
            if rec['total'] <= 0:
                raise SystemExit(f'{ym}: national total is {rec["total"]}, cannot rescale')
            out[ym] = rec
    if not out:
        raise SystemExit('no rows read — is this the monthly JOL CSV?')
    months = sorted(out)
    # Consecutive months, or the "monthly" claim in the header is not true and
    # a gap would be drawn as a step rather than as missing data.
    for a, b in zip(months, months[1:]):
        ay, am = map(int, a.split('-'))
        by, bm = map(int, b.split('-'))
        if (by - ay) * 12 + (bm - am) != 1:
            raise SystemExit(f'gap in the monthly series: {a} -> {b}')
    return out


def main(path):
    skills = load_skills()
    nat = load_ivi_national()
    months = load_ivi_months()
    jol = read_jol(path)
    have = sorted(jol)
    first_nz, last_nz = have[0], have[-1]

    def occ_index(group, ym):
        """The city's index for one occupation group, or None before the series.

        National occupation movement, rescaled to the city's own total. See the
        docstring: the mix is the country's, the level is Auckland's.
        """
        rec = jol.get(ym)
        if rec is None:
            return None
        return rec[group] * rec['city'] / rec['total']

    # The most recent month the AXIS and the RELEASE agree on. The release runs
    # a month ahead of IVI_MONTHS today (2026-08 vs 2026-07); anchoring on a
    # month the axis cannot hold would put the present-day level on a point the
    # app never draws.
    shared = [m for m in months if m in jol]
    if not shared:
        raise SystemExit(f'no overlap: release {first_nz}..{last_nz}, axis {months[0]}..{months[-1]}')
    anchor_ym = shared[-1]
    anchor_i = months.index(anchor_ym)

    total_nat = sum(nat.get(s, 0) for s, cat in skills if cat in CAT_TO_NZ and nat.get(s, 0) > 0)
    unmapped = sorted({cat for _, cat in skills if cat not in CAT_TO_NZ})
    if unmapped:
        raise SystemExit(f'taxonomy categories with no ANZSCO group: {unmapped}')

    series, latest, no_weight = {}, {}, []
    for s, cat in skills:
        group = CAT_TO_NZ[cat]
        # NO AU MIX WEIGHT, NO NZ SERIES. The city's total is split onto skills
        # by the AU IVI national mix, so a skill the IVI file has never heard of
        # cannot be given a share of it. It used to be floored at 1, which after
        # the split came to 0.09 ads and rounded to 0 — a skill sitting on the
        # NZ map claiming nobody in Auckland is hiring for it. Measured
        # 2026-09-27: Strategy, added to the taxonomy two days after the IVI
        # file was last generated, was exactly that.
        #
        # Left out, the skill simply has no NZ data, which is what is true, and
        # skillHeat merges the countries that do have it. Regenerating the IVI
        # file brings it back on its own.
        weight = nat.get(s, 0)
        if weight <= 0:
            no_weight.append(s)
            continue
        cur = ANCHOR_AUCKLAND * weight / total_nat
        base = occ_index(group, anchor_ym)
        if not base:
            raise SystemExit(f'{anchor_ym}: no index for {group}')
        arr = []
        for ym in months:
            idx = occ_index(group, ym)
            # Before the release begins is NOT zero demand, it is no
            # measurement — the app draws a zero as the start of the series,
            # which is the same convention every other country file here uses.
            arr.append(0 if idx is None else round(cur * idx / base))
        if len(arr) != len(months):
            raise SystemExit(f'{s}: {len(arr)} points against a {len(months)}-month axis')
        series[s] = {CITY: arr}
        latest[s] = {CITY: arr[anchor_i]}

    order = sorted(series, key=lambda s: -latest[s][CITY])
    covered = sum(1 for ym in months if ym in jol)

    L = []
    L.append('// GENERATED — do not edit by hand. Run scripts/gen-nz-vacancy-demand.py.')
    L.append('// Source: New Zealand MBIE — Jobs Online, MONTHLY unadjusted series (an INDEX,')
    L.append('// May 2007 = 100), one row per month from 2007-05.')
    L.append('//')
    L.append('// The release\'s eight occupation columns are the ANZSCO major groups — NZ shares')
    L.append('// the classification with Australia, so no crosswalk is needed. They are NATIONAL,')
    L.append('// though, and only the totals are regional, so Auckland\'s series is the national')
    L.append('// occupation movement rescaled month by month to Auckland\'s own total index:')
    L.append('// the MIX is the country\'s, the LEVEL is the city\'s. Present-day skill levels are')
    L.append('// anchored to a realistic Auckland online-vacancy level and split by the AU')
    L.append('// JSA/IVI national mix. Aligned to the IVI_MONTHS axis; months before 2007-05')
    L.append('// are zero.')
    L.append('')
    L.append(f"export const NZ_MONTH = '{anchor_ym}';")
    L.append("export const NZ_SOURCE =")
    L.append("  'New Zealand MBIE — Jobs Online monthly series (Auckland, indexed)';")
    L.append('')
    L.append('export const NZ_CITIES: string[] = ' + json.dumps([CITY]) + ';')
    L.append('')
    L.append('// Skill → Auckland → monthly vacancy history (aligned to IVI_MONTHS).')
    L.append('export const NZ_SERIES: Record<string, Record<string, number[]>> = {')
    for s in order:
        L.append(f'  {json.dumps(s)}: {{ {CITY}: [{",".join(map(str, series[s][CITY]))}] }},')
    L.append('};')
    L.append('')
    L.append('// Skill → latest-month Auckland vacancy count (current heat map).')
    L.append('export const NZ_SKILL_BY_CITY: Record<string, Record<string, number>> = {')
    for s in order:
        L.append(f'  {json.dumps(s)}: {{ {CITY}: {latest[s][CITY]} }},')
    L.append('};')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))
    tot = sum(latest[s][CITY] for s in order)
    print(f'{anchor_ym}: {len(order)} skills, release {first_nz}..{last_nz} (monthly), '
          f'{covered}/{len(months)} axis months covered, Auckland latest total {tot} -> {OUT}')
    if no_weight:
        print(f'  no AU mix weight, left out: {", ".join(sorted(no_weight))} '
              f'(regenerate {IVI.rsplit("/", 1)[1]} to include them)')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-nz-vacancy-demand.py path/to/jol-monthly.csv')
    main(sys.argv[1])
