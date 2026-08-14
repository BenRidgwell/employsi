#!/usr/bin/env python3
"""
Health check across every job-board scraper feeding the D1 archive.

WHY THIS EXISTS
Two real failures motivated it, and neither raised an error anywhere:

  * The Queensland government board stopped writing on 26 July and nobody
    noticed for three days. Its cursor had walked past the end of the board and
    the walk stalled; every run "succeeded" and archived nothing.
  * Indeed re-nested its salary markup, and the scraper went on archiving 3,277
    rows a day with the salary column empty. Row counts looked perfect.

Both are invisible to a scraper's own exit code, because from the scraper's
point of view nothing went wrong. They are only visible in the SHAPE of what
lands in the archive over time, which is what this checks.

WHAT IT CHECKS, AND AGAINST WHAT
Every check compares a source against ITS OWN recent history rather than
against a global standard, because the sources legitimately differ: 100% of
MyCareersFuture rows carry a salary and ~0% of Jora's do, and neither is a
fault. A fixed threshold would either cry wolf on Jora or stay silent on
MyCareersFuture.

  STALE            nothing written for longer than the source's cadence allows.
                   This is the check that would have caught Queensland.
  NO ROWS          the source is in the archive but has no rows at all.
  VOLUME COLLAPSE  the latest day's live count is far below the source's own
                   recent median — partial breakage, e.g. paging that dies after
                   page one.
  FIELD REGRESSION a field the source used to populate has stopped arriving:
                   salary, skills, url or hub. Only flagged where the source had
                   a real baseline, so a board that never published salary is
                   never reported for not publishing salary. This is the check
                   that would have caught Indeed.

Exit code is 1 when anything is CRITICAL, so a scheduled run fails loudly
instead of reporting green. WARN alone exits 0 — worth reading, not worth
waking anyone.

Env: CLOUDFLARE_API_TOKEN (D1 read), CF_ACCOUNT_ID, D1_DATABASE_ID
Run: python scripts/scraper-health.py [--json] [--quiet] [--days N]
"""
from __future__ import annotations
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today()

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


AS_JSON = '--json' in args
QUIET = '--quiet' in args
WINDOW = int(_opt('--days', 21))  # days of history the baselines are drawn from

if not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (D1 read).')

# How many days a source may go without writing before it is considered broken.
#
# Most run daily, so 3 days allows one missed run plus a day's slack. The
# rotating-cursor gov boards and the weekly-ish portals get more room. A source
# not listed here uses DEFAULT_STALE_DAYS.
DEFAULT_STALE_DAYS = 3
STALE_DAYS = {
    # Rotating cursors: each run covers a slice, so an individual agency can be
    # quiet for a while even when the source is healthy — but the SOURCE should
    # still write something every day.
    'qld-gov': 3,
    'vic-gov': 3,
    # Career portals run in four grouped ticks; a group is touched daily.
    **{f'portal-{k}': 4 for k in
       ('ef', 'csl', 'av', 'sf', 'wd', 'sy', 'or', 'nx', 'cl', 'gh', 'lh')},
    # startup.jobs: ZERO ROWS IS A NORMAL DAY HERE, and 3 days was crying wolf.
    #
    # Only 59 of the 1,037 rostered employers have a page on that board at all,
    # and they are startups' listings of ASX names — most sit there for weeks
    # without advertising. The 2026-08-13 run read 59 of 59 company pages
    # perfectly, found nothing confirmed advertising, and correctly refused to
    # file /company/igo ("iGo", Pennsylvania, 4 roles) under the ASX company of
    # that name. It was flagged CRITICAL for working exactly as intended.
    #
    # The scraper already fails loudly on the condition that matters — see the
    # `if targets and not pages_read` guard in startupjobs-to-d1.py, which is
    # what a block or a markup change actually looks like. This number is only
    # the long-stop for "the board has gone quiet for an implausible stretch".
    'startupjobs': 14,
}

# Sources that are NOT scheduled, so silence means nothing. TheirStack is an
# on-demand paid backfill; the Muse is a fallback that only fires when Adzuna
# returns nothing for a company; wayback is a one-off historical import whose
# rows are all dated 2018 and which has no workflow to run again — it was
# reporting "no rows written for 3036 days" as CRITICAL every single night,
# which is noise sitting on top of the report people read to find real faults.
ON_DEMAND = {'theirstack', 'muse', 'wayback'}

# A source needs at least this many rows before its baselines mean anything —
# below it, one row moves a percentage by double digits.
MIN_ROWS_FOR_BASELINE = 60

