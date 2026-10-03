#!/usr/bin/env python3
"""Hays Salary Guide workbooks -> src/employsi/data/haysSalary.ts

WHAT THIS IS, AND WHAT IT IS NOT. The Hays Salary Guide publishes, per role and
per city, a TYPICAL salary and a RANGE. That is a different instrument from
everything else this app shows: `jobs.salary` is what an employer wrote in an
ad, `salaryBaseline.ts` is income people actually received (ATO / Stats NZ), and
this is a recruiter's view of what a role commands. The three must never be
averaged, differenced or plotted on one axis — see the unit warnings at the top
of salaryBaseline.ts, which apply here word for word.

Usage:
  python3 scripts/gen-hays-salary.py <workbook.xlsx> [more.xlsx ...] [--json out.json]

Each workbook is one edition. The edition's label is taken from the filename
(FY2223, 2023, FY24-25), because nothing inside the sheets states it reliably.

UNITS, FROM THE GUIDE'S OWN NOTES ROW, which every salary table carries:

    All salaries shown are exclusive of superannuation (AU) or KiwiSaver (NZ)
    New Zealand Salaries are represented in New Zealand Dollars

So: THOUSANDS, EXCLUDING super, and the NZ rows are NZD against the AU rows'
AUD. Two currencies in one table with nothing but the row label to tell them
apart, which is why `cur` is derived from the geography and carried per row.

── THE THREE LAYOUTS, because there is no single one ─────────────────────────
The workbooks are PDF conversions and the shape changed between editions:

  A  per-cell      role names on a header row, each geography's values in their
                   own cells. (2023 edition, and much of FY24/25.)
  B  stacked cell  one cell per role holding "133\\n112 - 148". (FY22/23.)
  C  collapsed     the entire geography row flattened into column A as text:
                   "NSW - Sydney   165   150 - 180   190   160 - 215  …".
                   (Parts of FY24/25.)

A and B keep COLUMN POSITION, so a role with no figure for one city leaves a
hole that stays in place. C does not: the hole simply is not in the string.

THAT DISTINCTION IS THE WHOLE REASON THIS PARSER IS NOT TEN LINES. Measured on
FY24/25 Table 11: eleven roles, and Sydney carries eleven value triples while
another city carries nine. Matching by ORDER there would silently slide two
roles' salaries onto the wrong roles — not a parse failure, a parse that
succeeds and lies. Positions are therefore read from the sheet wherever they
exist, and a collapsed row is accepted ONLY when its triple count matches the
role count exactly. Anything else is skipped and counted, so coverage is a
measurement rather than an assumption.
"""
from __future__ import annotations
import json
import os
import re
import sys
from collections import defaultdict

try:
    import openpyxl
except ImportError:
    sys.exit('needs openpyxl: pip install openpyxl')

GEO_RE = re.compile(r'^(NSW|VIC|QLD|SA|WA|ACT|TAS|NT|NZ)\s*[-–]\s*(.+)$', re.I)
# A value triple: typical, then lo - hi. The lookarounds stop "1 500 - 600"
# being read as (1, 500, 600) when a number has been split by the conversion.
TRIPLE_RE = re.compile(
    r'(?<![\d.])(\d[\d,]*(?:\.\d+)?)\s+(\d[\d,]*(?:\.\d+)?)\s*[-–]\s*(\d[\d,]*(?:\.\d+)?)(?![\d.])')
# A lone range, for the editions that publish one without a typical.
RANGE_RE = re.compile(r'(?<![\d.])(\d[\d,]*(?:\.\d+)?)\s*[-–]\s*(\d[\d,]*(?:\.\d+)?)(?![\d.])')
HEADER_WORDS = {'typical', 'range', 'salary', 'salaries', ''}

# Hays' geography labels -> this app's hub ids. Regional rows are kept with a
# null hub rather than folded into the capital: "NSW - Regional" is not Sydney,
# and dropping it would quietly delete the only non-metro pay in the product.
HUB = {
    ('nsw', 'sydney'): 'sydney', ('vic', 'melbourne'): 'melbourne',
    ('qld', 'brisbane'): 'brisbane', ('sa', 'adelaide'): 'adelaide',
    ('wa', 'perth'): 'perth', ('act', 'canberra'): 'canberra',
    ('tas', 'hobart'): 'hobart', ('nt', 'darwin'): 'darwin',
    ('nz', 'auckland'): 'auckland', ('nz', 'wellington'): 'wellington',
    ('nz', 'christchurch'): 'christchurch', ('nz', 'dunedin'): 'dunedin',
}
# Figures are in thousands, so a sane role sits between $10k and $2m. Outside
# that the cell was not a salary — a page number, a percentage, a headcount —
# and letting it through would put a $3 or a $9,000,000 role on a card.
MIN_K, MAX_K = 10, 2000

