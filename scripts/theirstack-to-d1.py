#!/usr/bin/env python3
"""
Pull a company's HISTORICAL job postings from TheirStack and archive them to the
D1 jobs table, deduplicated against everything already there.

WHY THIS EXISTS
Every other source in this repo is a live board: it shows what is advertised
today, so the archive only grows forward from the day we started collecting.
TheirStack sells the back catalogue — BHP alone has 8,412 postings going back
years — which is the only way to get history for dates we were not watching.

WHAT IT TALKS TO
    POST https://api.theirstack.com/v1/jobs/search
    {"company_id_or": ["<id>"], "limit": N, "page": N,
     "include_total_results": true, "posted_at_max_age_days": 36500}

`include_total_results` is required to get metadata.total_results; without it the
field comes back null. `posted_at_max_age_days` has to be set wide or the search
silently defaults to a recent window — 36500 is a hundred years, i.e. "all of
it". Pages are ZERO-indexed.

Each row carries job_title, company, location/cities/country, date_posted,
final_url and a salary block (salary_string, min/max_annual_salary,
salary_currency).

CREDITS AND RATE LIMITS
TheirStack meters by RESULT, not by request, and only charges for results the
key has not seen before. A full backfill of a large employer is therefore not
free and is not something to re-run casually. This archives on demand only —
there is no schedule — and --max-pages bounds any single run.

The free tier grants ~100 credits in total, which is why the first BHP run
stopped at 75 postings out of 8412 with a 402 "Not enough credits". That is a
plan ceiling, not a bug: finishing the back catalogue needs a paid key. A 402 is
handled as a clean stop with the reason named in the summary, and everything
fetched up to that point is already in D1.

The API also rate-limits hard, and the ceilings are what make a backfill slow
rather than the data volume. On the current key the response headers advertise
4/second, 10/minute, 50/HOUR and 400/day, and the free plan refuses a page
larger than 25 results with a 403 "Premium functionality limitation". BHP's 8412
postings are therefore ~337 requests: it fits inside a day but not inside an
hour, so the run has to sit out the hourly window six or seven times.

Two consequences, both handled here:
  * The script reads `ratelimit-remaining` / `ratelimit-reset` off every
    response and sleeps out whichever bucket it has exhausted, rather than
    walking into a 429.
  * It writes to D1 every FLUSH_ROWS rows instead of once at the end, so a run
    that is interrupted after five hours keeps the five hours of postings it
    already fetched. Restart it with --start-page to carry on.

DEDUPLICATION
Rows go through the same job_key + upsert as every live source, so a posting we
already hold from a career portal or a board is refreshed rather than
duplicated. The run then reports what actually happened: how many keys were new,
how many collided with rows already in D1, and how many distinct titles that
represents.

Env: THEIRSTACK_TOKEN (never committed — pass it in the environment),
     CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
Run: python scripts/theirstack-to-d1.py --company-id <id>[,<id2>] --app-id bhp
       [--name BHP] [--sector S] [--max-pages N] [--page-size N]
       [--start-page N] [--max-age-days N] [--dry-run]

--company-id takes a COMMA-SEPARATED list because one employer is not always one
TheirStack company: BHP is two records, and 5,560 of its postings in the last two
years are only visible when both are passed. --max-age-days bounds the window
(730 for two years); it defaults to all of history, since a narrow default is how
a "full history" pull comes back quietly partial.
"""
from __future__ import annotations
import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

TS_TOKEN = os.environ.get('THEIRSTACK_TOKEN', '')
TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()
SOURCE = 'theirstack'
ENDPOINT = 'https://api.theirstack.com/v1/jobs/search'
# Set when the walk stops for a reason worth naming in the summary, so a run
# that ran out of credits does not read like a completed backfill.
STOP_REASON = ''
# TheirStack caps page size by plan — the free tier refuses anything over 25
# with a 403 "Premium functionality limitation". 25 is the safe floor; raise it
# with --page-size on a paid key to spend fewer requests on the same results.
PAGE_DEFAULT = 25

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


