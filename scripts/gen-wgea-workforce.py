#!/usr/bin/env python3
"""Real workforce headcount from the WGEA register, for the Australian roster.

Under the Workplace Gender Equality Act 2012 every non-public-sector employer
with 100 or more Australian staff reports annually. The public data file is
hosted on data.gov.au, covers 9,689 employers, and is the only single source
this repo has found that reaches employers with no annual report at all — the
accounting firms, the aged-care and childcare groups, the private hospitals.

It started as a universities-only generator, because the Department of
Education's Higher Education Statistics Collection is unreachable. Measured
2026-09-24, from both networks available here:

    https://www.education.gov.au/                    plain: TimeoutError
                                                     browser: ERR_HTTP2_PROTOCOL_ERROR
    https://www.education.gov.au/higher-education-statistics   same
    https://www.dese.gov.au/higher-education-statistics/staff-data
                                                     browser: ERR_NAME_NOT_RESOLVED
    https://www.teqsa.gov.au/                        browser: ERR_HTTP2_PROTOCOL_ERROR

The ROOTS fail, not just the paths, and data.gov.au carries no mirror
(`package_search` for the department's staff data returns count 0).

═══ AUSTRALIAN COMPANIES ONLY ═══════════════════════════════════════════════

`au` comes from scripts/dump-roster.ts: the company is plotted in an
Australian city. New Zealand and overseas companies are NOT matched, and that
is a correctness rule rather than an optimisation. WGEA is an Australian
register: Fletcher Building and Xero are not in it, but their Australian
subsidiaries can be, and attributing a subsidiary's staff to the parent is
wrong in the way that is hardest to see — a real number, from a real filing,
describing a different company.

═══ THE UNIT OF ANALYSIS IS CHOSEN PER COMPANY, NOT FIXED ═══════════════════

This is the whole difficulty of the file and it cost a rewrite. The register
has two name columns: `employer_name` (the reporting legal entity) and
`corporate_group_name` (the group it reports under). 1,640 groups hold more
than one employer.

Reading `employer_name` alone — which is what the universities-only version of
this generator did — is catastrophic for a group:

    St Vincent's Health Australia Ltd   employer      563
                                        group      23,491   (6 employers)
    Evolution Mining Limited            employer      220
                                        group       2,529   (8 employers)

563 for an organisation of twenty-three thousand is not a rounding error; it
is the head-office entity presented as the hospital network. But reading the
GROUP always is wrong in the other direction:

    Torrens University Australia Ltd    employer    1,019
                                        group       1,846   under group
                                                    "Sei Australia Education"

whose other member is Think: Education Services — a sister brand under a
common owner, not part of Torrens.

So the rule is: **match the roster name against the group index first and the
employer index second, and take the total of whichever it matched.** The
group total is used exactly when the roster names the group. St Vincent's,
Evolution and RACV name their groups and get the group; Torrens names an
employer inside someone else's group and gets the employer.

THIS CHANGED 13 OF THE 40 UNIVERSITIES already filed by the earlier version.
Macquarie gains MQ Health and U@MQ (6,465 -> 8,227), UNSW gains UNSW Global,
RMIT gains RMIT Training and RMIT Online, Monash gains Monash College. Those
are the university's own group and belong in its figure. The alternative —
universities on employer scope and companies on group scope — would put two
different measurements on one axis of the compare card, which is the error
CLAUDE.md names as the most productive bug in this codebase.

═══ WHAT THE FIGURE COUNTS ══════════════════════════════════════════════════

  1. A HEAD COUNT INCLUDING CASUALS, not FTE. A university or a hospital
     annual report usually leads with FTE, which is far lower. Rows are
     marked `unit: "headcount"` so the card labels the tile from the
     measurement rather than putting two different things under one word.

  2. AUSTRALIAN EMPLOYEES ONLY, because the obligation is domestic. For a
     university or a local health service that is the whole organisation; for
     a multinational it is not. So WGEA is merged LAST in companyCard's
     filedHeadcount(): it fills an employer that has no figure and can never
     displace an annual report's global one. check-roster asserts that
     directly, and the assertion is now exercised rather than vacuous,
     because this file deliberately emits rows for companies that DO have an
     annual-report figure — see below.

EVERY MATCH IS EMITTED, including companies already covered by
COMPANY_HEADCOUNT. They are never read, since the merge prefers the annual
report, and emitting them is what turns "WGEA is merged last" from a comment
into something check-roster can test on real overlapping keys.

SUMMING IS SAFE BECAUSE THERE IS NO TOTAL ROW. Each row is one cell of
manager_category x occupation x employment_status x employment_type x gender,
and `manager_category` takes only 'Manager' and 'Non-manager'. Verified
2026-09-24 across all 211,659 rows of the 2025 file.

ONLY THE 2024-25 AND 2023-24 FILES ARE USED. The 2022-23 file would extend
the series and is deliberately excluded: it reports submission GROUPS
(`primary_employer_name`, `submission_group_size`) where the newer two report
employers, and comparing a group total against a single-employer total
measures the difference between the two methods and renders it as hiring.

MATCHING IS EXACT ON A NORMALISED NAME, NEVER FUZZY, and every ALIAS below
was read off the register rather than guessed. RMIT is the standing example
of why: 'RMIT ONLINE PTY LTD' (204) and 'RMIT TRAINING PTY LTD' (241) sit
beside 'Royal Melbourne Institute Of Technology' (9,588) in the same file, so
any substring rule that found the university would find them too.

Run:  bun run scripts/dump-roster.ts > /tmp/roster.json   (done automatically)
      python scripts/gen-wgea-workforce.py
"""

