#!/usr/bin/env python3
"""Hong Kong vacancies -> src/employsi/data/hkVacancyDemand.ts

Source: Census and Statistics Department table 215-16001, "Number of
establishments, persons engaged, vacancies and vacancy rate (other than those in
the civil service) analysed by industry section" — the Quarterly Survey of
Employment and Vacancies plus the Quarterly Employment Survey of Construction
Sites. Quarterly, from 2000; this takes 2006 onwards so it lands on the same
243-month axis as every other country series.

── THE HONEST PART: NOTHING IS ALLOCATED ──────────────────────────────────────
Hong Kong publishes vacancies BY INDUSTRY SECTION. Every other country feed in
this app is by occupation, which is what maps to a skill. Bridging that gap by
SPLITTING an industry's vacancies across the skills it employs would need
per-skill weights, and Hong Kong does not publish them:

  • our own archive holds 697 Hong Kong ads across 38 employers — roughly 35 a
    section, which is noise, not an occupation mix;
  • borrowing Australia's occupation mix would assert that Hong Kong hires like
    Perth, which is the same class of error as the flat 2.5% vacancy rate the
    Eurostat file was built to replace (see data/euVacancyDemand.ts).

So a skill INHERITS ITS SECTION'S PUBLISHED FIGURE, unsplit. Searching Nursing
lights Hong Kong with the real vacancy count for "Q: Human health and social
work services", and the app labels it as a section-level figure. Several skills
in one section therefore show the same number. That is not a bug — it is
precisely what Hong Kong measures, and it is the difference between a number
that can be traced to a published table and one this script made up.

── AVOIDING DOUBLE COUNTING ───────────────────────────────────────────────────
The table interleaves parents and children: "B, D & E" alongside "B" and
"D & E"; "G" alongside "G45-46" and "G47"; "M & N" alongside "M" and "N";
"P - S" alongside "P", "Q", "R", "S"; plus an "All industry sections covered"
total. Only the finest non-overlapping level is used (SECTIONS below), so the
parts never get counted with their whole.

Usage: python3 scripts/gen-hk-vacancy-demand.py <Table_21516001_en.csv>
"""
from __future__ import annotations
import csv
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'src/employsi/data/hkVacancyDemand.ts')

START_YEAR = 2006
QUARTER_END = {'Mar': 3, 'Jun': 6, 'Sep': 9, 'Dec': 12}

# The finest non-overlapping cut of the table, each mapped to the skill
# CATEGORIES it covers (see SKILL_CATEGORY in data/skillsTaxonomy.ts). Categories
# rather than individual skills so this stays readable and so a skill added to
# the taxonomy inherits its section automatically.
#
# A section with no plausible category is still parsed and still contributes to
# the country total; it simply lights no skill.
SECTIONS: dict[str, list[str]] = {
    'C: Manufacturing': ['Manufacturing', 'Trades', 'Engineering', 'Science'],
    'B: Mining and quarrying': ['Mining'],
    'D & E: Electricity and gas supply, and waste management': ['Energy', 'Engineering', 'Safety'],
    'F: Construction sites (manual workers only)': ['Construction', 'Built Environment'],
    'G45-46: Import/export trade and wholesale': ['Transport'],
    'G47: Retail': ['Sales', 'Sector'],
    'H: Transportation, storage, postal and courier services': ['Transport'],
    'I: Accommodation and food services': ['Hospitality'],
    'J: Information and communications': ['Digital', 'Creative'],
    'K: Financing and insurance': ['Financial'],
    'L: Real estate': ['Property'],
    'M: Professional, scientific and technical services': ['Corporate', 'Science'],
    'N: Administrative and support services': ['Admin', 'Cleaning'],
    'P: Education': ['Education'],
    'Q: Human health and social work services': ['Health', 'Care', 'Community'],
    'R: Arts, entertainment and recreation': ['Personal'],
    'S: Other services': ['Personal'],
}
TOTAL_ROW = 'All industry sections covered'