# Comma-separated, because one employer is not always one TheirStack company.
# BHP is two records — TI1SAwwqiw+Q04oXdD5jBg== and a longer one — and passing
# only the first silently returns a fraction of the postings while still looking
# like a completed run. The API's own field is `company_id_or`, so this is the
# shape it always wanted; it was the flag that was narrower.
COMPANY_IDS = [c for c in (_opt('--company-id') or '').split(',') if c.strip()]
APP_ID = _opt('--app-id')
NAME = _opt('--name', APP_ID or '')
MAX_PAGES = int(_opt('--max-pages', 400))
PAGE = max(1, min(int(_opt('--page-size', PAGE_DEFAULT)), 500))
START_PAGE = int(_opt('--start-page', 0))
SECTOR = _opt('--sector')
# The window, in days. The default stays "all of it" (36500 = a hundred years),
# because a narrow default is how a full-history pull comes back quietly partial
# — the API's own default is a recent window, which is the trap this guards.
# Set it when you want a bounded slice: --max-age-days 730 for two years.
MAX_AGE_DAYS = int(_opt('--max-age-days', 36500))
FLUSH_ROWS = 100  # write to D1 roughly every four pages
DRY = '--dry-run' in args

if not COMPANY_IDS or not APP_ID:
    sys.exit('--company-id (TheirStack, comma-separated for multiple) and --app-id '
             '(our roster id) are both required.')
if not TS_TOKEN:
    sys.exit('THEIRSTACK_TOKEN is required (pass it in the environment, never in the repo).')
if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


# The hubs the app plots. A posting outside them keeps its location text but is
# left unplaced rather than being assigned to the nearest thing we do draw.
HUBS = [
    ('perth', 'perth'), ('western australia', 'perth'), ('port hedland', 'perth'),
    ('newman', 'perth'), ('brisbane', 'brisbane'), ('queensland', 'brisbane'),
    ('melbourne', 'melbourne'), ('adelaide', 'adelaide'), ('canberra', 'canberra'),
    ('sydney', 'sydney'), ('singapore', 'singapore'), ('houston', 'houston'),
    ('london', 'london'), ('toronto', 'toronto'), ('vancouver', 'vancouver'),
    ('shanghai', 'shanghai'), ('tokyo', 'tokyo'), ('hong kong', 'hongkong'),
]


def hub_for(loc: str) -> str | None:
    low = (loc or '').lower()
    for needle, hub in HUBS:
        if needle in low:
            return hub
    return None


def salary_text(j: dict) -> str | None:
    s = (j.get('salary_string') or '').strip()
    if s:
        return s[:80]
    lo, hi = j.get('min_annual_salary'), j.get('max_annual_salary')
    cur = (j.get('salary_currency') or '').strip()
    try:
        lo_n = int(float(lo)); hi_n = int(float(hi))
    except (TypeError, ValueError):
        return None
    if lo_n <= 0:
        return None
    band = f'{lo_n:,}' if lo_n == hi_n else f'{lo_n:,}–{hi_n:,}'
    return f'{cur} {band}'.strip()


def iso_day(s: str) -> str:
    m = re.match(r'(\d{4}-\d{2}-\d{2})', str(s or ''))
    return m.group(1) if m else TODAY


def wait_out_limits(headers) -> None:
    """Sleep whichever rate-limit bucket this key has just exhausted.

    TheirStack sends four parallel buckets in fixed order — per-second,
    per-minute, per-hour, per-day — as comma-separated lists:

        ratelimit-remaining: 3, 6, 43, 393
        ratelimit-reset:     1, 19, 3199, 57199

    The hourly bucket (50 on this key) is the one a backfill actually hits, so
    the sleep here is normally ~50 minutes, not a token gesture. Waiting on the
    header is better than backing off after a 429: a 429 still costs a request
    against the same bucket."""
    try:
        rem = [int(x) for x in (headers.get('ratelimit-remaining') or '').split(',')]
        rst = [int(x) for x in (headers.get('ratelimit-reset') or '').split(',')]
    except ValueError:
        return
    for i, n in enumerate(rem):
        if n <= 0 and i < len(rst):
            nap = min(rst[i] + 2, 3900)
            sys.stderr.write(
                f'  rate limit reached ({["per-second", "per-minute", "per-hour", "per-day"][i]}), '
                f'sleeping {nap}s\n')
            sys.stderr.flush()
            time.sleep(nap)
            return