import collections
import csv
import io
import json
import os
import re
import subprocess
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src/employsi/data/wgeaWorkforceAu.ts")
CACHE = os.environ.get("WGEA_CACHE") or os.path.join(ROOT, ".wgea-cache")

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36"
BASE = "https://data.gov.au/data/dataset/4d35cd80-2538-4705-82f3-d0d18e823d98/resource"

# Newest first. Resource ids read from `package_show` on 2026-09-24; when WGEA
# publishes a new year, add it at the top and it becomes `now` with no other
# change.
FILES = [
    ("2024-25", "Jun 2025",
     f"{BASE}/380faa66-1126-4020-8b89-496821290624/download/wgea_public_dataset_2025.zip"),
    ("2023-24", "Jun 2024",
     f"{BASE}/f12cc138-44a8-45fc-9ba7-97ee5dadd683/download/wgea_public_dataset_2024.zip"),
]

# Roster name -> the name WGEA files it under. Each was found by searching the
# register for the company and reading the result, and each resolves to ONE
# entity. Where the register's name is a group, the group total is used; where
# it is an employer, the employer total is.
ALIAS = {
    # ── ASX entities whose roster name is the BRAND, not the listed company ──
    # A whole class the earlier passes missed, because norm() strips pty/ltd but
    # NOT "corporation", "holdings" or "management" — so "Stockland" never
    # reached "Stockland Corporation Ltd" and eight listed employers read as
    # absent from a register that held every one of them.
    #
    # NORM() IS DELIBERATELY NOT WIDENED TO STRIP THOSE WORDS. It would make
    # "Walker Corporation" collide with "Walker Group Holdings Pty Limited",
    # which is a different family's business, and that is the same failure as
    # "AFL" matching AFL Sports Ready. Each of these was read instead: the
    # group's MEMBER employers were listed and checked to be that company's own
    # subsidiaries, which is what a group name alone does not tell you.
    "Stockland": "Stockland Corporation Ltd",                 # 1 member, Stockland Development
    "Tabcorp": "Tabcorp Holdings Limited",                    # Tabcorp Assets, Sky Channel, TAB Ltd
    "Lendlease": "Lendlease Corporation Limited",             # 7 Lendlease entities
    "Nib": "Nib Holdings Ltd",                                # NIB Health Funds, nib Thrive, Honeysuckle
    "GPT Group": "GPT Management Holdings Limited",           # the corporate half of the GPT staple
    "Pinnacle Investment Management": "Pinnacle Investment Management Group Limited",
    "Abacus Storage King": "Abacus Storage Operations Limited",  # via Storage King Management
    # ── Private employers no earlier pass had searched ──────────────────────
    # The private route's fifteen largest were each read and refused, correctly,
    # and these two were never in that set. Both are substantial.
    #
    # NRMA's group is its full legal name and holds the motoring club plus the
    # businesses it has bought: Australian Tourist Park Management (its holiday
    # parks, 773), NRMA Tasmania, Kingmill, CPC Services. The roster card is the
    # club group, so the group total is the right unit.
    "NRMA Motoring & Services": "National Roads And Motorists' Association Limited",
    # Ritchies Stores Pty Ltd is the company behind the Supa IGA stores, and is
    # its own single-member group — so there is no aggregation to get wrong.
    "Ritchies Supa IGA": "Ritchies Stores Proprietary Limited",
    # NEPEAN's group holds Nepean Conveyors, Longwall, Power, Engineering &
    # Innovation, Building & Infrastructure, plus PROK Conveyor Components and
    # Weldlok — all NEPEAN businesses, which is what settles the identity where
    # the group name ("No1") says nothing. Both files read 1,255 exactly, so the
    # YoY is a true 0.0% rather than a missing reading.
    "Nepean Consolidated": "Nepean No1 Pty Ltd",
    "Sunny Queen Farms": "Sunny Queen Australia Pty Ltd",     # 1 member, Sunny Queen Pty Ltd
    # Professional services file through a service trust, never the brand.
    "EY": "The Trustee For Ernst & Young Services Trust",
    "PwC Australia": "The Trustee For The Pricewaterhousecoopers Services Trust",
    "KPMG": "The Trustee For KPMG Australian Service Trust",
    # Trading name vs legal entity.
    "Epworth HealthCare": "Epworth Foundation",
    "Melbourne Airport": "Australia Pacific Airports Corporation",
    "Great Southern Bank": "Credit Union Australia Ltd",   # the bank's former name
    "People First Bank": "Heritage and People's Choice Limited",  # the brand of the merged mutual
    "HCF": "The Hospitals Contribution Fund Of Australia Ltd",
    "HBF": "HBF Health Limited",
    "RACV": "Royal Automobile Club Of Victoria (Racv) Limited",
    "BMD Group": "B.M.D. Holdings Pty. Limited",
    "CMV Group": "Commercial Motor Vehicles Pty Ltd",
    "ABN Group": "The Trustee for ABN Service Trust",
    "Spotlight": "The Trustee For Spotlight Stores Trading Trust",
    "Visy": "Visy Industries Australia Pty Ltd",
    "Aurecon": "Aurecon Australasia Pty Ltd",
    "Harris Farm": "Harris Farm Markets Pty Ltd",
    "Avant Mutual": "Avant Mutual Group Limited",
    "Ausgrid": "Ausgrid Management Pty Ltd",
    "Georgiou": "Georgiou Group Pty Ltd",
    "Mater": "Mater Misericordiae Ltd",
    "Fitness and Lifestyle": "Fitness And Lifestyle Group Bidco Pty Ltd",
    # The roster row sits in Sydney and Uniting reports by state body; this is
    # the NSW/ACT one. The other Uniting entities are separate employers and
    # are not summed in.
    "Uniting": "Uniting (NSW.ACT)",
    # Universities whose legal name is not their trading name.
    "RMIT University": "Royal Melbourne Institute Of Technology",
    "CQUniversity": "Central Queensland University",

    # ── The private route, second pass ─────────────────────────────────────
    # The first pass matched on the roster name and left 81 companies carrying
    # 2,935 live ads. Nearly half of them ARE in the register, under a legal
    # name that shares no word with the trading name — and three were written
    # off in the first pass on conclusions that were simply wrong.
    #
    # THE THREE CORRECTIONS, because each was recorded here as a refusal:
    #
    #   Bolton Clarke      "not in the register". It is: RSL Care RDNS Limited,
    #                      19,867 people. Bolton Clarke is the trading name of
    #                      the merged RSL Care and Royal District Nursing
    #                      Service. It was the largest single item left in the
    #                      private route and the refusal was the reason.
    #   Salvation Army     "federated, no single entity". One group holds every
    #                      state's Social Work entity and totals 9,870.
    #   Calvary Health Care  "federated, separate state entities". Its parent is
    #                      Little Company of Mary Health Care, 17,810 — which
    #                      is Calvary's actual size.
    #
    # Two were wrong the other way in the first pass's CANDIDATES, and both
    # would have filed a real figure for another company: "AFL" token-matched
    # AFL Sports Ready (392, a training organisation) when the Australian
    # Football League's own group is 3,958, and "Alto" matched Palo Alto
    # Networks when Alto is the Altomonte family's dealership group. A name
    # that is mostly an initialism attracts a plausible stranger, which is why
    # nothing here is taken from a similarity score.
    'Bolton Clarke': 'Rsl Care Rdns Limited',
    'Calvary Health Care': 'Little Company Of Mary Health Care Limited',
    'Salvation Army Australia': 'The Trustee For The Salvation Army (Victoria) Property Trust',
    'AFL': 'Australian Football League',
    'Merivale': 'Hemmes Group Pty Limited',
    'Alto': 'Altomonte Holdings Pty Ltd',
    # Initialisms that spell something: CBH is Co-operative Bulk Handling, AKD
    # is Associated Kiln Driers, RAA and RACQ and RACWA are the motoring clubs.
    'CBH Group': 'Co-Operative Bulk Handling Limited',
    'AKD': 'Associated Kiln Driers Pty. Limited',
    'RAA': 'Royal Automobile Association Of South Australia',
    'RAC of WA': 'RACWA Holdings Pty Ltd',
    'RACQ': 'Racq Operations Pty Ltd',
    'Teachers Health Fund': 'Teachers Federation Health Ltd',
    # Trading name vs the entity that employs.
    'Employers Mutual': 'Employers Mutual Management Pty Ltd',
    'Canberra Airport': 'Capital Airport Group Pty Limited',
    'Suttons Motors': 'Suttons Investments Pty Limited',
    'Talent International': 'Talent International Holdings Pty Ltd',
    'Competitive Foods': 'Competitive Foods Australia Pty Ltd',
    'Cotton On Group': 'The Trustee For Cotton On Clothing Trust',
    'King & Wood Mallesons': 'V Ahuja & Others t/a King & Wood Mallesons',
    'Metricon Homes': 'The Trustee For Metricon Homes Unit Trust',
    'Meriton': 'Meriton Property Services Pty Limited',
    'ARA': 'ARA Group Limited',
    'Midfield': 'Midfield Meat International Pty. Ltd.',
    'SunPork Group': 'Sunpork Pty Ltd',
    'BGC': 'BGC (Australia) Pty Ltd',
    'Craig Mostyn': 'Craig Mostyn & Co Pty Ltd',
    'MPC Kinetic': 'Mpc Kinetic Holdings Limited',
    'Norco Co-op': 'Norco Co-Operative Limited',
    'Fdc': 'FDC Business Services Pty Ltd',
    'Detmold Group': 'Detmold Packaging Pty. Ltd.',
    'Loan Market': 'Loan Market Group Pty Ltd',
    'San Remo': 'San Remo Macaroni Company Pty Ltd',
    'United Petroleum': 'The Trustee For United Petroleum Unit Trust',
    'Pallion': 'Pallion Hr Pty Ltd',
    'Perfection Fresh': 'Perfection Fresh Australia Pty Ltd',
    'Sarah Group': 'Sarah Constructions Pty Ltd',
    # St Vincent de Paul IS genuinely federated, unlike the other two: four
    # state societies, four separate groups, no common parent in the register.
    # The roster row sits in Melbourne, so it reads the Victorian society and
    # the other three are not summed into it — the same treatment Uniting got.
    'St Vincent de Paul': 'St Vincent de Paul Society Victoria',
    # The register carries a word the trading name does not.
    'ABC Tissue': 'A B C Tissue Products Pty Ltd',
}