def load_taxonomy() -> dict[str, str]:
    """skill -> category, straight from the app's own taxonomy."""
    p = subprocess.run(['npx', 'tsx', '-e', (
        'import { ALL_SKILLS, SKILL_CATEGORY } from "./src/employsi/data/skillsTaxonomy";'
        'console.log(JSON.stringify(Object.fromEntries('
        'ALL_SKILLS.map((s) => [s, (SKILL_CATEGORY as any)[s] ?? ""]))));'
    )], capture_output=True, timeout=300, cwd=ROOT)
    if p.returncode != 0:
        sys.exit('taxonomy read failed:\n' + p.stderr.decode()[-600:])
    return json.loads(p.stdout.decode().strip().splitlines()[-1])


def num(s: str) -> float | None:
    """The table writes thousands with a space, and suppresses cells as [*n]."""
    t = (s or '').strip().replace(' ', '').replace(' ', '').replace(',', '')
    if not t or t.upper() in ('N.A.', 'NA', '-') or t.startswith('['):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def months_axis() -> list[str]:
    p = subprocess.run(['npx', 'tsx', '-e',
                        'import { IVI_MONTHS } from "./src/employsi/data/iviSkillDemand";'
                        'console.log(JSON.stringify(IVI_MONTHS));'],
                       capture_output=True, timeout=300, cwd=ROOT)
    if p.returncode != 0:
        sys.exit('IVI_MONTHS read failed:\n' + p.stderr.decode()[-600:])
    return json.loads(p.stdout.decode().strip().splitlines()[-1])


def carry(arr: list[float], vals: dict[int, float]) -> list[float]:
    """Place the readings, then CARRY THE LAST ONE FORWARD to the axis end.

    The shared axis runs a month or two past Hong Kong's newest quarter, and a
    trailing zero there would not read as "not published yet" — it would read as
    "no vacancies", which is a different and false claim. The heat map and the
    analyst both treat zero as a real zero, so the last published quarter is
    held instead, exactly as data/euVacancyDemand.ts carries its annual
    employment forward. Months BEFORE the first reading stay zero, because the
    series genuinely does not start there.
    """
    if not vals:
        return arr
    for i, v in vals.items():
        arr[i] = v
    last = max(vals)
    for i in range(last + 1, len(arr)):
        arr[i] = arr[last]
    return arr


