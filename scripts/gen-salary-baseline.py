#!/usr/bin/env python3
"""Regenerate src/employsi/data/salaryBaseline.ts from ATO Taxation Statistics.

WHY THIS EXISTS
Every salary figure in the app is an ADVERTISED one, taken from the midpoint of
a band a job ad printed, and the archive holding those ads begins 2026-07-20.
Thirty-six days cannot answer "is this skill worth more than it used to be", and
will not be able to for another year. The one source in the archive with real
history — the closed Wayback corpus, back to 2003 — carries no salary at all.

So the historical side has to come from outside, and it comes from the ATO:
Taxation Statistics, Individuals Table 15, which publishes MEDIAN SALARY OR WAGE
INCOME by ANZSCO4 unit group, annually, under CC BY.

WHY THE ATO AND NOT THE ABS, WHICH IS THE OBVIOUS CHOICE
ABS Employee Earnings and Hours splits the two things needed across two
granularities and neither cell is usable on its own. Measured on the May 2025
release: data cube 63060DO003 Table 10 publishes the median, but only for the
EIGHT ANZSCO major groups — every skill in a category would receive an identical
number. Cube 63060DO011 Table 1 is at ANZSCO4, the granularity we want, but
publishes only a MEAN. EEH is biennial besides. The ATO is annual, at unit
group, and states a median.

WHAT A ROW MEANS, AND WHAT IT DOES NOT
This is annual income ACTUALLY RECEIVED by people who lodged a return, not a
full-time-equivalent rate. Someone who worked half the year, or three days a
week, is in it at what they earned. So a figure here answers "what did people in
this occupation earn that year" and NOT "what does this job pay". It is much
closer to the latter than median taxable income would be — that column exists in
the same table and is deliberately not the one read, because it carries
investment income, capital gains and every other source — but the gap is real
and the card has to say so.

That is also why nothing in this file may be differenced against the app's live
advertised median. The two differ on instrument (received against advertised),
unit (a person against an advertisement), disclosure (everyone who lodged
against the third of ads that state a number), and geography. A percentage is
honest WITHIN this series, where every year is measured the same way, and
nowhere else.

FIGURES ARE NOMINAL. No CPI deflation is applied and none should be inferred:
each year is published in its own dollars and labelled with its financial year.

HOW A SKILL GETS A NUMBER
The same crosswalk the IVI demand and ABS supply generators use — OVERRIDE from
gen-ivi-skill-demand.py, falling back to the shared taxonomy matcher against the
occupation title. Sharing it is the whole point: a baseline attributed
differently from the live figure would make even a like-for-like comparison
measure the mapping instead of the market. An occupation mapping to two skills
counts in BOTH, exactly as its vacancies and its employment do.

THE ONE STATISTICAL COMPROMISE, STATED PLAINLY
A skill is several unit groups, and MEDIANS DO NOT COMPOSE — there is no way to
recover the true median of the combined population from the medians of its
parts. What is computed here is a weighted median OF THE UNIT-GROUP MEDIANS,
each weighted by the individuals behind it, which is the closest honest thing
available from published aggregates. It is not the population median and is not
claimed to be. Weighting matters: unweighted, "Window dresser" (218 people)
would count for as much as "Kitchen hand" (121,185).

WHAT IS DELIBERATELY DROPPED
  * 0000 "Occupation blank", 9990 "Occupation not matched" and 9997
    "Miscellaneous type not specified" — the ATO's equivalent of the ABS 'nfd'
    rows. They are 3.4M real people who belong to no occupation, so they cannot
    be attributed without guessing. Their size is REPORTED at the end of a run
    rather than quietly absorbed.
  * The ATO's own 9xxx apprentice/trainee/consultant codes, which cut across
    occupations and have no ANZSCO counterpart. They are simply unmapped, and
    counted in the same report.
  * Codes whose title the crosswalk does not match. See
    check-occupation-overrides.py for the 21 that failed only because the ATO
    spells a code differently from the ABS; the rest are genuine taxonomy gaps
    (Legislators, the defence-force ranks, the "Other miscellaneous" catch-alls).

TWO TABLES, BECAUSE THE ATO ONLY PUBLISHES THE SECOND ONE ONCE
  * Table 15B — unit group x sex, national. Identical shape every year from
    2016-17 to 2023-24, which is what makes the series possible. Only the
    'Total' rows are read; summing the sexes would double-count.
  * Table 15D — unit group x STATE. This exists in 2023-24 AND NOWHERE ELSE.
    2015-16 published a state cut too, in a third layout with different column
    names; it is skipped rather than special-cased for one extra year.

So the national series is eight years deep and the per-hub figures are one year
deep. That asymmetry is in the data, not a bug here, and the generated file
carries nulls for the years a hub has nothing rather than carrying the national
figure as if it were local.

COLUMNS ARE FOUND BY HEADER TEXT, NOT BY POSITION. The ATO renumbers its
footnote markers most years ("Median salary or wage income4 $" became
"Median salary or wage income5 $"), inserts a column, and renames "Number of
individuals" to "Individuals no.". Reading by position would silently pick up
the wrong column and publish a plausible wrong number — which is the failure
this whole file is built to avoid.

Run:  python3 scripts/gen-salary-baseline.py            # downloads + caches
      python3 scripts/gen-salary-baseline.py --offline  # cache only, no network
Then: npx eslint src/employsi/data/salaryBaseline.ts --fix
Needs: pip install openpyxl
"""
from __future__ import annotations
import importlib.util
import json
from functools import partial
import os
import re
import sys
import urllib.request