# A column header that is an EXPERIENCE BAND, not a role.
#
# MEASURED: 1,432 of 13,094 figures came back with a "role" of "Up to 2 years",
# "2 - 4 years", "4+ years", "Senior Manager for 2-5 yrs". Those tables put ONE
# role in the heading and split its columns by experience, so the role name is
# the last segment of the breadcrumb above — "… | ACCOUNTANTS | ASSISTANT
# ACCOUNTANTS" — and the column is a qualifier on it.
#
# Left alone they are unmappable: "2 - 4 years" places onto no career rung and
# never could, so a sixth of the guide's figures would have been dropped at the
# review stage as junk while being perfectly good data under the wrong name.
EXP_BAND_RE = re.compile(
    r'^\s*(?:up\s+to\s+\d|\d+\s*[-–+]\s*\d*\s*(?:years?|yrs?)?|\d+\s*(?:years?|yrs?)'
    r'|(?:senior\s+)?manager\s+for\s+\d)', re.I)


def edition_of(path: str) -> str:
    """FY24/25, FY22/23, 2023 — from the filename, which is the only reliable
    statement of it. A sheet's own title row is sometimes the prior year's."""
    base = os.path.basename(path)
    m = re.search(r'FY\s*(\d{2})\s*[-/]?\s*(\d{2})', base, re.I)
    if m:
        return f'FY{m.group(1)}/{m.group(2)}'
    m = re.search(r'(20\d{2})', base)
    return m.group(1) if m else base


def hub_for(state: str, city: str):
    s, c = state.lower().strip(), city.lower().strip()
    for (ks, kc), hub in HUB.items():
        if s == ks and c.startswith(kc):
            return hub
    return None


def cell_text(ws, r, c) -> str:
    v = ws.cell(r, c).value
    return '' if v is None else str(v).replace('\n', ' ').strip()


def row_text(ws, r) -> str:
    return '  '.join(t for t in (cell_text(ws, r, c) for c in range(1, ws.max_column + 1)) if t)


def merge_span(ws, r: int, c: int) -> int:
    """How many columns the cell at (r,c) spans. A role header is routinely
    merged across its Typical and Range columns, and that span is what maps a
    role to the cells its figures live in."""
    for m in ws.merged_cells.ranges:
        if m.min_row <= r <= m.max_row and m.min_col <= c <= m.max_col:
            return m.max_col - m.min_col + 1
    return 1


def find_roles(ws, first_geo: int):
    """The role row above the data, as [(name, start_col, end_col)].

    Walks UP from the first geography row and takes the first row that carries
    something other than Typical/Range. Rows of bare numbers are refused: in
    FY24/25 Table 12 the row immediately above the data is itself data, and
    accepting it named seven roles "95 - 140", "90", "85 - 95" — a table that
    parsed cleanly into nonsense."""
    for r in range(first_geo - 1, 0, -1):
        found = []
        c = 2
        while c <= ws.max_column:
            t = cell_text(ws, r, c)
            span = merge_span(ws, r, c)
            if t and t.lower() not in HEADER_WORDS:
                found.append((t, c, c + span - 1))
            c += span
        if not found:
            continue
        # All-numeric "names" mean this is a data row, not a header.
        if all(re.fullmatch(r'[\d,.\s–-]+', n) for n, _, _ in found):
            continue
        return r, found
    return None, []


def values_by_position(ws, r: int, lo_col: int, hi_col: int):
    """A role's (typical, lo, hi) read from the cells under its header span.

    Position-preserving: a city with no figure for this role yields None here
    rather than borrowing the next role's number."""
    txt = '  '.join(t for t in (cell_text(ws, r, c) for c in range(lo_col, hi_col + 1)) if t)
    if not txt:
        return None
    m = TRIPLE_RE.search(txt)
    if m:
        return tuple(float(x.replace(',', '')) for x in m.groups())
    # A range with no typical: the midpoint is NOT invented, the typical is left
    # null. Fabricating the middle of someone else's band is the one thing the
    # whole file is careful not to do.
    m = RANGE_RE.search(txt)
    if m:
        lo, hi = (float(x.replace(',', '')) for x in m.groups())
        return (None, lo, hi)
    return None


