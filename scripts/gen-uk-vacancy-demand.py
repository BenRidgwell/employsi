#!/usr/bin/env python3
"""Regenerate src/employsi/data/ukVacancyDemand.ts from the UK ONS "New online
job adverts by occupation" release (Table 3, by region × SOC 4-digit occupation,
monthly).

The UK release is the cleanest of the international feeds: real vacancy COUNTS
(not an index) at detailed SOC 4-digit occupation level, so — exactly like the AU
IVI ANZSCO4 wiring — each occupation label is term-matched to canonical skills
via the shared skillsTaxonomy terms and summed per skill. We take the LONDON
region rows and place them on the London hub. Aligned to the IVI_MONTHS axis;
the series starts Jan 2017, so earlier months are zero.

Usage: python3 scripts/gen-uk-vacancy-demand.py path/to/labour_demand.xlsx
"""
import json, re, sys
import openpyxl

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from skills_taxonomy import load_skills, matcher  # noqa: E402

ROOT = __file__.rsplit('/scripts/', 1)[0]
TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'
IVI = f'{ROOT}/src/employsi/data/iviSkillDemand.ts'
OUT = f'{ROOT}/src/employsi/data/ukVacancyDemand.ts'
SHEET = 'Table 3'
REGION = 'London'
CITY = 'london'

MON = {'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
       'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'}


def load_ivi_months():
    m = re.search(r'IVI_MONTHS: string\[\] = (\[.*?\]);', open(IVI).read(), re.S)
    return json.loads(m.group(1))


def hdr_month(v):
    # 'Jan-17' → '2017-01'; also tolerates datetime headers.
    if hasattr(v, 'strftime'):
        return v.strftime('%Y-%m')
    m = re.match(r'([A-Za-z]{3})[-\s](\d{2,4})', str(v).strip())
    if not m:
        return None
    mo = MON.get(m.group(1).title())
    y = m.group(2)
    y = ('20' + y) if len(y) == 2 else y
    return f'{y}-{mo}' if mo else None


def main(path):
    skills_for = matcher(TAX)
    months = load_ivi_months()

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[SHEET]
    it = ws.iter_rows(values_only=True)
    header = None
    for r in it:
        if r and str(r[0]).strip() == 'Region':
            header = list(r)
            break
    # month column index → 'YYYY-MM'
    mcol = {}
    for ci in range(3, len(header)):
        ym = hdr_month(header[ci])
        if ym:
            mcol[ci] = ym

    # accumulate London counts per skill per source-month
    label_skills = {}
    acc = {}  # skill → { 'YYYY-MM': count }
    for r in it:
        if not r or str(r[0]).strip() != REGION:
            continue
        label = str(r[2] or '').strip()
        if not label:
            continue
        if label not in label_skills:
            label_skills[label] = skills_for(label)
        sk = label_skills[label]
        if not sk:
            continue
        for ci, ym in mcol.items():
            try:
                v = round(float(r[ci]))
            except Exception:
                continue
            for s in sk:
                d = acc.setdefault(s, {})
                d[ym] = d.get(ym, 0) + v

    src_months = sorted({m for d in acc.values() for m in d})
    first_src, last_src = src_months[0], src_months[-1]

    series, latest = {}, {}
    anchor = max((m for m in months if m <= last_src), default=last_src)
    for s, d in acc.items():
        arr = [d.get(ym, 0) for ym in months]
        series[s] = {CITY: arr}
        latest[s] = {CITY: d.get(anchor, 0)}

    order = sorted(series, key=lambda s: -latest[s][CITY])
    last_month = months[-1]

    L = []
    L.append('// GENERATED — do not edit by hand. Run scripts/gen-uk-vacancy-demand.py.')
    L.append('// Source: UK ONS — New online job adverts by occupation (Table 3, by region ×')
    L.append('// SOC 4-digit, monthly). Real vacancy counts: each SOC occupation is term-')
    L.append('// matched to canonical skills via the shared skillsTaxonomy terms and summed')
    L.append('// per skill (same approach as the AU IVI). London region, on the London hub,')
    L.append('// aligned to the IVI_MONTHS axis (the UK series starts Jan 2017).')
    L.append('')
    L.append(f"export const UK_MONTH = '{last_month}';")
    L.append("export const UK_SOURCE =")
    L.append("  'UK ONS — New online job adverts by occupation (London, SOC4)';")
    L.append('')
    L.append('export const UK_CITIES: string[] = ' + json.dumps([CITY]) + ';')
    L.append('')
    L.append('// Skill → London → monthly vacancy history (aligned to IVI_MONTHS).')
    L.append('export const UK_SERIES: Record<string, Record<string, number[]>> = {')
    for s in order:
        L.append(f'  {json.dumps(s)}: {{ {CITY}: [{",".join(map(str, series[s][CITY]))}] }},')
    L.append('};')
    L.append('')
    L.append('// Skill → latest-month London vacancy count (current heat map).')
    L.append('export const UK_SKILL_BY_CITY: Record<string, Record<string, number>> = {')
    for s in order:
        L.append(f'  {json.dumps(s)}: {{ {CITY}: {latest[s][CITY]} }},')
    L.append('};')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))
    tot = sum(latest[s][CITY] for s in order)
    print(f'{last_month}: {len(order)} skills mapped, UK series {first_src}..{last_src}, '
          f'anchor {anchor}, London latest total {tot} -> {OUT}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-uk-vacancy-demand.py path/to/labour_demand.xlsx')
    main(sys.argv[1])
