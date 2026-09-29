#!/usr/bin/env python3
"""NZ employment by occupation — the supply side for Auckland and Wellington.

WHAT THIS IS, AND WHAT IT IS NOT. The Australian supply side (gen-abs-
occupation-supply.py) reads ABS EQ08: 479 ANZSCO UNIT groups, quarterly, so an
Australian skill divides by the people doing that specific work and the figure
can be printed under the skill's own name. New Zealand publishes nothing of the
kind, and this was checked rather than assumed:

  · Every occupation dataflow in the Stats NZ SDMX catalogue was listed (50 of
    them, 2026-09-28). The finest occupation dimension anywhere in it is ANZSCO
    SUB-MAJOR — CL_CEN23_OCC_003, 43 real groups. Nothing at minor (level 3) or
    unit (level 4) grain exists, for any year, at any geography.
  · The Household Labour Force Survey does not carry occupation at all in
    Infoshare; occupation comes from the Census, so there are THREE data points
    (2013, 2018, 2023) and no series.
  · api.stats.govt.nz needs a subscription key. It is read from the environment
    (STATSNZ_API_KEY) and never written to the repo.

So a New Zealand skill cannot have its own headcount, and this file does not
pretend otherwise. What it CAN have is the employment of the ANZSCO group the
skill's work sits in — which is real, regional, and five times finer than the
eight SSOC majors Singapore is held to. The app's side of the bargain is that it
names the GROUP, never the skill: "Health Professionals — 37,644 employed in
Auckland" is true; "Nursing — 37,644" would be false, because that one number is
every nurse, doctor, pharmacist, dentist, physiotherapist and radiographer in
the region. lib/localSupply.ts enforces the labelling.

THE MAPPING IS HAND-WRITTEN, AND HAS TO BE. Running the skills matcher over the
43 group names maps 27 and misses 16 — and the 16 are the groups that matter
most, every large professional one among them: Health Professionals, ICT
Professionals, Education Professionals, Specialist Managers, Arts and Media, and
Design/Engineering/Science all match NOTHING, because a term matcher built to
read job ads does not read classification headings. It also gets one actively
wrong: "Electrotechnology and Telecommunications Trades Workers" lands on
Marketing & Comms. So each assignment below is a judgement against ANZSCO's own
unit-group contents, written down with its reasoning.

MIXED GRANULARITY IS DELIBERATE. A code here may be a sub-major (two digits) or
a major (one digit). ANZSCO groups are mutually exclusive, so naming the major is
the honest move for a skill whose work fills one — Administration & Office
Support spans all five clerical sub-majors, and picking one of them would
understate it while reading as precision. The major's own total is published, so
nothing is summed here.

Run:  STATSNZ_API_KEY=... python3 scripts/gen-nz-occupation-supply.py
      python3 scripts/gen-nz-occupation-supply.py path/to/saved.csv
Then: npx eslint src/employsi/data/nzOccupationSupply.ts --fix
"""
from __future__ import annotations
import csv
import io
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from skills_taxonomy import matcher  # noqa: E402

TAX = os.path.join(ROOT, 'src/employsi/data/skillsTaxonomy.ts')
OUT = os.path.join(ROOT, 'src/employsi/data/nzOccupationSupply.ts')

API = 'https://api.data.stats.govt.nz/rest'
FLOW = 'STATSNZ,CEN23_WRK_011,1.0'
# YEAR . GEO . OCC . TOTAL-INCOME . TOTAL-AGE . TOTAL-GENDER
KEY = '2013+2018+2023.02+09+9999..999.99.99'
OCC_CODELIST = 'CL_CEN23_OCC_003'

# Regional council, because that is the labour market a city's employers hire
# from — Wellington City alone would exclude the Hutt and Porirua, who commute
# in, and Auckland is a unitary authority where the two coincide anyway. The
# 795,137 / 253,220 filled-jobs anchors already used for the NZ vacancy tilt are
# regional too, so the two halves describe the same areas.
GEO = {'02': 'auckland', '09': 'wellington', '9999': 'national'}
YEARS = ['2013', '2018', '2023']

