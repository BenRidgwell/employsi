#!/usr/bin/env python3
"""Scrape Glassdoor through JobSpy and archive it to D1.

READ THIS BEFORE SCHEDULING IT. Glassdoor was in this repo once and was removed
on 2026-08-09 — `workers/jobs-cron/ARCHIVE.md` records why: datacentre, rotating
IPRoyal and a 30-minute sticky IPRoyal session all got a Cloudflare interstitial
before the sign-in page could load. This is a SECOND attempt by a different
door, not a retry of that one, and it is dispatch-only until a runner has shown
it gets through.

WHAT IS DIFFERENT THIS TIME. The 2026-08 scraper loaded Glassdoor's own search
pages and needed a signed-in session to do it. JobSpy (MIT, speedyapply/JobSpy —
the same package the Indeed feed has run nightly since 2026-09-18) POSTs to
glassdoor.com.au/graph, its web GraphQL API, with no account at all. Different
request, different wall — which is the whole reason this is worth one measured
attempt rather than an assumption either way.

WHAT WAS MEASURED, AND FROM WHERE. 2026-10-03, from the authoring sandbox (a
datacentre address, through the agent proxy):

    GET  /robots.txt                      200          (NOT challenged)
    GET  /Job/perth-nurse-jobs-...htm     403  cf-mitigated: challenge
    POST /graph                           403  "Security | Glassdoor"
    jobspy.scrape_jobs(["glassdoor"])     0 rows, "status code 403"

So from a datacentre address this is refused, exactly as it was in August. That
is NOT the conclusion, because it is the same address class that failed then and
this repo has been burned by generalising from one exit: Indeed was moved off
Oxylabs on a single probe that did not survive the real walk. The open question
is the ADDRESS, not the parser — a GitHub runner is a different exit, and the
Indeed GraphQL path works from one while several things here do not. Hence
`--dry-run`, which walks and reports and writes nothing: run that on a runner
first, and let its exit code decide whether this feed is real.

ROBOTS, STATED PLAINLY BECAUSE IT IS A DECISION AND NOT AN OVERSIGHT.
glassdoor.com.au/robots.txt carries `Disallow: /graph`, `/api/` and `/api-web/`,
and this posts to /graph. That is the same shape as the Indeed feed already
running nightly here — apis.indeed.com/robots.txt is `Disallow: /`, and
au.indeed.com disallows /graphql — so it is not a new line for this repo, and
pretending otherwise would be applying a standard to Glassdoor that the archive
does not apply to itself. It was put to the repo's owner with that comparison
and the feed was asked for anyway. What is NOT done here, and must not be added:
a CAPTCHA solver, or a residential pool bought to look like a visitor the
challenge is there to exclude. If the runner is challenged, this feed does not
exist — see the NGA.NET note in workers/jobs-cron/careerSites.ts for the same
line being held elsewhere.

Usage:
  python3 scripts/glassdoor-to-d1.py --dry-run --limit 20   # the probe
  python3 scripts/glassdoor-to-d1.py                        # the real walk
  python3 scripts/glassdoor-to-d1.py --only bhp,rio-tinto

Exit codes, so a workflow can tell the three outcomes apart without reading the
log — the distinction the ARCHIVE.md feed table is built on:
  0  rows collected (or --dry-run reached listings)
  2  the walk completed and NOT ONE company returned a listing: refused, not
     quiet. A board where every employer is genuinely empty does not exist.
  3  the blocked share crossed --max-blocked: partially refused, which reads as
     a thin day unless it is called out.

Env: CLOUDFLARE_API_TOKEN (D1 edit; not needed for --dry-run),
     CF_ACCOUNT_ID, D1_DATABASE_ID.
"""
from __future__ import annotations
import datetime
import json
import logging
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()
CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney']
SOURCE = 'glassdoor'

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


