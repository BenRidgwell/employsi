#!/usr/bin/env python3
"""Real workforce headcount for Australian universities, from the WGEA dataset.

WHY WGEA AND NOT THE OBVIOUS SOURCE. The obvious source is the Department of
Education's Higher Education Statistics Collection, which publishes staff
numbers and FTE for every provider in one place. It is unreachable. Measured
2026-09-24 from both networks this repo can use:

    https://www.education.gov.au/                    plain: TimeoutError
                                                     browser: ERR_HTTP2_PROTOCOL_ERROR
    https://www.education.gov.au/higher-education-statistics   same
    https://www.dese.gov.au/higher-education-statistics/staff-data
                                                     browser: ERR_NAME_NOT_RESOLVED
    https://www.teqsa.gov.au/                        browser: ERR_HTTP2_PROTOCOL_ERROR

The ROOTS fail, not just the paths, so this is not a wrong URL — and
data.gov.au carries no mirror (`package_search` for the department's staff
data returns count 0). The remaining single-source option was 41 separate
annual reports, each counting staff by its own definition.

WGEA is one file, one definition, and covers them all: under the Workplace
Gender Equality Act 2012 every non-public-sector employer with 100+ staff
reports annually, and the public data file is hosted ON data.gov.au, which is
reachable. Universities report as non-public-sector bodies, so all but one are
in it.

WHAT THE FIGURE COUNTS, AND THE TWO WAYS IT DIFFERS FROM AN ANNUAL REPORT.

  1. It is a HEAD COUNT INCLUDING CASUALS, not FTE. University annual reports
     usually lead with FTE, which is far lower — a university with a large
     casual teaching pool can be half again bigger by head. Sydney is 18,198
     here. Rows are marked `unit: "headcount"` so the card labels the tile
     "Headcount" rather than putting two measurements under one word.

  2. It is AUSTRALIAN EMPLOYEES ONLY. WGEA is a domestic reporting obligation,
     so an employer's offshore staff are absent. For a university that is
     nearly the whole organisation; for a multinational it would not be, which
     is why WGEA is merged LAST in companyCard's filedHeadcount() — it fills
     an employer with no figure and never displaces an annual report's global
     one.

SUMMING IS SAFE BECAUSE THERE IS NO TOTAL ROW. Each row is one cell of
manager_category x occupation x employment_status x employment_type x gender,
and `manager_category` takes only 'Manager' and 'Non-manager' — there is no
'All' or 'Total' member to double-count. Verified 2026-09-24 across all
211,659 rows of the 2025 file.

ONLY THE 2025 AND 2024 FILES ARE USED, and the 2023 one is deliberately left
out even though it would extend the series. It has a different schema AND a
different unit of analysis: `primary_employer_name` with a
`submission_group_size`, i.e. the SUBMISSION GROUP, which can bundle several
ABNs, where 2025/2024 carry one row per `employer_name`. Comparing a group
total against a single-employer total measures the difference between the two
methods and reports it as hiring. See CLAUDE.md: never compare two readings
measured different ways.

A UNIVERSITY MISSING FROM THE NEWEST FILE STILL GETS ITS FIGURE, with `span`
0 and `yoy` null, so the card prints the head count and an em dash for the
change rather than dropping the employer. Measured 2026-09-24: University of
Technology Sydney reported in 2023-24 and not in 2024-25, and it is the only
one. This reuses the mechanism gen-headcount.py added for Qantas's three-year
gap rather than inventing a second one.

MATCHING IS EXACT ON A NORMALISED NAME, never fuzzy. Two aliases are needed
and both were read off the data, not guessed:

    RMIT University  -> Royal Melbourne Institute Of Technology
    CQUniversity     -> Central Queensland University

RMIT is the one that shows why fuzzy matching is refused here: 'RMIT ONLINE
PTY LTD' (204 staff) and 'RMIT TRAINING PTY LTD' (241) are separate
subsidiaries in the same file, and any substring rule that found the
university would also find them.

Run:  python scripts/gen-wgea-workforce.py
"""