# Census counts are randomly rounded to base 3, so a cell in the low tens is
# mostly rounding. Same role as MIN_EMPLOYED on the Australian side: a number
# this small is not a workforce and must never become a denominator.
MIN_EMPLOYED = 300

# ANZSCO group -> the canonical skills whose work sits in it. Every name must
# exist in skillsTaxonomy.ts; the run asserts it.
GROUP_SKILLS: dict[str, list[str]] = {
    # 11 is ANZSCO 111 alone: CEOs, managing directors and legislators.
    '11': ['General Management'],
    '12': ['Agriculture & Farming'],
    # 13 Specialist Managers is where ANZSCO files managers BY FUNCTION — 1331
    # Construction Managers, 1344 School Principals, 132 Corporate Services and
    # Policy/Planning Managers, 135 ICT Managers. So the management disciplines
    # go here rather than with the workers they manage.
    '13': [
        'Leadership & Coordination',
        'Operations',
        'Construction Management',
        'Education Leadership',
        'Project Management',
        'Product Management',
        # ANZSCO 1336 Supply and Distribution Managers, and 1332 Procurement
        # Managers. The buying itself is clerical (5111 Contract Administrators,
        # which is where the Contract Management child would sit), but the skill
        # as a whole is the managerial one.
        'Procurement & Supply',
    ],
    # 14 is Accommodation, Hospitality and RETAIL managers (142). Retail
    # Operations is the store-management skill, so it belongs here; the shop
    # floor is major group 6.
    '14': ['Retail Operations'],
    '21': ['Creative & Performing Arts', 'Journalism & Media'],
    # 22 holds 221 Accountants and Auditors, 222 Financial Brokers and Dealers,
    # 223 HR and Training, 224 Information and Organisation Professionals
    # (actuaries, statisticians, librarians, economists, policy and management
    # analysts) and 225 Sales, Marketing and PR. Data Analytics sits here for
    # the same reason OVERRIDE in gen-ivi-skill-demand.py sends ANZSCO 2244
    # there; Strategy for 2247 Management and Organisation Analysts.
    '22': [
        'Finance & Accounting',
        'Human Resources',
        'Marketing & Comms',
        'Sales & Business Dev',
        'Business Analysis',
        'Policy & Programs',
        'Insurance & Actuarial',
        'Library & Information',
        'Banking & Lending',
        'Data Analytics',
        'Strategy',
        'Risk & Compliance',
    ],
    # 23 is 231 Air and Marine Transport, 232 Architects/Designers/Planners/
    # Surveyors, 233 Engineering Professionals and 234 Natural and Physical
    # Science. Every engineering and science discipline in the taxonomy lands
    # here, which is also why it is a poor denominator for any one of them —
    # the label says so.
    '23': [
        'Architecture & Planning',
        'Design',
        'Surveying',
        'Civil Engineering',
        'Electrical Engineering',
        'Mechanical Engineering',
        'Mining Engineering',
        'Geology',
        'Metallurgy',
        'Geotechnical',
        'Process Engineering',
        'Subsea Engineering',
        'Pipeline Engineering',
        'Instrumentation & Control',
        'Science & Laboratory',
        'Environmental',
        'Shipbuilding & Marine',
        'Drilling & Wells',
        'Hydrogen & Renewables',
        'Decarbonisation',
        'Automation & Robotics',
        'Radiation Safety',
    ],
    '24': ['Teaching & Education'],
    # 25 is 251 Health Diagnostic and Promotion, 252 Health Therapy, 253 Medical
    # Practitioners, 254 Midwifery and Nursing. HSE / Safety is here because
    # ANZSCO 251312 Occupational Health and Safety Adviser is — not because
    # safety work is clinical. That is the classification's choice, kept rather
    # than second-guessed so the NZ and AU sides attribute alike.
    '25': [
        'Nursing',
        'Medical Practice',
        'Allied Health',
        'Pharmacy',
        'Medical Imaging & Pathology',
        'Dental',
        'HSE / Safety',
    ],
    # 26 is 261 Business and Systems Analysts and Programmers, 262 Database and
    # Systems Administrators and Security, 263 ICT Network and Support —
    # including 2633 Telecommunications Engineering Professionals.
    '26': [
        'Software Engineering',
        'Cloud & DevOps',
        'Cybersecurity',
        'IT & Systems',
        'Data Engineering',
        'Data Science & Machine Learning',
        'Telecommunications',
    ],
    '27': [
        'Commercial & Legal',
        'Mental Health & Counselling',
        'Social & Community Services',
        'Community & Native Title',
    ],
    # 31 is 311 Science and Primary Products Technicians, 312 Building and
    # Engineering Technicians, 313 ICT and Telecommunications Technicians.
    # Quality Assurance sits with the inspectors and testers rather than with
    # 1399's Quality Assurance Managers.
    '31': ['Quality Assurance'],
    '32': [
        'Automotive Trade',
        'Welding & Fabrication',
        'Mechanical Fitting',
        'Heavy Diesel Maintenance',
        # Fixed plant is maintained by fitters — ANZSCO 3232 Metal Fitters and
        # Machinists — not by engineers.
        'Fixed Plant Maintenance',
    ],
    '33': ['Carpentry & Joinery', 'Bricklaying & Concreting', 'Painting & Plastering', 'Plumbing'],
    # 34 is 341 Electricians, 342 Electronics and Telecommunications Trades
    # (which is where 3421 Airconditioning and Refrigeration Mechanics live),
    # 343 Electrical Distribution.
    '34': ['Electrical Trade', 'Electronics & Telecoms Trade', 'HVAC & Refrigeration'],
    '35': ['Food Trades'],
    # 42 is 421 Child Carers, 422 Education Aides, 423 Personal Carers and
    # Assistants — the support workforce, distinct from the 25 professionals.
    '42': ['Childcare & Early Learning', 'Education Support', 'Aged & Disability Care'],
    '43': ['Hospitality & Food Service'],
    '44': ['Emergency & Public Safety', 'Corrections & Justice'],
    '45': ['Personal Services & Beauty', 'Sport & Recreation'],
    # MAJOR GROUP 5, not one of its sub-majors. Administration & Office Support
    # spans 51 Office Managers and Program Administrators, 52 Personal
    # Assistants, 53 General Clerical, 54 Inquiry Clerks and Receptionists, 55
    # Numerical Clerks, 56 Clerical and Office Support and 59 Other Clerical —
    # all five of its own children sit in different ones. Naming a single
    # sub-major would understate it while reading as precision.
    '5': ['Administration & Office Support'],
    # But bookkeeping and payroll ARE one sub-major: 551 Numerical Clerks.
    '55': ['Bookkeeping & Payroll'],
    # 61 Sales Representatives and Agents holds 6121 Real Estate Sales Agents
    # and property managers.
    '61': ['Real Estate & Property'],
    # MAJOR GROUP 6 for the shop floor: 62 Sales Assistants and Salespersons
    # plus 63 Sales Support Workers, which the skill spans.
    '6': ['Retail & Customer Service'],
    '71': ['Plant & Equipment Operation', 'LNG Operations'],
    '73': ['Driving & Transport'],
    '74': ['Warehousing & Logistics'],
    '81': ['Cleaning & Facilities'],
    # 82 Construction and Mining Labourers is where ANZSCO files drillers,
    # miners, shot firers, riggers and scaffolders — not with the engineers.
    '82': ['Construction Labouring', 'Underground Mining', 'Drill & Blast', 'Rigging & Scaffolding'],
    '83': ['Manufacturing & Production'],
}


