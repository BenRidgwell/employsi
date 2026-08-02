#!/usr/bin/env python3
"""Regenerate src/employsi/data/nzVacancyDemand.ts from MBIE's "Jobs Online
vacancies by occupation" release (quarterly, by region — the Auckland columns).

Like the earlier NZ file this is an INDEX (Dec 2010 = 100), NOT vacancy counts,
which is why it can't be taken "in thousands" — it captures the shape of demand,
not an absolute level. This occupation×region release lets us use AUCKLAND's OWN
occupation trends (8 ANZSCO major groups) rather than the national ones. So, as
before:

  1. Each skill's CURRENT level is anchored to a realistic Auckland online-vacancy
     level and split by the AU JSA/IVI national mix (the shared relationship).
  2. Each skill's HISTORY is driven by its Auckland occupation-group index here.

Aligned to the IVI_MONTHS axis (quarters forward-filled across their months),
placed on the Auckland hub; months before the NZ series begins are zero.

Usage: python3 scripts/gen-nz-vacancy-demand.py path/to/jol_by_occupation.xlsx
"""
import json, re, sys
import openpyxl

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from skills_taxonomy import load_categories  # noqa: E402

ROOT = __file__.rsplit('/scripts/', 1)[0]
TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'
IVI = f'{ROOT}/src/employsi/data/iviSkillDemand.ts'
OUT = f'{ROOT}/src/employsi/data/nzVacancyDemand.ts'
SHEET = 'Data'
CITY = 'auckland'
ANCHOR_AUCKLAND = 11000  # realistic current Auckland online-vacancy level

# Auckland (AKL) is the first region column of each occupation block.
OCC_COL = {
    'Managers': 1, 'Professionals': 11, 'Trades and Technical': 21,
    'Community Services': 31, 'Clerical_Admin': 41, 'Sales': 51,
    'Machinery_Drivers': 61, 'Labourers': 71,
}
# skillsTaxonomy `cat` → NZ occupation group in this release.
CAT_TO_NZ = {
    'Digital': 'Professionals', 'Engineering': 'Professionals', 'Science': 'Professionals',
    'Health': 'Professionals', 'Education': 'Professionals', 'Financial': 'Professionals',
    'Creative': 'Professionals', 'Built Environment': 'Professionals', 'Public Sector': 'Professionals',
    'Sector': 'Professionals', 'Corporate': 'Professionals', 'Energy': 'Professionals',
    'Admin': 'Clerical_Admin',
    'Sales': 'Sales', 'Property': 'Sales',
    'Trades': 'Trades and Technical', 'Construction': 'Trades and Technical',
    'Care': 'Community Services', 'Community': 'Community Services', 'Personal': 'Community Services',
    'Hospitality': 'Community Services', 'Safety': 'Community Services',
    'Transport': 'Machinery_Drivers', 'Mining': 'Machinery_Drivers', 'Manufacturing': 'Machinery_Drivers',
    'Agriculture': 'Labourers', 'Cleaning': 'Labourers',
}


def load_skills():
    """(skill, cat) pairs, from the one shared reader.

    This used to be a local regex that only understood SINGLE-quoted TS strings.
    A repo-wide Prettier run rewrote skillsTaxonomy.ts in double quotes and the
    regex quietly matched nothing — the generator still ran, still wrote a file,
    and mapped ZERO skills. The same failure had already been found and fixed in
    scripts/skills_taxonomy.py; Canada, New Zealand and Singapore were simply
    never moved onto it. They are now, so there is one parser to keep right.
    """
    return load_categories(TAX)


def load_ivi_national():
    body = open(IVI).read().split('IVI_SKILL_NATIONAL', 1)[1].split('{', 1)[1].split('};', 1)[0]
    return {m.group(1): int(m.group(2)) for m in re.finditer(r'"([^"]+)":\s*(\d+)', body)}


def load_ivi_months():
    m = re.search(r'IVI_MONTHS: string\[\] = (\[.*?\]);', open(IVI).read(), re.S)
    return json.loads(m.group(1))


def quarter_key(ym):
    # NZ quarters labelled by their END month (Mar/Jun/Sep/Dec).
    y, mo = ym.split('-')
    return f'{y}-{((int(mo) - 1) // 3) * 3 + 3:02d}'


def main(path):
    skills = load_skills()
    nat = load_ivi_national()
    months = load_ivi_months()

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[SHEET]
    rows = list(ws.iter_rows(values_only=True))
    # occupation → { 'YYYY-MM'(quarter-end) : index value } for the Auckland column
    occ = {g: {} for g in OCC_COL}
    for r in rows[4:]:
        if not r or r[0] is None:
            continue
        dt = r[0]
        ym = dt.strftime('%Y-%m') if hasattr(dt, 'strftime') else str(dt)[:7]
        for g, ci in OCC_COL.items():
            v = r[ci]
            try:
                occ[g][ym] = float(v)
            except Exception:
                pass

    have = sorted({k for g in OCC_COL for k in occ[g]})
    first_nz, last_nz = have[0], have[-1]

    def occ_at(g, ym):
        d = occ[g]
        qk = quarter_key(ym)
        if qk in d:
            return d[qk]
        if qk < first_nz:
            return None
        prior = [k for k in have if k <= qk and k in d]
        return d[prior[-1]] if prior else None

    anchor_ym = max(m for m in months if quarter_key(m) <= last_nz)
    total_nat = sum(max(1, nat.get(s, 0)) for s, cat in skills if cat in CAT_TO_NZ)

    series, latest = {}, {}
    for s, cat in skills:
        g = CAT_TO_NZ.get(cat)
        if not g:
            continue
        cur = ANCHOR_AUCKLAND * max(1, nat.get(s, 0)) / total_nat
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
    L.append('// Source: New Zealand MBIE — Jobs Online vacancies by occupation (quarterly, an')
    L.append('// INDEX, Dec 2010 = 100), the Auckland region series. Present-day skill levels')
    L.append('// are anchored to a realistic Auckland online-vacancy level and split by the AU')
    L.append('// JSA/IVI national mix; each skill\'s history follows its Auckland occupation-')
    L.append('// group index. Placed on the Auckland hub, aligned to the IVI_MONTHS axis.')
    L.append('')
    L.append(f"export const NZ_MONTH = '{last_month}';")
    L.append("export const NZ_SOURCE =")
    L.append("  'New Zealand MBIE — Jobs Online by occupation (Auckland, indexed)';")
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
    print(f'{last_month}: {len(order)} skills, NZ occ series {first_nz}..{last_nz}, '
          f'anchor {anchor_ym}, Auckland latest total {tot} -> {OUT}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-nz-vacancy-demand.py path/to/jol_by_occupation.xlsx')
    main(sys.argv[1])
