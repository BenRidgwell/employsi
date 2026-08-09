#!/usr/bin/env python3
"""Regenerate src/employsi/data/absOccupationSupply.ts from ABS Labour Force
EQ08 — employed persons by ANZSCO4 occupation, state and sex.

WHY THIS EXISTS
Every demand number in this app is a COUNT of vacancies. A count answers "where
are the most job ads", which is not the same question as "where is labour
tightest", and for large occupations it is actively misleading: Retail &
Customer Service posts more vacancies than any engineering discipline in the
country, and that is a fact about how many retail workers there are and how
often they change jobs, not about scarcity. Dividing by the number of people
already doing the work turns a volume into a RATE, which down-weights big
churn-heavy occupations and up-weights small tight ones.

    vacancy rate = internet vacancies / employed persons

THE ONE THING THAT MAKES THE RATIO VALID
The numerator and the denominator have to be built by the SAME attribution, or
the ratio is two different questions divided by each other. So this file does
not invent a mapping: it imports OVERRIDE and the shared taxonomy matcher from
gen-ivi-skill-demand.py and maps each ANZSCO4 occupation exactly as the IVI
generator maps it. If that mapping changes, both sides move together.

A consequence worth stating plainly, because the totals look wrong otherwise:
an occupation that maps to two skills is added to BOTH, in the numerator and in
the denominator alike. Summing employment across skills therefore exceeds the
workforce, and is not meant to be read as a share of it. The ratio per skill is
what is coherent; the column total is not a population.

WHAT IS DELIBERATELY DROPPED
ABS publishes 'nfd' rows ("Managers nfd", "Chief Executives, General Managers
and Legislators nfd") for people whose occupation was only reported at a coarser
level. They are real employment but they belong to no unit group, so they cannot
be attributed to a skill without guessing. They are excluded from attribution
and their size is REPORTED at the end of the run rather than quietly absorbed —
if that share ever grows, every rate here is quietly overstated.

FREQUENCY, AND WHY NOTHING IS INTERPOLATED
EQ08 is quarterly (the mid-quarter months Feb/May/Aug/Nov); the IVI is monthly.
This writes the quarters as measured and lets the app resolve a month to the
quarter containing it. Interpolating employment onto twelve months a year would
produce a smoother line made mostly of numbers nobody measured, and the whole
point of the rate is that its denominator is real.

The 2006 cut is the caller's: EQ08 starts in 1998, the IVI in March 2006, and a
rate can only exist where both sides do.

Run:  python3 scripts/gen-abs-occupation-supply.py path/to/EQ08.xlsx
Then: npx eslint src/employsi/data/absOccupationSupply.ts --fix
Needs: pip install openpyxl
"""
from __future__ import annotations
import importlib.util
import json
import os
import re
import sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from skills_taxonomy import matcher  # noqa: E402

TAX = os.path.join(ROOT, 'src/employsi/data/skillsTaxonomy.ts')
OUT = os.path.join(ROOT, 'src/employsi/data/absOccupationSupply.ts')
IVI_TS = os.path.join(ROOT, 'src/employsi/data/iviSkillDemand.ts')
SHEET = 'Data 1'
FROM_YEAR = 2006

# ABS spells the states out; the IVI uses codes. Both land on the same hub, and
# the hub list is copied from gen-ivi-skill-demand so the two files cannot drift
# into disagreeing about which city a state's workers belong to.
STATE2CITY = {
    'New South Wales': 'sydney', 'Victoria': 'melbourne', 'Queensland': 'brisbane',
    'South Australia': 'adelaide', 'Western Australia': 'perth',
    'Northern Territory': 'darwin', 'Australian Capital Territory': 'canberra',
    'Tasmania': 'hobart',
}
CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney', 'darwin', 'canberra', 'hobart']


