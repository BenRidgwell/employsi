#!/usr/bin/env python3
"""Regenerate src/employsi/data/euVacancyDemand.ts from Eurostat's "Job vacancy
statistics by occupation and NUTS 1 region (OJA breakdowns) — annual,
experimental" release (jvs_a_isco3_r1).

Each ISCO-08 3-digit occupation is term-matched to canonical skills via the
shared skillsTaxonomy terms and summed per skill, by country.

── WHAT CHANGED, AND WHY IT MATTERS ──────────────────────────────────────────
This release publishes FIVE indicators per occupation. The wiring used to read
SAL (employees) and convert it, because at the time that was what the extract in
hand carried:

    vacancies = employment × r / (1 − r),  r = the country's job vacancy rate

That is the correct inversion of Eurostat's own definition of the rate, and it
was a real improvement on the flat 2.5% before it. It is still a derivation.
The release also carries JOBVAC — the published vacancy count for that exact
occupation, country and year — and reading it removes the derivation entirely:

  * no second dataset. The rate came from jvs_q_nace2 (NACE B-S, all industries)
    and was applied to an OCCUPATION. A country's economy-wide rate is not its
    rate for nurses, so the conversion silently assumed every occupation in a
    country was equally short-staffed. JOBVAC is measured per occupation.
  * no compounding. Two published series multiplied together carry both
    revisions and both sets of confidence intervals.
  * MORE data, not less. Measured on this release: 9,727 country/year/occupation
    cells carry JOBVAC against 7,296 carrying SAL — 3,023 that only JOBVAC has.

Country coverage is unchanged, because it was never 26. All five indicators are
published for the same 18 member states; the other eight in COUNTRIES below
(Estonia, Greece, Croatia, Ireland, Italy, Luxembourg, Malta, Poland) have no
occupation breakdown at all and carried empty series before this change as well.
They stay in the geography exports because they are still markers on the Europe
layer — they simply light nothing when a skill is searched, which is the honest
rendering of "this country does not publish it".

── SOURCE ────────────────────────────────────────────────────────────────────
Fetched live from the dissemination API rather than a downloaded spreadsheet.
The old path needed a hand-made "custom extract" whose exact shape (which
indicator, which geo level, which years) was invisible from the file name, and
which nobody could reproduce six months later. The query below IS the
specification. No API key.

Usage: python3 scripts/gen-eu-vacancy-demand.py        (network required)
"""
import json, re, sys, urllib.parse, urllib.request

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from skills_taxonomy import matcher  # noqa: E402

ROOT = __file__.rsplit('/scripts/', 1)[0]
TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'
OUT = f'{ROOT}/src/employsi/data/euVacancyDemand.ts'

DATASET = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/jvs_a_isco3_r1'
QUERY = {
    'format': 'JSON',
    'lang': 'en',
    'indic_em': 'JOBVAC',  # the published vacancy count, not a base to convert
    'unit': 'THS',         # thousands
}

# Eurostat GEO code → canonical map id + display label + capital [lng, lat].
# Only these are kept: the EU/euro-area aggregates and the NUTS-1 sub-regions in
# the same release would double-count their own members.
# Note Greece is 'EL' in Eurostat's code list, not the ISO 'GR'.
COUNTRIES = {
    'BE': ('belgium', 'Belgium', [4.35, 50.85]),
    'BG': ('bulgaria', 'Bulgaria', [23.32, 42.70]),
    'CZ': ('czechia', 'Czechia', [14.42, 50.08]),
    'DE': ('germany', 'Germany', [13.40, 52.52]),
    'EE': ('estonia', 'Estonia', [24.75, 59.44]),
    'IE': ('ireland', 'Ireland', [-6.26, 53.35]),
    'EL': ('greece', 'Greece', [23.73, 37.98]),
    'ES': ('spain', 'Spain', [-3.70, 40.42]),
    'FR': ('france', 'France', [2.35, 48.86]),
    'HR': ('croatia', 'Croatia', [15.98, 45.81]),
    'IT': ('italy', 'Italy', [12.50, 41.90]),
    'CY': ('cyprus', 'Cyprus', [33.36, 35.17]),
    'LV': ('latvia', 'Latvia', [24.11, 56.95]),
    'LT': ('lithuania', 'Lithuania', [25.28, 54.69]),
    'LU': ('luxembourg', 'Luxembourg', [6.13, 49.61]),
    'HU': ('hungary', 'Hungary', [19.04, 47.50]),
    'MT': ('malta', 'Malta', [14.51, 35.90]),
    'NL': ('netherlands', 'Netherlands', [4.90, 52.37]),
    'AT': ('austria', 'Austria', [16.37, 48.21]),
    'PL': ('poland', 'Poland', [21.01, 52.23]),
    'PT': ('portugal', 'Portugal', [-9.14, 38.72]),
    'RO': ('romania', 'Romania', [26.10, 44.43]),
    'SI': ('slovenia', 'Slovenia', [14.51, 46.06]),
    'SK': ('slovakia', 'Slovakia', [17.11, 48.15]),
    'FI': ('finland', 'Finland', [24.94, 60.17]),
    'SE': ('sweden', 'Sweden', [18.07, 59.33]),
}