def ts_page(page: int) -> tuple[list, int | None]:
    body = json.dumps({
        'company_id_or': COMPANY_IDS,
        'limit': PAGE,
        'page': page,
        'include_total_results': True,
        # Without a wide window the search quietly returns only recent postings,
        # which would make a "full history" pull silently partial.
        'posted_at_max_age_days': MAX_AGE_DAYS,
    }).encode()
    for attempt in range(4):
        req = urllib.request.Request(ENDPOINT, data=body, headers={
            'Authorization': f'Bearer {TS_TOKEN}',
            'Content-Type': 'application/json', 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                headers = r.headers
                d = json.loads(r.read().decode('utf-8', 'replace'))
            wait_out_limits(headers)
            return d.get('data') or [], (d.get('metadata') or {}).get('total_results')
        except urllib.error.HTTPError as e:
            global STOP_REASON
            detail = e.read().decode('utf-8', 'replace')[:200]
            if e.code == 402:
                # Credits, not a fault. TheirStack charges per NEW result, so a
                # backfill of a big employer needs a paid plan; the free tier
                # runs dry after ~100. Stop cleanly and say why.
                STOP_REASON = 'out of TheirStack credits (plan limit)'
                sys.stderr.write(f'  TheirStack 402: {detail}\n')
                return [], None
            if e.code == 429 and attempt < 3:
                wait_out_limits(e.headers)
                time.sleep(30)
                continue
            if e.code in (500, 502, 503, 504) and attempt < 3:
                time.sleep(3 * (attempt + 1))
                continue
            sys.stderr.write(f'  TheirStack {e.code}: {detail}\n')
            return [], None
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                sys.stderr.write(f'  TheirStack error: {str(e)[:160]}\n')
                return [], None
            time.sleep(2 * (attempt + 1))
    return [], None


def parse(j: dict) -> dict | None:
    title = (j.get('job_title') or '').strip()
    if not title:
        return None
    loc = (j.get('short_location') or j.get('location')
           or j.get('long_location') or '').strip()
    company = (j.get('company') or NAME or '').strip()
    return {
        'key': job_key(SOURCE, title, company, loc),
        'title': title,
        'company': company,
        'location': loc,
        'hub': hub_for(loc),
        'salary': salary_text(j),
        'url': (j.get('final_url') or '').strip() or None,
        'posted': iso_day(j.get('date_posted')),
        'category': (j.get('normalized_title') or '').strip() or 'TheirStack',
    }


def walk(on_batch) -> tuple[int, int, int | None, list[dict]]:
    """Page through the back catalogue, handing each batch to `on_batch`.

    Returns (pages read, unique postings, total advertised, sample rows). The
    caller writes inside on_batch, so an interrupted walk has still archived
    everything it read."""
    seen: set[str] = set()
    total, pages, uniq, sample = None, 0, 0, []
    batch: list[dict] = []
    for page in range(START_PAGE, START_PAGE + MAX_PAGES):
        rows, tot = ts_page(page)
        if total is None and tot is not None:
            total = tot
            sys.stderr.write(f'  {total} postings in TheirStack for this company\n')
        if not rows:
            break
        pages += 1
        for j in rows:
            rec = parse(j)
            if not rec or rec['key'] in seen:
                continue
            seen.add(rec['key'])
            batch.append(rec)
            uniq += 1
            if len(sample) < 5:
                sample.append(rec)
        if len(batch) >= FLUSH_ROWS:
            on_batch(batch)
            batch = []
        sys.stderr.write(f'  page {page}: {len(rows)} rows, {uniq} unique so far\n')
        sys.stderr.flush()
        if len(rows) < PAGE:
            break
        if total is not None and (page + 1) * PAGE >= total:
            break
    if batch:
        on_batch(batch)
    return pages, uniq, total, sample


def map_skills(titles: list) -> list:
    if not titles:
        return []
    out: list = []
    # Chunked: a full backfill is thousands of titles and one giant payload can
    # outlive the subprocess timeout.
    for i in range(0, len(titles), 400):
        part = titles[i:i + 400]
        p_load = {'titles': part, 'sector': SECTOR} if SECTOR else part
        try:
            p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                               input=json.dumps(p_load).encode(),
                               capture_output=True, timeout=300, cwd=ROOT)
            out.extend(json.loads(p.stdout.decode()) if p.returncode == 0
                       else [[] for _ in part])
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f'  map-skills error: {e}\n')
            out.extend([[] for _ in part])
    return out