def parse_sheet(ws, edition: str, sheet: str, stats: dict):
    geos = [r for r in range(1, ws.max_row + 1)
            if GEO_RE.match(cell_text(ws, r, 1))]
    if len(geos) < 3:
        return []
    stats['tables'] += 1
    role_row, roles = find_roles(ws, geos[0])
    if not roles:
        stats['no_roles'] += 1
        return []

    # The section headings above the role row, for context on the role name.
    # "Mine Accountant" under "COMMERCE AND INDUSTRY | MINING" is a different
    # job from the same words under a consulting heading.
    section = ' | '.join(
        t for t in (cell_text(ws, r, 1) for r in range(1, role_row)) if t)[:160]

    out, skipped_rows = [], 0
    for r in geos:
        m = GEO_RE.match(cell_text(ws, r, 1))
        state = m.group(1)
        # TRIMMED AT THE FIRST RUN OF SPACES OR THE FIRST DIGIT. On a collapsed
        # row the label and every figure are one string, so the raw capture is
        # "Sydney      165    150 - 180    190 …" — which parsed fine (the hub
        # matches on the prefix) and then stored the table's whole data block as
        # the city name on every row it produced.
        city = re.split(r'\s{2,}|\d', m.group(2))[0].strip().strip('-–,')
        # A collapsed row carries everything in column A, so the geography label
        # and the figures are one string.
        collapsed = not any(cell_text(ws, r, c) for c in range(2, ws.max_column + 1))
        if collapsed:
            trips = TRIPLE_RE.findall(row_text(ws, r))
            if len(trips) != len(roles):
                # No positions to fall back on and the counts disagree, so which
                # role each figure belongs to is unknowable. Refused rather than
                # guessed — see the header.
                skipped_rows += 1
                continue
            vals = [tuple(float(x.replace(',', '')) for x in t) for t in trips]
        else:
            vals = [values_by_position(ws, r, lo, hi) for _, lo, hi in roles]
        for (name, _, _), v in zip(roles, vals):
            if not v:
                continue
            typ, lo, hi = v
            if not (lo and hi) or lo > hi:
                stats['bad_range'] += 1
                continue
            if not (MIN_K <= lo <= MAX_K and MIN_K <= hi <= MAX_K):
                stats['out_of_band'] += 1
                continue
            if typ is not None and not (lo <= typ <= hi):
                # The guide's own typical sitting outside its own range means
                # the three numbers did not come from one role. Drop the
                # typical, keep the band, count it.
                stats['typ_outside'] += 1
                typ = None
            role = re.sub(r'\s+', ' ', name).strip()[:120]
            qualifier = ''
            if EXP_BAND_RE.match(role):
                # The heading's last segment is the role; the column is a
                # qualifier on it. Keeps BOTH, because "Assistant Accountant"
                # at 4+ years and at up to 2 years are different numbers and
                # collapsing them would average two bands into one that is
                # neither.
                parts = [x.strip() for x in section.split('|') if x.strip()]
                if parts:
                    qualifier, role = role, parts[-1][:120]
            out.append({
                'edition': edition, 'sheet': sheet, 'section': section,
                'role': role, 'qualifier': qualifier,
                'state': state.upper(), 'city': city,
                'hub': hub_for(state, city),
                'cur': 'NZD' if state.upper() == 'NZ' else 'AUD',
                'typical': typ, 'lo': lo, 'hi': hi,
            })
    stats['rows_skipped'] += skipped_rows
    if skipped_rows:
        stats['tables_partial'] += 1
    return out


def main() -> int:
    argv = sys.argv[1:]
    out_ts = None
    if '--ts' in argv:
        i = argv.index('--ts')
        out_ts = argv[i + 1] if i + 1 < len(argv) else None
        del argv[i:i + 2]
    out_json = None
    if '--json' in argv:
        i = argv.index('--json')
        out_json = argv[i + 1] if i + 1 < len(argv) else None
        # BOTH the flag and ITS VALUE come out. Filtering only on a leading
        # "--" left the output path in the workbook list, and openpyxl was
        # handed a .json to open.
        del argv[i:i + 2]
    args = [a for a in argv if not a.startswith('--')]
    if not args:
        sys.exit(__doc__.strip().splitlines()[2])
    records, stats = [], defaultdict(int)
    for path in args:
        edition = edition_of(path)
        wb = openpyxl.load_workbook(path)
        before = len(records)
        for sheet in wb.sheetnames:
            records += parse_sheet(wb[sheet], edition, sheet, stats)
        wb.close()
        sys.stderr.write(f'{edition:9} {os.path.basename(path)[:44]:46} {len(records)-before:6} figures\n')

    eds = sorted({r['edition'] for r in records})
    roles = {r['role'] for r in records}
    hubs = {r['hub'] for r in records if r['hub']}
    sys.stderr.write(
        f"\n{len(records)} figures · {len(roles)} distinct roles · {len(hubs)} hubs · "
        f"editions {', '.join(eds)}\n"
        f"tables seen {stats['tables']}, no role row {stats['no_roles']}, "
        f"partially skipped {stats['tables_partial']} ({stats['rows_skipped']} rows)\n"
        f"dropped: {stats['bad_range']} bad range, {stats['out_of_band']} out of band, "
        f"{stats['typ_outside']} typical outside its own range (band kept)\n")
    if out_json:
        with open(out_json, 'w') as f:
            json.dump(records, f)
        sys.stderr.write(f'wrote {out_json}\n')
    if out_ts:
        write_ts(records, out_ts)
        sys.stderr.write(f'wrote {out_ts}\n')
    return 0 if records else 2


