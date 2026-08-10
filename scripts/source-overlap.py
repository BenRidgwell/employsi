#!/usr/bin/env python3
"""What would we lose by dropping a source? Overlap and uniques across the archive.

THE QUESTION THIS ANSWERS
Every source costs something — a subscription, a runner-hour, a maintenance
burden — and the only honest measure of what it is worth is how many roles it
contributes that NOTHING ELSE HOLDS. "LinkedIn returns 8,000 rows" is not that
number; most of those rows may also arrive from Indeed, SEEK, a career portal or
Adzuna, in which case dropping LinkedIn costs nothing but the duplicate.

HOW A ROLE IS MATCHED ACROSS SOURCES — AND WHY THE OBVIOUS KEY DOES NOT WORK.
`job_key` is `source|normTitle|normCompany|normLocation` (see
src/employsi/lib/jobArchive.ts), so the part after the first pipe LOOKS like a
source-independent identity for the role. This script asserted exactly that, and
the first run disproved it: every source came back ~100% unique, and LinkedIn
and Indeed shared none of 2,658 and 4,267 roles at the same employers. Sampling
the raw keys showed why — the strings are not the same strings:

    adzuna    | managing partner bhp                | bhp | perth cbd perth
    adzuna    | electricians bhp shutdowns          | bhp | port hedland port hedland area
    adzuna    | fifo carpenter bhp od south 14 14   | bhp | australia

Titles are whatever the advertiser wrote (recruiters repeat the employer name in
the title and bolt the roster onto it), and locations are whatever granularity
the board uses — "perth cbd perth" on Adzuna, "Perth WA" on Indeed, "Perth,
Western Australia, Australia" on LinkedIn. An exact suffix match therefore
measures string agreement between scrapers, not whether two boards carry the
same vacancy, and it answers "how unique is this source?" with "very" every
time.

So the suffix key is NOT used. A role's identity here is:

    company_id + normalised title, with the location dropped and the employer's
    own name removed from the title

which is looser than the archive's own dedupe key and deliberately so — it can
merge two genuinely different vacancies with the same title at one employer, and
that error runs TOWARDS finding overlap. Uniqueness figures from it are
therefore an UPPER BOUND on what a source really adds: if it says LinkedIn holds
few unique roles, that is trustworthy; if it says LinkedIn holds many, some of
those are title-wording differences rather than real vacancies. Both figures are
printed so the gap is visible.

TWO FURTHER CAVEATS THIS PRINTS RATHER THAN HIDES.

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
# --sample: dump raw job_keys for one company and stop. Evidence before theory.
SAMPLE = '--sample' in args
COMPANY = _opt('--company', 'bhp')

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


# The archive's own key, split back into its parts. `rest` is everything after
# the source prefix; `title` and `comp` are its first two fields.
_SPLIT = """
  SELECT source, company_id,
         substr(rest, 1, instr(rest, '|') - 1) AS title,
         substr(substr(rest, instr(rest, '|') + 1), 1,
                instr(substr(rest, instr(rest, '|') + 1), '|') - 1) AS comp
  FROM (SELECT source, company_id,
               substr(job_key, instr(job_key, '|') + 1) AS rest
        FROM jobs WHERE last_seen >= date('now', ?1))
"""

# STRICT: the whole suffix, byte for byte. Kept only to print alongside the
# loose figure, because the distance between the two IS the measurement error.
LIVE_STRICT = ("SELECT source, company_id, "
               "substr(job_key, instr(job_key, '|') + 1) AS role_key "
               "FROM jobs WHERE last_seen >= date('now', ?1)")

# LOOSE: company_id + title, location dropped, and the employer's own name
# removed from the title as a whitespace-delimited run — recruiters routinely
# put it there ("managing partner bhp", "electricians bhp shutdowns") and Indeed
# and the career portals do not.
LIVE_LOOSE = f"""
SELECT source, company_id,
       company_id || '|' ||
       trim(replace(' ' || title || ' ', ' ' || comp || ' ', ' ')) AS role_key