# Companies deliberately NOT matched, with the measurement that decided it.
# These are here so the next person does not re-derive them, and so the count
# of "no source" rows is a statement rather than a gap in the alias table.
REFUSED = {
    # ── Near names that would each have filed a REAL figure for the WRONG
    # company. Recorded rather than left out, because the next pass over this
    # register will surface all of them again, and a token score would take
    # every one. This is the "AFL Sports Ready" list.
    "Kennards Self Storage": "the register has Kennards Hire (2,078), a SEPARATE "
                             "business of the same family — self storage and "
                             "equipment hire are different companies. Self "
                             "storage is not in the register",
    "Peter Kittle Motor Company": "the near name is Peter Warren Automotive "
                                  "(699), an unrelated dealer group",
    "Walker Corporation": "the near name is Walker Group Holdings (291), a "
                          "different family's business, not Lang Walker's "
                          "property company",
    "Dalrymple Bay Infrastructure": "the register has Dalrymple Bay Coal "
                                    "Terminal Pty Ltd (483), which is the "
                                    "terminal OPERATOR; DBI holds the lease and "
                                    "employs almost nobody. Filing 483 would "
                                    "attribute the operator's workforce to the "
                                    "listed lessor",
    "Australian Rare Earths": "'rare earths' matches only Lynas Rare Earths "
                              "(295), a different and much larger company",
    "Region Group": "'region' matches only unrelated bodies with the word in "
                    "their name — Interchange Loddon Mallee Region, Capital "
                    "Region Community Services. Not in the register",
    "Australian Rugby League Commission": "the register has National Rugby "
                                          "League Limited (1,044). The "
                                          "Commission is the NRL's parent and "
                                          "the roster names the Commission, not "
                                          "the League, so the group total is "
                                          "not this card's figure",
    "Opal Aged Care": "'opal' matches only Opal Packaging and Opal Commercial "
                      "Services, a packaging company. The aged-care group is "
                      "not in the register under Opal HealthCare, Opal Aged or "
                      "Opal Specialist either",
    "Bowens Timber & Hardware": "the near name is the National Timber & "
                                "Hardware Association (96), an industry body",
    # Not in the register under any name, searched by trading name AND by the
    # legal name the company is known to use. Several are large enough that the
    # Act should reach them, so absence here is a fact about the register rather
    # than a conclusion about the employer.
    "Tennis Australia": "no entity in the register; 'tennis' matches nothing at all",
    "Sydney Tools": "not in the register",
    "CJD Equipment": "not in the register",
    "QCoal": "not in the register",
    "Apco Service Stations": "not in the register; the near names are Bapcor and "
                             "Tapco, unrelated companies",
    "John Hughes Group": "not in the register; the near names are Baker Hughes "
                         "and Jensen Hughes, unrelated",
    "CCI": "not in the register; 'cci' matches only Acciona entities",
    "Ateco": "not in the register; 'ateco' matches only StateCover Mutual",
    # Present, but not as this company.
    "Chemist Warehouse": "the only candidate is 'CW Retail Services Trust' at 489, "
                         "which cannot be the employer behind 318 live ads — the "
                         "stores are separately owned franchises and the corporate "
                         "entity is small. Filing 489 as Chemist Warehouse would be "
                         "a real number for a fraction of the organisation",
    "Linfox": "only 'Linfox Armaguard' (1,696), a separate cash-logistics business; "
              "the Fox Group total of 2,309 is nowhere near Linfox Logistics and "
              "would understate it by an order of magnitude",
    "Brisbane Catholic Education": "the only match is the whole Archdiocese of "
                                   "Brisbane (14,853), which is parishes and curia "
                                   "as well as schools",
    "PharmaCare": "ambiguous between 'Aspen Pharmacare Australia' and "
                  "'Pharm-A-Care Laboratories', two unrelated companies",
    "Peregrine": "its On The Run business was bought by Viva Energy in 2024, so "
                 "'On The Run Pty Ltd' (5,451) now sits inside the Viva group and "
                 "what remains of Peregrine is not separable from it",
    "Manildra Group": "spans two groups, one of them named 'GOTW Pty Ltd', and "
                      "nothing in the register confirms GOTW holds only Manildra "
                      "entities — summing it could take in another company",
    "Anytime Fitness": "not in the register — franchised, no corporate employer found",
}


