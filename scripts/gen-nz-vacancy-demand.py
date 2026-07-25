#!/usr/bin/env python3
"""Regenerate src/employsi/data/nzVacancyDemand.ts from MBIE's "Jobs Online"
monthly series (New Zealand).

Unlike the AU IVI / Canada / Singapore releases (which are vacancy COUNTS), the
NZ Jobs Online series is an INDEX (May 2007 = 100) by region, industry and
occupation — it captures the shape of demand over time, not an absolute level.
So to sit alongside the count-based datasets we:

  1. Anchor Auckland's CURRENT total to a realistic online-vacancy level and split
     it to skills using the AU IVI national mix (the shared relationship) — this
     sets each skill's present-day magnitude, comparable to the other cities.
  2. Drive each skill's HISTORY from its NZ occupation group's index (the 8
     ANZSCO major-group columns), so different occupations move differently over
     time exactly as the NZ data shows.

Aligned to the IVI_MONTHS axis (monthly), placed on the Auckland hub. Months
before NZ's series starts (May 2007) are zero.

Usage: python3 scripts/gen-nz-vacancy-demand.py path/to/jol_monthly.csv
"""
import csv, json, re, sys

ROOT = __file__.rsplit('/scripts/', 1)[0]
TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'
IVI = f'{ROOT}/src/employsi/data/iviSkillDemand.ts'
OUT = f'{ROOT}/src/employsi/data/nzVacancyDemand.ts'
CITY = 'auckland'
# Realistic current Auckland online-vacancy level to anchor the index to (MBIE
# Jobs Online covers online ads; NZ ~30k nationally, Auckland ~37%).
ANCHOR_AUCKLAND = 11000

# skillsTaxonomy `cat` → NZ ANZSCO major occupation group (column names).
PROF = 'Professionals'
CAT_TO_NZ = {
    'Digital': PROF, 'Engineering': PROF, 'Science': PROF, 'Health': PROF, 'Education': PROF,
    'Financial': PROF, 'Creative': PROF, 'Built Environment': PROF, 'Public Sector': PROF,
    'Sector': PROF, 'Corporate': PROF, 'Energy': PROF,
    'Admin': 'Clerical and Administrative Workers',
    'Sales': 'Sales Workers', 'Property': 'Sales Workers',
    'Trades': 'Technicians and Trades Workers', 'Construction': 'Technicians and Trades Workers',
    'Care': 'Community and Personal Service Workers', 'Community': 'Community and Personal Service Workers',
    'Personal': 'Community and Personal Service Workers', 'Hospitality': 'Community and Personal Service Workers',
    'Safety': 'Community and Personal Service Workers',
    'Transport': 'Machinery Operators and Drivers', 'Mining': 'Machinery Operators and Drivers',
    'Manufacturing': 'Machinery Operators and Drivers',
    'Agriculture': 'Labourers', 'Cleaning': 'Labourers',
}


def load_skills():
    body = open(TAX).read().split('RAW_SKILLS', 1)[1].split('];', 1)[0]
    return [(m.group(1), m.group(2)) for m in re.finditer(r"\{\s*skill:\s*'([^']+)',\s*cat:\s*'([^']+)',", body)]


def load_ivi_national():
    body = open(IVI).read().split('IVI_SKILL_NATIONAL', 1)[1].split('{', 1)[1].split('};', 1)[0]
    return {m.group(1): int(m.group(2)) for m in re.finditer(r'"([^"]+)":\s*(\d+)', body)}


def load_ivi_months():
    m = re.search(r'IVI_MONTHS: string\[\] = (\[.*?\]);', open(IVI).read(), re.S)
    return json.loads(m.group(1))


def main(path):
    skills = load_skills()
    nat = load_ivi_national()
    months = load_ivi_months()

    rows = list(csv.reader(open(path, encoding='utf-8-sig')))
    header = rows[0]
    col = {name: i for i, name in enumerate(header)}
    # occupation index columns → { 'YYYY-MM': value }
    occ_cols = [PROF, 'Clerical and Administrative Workers', 'Sales Workers',
                'Technicians and Trades Workers', 'Community and Personal Service Workers',
                'Machinery Operators and Drivers', 'Labourers']
    occ = {g: {} for g in occ_cols}
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        d, m, y = r[col['ACTUAL_DATE']].split('/')
        ym = f'{y}-{int(m):02d}'
        for g in occ_cols:
            try:
                occ[g][ym] = float(r[col[g]])
            except Exception:
                pass

    have = sorted({k for g in occ_cols for k in occ[g]})
    first_nz, last_nz = have[0], have[-1]

    def occ_at(g, ym):
        d = occ[g]
        if ym in d:
            return d[ym]
        if ym < first_nz:
            return None  # before NZ series begins
        prior = [k for k in have if k <= ym and k in d]
        return d[prior[-1]] if prior else None

    # anchor month = latest IVI month that has NZ data
    anchor_ym = max(m for m in months if m <= last_nz)

    # current-level per skill from the AU IVI mix (group cancels out, so a skill's
    # present level is Auckland_total × its share of total IVI national demand).
    total_nat = sum(max(1, nat.get(s, 0)) for s, cat in skills if cat in CAT_TO_NZ)
    nmonths = len(months)
    series, latest = {}, {}
    for s, cat in skills:
        g = CAT_TO_NZ.get(cat)
        if not g:
            continue
        cur = ANCHOR_AUCKLAND * max(1, nat.get(s, 0)) / total_nat  # present level
        base = occ_at(g, anchor_ym) or 100.0
        arr = []
        for ym in months:
            idx = occ_at(g, ym)
            arr.append(0 if idx is None else round(cur * idx / base))
        series[s] = {CITY: arr}
        latest[s] = {CITY: arr[months.index(anchor_ym)]}

    order = sorted(series, key=lambda s: -latest[s][CITY])
    last_month = months[-1]

    L = []
    L.append('// GENERATED — do not edit by hand. Run scripts/gen-nz-vacancy-demand.py.')
    L.append('// Source: New Zealand MBIE — Jobs Online monthly series (an INDEX, May 2007 =')
    L.append('// 100, by region/industry/occupation). Present-day skill levels are anchored to')
    L.append('// a realistic Auckland online-vacancy level and split by the AU JSA/IVI national')
    L.append('// mix; each skill\'s history is driven by its NZ occupation-group index. Placed')
    L.append('// on the Auckland hub, aligned to the IVI_MONTHS axis (zero before May 2007).')
    L.append('')
    L.append(f"export const NZ_MONTH = '{last_month}';")
    L.append("export const NZ_SOURCE =")
    L.append("  'New Zealand MBIE — Jobs Online (indexed, occupation-weighted)';")
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
    print(f'{last_month}: {len(order)} skills, NZ series {first_nz}..{last_nz}, '
          f'anchor {anchor_ym}, Auckland latest total {tot} -> {OUT}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-nz-vacancy-demand.py path/to/jol_monthly.csv')
    main(sys.argv[1])