import openpyxl

# ensure_ascii=False: this writes a file people read, and an escaped em dash
# ("ATO Taxation Statistics \\u2014 Individuals Table 15") is not readable.
jdump = partial(json.dumps, ensure_ascii=False)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from skills_taxonomy import matcher  # noqa: E402

TAX = os.path.join(ROOT, 'src/employsi/data/skillsTaxonomy.ts')
OUT = os.path.join(ROOT, 'src/employsi/data/salaryBaseline.ts')
CACHE = os.path.join(ROOT, '.cache', 'ato')

CKAN = 'https://data.gov.au/data/api/3/action/package_show?id=taxation-statistics-{}'
SOURCE = 'ATO Taxation Statistics — Individuals Table 15'
SOURCE_URL = 'https://data.gov.au/data/dataset/taxation-statistics-2023-24'
LICENCE = 'CC BY 2.5 AU'

# The vintages whose Table 15B carries the same unit-group x sex shape. 2015-16
# is excluded deliberately — see the module docstring.
YEARS = ['2016-17', '2017-18', '2018-19', '2019-20', '2020-21', '2021-22', '2022-23', '2023-24']
# The only year with a state breakdown (Table 15D).
STATE_YEAR = '2023-24'

# Same mapping gen-abs-occupation-supply.py uses, so a state's workers land on
# the same hub in the baseline as in the supply series.
STATE2CITY = {
    'NSW': 'sydney', 'VIC': 'melbourne', 'QLD': 'brisbane', 'SA': 'adelaide',
    'WA': 'perth', 'NT': 'darwin', 'ACT': 'canberra', 'TAS': 'hobart',
}
NATIONAL = 'au'
AREAS = [NATIONAL] + ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney',
                      'darwin', 'canberra', 'hobart']

# Codes that name no occupation. Attributing them would mean guessing; their
# size is reported instead.
UNATTRIBUTABLE = {'0000', '9990', '9997'}

# A unit-group cell below this is noise rather than signal — the ATO already
# suppresses cells too small to publish safely, so this is not a privacy floor,
# it is a "one tiny occupation should not define a skill" floor. 9997 arrived
# with three individuals in it.
MIN_CELL = 100
# And a published figure must rest on this many people in total across the unit
# groups behind it. Same intent as salaryParse.MIN_ADS: below the floor the row
# shows nothing rather than something badly estimated.
MIN_TOTAL = 1000


def load_override() -> dict:
    """OVERRIDE from the IVI generator, by path — the filename has hyphens, so
    it cannot be imported by name. Identical loader to
    gen-abs-occupation-supply.py, and identical reason: the three datasets have
    to attribute an occupation the same way or they cannot be read together."""
    path = os.path.join(HERE, 'gen-ivi-skill-demand.py')
    spec = importlib.util.spec_from_file_location('gen_ivi', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.OVERRIDE


def fetch(year: str, offline: bool) -> str:
    """The Table 15 workbook for one financial year, cached on disk.

    Resolved through the CKAN API rather than by guessing the URL: the filename
    changes every year ('taxstats2016individual15…', 'ts17individual15…',
    'ts24individual15occupationsex.xlsx') and the resource NAME is the useless
    'Individuals - Table 15' in every edition, so the URL is the only thing
    carrying the table's identity.
    """
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f'ato15-{year}.xlsx')
    if os.path.exists(path):
        return path
    if offline:
        raise SystemExit(f'✗ {year} not in {CACHE} and --offline was passed.')
    with urllib.request.urlopen(CKAN.format(year), timeout=90) as r:
        pkg = json.load(r)
    for res in pkg['result']['resources']:
        url = res.get('url') or ''
        if re.search(r'individual15occupation(sex|gender)', url, re.I) and url.lower().endswith('.xlsx'):
            urllib.request.urlretrieve(url, path)
            return path
    raise SystemExit(f'✗ No Table 15 occupation workbook found for {year}.')