# Only the 3-digit occupation rows. The dimension also carries TOTAL, OTH
# ("Other occupations") and ICT — a CUSTOM AGGREGATE whose own label lists its
# members (OC133, OC251, OC252, …), every one of which is already an OC### row.
# Summing it with them would count ICT twice, so the code shape is the filter:
# it cannot be fooled by a label being reworded, which a name test could.
OCC = re.compile(r'^OC\d{3}$')


def fetch(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=180) as r:
        return json.loads(r.read())


def cells(d: dict):
    """Yield (geo, time, isco, value) from a JSON-stat response.

    jsonstat flattens every dimension into one integer index, so the strides
    have to be rebuilt from `size` — reading `value` without them silently
    transposes the dataset, which looks like real numbers in the wrong places.
    """
    ids, size = d['id'], d['size']
    inv = {k: {v: kk for kk, v in d['dimension'][k]['category']['index'].items()} for k in ids}
    strides = [1] * len(size)
    for i in range(len(size) - 2, -1, -1):
        strides[i] = strides[i + 1] * size[i + 1]
    at = {k: ids.index(k) for k in ('geo', 'time', 'isco08')}
    for flat, v in d['value'].items():
        f = int(flat)
        yield (
            inv['geo'][(f // strides[at['geo']]) % size[at['geo']]],
            inv['time'][(f // strides[at['time']]) % size[at['time']]],
            inv['isco08'][(f // strides[at['isco08']]) % size[at['isco08']]],
            v,
        )


def main():
    skills_for = matcher(TAX)

    url = DATASET + '?' + urllib.parse.urlencode(QUERY)
    sys.stderr.write(f'Fetching {url}\n')
    d = fetch(url)
    if 'error' in d:
        sys.exit(f'Eurostat refused the request: {d["error"]}')
    labels = d['dimension']['isco08']['category']['label']

    # acc[skill][geo][year] = vacancies
    acc: dict[str, dict[str, dict[int, int]]] = {}
    years: set[int] = set()
    occ_skills: dict[str, list[str]] = {}
    mapped = unmapped = 0

    for geo, time, isco, v in cells(d):
        if geo not in COUNTRIES or not OCC.match(isco):
            continue
        label = labels.get(isco, '')
        if isco not in occ_skills:
            occ_skills[isco] = skills_for(label)
        sk = occ_skills[isco]
        # thousands → vacancies. A rounded-to-zero cell is dropped rather than
        # written as a 0 that would look like a measured absence of demand.
        n = round(float(v) * 1000)
        if n <= 0:
            continue
        year = int(time)
        years.add(year)
        if not sk:
            unmapped += n
            continue
        mapped += n
        for s in sk:
            acc.setdefault(s, {}).setdefault(geo, {})
            acc[s][geo][year] = acc[s][geo].get(year, 0) + n

    if not acc:
        sys.exit('No occupation rows matched — the release shape has moved.')
    ys = sorted(years)
    latest = ys[-1]

    order = sorted(acc, key=lambda s: -sum(cy.get(latest, 0) for cy in acc[s].values()))
    id_of = {k: COUNTRIES[k][0] for k in COUNTRIES}

    L = []
    A = L.append
    A('// GENERATED — do not edit by hand. Run scripts/gen-eu-vacancy-demand.py.')
    A('// Source: Eurostat — Job vacancy statistics by occupation and NUTS 1 region')
    A('// (OJA breakdowns), annual experimental statistics [jvs_a_isco3_r1],')
    A('// indicator JOBVAC (job vacancies), unit THS. Each ISCO-08 3-digit occupation')
    A('// is term-matched to canonical skills via the shared skillsTaxonomy terms and')
    A('// summed per skill, BY COUNTRY (EU/euro-area aggregates and NUTS-1 sub-regions')
    A('// dropped, along with the release\'s custom ICT aggregate whose members are')
    A('// already itemised).')
    A('//')
    A('// THESE ARE PUBLISHED VACANCY COUNTS. Nothing is derived.')
    A('// The previous wiring read the release\'s EMPLOYMENT indicator and converted it')
    A('// with each country\'s economy-wide job vacancy rate r, as employment × r/(1−r).')
    A('// That inversion was correct arithmetic on a wrong premise: the rate is')
    A('// published for NACE B-S, all industries, so applying it to an occupation')
    A('// assumed every occupation in a country was equally short-staffed. The rate is')
    A('// gone from this file entirely.')
    A('//')
    A('// Coverage is 18 member states, which is what it has always been in practice —')
    A('// the other eight countries below appear on the map but publish no occupation')
    A('// breakdown, so they light nothing when a skill is searched.')
    A('//')
    A('// Annual figures are held flat across their calendar year and the latest year is')
    A('// carried forward to "now"; months before the first year are zero.')
    A('')
    A("import { IVI_MONTHS } from './iviSkillDemand';")
    A('')
    A(f'export const EU_YEARS: number[] = {json.dumps(ys)};')
    A("export const EU_SOURCE =")
    A("  'Eurostat — job vacancies by occupation (jvs_a_isco3_r1, annual experimental)';")
    A('')
    A('// Country id → display label and capital [lng, lat] (the marker + heat location).')
    A('export const EU_CITY_LABEL: Record<string, string> = {')
    for k in COUNTRIES:
        A(f'  {COUNTRIES[k][0]}: {json.dumps(COUNTRIES[k][1])},')
    A('};')
    A('export const EU_CITY_LNGLAT: Record<string, [number, number]> = {')
    for k in COUNTRIES:
        lng, lat = COUNTRIES[k][2]
        A(f'  {COUNTRIES[k][0]}: [{lng}, {lat}],')
    A('};')
    A(f'export const EU_CITIES: string[] = {json.dumps([COUNTRIES[k][0] for k in COUNTRIES])};')
    A('')
    A('// Compact source values: skill → country id → [VACANCIES per EU_YEARS].')
    A('// A country absent from a skill publishes no vacancies for any occupation that')
    A('// maps to it — which is not the same as publishing a zero.')
    A('const EU_VACANCIES: Record<string, Record<string, number[]>> = {')
    for s in order:
        parts = []
        for k in COUNTRIES:
            if k in acc[s]:
                arr = [acc[s][k].get(y, 0) for y in ys]
                if any(arr):
                    parts.append(f'{id_of[k]}: [{",".join(map(str, arr))}]')
        if parts:
            A(f'  {json.dumps(s)}: {{ {", ".join(parts)} }},')
    A('};')
    A('')
    A('// Month index → index into EU_YEARS: the most recent published year at or')
    A('// before that month, -1 before the first. Computed once for the axis.')
    A('const YEAR_SLOT: number[] = IVI_MONTHS.map((ym) => {')
    A('  const y = Number(ym.slice(0, 4));')
    A('  let slot = -1;')
    A('  for (let i = 0; i < EU_YEARS.length; i++) if (EU_YEARS[i] <= y) slot = i;')
    A('  return slot;')
    A('});')
    A('')
    A('// Skill → country id → monthly vacancy history (aligned to IVI_MONTHS).')
    A('function expand(byCity: Record<string, number[]>): Record<string, number[]> {')
    A('  const out: Record<string, number[]> = {};')
    A('  for (const [city, vac] of Object.entries(byCity)) {')
    A('    out[city] = YEAR_SLOT.map((yi) => (yi < 0 ? 0 : vac[yi] || 0));')
    A('  }')
    A('  return out;')
    A('}')
    A('')
    A('export const EU_SERIES: Record<string, Record<string, number[]>> =')
    A('  Object.fromEntries(Object.entries(EU_VACANCIES).map(([s, v]) => [s, expand(v)]));')
    A('')
    A('// Skill → latest-month country vacancy count (current heat map).')
    A('export const EU_SKILL_BY_CITY: Record<string, Record<string, number>> =')
    A('  Object.fromEntries(')
    A('    Object.entries(EU_SERIES).map(([s, byCity]) => [')
    A('      s,')
    A('      Object.fromEntries(Object.entries(byCity).map(([c, arr]) => [c, arr[arr.length - 1]])),')
    A('    ]),')
    A('  );')
    A('')
    open(OUT, 'w').write('\n'.join(L))

    reporting = sorted({c for s in acc for c in acc[s]})
    tot = sum(cy.get(latest, 0) for s in acc for cy in acc[s].values())
    pct = 100 * mapped / (mapped + unmapped) if (mapped + unmapped) else 0
    print(f'{len(order)} skills across {len(reporting)} reporting countries, '
          f'{ys[0]}..{ys[-1]}; {pct:.1f}% of published vacancies mapped to a skill; '
          f'{latest} total across skills {tot:,} -> {OUT}')
    silent = [COUNTRIES[k][1] for k in COUNTRIES if k not in reporting]
    if silent:
        print('no occupation breakdown published: ' + ', '.join(silent))


if __name__ == '__main__':
    main()
