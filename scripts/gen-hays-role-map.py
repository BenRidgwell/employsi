#!/usr/bin/env python3
"""The reviewed Hays workbook -> src/employsi/data/haysRoleMap.ts

Run: python3 scripts/gen-hays-role-map.py [reviewed.xlsx]

THE REVIEWED WORKBOOK IS THE MAPPING. This only transcribes it, the same way
gen-onet-roles.py transcribes its reviewed TABLE. Nothing here decides which
rung a role belongs to, and nothing here fills a gap: a role left undecided
contributes no salary anywhere.

── THE JOIN, AND WHY IT IS DONE THE LONG WAY ────────────────────────────────
A decision has to get back to a role INDEX in HAYS_ROLES, and the first review
file shipped without one. The obvious fallback — join on the role name — is
wrong and quietly so: 45 of the 1,163 (role, band, section) keys appear more
than once ("PROJECT MANAGER" under CONSTRUCTION three times, on three different
rungs), so a name join would attribute about 58 decisions to the wrong figures
and every one of them would look fine.

So the join is POSITIONAL, against scripts/hays-role-review.tsv — the file the
workbook was made from, regenerated from the same data by the same script, in
the same deterministic order. Positional is only safe if the two really are the
same rows, so that is CHECKED rather than assumed: every row must agree on
role, band, section, proposed_node, confidence and figures. One disagreement
and this refuses to write anything, because a silently shifted join produces a
complete, plausible mapping of the wrong salaries onto the right roles.

`role_idx` is in the TSV now, so a future round trip reads it straight off the
workbook and this reconstruction becomes a fallback rather than the path.
"""
from __future__ import annotations
import csv
import json
import os
import sys

try:
    from openpyxl import load_workbook
except ImportError:
    sys.exit('needs openpyxl: pip install openpyxl')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
XLSX = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'hays-role-review.xlsx')
TSV = os.path.join(HERE, 'hays-role-review.tsv')
OUT = os.path.join(ROOT, 'src', 'employsi', 'data', 'haysRoleMap.ts')

# The columns both files carry, which the positional join is verified against.
MATCH = ['confidence', 'section_odd', 'hays_role', 'hays_band', 'hays_section',
         'proposed_node', 'figures']


def norm(v) -> str:
    return '' if v is None else str(v).strip()


def read_tsv(path: str):
    with open(path, encoding='utf-8') as f:
        lines = [l for l in f if not l.startswith('#') and l.strip()]
    return list(csv.DictReader(lines, delimiter='\t'))


def read_xlsx(path: str):
    wb = load_workbook(path, data_only=True)
    ws = wb['Review']
    hdr = [norm(ws.cell(1, j).value) for j in range(1, ws.max_column + 1)]
    out = []
    for i in range(2, ws.max_row + 1):
        out.append({h: norm(ws.cell(i, j).value) for j, h in enumerate(hdr, start=1)})
    wb.close()
    return out


def main() -> int:
    tsv, xl = read_tsv(TSV), read_xlsx(XLSX)
    if len(tsv) != len(xl):
        sys.exit(f'row count differs: tsv {len(tsv)} vs workbook {len(xl)}. The workbook was '
                 f'made from a different run — regenerate the TSV from the same data, or '
                 f'use a workbook that carries role_idx.')

    # Verify the positional join before trusting a single decision.
    for i, (a, b) in enumerate(zip(tsv, xl), start=2):
        for k in MATCH:
            if norm(a.get(k)) != norm(b.get(k)):
                sys.exit(f'row {i} disagrees on "{k}": tsv {norm(a.get(k))!r} vs workbook '
                         f'{norm(b.get(k))!r}. The two are not the same rows, so the join '
                         f'would misattribute decisions. Nothing written.')

    accepted, counts = {}, dict(ok=0, corrected=0, no=0, blank=0, no_rung=0, free=0)
    for a, b in zip(tsv, xl):
        # role_idx comes from the TSV: the workbook predates the column.
        idx = int(a['role_idx']) if a.get('role_idx') not in (None, '') else None
        d = norm(b.get('DECISION'))
        node = norm(a.get('proposed_node'))
        if not d:
            counts['blank'] += 1
            continue
        if d == 'no':
            counts['no'] += 1
            continue
        if d == 'ok':
            if not node or '?' in node:
                # "Accept" of a proposal that names no rung. Not a decision this
                # can act on, and inventing the rung is the one thing the review
                # exists to prevent.
                counts['no_rung'] += 1
                continue
            counts['ok'] += 1
            accepted[idx] = node
            continue
        if '|' in d and '?' not in d:
            counts['corrected'] += 1
            accepted[idx] = d
            continue
        # A family name or a note ("HR", "combine with 701"): a real intent this
        # cannot complete, so it is counted and reported, never guessed at.
        counts['free'] += 1

    with open(OUT, 'w') as f:
        f.write(f"""// GENERATED — do not edit by hand.
// Run: python3 scripts/gen-hays-role-map.py
//
// Which career rung each Hays Salary Guide role belongs to, as REVIEWED in
// scripts/hays-role-review.xlsx. The workbook is the mapping; this file is a
// transcription of it, and the generator decides nothing.
//
// A role that is not in here contributes NO salary anywhere — undecided,
// refused, or accepted onto a proposal that named no rung. That is the same
// rule gen-onet-roles.py applies: a rung the table has not decided is left off
// the card rather than given the nearest-sounding answer.
//
// Keyed by index into HAYS_ROLES in haysSalary.ts. Regenerating that file
// WITHOUT regenerating this one would shift every key — both are rebuilt from
// the same workbooks by the same pair of scripts, so run them together.

/** Hays role index -> "family|track|rung". */
export const HAYS_ROLE_NODE: Record<number, string> = {{
""")
        for idx in sorted(k for k in accepted if k is not None):
            f.write(f'  {idx}: "{accepted[idx]}",\n')
        f.write('};\n')

    total = sum(counts.values())
    sys.stderr.write(
        f'{len(accepted)} roles mapped onto {len(set(accepted.values()))} rungs.\n'
        f'  accepted {counts["ok"]}, corrected {counts["corrected"]}, refused {counts["no"]}, '
        f'undecided {counts["blank"]}\n'
        f'  NOT MAPPED, needs a decision: {counts["no_rung"]} accepted a proposal with no rung, '
        f'{counts["free"]} named a family or a note rather than a rung\n'
        f'  {total} rows checked, positional join verified on {len(MATCH)} columns\n'
        f'wrote {OUT}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