def norm(s):
    """Lowercase, drop corporate suffixes and a leading 'The', squash punctuation.

    'The University Of Queensland' and 'University of Queensland' have to land
    on one key — the register writes several universities with the leading
    article and the roster never does. Parentheses are KEPT: gen-gov-workforce
    learned that stripping them collapsed two distinct Victorian Education rows
    into one.
    """
    s = s.lower().replace("&", " and ")
    # "proprietary" is the long form of "pty" and the register uses both —
    # "N.H.P. Electrical Engineering Products Proprietary Limited" against the
    # roster's "NHP Electrical Engineering Products". Leaving it in is one word
    # of difference and a whole employer missed.
    s = re.sub(r"\b(pty|proprietary|ltd|limited|inc|incorporated|the)\b", " ", s)
    s = re.sub(r"[^a-z0-9()]+", " ", s)
    s = " ".join(s.split())
    # AN INITIALISM IS ONE WORD HOWEVER IT IS PUNCTUATED. The register writes
    # "N.H.P. Electrical Engineering Products" and "A B C Tissue Products"
    # where the roster writes NHP and ABC Tissue, and stripping punctuation
    # alone leaves "n h p" against "nhp" — still no match. Two employers worth
    # 1,401 people were missed on that and nothing else. Runs of single letters
    # are joined, so "a b c tissue" and "abc tissue" land on one key.
    s = re.sub(r"\b(?:[a-z] )+[a-z]\b", lambda m: m.group(0).replace(" ", ""), s)
    return s


