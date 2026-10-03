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
waking anyone. NOTE is quieter still: a source in QUIET_OK that has legitimately
written nothing, printed so it stays visible but never failing the run.

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

    # FORTNIGHTLY, via brightdata-archive.yml. Both boards moved off the daily
    # Oxylabs workflows on 2026-08-29; Bright Data bills per RECORD RETURNED, so
    # the sweep is deliberately every 14 days rather than every day.
    #
    # 22 AND NOT 17, WHICH LOOKS TOO SLACK UNTIL YOU READ THE SCHEDULE. The cron
    # fires weekly and the job drops odd ISO weeks, because cron cannot say
    # "every 14 days". In a year with an ISO week 53 — 2026 is one — weeks 53
    # and 1 are both odd, so two skips land back to back and the gap across New
    # Year is 21 DAYS, not 14. A 17-day limit would therefore go critical once a
    # year on a feed behaving exactly as designed.
    #
    # The cost of 22 is three weeks of blindness on these two, and it is the
    # right trade for the same reason QUIET_OK exists: a check that cries wolf
    # on a schedule nobody has changed is a check people stop reading. A genuine
    # Bright Data failure is not silent anyway — the collector exits non-zero on
    # a zero-record snapshot and says so, which is how the 2026-08-17 gap in
    # indeed[0:90] and linkedin[180:270] was found.
    #
    # INDEED IS NO LONGER ON THAT FORTNIGHTLY SCHEDULE — it was gated out of
    # brightdata-archive.yml's scheduled sweep on 2026-09-05 because its Bright
    # Data snapshots never terminate (one re-polled at 105 hours, still
    # `running`). Its allowance is LEFT AT 22 and it is deliberately NOT added
    # to QUIET_OK, so it goes CRITICAL around 2026-09-08 and stays there.
    #
    # That is the point. Turning a sweep off does not make the archive fresh,
    # and the honest statement about Indeed is that it has written nothing since
    # 2026-08-17. QUIET_OK is for a source that is silent BY DESIGN; this one is
    # silent because it is broken at the vendor. Re-enable the schedule and this
    # entry is already correct; mute it here and the outage disappears from the
    # only place that reports it.
    'indeed': 22,
    # WEEKLY since 2026-09-25, via linkedin-archive.yml's direct transport — no
    # longer the fortnightly Bright Data sweep the note above describes. Ten is
    # one week plus the same three days of slack a daily feed gets, so one late
    # or failed Monday is what trips it, not the calendar.
    'linkedin': 10,
}

# Sources that are NOT scheduled, so silence means nothing. TheirStack is an
# on-demand paid backfill; the Muse is a fallback that only fires when Adzuna
# returns nothing for a company. `wayback` is a one-off historical import — 8,436
# rows dated 2003-12-29 to 2018-04-22 for two companies, written by hand through
# scripts/wayback-to-d1.py, which has no workflow and never will.
ON_DEMAND = {'theirstack', 'muse', 'wayback'}

# Sources that ARE scheduled but for which writing nothing is a normal outcome,
# with the reason. Reported, never CRITICAL.
#
# WHY THIS SET HAD TO EXIST. On 2026-08-20 this check reported four criticals and
# three of them were false: wayback (above — 3,042 days "stale", and it will be
# 3,043 tomorrow), startupjobs, and portal-aubgroup. Only zhaopin was real. A
# check that is permanently red teaches everyone to ignore it, which costs more
# than the check earns — the real failure that night, an exhausted Oxylabs quota,
# was sitting in the same list as three sources behaving correctly.
#
# The distinction is between "no rows because nothing could be read" and "no rows
# because there was nothing to write". The scrapers below already tell those
# apart themselves and exit 0 on the second — startupjobs-to-d1.py says so in as
# many words, and fails only when not one company page could be READ. This set
# stops the health check contradicting them.
QUIET_OK = {
    'startupjobs': 'an employer can sit on this board for months without hiring; '
                   'the scraper fails only when no company page can be read at all',
    'portal-aubgroup': 'a single-employer portal — AUB\'s own page reads '
                       '"There are no current opportunities" (checked 2026-08-17)',
}

