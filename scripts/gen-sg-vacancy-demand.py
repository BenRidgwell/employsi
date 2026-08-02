#!/usr/bin/env python3
"""Regenerate src/employsi/data/sgVacancyDemand.ts from Singapore's MRSD "Job
Vacancy by Industry and Occupational Group" release (2006-2026, SSIC2020 sheet).

The Singapore counterpart of the Canada (StatCan) and Australia (JSA/IVI) wiring.
MRSD publishes vacancies at three broad occupational groups nationally, quarterly:
  • PMET  — Professionals, Managers, Executives & Technicians
  • CSS   — Clerical, Sales and Services Workers
  • PTL   — Production & Transport Operators, Cleaners & Labourers
As with Canada, each group's quarterly national total is disaggregated to skill
level using the AU IVI national demand mix (the shared relationship), then placed
on the single Singapore hub. Figures are published in THOUSANDS, so ×1000 to
normalise with the AU/Canada counts. Aligned to the SAME month axis (IVI_MONTHS)
so one time slider scrubs every country; only 2006-03 onward is kept so it lines
up with the AU/Canada series.

Quarterly refresh:
  1. Download the latest "Job Vacancy" time-series workbook from
     https://stats.mom.gov.sg/Pages/JobVacancyTimeSeries.aspx
     (the file is named like mrsd_23_Qtly_and_annl_tsd_on_job_vac_by_ind_and_occ_grp.xlsx;
     SHEET below names the sheet inside it. Recorded because the page this
     generator was first written against has since moved and two plausible
     guesses at the new address both 404 — this is the live one.)
  2. python3 scripts/gen-sg-vacancy-demand.py path/to/that.xlsx

Usage: python3 scripts/gen-sg-vacancy-demand.py path/to/mrsd_job_vac.xlsx
"""
import json, re, sys
import openpyxl

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from skills_taxonomy import load_categories  # noqa: E402

ROOT = __file__.rsplit('/scripts/', 1)[0]
TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'
IVI = f'{ROOT}/src/employsi/data/iviSkillDemand.ts'
OUT = f'{ROOT}/src/employsi/data/sgVacancyDemand.ts'
SHEET = '2006-2026(SSIC2020)'
CITY = 'singapore'

# The three broad occupational groups (matched on the group header row, where the
# INDUSTRY column reads TOTAL = the across-industry total for that group).
GROUPS = {
    'PROFESSIONALS, MANAGERS, EXECUTIVES & TECHNICIANS': 'PMET',
    'CLERICAL, SALES AND SERVICES WORKERS': 'CSS',
    'PRODUCTION & TRANSPORT OPERATORS, CLEANERS & LABOURERS': 'PTL',
}