def roster():
    """The roster, from the TypeScript that defines it. See dump-roster.ts."""
    out = subprocess.run(
        ["bun", "run", os.path.join(ROOT, "scripts/dump-roster.ts")],
        capture_output=True, text=True, cwd=ROOT,
    )
    if out.returncode != 0:
        sys.exit(f"ERROR: dump-roster.ts failed:\n{out.stderr}")
    return json.loads(out.stdout)


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, url.rsplit("/", 1)[-1])
    if os.path.exists(path) and os.path.getsize(path) > 1_000_000:
        return path
    print(f"  fetching {url.rsplit('/', 1)[-1]} …", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


def totals(path):
    """Sum the register two ways: by employer, and by corporate group."""
    z = zipfile.ZipFile(path)
    # The 2024 archive nests its members in a directory and the 2025 one does
    # not, so match on the member name rather than an index.
    member = [n for n in z.namelist() if "workforce_composition" in n][0]
    by_emp, by_grp, years = collections.Counter(), collections.Counter(), set()
    members = collections.defaultdict(set)
    with z.open(member) as raw:
        for row in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace")):
            try:
                n = int(row["n_employees"] or 0)
            except ValueError:
                continue
            by_emp[row["employer_name"]] += n
            by_grp[row["corporate_group_name"]] += n
            members[row["corporate_group_name"]].add(row["employer_name"])
            years.add(row["reporting_year"])
    return by_emp, by_grp, members, years


def index(counter):
    """normalised name -> [(name, total)], so a collision stays visible."""
    idx = collections.defaultdict(list)
    for name, n in counter.items():
        idx[norm(name)].append((name, n))
    return idx


def main():
    print("reading roster …")
    companies = [c for c in roster() if c["au"]]
    print(f"  {len(companies)} Australian companies "
          f"(New Zealand and overseas are not matched — see the header)")

    loaded = []
    for year, asof, url in FILES:
        by_emp, by_grp, members, years = totals(fetch(url))
        if years != {year}:
            sys.exit(f"ERROR: {url} reports {sorted(years)}, expected {year!r} — "
                     "the resource ids in FILES have moved")
        print(f"  {year}: {len(by_emp):,} employers in {len(by_grp):,} groups, "
              f"{sum(by_emp.values()):,} employees")
        loaded.append((year, asof, index(by_grp), index(by_emp), by_emp, by_grp, members))

    rows, ambiguous, missing, fallbacks, changed, lapsed = {}, [], [], [], [], []

    for c in companies:
        if c["name"] in REFUSED:
            continue
        want = norm(ALIAS.get(c["name"], c["name"]))

        # THE SCOPE IS DECIDED ONCE, ON THE NEWEST FILE, AND THEN HELD. Letting
        # each year pick its own index is how UnitingCare Queensland came out at
        # +2454%: the group in 2024-25 (16,119) against an employer of the same
        # name in 2023-24 (631). That is not a comparison, it is the difference
        # between two ways of measuring, which is the failure CLAUDE.md warns
        # about in the archive and is no different here.
        newest = loaded[0]
        scope = name = None
        for sc, idx in (("group", newest[2]), ("employer", newest[3])):
            cand = idx.get(want)
            if not cand:
                continue
            if len(cand) > 1:
                ambiguous.append((c["name"], FILES[0][0], sc, [x[0] for x in cand]))
                break
            name, scope = cand[0][0], sc
            break
        # A COMPANY THAT STOPPED REPORTING STILL HAS ITS LAST READING. Deciding
        # the scope on the newest file is right, but looking ONLY there drops an
        # employer that is absent from it — which is not "no figure", it is a
        # figure with an older date. University of Technology Sydney reported in
        # 2023-24 and not in 2024-25, and an earlier version of this loop lost it
        # silently: it had been filed the day before, and nothing failed when it
        # stopped being. So fall back to the prior file for the scope as well,
        # and date the row to that year with no change attached.
        stale = False
        if name is None:
            for sc, idx in (("group", loaded[1][2]), ("employer", loaded[1][3])):
                cand = idx.get(want)
                if not cand or len(cand) > 1:
                    continue
                name, scope, stale = cand[0][0], sc, True
                break
        if name is None:
            missing.append(c)
            continue
        if stale:
            n = (loaded[1][5] if scope == "group" else loaded[1][4]).get(name, 0)
            if n <= 0:
                missing.append(c)
                continue
            lapsed.append((c["id"], name))
            rows[c["id"]] = {"now": n, "prev": n, "yoy": None, "asof": loaded[1][1],
                             "span": 0, "src": name, "scope": scope}
            continue

        def read(entry, nm, sc):
            _y, _a, gidx, eidx, by_emp, by_grp, _m = entry
            return (by_grp if sc == "group" else by_emp).get(nm, 0)

        now = read(newest, name, scope)
        prev = read(loaded[1], name, scope) or None

        # IS THE NEWEST READING COMPLETE? A group whose biggest employer simply
        # did not report this year still produces a total, and it looks like a
        # company that shrank. Telstra: 'Telstra Limited' (21,755 of 26,557) is
        # absent from the whole 2024-25 file, leaving the group at 2,409 — a
        # plausible number and 9% of the company.
        #
        # A member that LEFT the group is different from one that did not
        # report, and the register can tell them apart: a divested employer is
        # still in the file under another group, a non-reporter is not in the
        # file at all. Only the second makes the total a fragment.
        incomplete = 0
        if scope == "group":
            gone = loaded[1][6].get(name, set()) - newest[6].get(name, set())
            absent = [e for e in gone if e not in newest[4]]
            incomplete = sum(loaded[1][4][e] for e in absent)

        # `now < prev` matters as much as the missing share. A group can lose a
        # non-reporting member and still be bigger than last year, and four were:
        # Genesis Minerals reads 560 against 321, Tasmea 1,789 against 431, AGL
        # 4,448 against 4,233, Eagers 8,246 against 7,110. Falling back there
        # would throw away the larger, newer and more complete figure in the
        # name of completeness. Only a total that DROPPED is a fragment.
        if prev and incomplete > 0.2 * prev and now < prev:
            # Fall back to the last reading that was whole, and say so by
            # dating it to that year with no change attached.
            fallbacks.append((c["id"], name, now, prev, round(incomplete / prev * 100)))
            rows[c["id"]] = {"now": prev, "prev": prev, "yoy": None,
                             "asof": loaded[1][1], "span": 0, "src": name,
                             "scope": scope}
            continue

        if now <= 0:
            missing.append(c)
            continue

        # A YEAR-ON-YEAR NEEDS THE SAME EMPLOYERS ON BOTH SIDES. When a group
        # gains or loses a member the two totals cover different companies, and
        # the difference is mostly the membership change rather than hiring. The
        # head count is still reported; the change is not.
        same_members = True
        if scope == "group":
            same_members = newest[6].get(name, set()) == loaded[1][6].get(name, set())
        if prev and not same_members:
            changed.append((c["id"], name,
                            len(newest[6].get(name, set())), len(loaded[1][6].get(name, set()))))
            prev = None

        span = 1 if prev else 0
        yoy = round((now - prev) / prev * 100, 1) if prev else None
        rows[c["id"]] = {"now": now, "prev": prev if prev else now, "yoy": yoy,
                         "asof": newest[1], "span": span, "src": name, "scope": scope}

    if ambiguous:
        print(f"\nAMBIGUOUS — one roster name, several register entries. Not filed ({len(ambiguous)}):")
        for name, year, scope, cands in ambiguous[:20]:
            print(f"  {name} [{year}/{scope}] -> {cands[:3]}")

    if lapsed:
        print(f"\nNOT IN THE NEWEST FILE ({len(lapsed)}) — reported last year and not "
              "this one; the prior reading is used, dated to its own year:")
        for cid, nm in lapsed:
            print(f"  {cid}  ({nm[:52]})")
    if fallbacks:
        print(f"\nNEWEST READING INCOMPLETE ({len(fallbacks)}) — an employer that reported "
              "last year is absent from the whole newest file, so the group total is a "
              "fragment. Fell back to the prior year:")
        for cid, nm, bad, good, pct in fallbacks:
            print(f"  {cid}: newest {bad:,} vs prior {good:,} ({pct}% of the group did not report) -> used prior")
    if changed:
        print(f"\nGROUP MEMBERSHIP CHANGED ({len(changed)}) — head count reported, "
              "year-on-year suppressed:")
        for cid, nm, a, b in changed[:12]:
            print(f"  {cid}: {b} employers -> {a}  ({nm[:44]})")

    by_scope = collections.Counter(v["scope"] for v in rows.values())
    nospan = sorted(k for k, v in rows.items() if v["span"] == 0)
    moved = sorted(((abs(v["yoy"]), k, v) for k, v in rows.items() if v["yoy"] is not None),
                   reverse=True)[:8]

    print(f"\nmatched {len(rows)} of {len(companies)} "
          f"({by_scope['group']} on the group name, {by_scope['employer']} on the employer name)")
    print(f"  no match {len(missing)} · refused by name {len(REFUSED)} · "
          f"no prior year {len(nospan)}")
    print("\n  largest year-on-year moves, for eyeballing:")
    for _, k, v in moved:
        print(f"    {v['yoy']:>+8.1f}%  {v['prev']:>7,} -> {v['now']:>7,}  {k}  ({v['src'][:40]})")

    newest_year, newest_asof = FILES[0][0], FILES[0][1]
    out = [
        "// GENERATED — do not edit by hand. Run scripts/gen-wgea-workforce.py.",
        "// Real workforce headcount from the WGEA register (Workplace Gender",
        "// Equality Act 2012: every non-public-sector employer with 100+ Australian",
        "// staff reports annually), via the public data file on data.gov.au.",
        "//",
        "// TWO THINGS THIS FIGURE IS NOT, both explained at length in the generator:",
        "//   - it is a HEAD COUNT INCLUDING CASUALS, not the FTE an annual report",
        "//     usually leads with, which is much lower;",
        "//   - it is AUSTRALIAN EMPLOYEES ONLY, so it is merged LAST in",
        "//     filedHeadcount() and never displaces a global annual-report figure.",
        "//     Rows are emitted even for companies that already have one; those are",
        "//     never read, and exist so check-roster can test the merge order.",
        "//",
        "// `scope` in the trailing comment is which of the register's two name",
        "// columns the roster name matched — the group total is used when the",
        "// roster names the group, the employer total when it names an employer",
        "// inside someone else's group. Reading either one alone is wrong: see the",
        "// St Vincent's (563 vs 23,491) and Torrens (1,846 vs 1,019) cases.",
        "//",
        f"// Source: WGEA {newest_year} public data file, as at {newest_asof}, with",
        f"//         {FILES[1][0]} as the prior year. Both per-employer; the 2022-23",
        "//         file is excluded because it reports submission GROUPS.",
        f"// Filed: {len(rows)} of {len(companies)} Australian roster companies",
        f"//        ({by_scope['group']} matched on the group name, "
        f"{by_scope['employer']} on the employer name).",
        "//",
        "// A company the register does not report is ABSENT, never zero — the card",
        "// shows an em dash and says no figure was collected.",
    ]
    if nospan:
        out += [
            "//",
            "// `span: 0` and `yoy: null` mean the company appears in only one of the",
            "// two files, so there is no prior reading to compare — the card prints",
            "// the head count and an em dash for the change:",
        ] + [f"//   {k}" for k in nospan]
    out += [
        'import type { Headcount } from "./companyHeadcount";',
        "export const WGEA_HEADCOUNT: Record<string, Headcount> = {",
    ]
    for key in sorted(rows):
        v = rows[key]
        yoy = "null" if v["yoy"] is None else f"{v['yoy']}"
        out.append(
            f'  "{key}": {{ now: {v["now"]}, prev: {v["prev"]}, yoy: {yoy}, '
            f'asof: "{v["asof"]}", span: {v["span"]}, unit: "headcount" }},'
            f'  // {v["scope"]}: {v["src"]}'
        )
    out.append("};")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"\nwrote {OUT}")
    if not rows:
        sys.exit("ERROR: nothing matched — refusing to write an empty file")


if __name__ == "__main__":
    main()
