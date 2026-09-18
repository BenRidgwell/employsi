#!/usr/bin/env python3
"""Infosys' BrassRing (Kenexa/Infinite Talent) board → the D1 job archive.

WHY THIS IS NOT IN workers/jobs-cron/careerSites.ts
Payload size, not access. Measured 2026-09-18: 1,572 roles at a page size fixed
to 50 — asking for 200 returns 50 — so 32 requests, but each response is ~500 KB
because BrassRing ships every requisition's FULL DESCRIPTION inside the search
result. Sixteen megabytes of JSON parsed inside a scheduled Worker invocation is
not a thing to put on a shared tick, and a tick that runs out of budget
truncates silently. It runs here instead, where the walk is bounded and reports.

THE API, and the trap in it:

    POST https://sjobs.brassring.com/TgNewUI/Search/Ajax/ProcessSortAndShowMoreJobs
    {"partnerId":"25633","siteId":"5439","keyword":"","location":"",
     "Latitude":0,"Longitude":0,"facetfilterfields":{"Facet":[]},
     "powersearchoptions":{"PowerSearchOption":[]},"SortType":"LastUpdated",
     "pageNumber":N}
    -> {"JobsCount":1572,"Jobs":{"Job":[{Link, Questions:[{QuestionName,Value}]}]}}

PAGE WITH `pageNumber`, NEVER `startrow`. `startrow` is the parameter the older
BrassRing UI used and this endpoint still ACCEPTS it — it answers 200 with a
full page of 50 — while completely ignoring it. Measured: startrow=0 and
startrow=50 returned 19 of the same requisitions, and with an explicit SortType
they returned all 50 the same. A walk built on it collects one page over and
over and reports a plausible-looking few hundred roles, none of them new.
`pageNumber` is one-based and its pages are disjoint (checked across pages 1-3:
zero overlap).

The payload is `r` out of the board's own search.min.js, not a guess.
`encryptedSessionValue` and `linkId` are in the real request and are NOT
required — the walk works without a session — so they are left out rather than
faked.

FIELDS ARE A LABEL/VALUE LIST, NOT A RECORD. Each job carries `Questions`, an
array of {QuestionName, Value}; the useful ones are `jobtitle`, `formtext2`
(the location list, which is often several cities), `lastupdated` (MM/DD/YYYY)
and `autoreq` (the public requisition number). Reading them by NAME rather than
by position means a reordering, or a new field, cannot shift the others.

THIS IS INFOSYS' GLOBAL BOARD. `bengaluru-infy` is where Infosys is plotted on
the roster, not a claim that these roles are in Bengaluru; the locations are
mostly US and European and the hub matcher places them.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID
Run: python scripts/infosys-to-d1.py [--dry] [--max-pages N] [--no-skills]
"""
from __future__ import annotations
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import portal_archive as pa  # noqa: E402

SOURCE = 'portal-brassring'
COMPANY_ID = 'bengaluru-infy'
COMPANY = 'Infosys'
SECTOR = 'Technology, Media & Telecom'
HOME_HUB = 'bengaluru'
PARTNER_ID = '25633'
SITE_ID = '5439'
SEARCH = 'https://sjobs.brassring.com/TgNewUI/Search/Ajax/ProcessSortAndShowMoreJobs'
HOME = f'https://sjobs.brassring.com/TGnewUI/Search/Home/Home?partnerid={PARTNER_ID}&siteid={SITE_ID}'
PER_PAGE = 50      # fixed by the board; asking for 200 returns 50
PAUSE_S = 1.0      # each response is ~500 KB, so this walk is deliberately unhurried

args = sys.argv[1:]
DRY = pa.flag(args, '--dry')
NO_SKILLS = pa.flag(args, '--no-skills')
MAX_PAGES = int(pa.opt(args, '--max-pages', 0) or 0)   # 0 = every page the count implies


def fetch(page: int) -> dict | None:
    body = {
        'partnerId': PARTNER_ID, 'siteId': SITE_ID, 'keyword': '', 'location': '',
        'Latitude': 0, 'Longitude': 0,
        'facetfilterfields': {'Facet': []},
        'powersearchoptions': {'PowerSearchOption': []},
        'SortType': 'LastUpdated',
        'pageNumber': page,
    }
    req = urllib.request.Request(SEARCH, data=json.dumps(body).encode(), headers={
        'User-Agent': pa.UA,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Referer': HOME,
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode('utf-8', 'replace'))
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                sys.stderr.write(f'  page {page}: {e}\n')
                return None
            time.sleep((attempt + 1) * 2)
    return None


def q(job: dict, name: str) -> str:
    for item in job.get('Questions') or []:
        if item.get('QuestionName') == name:
            return str(item.get('Value') or '').strip()
    return ''


def posted(raw: str) -> str:
    """`lastupdated` is MM/DD/YYYY. Anything else is left to today rather than
    guessed at — a wrong date silently distorts every vacancy-age figure."""
    try:
        return datetime.datetime.strptime(raw, '%m/%d/%Y').date().isoformat()
    except (ValueError, TypeError):
        return pa.TODAY


def rows_from(payload: dict | None) -> list[dict]:
    jobs = ((payload or {}).get('Jobs') or {}).get('Job') or []
    out = []
    for j in jobs:
        title = q(j, 'jobtitle')
        if not title:
            continue
        out.append({
            'title': title,
            'location': q(j, 'formtext2'),
            'url': (j.get('Link') or '').strip() or HOME,
            'posted': posted(q(j, 'lastupdated')),
        })
    return out


def main() -> int:
    if not DRY and not pa.token():
        sys.exit('CLOUDFLARE_API_TOKEN is not set (needs D1 edit). Use --dry to skip the write.')

    first = fetch(1)
    total = int((first or {}).get('JobsCount') or 0)
    if not total:
        sys.stderr.write('Infosys: the board returned no JobsCount — shape changed?\n')
        return 1

    pages = -(-total // PER_PAGE)
    if MAX_PAGES:
        pages = min(pages, MAX_PAGES)
    print(f'Infosys BrassRing: {total} roles advertised, {pages} pages of {PER_PAGE}')

    jobs = rows_from(first)
    missed = []
    for p in range(2, pages + 1):
        time.sleep(PAUSE_S)
        got = rows_from(fetch(p))
        if not got:
            missed.append(p)
            continue
        jobs += got
        if p % 10 == 0:
            print(f'  page {p}/{pages}: {len(jobs)} roles so far')

    written, deduped = pa.archive(
        jobs, source=SOURCE, company_id=COMPANY_ID, company=COMPANY, sector=SECTOR,
        home_hub=HOME_HUB, skills=not NO_SKILLS, dry=DRY)
    print(f'collected {len(jobs)} listings, {deduped} distinct, '
          f'{"would write" if DRY else "wrote"} {written if not DRY else deduped}')
    if missed:
        sys.stderr.write(f'pages that returned nothing: {missed}\n')

    if not MAX_PAGES and len(jobs) < total * 0.9:
        sys.stderr.write(f'collected {len(jobs)} of {total} advertised — walk is incomplete\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
