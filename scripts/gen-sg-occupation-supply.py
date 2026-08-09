#!/usr/bin/env python3
"""Regenerate src/employsi/data/sgOccupationSupply.ts from SingStat M182081 —
employed residents aged 15+ by industry and occupation (MOM / DOS, annual, June).

READ THIS BEFORE TRUSTING THE NUMBERS IT PRODUCES
This is the supply side for Singapore, and it is MUCH COARSER than Australia's.
EQ08 gives 478 ANZSCO unit groups, so an Australian skill's denominator is the
people doing that specific work — mining engineers under Mining Engineering.
M182081 gives EIGHT SSOC major groups:

    Managers & Administrators · Professionals · Associate Professionals &
    Technicians · Clerical Support Workers · Service & Sales Workers ·
    Craftsmen & Related Trades · Plant & Machine Operators · Cleaners &
    Labourers

So a Singapore skill's denominator is the whole major group its work sits in.
Software Engineering, Medical Practice and Legal all divide by "Professionals"
— 624,400 people. WHAT THAT MEANS FOR THE RATE, stated plainly rather than
buried: the reweighting is real ACROSS groups and absent WITHIN them. Craftsmen
(51,600) versus Service & Sales (247,000) is a genuine four-fold correction to
the volume ranking. Two professional skills keep exactly the volume ordering
they already had, because they share a denominator.

That is worth shipping and it is not the same product as the Australian rate.
The app labels it accordingly and vacancyRate.ts refuses to blend the two.

THE MAPPING IS HAND-WRITTEN, AND HAS TO BE
Running the skills matcher over the eight group names maps three and gets one
wrong: "Managers & Administrators" contains "administrat" and lands on
Administration & Office Support, which is the clerical skill, not management.
Five map to nothing at all. A term matcher is built to read job titles, and
these are classification headings. So the assignment below is a judgement,
written down per group with its reasoning, rather than a lookup that would be
quietly wrong in ways nobody would see.

Run:  python3 scripts/gen-sg-occupation-supply.py path/to/M182081.csv
Then: npx eslint src/employsi/data/sgOccupationSupply.ts --fix
"""
from __future__ import annotations
import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'src/employsi/data/sgOccupationSupply.ts')
SG_DEMAND = os.path.join(ROOT, 'src/employsi/data/sgVacancyDemand.ts')

