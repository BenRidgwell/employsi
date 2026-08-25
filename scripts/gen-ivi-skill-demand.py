#!/usr/bin/env python3
"""Regenerate src/employsi/data/iviSkillDemand.ts from a Jobs and Skills
Australia Internet Vacancy Index (IVI) spreadsheet.

Monthly refresh:
  1. Download the latest "IVI — ANZSCO4 Occupations by States and Territories"
     .xlsx from https://www.jobsandskills.gov.au/data/internet-vacancy-index
     (the site sits behind Akamai and drops non-Australian requests without
     replying — plain curl just times out. Fetch it through Oxylabs with
     geo='Australia' and extra={'content_encoding': 'base64'}, which is how
     scripts/oxylabs_client.py returns a binary body intact. MBIE's New Zealand
     workbook is the same story behind Incapsula.)
  2. python3 scripts/gen-ivi-skill-demand.py path/to/ivi.xlsx
  3. Typecheck + build + deploy.

Each ANZSCO4 occupation's latest-month vacancy count is mapped to canonical
skills using the SAME term list as the live jobs pipeline (skillsTaxonomy.ts),
so the IVI and the Adzuna/Jooble feeds stay in one shared skill vocabulary.
State totals are attributed to that state's capital-city hub; the national
figure is the true AUST total. Requires: pip install openpyxl
"""
import json, re, sys
import openpyxl

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from skills_taxonomy import load_skills, matcher  # noqa: E402

ROOT = __file__.rsplit('/scripts/', 1)[0]
TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'
OUT = f'{ROOT}/src/employsi/data/iviSkillDemand.ts'
SHEET = '4 digit 3 month average'
# NT→Darwin and ACT→Canberra are included so those two capital hubs get real IVI
# demand + history like the other five (JSA publishes all states/territories).
STATE2CITY = {'NSW': 'sydney', 'VIC': 'melbourne', 'QLD': 'brisbane', 'SA': 'adelaide',
              'WA': 'perth', 'NT': 'darwin', 'ACT': 'canberra', 'TAS': 'hobart'}
CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney', 'darwin', 'canberra', 'hobart']