# Sources a scheduled scraper is SUPPOSED to be writing, with the level to
# report at when the archive holds NOT ONE ROW from them.
#
# WHY THIS HAD TO EXIST, measured 2026-10-03. Every check above reads
# `SELECT source ... FROM jobs GROUP BY source`, so a feed that has never
# written a row is not a row in that result — it is absent, and absent is
# indistinguishable from "not a feed". `portal-nga` had been failing nightly
# since 2026-08-17 and this check had never once mentioned it, because there
# was nothing to mention it ABOUT. The NO ROWS branch in main() could not fire
# either: GROUP BY never yields a count of zero.
#
# That is the worst shape a monitoring gap can take. A broken feed goes STALE
# and is reported; a feed that never started at all is silent forever, and the
# only evidence is a red step inside a workflow whose other boards all passed —
# which `continue-on-error` then paints green.
#
# A NEW ENTRY SHOULD BE 'CRITICAL'. The level is here so that a feed which
# cannot run for a settled, understood reason stays VISIBLE without failing
# every run forever — the trap the QUIET_OK note below describes. It is not for
# muting a feed that is merely inconvenient: if there is any action that would
# make the feed write, the entry is CRITICAL and the finding is the thing
# prompting that action.
EXPECTED_SOURCES: dict[str, tuple[str, str]] = {
    # Edith Cowan University, written by scripts/ecu-to-d1.py from
    # browser-portals.yml. WARN, not CRITICAL, and the reason is not technical:
    # ecu.nga.net.au answers every path — /cp/index.cfm, /rss, /sitemap.xml and
    # even /robots.txt — with HTTP 405 and `x-amzn-waf-action: captcha` from
    # awselb/2.0. Re-measured 2026-10-03, unchanged. That is AWS WAF's CAPTCHA
    # action, switched on by the site's operator, and the standing NGA.NET note
    # in careerSites.ts records why defeating it is not something this project
    # does. So there is no fix to prompt and nothing to wake anyone for; what
    # there is, is a feed in the repo that writes nothing, and that belongs on
    # this report rather than in a workflow log nobody opens.
    'portal-nga': (
        'WARN',
        'scripts/ecu-to-d1.py has never written a row — ecu.nga.net.au answers '
        'every path with an AWS WAF CAPTCHA (HTTP 405, x-amzn-waf-action: '
        'captcha; re-measured 2026-10-03). Edith Cowan reaches the archive '
        'through Adzuna, LinkedIn, SEEK and SimplyHired meanwhile. See the '
        'NGA.NET note in workers/jobs-cron/careerSites.ts.'
    ),
}

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
        # Still reported — a quiet source is worth seeing, and a board that goes
        # quiet for months may well have broken. It just does not fail the run,
        # because for these sources silence is a legitimate outcome and the
        # scraper itself has already decided so.
        if src in QUIET_OK:
            findings.append(Finding(
                src, 'NOTE', 'QUIET',
                f'no rows for {age} days (last {last_seen or "never"}) — expected: '
                f'{QUIET_OK[src]}'))
            return
        findings.append(Finding(
            src, 'CRITICAL', 'STALE',
            f'no rows written for {age} days (last {last_seen or "never"}, '
            f'allowed {limit}) — the scraper is failing silently or its walk has stalled'))
    elif age == limit:
        findings.append(Finding(
            src, 'WARN', 'STALE',
            f'last wrote {age} days ago, at the limit for this source'))


def check_volume(src: str, by_day: list[dict], findings: list) -> None:
    """Latest day's live count against this source's own recent median."""
    if len(by_day) < 5:
        return  # not enough history to say anything honest
    latest = by_day[0]['n']
    baseline = median([r['n'] for r in by_day[1:]])
    if baseline < 20:
        return  # a small source's day-to-day noise is not a signal
    ratio = latest / baseline
    if ratio < VOLUME_CRITICAL:
        findings.append(Finding(
            src, 'CRITICAL', 'VOLUME COLLAPSE',
            f'{latest} rows on {by_day[0]["d"]} against a median of {baseline:.0f} '
            f'({ratio:.0%}) — likely paging or auth breaking part-way'))
    elif ratio < VOLUME_WARN:
        findings.append(Finding(
            src, 'WARN', 'VOLUME DROP',
            f'{latest} rows on {by_day[0]["d"]} against a median of {baseline:.0f} ({ratio:.0%})'))


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
    # BEFORE the per-source loop, because these sources are precisely the ones
    # that loop cannot see: they contribute no row to GROUP BY source.
    present = {t['source'] for t in totals}
    for src, (level, why) in sorted(EXPECTED_SOURCES.items()):
        if src not in present:
            findings.append(Finding(src, level, 'NEVER WRITTEN', why))
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
    note = [f for f in findings if f.level == 'NOTE']

    if AS_JSON:
        print(json.dumps({
            'checked_at': TODAY.isoformat(),
            'sources': len(totals),
            'rows': sum(t['n'] for t in totals),
            'critical': len(crit),
            'warn': len(warn),
            'noted': len(note),
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

    order = {'CRITICAL': 0, 'WARN': 1, 'NOTE': 2}
    for f in sorted(findings, key=lambda x: (order.get(x.level, 3), x.source)):
        print(f'{f.level:<9}{f.source:<18}{f.code:<18}{f.detail}')
    print(f'\n{len(crit)} critical, {len(warn)} warning, {len(note)} noted.')
    # NOTE never fails the run — see QUIET_OK.
    return 1 if crit else 0


if __name__ == '__main__':
    sys.exit(main())