def write_ts(records: list, path: str) -> None:
    """The generated data file: roles interned, figures one per line.

    One record per line and interned role names, like every other generated file
    here — prettier would otherwise reformat a compact array into hundreds of
    thousands of lines and the next run would undo it. The file carries the
    ESLint-ignored GENERATED header for the same reason.
    """
    roles: dict[tuple, int] = {}
    for r in records:
        roles.setdefault((r['role'], r['qualifier'], r['section']), len(roles))
    rows = []
    for r in records:
        rows.append([
            roles[(r['role'], r['qualifier'], r['section'])],
            r['edition'],
            r['hub'] or '',
            r['state'],
            r['city'],
            r['typical'],
            r['lo'],
            r['hi'],
        ])
    eds = sorted({r['edition'] for r in records})
    with open(path, 'w') as f:
        f.write(f"""// GENERATED — do not edit by hand.
// Run: python3 scripts/gen-hays-salary.py <Hays_Salary_Guide_*.xlsx ...>
//
// Hays Salary Guide, {', '.join(eds)}. Typical salary and range per role per
// city, as the guide publishes them.
//
// SOURCE AND CREDIT. Hays Salary Guide (Hays Specialist Recruitment). The
// figures are Hays' and the credit travels with them: any surface showing one
// names the guide and its edition, the same way the career card names O*NET.
// They are reproduced here with the repo owner's say-so, from workbooks they
// supplied; this generator does not fetch anything.
//
// READ THE UNIT BEFORE USING A NUMBER FROM HERE.
//   * THOUSANDS. 165 is $165,000.
//   * EXCLUDING superannuation (AU) and KiwiSaver (NZ) — the guide's own notes
//     row says so on every table. An advertised "package" usually includes
//     super, so the two are not the same quantity.
//   * TWO CURRENCIES. NZ cities are NZD, Australian cities AUD. Nothing but the
//     city tells them apart, so `cur` is derived from it and carried per row.
//   * A RECRUITER'S VIEW of what a role commands — not what was advertised
//     (jobs.salary) and not what people received (salaryBaseline.ts). Three
//     instruments, three questions. NEVER average, difference or plot them
//     together; the gap between any two of them is mostly the gap between two
//     ways of measuring. The same warning at the top of salaryBaseline.ts
//     applies here word for word.
//   * `typical` is NULL on {sum(1 for r in records if r['typical'] is None)} of
//     {len(records)} figures, where the guide published a band without one or
//     the workbook's layout lost it. Null, never the midpoint of the band: the
//     middle of someone else's range is a number nobody published.
//
// A `hub` of "" is a REGIONAL row ("NSW - Regional"), kept rather than folded
// into the capital — it is not Sydney, and dropping it would delete the only
// non-metro pay in the product.

export interface HaysRole {{
  /** The role as the guide names it. */
  role: string;
  /** An experience band the guide splits the role by ("4+ years"), where it
   *  does. Kept apart from the role rather than glued on: the role is what maps
   *  to a career rung, and the band is why two rows for it differ. */
  qualifier: string;
  /** The headings above it — a "Mine Accountant" under Commerce & Industry |
   *  Mining is not the same job as the same words elsewhere. */
  section: string;
}}

/** [roleIndex, edition, hub, state, city, typical|null, lo, hi] — thousands. */
export type HaysPayRow = [number, string, string, string, string, number | null, number, number];

export const HAYS_EDITIONS: string[] = {json.dumps(eds)};

export const HAYS_SOURCE = {{
  name: "Hays Salary Guide",
  publisher: "Hays Specialist Recruitment",
  unit: "thousands, excluding superannuation (AU) / KiwiSaver (NZ)",
  basis: "typical salary and range for the role, as published by the guide",
}} as const;

export const HAYS_ROLES: HaysRole[] = [
""")
        for (role, qualifier, section), _ in sorted(roles.items(), key=lambda kv: kv[1]):
            f.write(f'  {{ role: {json.dumps(role)}, qualifier: {json.dumps(qualifier)}, '
                    f'section: {json.dumps(section)} }},\n')
        f.write('];\n\nexport const HAYS_PAY: HaysPayRow[] = [\n')
        for r in rows:
            f.write('  ' + json.dumps(r) + ',\n')
        f.write('];\n')


if __name__ == '__main__':
    raise SystemExit(main())