def header_row(ws, want: str) -> tuple[int, list[str]]:
    """The first row that looks like a header, and its cells as text.

    'Looks like' is four or more non-empty cells one of which mentions `want`;
    the ATO puts a title and a release line above the header and the number of
    those lines is not stable across editions.
    """
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=12, max_col=14, values_only=True), 1):
        cells = ['' if c is None else str(c).replace('\n', ' ').strip() for c in row]
        if sum(1 for c in cells if c) >= 4 and any(want in c.lower() for c in cells):
            return i, cells
    raise SystemExit(f'✗ No header row containing {want!r} in sheet {ws.title!r}.')


def col(cells: list[str], pattern: str) -> int:
    """Index of the first column whose header matches `pattern`.

    By text, never by position — see the note on footnote markers above.
    """
    rx = re.compile(pattern, re.I)
    for i, c in enumerate(cells):
        if rx.search(c):
            return i
    raise SystemExit(f'✗ No column matching /{pattern}/ in header: {cells}')


UNIT_RE = re.compile(r'^(\d{4})\s+(.*?)\s*$')


def read_sheet(path: str, suffix: str, area_col: str | None):
    """(code, title, area, individuals, median wage) from one Table 15 sheet.

    `area_col` names the column carrying the geography, or None for the national
    table — where the sex column is used instead and only 'Total' is kept.
    """
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    names = [s for s in wb.sheetnames if s.replace(' ', '').endswith(suffix)]
    if not names:
        wb.close()
        return None
    ws = wb[names[0]]
    hrow, cells = header_row(ws, 'unit group')
    c_unit = col(cells, r'unit group')
    c_n = col(cells, r'individuals')
    c_med = col(cells, r'median salary or wage')
    c_area = col(cells, area_col) if area_col else col(cells, r'^sex')

    out = []
    for row in ws.iter_rows(min_row=hrow + 1, values_only=True):
        unit = row[c_unit] if c_unit < len(row) else None
        if not isinstance(unit, str):
            continue
        m = UNIT_RE.match(unit.strip())
        if not m:
            continue
        area = row[c_area] if c_area < len(row) else None
        n = row[c_n] if c_n < len(row) else None
        med = row[c_med] if c_med < len(row) else None
        if not isinstance(n, (int, float)) or not isinstance(med, (int, float)):
            continue  # the ATO leaves suppressed cells empty
        out.append((m.group(1), m.group(2), str(area or '').strip(), float(n), float(med)))
    wb.close()
    return out


def weighted_median(pairs: list[tuple[float, float]]) -> int | None:
    """Weighted median of (median, weight) pairs — see the docstring's note on
    medians not composing. Ties resolve to the lower value, which is the
    conventional choice and keeps the result a figure that was actually
    published rather than an interpolation between two."""
    if not pairs:
        return None
    total = sum(w for _, w in pairs)
    if total <= 0:
        return None
    half = total / 2.0
    acc = 0.0
    for med, w in sorted(pairs):
        acc += w
        if acc >= half:
            return int(round(med))
    return int(round(sorted(pairs)[-1][0]))


