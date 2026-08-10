#!/usr/bin/env python3
"""What would we lose by dropping a source? Overlap and uniques across the archive.

THE QUESTION THIS ANSWERS
Every source costs something — a subscription, a runner-hour, a maintenance
burden — and the only honest measure of what it is worth is how many roles it
contributes that NOTHING ELSE HOLDS. "LinkedIn returns 8,000 rows" is not that
number; most of those rows may also arrive from Indeed, SEEK, a career portal or
Adzuna, in which case dropping LinkedIn costs nothing but the duplicate.

HOW A ROLE IS MATCHED ACROSS SOURCES, exactly.
`job_key` is `source|normTitle|normCompany|normLocation` (see
src/employsi/lib/jobArchive.ts). Everything after the FIRST pipe is therefore a
source-independent identity for the role, and two sources holding the same
vacancy produce the same suffix. That is not an approximation — it is the same
key the archive already dedupes on within a source.

    substr(job_key, instr(job_key, '|') + 1)

TWO CAVEATS THIS PRINTS RATHER THAN HIDES.

1. A BROKEN FEED LOOKS LIKE A WORTHLESS ONE. A source that has not run recently
   contributes nothing to a "currently advertised" window, which reads exactly
   like a source whose rows were all duplicates. The report shows each source's
   last_seen date and row count so a dead feed is visible before its uniqueness
   is judged. On 2026-08-09 both Indeed and Zhaopin were dead (Oxylabs quota),
   and reading a live window that day would have said "drop them" about feeds
   that were simply switched off.

2. THE WINDOW CHANGES THE ANSWER. --days 1 is "currently advertised" and is the
   right frame for what the map shows today; --days 90 is the right frame for
   what a source has contributed over its life. Both are printed.

Read-only. It issues SELECTs and writes nothing.

Env: CLOUDFLARE_API_TOKEN (D1 read), CF_ACCOUNT_ID, D1_DATABASE_ID
Run: python scripts/source-overlap.py
     python scripts/source-overlap.py --days 30 --pair linkedin,indeed
"""
from __future__ import annotations
import json
import os
import sys
import urllib.request

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


DAYS = int(_opt('--days', 30))
PAIR = (_opt('--pair', 'linkedin,indeed') or '').split(',')

if not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (D1 read).')


def d1(sql: str, params: list | None = None):
    body = json.dumps({'sql': sql, 'params': params or []}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        j = json.loads(r.read().decode())
    if not j.get('success'):
        sys.exit(f'D1 error: {str(j.get("errors"))[:300]}')
    return j['result'][0]['results']


# Everything after the first pipe: the role identity, minus which source saw it.
ROLE = "substr(job_key, instr(job_key, '|') + 1)"
LIVE = f"SELECT source, company_id, {ROLE} AS role_key FROM jobs " \
       f"WHERE last_seen >= date('now', ?1)"


def report(days: int) -> None:
    win = f'-{days} day'
    print(f'\n{"=" * 78}\nROWS SEEN IN THE LAST {days} DAY(S)\n{"=" * 78}')

    # HEALTH FIRST. A source that stopped running has no rows to be unique, and
    # that is not the same finding as a source whose rows were all duplicates.
    health = d1(
        'SELECT source, COUNT(*) n, MAX(last_seen) newest, MIN(first_seen) oldest, '
        'COUNT(DISTINCT company_id) companies FROM jobs GROUP BY source ORDER BY n DESC')
    print(f'\n{"source":<22}{"rows(all time)":>15}{"companies":>11}  {"newest":<12}{"oldest":<12}')
    for r in health:
        print(f'{r["source"]:<22}{r["n"]:>15,}{r["companies"]:>11}  '
              f'{str(r["newest"] or "-"):<12}{str(r["oldest"] or "-"):<12}')

    rows = d1(
        f'WITH live AS ({LIVE}), '
        'shared AS (SELECT role_key, COUNT(DISTINCT source) n FROM live GROUP BY role_key) '
        'SELECT l.source, COUNT(*) total, '
        '       SUM(CASE WHEN s.n = 1 THEN 1 ELSE 0 END) only_here, '
        '       COUNT(DISTINCT l.company_id) companies '
        'FROM live l JOIN shared s ON s.role_key = l.role_key '
        'GROUP BY l.source ORDER BY only_here DESC', [win])
    if not rows:
        print(f'\n  No rows in this window at all.')
        return
    print(f'\n{"source":<22}{"rows":>9}{"only here":>11}{"unique %":>10}{"companies":>11}')
    for r in rows:
        pct = 100.0 * r['only_here'] / r['total'] if r['total'] else 0
        print(f'{r["source"]:<22}{r["total"]:>9,}{r["only_here"]:>11,}'
              f'{pct:>9.1f}%{r["companies"]:>11}')

    # The pairwise question: if we kept only ONE of these two, what is lost?
    if len(PAIR) == 2 and all(PAIR):
        a, b = PAIR[0].strip(), PAIR[1].strip()
        print(f'\n--- {a} vs {b}, in this window ---')
        for x, y in ((a, b), (b, a)):
            q = d1(
                f'WITH live AS ({LIVE}) '
                'SELECT COUNT(*) n FROM ('
                '  SELECT role_key FROM live WHERE source = ?2 '
                '  EXCEPT SELECT role_key FROM live WHERE source = ?3)',
                [win, x, y])
            tot = d1(f'WITH live AS ({LIVE}) '
                     'SELECT COUNT(DISTINCT role_key) n FROM live WHERE source = ?2',
                     [win, x])
            n, t = q[0]['n'], tot[0]['n']
            pct = 100.0 * n / t if t else 0
            print(f'  roles {x} has that {y} does not : {n:,} of {t:,} ({pct:.1f}%)')
        # And what neither would cover that the rest of the archive does.
        both = d1(
            f'WITH live AS ({LIVE}) '
            'SELECT COUNT(*) n FROM ('
            '  SELECT role_key FROM live WHERE source IN (?2, ?3) '
            '  EXCEPT SELECT role_key FROM live WHERE source NOT IN (?2, ?3))',
            [win, a, b])
        print(f'  roles ONLY {a}+{b} hold (no other source): {both[0]["n"]:,}')


def main() -> int:
    for d in sorted({1, DAYS}):
        report(d)
    print('\nA source with few "only here" rows is one the archive already covers '
          'elsewhere.\nCheck its newest date above before concluding that — a feed '
          'that stopped\nrunning contributes nothing and looks identical to one that '
          'was redundant.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