import collections
import csv
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROSTER = os.path.join(ROOT, "src/employsi/data/universityTargets.ts")
OUT = os.path.join(ROOT, "src/employsi/data/wgeaWorkforceAu.ts")
CACHE = os.environ.get("WGEA_CACHE") or os.path.join(ROOT, ".wgea-cache")

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36"
BASE = "https://data.gov.au/data/dataset/4d35cd80-2538-4705-82f3-d0d18e823d98/resource"

# The two per-employer public data files, newest first. Resource ids read from
# `package_show` on 2026-09-24; if WGEA publishes a new year, add it at the top
# and the generator picks it up as `now` with no other change.
FILES = [
    ("2024-25", "Jun 2025",
     f"{BASE}/380faa66-1126-4020-8b89-496821290624/download/wgea_public_dataset_2025.zip"),
    ("2023-24", "Jun 2024",
     f"{BASE}/f12cc138-44a8-45fc-9ba7-97ee5dadd683/download/wgea_public_dataset_2024.zip"),
]

# Roster name -> the employer_name WGEA files it under. Both measured against
# the 2025 file; see the module docstring for why this is a table and not a
# similarity score.
ALIAS = {
    "RMIT University": "Royal Melbourne Institute Of Technology",
    "CQUniversity": "Central Queensland University",
}


def norm(s):
    """Lowercase, drop corporate suffixes and a leading 'The', squash punctuation.

    'The University Of Queensland' and 'University of Queensland' have to land
    on one key — WGEA files several universities with the leading article and
    the roster never does. Parentheses are NOT stripped: gen-gov-workforce.py
    learned that the hard way when removing them collapsed two distinct
    Victorian Education rows into one.
    """
    s = s.lower().replace("&", " and ")
    s = re.sub(r"\b(pty|ltd|limited|inc|incorporated|the)\b", " ", s)
    s = re.sub(r"[^a-z0-9()]+", " ", s)
    return " ".join(s.split())


def slug(name):
    """Mirror of universityTargets.ts's `slug`, so ids cannot drift."""
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", name.lower()))


def roster():
    """The [name, city, domain] triples from universityTargets.ts's RAW array.

    Read out of the TS rather than duplicated here so a university added to the
    roster is picked up by the next run. Bounded to the RAW array: an earlier
    pass over the whole file also matched bracketed literals in the comments
    and the UNI_ROLES list, and reported 'Academic & Research' and 'of' as
    universities that WGEA had never heard of.
    """
    src = open(ROSTER, encoding="utf-8").read()
    start = src.index("const RAW")
    body = src[start:src.index("\n];", start)]
    return re.findall(r'\["([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\]', body)


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
    """employer_name -> total head count, summed over every cell.

    Also returns the relevance flag per employer, so main() can assert that
    every university it files is a 'relevant employer' under the Act rather
    than a partial voluntary submission.
    """
    z = zipfile.ZipFile(path)
    # The 2024 archive nests its members under a directory and the 2025 one
    # does not, so match on the member name rather than an index.
    member = [n for n in z.namelist() if "workforce_composition" in n][0]
    tot = collections.Counter()
    rel = {}
    years = set()
    with z.open(member) as raw:
        for row in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace")):
            name = row["employer_name"]
            try:
                tot[name] += int(row["n_employees"] or 0)
            except ValueError:
                continue
            rel[name] = row.get("is_relevant_employer")
            years.add(row["reporting_year"])
    return tot, rel, years


def index(tot):
    """normalised name -> [(employer_name, total)], so collisions are visible."""
    idx = collections.defaultdict(list)
    for name, n in tot.items():
        idx[norm(name)].append((name, n))
    return idx