# SSOC major group -> the canonical skills whose work sits in it.
#
# Every name here must exist in skillsTaxonomy.ts; the run asserts it. The
# groups are ILO ISCO-88 majors under Singapore's naming, so the assignment
# follows the classification's own definitions rather than intuition:
#
#   Managers        ISCO 1 — legislators, senior officials and managers.
#   Professionals   ISCO 2 — occupations normally requiring a degree.
#   Associate Prof  ISCO 3 — technicians and associate professionals, which is
#                   where trades-adjacent technical work and most para-professional
#                   health, finance and IT support roles sit.
#   Clerical        ISCO 4 — clerks.
#   Service & Sales ISCO 5 — service workers, shop and market sales.
#   Craftsmen       ISCO 7 — craft and related trades.
#   Plant & Machine ISCO 8 — plant and machine operators and assemblers.
#   Cleaners        ISCO 9 — elementary occupations.
GROUP_SKILLS: dict[str, list[str]] = {
    'Managers & Administrators (Including Working Proprietors)': [
        'General Management', 'Leadership & Coordination', 'Operations', 'Project Management',
        'Construction Management', 'Human Resources', 'Procurement & Supply',
        'Sales & Business Dev', 'Product Management', 'Retail Operations',
        'Real Estate & Property', 'Education Leadership',
    ],
    'Professionals': [
        'Software Engineering', 'Cloud & DevOps', 'Data Analytics', 'Data Engineering',
        'Data Science & Machine Learning', 'IT & Systems', 'Cybersecurity',
        'Telecommunications', 'Medical Practice', 'Pharmacy', 'Mental Health & Counselling',
        'Commercial & Legal', 'Finance & Accounting', 'Insurance & Actuarial',
        'Risk & Compliance', 'Business Analysis', 'Teaching & Education',
        'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering',
        'Process Engineering', 'Pipeline Engineering', 'Subsea Engineering',
        'Mining Engineering', 'Metallurgy', 'Geology', 'Geotechnical', 'Surveying',
        'Architecture & Planning', 'Science & Laboratory', 'Environmental',
        'Decarbonisation', 'Hydrogen & Renewables', 'Radiation Safety',
        'Marketing & Comms', 'Journalism & Media', 'Creative & Performing Arts',
        'Library & Information', 'Policy & Programs', 'Social & Community Services',
        'Community & Native Title',
    ],
    'Associate Professionals & Technicians': [
        'Nursing', 'Allied Health', 'Dental', 'Medical Imaging & Pathology',
        'Quality Assurance', 'HSE / Safety', 'Banking & Lending', 'Bookkeeping & Payroll',
        'Design', 'Shipbuilding & Marine', 'Automation & Robotics',
        'Instrumentation & Control', 'Education Support', 'Emergency & Public Safety',
        'Corrections & Justice', 'Sport & Recreation', 'LNG Operations', 'Drilling & Wells',
    ],
    'Clerical Support Workers': ['Administration & Office Support'],
    'Service & Sales Workers': [
        'Retail & Customer Service', 'Hospitality & Food Service', 'Aged & Disability Care',
        'Childcare & Early Learning', 'Personal Services & Beauty',
    ],
    'Craftsmen & Related Trades Workers': [
        'Electrical Trade', 'Electronics & Telecoms Trade', 'Mechanical Fitting',
        'Heavy Diesel Maintenance', 'Welding & Fabrication', 'Automotive Trade',
        'Carpentry & Joinery', 'Plumbing', 'Bricklaying & Concreting',
        'Painting & Plastering', 'HVAC & Refrigeration', 'Rigging & Scaffolding',
        'Food Trades',
    ],
    'Plant & Machine Operators & Assemblers': [
        'Manufacturing & Production', 'Fixed Plant Maintenance', 'Plant & Equipment Operation',
        'Driving & Transport', 'Warehousing & Logistics', 'Underground Mining', 'Drill & Blast',
    ],
    'Cleaners, Labourers & Related Workers': [
        'Cleaning & Facilities', 'Construction Labouring', 'Agriculture & Farming',
    ],
}


def taxonomy_skills() -> set[str]:
    sys.path.insert(0, HERE)
    from skills_taxonomy import load_skills  # noqa: PLC0415
    return {n for n, _ in load_skills(os.path.join(ROOT, 'src/employsi/data/skillsTaxonomy.ts'))}


def sg_demand_skills() -> list[str]:
    """The skills the Singapore vacancy series actually carries."""
    try:
        txt = open(SG_DEMAND, encoding='utf-8').read()
    except OSError:
        return []
    return sorted(set(re.findall(r'^  "([^"]+)":', txt, re.M)))