# Curated overrides for ANZSCO codes the title term-matcher misses, or reads
# wrongly. Pure "Other Miscellaneous Labourers/Technicians" catch-alls are
# intentionally left unmapped (no single defensible skill). An override REPLACES
# term matching for that code, so it must list every skill the code should carry.
OVERRIDE = {
    # 3231 Aircraft Maintenance Engineers is a term-matcher false positive, not
    # a miss: "maintenance engineer" belongs to Fixed Plant Maintenance, which
    # is a MINING skill (fixed plant is the processing plant at a mine site).
    # Left alone the whole occupation lands there, and the AU series then
    # reports fixed-plant maintenance demand that is entirely aircraft
    # engineers. The term itself stays as it is — it is right for job ads,
    # where "Maintenance Engineer" at a mine is exactly this skill — so the
    # correction is made here, against the one classification title that
    # collides with it. Shipbuilding & Marine already claims "aircraft
    # maintenance" deliberately, so that is where the occupation goes.
    '3231': ['Shipbuilding & Marine'],
    # 8112 "Cleaner - commercial" is the same shape of collision and a much
    # bigger one: 136,859 Australians, matching Commercial & Legal on the bare
    # term "commercial" and landing commercial cleaners among the lawyers. Like
    # 3231 the term is right for job ads — "Commercial Manager" and "Commercial
    # Analyst" belong to that skill — so the correction is made here against the
    # one classification title that collides with it.
    #
    # Found through the NZ baseline, which is what makes it worth recording:
    # rolled up to ANZSCO sub-major, this single code made Commercial & Legal
    # claim 51% of "81 Cleaners and Laundry Workers", so New Zealand's figure
    # for the skill was half the median of the country's cleaners. It read as a
    # 259% rise between 2018 and 2023. At four digits the same error is diluted
    # across hundreds of codes and shows up as nothing at all.
    '8112': ['Cleaning & Facilities'],
    '5212': ['Administration & Office Support'], '2247': ['General Management'],
    '2244': ['Data Analytics'], '1493': ['Marketing & Comms'], '1494': ['Warehousing & Logistics'],
    '1343': ['Teaching & Education'], '1325': ['General Management'], '1344': ['Teaching & Education'],
    '2311': ['Driving & Transport'], '2246': ['Administration & Office Support'],
    '2242': ['Administration & Office Support'], '2349': ['Science & Laboratory'],
    '2722': ['Social & Community Services'], '2334': ['Electrical Engineering'],
    '2522': ['Allied Health'], '1334': ['Manufacturing & Production'],
    '5997': ['Administration & Office Support'], '2519': ['Allied Health'],
    '2331': ['Process Engineering'], '8512': ['Hospitality & Food Service'],
    '3994': ['Design'], '2252': ['Sales & Business Dev'], '3932': ['Manufacturing & Production'],
    '3129': ['Civil Engineering'], '2249': ['Data Analytics'], '5999': ['Administration & Office Support'],
    '5619': ['Administration & Office Support'], '2339': ['Mechanical Engineering'],
    '3923': ['Manufacturing & Production'], '8995': ['Manufacturing & Production'], '3921': ['Manufacturing & Production'],
    '3621': ['Retail & Customer Service'], '2232': ['Teaching & Education'], '3933': ['Manufacturing & Production'],
    '3931': ['Manufacturing & Production'], '3993': ['Administration & Office Support'],
    '1333': ['Procurement & Supply'], '1412': ['Hospitality & Food Service'],

    # ── Codes the ATO spells differently from the ABS ────────────────────────
    #
    # Everything above corrects the MATCHER. This block corrects for the fact
    # that two publishers label the same ANZSCO4 code differently, which only
    # became visible when a third dataset arrived: the ATO's Taxation Statistics
    # (Individuals Table 15) is keyed on the same codes but writes its own
    # occupation names, and term-matching those names silently lost 56 unit
    # groups where matching the ABS names had worked fine.
    #
    # The variances are mundane and none of them is a judgement call — singular
    # against plural ("Kitchen hand" / "Kitchenhands"), "or" against "and"
    # ("Café or restaurant manager" / "Cafe and restaurant managers"), a
    # different word for the same job ("Window dresser" / "Visual
    # merchandisers", "Bank teller, officer or employee" / "Bank workers"), and
    # one outright misspelling ("Dietician" for dietitian).
    #
    # EVERY ENTRY BELOW IS A NO-OP FOR THE IVI AND ABS GENERATORS, and that is
    # the property that makes adding them safe rather than a silent revision of
    # two published datasets. Each value is exactly what skills_for() already
    # returns for that code's ABS label, so an override that now short-circuits
    # the match produces the identical answer on this side and a correct one on
    # the ATO side. check-occupation-overrides.py asserts that equality; if a
    # taxonomy edit ever makes one of these disagree with its ABS label, the
    # check fails rather than letting the two drift apart.
    #
    # Deliberately NOT included: codes where the ABS label maps to nothing
    # either. Those are not label variances — they are occupations the taxonomy
    # genuinely does not cover (Legislators, the defence-force ranks, the "Other
    # miscellaneous …" catch-alls), and inventing a mapping for them here would
    # change the IVI and ABS series rather than repair them. Also excluded are
    # the ATO's own 9xxx apprentice/trainee/consultant codes and its "Occupation
    # blank" bucket, which have no ANZSCO counterpart at all; the ATO generator
    # reports their size rather than absorbing them, the same way the ABS one
    # reports nfd.
    '8513': ['Hospitality & Food Service'],   # Kitchen hand / Kitchenhands
    '1351': ['IT & Systems'],                 # IT manager / ICT managers
    '5521': ['Banking & Lending'],            # Bank teller, officer or employee / Bank workers
    '4312': ['Hospitality & Food Service'],   # Café worker / Cafe workers
    '1411': ['Hospitality & Food Service'],   # Café or restaurant manager / Cafe and restaurant managers
    '8322': ['Manufacturing & Production'],   # Assembly line worker / Product assemblers
    '3423': ['Electronics & Telecoms Trade'], # Electronic equipment trades worker / Electronics trades workers
    '8219': ['Construction Labouring'],       # Other construction or mining labourer / …and mining labourers
    '1336': ['Procurement & Supply'],         # Supply and distribution manager / Supply, distribution and procurement managers
    '2491': ['Teaching & Education'],         # Education advisor or reviewer / Education advisers and reviewers
    '1413': ['Hospitality & Food Service'],   # Hotel or motel manager / Hotel and motel managers
    '2533': ['Medical Practice'],             # Internal medicine specialist / Specialist physicians
    '3241': ['Automotive Trade'],             # Panel beater / Panelbeaters
    '6394': ['Retail & Customer Service'],    # Ticket seller / Ticket salespersons
    '8992': ['Shipbuilding & Marine'],        # Deck or fishing hand / Deck and fishing hands
    '2511': ['Allied Health'],                # Dietician [sic] / Nutrition professionals
    '4115': ['Aged & Disability Care'],       # Aboriginal and Torres Strait Islander health worker / Indigenous health workers
    '7123': ['Manufacturing & Production'],   # Metal press operator / Engineering production workers
    '5615': ['Administration & Office Support'],  # Market research interviewer / Survey interviewers
    '2122': ['Journalism & Media'],           # Author, or book or script editor / Authors, and book and script editors
    '6395': ['Retail Operations'],            # Window dresser / Visual merchandisers
}


