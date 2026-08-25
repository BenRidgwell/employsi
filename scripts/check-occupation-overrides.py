#!/usr/bin/env python3
"""The ATO-variance overrides must stay no-ops for the IVI and ABS generators.

THE FAILURE THIS EXISTS TO CATCH. OVERRIDE in gen-ivi-skill-demand.py is shared:
the IVI demand generator, the ABS supply generator and the ATO salary baseline
all read it, keyed on ANZSCO4. That sharing is deliberate — a vacancy rate whose
numerator and denominator were attributed differently is two questions divided
by each other — but it means an entry added for ONE dataset's benefit silently
edits the other two.

Most of OVERRIDE corrects the matcher, and changing those is the point. The
block at the end does something narrower: it exists only because the ATO labels
a code differently from the ABS ("Kitchen hand" against "Kitchenhands", "Café or
restaurant manager" against "Cafe and restaurant managers"), so term-matching
the ATO name lost occupations that matching the ABS name had always found.

Each of those entries was chosen to be EXACTLY what skills_for() already returns
for that code's ABS label. An override short-circuits term matching, so as long
as that equality holds the IVI and ABS series are bit-identical to what they
were before the block existed, and only the ATO side changes. The moment it
stops holding — a term added to the taxonomy, a skill renamed, a category
split — the override stops agreeing with the label beside it and the two
datasets quietly diverge, with nothing on either card to show it.

So this asserts the equality directly, and it is worth having precisely because
neither dataset would look wrong if it broke: the ABS series would still render
a plausible employment figure, attributed to a skill nobody chose.

THE LABELS ARE A MEASUREMENT, NOT A GUESS. ABS_LABEL below is transcribed from
ABS Employee Earnings and Hours, May 2025, data cube 63060DO011 Table 1, which
publishes at ANZSCO4. It is pinned here rather than read from the workbook
because the workbook is not in the repo — this file has to run in CI with no
network. If the ABS restates a label, this fixture is what needs updating, and
the diff will say so plainly.

Run: python3 scripts/check-occupation-overrides.py
"""
from __future__ import annotations
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from skills_taxonomy import matcher  # noqa: E402

TAX = os.path.join(ROOT, 'src/employsi/data/skillsTaxonomy.ts')

# ANZSCO4 -> the label the ABS publishes for it (EEH May 2025, 63060DO011 T1).
# Only the codes the ATO-variance block covers are listed; the rest of OVERRIDE
# is a matcher correction and is deliberately not constrained by this check.
ABS_LABEL = {
    '8513': 'Kitchenhands',
    '1351': 'ICT managers',
    '5521': 'Bank workers',
    '4312': 'Cafe workers',
    '1411': 'Cafe and restaurant managers',
    '8322': 'Product assemblers',
    '3423': 'Electronics trades workers',
    '8219': 'Other construction and mining labourers',
    '1336': 'Supply, distribution and procurement managers',
    '2491': 'Education advisers and reviewers',
    '1413': 'Hotel and motel managers',
    '2533': 'Specialist physicians',
    '3241': 'Panelbeaters',
    '6394': 'Ticket salespersons',
    '8992': 'Deck and fishing hands',
    '2511': 'Nutrition professionals',
    '4115': 'Indigenous health workers',
    '7123': 'Engineering production workers',
    '5615': 'Survey interviewers',
    '2122': 'Authors, and book and script editors',
    '6395': 'Visual merchandisers',
}


def load_override() -> dict:
    """OVERRIDE from the IVI generator, by path — the filename has hyphens, so
    it cannot be imported by name. Same loader gen-abs-occupation-supply.py
    uses, for the same reason."""
    path = os.path.join(HERE, 'gen-ivi-skill-demand.py')
    spec = importlib.util.spec_from_file_location('gen_ivi', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.OVERRIDE


def main() -> int:
    skills_for = matcher(TAX)
    override = load_override()

    missing: list[str] = []
    drifted: list[tuple[str, str, list[str], list[str]]] = []

    for code, label in sorted(ABS_LABEL.items()):
        if code not in override:
            missing.append(code)
            continue
        want = skills_for(label)
        got = override[code]
        if sorted(got) != sorted(want):
            drifted.append((code, label, got, want))

    if missing:
        print('These codes are in the ABS_LABEL fixture but no longer in OVERRIDE:')
        for c in missing:
            print(f'  {c}  ({ABS_LABEL[c]})')
        print(
            '\nRemoving one is fine, but then remove it here too — otherwise this\n'
            'check is asserting a relationship nothing else believes in.'
        )

    if drifted:
        print('An ATO-variance override no longer matches its ABS label:\n')
        for code, label, got, want in drifted:
            print(f'  {code}  ABS label: {label!r}')
            print(f'        OVERRIDE says : {got}')
            print(f'        the label maps: {want or "(nothing)"}')
        print(
            '\nThese entries are only safe because they are no-ops for the IVI and\n'
            'ABS generators — each one has to equal what the ABS label already\n'
            'matched. A disagreement means adding it CHANGED those two datasets,\n'
            'which is exactly what the block promises it does not do.\n'
            '\nIf the taxonomy edit was intended, update the override to the new\n'
            'value and regenerate absOccupationSupply.ts and iviSkillDemand.ts so\n'
            'the published files actually carry it.'
        )

    if missing or drifted:
        return 1

    print(
        f'All {len(ABS_LABEL)} ATO-variance overrides still agree with their ABS '
        'labels —\nthe IVI and ABS attributions are unchanged by them.'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
