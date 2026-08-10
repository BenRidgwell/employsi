#!/usr/bin/env python3
"""Every rostered company must be reachable by the keyword feeds.

THE FAILURE THIS EXISTS TO CATCH. Adding a company to the roster makes it appear
on the map immediately — it gets a pin, a card and a place in the counts. Whether
any job board is actually SEARCHED for it is a separate question, and nothing
used to connect the two. So a new employer could sit on the map showing zero
open roles, indefinitely, and look like a company that simply is not hiring.

TWO KINDS OF FEED, ONLY ONE OF WHICH SELF-UPDATES.

  * The Python drivers (indeed, linkedin, jora, simplyhired, jobsdb, jobstreet,
    naukri, startupjobs, brightdata) call roster.load_roster() at run time, so a
    new company is picked up on the next run with no action at all.

  * The daily Adzuna pull in the Worker reads a GENERATED file,
    src/employsi/data/auJobsTargets.ts, written by scripts/gen-asx200.py. A
    company added to the roster is invisible to Adzuna until that generator is
    re-run and its output committed. Nothing enforced that, which is the gap.

  * Career portals (workers/jobs-cron/careerSites.ts) are deliberately NOT
    checked here. Each needs a hand-measured ATS tenant URL, so "every rostered
    company has a portal" is not a thing that can ever be true, and asserting it
    would be permanent noise.

THE RATCHET. There is already a large gap — the Top-150 private roster is
missing from the Adzuna targets — and this check does not pretend otherwise or
fail forever because of it. That set is recorded in BASELINE_GAP below, printed
on every run so it stays visible, and anything OUTSIDE it fails. So the check
answers the question it was written for — "does a NEW company reach the feeds?"
— without blocking on a pre-existing decision nobody has taken yet.

Run: python scripts/check-feed-coverage.py
"""
from __future__ import annotations
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from roster import load_roster  # noqa: E402

TARGETS_TS = os.path.join(ROOT, 'src', 'employsi', 'data', 'auJobsTargets.ts')

# The gap as it stood on 2026-08-10: every company on the Top-150 PRIVATE
# roster. They are absent because gen-asx200.py parses the TypeScript with a
# regex, and the private roster is built by `RAW.map(buildPrivate)` — its ids
# only exist once the module has RUN, so a regex cannot see them. The same flaw
# is documented in roster.py, which is why that file shells out to bun instead.
#
# This is recorded, not endorsed. Closing it means deciding to search Adzuna for
# 150 more employers, which costs request volume — a call for whoever owns that
# budget, not something to slip in behind a lint fix.
BASELINE_GAP_PREFIX = 'priv-'


def target_ids() -> set[str]:
    with open(TARGETS_TS, encoding='utf-8') as f:
        return set(re.findall(r'id:\s*"([^"]+)"', f.read()))


def main() -> int:
    roster = {c['id']: c['name'] for c in load_roster()}
    targets = target_ids()
    missing = sorted(set(roster) - targets)

    baseline = [m for m in missing if m.startswith(BASELINE_GAP_PREFIX)]
    unexpected = [m for m in missing if not m.startswith(BASELINE_GAP_PREFIX)]

    print(f'roster companies              : {len(roster)}')
    print(f'auJobsTargets.ts (Adzuna)     : {len(targets)}')
    print(f'known gap (private roster)    : {len(baseline)}')
    print(f'unexpected gap                : {len(unexpected)}')

    if baseline:
        print(
            f'\n  NOTE: {len(baseline)} private-roster companies are not searched on '
            f'Adzuna.\n  They are on the map and in the Python feeds, but the daily '
            f'Adzuna pull\n  never asks for them. Re-running scripts/gen-asx200.py '
            f'does not fix it —\n  that generator regexes the TypeScript and cannot '
            f'see a roster built at\n  run time. See roster.py for the same lesson.'
        )

    if unexpected:
        print('\nFAIL: these companies are on the roster but no keyword feed target:')
        for cid in unexpected:
            print(f'  {cid:28} {roster[cid]}')
        print(
            '\nA company with no target sits on the map showing zero open roles and\n'
            'reads as an employer that is not hiring. Add it to the Adzuna targets\n'
            '(scripts/gen-asx200.py) or, if it is deliberately excluded, say so here.'
        )
        return 1

    print('\nEvery rostered company outside the recorded gap has a feed target.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