FROM ({_SPLIT})
"""

LIVE = LIVE_LOOSE


def sample_keys(company: str = 'bhp', per_source: int = 6) -> None:
    """Print raw job_keys for one company, a few from EVERY source that has any.

    WHY THIS EXISTS. The first run of this script reported ~100% unique for
    EVERY source and zero overlap between LinkedIn and Indeed across thousands
    of roles for the same employers. That is not a finding, it is a broken
    measurement — so the next step is to look at the keys rather than to theorise
    about them.

    A flat `ORDER BY source LIMIT 40` is not enough and the first attempt proved
    it: 40 rows of adzuna and not one row of the two sources under comparison.
    Sampling is per-source for that reason.
    """
    print(f'\n{"=" * 78}\nRAW job_key SAMPLES for company_id={company}\n{"=" * 78}')
    srcs = d1('SELECT source, COUNT(*) n FROM jobs WHERE company_id = ?1 '
              'GROUP BY source ORDER BY n DESC', [company])
    if not srcs:
        print(f'  (no rows for {company} — try another company_id)')
        return
    for s in srcs:
        rows = d1('SELECT job_key FROM jobs WHERE company_id = ?1 AND source = ?2 '
                  'ORDER BY last_seen DESC LIMIT ?3', [company, s['source'], per_source])
        print(f'\n  --- {s["source"]}  ({s["n"]:,} rows) ---')
        for r in rows:
            print(f'    {r["job_key"][:130]}')


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
    print('\n  (matched on company_id + title, employer name stripped, '
          'location ignored)')
    print(f'\n{"source":<22}{"rows":>9}{"only here":>11}{"unique %":>10}{"companies":>11}')
    for r in rows:
        pct = 100.0 * r['only_here'] / r['total'] if r['total'] else 0
        print(f'{r["source"]:<22}{r["total"]:>9,}{r["only_here"]:>11,}'
              f'{pct:>9.1f}%{r["companies"]:>11}')

    # The pairwise question: if we kept only ONE of these two, what is lost?
    # Answered under BOTH keys. The strict figure is the one that reported no
    # overlap at all; printing the two together shows how much of a source's
    # apparent uniqueness was only the two scrapers wording a title differently.
    if len(PAIR) == 2 and all(PAIR):
        a, b = PAIR[0].strip(), PAIR[1].strip()
        for label, sql in (('title match, employer name stripped', LIVE_LOOSE),
                           ('exact job_key suffix (known to over-count)', LIVE_STRICT)):
            print(f'\n--- {a} vs {b}, in this window [{label}] ---')
            for x, y in ((a, b), (b, a)):
                q = d1(
                    f'WITH live AS ({sql}) '
                    'SELECT COUNT(*) n FROM ('
                    '  SELECT role_key FROM live WHERE source = ?2 '
                    '  EXCEPT SELECT role_key FROM live WHERE source = ?3)',
                    [win, x, y])
                tot = d1(f'WITH live AS ({sql}) '
                         'SELECT COUNT(DISTINCT role_key) n FROM live WHERE source = ?2',
                         [win, x])
                n, t = q[0]['n'], tot[0]['n']
                pct = 100.0 * n / t if t else 0
                print(f'  roles {x} has that {y} does not : {n:,} of {t:,} ({pct:.1f}%)')
            # And what neither would cover that the rest of the archive does.
            both = d1(
                f'WITH live AS ({sql}) '
                'SELECT COUNT(*) n FROM ('
                '  SELECT role_key FROM live WHERE source IN (?2, ?3) '
                '  EXCEPT SELECT role_key FROM live WHERE source NOT IN (?2, ?3))',
                [win, a, b])
            print(f'  roles ONLY {a}+{b} hold (no other source): {both[0]["n"]:,}')

        # Do the two sources even cover the same employers? If they do not,
        # nothing above is about duplication — it is about different companies.
        cov = d1(
            f'WITH live AS ({LIVE_LOOSE}) '
            'SELECT (SELECT COUNT(DISTINCT company_id) FROM live WHERE source = ?2) a, '
            '       (SELECT COUNT(DISTINCT company_id) FROM live WHERE source = ?3) b, '
            '       (SELECT COUNT(*) FROM ('
            '          SELECT company_id FROM live WHERE source = ?2 '
            '          INTERSECT SELECT company_id FROM live WHERE source = ?3)) shared',
            [win, a, b])[0]
        print(f'\n  employers: {a} {cov["a"]}, {b} {cov["b"]}, '
              f'in both {cov["shared"]}')


def main() -> int:
    if SAMPLE:
        sample_keys(COMPANY)
        return 0
    for d in sorted({1, DAYS}):
        report(d)
    print('\nA source with few "only here" rows is one the archive already covers '
          'elsewhere.\nCheck its newest date above before concluding that — a feed '
          'that stopped\nrunning contributes nothing and looks identical to one that '
          'was redundant.\n\nThe "only here" counts are an UPPER BOUND: two boards '
          'wording the same vacancy\ndifferently still count as two roles, so a high '
          'figure may be wording rather\nthan coverage. A low figure is the trustworthy '
          'direction.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