def d1(sql: str, params: list):
    body = json.dumps({'sql': sql, 'params': params}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
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


def snapshot() -> dict:
    """What the archive holds for this employer right now."""
    r = d1('SELECT COUNT(*) n, COUNT(DISTINCT LOWER(TRIM(title))) t, '
           'COUNT(DISTINCT source) s, MIN(posted) mn, MAX(posted) mx '
           'FROM jobs WHERE company_id = ?1', [APP_ID])
    return r[0]['results'][0]


def upsert(jobs: list) -> int:
    skills = map_skills([j['title'] for j in jobs])
    rows = [(j['key'], SOURCE, j['title'], j['company'] or None, APP_ID,
             j['hub'], j['location'], j['category'], j['salary'],
             j['url'], j['posted'], json.dumps(sk) if sk else None)
            for j, sk in zip(jobs, skills)]
    written = 0
    for i in range(0, len(rows), 7):  # D1 caps ~100 bound params a query
        chunk = rows[i:i + 7]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'] * len(chunk))
        sql = ('INSERT INTO jobs '
               '(job_key, source, title, company, company_id, hub, location, category, '
               'salary, url, posted, skills, first_seen, last_seen, seen_count) '
               f'VALUES {values} '
               'ON CONFLICT(job_key) DO UPDATE SET '
               'last_seen = excluded.last_seen, seen_count = seen_count + 1, '
               'salary = COALESCE(jobs.salary, excluded.salary), '
               "url = COALESCE(NULLIF(jobs.url, ''), excluded.url), "
               "posted = COALESCE(NULLIF(jobs.posted, ''), excluded.posted), "
               'skills = COALESCE(jobs.skills, excluded.skills)')
        params = []
        for r in chunk:
            # A historical posting's first_seen is the day it was POSTED, not
            # today — that is the whole point of backfilling it.
            params.extend([*r, r[10] or TODAY, r[10] or TODAY])
        d1(sql, params)
        written += len(chunk)
    return written


def main() -> int:
    sys.stderr.write(f'TheirStack -> D1: {NAME or APP_ID}{" (DRY RUN)" if DRY else ""}\n')
    before = None if DRY else snapshot()
    if before:
        sys.stderr.write(f'  D1 before: {before["n"]} rows / {before["t"]} distinct titles / '
                         f'{before["s"]} sources, posted {before["mn"]} .. {before["mx"]}\n')

    stats = {'written': 0, 'salary': 0, 'placed': 0, 'min': '9999', 'max': '0'}

    def flush(batch: list[dict]) -> None:
        stats['salary'] += sum(1 for j in batch if j['salary'])
        stats['placed'] += sum(1 for j in batch if j['hub'])
        stats['min'] = min(stats['min'], min(j['posted'] for j in batch))
        stats['max'] = max(stats['max'], max(j['posted'] for j in batch))
        if DRY:
            return
        stats['written'] += upsert(batch)
        sys.stderr.write(f'    -> {stats["written"]} rows written to D1 so far\n')
        sys.stderr.flush()

    pages, uniq, total, sample = walk(flush)
    if not uniq:
        sys.stderr.write('No postings returned — treating as a failure.\n')
        return 1
    sys.stderr.write(
        f'{uniq} unique postings over {pages} pages, {stats["min"]} .. {stats["max"]}, '
        f'{stats["salary"]} with salary, {stats["placed"]} on a plotted hub.\n')
    for j in sample:
        sys.stderr.write(f'  {j["posted"]} | {j["title"][:44]:<46}| {str(j["hub"]):<10}| '
                         f'{j["salary"] or "-"}\n')
    # Collected vs advertised, always — a backfill that stopped early on a rate
    # limit or an API error must say so rather than look complete.
    if total is not None:
        got = min(START_PAGE * PAGE + pages * PAGE, total)
        if got < total:
            why = f' ({STOP_REASON})' if STOP_REASON else ''
            tail = (f' — PARTIAL{why}, rerun with '
                    f'--start-page {START_PAGE + pages}')
        else:
            tail = ' — complete'
        sys.stderr.write(f'Read {got} of {total} advertised postings{tail}\n')
    if DRY:
        return 0
    after = snapshot()
    sys.stderr.write(
        f'{stats["written"]} rows sent. D1 after: {after["n"]} rows / {after["t"]} distinct '
        f'titles / {after["s"]} sources, posted {after["mn"]} .. {after["mx"]}\n'
        f'Dedup: {after["n"] - before["n"]} new rows from {stats["written"]} sent '
        f'({stats["written"] - (after["n"] - before["n"])} matched postings already archived).\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