def load_override() -> dict:
    """OVERRIDE from the IVI generator, by path — the filename has hyphens, so
    it cannot be imported by name. Sharing it is the point: those entries encode
    decisions like '3231 Aircraft Maintenance Engineers is not fixed-plant
    maintenance', and a supply side that disagreed would divide one
    classification by a different one."""
    path = os.path.join(HERE, 'gen-ivi-skill-demand.py')
    spec = importlib.util.spec_from_file_location('gen_ivi', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.OVERRIDE


def ivi_skills() -> list[str]:
    """The skills the IVI actually carries, read from the generated file, so the
    coverage report can name any skill that has demand but no supply."""
    try:
        txt = open(IVI_TS, encoding='utf-8').read()
    except OSError:
        return []
    m = re.search(r'IVI_SKILLS: string\[\] = \[(.*?)\];', txt, re.S)
    return re.findall(r'"([^"]+)"', m.group(1)) if m else []


def main(path: str) -> int:
    skills_for = matcher(TAX)
    override = load_override()

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[SHEET]
    it = ws.iter_rows(values_only=True)
    next(it)

    # quarter label -> index, built from what the file actually contains rather
    # than from an assumed Feb/May/Aug/Nov calendar.
    quarters: list[str] = []
    qindex: dict[str, int] = {}
    # series[skill][state] = [persons per quarter]
    series: dict[str, dict[str, list[float]]] = {}
    code_skills: dict[str, list[str]] = {}
    total_emp = attributed = nfd_emp = unmapped_emp = 0.0
    unmapped: dict[str, float] = {}
    seen_codes: set[str] = set()

    rows = 0
    for r in it:
        when, sex, state, occ, emp = r[0], r[1], r[2], r[3], r[4]
        if when is None or state not in STATE2CITY:
            continue
        if when.year < FROM_YEAR:
            continue
        rows += 1
        label = f'{when.year}-{when.month:02d}'
        if label not in qindex:
            qindex[label] = len(quarters)
            quarters.append(label)
        qi = qindex[label]

        # EQ08 is in thousands. The vacancy counts this divides into are whole
        # people, so the denominator is converted once, here, rather than in the
        # app where a reader would have to know the unit.
        persons = (float(emp) if emp is not None else 0.0) * 1000.0
        total_emp += persons

        text = (occ or '').strip()
        m = re.match(r'^(\d{4})\s+(.*)$', text)
        if not m:
            continue
        code, title = m.group(1), m.group(2)
        seen_codes.add(code)
        # 'nfd' = not further defined: real workers, no unit group. Attributing
        # them would be a guess, so they are counted and named instead.
        if title.lower().endswith('nfd'):
            nfd_emp += persons
            continue
        if code not in code_skills:
            code_skills[code] = override.get(code) or skills_for(title)
        sk = code_skills[code]
        if not sk:
            unmapped_emp += persons
            unmapped[f'{code} {title}'] = unmapped.get(f'{code} {title}', 0.0) + persons
            continue
        attributed += persons
        for s in sk:
            per_state = series.setdefault(s, {})
            arr = per_state.get(state)
            if arr is None:
                arr = [0.0] * 400
                per_state[state] = arr
            arr[qi] += persons

    nq = len(quarters)
    for s in series:
        for st in series[s]:
            series[s][st] = [round(v) for v in series[s][st][:nq]]

    # National is the sum of the eight states and territories: EQ08 publishes no
    # AUST row, unlike the IVI file, so it is built rather than read.
    national = {s: [sum(series[s].get(st, [0] * nq)[i] for st in STATE2CITY) for i in range(nq)]
                for s in series}
    order = sorted(series, key=lambda s: -national[s][-1])

    L = ['// GENERATED — do not edit by hand. Run scripts/gen-abs-occupation-supply.py.',
         '// Source: ABS Labour Force, Australia, Detailed (EQ08) — employed persons by',
         f'// ANZSCO4 occupation, state and sex, quarterly, {quarters[0]} to {quarters[-1]}.',
         '//',
         '// This is the SUPPLY side of the vacancy rate: how many people already do the',
         '// work, so a vacancy count can become a rate rather than a volume. Occupations',
         '// are mapped to skills with the SAME OVERRIDE and taxonomy matcher the IVI',
         '// generator uses — the ratio is only meaningful if both halves are attributed',
         '// identically.',
         '//',
         '// An occupation that maps to two skills is counted in BOTH, exactly as its',
         '// vacancies are. Per-skill ratios are therefore coherent, but summing employment',
         '// across skills exceeds the workforce and is not a share of it.',
         '//',
         "// Figures are PERSONS (ABS publishes thousands; converted here so the app never",
         '// has to know the unit). Quarterly as measured — nothing is interpolated onto the',
         "// IVI's monthly grid, because the point of a rate is that its denominator is real.",
         '',
         "export const ABS_SOURCE =",
         "  'ABS Labour Force, Australia, Detailed (EQ08) — employed persons by occupation';",
         '',
         '// Mid-quarter month labels (YYYY-MM) indexing the series below, oldest first.',
         'export const ABS_QUARTERS: string[] = ' + json.dumps(quarters) + ';',
         '',
         '// Skill → AU capital-city hub → employed persons per quarter.',
         'export const ABS_EMPLOYMENT: Record<string, Record<string, number[]>> = {']
    for s in order:
        L.append(f'  {json.dumps(s)}: {{')
        for st, city in STATE2CITY.items():
            L.append(f'    {city}: [{",".join(map(str, series[s].get(st, [0] * nq)))}],')
        L.append('  },')
    L.append('};')
    L.append('')
    L.append('// Skill → national employed persons per quarter (the eight states summed;')
    L.append('// EQ08 publishes no AUST row).')
    L.append('export const ABS_EMPLOYMENT_NATIONAL: Record<string, number[]> = {')
    for s in order:
        L.append(f'  {json.dumps(s)}: [{",".join(map(str, national[s]))}],')
    L.append('};')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))

    pct = 100 * attributed / total_emp if total_emp else 0
    print(f'{rows} rows from {FROM_YEAR} · {nq} quarters {quarters[0]}..{quarters[-1]} · '
          f'{len(order)} skills -> {OUT}')
    print(f'  employed (latest quarter, all states): {total_emp / nq:,.0f} averaged per quarter')
    print(f'  attributed to a skill: {pct:.1f}%  ·  nfd (no unit group): '
          f'{100 * nfd_emp / total_emp:.1f}%  ·  mapped to no skill: '
          f'{100 * unmapped_emp / total_emp:.1f}%')
    top = sorted(unmapped.items(), key=lambda kv: -kv[1])[:8]
    for name, v in top:
        print(f'    unmapped {name}: {v / nq:,.0f}')
    have = set(series)
    missing = [s for s in ivi_skills() if s not in have]
    if missing:
        print(f'  {len(missing)} skills have IVI demand but no ABS employment — a rate '
              f'cannot be formed for them: {", ".join(missing[:12])}')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-abs-occupation-supply.py path/to/EQ08.xlsx')
    raise SystemExit(main(sys.argv[1]))