COUNTRY = _opt('--country', 'au')
ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
LIMIT = int(_opt('--limit', 10 ** 9))
DRY = '--dry-run' in args
NO_SKILLS = '--no-skills' in args
# Listings asked for per company. 30 is one Glassdoor page: this is a per-
# employer walk over a few hundred companies, not a sweep, so a second page is
# mostly the same roles with worse attribution.
RESULTS = int(_opt('--results', 30))
# How many companies may come back EMPTY in a row before the walk is called
# refused rather than quiet. Same reasoning as indeed-to-d1.py's --dead-after:
# 25 is more than the longest genuine run of empty employers on this roster and
# small enough that a wall fails in minutes rather than at the job timeout.
DEAD_AFTER = int(_opt('--dead-after', 25))
# The share of companies that may come back BLOCKED before the run is a failure
# rather than a thin day. A partial block is the dangerous outcome: it writes
# real rows, so nothing looks wrong, and the card quietly under-reports.
MAX_BLOCKED = float(_opt('--max-blocked', 0.10))
# Seconds to wait before asking again after a refusal, multiplied by the attempt.
RETRY_BACKOFF = float(_opt('--retry-backoff', 4))
# Seconds between companies. PRECAUTIONARY AND MEASURED-ISH: on a 14-company
# walk from one address 2026-10-03 the first ten answered and then four refused
# in a row, which is the shape of a rate limit rather than of an address being
# refused outright. 1.5s puts the full 395-company roster at ~10 minutes of
# waiting, which is nothing against a 90-minute job, and asking a third party
# for a few hundred pages as fast as the socket allows is not a thing to do
# whether or not it would have worked.
PACE = float(_opt('--pace', 1.5))

_CJK = re.compile(r'[぀-ヿ㐀-䶿一-鿿가-힯]')


def norm(s: str) -> str:
    if _CJK.search(s or ''):
        return re.sub(r'[\W_]+', ' ', (s or '').lower()).strip()[:120]
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


def _text(v) -> str:
    """A field's text, with pandas' empties read as empty.

    MEASURED 2026-10-03: a Glassdoor row with no location came back as the
    STRING "nan" — JobSpy hands back a DataFrame, and `str(float('nan'))` is
    "nan", which is truthy. Unguarded that reaches D1 as a location of "nan",
    takes a hub of None through match_city, and — worse — becomes part of
    job_key, so the same ad re-scraped once its location is populated is a
    second row rather than a refresh."""
    if v is None:
        return ''
    t = str(v).strip()
    return '' if t.lower() in ('nan', 'nat', 'none', '<na>') else t


def match_city(text: str):
    t = (text or '').lower()
    for c in CITIES:
        if c in t:
            return c
    return None


SECTOR_BY_ID: dict[str, str] = {}


def load_companies() -> list[tuple[str, str]]:
    """The full roster — listed plus the Top-150 private — via scripts/roster.py."""
    from roster import load_roster
    rows = load_roster()
    SECTOR_BY_ID.update({c['id']: c.get('sector') or '' for c in rows})
    return [(c['id'], c['name']) for c in rows if not ONLY or c['id'] in ONLY]


def map_skills(titles: list, sector: str | None = None) -> list:
    """The worker's own taxonomy, so a Glassdoor row carries exactly the skills
    the same title would get from any other feed."""
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    payload = {'titles': titles, 'sector': sector} if sector else titles
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=json.dumps(payload).encode(),
                           capture_output=True, timeout=120)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:160]}\n')
    except Exception as e:
        sys.stderr.write(f'  map-skills error: {e}\n')
    return [[] for _ in titles]