# Field regression: flag when a source's recent rate falls below this fraction
# of its own baseline, and only when the baseline was meaningful to begin with.
REGRESSION_RATIO = 0.5
MIN_BASELINE_RATE = 0.10
RECENT_DAYS = 3

# Volume collapse: the latest day against the median of the days before it.
VOLUME_CRITICAL = 0.25
VOLUME_WARN = 0.55


def d1(sql: str, params: list | None = None):
    body = json.dumps({'sql': sql, 'params': params or []}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.loads(r.read().decode())
                if j.get('success'):
                    return j['result'][0]['results']
                raise RuntimeError(str(j.get('errors')))
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            if attempt == 3:
                raise RuntimeError(f'D1 {e.code}: {detail}')
            time.sleep(attempt + 1)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)
    return []


def days_since(iso: str) -> int:
    try:
        return (TODAY - datetime.date.fromisoformat(iso)).days
    except (ValueError, TypeError):
        return 10**6


def median(xs: list[float]) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


class Finding:
    def __init__(self, source: str, level: str, code: str, detail: str):
        self.source, self.level, self.code, self.detail = source, level, code, detail

    def as_dict(self):
        return {'source': self.source, 'level': self.level,
                'check': self.code, 'detail': self.detail}


def check_freshness(src: str, last_seen: str, findings: list) -> None:
    if src in ON_DEMAND:
        return
    age = days_since(last_seen)
    limit = STALE_DAYS.get(src, DEFAULT_STALE_DAYS)
    if age > limit:
        findings.append(Finding(
            src, 'CRITICAL', 'STALE',
            f'no rows written for {age} days (last {last_seen or "never"}, '
            f'allowed {limit}) — the scraper is failing silently or its walk has stalled'))
    elif age == limit:
        findings.append(Finding(
            src, 'WARN', 'STALE',
            f'last wrote {age} days ago, at the limit for this source'))


def check_volume(src: str, by_day: list[dict], findings: list) -> None:
    """Latest COMPLETE day's live count against this source's own recent median.

    TODAY IS EXCLUDED, and that is the whole correctness of this check. A day
    is only complete once the feeds have reported it, and this job is scheduled
    at 23:30 UTC — so any drift past midnight makes `by_day[0]` a day that is
    minutes old, measured against a median of full ones.

    That is not hypothetical. The 2026-08-14 run started at 00:07 UTC and
    warned that adzuna had "427 rows on 2026-08-14 against a median of 1225
    (35%)" and mycareersfuture "294 against 717 (41%)". Both were seven
    minutes of a day being compared with whole ones; both feeds were healthy
    and had written all day. False warnings here are not harmless — this
    report is read to find the real ones.
    """
    complete = [r for r in by_day if r['d'] < TODAY.isoformat()]
    if len(complete) < 5:
        return  # not enough history to say anything honest
    latest = complete[0]['n']
    baseline = median([r['n'] for r in complete[1:]])
    if baseline < 20:
        return  # a small source's day-to-day noise is not a signal
    ratio = latest / baseline
    if ratio < VOLUME_CRITICAL:
        findings.append(Finding(
            src, 'CRITICAL', 'VOLUME COLLAPSE',
            f'{latest} rows on {complete[0]["d"]} against a median of {baseline:.0f} '
            f'({ratio:.0%}) — likely paging or auth breaking part-way'))
    elif ratio < VOLUME_WARN:
        findings.append(Finding(
            src, 'WARN', 'VOLUME DROP',
            f'{latest} rows on {complete[0]["d"]} against a median of {baseline:.0f} ({ratio:.0%})'))


def check_fields(src: str, rows: dict, findings: list) -> None:
    """Has a field the source used to populate stopped arriving?"""
    for field, label in (('salary', 'salary'), ('skills', 'skills'),
                         ('url', 'url'), ('hub', 'hub')):
        recent_n = rows['recent_n']
        base_n = rows['base_n']
        if recent_n < 15 or base_n < MIN_ROWS_FOR_BASELINE:
            continue
        recent = rows[f'recent_{field}'] / recent_n
        base = rows[f'base_{field}'] / base_n
        if base < MIN_BASELINE_RATE:
            continue  # the source never really carried this field
        if recent < base * REGRESSION_RATIO:
            level = 'CRITICAL' if recent == 0 else 'WARN'
            findings.append(Finding(
                src, level, 'FIELD REGRESSION',
                f'{label} present on {recent:.0%} of the last {RECENT_DAYS} days\' rows '
                f'against {base:.0%} before — the site\'s markup has probably changed'))


