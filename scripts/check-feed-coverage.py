#!/usr/bin/env python3
"""The roster the scrapers walk and the roster the Worker pulls must be the same.

THE FAILURE THIS EXISTS TO CATCH. Adding a company to the roster makes it appear
on the map immediately — it gets a pin, a card and a place in the counts.
Whether anything actually SEARCHES for it is a separate question, and nothing
connects the two. So a new employer can sit on the map showing zero open roles,
indefinitely, and look like a company that simply is not hiring.

TWO INDEPENDENT COMPOSITIONS, WHICH IS THE WHOLE PROBLEM. The same roster is
assembled twice, in two languages, from the same source modules:

  * workers/jobs-cron/index.ts   const AU_JOBS_TARGETS = [...AU_LISTED,
                                   ...TOP_PRIVATE_TARGETS]   -> the daily Adzuna
                                   pull, and the advertiser gate
  * scripts/roster.ts           [...AU_JOBS_TARGETS, ...TOP_PRIVATE_TARGETS]
                                   -> every Python driver (indeed, linkedin,
                                   jora, simplyhired, brightdata, ...)

Add a NEW CATEGORY of company — a third data file — and you must remember both.
Wire it into one and the other silently disagrees: the companies exist on the
map and half the pipeline never looks for them. Neither side errors, because
each is internally consistent. This check is the thing that notices.

WHAT THIS FILE USED TO SAY, AND WHY IT WAS WRONG. It compared the roster against
the auJobsTargets.ts FILE alone and reported the Top-150 private companies as a
permanent 150-company hole in the Adzuna coverage. That was a misreading: the
Worker composes that file PLUS topPrivateCompanies.ts, so those companies are
searched like any other. The archive says so plainly — 5,725 Adzuna rows across
120 priv-* companies on 2026-08-12, led by Perth Airport (261) and St John of
God Health Care (219). A check that reports a healthy feed as broken is worse
than no check, because it trains everyone to ignore its output.

Career portals (workers/jobs-cron/careerSites.ts) are deliberately NOT checked:
each needs a hand-measured ATS tenant URL, so "every company has a portal" can
never be true and asserting it would be permanent noise.

Run: python scripts/check-feed-coverage.py
"""
from __future__ import annotations
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from roster import load_roster  # noqa: E402

# The Worker's own composition, evaluated rather than pattern-matched. Reading
# it any other way is the exact mistake this file was written to stop repeating:
# TOP_PRIVATE_TARGETS is built by `RAW.map(buildPrivate)`, so its ids do not
# exist as literals anywhere and a regex over the source cannot see them.
WORKER_TARGETS_TS = """
import { AU_JOBS_TARGETS as AU_LISTED } from "./src/employsi/data/auJobsTargets";
import { TOP_PRIVATE_TARGETS } from "./src/employsi/data/topPrivateCompanies";
import { UNIVERSITY_TARGETS } from "./src/employsi/data/universityTargets";
const all = [...AU_LISTED, ...TOP_PRIVATE_TARGETS, ...UNIVERSITY_TARGETS];
console.log(JSON.stringify(all.map((t) => t.id)));
"""


def worker_target_ids() -> set[str]:
    """The ids the jobs-cron Worker will actually pull, by running its imports."""
    path = os.path.join(ROOT, '.feed-coverage-probe.ts')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(WORKER_TARGETS_TS)
    try:
        out = subprocess.run(['bun', 'run', path], cwd=ROOT,
                             capture_output=True, text=True, timeout=120)
        if out.returncode != 0:
            sys.exit(f'Could not evaluate the Worker roster:\n{out.stderr[-800:]}')
        return set(json.loads(out.stdout.strip().splitlines()[-1]))
    finally:
        os.remove(path)


def main() -> int:
    roster = {c['id']: c['name'] for c in load_roster()}
    worker = worker_target_ids()

    missing = sorted(set(roster) - worker)      # walked by Python, never pulled
    extra = sorted(worker - set(roster))        # pulled, but not on the map

    print(f'roster.ts (Python drivers)    : {len(roster)}')
    print(f'jobs-cron Worker (Adzuna)     : {len(worker)}')
    print(f'in roster but not the Worker  : {len(missing)}')
    print(f'in the Worker but not roster  : {len(extra)}')

    if missing:
        print('\nFAIL: on the map and walked by the Python feeds, but the Worker')
        print('never pulls them — so their cards miss the daily Adzuna vacancies:')
        for cid in missing[:40]:
            print(f'  {cid:32} {roster[cid]}')
        if len(missing) > 40:
            print(f'  ... and {len(missing) - 40} more')
    if extra:
        print('\nFAIL: the Worker pulls these, but they are not on the roster the')
        print('Python drivers walk — so every other feed skips them:')
        for cid in extra[:40]:
            print(f'  {cid:32}')
        if len(extra) > 40:
            print(f'  ... and {len(extra) - 40} more')

    if missing or extra:
        print(
            '\nA new category of company has to be added in BOTH places:\n'
            '  workers/jobs-cron/index.ts   (AU_JOBS_TARGETS)\n'
            '  scripts/roster.ts            (the array it composes)\n'
            'Wiring only one leaves companies on the map that half the pipeline\n'
            'never searches for, and nothing else reports it.'
        )
        return 1

    print('\nBoth compositions cover the same companies.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