def main(argv: list[str]) -> int:
    offline = '--offline' in argv
    skills_for = matcher(TAX)
    override = load_override()

    # cells[skill][area][year] = [(median, individuals), ...]
    cells: dict[str, dict[str, dict[str, list[tuple[float, float]]]]] = {}
    dropped_people = 0.0
    unmapped: dict[str, float] = {}
    seen_codes: set[str] = set()

    def absorb(rows, year: str, area_of):
        nonlocal dropped_people
        # Coverage is reported for ONE year's national table, not summed over
        # all of them. Adding eight years and a state split together counts the
        # same person nine times and produces a headline bigger than the
        # workforce — a number that looks alarming and means nothing.
        counting = year == YEARS[-1]
        for code, title, area_raw, n, med in rows:
            area = area_of(area_raw)
            if area is None:
                continue
            seen_codes.add(code)
            tally = counting and area == NATIONAL
            if code in UNATTRIBUTABLE:
                if tally:
                    dropped_people += n
                continue
            sk = override.get(code) or skills_for(title)
            if not sk:
                if tally:
                    unmapped[f'{code} {title}'] = unmapped.get(f'{code} {title}', 0.0) + n
                continue
            if n < MIN_CELL:
                continue
            for s in sk:
                cells.setdefault(s, {}).setdefault(area, {}).setdefault(year, []).append((med, n))

    for year in YEARS:
        path = fetch(year, offline)
        national = read_sheet(path, '15B', None)
        if national is None:
            raise SystemExit(f'✗ {year} has no Table 15B (unit group x sex).')
        absorb(national, year, lambda a: NATIONAL if a.lower() == 'total' else None)
        print(f'  {year}  15B rows={len(national):>5}')

        if year == STATE_YEAR:
            states = read_sheet(path, '15D', r'^state')
            if states is None:
                raise SystemExit(f'✗ {year} was expected to carry Table 15D and does not.')
            absorb(states, year, lambda a: STATE2CITY.get(a))
            print(f'  {year}  15D rows={len(states):>5}  (the only year with a state split)')

    # Fold to one figure per skill/area/year, then to arrays aligned to YEARS.
    out: dict[str, dict[str, list]] = {}
    published = 0
    for skill in sorted(cells):
        for area in cells[skill]:
            series = []
            any_year = False
            for year in YEARS:
                pairs = cells[skill][area].get(year) or []
                total = sum(w for _, w in pairs)
                med = weighted_median(pairs) if total >= MIN_TOTAL else None
                if med is None:
                    series.append(None)
                else:
                    series.append([med, int(round(total))])
                    any_year = True
                    published += 1
            if any_year:
                out.setdefault(skill, {})[area] = series

    # ── report ──────────────────────────────────────────────────────────────
    hub_skills = {s for s, areas in out.items() if len(areas) > 1}
    print()
    print(f'skills with a national series : {len(out)}')
    print(f'skills with per-hub figures   : {len(hub_skills)}  ({STATE_YEAR} only)')
    print(f'figures published             : {published}')
    print(f'unit groups seen              : {len(seen_codes)}')
    print(f'\ncoverage of the {YEARS[-1]} national table:')
    print(f'  people in unattributable codes: {dropped_people:,.0f}  (0000/9990/9997 — reported, never absorbed)')
    if unmapped:
        top = sorted(unmapped.items(), key=lambda kv: -kv[1])
        print(f'  unit groups the crosswalk misses: {len(unmapped)}  '
              f'({sum(unmapped.values()):,.0f} people)')
        for name, n in top[:10]:
            print(f'    {n:>10,.0f}  {name}')
        if len(top) > 10:
            print(f'    ... and {len(top) - 10} more '
                  f'({sum(n for _, n in top[10:]):,.0f} people)')

    # ── write ───────────────────────────────────────────────────────────────
    def fmt(series) -> str:
        return '[' + ','.join('null' if v is None else f'[{v[0]},{v[1]}]' for v in series) + ']'

    body = []
    for skill in sorted(out):
        areas = out[skill]
        inner = ',\n'.join(
            f'    {jdump(a)}: {fmt(areas[a])}'
            for a in AREAS if a in areas
        )
        body.append(f'  {jdump(skill)}: {{\n{inner},\n  }}')
    joined = ',\n'.join(body)

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(f'''// GENERATED — do not edit by hand.
// Run: python3 scripts/gen-salary-baseline.py
//
// Historical median pay per skill, for the years the live archive cannot reach:
// it begins 2026-07-20, so it cannot say whether a skill is worth more than it
// used to be. Source: {SOURCE} ({LICENCE}), which publishes median salary or
// wage income by ANZSCO4 unit group, annually.
//
// READ THE UNIT BEFORE USING A NUMBER FROM HERE. This is annual income actually
// RECEIVED by people who lodged a return — part-year and part-time earners are
// in it at what they earned — not a full-time-equivalent rate and not an
// advertised salary. It answers "what did people in this occupation earn that
// year", not "what does this job pay".
//
// NEVER DIFFERENCE IT AGAINST THE APP'S LIVE ADVERTISED MEDIAN. The two differ
// on instrument, unit, disclosure and geography all at once, so the gap between
// them is mostly the gap between two measuring devices. A percentage is honest
// WITHIN this series — every year here is measured the same way — and nowhere
// else.
//
// Figures are NOMINAL, each in its own year's dollars. No CPI deflation.
//
// A skill spans several occupations, and medians do not compose: each figure is
// a weighted median of the unit-group medians behind it, weighted by people. It
// approximates the population median and is not it.
export const BASELINE_SOURCE = {jdump(SOURCE)};
export const BASELINE_SOURCE_URL = {jdump(SOURCE_URL)};
export const BASELINE_LICENCE = {jdump(LICENCE)};
export const BASELINE_BASIS = "median salary or wage income, annual, nominal AUD";

// Financial years, oldest first. Every series below is aligned to this.
export const BASELINE_YEARS: string[] = {jdump(YEARS)};

// "au" is national. The ATO published a state breakdown in {STATE_YEAR} and in no
// other year of this range, so hub series carry a figure for that year alone and
// null everywhere else — deliberately, rather than repeating the national number
// as though it were local.
export const BASELINE_AREAS: string[] = {jdump(AREAS)};

// skill -> area -> [median AUD, individuals behind it] per year, or null where
// the ATO published nothing or the sample fell below the floor ({MIN_TOTAL:,} people).
export const SALARY_BASELINE: Record<string, Record<string, ([number, number] | null)[]>> = {{
{joined},
}};
''')

    print(f'\nWrote {len(out)} skills to {os.path.relpath(OUT, ROOT)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