def main(path: str) -> int:
    known = taxonomy_skills()
    unknown = sorted({s for v in GROUP_SKILLS.values() for s in v} - known)
    unassigned = sorted(known - {s for v in GROUP_SKILLS.values() for s in v})
    if unknown:
        sys.exit('GROUP_SKILLS names skills that are not in the taxonomy — a typo here '
                 'silently gives a skill no denominator:\n  ' + '\n  '.join(unknown))

    if unassigned:
        # Not fatal: a skill with no Singapore group simply gets no SG rate, and
        # saying which ones is more useful than pretending the map is total.
        print(f'{len(unassigned)} taxonomy skills have no SSOC group (no SG rate): '
              + ', '.join(unassigned))

    rows = list(csv.reader(open(path, encoding='utf-8-sig')))
    hdr = next(i for i, r in enumerate(rows) if r and r[0].strip() == 'Data Series')
    years = [y.strip() for y in rows[hdr][1:] if y.strip()]

    # Only the TOP-LEVEL rows are occupation groups; everything indented beneath
    # one is that group's industry split and would double-count.
    totals: dict[str, list[float]] = {}
    for r in rows[hdr + 1:]:
        if not r or not r[0] or r[0][0] == ' ':
            continue
        label = r[0].strip()
        if label not in GROUP_SKILLS:
            continue
        vals = []
        for cell in r[1:1 + len(years)]:
            c = (cell or '').strip()
            # 'na' is a real value in this table: SingStat publishes it where the
            # older surveys could not be mapped to SSOC 2020. Kept as null rather
            # than zeroed — a year with no measurement is not a year with no
            # workers, and zero would divide a vacancy count into a spike.
            vals.append(float(c) * 1000 if re.fullmatch(r'-?[\d.]+', c) else None)
        totals[label] = vals

    missing = sorted(set(GROUP_SKILLS) - set(totals))
    if missing:
        sys.exit(f'these occupation groups were not found in the CSV: {missing}')

    # skill -> per-year employed persons, from the group it belongs to.
    per_skill: dict[str, list] = {}
    for group, skills in GROUP_SKILLS.items():
        for s in skills:
            per_skill[s] = totals[group]

    L = ['// GENERATED — do not edit by hand. Run scripts/gen-sg-occupation-supply.py.',
         '// Source: SingStat M182081 (MOM / DOS) — employed residents aged 15+ by',
         f'// occupation, annual (June), {years[-1]}–{years[0]}.',
         '//',
         '// THIS IS COARSER THAN THE AUSTRALIAN SUPPLY DATA and the difference matters.',
         '// EQ08 gives 478 ANZSCO unit groups, so an Australian skill divides by the',
         '// people doing that specific work. This table gives EIGHT SSOC major groups, so',
         '// a Singapore skill divides by its whole major group: Software Engineering,',
         '// Medical Practice and Legal all share "Professionals".',
         '//',
         '// The consequence, stated rather than buried: the reweighting is real ACROSS',
         '// groups — Craftsmen at ~52k against Service & Sales at ~247k is a four-fold',
         '// correction to a volume ranking — and ABSENT WITHIN them, where two skills',
         '// sharing a denominator keep exactly the order their vacancy counts gave them.',
         '//',
         '// Figures are PERSONS (the source publishes thousands). null means the source',
         "// published 'na' for that year: not measured, which is not the same as nobody",
         '// employed, and must never become a zero denominator.',
         '',
         "export const SG_SUPPLY_SOURCE =",
         "  'SingStat M182081 (MOM / DOS) — employed residents by occupation, SSOC major groups';",
         '',
         '// Newest first, matching the source table.',
         'export const SG_SUPPLY_YEARS: string[] = ' + json.dumps(years) + ';',
         '',
         '/** SSOC major group → employed persons per year. */',
         'export const SG_GROUP_EMPLOYMENT: Record<string, (number | null)[]> = {']
    for g in GROUP_SKILLS:
        vals = ','.join('null' if v is None else str(round(v)) for v in totals[g])
        L.append(f'  {json.dumps(g)}: [{vals}],')
    L.append('};')
    L.append('')
    L.append('/** Skill → the SSOC major group whose employment is its denominator. */')
    L.append('export const SG_SKILL_GROUP: Record<string, string> = {')
    for g, skills in GROUP_SKILLS.items():
        for s in sorted(skills):
            L.append(f'  {json.dumps(s)}: {json.dumps(g)},')
    L.append('};')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))

    demand = sg_demand_skills()
    covered = [s for s in demand if s in per_skill]
    uncovered = [s for s in demand if s not in per_skill]
    print(f'{len(totals)} occupation groups · {len(years)} years ({years[-1]}..{years[0]}) '
          f'· {len(per_skill)} skills mapped -> {OUT}')
    print(f'  latest year {years[0]}: ' + ', '.join(
        f'{g.split(" (")[0].split(" &")[0]} {totals[g][0]:,.0f}' for g in GROUP_SKILLS))
    print(f'  SG vacancy series carries {len(demand)} skills; {len(covered)} have a denominator.')
    if uncovered:
        print(f'  {len(uncovered)} have SG demand but no group — no rate can be formed:')
        for s in uncovered:
            print(f'    {s}')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-sg-occupation-supply.py path/to/M182081.csv')
    raise SystemExit(main(sys.argv[1]))
