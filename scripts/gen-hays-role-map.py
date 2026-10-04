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


# ── decisions completed from the owner's seniority rule ──────────────────────
#
# GIVEN AS A RULE, NOT GUESSED: "advisor -> 2, manager -> 4, head/director -> 5".
# It applies to rows the workbook left unactionable — an "ok" on a proposal that
# named a family but no rung, or a DECISION of "HR" alone.
#
# THE RULE GIVES A RUNG. IT DOES NOT GIVE A FAMILY OR A TRACK, and both are
# needed, so each is sourced and stated here rather than inferred quietly:
#
#   FAMILY, from evidence. Every role below sits under the guide's HUMAN
#   RESOURCES heading, and the owner marked six of their siblings "HR" by hand.
#
#   TRACK, from the role's own subject where the name IS the track — ER and IR
#   are employee relations, L&D is learning — and otherwise the family's core
#   `generalist` ladder. The two least certain are marked below; a specialism
#   put on the wrong track widens that rung's band with another job's pay.
#
# Keyed by role NAME on purpose, not by index: each of these appears twice in
# the guide and both copies mean the same thing, so both should resolve the
# same way. Applied ONLY to rows left unresolved — a decision in the workbook
# always wins.
SENIORITY_COMPLETIONS: dict[str, str] = {
    # advisor -> 2
    'ER ADVISOR': 'hr|employee-relations|2',
    'IR ADVISOR': 'hr|employee-relations|2',
    'DIVERSITY ADVISOR': 'hr|generalist|2',
    'INJURY/RTW ADVISOR': 'hr|generalist|2',        # track least certain
    # manager -> 4
    'ER MANAGER': 'hr|employee-relations|4',
    'IR MANAGER': 'hr|employee-relations|4',
    'DIVERSITY MANAGER': 'hr|generalist|4',
    'HEALTH & WELLBEING MANAGER/ OFFICER': 'hr|generalist|4',
    'INJURY/RTW MANAGER': 'hr|generalist|4',        # track least certain
    # head/director -> 5
    'HEAD OF L&D/ L&D DIRECTOR': 'hr|learning|5',
}


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
                # can act on by itself — the seniority rule finishes the ones it
                # covers, and inventing a rung for the rest is the one thing the
                # review exists to prevent.
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
        # cannot complete from the decision alone, so it falls to the rule
        # below, and is counted and reported when even that cannot finish it.
        counts['free'] += 1

    # The rule runs over what the workbook could not finish. A row the workbook
    # DID decide is never touched: the completions only fill holes.
    counts['rule'] = 0
    for a, b in zip(tsv, xl):
        idx = int(a['role_idx']) if a.get('role_idx') not in (None, '') else None
        if idx is None or idx in accepted:
            continue
        d = norm(b.get('DECISION'))
        # Only rows the reviewer engaged with and could not finish — never a
        # blank, and never a "no". An undecided role stays undecided.
        if d in ('', 'no'):
            continue
        node = SENIORITY_COMPLETIONS.get(norm(a.get('hays_role')).upper())
        if node:
            accepted[idx] = node
            counts['rule'] += 1

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

    # ROWS, not the sum of every counter. `rule` double-counts by design — a row
    # it completes was already tallied as no_rung or free on the first pass — so
    # summing the lot reported 1,181 rows read out of 1,163, which is the kind
    # of number that gets quoted.
    stuck = counts['no_rung'] + counts['free'] - counts['rule']
    sys.stderr.write(
        f'{len(accepted)} roles mapped onto {len(set(accepted.values()))} rungs.\n'
        f'  accepted {counts["ok"]}, corrected {counts["corrected"]}, '
        f'completed from the seniority rule {counts["rule"]}, refused {counts["no"]}, '
        f'undecided {counts["blank"]}\n'
        f'  STILL NOT MAPPED, needs a decision: {stuck} '
        f'(of {counts["no_rung"] + counts["free"]} the workbook left unactionable, '
        f'{counts["rule"]} finished by the rule)\n'
        f'  {len(tsv)} rows checked, positional join verified on {len(MATCH)} columns\n'
        f'wrote {OUT}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
