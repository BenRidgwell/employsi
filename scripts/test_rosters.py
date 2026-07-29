#!/usr/bin/env python3
"""
Every scraper's company roster must be non-empty.

WHY
Several scrapers read their target list by regexing a TypeScript data file.
That works until the file is reformatted — and it was. Prettier rewrote
seekAdvertisers.ts and chinaJobsTargets.ts to double-quoted keys and values,
both patterns assumed single quotes, and both loaders silently went to zero.
The scrapers then walked no companies, archived nothing, and exited 0. SEEK and
Zhaopin reported four consecutive days of successful runs while writing not one
row; only a query against the archive showed it.

The loaders now fail loudly on an empty roster, but that only turns a silent
outage into a nightly red run. This test is the earlier gate: it fails on the
PUSH that reformats the file, before a single scheduled run is lost.

The counts are floors, not exact figures — a roster legitimately grows and
shrinks. What is being asserted is "this parser still understands this file",
and a floor well below today's count says that without breaking every time a
company is added or removed.

Run: python scripts/test_rosters.py
"""
from __future__ import annotations
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

# The scrapers exit at import when the D1 token is absent, which is right for a
# real run and useless here — this test never touches D1, it only exercises the
# file parsers. A placeholder satisfies the guard without granting anything.
os.environ.setdefault('CLOUDFLARE_API_TOKEN', 'test-only-not-a-credential')

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = '') -> None:
    print(f'  {"ok  " if ok else "FAIL"}  {label}{"  — " + detail if detail else ""}')
    if not ok:
        FAILS.append(label)


def load_module_head(path: str, name: str):
    """Exec a scraper's module-level definitions WITHOUT running main().

    The scrapers parse sys.argv at import time and some exit when a token is
    missing, so they cannot simply be imported here. Everything above `def
    main(` is the parsing layer, which is what this test is about.
    """
    src = open(os.path.join(ROOT, path), encoding='utf-8').read()
    head = src.split('def main(')[0]
    ns: dict = {'__name__': name, '__file__': os.path.join(ROOT, path),
                'os': os, 're': re, 'sys': sys}
    exec(compile(head, path, 'exec'), ns)  # noqa: S102 — our own source, not input
    return ns


print('Roster parsers\n')

# (script, loader name, floor, what it reads)
CASES = [
    ('scripts/seek-to-d1.py', 'load_advertisers', 80, 'seekAdvertisers.ts'),
    ('scripts/zhaopin-to-d1.py', 'load_targets', 30, 'chinaJobsTargets.ts'),
]

for path, fn_name, floor, source_file in CASES:
    label = f'{os.path.basename(path)} {fn_name}() reads {source_file}'
    try:
        ns = load_module_head(path, f'_t_{fn_name}')
        rows = ns[fn_name]()
        n = len(rows)
        check(label, n >= floor, f'{n} entries (floor {floor})')
    except Exception as e:  # noqa: BLE001
        check(label, False, f'raised {type(e).__name__}: {e}')

# The same file, parsed two ways: if the loader's count is wildly below the
# number of entries visibly in the file, the pattern is matching only some
# shapes — the half-broken case, which is easier to miss than a clean zero.
try:
    txt = open(os.path.join(ROOT, 'src/employsi/data/chinaJobsTargets.ts'), encoding='utf-8').read()
    body = txt.split('CHINA_JOBS_TARGETS: ChinaJobTarget[] = [')[1].split('\n];')[0]
    in_file = body.count('{ id:')
    ns = load_module_head('scripts/zhaopin-to-d1.py', '_t_cross')
    parsed = len(ns['load_targets']())
    check('zhaopin parses every entry in the array', parsed == in_file,
          f'{parsed} parsed vs {in_file} in the file')
except Exception as e:  # noqa: BLE001
    check('zhaopin cross-check', False, f'raised {type(e).__name__}: {e}')

print()
if FAILS:
    print(f'{len(FAILS)} FAILED: {FAILS}')
    raise SystemExit(1)
print('All roster tests passed.')
