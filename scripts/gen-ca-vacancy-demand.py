#!/usr/bin/env python3
"""Regenerate src/employsi/data/caVacancyDemand.ts from a Statistics Canada
"Job vacancies by broad occupational category" table (14-10-0399, quarterly,
national).

This is the Canadian counterpart of the Jobs & Skills Australia IVI wiring
(iviSkillDemand.ts). StatCan only publishes these vacancies at the 1-digit NOC
level (10 broad occupation groups) for Canada as a whole, so — unlike the AU IVI,
which is occupation-detailed and state-level — we:

  1. Map each canonical skill (skillsTaxonomy `cat`) to its NOC broad group.
  2. Disaggregate each group's quarterly national vacancies down to skill level
     using the AU IVI national demand mix as weights (IVI_SKILL_NATIONAL). This
     is what "shares a relationship with the JSA/IVI data" means: the Australian
     skill signal is used to split Canada's coarse group totals into skills.
  3. Attribute the national figure across the five Canadian hub cities on the map
     by metro-population weight, so the North America heat map (and the same time
     slider used for Australia) lights up Toronto/Montreal/Vancouver/Calgary/
     Ottawa for the searched skill and scrubs through history.

The output series is aligned to the SAME month axis as the IVI (IVI_MONTHS), so
the one time slider drives both countries. StatCan quarters are forward-filled
across their three months; months before Canada's first quarter are zero.

Usage: python3 scripts/gen-ca-vacancy-demand.py path/to/14100399.csv
"""
import csv, json, re, sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from skills_taxonomy import load_categories  # noqa: E402

ROOT = __file__.rsplit('/scripts/', 1)[0]
TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'
IVI = f'{ROOT}/src/employsi/data/iviSkillDemand.ts'
OUT = f'{ROOT}/src/employsi/data/caVacancyDemand.ts'

# Canadian hub cities on the map (ids match GLOBAL_HUB_LABEL / HUB_LNGLAT), with
# rough metro-population weights used to split the national figure across them.
HUB_POP = {'toronto': 6.4, 'montreal': 4.3, 'vancouver': 2.6, 'calgary': 1.6, 'ottawa': 1.5}
_tot = sum(HUB_POP.values())
HUB_W = {k: v / _tot for k, v in HUB_POP.items()}
CITIES = list(HUB_POP.keys())

