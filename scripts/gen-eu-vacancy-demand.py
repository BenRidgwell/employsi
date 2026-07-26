#!/usr/bin/env python3
"""Regenerate src/employsi/data/euVacancyDemand.ts from the Eurostat "Job vacancy
statistics by occupation and NUTS 1 region (OJA breakdowns) — annual, experimental"
release (jvs_a_isco3_r1), broken down by occupation (ISCO-08 3-digit) × geo × year.

Like the UK ONS wiring, each occupation label is term-matched to canonical skills
via the shared skillsTaxonomy terms and summed per skill. Unlike the UK (one city)
the user wants this recorded BY COUNTRY, so we keep the COUNTRY-level GEO rows
(dropping the EU/euro-area aggregates and the NUTS-1 sub-regions) and place each
country on its capital.

Scaling to the UK counts: the source figures are EMPLOYMENT by occupation (in
thousands — EU-27 Total ≈ 165M employees, Germany ≈ 37M), i.e. a stock, whereas
the UK ONS series (and the app's other feeds) are vacancy COUNTS. To put the EU on
the same footing we convert employment → active vacancies with the EU job-vacancy
rate (~2.5% of employees in recent years): count = employees(thousands) × 1000 ×
VACANCY_RATE. That lands e.g. Germany software ≈ 53k and EU-wide ≈ 4M active
vacancies — the right order of magnitude next to the UK's London counts.

The release is annual (2019..latest). Rather than emit a full 243-month array per
country per skill (huge + redundant), we emit the compact per-year values and let
the TS expand them onto the shared IVI_MONTHS axis at load time (each year held
flat across its months; the latest year carried forward to "now"; pre-first-year
months zero). This keeps the data file small while conforming to the seriesFor
contract every other country series uses.

Usage: python3 scripts/gen-eu-vacancy-demand.py path/to/jvs_a_isco3_r1.xlsx
"""
import json, re, sys, warnings
warnings.filterwarnings('ignore')
import openpyxl

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from skills_taxonomy import load_skills, matcher  # noqa: E402

ROOT = __file__.rsplit('/scripts/', 1)[0]
TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'
OUT = f'{ROOT}/src/employsi/data/euVacancyDemand.ts'
SHEET = 'Data'

# EU country → canonical map id + display label + capital [lng, lat]. Only these
# GEO rows are kept (aggregates like "European Union - 27 countries" / "Euro area"
# and the NUTS-1 sub-regions / "Not regionalised" are dropped). Denmark carries no
# rows in this extract, so it's absent. Keyed by the exact Eurostat GEO label.
COUNTRIES = {
    'Belgium':     ('belgium',     'Belgium',        [4.35, 50.85]),
    'Bulgaria':    ('bulgaria',    'Bulgaria',       [23.32, 42.70]),
    'Czechia':     ('czechia',     'Czechia',        [14.42, 50.08]),
    'Germany':     ('germany',     'Germany',        [13.40, 52.52]),
    'Estonia':     ('estonia',     'Estonia',        [24.75, 59.44]),
    'Ireland':     ('ireland',     'Ireland',        [-6.26, 53.35]),
    'Greece':      ('greece',      'Greece',         [23.73, 37.98]),
    'Spain':       ('spain',       'Spain',          [-3.70, 40.42]),
    'France':      ('france',      'France',         [2.35, 48.86]),
    'Croatia':     ('croatia',     'Croatia',        [15.98, 45.81]),
    'Italy':       ('italy',       'Italy',          [12.50, 41.90]),
    'Cyprus':      ('cyprus',      'Cyprus',         [33.36, 35.17]),
    'Latvia':      ('latvia',      'Latvia',         [24.11, 56.95]),
    'Lithuania':   ('lithuania',   'Lithuania',      [25.28, 54.69]),
    'Luxembourg':  ('luxembourg',  'Luxembourg',     [6.13, 49.61]),
    'Hungary':     ('hungary',     'Hungary',        [19.04, 47.50]),
    'Malta':       ('malta',       'Malta',          [14.51, 35.90]),
    'Netherlands': ('netherlands', 'Netherlands',    [4.90, 52.37]),
    'Austria':     ('austria',     'Austria',        [16.37, 48.21]),
    'Poland':      ('poland',      'Poland',         [21.01, 52.23]),
    'Portugal':    ('portugal',    'Portugal',       [-9.14, 38.72]),
    'Romania':     ('romania',     'Romania',        [26.10, 44.43]),
    'Slovenia':    ('slovenia',    'Slovenia',       [14.51, 46.06]),
    'Slovakia':    ('slovakia',    'Slovakia',       [17.11, 48.15]),
    'Finland':     ('finland',     'Finland',        [24.94, 60.17]),
    'Sweden':      ('sweden',      'Sweden',         [18.07, 59.33]),
}