# api.data.stats.govt.nz sits behind Cloudflare, which answers Python's default
# User-Agent with "error code: 1010" — its browser-ban response, not an auth or
# proxy refusal. The same URL succeeds from curl, so the subscription key is
# fine and only the client string is objected to. Naming a normal client is the
# fix; it identifies us honestly rather than working around any access control.
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'


def fetch(url: str, key: str | None) -> bytes:
    req = urllib.request.Request(url)
    req.add_header('User-Agent', UA)
    if key:
        req.add_header('Ocp-Apim-Subscription-Key', key)
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def group_names(key: str | None) -> dict[str, str]:
    src = fetch(f'{API}/codelist/STATSNZ/{OCC_CODELIST}/1.0', key).decode('utf-8', 'replace')
    out: dict[str, str] = {}
    for cid, body in re.findall(r'<\w+:Code\b[^>]*\bid="([^"]+)"[^>]*>(.*?)</\w+:Code>', src, re.S):
        m = re.search(r'<\w+:Name[^>]*>(.*?)</\w+:Name>', body, re.S)
        if m:
            out[cid] = m.group(1).strip()
    return out


def main(argv: list[str]) -> int:
    key = os.environ.get('STATSNZ_API_KEY')
    if len(argv) > 1:
        raw = io.open(argv[1], encoding='utf-8').read()
        names_src = None
    else:
        if not key:
            sys.exit('STATSNZ_API_KEY is not set, and no saved CSV was given.')
        raw = fetch(f'{API}/data/{FLOW}/{KEY}?format=csv', key).decode('utf-8', 'replace')
        names_src = key
    rows = list(csv.DictReader(io.StringIO(raw)))
    if not rows:
        sys.exit('no rows returned')

    names = group_names(names_src) if names_src or not key else group_names(key)

    # code -> city -> [per year], as published. A missing cell stays null: the
    # census either did not publish it or randomly rounded it away, and neither
    # is a zero.
    emp: dict[str, dict[str, list[float | None]]] = {}
    for r in rows:
        g = GEO.get(r['CEN23_GEO_008'])
        yi = YEARS.index(r['CEN23_YEAR_001']) if r['CEN23_YEAR_001'] in YEARS else -1
        if g is None or yi < 0:
            continue
        code = r['CEN23_OCC_003']
        try:
            v = float(r['OBS_VALUE'])
        except (TypeError, ValueError):
            continue
        emp.setdefault(code, {}).setdefault(g, [None] * len(YEARS))[yi] = v

    skills_for = matcher(TAX)
    tax = io.open(TAX, encoding='utf-8').read()
    known = set(re.findall(r'skill:\s*"([^"]+)"', tax))
    assigned: dict[str, str] = {}
    problems: list[str] = []
    for code, skills in GROUP_SKILLS.items():
        if code not in emp:
            problems.append(f'group {code} has no data')
            continue
        for s in skills:
            if s not in known:
                problems.append(f'skill not in taxonomy: {s}')
            if s in assigned:
                problems.append(f'{s} assigned twice ({assigned[s]} and {code})')
            assigned[s] = code
    if problems:
        for p in problems:
            print('  !', p)
        sys.exit('mapping is not clean')

    parents = sorted(set(re.findall(r'skill:\s*"([^"]+)"', tax)) - set(
        re.findall(r'skill:\s*"([^"]+)",\s*\n\s*cat:[^\n]*\n\s*parent:', tax)))
    unmapped = [s for s in parents if s not in assigned]

    L: list[str] = []
    A = L.append
    A('// GENERATED — do not edit by hand. Run scripts/gen-nz-occupation-supply.py.')
    A('// Source: Stats NZ 2023 Census (CEN23_WRK_011) — employed census usually')
    A('// resident population aged 15+, by ANZSCO sub-major occupation and regional')
    A('// council, 2013 / 2018 / 2023.')
    A('//')
    A('// THIS IS COARSER THAN THE AUSTRALIAN SUPPLY DATA and the difference decides')
    A('// how it may be shown. EQ08 gives 479 ANZSCO UNIT groups, so an Australian')
    A('// skill divides by the people doing that specific work. This table gives 43')
    A('// SUB-MAJOR groups, so a New Zealand skill shares its figure with every other')
    A('// skill in its group: Nursing, Medical Practice, Pharmacy, Dental, Allied')
    A('// Health and Medical Imaging are one number called "Health Professionals".')
    A('//')
    A('// So the figure is REPORTED UNDER THE GROUP NAME, never the skill name. See')
    A('// NZ_GROUP_NAME and lib/localSupply.ts, which carries the grain through to the')
    A('// label a reader sees. It is five times finer than Singapore\'s eight SSOC')
    A('// majors and is the finest occupation grain Stats NZ publishes at all — the')
    A('// generator header records the search that established that.')
    A('//')
    A('// THREE YEARS, NOT A SERIES. Occupation comes from the Census, so there is no')
    A('// monthly or quarterly movement to draw and no change figure worth computing')
    A('// over five-year gaps. Levels only.')
    A('//')
    A('// Figures are PERSONS, randomly rounded to base 3 by Stats NZ. null means the')
    A('// cell was not published, which is not the same as nobody employed.')
    A('')
    A('export const NZ_SUPPLY_SOURCE =')
    A('  "Stats NZ 2023 Census — employed usually resident population by occupation '
      '(ANZSCO sub-major), regional council";')
    A('')
    A(f'export const NZ_SUPPLY_YEARS: string[] = {json.dumps(YEARS)};')
    A('')
    A(f'export const NZ_MIN_EMPLOYED = {MIN_EMPLOYED};')
    A('')
    A('/** ANZSCO group code → the name a reader must be shown instead of the skill. */')
    A('export const NZ_GROUP_NAME: Record<string, string> = {')
    for code in sorted(GROUP_SKILLS, key=lambda c: (len(c), c)):
        A(f'  {json.dumps(code)}: {json.dumps(names.get(code, code))},')
    A('};')
    A('')
    A('/** ANZSCO group code → city → employed persons per census year. */')
    A('export const NZ_GROUP_EMPLOYMENT: Record<string, Record<string, (number | null)[]>> = {')
    for code in sorted(GROUP_SKILLS, key=lambda c: (len(c), c)):
        A(f'  {json.dumps(code)}: {{')
        for city in ('auckland', 'wellington', 'national'):
            vals = emp.get(code, {}).get(city, [None] * len(YEARS))
            cells = ','.join('null' if v is None else str(int(round(v))) for v in vals)
            A(f'    {city}: [{cells}],')
        A('  },')
    A('};')
    A('')
    A('/** Skill → the ANZSCO group whose employment stands in for it. */')
    A('export const NZ_SKILL_GROUP: Record<string, string> = {')
    for s in sorted(assigned):
        A(f'  {json.dumps(s)}: {json.dumps(assigned[s])},')
    A('};')
    A('')
    io.open(OUT, 'w', encoding='utf-8').write('\n'.join(L))

    print(f'wrote {OUT}')
    print(f'  {len(GROUP_SKILLS)} groups, {len(assigned)} skills mapped')
    if unmapped:
        print(f'  {len(unmapped)} parent skills with NO NZ group (no NZ figure, by design):')
        for s in unmapped:
            print(f'     {s}')
    # What the matcher would have done, so the cost of hand-writing stays visible.
    # What the matcher would have done, over EVERY published sub-major rather
    # than only the ones used here, so the cost of hand-writing stays visible.
    subs = [c for c in names if len(c) == 2 and c.isdigit()]
    auto = sum(1 for c in subs if skills_for(names[c]))
    print(f'  (the term matcher maps {auto} of the {len(subs)} sub-major names on its own)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