def main(path):
    skills = load_skills(TAX)
    names = {n for n, _ in skills}
    for c, sk in OVERRIDE.items():
        for s in sk:
            assert s in names, f'override references unknown skill: {s}'

    skills_for = matcher(TAX)

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[SHEET]
    it = ws.iter_rows(values_only=True)
    header = list(next(it))
    last = len(header) - 1
    month = header[last]
    month_str = month.strftime('%B %Y') if hasattr(month, 'strftime') else str(month)
    months = [(header[ci].strftime('%Y-%m') if hasattr(header[ci], 'strftime') else str(header[ci])[:7])
              for ci in range(3, last + 1)]
    nmonths = len(months)
    ACC_STATES = list(STATE2CITY.keys()) + ['AUST']

    def num(v):
        try:
            return round(float(v))
        except Exception:
            return 0

    # series[skill][state] = monthly [int] of length nmonths, summed across the
    # occupations that map to that skill. AUST is kept for the national series.
    series = {}

    def acc(skill, state, vals):
        arr = series.setdefault(skill, {}).get(state)
        if arr is None:
            arr = [0] * nmonths
            series[skill][state] = arr
        for i, v in enumerate(vals):
            arr[i] += v

    code_skills = {}
    tot_latest = mapped_latest = 0
    for r in it:
        code = str(r[0]).strip() if r[0] is not None else ''
        title = (r[1] or '').strip()
        st = (r[2] or '').strip()
        if not code or not title or code in ('.', '0') or 'Total' in title:
            continue
        if code not in code_skills:
            code_skills[code] = OVERRIDE.get(code) or skills_for(title)
        sk = code_skills[code]
        vals = [num(r[ci]) for ci in range(3, last + 1)]
        if st == 'AUST':
            tot_latest += vals[-1]
            if sk:
                mapped_latest += vals[-1]
        if sk and st in ACC_STATES:
            for s in sk:
                acc(s, st, vals)

    order = sorted(series, key=lambda s: -series[s].get('AUST', [0])[-1])
    nat = {s: series[s].get('AUST', [0] * nmonths)[-1] for s in order}
    by_city = {s: {city: series[s].get(st, [0] * nmonths)[-1] for st, city in STATE2CITY.items()} for s in order}
    obj = lambda d: '{ ' + ', '.join(f'{c}: {d.get(c, 0)}' for c in CITIES) + ' }'

    L = []
    L.append('// GENERATED — do not edit by hand. Run scripts/gen-ivi-skill-demand.py.')
    L.append('// Source: Jobs and Skills Australia Internet Vacancy Index (IVI), ANZSCO4')
    L.append(f'// occupations x state, 3-month moving average, {month_str} release. Each')
    L.append("// occupation's vacancies are mapped to canonical skills via the shared")
    L.append('// skillsTaxonomy terms, then summed per skill. State totals are attributed to')
    L.append('// that state\'s capital-city hub (WA->Perth, SA->Adelaide, QLD->Brisbane,')
    L.append('// VIC->Melbourne, NSW->Sydney); the national figure is the true AUST total.')
    L.append('// IVI_SERIES holds the full monthly history (2006-> latest) for the time')
    L.append('// slider; the latest month equals the last element of each array.')
    L.append('')
    L.append(f"export const IVI_MONTH = '{month_str}';")
    L.append('export const IVI_SOURCE =')
    L.append("  'Jobs and Skills Australia — Internet Vacancy Index (ANZSCO4, 3-month average)';")
    L.append('')
    L.append('// Monthly labels (YYYY-MM) indexing the IVI_SERIES arrays, oldest first.')
    L.append('export const IVI_MONTHS: string[] = ' + json.dumps(months) + ';')
    L.append('')
    L.append('// Skill → AU capital-city hub → monthly internet-vacancy history.')
    L.append('export const IVI_SERIES: Record<string, Record<string, number[]>> = {')
    for s in order:
        L.append(f'  {json.dumps(s)}: {{')
        for st, city in STATE2CITY.items():
            arr = series[s].get(st, [0] * nmonths)
            L.append(f'    {city}: [{",".join(map(str, arr))}],')
        L.append('  },')
    L.append('};')
    L.append('')
    L.append('// Skill → latest-month AU capital-city vacancy count (current heat map).')
    L.append('export const IVI_SKILL_BY_CITY: Record<string, Record<string, number>> = {')
    for s in order:
        L.append(f'  {json.dumps(s)}: {obj(by_city[s])},')
    L.append('};')
    L.append('')
    L.append('// Skill → latest-month national vacancy count (drives the AU popular-skills rank).')
    L.append('export const IVI_SKILL_NATIONAL: Record<string, number> = {')
    for s in order:
        L.append(f'  {json.dumps(s)}: {nat[s]},')
    L.append('};')
    L.append('')
    L.append('// Skills that carry real IVI demand, most in-demand first (latest month).')
    L.append('export const IVI_SKILLS: string[] = [')
    for s in order:
        L.append(f'  {json.dumps(s)},')
    L.append('];')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))
    print(f'{month_str}: mapped {mapped_latest}/{tot_latest} vac ({100*mapped_latest/tot_latest:.1f}%), '
          f'{len(order)} skills, {nmonths} months -> {OUT}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-ivi-skill-demand.py path/to/ivi_anzsco4_states.xlsx')
    main(sys.argv[1])
