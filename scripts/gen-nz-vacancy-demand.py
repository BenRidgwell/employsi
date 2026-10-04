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

AUCKLAND AND WELLINGTON, and where each city's LEVEL comes from. The series is
an index, so nothing in the release says how large a region is — both are based
at 100 in May 2007, and their ratio today says only how differently they have
grown since. Auckland carries a level anchor from the quarterly generator;
Wellington's is derived from Stats NZ filled jobs. See CITY_ANCHOR, which argues
the substitution and names what would replace it.

Usage: python3 scripts/gen-nz-vacancy-demand.py path/to/jol-monthly.csv
"""
import csv
import json
import re
import sys

import openpyxl

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from skills_taxonomy import load_categories  # noqa: E402

ROOT = __file__.rsplit('/scripts/', 1)[0]
TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'
IVI = f'{ROOT}/src/employsi/data/iviSkillDemand.ts'
OUT = f'{ROOT}/src/employsi/data/nzVacancyDemand.ts'
# app hub id → (the release's region column, that city's anchor level).
#
# THE ANCHOR IS THE ONE NUMBER THIS RELEASE CANNOT SUPPLY. Jobs Online is an
# INDEX and every region is separately based at 100 in May 2007, so the file
# says how each region has MOVED and never how large it is. Auckland's anchor is
# carried over unchanged from the quarterly generator — a realistic current
# Auckland online-vacancy level — so that swapping the source changed the source
# and nothing else.
#
# A city with `None` is not emitted. That is deliberate and is the whole reason
# this is a table rather than a constant: Wellington is in the release, its index
# is read and rescaled exactly like Auckland's, and it will appear the moment a
# published regional ad COUNT for any single month is dropped in here. Until
# then it is left out rather than guessed, because the guess is the part a
# reader would never see: a wrong anchor does not look wrong, it looks like
# Wellington.
#
# WELLINGTON IS ANCHORED ON EMPLOYMENT, NOT ON ADS, and that substitution is
# the one judgement in this file worth arguing with.
#
# There is no published New Zealand job-ad COUNT by region. Jobs Online is an
# index by design — the underlying ads are licensed from the job boards — and
# both MBIE releases confirm it: the monthly series bases every region at 100 in
# May 2007, and the quarterly occupation-by-region workbook bases all sixteen
# region x occupation cells at 100 in December 2010. Figure.NZ republishes the
# same series, indexed. mbie.govt.nz and data.govt.nz cannot be read from the
# build sandbox at all (Imperva returns a 212-byte challenge on every path).
#
# So Wellington's LEVEL comes from Stats NZ Business Employment Data — filled
# jobs by region — and Auckland's own anchor carries it:
#
#     wellington = ANCHOR_AUCKLAND x WLG_FILLED_JOBS / AKL_FILLED_JOBS
#
# WHAT THAT ASSUMES: that the two cities advertise in proportion to the jobs
# they hold. They do not, quite. Wellington is the seat of the public service,
# which hires on different cycles and at different rates from Auckland's private
# sector, so its share of ADS is not exactly its share of JOBS. The error is a
# level shift on one city, it does not touch the shape of any series, and it is
# named here so that a single published regional ad count replaces it in one
# line.
#
# Rejected: our own D1 archive, where Auckland holds 1,263 recent ads to
# Wellington's 1,148. That ratio is our SCRAPE, not the market — the NZ feed is
# government-heavy and therefore Wellington-heavy — and it would put Wellington
# at 91% of Auckland.
#
# Stats NZ Business Employment Data, June 2026 quarter, via Figure.NZ table
# o1397DyrtpI5ZHD0 (series MEIM.SB1RA*, "Filled jobs" by region, Actual).
AKL_FILLED_JOBS = 795_137
WLG_FILLED_JOBS = 253_220  # 31.8% of Auckland

CITY_ANCHOR: dict[str, tuple[str, int | None]] = {
    'auckland': ('Auckland', 11000),
    'wellington': ('Wellington', round(11000 * WLG_FILLED_JOBS / AKL_FILLED_JOBS)),
}

# The CSV's own column headings. The eight occupation columns ARE the ANZSCO
# major groups — NZ shares the classification with Australia, so no crosswalk is
# needed here at all, which is the opposite of what the Asian releases need.
COL_TOTAL = 'TOTALS'
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

# ── the occupation-by-region tilt ───────────────────────────────────────────
# The monthly release's occupation columns are NATIONAL. The quarterly
# "vacancies by occupation" workbook carries each occupation SPLIT BY REGION —
# AKL and WLG among ten — so the two together give what neither gives alone:
# monthly movement, tilted to each city's own occupation trend.
#
# Its sheet lays the eight occupations out in blocks of ten region columns, AKL
# first and WLG tenth, dated by quarter-END month and based at Dec 2010 = 100
# for every one of the sixteen region x occupation cells.
TILT_SHEET = 'Data'
TILT_BLOCK = {
    'Managers': 1, 'Professionals': 11, 'Trades and Technical': 21,
    'Community Services': 31, 'Clerical_Admin': 41, 'Sales': 51,
    'Machinery_Drivers': 61, 'Labourers': 71,
}
TILT_REGION_OFFSET = {'auckland': 0, 'wellington': 9}
# The monthly release's ANZSCO names → the workbook's shorter block headings.
OCC_TO_TILT = {
    'Managers': 'Managers',
    'Professionals': 'Professionals',
    'Technicians and Trades Workers': 'Trades and Technical',
    'Community and Personal Service Workers': 'Community Services',
    'Clerical and Administrative Workers': 'Clerical_Admin',
    'Sales Workers': 'Sales',
    'Machinery Operators and Drivers': 'Machinery_Drivers',
    'Labourers': 'Labourers',
}

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


def quarter_of(ym):
    """'2013-05' → '2013-06', the quarter-END month the workbook is dated by."""
    y, mo = ym.split('-')
    return f'{y}-{((int(mo) - 1) // 3) * 3 + 3:02d}'


def read_tilt(path):
    """(city, workbook occupation) → {quarter-end 'YYYY-MM': index}, Dec 2010 = 100."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if TILT_SHEET not in wb.sheetnames:
        raise SystemExit(f'{path}: no {TILT_SHEET!r} sheet — is this the by-occupation workbook?')
    out = {(c, occ): {} for c in TILT_REGION_OFFSET for occ in TILT_BLOCK}
    for row in wb[TILT_SHEET].iter_rows(values_only=True):
        if not row or not hasattr(row[0], 'strftime'):
            continue
        ym = row[0].strftime('%Y-%m')
        for occ, col in TILT_BLOCK.items():
            for city, off in TILT_REGION_OFFSET.items():
                v = row[col + off] if col + off < len(row) else None
                if isinstance(v, (int, float)):
                    out[(city, occ)][ym] = float(v)
    empty = [k for k, v in out.items() if not v]
    if empty:
        raise SystemExit(f'no quarterly values for {empty[:3]} — check the column layout')
    # Every cell must be based at 100 in the same quarter, or the tilt is being
    # taken between two differently-based series and is a ratio of nothing.
    base = min(min(v) for v in out.values())
    off_base = {k: v[base] for k, v in out.items() if abs(v.get(base, 0) - 100) > 1e-9}
    if off_base:
        raise SystemExit(f'{base} is not the common base: {list(off_base.items())[:3]}')
    return out, base


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
            rec = {'total': float(row[COL_TOTAL])}
            for hub, (col, _anchor) in CITY_ANCHOR.items():
                rec[hub] = float(row[col])
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