def main() -> int:
    since = (TODAY - datetime.timedelta(days=WINDOW)).isoformat()
    recent_from = (TODAY - datetime.timedelta(days=RECENT_DAYS)).isoformat()

    totals = d1(
        'SELECT source, COUNT(*) n, MAX(last_seen) mx, MIN(first_seen) mn '
        'FROM jobs GROUP BY source ORDER BY n DESC')
    per_day = d1(
        'SELECT source, last_seen d, COUNT(*) n FROM jobs '
        'WHERE last_seen >= ?1 GROUP BY source, last_seen ORDER BY last_seen DESC', [since])
    fields = d1(
        'SELECT source, '
        " SUM(CASE WHEN last_seen >= ?1 THEN 1 ELSE 0 END) recent_n,"
        " SUM(CASE WHEN last_seen >= ?1 AND salary IS NOT NULL AND salary <> '' THEN 1 ELSE 0 END) recent_salary,"
        ' SUM(CASE WHEN last_seen >= ?1 AND skills IS NOT NULL THEN 1 ELSE 0 END) recent_skills,'
        " SUM(CASE WHEN last_seen >= ?1 AND url IS NOT NULL AND url <> '' THEN 1 ELSE 0 END) recent_url,"
        ' SUM(CASE WHEN last_seen >= ?1 AND hub IS NOT NULL THEN 1 ELSE 0 END) recent_hub,'
        ' SUM(CASE WHEN last_seen < ?1 THEN 1 ELSE 0 END) base_n,'
        " SUM(CASE WHEN last_seen < ?1 AND salary IS NOT NULL AND salary <> '' THEN 1 ELSE 0 END) base_salary,"
        ' SUM(CASE WHEN last_seen < ?1 AND skills IS NOT NULL THEN 1 ELSE 0 END) base_skills,'
        " SUM(CASE WHEN last_seen < ?1 AND url IS NOT NULL AND url <> '' THEN 1 ELSE 0 END) base_url,"
        ' SUM(CASE WHEN last_seen < ?1 AND hub IS NOT NULL THEN 1 ELSE 0 END) base_hub'
        ' FROM jobs GROUP BY source', [recent_from])

    days_by_src: dict[str, list] = {}
    for r in per_day:
        days_by_src.setdefault(r['source'], []).append(r)
    fields_by_src = {r['source']: r for r in fields}

    findings: list[Finding] = []
    for t in totals:
        src = t['source']
        if t['n'] == 0:
            findings.append(Finding(src, 'CRITICAL', 'NO ROWS', 'source present but empty'))
            continue
        check_freshness(src, t['mx'] or '', findings)
        check_volume(src, days_by_src.get(src, []), findings)
        if src in fields_by_src:
            check_fields(src, fields_by_src[src], findings)

    crit = [f for f in findings if f.level == 'CRITICAL']
    warn = [f for f in findings if f.level == 'WARN']

    if AS_JSON:
        print(json.dumps({
            'checked_at': TODAY.isoformat(),
            'sources': len(totals),
            'rows': sum(t['n'] for t in totals),
            'critical': len(crit),
            'warn': len(warn),
            'findings': [f.as_dict() for f in findings],
        }, indent=1))
        return 1 if crit else 0

    if not QUIET:
        print(f'employsi scraper health — {TODAY.isoformat()}')
        print(f'{len(totals)} sources, {sum(t["n"] for t in totals):,} rows\n')
        print(f'{"source":<18}{"rows":>7}{"last":>12}{"age":>5}{"salary":>8}{"skills":>8}')
        for t in totals:
            f = fields_by_src.get(t['source'], {})
            rn = f.get('recent_n') or 0
            sal = f'{100 * (f.get("recent_salary") or 0) / rn:.0f}%' if rn else '-'
            sk = f'{100 * (f.get("recent_skills") or 0) / rn:.0f}%' if rn else '-'
            age = days_since(t['mx'] or '')
            print(f'{t["source"]:<18}{t["n"]:>7}{(t["mx"] or "never"):>12}'
                  f'{(age if age < 10**5 else "-"):>5}{sal:>8}{sk:>8}')
        print()

    if not findings:
        print('OK — every source is writing, at volume, with its fields intact.')
        return 0

    for f in sorted(findings, key=lambda x: (x.level != 'CRITICAL', x.source)):
        print(f'{f.level:<9}{f.source:<18}{f.code:<18}{f.detail}')
    print(f'\n{len(crit)} critical, {len(warn)} warning.')
    return 1 if crit else 0


if __name__ == '__main__':
    sys.exit(main())