def d1(sql: str, params: list):
    body = json.dumps({'sql': sql, 'params': params}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                j = json.loads(r.read().decode())
                if j.get('success'):
                    return j['result']
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


# JobSpy resolves a Glassdoor locationId from this string, so it has to be one
# Glassdoor itself knows. Country names are what the Indeed feed passes and what
# JobSpy's own examples use.
_GD_COUNTRY = {'au': 'Australia', 'nz': 'New Zealand', 'uk': 'UK', 'gb': 'UK',
               'us': 'USA', 'ca': 'Canada', 'sg': 'Singapore', 'in': 'India',
               'ph': 'Philippines', 'hk': 'Hong Kong'}


class Blocked(Exception):
    """The transport was refused — as distinct from the employer having no ads.

    These two are the same thing to a caller that only counts rows, and telling
    them apart is the entire reason the August scraper's removal could be
    written down as a fact rather than a suspicion."""


class _RefusalWatch(logging.Handler):
    """Catches the refusal JobSpy logs and then swallows.

    MEASURED 2026-10-03, AND THIS IS THE WHOLE REASON IT EXISTS. JobSpy's
    Glassdoor scraper catches its own transport errors, writes
    `Glassdoor response status code 403` to its logger, and returns an EMPTY
    FRAME. To a caller counting rows that is indistinguishable from an employer
    with no ads — so without this, `blocked` stays 0 forever, --max-blocked can
    never fire, and a half-refused walk reports as a thin but healthy day while
    every card it touches under-collects. That is the exact failure mode this
    feed's exit codes exist to prevent, defeated by the library's own
    politeness.

    It matters here more than it does on Indeed because the refusal is
    INTERMITTENT rather than absolute: measured the same day from one address,
    a 12-company walk came back 6 with listings / 69 rows / 0 refusals, and
    single-company calls minutes earlier and later were refused outright. A
    wall you meet half the time is the kind that gets mistaken for a quiet
    market.
    """

    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.hits: list[str] = []

    def emit(self, record):
        msg = record.getMessage()
        if 'status code' in msg or 'Exception' in msg:
            self.hits.append(msg[:160])


def collect(cid: str, name: str) -> list:
    """One company's Glassdoor listings, gated so only its own ads come back.

    KEYWORD, NOT A COMPANY FILTER, because Glassdoor's search query exposes none
    — `JobSearchResultsQuery` takes `keyword` and `locationId` and that is all
    (see jobspy.glassdoor.constant.query_template). So the employer name goes in
    as a free-text keyword and every row is then checked against
    company_alias.company_matches before it can be filed.

    THE GATE IS NOT OPTIONAL AND IT IS NOT BELT-AND-BRACES. upsert() stamps
    company_id from the company being WALKED, so an ungated row becomes that
    employer's hiring on its card with nothing on screen to say it is wrong.
    Indeed's equivalent walk measured 18.0% of 6,116 rows as a different
    employer, and a bare keyword is looser than its `company:"X"` was. Default
    deny: a board name the gate has not seen is dropped, not guessed at."""
    from jobspy import scrape_jobs
    from company_alias import company_matches

    country = _GD_COUNTRY.get(COUNTRY)
    if not country:
        sys.exit(f'No Glassdoor location mapping for --country "{COUNTRY}". '
                 f'Known: {", ".join(sorted(_GD_COUNTRY))}.')

    # RETRIED, because the refusal is a RATE and not a verdict. Measured
    # 2026-10-03: the same company 403s and then answers minutes later from the
    # same address. Backing off and asking again is respecting that rate; it is
    # not an attempt to defeat the challenge, which is why the ceiling is three
    # tries and a few seconds rather than a loop that eventually gets lucky.
    watch = _RefusalWatch()
    log = logging.getLogger('JobSpy:Glassdoor')
    log.addHandler(watch)
    try:
        df = None
        for attempt in range(3):
            watch.hits.clear()
            try:
                df = scrape_jobs(site_name=['glassdoor'], search_term=name,
                                 location=country, country_indeed=country,
                                 results_wanted=RESULTS, verbose=0)
            except Exception as e:
                watch.hits.append(f'{type(e).__name__}: {str(e)[:120]}')
                df = None
            # A frame WITH rows settles it whatever was logged on the way.
            if df is not None and len(df):
                break
            if not watch.hits:
                break          # genuinely empty: this employer has no ads
            if attempt < 2:
                time.sleep(RETRY_BACKOFF * (attempt + 1))
        # Still refused after the retries, and still no rows: a block, named as
        # one. An empty frame with nothing logged falls through as "quiet".
        if (df is None or not len(df)) and watch.hits:
            raise Blocked(watch.hits[-1])
    finally:
        log.removeHandler(watch)

    # An empty frame that logged NOTHING is a genuinely quiet employer, and the
    # caller still resolves a long run of those: one company with no Glassdoor
    # presence is ordinary, DEAD_AFTER of them in a row is a wall that answers
    # 200 with no results. The two detections are independent on purpose —
    # either one alone has been enough to mis-call a refused run as a thin one.
    jobs, dropped = [], 0
    for r in (df.to_dict('records') if len(df) else []):
        title = _text(r.get('title'))
        board = _text(r.get('company'))
        if not title:
            continue
        if not company_matches(name, board):
            dropped += 1
            continue
        jobs.append({
            'title': title,
            'company': board,
            'location': _text(r.get('location')),
            # NO SALARY — this feed contributes nothing to disclosed pay. The
            # modelled figure goes in its own field, under its own name, with
            # its source inside it. See the note above upsert().
            'salary': '',
            'pay_estimate': _pay_estimate(r),
            'url': _text(r.get('job_url')),
            'date': _text(r.get('date_posted'))[:10],
            'country': COUNTRY,
        })
    if dropped:
        sys.stderr.write(f'  [{cid}] dropped {dropped} row(s) advertised by a '
                         f'different employer\n')
    return jobs


# THIS FEED WRITES NO SALARY, AND THAT IS THE FINDING, NOT A LIMITATION.
#
# Glassdoor returns a pay figure on most rows and it is tempting, because every
# other feed's salary column means "what the ad disclosed" and this one looks
# the same shape. It is not. Read jobspy.glassdoor.util.parse_compensation:
#
#     adjusted_pay = data.get("payPeriodAdjustedPay")
#     min_amount = round(adjusted_pay.get("p10"), 2)
#     max_amount = round(adjusted_pay.get("p90"), 2)
#
# p10 and p90 of `payPeriodAdjustedPay` are PERCENTILES OF GLASSDOOR'S OWN
# MODELLED PAY DISTRIBUTION for the role. The employer never stated them. There
# is no advertised figure anywhere in this response to fall back to.
#
# Measured 2026-10-03, which is how obvious the trap is: Chevron's "Specialist,
# Property" in Brisbane came back as AUD 53,324 - 71,674 — a precision no job ad
# has ever carried, because it is a model output, and a p10-p90 spread is not
# even a range an employer would offer.
#
# Writing that into jobs.salary puts a statistical estimate behind a card that
# says what the ads disclose, and behind every median the analyst computes from
# that column. Suppress rather than fabricate: this feed contributes titles,
# employers, locations and dates, and contributes nothing at all to pay.
#
# THE ESTIMATE IS KEPT, in `pay_estimate` — a different column, holding JSON
# that NAMES ITS SOURCE, so nothing can read it without knowing what it is. It
# is wanted as a floor where an employer advertises no band at all, which is a
# real gap: most Australian ads disclose nothing. Three rules travel with it:
#
#   1. It never enters `salary`, and nothing that computes a disclosed-pay
#      median may read it. Mixing a modelled figure into a measured one is the
#      comparison CLAUDE.md says is mostly measuring the difference between two
#      methods.
#   2. Whatever shows it says whose model it is, on screen, the way the career
#      card already says its O*NET tasks are described and not measured.
#   3. It carries the day it was collected. A model output drifts, and a figure
#      with no date cannot be aged out or argued with.


def _pay_estimate(r: dict) -> str:
    """Glassdoor's modelled pay for this listing, as traceable JSON — or ''.

    `src` is not decoration and must never be dropped: it is the difference
    between a figure a reader can weigh and a number from nowhere. `on` is the
    collection day, because a model's output for a role moves and a reading
    with no date cannot be aged out.

    p10/p90, not a midpoint. Narrowing it to one number here would throw away
    the only honest thing about it — that it is a spread Glassdoor fitted, not
    a point anyone offered."""
    lo, hi = r.get('min_amount'), r.get('max_amount')

    def ok(v):
        return v is not None and str(v).lower() not in ('nan', 'nat', 'none', '') \
            and float(v) > 0

    if not (ok(lo) and ok(hi)):
        # Both ends or nothing. One end of a percentile spread is not a floor,
        # it is half a statistic.
        return ''
    return json.dumps({
        'src': 'glassdoor',
        'lo': round(float(lo)),
        'hi': round(float(hi)),
        'cur': _text(r.get('currency')) or None,
        'per': _text(r.get('interval')) or None,
        'on': TODAY,
    }, separators=(',', ':'))


def upsert(company_id: str, jobs: list) -> int:
    titles = [j['title'] for j in jobs]
    skills = map_skills(titles, SECTOR_BY_ID.get(company_id))
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        company = j.get('company') or company_id
        location = j.get('location') or ''
        key = job_key(SOURCE, j['title'], company or company_id, location)
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], company or None, company_id,
                     match_city(location), location, j.get('country') or COUNTRY,
                     # Salary is NULL by construction, not by whether a row
                     # happened to carry one — see the note above. A later edit
                     # that starts passing j['salary'] through has to delete
                     # this line and read that note first.
                     None, j.get('url') or '',
                     j.get('date') or '', json.dumps(sk) if sk else None,
                     j.get('pay_estimate') or None))
    # Added lazily, the same way role_key is in jobArchive.ts: a migration that
    # has to be run by hand before a deploy is a migration someone forgets.
    # ALTER TABLE throws once the column exists, which is the success case.
    try:
        d1('ALTER TABLE jobs ADD COLUMN pay_estimate TEXT', [])
    except Exception:
        pass
    written = 0
    # SIX, NOT SEVEN. Each row now binds 15 parameters (13 columns + the two
    # dates), and D1 refuses over 100 per statement — 7 rows would be 105 and
    # every write would 400. Measured the same way the remap script's batch of
    # 33 was: the cap is real and it is not a guideline.
    for i in range(0, len(rows), 6):
        chunk = rows[i:i + 6]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'] * len(chunk))
        sql = ('INSERT INTO jobs '
               '(job_key, source, title, company, company_id, hub, location, '
               'category, salary, url, posted, skills, pay_estimate, '
               'first_seen, last_seen, seen_count) '
               f'VALUES {values} '
               'ON CONFLICT(job_key) DO UPDATE SET '
               'last_seen = excluded.last_seen, seen_count = seen_count + 1, '
               'salary = COALESCE(jobs.salary, excluded.salary), '
               "url = COALESCE(NULLIF(jobs.url, ''), excluded.url), "
               "posted = COALESCE(NULLIF(jobs.posted, ''), excluded.posted), "
               'skills = COALESCE(jobs.skills, excluded.skills), '
               # REFRESHED, not COALESCEd like the rest. Those fields are facts
               # an ad stated once; this one is a model's current reading, and
               # the newer reading is the better one. Guarded so a row that
               # comes back without an estimate does not erase the one held.
               'pay_estimate = COALESCE(excluded.pay_estimate, jobs.pay_estimate)')
        params = []
        for r in chunk:
            params.extend([*r, TODAY, TODAY])
        d1(sql, params)
        written += len(chunk)
    return written


