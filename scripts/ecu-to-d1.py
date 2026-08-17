#!/usr/bin/env python3
"""
Scrape Edith Cowan University's careers board (NGA.NET) and archive it to D1.

WHY THIS ISN'T IN workers/jobs-cron/careerSites.ts
ecu.nga.net.au answers a plain request with HTTP 405 and a 2.1 KB page titled
"Human Verification" — measured 2026-08-17, and measured again after ruling out
this sandbox's own proxy (the README's 405 case is a non-CONNECT request; the
result was identical with HTTP_PROXY unset, and the status endpoint recorded no
relay failure). So the 405 is NGA.NET's bot check, not the network in front of
it. That makes ECU the same shape as Auckland Airport and TechnologyOne:
blocked at the HTTP layer, where a real browser on the same address clears it.

THE PARSER IS DELIBERATELY GENERIC, AND THIS IS THE ONE PLACE IN THIS TREE THAT
IS THE RIGHT CALL RATHER THAN A SHORTCUT. Every other scraper here keys off
markup measured against the live board first, because a guessed selector fails
silently. That measurement is exactly what the bot check prevents: the page
cannot be read from anywhere the parser could be developed, and Chromium in the
authoring sandbox cannot reach remote hosts either. So instead of inventing a
selector for markup nobody has seen, this runs jobs_extract's own strategy
ladder — embedded JSON, then grouped job cards, then DOM anchors — which is
precisely what that module exists for, and reports which one won.

When it parses nothing it dumps the page's structure (jx.diagnose) rather than
just failing, so the FIRST hosted run says what the markup is instead of only
that it did not work. If the ladder turns out to mis-read this board, that dump
is what a real parser gets written from.

NGA.NET links its detail pages as `?event=jobs.jobInfo&jobId=<uuid>`, so the
href pattern keys off `jobs.jobInfo` rather than the word "job" appearing
anywhere in a URL — the mistake that nearly lost TechnologyOne's whole board.

THE LISTING URL CARRIES AN `rmuh` TOKEN. It is kept exactly as supplied because
that is the form known to resolve; `jobListid` looks like the stable half and
`rmuh` like a tracking hash. If this feed starts returning zero with the browser
clearly working, a stale token is the first thing to suspect.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID
Run: python scripts/ecu-to-d1.py [--dry-run] [--oxylabs]
"""
from __future__ import annotations
import datetime
import html
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

import browser_fetch  # noqa: E402
import jobs_extract as jx  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

# `portal-nga` names the PLATFORM, not the university, so a second NGA.NET
# tenant added later dedupes against this one rather than sitting beside it —
# the same reasoning as `portal-sf` covering every SuccessFactors tenant.
SOURCE = 'portal-nga'
COMPANY_ID = 'uni-edith-cowan-university'
COMPANY = 'Edith Cowan University'
SECTOR = 'Education'
HOME_HUB = 'perth'
LISTING = ('https://ecu.nga.net.au/cp/index.cfm?event=jobs.listJobs'
           '&jobListid=52d30031-d147-1b48-1974-6d5424ffc295'
           '&rmuh=C8967B982ACBFD73AC4B6AD9A98C1405B08A3160')

args = sys.argv[1:]
DRY = '--dry-run' in args
VIA_OXYLABS = '--oxylabs' in args

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


# ── hub mapping ───────────────────────────────────────────────────────────────
# ECU's campuses. Bunbury is a real campus in the South West with no hub of its
# own, so it falls back to Perth rather than being dropped — the role exists and
# belongs on the map; only its pin is approximate.
HUBS = [
    # ECU Sydney is a real campus, so a Sydney role must plot in Sydney. Listed
    # FIRST because everything below it is a WA place and the home-hub fallback
    # is Perth: without this an interstate role would be silently pinned to the
    # wrong city, which is the failure mode that fallback is most prone to.
    ('sydney', 'sydney'),
    ('joondalup', 'perth'),
    ('mount lawley', 'perth'),
    ('mt lawley', 'perth'),
    ('claremont', 'perth'),
    ('perth', 'perth'),
    ('bunbury', 'perth'),
    ('south west', 'perth'),
]


def hub_for(loc: str) -> str:
    low = (loc or '').lower()
    for needle, hub in HUBS:
        if needle in low:
            return hub
    return HOME_HUB


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


# ── fetch + parse ─────────────────────────────────────────────────────────────
# Twelve seconds, matching the APS board: an interstitial that clears itself
# needs time to do it, and a short settle reads the challenge page and reports a
# healthy board with nothing on it.
SETTLE = [{'type': 'wait', 'wait_time_s': 12}]


def get() -> str | None:
    if VIA_OXYLABS:
        from oxylabs_client import fetch as oxy_fetch
        content, status = oxy_fetch(LISTING, geo='Australia', render=True)
        if status and status != 200:
            sys.stderr.write(f'  listing returned status {status}\n')
        return content
    return browser_fetch.render(LISTING, SETTLE, locale='en-AU')


