#!/usr/bin/env python3
"""AECOM's SmartRecruiters board → the D1 job archive.

WHY THIS IS NOT IN workers/jobs-cron/careerSites.ts
Size, like TCS, Infosys and Marriott. The Worker already speaks SmartRecruiters
(BlueScope), and this board answers a plain request happily — but measured
2026-09-18 it carries 5,262 postings. At the API's 100-a-page maximum that is
53 requests and ~5,000 D1 rows, which is not a shared tick's worth of work, and
a tick that runs out of budget truncates SILENTLY.

THE API, measured before this parser was written. It is the public
SmartRecruiters postings feed, no key and no session:

    GET https://api.smartrecruiters.com/v1/companies/AECOM2/postings
        ?limit=100&offset=N
    -> {"totalFound":5262,"offset":0,"limit":100,"content":[
         {"id","name","releasedDate","location":{city,region,country},
          "department":{"label"},...}]}

`AECOM2` IS THE COMPANY SLUG, not a guess — it is the one AECOM's own careers
site links to (careers.smartrecruiters.com/AECOM2). A wrong slug 404s rather
than returning a different company's board, which is the one merciful thing
about this API.

`limit` is capped at 100 by SmartRecruiters; asking for more is silently
reduced, so the page size is pinned rather than negotiated.

THIS IS AECOM'S GLOBAL BOARD. `losangeles-acm` is where AECOM is plotted on the
roster, not a claim the roles are in Los Angeles — the first page alone is Doha,
and the hub matcher places what it recognises. Same treatment as TCS, Infosys
and Marriott; unlike EY or Aurecon there is no local entity to filter to, since
AECOM on this roster IS the global company.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID
Run: python scripts/aecom-to-d1.py [--dry] [--max-pages N] [--no-skills]
"""
from __future__ import annotations
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import portal_archive as pa  # noqa: E402

# `portal-sr`, matching SOURCE_TAG.smartrecruiters in careerSites.ts — these
# rows belong beside BlueScope's, which the Worker reads from the same API.
SOURCE = 'portal-sr'
COMPANY_ID = 'losangeles-acm'
COMPANY = 'AECOM'
SECTOR = 'Professional services'
HOME_HUB = 'losangeles'
SLUG = 'AECOM2'
API = f'https://api.smartrecruiters.com/v1/companies/{SLUG}/postings'
BOARD = f'https://careers.smartrecruiters.com/{SLUG}'
PER_PAGE = 100     # SmartRecruiters caps it here
PAUSE_S = 0.4

args = sys.argv[1:]
DRY = pa.flag(args, '--dry')
NO_SKILLS = pa.flag(args, '--no-skills')
MAX_PAGES = int(pa.opt(args, '--max-pages', 0) or 0)   # 0 = every page the total implies


def fetch(offset: int) -> dict | None:
    q = urllib.parse.urlencode({'limit': PER_PAGE, 'offset': offset})
    req = urllib.request.Request(f'{API}?{q}', headers={
        'User-Agent': pa.UA, 'Accept': 'application/json',
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode('utf-8', 'replace'))
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                sys.stderr.write(f'  offset {offset}: {e}\n')
                return None
            time.sleep((attempt + 1) * 2)
    return None


def rows_from(payload: dict | None) -> list[dict]:
    out = []
    for c in (payload or {}).get('content') or []:
        title = (c.get('name') or '').strip()
        if not title:
            continue
        loc = c.get('location') or {}
        # City, region, country — joined in that order and with the blanks
        # dropped, because a bare country ("qa") places nothing and a trailing
        # comma reaches the card.
        where = ', '.join(x for x in (loc.get('city'), loc.get('region'),
                                      loc.get('country')) if x)
        pid = str(c.get('id') or '').strip()
        out.append({
            'title': title,
            'location': where,
            'url': f'{BOARD}/{pid}' if pid else BOARD,
            'posted': (c.get('releasedDate') or '')[:10] or pa.TODAY,
        })
    return out


def main() -> int:
    if not DRY and not pa.token():
        sys.exit('CLOUDFLARE_API_TOKEN is not set (needs D1 edit). Use --dry to skip the write.')

    first = fetch(0)
    total = int((first or {}).get('totalFound') or 0)
    rows = rows_from(first)
    if not total:
        sys.stderr.write('AECOM: no totalFound — response shape changed, or the slug is wrong?\n')
        return 1
    if not rows:
        sys.stderr.write(f'AECOM: {total} advertised but page 1 carried no postings\n')
        return 1

    pages = -(-total // PER_PAGE)
    if MAX_PAGES:
        pages = min(pages, MAX_PAGES)
    print(f'AECOM SmartRecruiters: {total} postings advertised, {pages} pages of {PER_PAGE}')

    jobs = rows
    missed = []
    for p in range(1, pages):
        time.sleep(PAUSE_S)
        got = rows_from(fetch(p * PER_PAGE))
        if not got:
            missed.append(p)
            continue
        jobs += got
        if p % 10 == 0:
            print(f'  page {p + 1}/{pages}: {len(jobs)} postings so far')

    written, deduped = pa.archive(
        jobs, source=SOURCE, company_id=COMPANY_ID, company=COMPANY, sector=SECTOR,
        home_hub=HOME_HUB, skills=not NO_SKILLS, dry=DRY)
    print(f'collected {len(jobs)} postings, {deduped} distinct, '
          f'{"would write" if DRY else "wrote"} {written if not DRY else deduped}')
    if missed:
        sys.stderr.write(f'pages that returned nothing: {missed}\n')

    if not MAX_PAGES and len(jobs) < total * 0.9:
        sys.stderr.write(f'collected {len(jobs)} of {total} advertised — walk is incomplete\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