def main(path, tilt_path):
    skills = load_skills()
    nat = load_ivi_national()
    months = load_ivi_months()
    jol = read_jol(path)
    have = sorted(jol)
    first_nz, last_nz = have[0], have[-1]
    tilt_raw, tilt_base = read_tilt(tilt_path)
    tilt_quarters = sorted(next(iter(tilt_raw.values())))

    # ── the tilt, quarter by quarter ────────────────────────────────────────
    # A city's occupation index divided by the NATIONAL one for the same
    # occupation and quarter, both rebased to the workbook's base. It is what
    # the monthly national movement is multiplied by, and it is 1 at the base
    # quarter for every city and occupation by construction.
    #
    # The national side is the mean of the quarter's three monthly values.
    # Taking the quarter-end month instead would compare a quarterly average
    # against a single month, and December alone — the deepest month of the NZ
    # year — against a quarter containing it.
    def nat_quarter(occ, q):
        vals = [jol[m][occ] for m in have if quarter_of(m) == q]
        return sum(vals) / len(vals) if vals else None

    nat_base = {occ: nat_quarter(occ, tilt_base) for occ in OCC_COLS}
    missing_base = [o for o, v in nat_base.items() if not v]
    if missing_base:
        raise SystemExit(f'{tilt_base}: monthly release has no values for {missing_base}')

    tilt = {}
    for (city, wocc), byq in tilt_raw.items():
        occ = next(o for o, w in OCC_TO_TILT.items() if w == wocc)
        for q, regional in byq.items():
            nat_q = nat_quarter(occ, q)
            if not nat_q:
                continue
            national = nat_q / nat_base[occ] * 100
            if national <= 0:
                continue
            tilt[(city, occ, q)] = regional / national

    # Before the workbook begins there is no per-occupation regional signal, so
    # the city's TOTAL carries the deviation instead — rebased so that it equals
    # 1 at the base quarter, where the occupation tilt also equals 1.
    #
    # THAT REBASING IS THE POINT, not tidiness. The two methods do not meet on
    # their own: the total-based factor is around 0.5 at the splice and the
    # occupation tilt is exactly 1, so switching between them mid-series would
    # have doubled every NZ city overnight in December 2010 and drawn it as a
    # hiring boom. Rebasing makes the join continuous, and everything after the
    # splice is ratio-normalised to the anchor anyway, so the pre-period is the
    # only part it moves.
    total_factor_at_base = {}
    for hub in CITY_ANCHOR:
        base_months = [m for m in have if quarter_of(m) == tilt_base]
        if not base_months:
            raise SystemExit(f'monthly release does not reach {tilt_base}')
        total_factor_at_base[hub] = sum(jol[m][hub] / jol[m]['total'] for m in base_months) / len(
            base_months
        )

    last_quarter = tilt_quarters[-1]

    def occ_index(hub, group, ym):
        """A hub's index for one occupation group, or None before the series.

        National monthly occupation movement, tilted by that city's own
        occupation trend for the quarter — see the note above the tilt.
        """
        rec = jol.get(ym)
        if rec is None:
            return None
        q = quarter_of(ym)
        if q < tilt_base:
            # Pre-workbook: the city's total, rebased to join at the splice.
            return rec[group] * (rec[hub] / rec['total']) / total_factor_at_base[hub]
        # Past the workbook's last quarter the tilt is held rather than
        # extrapolated. It is a slow-moving ratio — a city's occupation mix does
        # not turn over in a quarter — and the alternative is inventing a trend
        # in it from nothing.
        f = tilt.get((hub, group, min(q, last_quarter)))
        if f is None:
            return None
        return rec[group] * f

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

    cities = [c for c, (_col, a) in CITY_ANCHOR.items() if a]
    no_anchor = [c for c, (_col, a) in CITY_ANCHOR.items() if not a]
    if not cities:
        raise SystemExit('no city has an anchor level — nothing to emit')

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
        by_city, last_city = {}, {}
        for hub in cities:
            anchor = CITY_ANCHOR[hub][1]
            cur = anchor * weight / total_nat
            base = occ_index(hub, group, anchor_ym)
            if not base:
                raise SystemExit(f'{anchor_ym}: no index for {group} in {hub}')
            arr = []
            for ym in months:
                idx = occ_index(hub, group, ym)
                # Before the release begins is NOT zero demand, it is no
                # measurement — the app draws a zero as the start of the
                # series, which is the same convention every other country file
                # here uses.
                arr.append(0 if idx is None else round(cur * idx / base))
            if len(arr) != len(months):
                raise SystemExit(f'{s}/{hub}: {len(arr)} points against a {len(months)}-month axis')
            by_city[hub] = arr
            last_city[hub] = arr[anchor_i]
        series[s] = by_city
        latest[s] = last_city

    order = sorted(series, key=lambda s: -sum(latest[s].values()))
    covered = sum(1 for ym in months if ym in jol)

    L = []
    L.append('// GENERATED — do not edit by hand. Run scripts/gen-nz-vacancy-demand.py.')
    L.append('// Source: New Zealand MBIE — Jobs Online, MONTHLY unadjusted series (an INDEX,')
    L.append('// May 2007 = 100), one row per month from 2007-05.')
    L.append('//')
    L.append('// The release\'s eight occupation columns are the ANZSCO major groups — NZ shares')
    L.append('// the classification with Australia, so no crosswalk is needed. They are NATIONAL,')
    L.append('// so each city\'s movement is the national monthly series TILTED by that city\'s')
    L.append('// own occupation trend, from MBIE\'s quarterly vacancies-by-occupation-by-region')
    L.append('// workbook (Dec 2010 = 100). The tilt is a city\'s occupation index over the')
    L.append('// national one for the same quarter, so it is 1 at the base and carries only the')
    L.append('// divergence: Wellington\'s clerical advertising has grown against Auckland\'s')
    L.append('// while its management advertising has fallen, and the national mix showed')
    L.append('// neither. Before Dec 2010 the city\'s TOTAL carries the deviation instead,')
    L.append('// rebased to join continuously at the splice.')
    L.append('//')
    L.append('// LEVELS come from outside both releases, which are indices: Auckland from a')
    L.append('// realistic online-vacancy level, Wellington from Stats NZ filled jobs as a')
    L.append('// share of Auckland\'s. Skills are split by the AU JSA/IVI national mix.')
    L.append('// Aligned to the IVI_MONTHS axis; months before 2007-05 are zero.')
    L.append('')
    L.append(f"export const NZ_MONTH = '{anchor_ym}';")
    L.append("export const NZ_SOURCE =")
    label = ' + '.join(c.capitalize() for c in cities)
    L.append(f"  'New Zealand MBIE — Jobs Online monthly series ({label}, indexed)';")
    L.append('')
    L.append('export const NZ_CITIES: string[] = ' + json.dumps(cities) + ';')
    L.append('')
    L.append('// Skill → city → monthly vacancy history (aligned to IVI_MONTHS).')
    L.append('export const NZ_SERIES: Record<string, Record<string, number[]>> = {')
    for s in order:
        body = ', '.join(f'{c}: [{",".join(map(str, series[s][c]))}]' for c in cities)
        L.append(f'  {json.dumps(s)}: {{ {body} }},')
    L.append('};')
    L.append('')
    L.append('// Skill → latest-month vacancy count per city (current heat map).')
    L.append('export const NZ_SKILL_BY_CITY: Record<string, Record<string, number>> = {')
    for s in order:
        body = ', '.join(f'{c}: {latest[s][c]}' for c in cities)
        L.append(f'  {json.dumps(s)}: {{ {body} }},')
    L.append('};')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))
    print(f'{anchor_ym}: {len(order)} skills, release {first_nz}..{last_nz} (monthly), '
          f'{covered}/{len(months)} axis months covered -> {OUT}')
    for hub in cities:
        print(f'  {hub}: latest total {sum(latest[s][hub] for s in order)}')
    if no_anchor:
        print(f'  no anchor level, left out: {", ".join(sorted(no_anchor))} '
              f'(set it in CITY_ANCHOR from a published regional ad count)')
    if no_weight:
        print(f'  no AU mix weight, left out: {", ".join(sorted(no_weight))} '
              f'(regenerate {IVI.rsplit("/", 1)[1]} to include them)')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('usage: gen-nz-vacancy-demand.py path/to/jol-monthly.csv '
                 'path/to/jol-by-occupation.xlsx')
    main(sys.argv[1], sys.argv[2])