# A location the block miner can be trusted with.
#
# jobs_extract's card strategy reads unlabelled fields by mining a ±1200-char
# window around each card, which on tightly-packed markup runs straight past the
# card's own end. Tested against NGA.NET-shaped cards on 2026-08-17: all three
# titles came back correct and all three LOCATIONS came back as the same
# 70-character run — "Joondalup Campus Closing date: 30/08/2026 Research Fellow
# Location: Mo" — i.e. the first card's location plus the next card's title.
#
# Shipping that would be worse than shipping nothing twice over: the location is
# part of job_key, so a changed blob forks a role into a second row; and hub_for
# matches the first place name in the string, which would have pinned the ECU
# SYDNEY role to Perth because "Joondalup" appears earlier in the run-on.
#
# So a location is taken only when it looks like one. Anything else is dropped
# and the role falls back to the home hub — placed approximately and honestly,
# rather than precisely and wrongly.
_LOC_REJECT = re.compile(r'closing|location\s*:|\d{2}/\d{2}/\d{4}|apply|reference', re.I)


def plausible_location(loc: str) -> str:
    s = (loc or '').strip()
    if not s or len(s) > 40 or _LOC_REJECT.search(s):
        return ''
    return s


def looks_blocked(page_html: str) -> bool:
    """The bot check, told apart from an empty board.

    They are opposite outcomes that both parse to zero rows, and conflating them
    is how a blocked feed gets read as an employer who stopped hiring.
    """
    head = (page_html or '')[:4000].lower()
    return ('human verification' in head
            or 'are you a human' in head
            or 'enable javascript and cookies' in head)


def scrape() -> tuple[list[dict], str]:
    page_html = get()
    if not page_html:
        sys.stderr.write('  no content returned\n')
        return [], 'no-content'
    if looks_blocked(page_html):
        sys.stderr.write(f'  BLOCKED: the bot check answered instead of the board '
                         f'({len(page_html)} bytes)\n')
        return [], 'blocked'
    rows, how = jx.extract_jobs(page_html, r'jobs\.jobInfo', 'https://ecu.nga.net.au')
    sys.stderr.write(f'  listing: {len(rows)} rows via {how} ({len(page_html)} bytes)\n')
    if not rows:
        jx.diagnose(page_html, 'ecu-listing')
    out, seen = [], set()
    for r in rows:
        title = clean(r.get('t') or '')
        if not title:
            continue
        loc = plausible_location(clean(r.get('loc') or ''))
        key = (title.lower(), loc.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append({
            'title': title,
            'url': r.get('url') or LISTING,
            'location': loc or 'Perth',
            'hub': hub_for(loc),
            'category': 'Career portal',
            'posted': r.get('posted') or '',
        })
    return out, how


# ── skills parity via the worker's own taxonomy ───────────────────────────────
def map_skills(titles: list) -> list:
    if not titles:
        return []
    try:
        p = subprocess.run(
            ['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
            input=json.dumps({'titles': titles, 'sector': SECTOR}).encode(),
            capture_output=True, timeout=120, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  map-skills error: {e}\n')
    return [[] for _ in titles]


# ── D1 ────────────────────────────────────────────────────────────────────────
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


def upsert(jobs: list) -> int:
    """Same key + upsert as src/employsi/lib/jobArchive.ts, so a role already
    archived from uniroles or Adzuna refreshes rather than duplicating."""
    skills = map_skills([j['title'] for j in jobs])
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        key = job_key(SOURCE, j['title'], COMPANY, j['location'])
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], COMPANY, COMPANY_ID,
                     j['hub'], j['location'], j['category'], None,
                     j['url'], j['posted'] or None, json.dumps(sk) if sk else None))
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
               "url = COALESCE(NULLIF(jobs.url, ''), excluded.url), "
               "posted = COALESCE(NULLIF(jobs.posted, ''), excluded.posted), "
               'skills = COALESCE(jobs.skills, excluded.skills)')
        params = []
        for r in chunk:
            params.extend([*r, TODAY, TODAY])
        d1(sql, params)
        written += len(chunk)
    return written


def main() -> int:
    sys.stderr.write(f'ECU careers (NGA.NET) -> D1{", DRY RUN" if DRY else ""}\n')
    jobs, how = scrape()
    if not jobs:
        # Zero is never written. A blocked fetch and an empty board both land
        # here and neither means ECU stopped hiring, so the run fails loudly and
        # yesterday's rows are left to age out on their own.
        sys.stderr.write(
            'No roles parsed. Either the NGA.NET bot check answered instead of the board, '
            'the rmuh token in LISTING has gone stale, or the markup changed — the [diag] '
            'line above says which.\n')
        return 1
    sys.stderr.write(f'{len(jobs)} roles parsed via {how}.\n')
    for j in jobs[:5]:
        sys.stderr.write(f'  - {j["title"][:46]:46s} | {j["hub"]:8s} | {j["location"][:30]}\n')
    if DRY:
        return 0
    n = upsert(jobs)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}/{COMPANY_ID}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