def main() -> int:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    rows = list(csv.reader(open(src, encoding='utf-8-sig')))

    months = months_axis()
    idx = {m: i for i, m in enumerate(months)}
    skill_cat = load_taxonomy()

    # section -> month index -> vacancies
    by_section: dict[str, dict[int, float]] = {}
    total: dict[int, float] = {}
    rate: dict[int, float] = {}
    seen_q: set[tuple[int, int]] = set()

    for r in rows:
        if len(r) < 10 or not r[0].strip().isdigit():
            continue
        year = int(r[0])
        mon = r[1].strip()
        name = r[2].strip()
        if year < START_YEAR or mon not in QUARTER_END:
            continue
        vac = num(r[7])
        if vac is None:
            continue
        end = QUARTER_END[mon]
        seen_q.add((year, end))
        # A quarterly survey dated at its END month covers the three months up
        # to and including it, so the value is HELD across those three rather
        # than interpolated — the same step the Eurostat rate takes.
        targets = [idx[f'{year:04d}-{m:02d}'] for m in range(end - 2, end + 1)
                   if f'{year:04d}-{m:02d}' in idx]
        if not targets:
            continue
        if name == TOTAL_ROW:
            vr = num(r[9])
            for t in targets:
                total[t] = vac
                if vr is not None:
                    rate[t] = vr
            continue
        if name not in SECTIONS:
            continue  # a parent aggregate or a cut we do not use
        d = by_section.setdefault(name, {})
        for t in targets:
            d[t] = vac

    if not by_section:
        sys.exit('no section rows parsed — has the table layout changed?')

    # Category -> skills, so a section's categories expand to real skill names.
    by_cat: dict[str, list[str]] = {}
    for s, c in skill_cat.items():
        if c:
            by_cat.setdefault(c, []).append(s)

    series: dict[str, list[float]] = {}
    skill_section: dict[str, str] = {}
    for section, cats in SECTIONS.items():
        d = by_section.get(section)
        if not d:
            sys.stderr.write(f'  no rows for {section!r}\n')
            continue
        arr = carry([0.0] * len(months), d)
        for cat in cats:
            for skill in by_cat.get(cat, []):
                # A skill in two sections takes the LARGER, and records which
                # one it came from — the app shows that label, so it must be the
                # section the figure is actually from.
                prev = series.get(skill)
                if prev is None or sum(arr) > sum(prev):
                    series[skill] = arr
                    skill_section[skill] = section

    tot_arr = carry([0.0] * len(months), total)
    rate_arr = carry([0.0] * len(months), rate)

    qs = sorted(seen_q)
    header = f"""// GENERATED — do not edit by hand. Run scripts/gen-hk-vacancy-demand.py.
//
// Hong Kong vacancies, from Census and Statistics Department table 215-16001
// (Quarterly Survey of Employment and Vacancies + Quarterly Employment Survey
// of Construction Sites), {qs[0][0]}Q{qs[0][1] // 3} to {qs[-1][0]}Q{qs[-1][1] // 3}.
// Civil service excluded — the source excludes it.
//
// NOTHING HERE IS ALLOCATED. Hong Kong publishes vacancies BY INDUSTRY SECTION,
// not by occupation, so a skill inherits its SECTION'S published figure whole.
// Splitting a section across the skills it employs would need per-skill weights
// Hong Kong does not publish, and neither our 697 local ads nor Australia's
// occupation mix can stand in for them — that is the flat-2.5% mistake
// data/euVacancyDemand.ts exists to document.
//
// So several skills share one number, because one number is what is measured.
// HK_SKILL_SECTION names the section behind each skill; the UI shows it, so a
// reader is never left thinking this is a per-skill count.
//
// Quarterly values are HELD across the three months ending at the survey month
// rather than interpolated.
"""

    lines = [header, "import { IVI_MONTHS } from './iviSkillDemand';", '',
             "/**",
             " * The source string every surface shows for a Hong Kong figure.",
             " *",
             " * The caveat is part of the SOURCE, not a note somewhere else, because",
             " * the source line is the one thing that travels with the number — onto a",
             " * card, into an analyst answer, onto an exported chart. A Hong Kong",
             " * figure is its industry section's total, and a reader who does not know",
             " * that will read it as a count of that one skill.",
             " */",
             "export const HK_SOURCE =",
             "  'Census and Statistics Department (Hong Kong) — Quarterly Survey of Employment and Vacancies (table 215-16001) · published by INDUSTRY SECTION, so a skill shows its whole section\\'s vacancies, not its own';",
             '',
             '/** Vacancies across all covered industry sections. */',
             'export const HK_TOTAL_VACANCIES: number[] = ' + json.dumps([round(v) for v in tot_arr]) + ';',
             '',
             "/** The published vacancy rate (%), all sections. */",
             'export const HK_VACANCY_RATE: number[] = ' + json.dumps([round(v, 2) for v in rate_arr]) + ';',
             '',
             '/** Which industry section each skill inherits its figure from. */',
             'export const HK_SKILL_SECTION: Record<string, string> = {']
    for s in sorted(skill_section):
        lines.append(f'  {json.dumps(s)}: {json.dumps(skill_section[s])},')
    lines += ['};', '',
              '/** Skill → { hongkong: monthly vacancies }, on the IVI_MONTHS axis. */',
              'export const HK_SERIES: Record<string, Record<string, number[]>> = {']
    for s in sorted(series):
        lines.append('  ' + json.dumps(s) + ': { hongkong: [' +
                     ','.join(str(round(v)) for v in series[s]) + '] },')
    lines += ['};', '',
              '/** Latest-month value per skill, for the map. */',
              'export const HK_SKILL_BY_CITY: Record<string, Record<string, number>> = {']
    last = len(months) - 1
    for s in sorted(series):
        lines.append(f'  {json.dumps(s)}: {{ hongkong: {round(series[s][last])} }},')
    lines += ['};', '',
              'void IVI_MONTHS;', '']

    open(OUT, 'w').write('\n'.join(lines))
    sys.stderr.write(
        f'wrote {OUT}\n  {len(series)} skills across {len(by_section)} sections, '
        f'{len(qs)} quarters ({qs[0][0]}Q{qs[0][1]//3} .. {qs[-1][0]}Q{qs[-1][1]//3})\n'
        f'  latest total vacancies: {round(tot_arr[last]):,} at rate {rate_arr[last]}%\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