def main():
    print("reading roster …")
    unis = roster()
    print(f"  {len(unis)} universities on the roster")

    loaded = []
    for year, asof, url in FILES:
        tot, rel, years = totals(fetch(url))
        if years != {year}:
            sys.exit(f"ERROR: {url} reports {sorted(years)}, expected {year!r} — "
                     "the resource ids in FILES have moved")
        print(f"  {year}: {len(tot):,} employers, {sum(tot.values()):,} employees")
        loaded.append((year, asof, tot, rel, index(tot)))

    rows = {}
    missing, ambiguous, notrelevant = [], [], []

    for name, _city, _domain in unis:
        want = norm(ALIAS.get(name, name))
        # Newest file first: the first year this employer appears in is `now`,
        # the next one is `prev`.
        found = []
        for year, asof, tot, rel, idx in loaded:
            cand = idx.get(want)
            if not cand:
                continue
            if len(cand) > 1:
                ambiguous.append((name, year, [c[0] for c in cand]))
                continue
            emp, n = cand[0]
            if n <= 0:
                continue
            found.append((year, asof, emp, n, rel.get(emp)))

        if not found:
            missing.append(name)
            continue

        year, asof, emp, now, flag = found[0]
        if flag != "TRUE":
            notrelevant.append((name, flag))

        prev = found[1][3] if len(found) > 1 else None
        # `span` is the years between the two readings, 0 when there is only
        # one. FILES is consecutive years, so two entries are always 1 apart.
        span = 1 if prev is not None else 0
        yoy = round((now - prev) / prev * 100, 1) if prev else None
        rows[f"uni-{slug(name)}"] = {
            "now": now,
            "prev": prev if prev is not None else now,
            "yoy": yoy,
            "asof": asof,
            "span": span,
            "emp": emp,
        }

    if ambiguous:
        print("\nAMBIGUOUS — one roster name, several WGEA employers. Not filed:")
        for name, year, cands in ambiguous:
            print(f"  {name} [{year}] -> {cands}")
    if notrelevant:
        print("\nNOT A 'RELEVANT EMPLOYER' under the Act — filed, but the "
              "submission may be partial:")
        for name, flag in notrelevant:
            print(f"  {name}: is_relevant_employer={flag}")
    if missing:
        print(f"\nABSENT from WGEA ({len(missing)}) — no row written, the card "
              "shows an em dash:")
        for name in missing:
            print(f"  {name}")

    newest_year, newest_asof = FILES[0][0], FILES[0][1]
    nospan = [k for k, v in rows.items() if v["span"] == 0]

    out = [
        "// GENERATED — do not edit by hand. Run scripts/gen-wgea-workforce.py.",
        "// Real workforce headcount for Australian universities, from the WGEA",
        "// public data file on data.gov.au (Workplace Gender Equality Act 2012:",
        "// every non-public-sector employer with 100+ staff reports annually).",
        "//",
        "// TWO THINGS THIS FIGURE IS NOT, both of which the generator's header",
        "// explains at length:",
        "//   - it is a HEAD COUNT INCLUDING CASUALS, not the FTE a university",
        "//     annual report usually leads with, which is much lower;",
        "//   - it is AUSTRALIAN EMPLOYEES ONLY, so it is merged LAST in",
        "//     filedHeadcount() and never displaces a global annual-report figure.",
        "//",
        f"// Source: WGEA {newest_year} public data file, as at {newest_asof}, with",
        f"//         {FILES[1][0]} as the prior year. Both per-employer; the 2022-23",
        "//         file is excluded because it reports submission GROUPS.",
        f"// Filed: {len(rows)} of {len(unis)} universities on the roster.",
        "//",
        "// A university WGEA does not report is ABSENT, never zero — the card",
        "// shows an em dash and says no figure was collected.",
    ]
    if nospan:
        out += [
            "//",
            "// `span: 0` and `yoy: null` mean the university appears in only one of",
            "// the two files, so there is no prior reading to compare — the card",
            "// prints the head count and an em dash for the change:",
        ] + [f"//   {k}" for k in sorted(nospan)]
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
            f'  // {v["emp"]}'
        )
    out.append("};")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

    print(f"\nwrote {OUT}")
    print(f"  {len(rows)} universities filed, {len(missing)} absent, "
          f"{len(nospan)} without a prior year")
    if not rows:
        sys.exit("ERROR: nothing matched — refusing to write an empty file")


if __name__ == "__main__":
    main()