def main() -> int:
    try:
        import jobspy  # noqa: F401
    except ImportError:
        sys.exit('Needs the JobSpy package: pip install python-jobspy')
    if not DRY and not TOKEN:
        sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). '
                 'Use --dry-run to walk without writing.')

    companies = load_companies()[:LIMIT]
    sys.stderr.write(
        f'{"DRY RUN (no D1 write)" if DRY else "Glassdoor -> D1"}: '
        f'{len(companies)} company(ies), {COUNTRY}.\n')

    total_rows = total_written = 0
    blocked = empty_streak = with_rows = 0
    for i, (cid, name) in enumerate(companies, 1):
        if i > 1 and PACE:
            time.sleep(PACE)
        try:
            jobs = collect(cid, name)
        except Blocked as e:
            blocked += 1
            sys.stderr.write(f'  [{cid}] BLOCKED: {e}\n')
            continue
        if not jobs:
            empty_streak += 1
            if empty_streak >= DEAD_AFTER:
                sys.stderr.write(
                    f'\n{empty_streak} companies in a row returned nothing. A board '
                    f'where that many employers are all genuinely empty does not '
                    f'exist, so this is a refusal, not a quiet day — stopping '
                    f'rather than reporting a thin run as a healthy one.\n')
                break
            continue
        empty_streak = 0
        with_rows += 1
        total_rows += len(jobs)
        if not DRY:
            total_written += upsert(cid, jobs)
        sys.stderr.write(f'  [{i}/{len(companies)}] {cid}: {len(jobs)} row(s)\n')

    walked = max(1, i if companies else 1)
    sys.stderr.write(
        f'\n{with_rows} company(ies) with listings, {total_rows} row(s), '
        f'{total_written} written, {blocked} blocked, of {walked} walked.\n')

    if not total_rows:
        sys.stderr.write(
            'NOT ONE LISTING. On this feed that means the GraphQL API refused the '
            'walk — the August 2026 Cloudflare wall, by a different door. Do not '
            'schedule this feed, and do not reach for a solver or a residential '
            'pool to get past it: see the header.\n')
        return 2
    if blocked / walked > MAX_BLOCKED:
        sys.stderr.write(
            f'{blocked}/{walked} companies were refused, over the '
            f'{MAX_BLOCKED:.0%} ceiling. Rows DID land, which is what makes this '
            f'worth failing on: a partial block looks exactly like a quiet day '
            f'on every card it touches.\n')
        return 3
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