# Occupation rows to ignore: the "Total" line and the ICT custom aggregate (it
# double-counts occupations already itemised).
SKIP_OCC = {'total'}

# EU job-vacancy rate (share of employment that is an active vacancy), used to
# convert the source's employment stock into vacancy counts consistent with the
# UK's real vacancy figures. ~2.5% is the EU average across the 2019-2024 window.
VACANCY_RATE = 0.025


def main(path):
    skills_for = matcher(TAX)

    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[SHEET]
    nrow, ncol = ws.max_row, ws.max_column

    # Locate the TIME row (col A == 'TIME'), the GEO labels row, and the first
    # occupation row (the one after the 'ISCO08 (Labels)' header).
    time_row = geo_row = isco_row = None
    for i in range(1, nrow + 1):
        a = str(ws.cell(i, 1).value or '').strip()
        if a == 'TIME':
            time_row = i
        elif a.startswith('GEO'):
            geo_row = i
        elif a.startswith('ISCO'):
            isco_row = i
            break
    if not (time_row and geo_row and isco_row):
        sys.exit(f'Could not find TIME/GEO/ISCO header rows ({time_row},{geo_row},{isco_row}).')

    # TIME markers: {col: year}. Each year block spans until the next marker.
    marks = [(j, int(ws.cell(time_row, j).value)) for j in range(2, ncol + 1)
             if str(ws.cell(time_row, j).value or '').strip().isdigit()]
    years = [y for _, y in marks]
    blocks = []  # (year, start_col, end_col)
    for k, (col, yr) in enumerate(marks):
        end = marks[k + 1][0] - 1 if k + 1 < len(marks) else ncol
        blocks.append((yr, col, end))

    # Within any block the GEO columns repeat in the same order; grab the country
    # value-columns (label matches a COUNTRIES key) relative to the block start.
    first_start = blocks[0][1]
    country_cols = []  # (rel_offset, country_key)
    for j in range(first_start, blocks[0][2] + 1):
        lbl = str(ws.cell(geo_row, j).value or '').strip()
        if lbl in COUNTRIES:
            country_cols.append((j - first_start, lbl))

    # acc[skill][country_key][year] = summed count
    acc = {}
    for i in range(isco_row + 1, nrow + 1):
        occ = str(ws.cell(i, 1).value or '').strip()
        if not occ or occ.lower() in SKIP_OCC:
            continue
        if occ.lower().startswith('information and communications technology specialists'):
            continue  # custom ICT aggregate — would double-count
        sk = skills_for(occ)
        if not sk:
            continue
        for yr, start, _end in blocks:
            for off, ckey in country_cols:
                cell = ws.cell(i, start + off).value
                try:
                    v = float(cell)
                except (TypeError, ValueError):
                    continue  # ':' confidential / missing
                # thousands of employees → active vacancies (see VACANCY_RATE).
                cnt = round(v * 1000 * VACANCY_RATE)
                if cnt <= 0:
                    continue
                for s in sk:
                    acc.setdefault(s, {}).setdefault(ckey, {}).setdefault(yr, 0)
                    acc[s][ckey][yr] += cnt

    latest_year = max(years)
    # order skills by total demand across all countries in the latest year
    def skill_total(s):
        return sum(cy.get(latest_year, 0) for cy in acc[s].values())
    order = sorted(acc, key=lambda s: -skill_total(s))

    id_of = {k: COUNTRIES[k][0] for k in COUNTRIES}

    L = []
    L.append('// GENERATED — do not edit by hand. Run scripts/gen-eu-vacancy-demand.py.')
    L.append('// Source: Eurostat — Job vacancy statistics by occupation and NUTS 1 region')
    L.append('// (OJA breakdowns), annual experimental statistics [jvs_a_isco3_r1]. Each ISCO-08')
    L.append('// occupation is term-matched to canonical skills (shared skillsTaxonomy terms)')
    L.append('// and summed per skill, BY COUNTRY (aggregates + NUTS-1 sub-regions dropped).')
    L.append('// The source figures are EMPLOYMENT (thousands); to match the UK/other feeds\'')
    L.append(f'// vacancy COUNTS they are converted to active vacancies at the EU job-vacancy')
    L.append(f'// rate ({VACANCY_RATE:.1%}): count = employees(thousands) × 1000 × {VACANCY_RATE}. Annual figures')
    L.append('// are held flat across each calendar year and carried forward to "now" when')
    L.append('// expanded onto the shared IVI_MONTHS axis (see EU_SERIES below).')
    L.append('')
    L.append("import { IVI_MONTHS } from './iviSkillDemand';")
    L.append('')
    L.append(f'export const EU_YEARS: number[] = {json.dumps(years)};')
    L.append(f"export const EU_SOURCE = 'Eurostat — Job vacancy statistics by occupation (OJA breakdowns), by country';")
    L.append('')
    L.append('// Country id → display label and capital [lng, lat] (the heat-point location).')
    L.append('export const EU_CITY_LABEL: Record<string, string> = {')
    for k in COUNTRIES:
        cid, label, _ = COUNTRIES[k]
        L.append(f'  {cid}: {json.dumps(label)},')
    L.append('};')
    L.append('export const EU_CITY_LNGLAT: Record<string, [number, number]> = {')
    for k in COUNTRIES:
        cid, _, (lng, lat) = COUNTRIES[k]
        L.append(f'  {cid}: [{lng}, {lat}],')
    L.append('};')
    L.append(f'export const EU_CITIES: string[] = {json.dumps([COUNTRIES[k][0] for k in COUNTRIES])};')
    L.append('')
    L.append('// Compact per-year source values: skill → country id → [value per EU_YEARS].')
    L.append('const EU_ANNUAL: Record<string, Record<string, number[]>> = {')
    for s in order:
        parts = []
        for k in COUNTRIES:
            ckey = k
            if ckey in acc[s]:
                yv = acc[s][ckey]
                arr = [yv.get(y, 0) for y in years]
                if any(arr):
                    parts.append(f'{id_of[ckey]}: [{",".join(map(str, arr))}]')
        if parts:
            L.append(f'  {json.dumps(s)}: {{ {", ".join(parts)} }},')
    L.append('};')
    L.append('')
    L.append('// Expand the annual values onto the shared monthly IVI_MONTHS axis: each month')
    L.append('// takes its calendar year\'s value (forward-filled across year gaps); months after')
    L.append('// the last year carry the last value; months before the first year are zero.')
    L.append('function expand(annual: Record<string, number[]>): Record<string, number[]> {')
    L.append('  const out: Record<string, number[]> = {};')
    L.append('  for (const [city, vals] of Object.entries(annual)) {')
    L.append('    // year → value, forward-filled so a missing middle year inherits the previous.')
    L.append('    const byYear = new Map<number, number>();')
    L.append('    let last = 0;')
    L.append('    for (let i = 0; i < EU_YEARS.length; i++) {')
    L.append('      if (vals[i] > 0) last = vals[i];')
    L.append('      byYear.set(EU_YEARS[i], last);')
    L.append('    }')
    L.append('    const firstYear = EU_YEARS[0];')
    L.append('    const lastYear = EU_YEARS[EU_YEARS.length - 1];')
    L.append('    const lastVal = byYear.get(lastYear) || 0;')
    L.append('    out[city] = IVI_MONTHS.map((ym) => {')
    L.append('      const y = Number(ym.slice(0, 4));')
    L.append('      if (y < firstYear) return 0;')
    L.append('      if (y > lastYear) return lastVal;')
    L.append('      return byYear.get(y) || 0;')
    L.append('    });')
    L.append('  }')
    L.append('  return out;')
    L.append('}')
    L.append('')
    L.append('// Skill → country id → monthly vacancy history (aligned to IVI_MONTHS).')
    L.append('export const EU_SERIES: Record<string, Record<string, number[]>> =')
    L.append('  Object.fromEntries(Object.entries(EU_ANNUAL).map(([s, a]) => [s, expand(a)]));')
    L.append('')
    L.append('// Skill → latest-year country vacancy count (current heat map).')
    L.append('export const EU_SKILL_BY_CITY: Record<string, Record<string, number>> =')
    L.append('  Object.fromEntries(')
    L.append('    Object.entries(EU_SERIES).map(([s, byCity]) => [')
    L.append('      s,')
    L.append('      Object.fromEntries(Object.entries(byCity).map(([c, arr]) => [c, arr[arr.length - 1]])),')
    L.append('    ]),')
    L.append('  );')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))

    ncountries = len({c for s in acc for c in acc[s]})
    tot = sum(skill_total(s) for s in order)
    print(f'{len(order)} skills mapped across {ncountries} countries, years {years[0]}..{years[-1]}, '
          f'latest-year total {tot} -> {OUT}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-eu-vacancy-demand.py path/to/jvs_a_isco3_r1.xlsx')
    main(sys.argv[1])