# skillsTaxonomy `cat` → Singapore occupational group.
CAT_TO_SG = {
    'Digital': 'PMET', 'Engineering': 'PMET', 'Science': 'PMET', 'Built Environment': 'PMET',
    'Corporate': 'PMET', 'Financial': 'PMET', 'Health': 'PMET', 'Education': 'PMET',
    'Creative': 'PMET', 'Public Sector': 'PMET', 'Sector': 'PMET',
    'Admin': 'CSS', 'Sales': 'CSS', 'Hospitality': 'CSS', 'Personal': 'CSS',
    'Property': 'CSS', 'Community': 'CSS', 'Care': 'CSS', 'Safety': 'CSS',
    'Trades': 'PTL', 'Construction': 'PTL', 'Transport': 'PTL', 'Manufacturing': 'PTL',
    'Mining': 'PTL', 'Agriculture': 'PTL', 'Energy': 'PTL', 'Cleaning': 'PTL',
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
    # Singapore labels each quarter by its END month (Mar/Jun/Sep/Dec), so a
    # given month maps to the quarter whose end-month is the next multiple of 3.
    y, mo = ym.split('-')
    return f'{y}-{((int(mo) - 1) // 3) * 3 + 3:02d}'


def num_k(v):
    # thousands → count; '-'/'n.a.'/None → None (missing)
    try:
        return round(float(v) * 1000)
    except Exception:
        return None


def main(path):
    skills = load_skills()
    nat = load_ivi_national()
    months = load_ivi_months()

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[SHEET]
    rows = list(ws.iter_rows(values_only=True))
    hdr = rows[3]
    # quarter column index → 'YYYY-MM'
    year = None
    qcol = {}
    for ci, v in enumerate(hdr):
        s = str(v).strip() if v is not None else ''
        if s.isdigit() and len(s) == 4:
            year = int(s)
        elif s in ('Mar', 'Jun', 'Sep', 'Dec') and year:
            mo = {'Mar': '03', 'Jun': '06', 'Sep': '09', 'Dec': '12'}[s]
            qcol[f'{year}-{mo}'] = ci

    # group → { quarterKey: value }
    grp = {}
    for r in rows:
        a = str(r[0]).strip() if r[0] else ''
        c = str(r[2]).strip() if r[2] else ''
        if a in GROUPS and c == 'TOTAL':
            code = GROUPS[a]
            grp[code] = {qk: num_k(r[ci]) for qk, ci in qcol.items()}

    assert set(grp) == set(GROUPS.values()), f'missing groups: {set(GROUPS.values()) - set(grp)}'
    qkeys = sorted(qcol)
    # last quarter that actually has a value (ignore trailing None)
    def group_at(code, ym):
        d = grp[code]
        qk = quarter_key(ym)
        if d.get(qk) is not None:
            return d[qk]
        # forward-fill from the latest non-null quarter <= qk
        prior = [k for k in qkeys if k <= qk and d.get(k) is not None]
        return d[prior[-1]] if prior else 0

    # group members + IVI-national weight sums (floor 1 so every skill shares).
    members = {}
    for s, cat in skills:
        code = CAT_TO_SG.get(cat)
        if code:
            members.setdefault(code, []).append(s)
    wsum = {code: sum(max(1, nat.get(s, 0)) for s in ms) for code, ms in members.items()}

    nmonths = len(months)
    series, latest = {}, {}
    for s, cat in skills:
        code = CAT_TO_SG.get(cat)
        if not code:
            continue
        share = max(1, nat.get(s, 0)) / wsum[code]
        arr = [round(group_at(code, ym) * share) for ym in months]
        series[s] = {CITY: arr}
        latest[s] = {CITY: arr[-1]}

    order = sorted(series, key=lambda s: -latest[s][CITY])
    last_month = months[-1]

    L = []
    L.append('// GENERATED — do not edit by hand. Run scripts/gen-sg-vacancy-demand.py.')
    L.append('// Source: Singapore MRSD — Job Vacancy by Industry and Occupational Group')
    L.append('// (quarterly, national). Published at three broad occupational groups; each')
    L.append('// group total is disaggregated to skill level using the AU JSA/IVI national')
    L.append('// demand mix, placed on the Singapore hub. Figures are in thousands in the')
    L.append('// source, scaled ×1000 here to match the AU/Canada counts, and aligned to the')
    L.append('// IVI_MONTHS axis (2006-03 on) so one time slider scrubs all three countries.')
    L.append('')
    L.append(f"export const SG_MONTH = '{last_month}';")
    L.append("export const SG_SOURCE =")
    L.append("  'Singapore MRSD — Job Vacancy by Occupational Group (quarterly)';")
    L.append('')
    L.append('export const SG_CITIES: string[] = ' + json.dumps([CITY]) + ';')
    L.append('')
    L.append('// Skill → Singapore hub → monthly vacancy history (aligned to IVI_MONTHS).')
    L.append('export const SG_SERIES: Record<string, Record<string, number[]>> = {')
    for s in order:
        L.append(f'  {json.dumps(s)}: {{ {CITY}: [{",".join(map(str, series[s][CITY]))}] }},')
    L.append('};')
    L.append('')
    L.append('// Skill → latest-month Singapore vacancy count (current heat map).')
    L.append('export const SG_SKILL_BY_CITY: Record<string, Record<string, number>> = {')
    for s in order:
        L.append(f'  {json.dumps(s)}: {{ {CITY}: {latest[s][CITY]} }},')
    L.append('};')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))
    tot = sum(latest[s][CITY] for s in order)
    print(f'{last_month}: {len(order)} skills mapped, {len(qkeys)} quarters '
          f'({qkeys[0]}..{qkeys[-1]}), latest SG total {tot} -> {OUT}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-sg-vacancy-demand.py path/to/mrsd_job_vac.xlsx')
    main(sys.argv[1])