# skillsTaxonomy `cat` → NOC 2021 broad (1-digit) occupation group.
#   0 Legislative & senior management   1 Business, finance & administration
#   2 Natural & applied sciences        3 Health
#   4 Education, law, social, govt      5 Art, culture, recreation & sport
#   6 Sales & service                   7 Trades, transport & equipment
#   8 Natural resources & agriculture   9 Manufacturing & utilities
CAT_TO_NOC = {
    'Admin': '1', 'Corporate': '1', 'Financial': '1',
    'Digital': '2', 'Engineering': '2', 'Science': '2', 'Built Environment': '2', 'Sector': '2',
    'Health': '3', 'Care': '3',
    'Education': '4', 'Community': '4', 'Public Sector': '4', 'Safety': '4',
    'Creative': '5',
    'Sales': '6', 'Hospitality': '6', 'Personal': '6', 'Cleaning': '6', 'Property': '6',
    'Trades': '7', 'Construction': '7', 'Transport': '7',
    'Agriculture': '8', 'Mining': '8', 'Energy': '8',
    'Manufacturing': '9',
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
    nat = {}
    for m in re.finditer(r'"([^"]+)":\s*(\d+)', body):
        nat[m.group(1)] = int(m.group(2))
    return nat


def load_ivi_months():
    body = open(IVI).read()
    m = re.search(r'IVI_MONTHS: string\[\] = (\[.*?\]);', body, re.S)
    return json.loads(m.group(1))


def quarter_key(ym: str) -> str:
    y, mo = ym.split('-')
    qstart = ((int(mo) - 1) // 3) * 3 + 1
    return f'{y}-{qstart:02d}'


def main(path):
    skills = load_skills()  # [(skill, cat)]
    nat = load_ivi_national()
    months = load_ivi_months()

    # Parse StatCan: total vacancies per NOC broad group per quarter.
    # caq[code][quarterKey] = value
    caq = {}
    for r in csv.DictReader(open(path, encoding='utf-8-sig')):
        if r['Statistics'] != 'Job vacancies':
            continue
        if r['Job vacancy characteristics'] != 'Type of work, all types':
            continue
        noc = r['National Occupational Classification']
        mcode = re.search(r'\[(\d)\]$', noc.strip())
        if not mcode:
            continue  # skip "Total, all occupations" / "Unclassified"
        code = mcode.group(1)
        val = r['VALUE'].strip()
        if not val:
            continue
        caq.setdefault(code, {})[r['REF_DATE']] = round(float(val))

    qkeys = sorted({q for d in caq.values() for q in d})
    first_q, last_q = qkeys[0], qkeys[-1]

    def group_at(code: str, ym: str) -> int:
        qk = quarter_key(ym)
        d = caq.get(code, {})
        if qk in d:
            return d[qk]
        if qk < first_q:
            return 0
        # after the last published quarter → forward-fill the latest known value
        return d.get(last_q, 0)

    # Group members + weight sums (AU IVI national demand, floored at 1 so every
    # mapped skill still receives a share of its group's Canadian vacancies).
    members = {}
    for skill, cat in skills:
        code = CAT_TO_NOC.get(cat)
        if code is None:
            continue
        members.setdefault(code, []).append(skill)
    wsum = {code: sum(max(1, nat.get(s, 0)) for s in ms) for code, ms in members.items()}

    nmonths = len(months)
    # series[skill][city] = int[nmonths]
    series = {}
    latest = {}
    for skill, cat in skills:
        code = CAT_TO_NOC.get(cat)
        if code is None or code not in members:
            continue
        share = max(1, nat.get(skill, 0)) / wsum[code]
        arr_nat = [round(group_at(code, ym) * share) for ym in months]
        by_city = {}
        for city in CITIES:
            w = HUB_W[city]
            by_city[city] = [round(v * w) for v in arr_nat]
        series[skill] = by_city
        latest[skill] = {c: by_city[c][-1] for c in CITIES}

    # order skills by latest national total, most in demand first
    order = sorted(series, key=lambda s: -sum(latest[s].values()))
    last_month = months[-1]

    L = []
    L.append('// GENERATED — do not edit by hand. Run scripts/gen-ca-vacancy-demand.py.')
    L.append('// Source: Statistics Canada, Job vacancies by broad occupational category')
    L.append('// (table 14-10-0399, quarterly, national). Canada publishes these only at')
    L.append('// the 1-digit NOC level, so each group total is disaggregated to skill level')
    L.append('// using the AU Jobs & Skills Australia IVI national demand mix, then split')
    L.append('// across the five Canadian hub cities by metro population. Aligned to the SAME')
    L.append('// month axis as IVI_MONTHS so one time slider scrubs both countries.')
    L.append('')
    L.append(f"export const CA_MONTH = '{last_month}';")
    L.append("export const CA_SOURCE =")
    L.append("  'Statistics Canada — Job vacancies by broad occupational category (NOC, quarterly)';")
    L.append('')
    L.append('// Canadian hub cities carrying vacancy heat (ids match the map hubs).')
    L.append('export const CA_CITIES: string[] = ' + json.dumps(CITIES) + ';')
    L.append('')
    L.append('// Skill → Canadian hub city → monthly vacancy history (aligned to IVI_MONTHS).')
    L.append('export const CA_SERIES: Record<string, Record<string, number[]>> = {')
    for s in order:
        L.append(f'  {json.dumps(s)}: {{')
        for city in CITIES:
            L.append(f'    {city}: [{",".join(map(str, series[s][city]))}],')
        L.append('  },')
    L.append('};')
    L.append('')
    L.append('// Skill → latest-month Canadian hub vacancy count (current heat map).')
    L.append('export const CA_SKILL_BY_CITY: Record<string, Record<string, number>> = {')
    for s in order:
        obj = ', '.join(f'{c}: {latest[s][c]}' for c in CITIES)
        L.append(f'  {json.dumps(s)}: {{ {obj} }},')
    L.append('};')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))
    tot_latest = sum(sum(latest[s].values()) for s in order)
    print(f'{last_month}: {len(order)} skills mapped, {len(qkeys)} quarters '
          f'({first_q}..{last_q}), latest total {tot_latest} -> {OUT}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-ca-vacancy-demand.py path/to/14100399.csv')
    main(sys.argv[1])
