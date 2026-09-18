#!/usr/bin/env python3
"""Marriott International's Oracle Recruiting board → the D1 job archive.

WHY THIS IS NOT IN workers/jobs-cron/careerSites.ts
Size, like TCS and Infosys. This file already has an `oracle` fetcher (Westpac,
Downer), and Marriott's board answers the same API — but measured 2026-09-18 it
carries 13,786 requisitions. Even at the 200 a page this tenant allows that is
69 requests and several megabytes of JSON, and the D1 write alone is ~2,000
statements. A jobs-cron tick is shaped around short bursts, and one that runs
out of budget truncates SILENTLY.

THE API, measured before this parser was written:

    GET https://ejwl.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/
        recruitingCEJobRequisitions
        ?onlyData=true
        &expand=requisitionList.secondaryLocations,flexFieldsFacet.values
        &finder=findReqs;siteNumber=CX_2,limit=200,offset=N,sortBy=POSTING_DATES_DESC
    -> {"items":[{"TotalJobsCount":13786,"requisitionList":[{Title,PrimaryLocation,
        PostedDate,Id,...}]}]}

`expand` IS LOAD-BEARING AND ITS ABSENCE IS SILENT. Without it the request still
answers 200 and still reports the right TotalJobsCount — it simply returns
`requisitionList` EMPTY. Measured at limit=25, 100 and 200: 13,787 advertised,
zero rows, no error anywhere. A walk written without it collects nothing while
reporting a healthy-looking total, which is the worst of both.

`siteNumber=CX_2` IS THE BOARD. CX_1 exists on the same pod and returns 8 —
checked, so that nobody "fixes" the site number later and quietly swaps a
14,000-role board for an eight-role one.

Paging is `offset`, and its pages are disjoint (checked: offset 0 and offset 100
at limit 100 share no requisition id).

THIS IS MARRIOTT'S GLOBAL BOARD. `washington-mar` is where Marriott is plotted
on the roster, not a claim the roles are in Washington; the locations are
worldwide and the hub matcher places what it recognises. That is the same
treatment TCS and Infosys get, and unlike Aurecon or EY there is no local
entity to filter to — Marriott International is the company on the roster.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID
Run: python scripts/marriott-to-d1.py [--dry] [--max-pages N] [--no-skills]
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

# `portal-or`, matching SOURCE_TAG.oracle in careerSites.ts — NOT a new
# `portal-marriott`. dataQualityFn is explicit that a portal-* source is one row
# per ATS PLATFORM and not per employer, so these rows belong beside Westpac's
# and Downer's, which the Worker reads from the same Oracle API.
SOURCE = 'portal-or'
COMPANY_ID = 'washington-mar'
COMPANY = 'Marriott International'
SECTOR = 'Hospitality'
HOME_HUB = 'washington'
POD = 'https://ejwl.fa.us2.oraclecloud.com'
SITE = 'CX_2'
API = f'{POD}/hcmRestApi/resources/latest/recruitingCEJobRequisitions'
# The tenant honours 200; 25 is the site's own default and would cost 552
# requests instead of 69.
PER_PAGE = 200
PAUSE_S = 0.5

args = sys.argv[1:]
DRY = pa.flag(args, '--dry')
NO_SKILLS = pa.flag(args, '--no-skills')
MAX_PAGES = int(pa.opt(args, '--max-pages', 0) or 0)   # 0 = every page the total implies


def fetch(offset: int) -> dict | None:
    finder = (f'findReqs;siteNumber={SITE},limit={PER_PAGE},offset={offset},'
              f'sortBy=POSTING_DATES_DESC')
    q = urllib.parse.urlencode({
        'onlyData': 'true',
        'expand': 'requisitionList.secondaryLocations,flexFieldsFacet.values',
        'finder': finder,
    })
    req = urllib.request.Request(f'{API}?{q}', headers={
        'User-Agent': pa.UA, 'Accept': 'application/json',
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode('utf-8', 'replace'))
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                sys.stderr.write(f'  offset {offset}: {e}\n')
                return None
            time.sleep((attempt + 1) * 2)
    return None


def item(payload: dict | None) -> dict:
    return ((payload or {}).get('items') or [{}])[0]


def rows_from(payload: dict | None) -> list[dict]:
    out = []
    for r in item(payload).get('requisitionList') or []:
        title = (r.get('Title') or '').strip()
        if not title:
            continue
        rid = str(r.get('Id') or '').strip()
        out.append({
            'title': title,
            'location': (r.get('PrimaryLocation') or '').strip(),
            # The board's own permalink shape, checked against a live role.
            'url': (f'{POD}/hcmUI/CandidateExperience/en/sites/{SITE}/job/{rid}'
                    if rid else f'{POD}/hcmUI/CandidateExperience/en/sites/{SITE}'),
            'posted': (r.get('PostedDate') or '')[:10] or pa.TODAY,
        })
    return out


def main() -> int:
    if not DRY and not pa.token():
        sys.exit('CLOUDFLARE_API_TOKEN is not set (needs D1 edit). Use --dry to skip the write.')

    first = fetch(0)
    total = int(item(first).get('TotalJobsCount') or 0)
    rows = rows_from(first)
    if not total:
        sys.stderr.write('Marriott: no TotalJobsCount — response shape changed?\n')
        return 1
    if not rows:
        # The `expand` trap: a 200 with the right total and an empty list. Loud,
        # because it is indistinguishable from a healthy run in every other way.
        sys.stderr.write(f'Marriott: {total} advertised but page 1 returned no '
                         'requisitions — has the `expand` parameter stopped working?\n')
        return 1

    pages = -(-total // PER_PAGE)
    if MAX_PAGES:
        pages = min(pages, MAX_PAGES)
    print(f'Marriott Oracle: {total} roles advertised, {pages} pages of {PER_PAGE}')

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
            print(f'  page {p + 1}/{pages}: {len(jobs)} roles so far')

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
