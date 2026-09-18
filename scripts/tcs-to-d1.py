#!/usr/bin/env python3
"""Tata Consultancy Services' iBegin portal → the D1 job archive.

WHY THIS IS NOT IN workers/jobs-cron/careerSites.ts
Not because the Worker cannot read it — it could — but because of how deep the
walk is. Measured 2026-09-18: `totalJobs` 2,366, served ten to a page, with no
page-size parameter the API will accept (sending `pageSize` makes it answer with
an empty body, which is how we know it is rejected rather than ignored). That is
237 round trips. The jobs-cron Worker's budget is shaped around short bursts —
the same reason the 43-page uniroles walk lives here — and a tick that runs out
of subrequests truncates SILENTLY, which on a 2,366-role board would look like a
company that had quietly stopped hiring.

THE API, measured before this parser was written:

    POST https://ibegin.tcsapps.com/candidate/api/v1/jobs/searchJ
    {"jobTitle":null,"jobCity":null,"jobFunction":null,"jobExperience":null,
     "jobSkill":null,"pageNumber":"1","userText":"","jobTitleOrder":null,
     "jobCityOrder":null,"jobFunctionOrder":null,"jobExperienceOrder":null,
     "applyByOrder":null,"regular":true,"walkin":true}
    -> {"result":"Y","data":{"totalJobs":2366,"jobs":[{id,jobTitle,location,
        functionName,experience,applyByDate,skills,walkin,url}]}}

The body shape is not guessed: it is `requestDataObj` out of the portal's own
JobSearchController.js, and sending a trimmed version (just pageNumber/userText)
returns HTTP 500. `pageNumber` is a STRING and one-based.

WHY THE WALK IS BOUNDED BY totalJobs. A fetch failure and the end of a list are
indistinguishable — both return no rows — and that has silently truncated feeds
in this repo twice. So the walk asks the board how many pages it owes, fetches
that many, and REPORTS any it did not get instead of stopping early and calling
it done. A run that collects materially less than the board advertises exits
non-zero.

`url` COMES BACK NULL ON EVERY ROLE, on every page checked. The portal's own
route for a role is `#!/jobs/<id>` (see the AngularJS route table in
module/application.js), so the link is built from the id rather than left empty —
an archive row with no url is a row nobody can click through from the card.

THIS BOARD IS TCS's NON-INDIA ONE. Its controller redirects a visitor whose
country resolves to IN to a separate Next.js app, so what this walks is the rest
of the world: the locations are US, European and Australian. They are archived
as they come and the hub matcher places them; `mumbai-tcs` is the roster company
because that is where TCS is plotted, not a claim that the roles are in Mumbai.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID
Run: python scripts/tcs-to-d1.py [--dry] [--max-pages N] [--no-skills]
"""
from __future__ import annotations
import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import portal_archive as pa  # noqa: E402

SOURCE = 'portal-ibegin'
COMPANY_ID = 'mumbai-tcs'
COMPANY = 'Tata Consultancy Services'
SECTOR = 'Technology, Media & Telecom'
HOME_HUB = 'mumbai'
BASE = 'https://ibegin.tcsapps.com/candidate'
SEARCH = f'{BASE}/api/v1/jobs/searchJ'
PER_PAGE = 10      # fixed by the API; pageSize is rejected, see the header
PAUSE_S = 0.4      # 237 requests at this rate is ~100s, and the board is fine with it

args = sys.argv[1:]
DRY = pa.flag(args, '--dry')
NO_SKILLS = pa.flag(args, '--no-skills')
MAX_PAGES = int(pa.opt(args, '--max-pages', 0) or 0)   # 0 = every page the total implies

# The exact object the portal's own controller posts. Every null matters: a
# trimmed body answers 500.
BODY = {
    'jobTitle': None, 'jobCity': None, 'jobFunction': None, 'jobExperience': None,
    'jobSkill': None, 'userText': '', 'jobTitleOrder': None, 'jobCityOrder': None,
    'jobFunctionOrder': None, 'jobExperienceOrder': None, 'applyByOrder': None,
    'regular': True, 'walkin': True,
}


def fetch(page: int) -> dict | None:
    body = dict(BODY, pageNumber=str(page))
    req = urllib.request.Request(SEARCH, data=json.dumps(body).encode(), headers={
        'User-Agent': pa.UA,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://ibegin.tcsapps.com',
        'Referer': f'{BASE}/jobs/search',
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode('utf-8', 'replace'))
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                sys.stderr.write(f'  page {page}: {e}\n')
                return None
            time.sleep(attempt + 1)
    return None


def rows_from(payload: dict | None) -> list[dict]:
    data = (payload or {}).get('data') or {}
    out = []
    for j in data.get('jobs') or []:
        title = (j.get('jobTitle') or '').strip()
        if not title:
            continue
        jid = str(j.get('id') or '').strip()
        out.append({
            'title': title,
            'location': (j.get('location') or '').strip(),
            # The API returns url: null on every role — see the header.
            'url': j.get('url') or (f'{BASE}/#!/jobs/{jid}' if jid else f'{BASE}/jobs/search'),
            'posted': pa.TODAY,   # the board states an applyBy date, never a posted one
        })
    return out


def main() -> int:
    if not DRY and not pa.token():
        sys.exit('CLOUDFLARE_API_TOKEN is not set (needs D1 edit). Use --dry to skip the write.')

    first = fetch(1)
    total = int(((first or {}).get('data') or {}).get('totalJobs') or 0)
    if not total:
        # No total means the response shape changed, and a walk with no bound is
        # exactly the silent truncation this is built to avoid.
        sys.stderr.write('TCS: the search API returned no totalJobs — shape changed?\n')
        return 1

    pages = -(-total // PER_PAGE)
    if MAX_PAGES:
        pages = min(pages, MAX_PAGES)
    print(f'TCS iBegin: {total} roles advertised, {pages} pages of {PER_PAGE}')

    jobs = rows_from(first)
    missed = []
    for p in range(2, pages + 1):
        time.sleep(PAUSE_S)
        payload = fetch(p)
        got = rows_from(payload)
        if not got:
            missed.append(p)
            continue
        jobs += got
        if p % 25 == 0:
            print(f'  page {p}/{pages}: {len(jobs)} roles so far')

    written, deduped = pa.archive(
        jobs, source=SOURCE, company_id=COMPANY_ID, company=COMPANY, sector=SECTOR,
        home_hub=HOME_HUB, skills=not NO_SKILLS, dry=DRY)
    print(f'collected {len(jobs)} listings, {deduped} distinct, '
          f'{"would write" if DRY else "wrote"} {written if not DRY else deduped}')
    if missed:
        sys.stderr.write(f'pages that returned nothing: {missed}\n')

    # A partial walk is reported as a failure rather than a quiet short day. The
    # 90% floor allows for the board shrinking between the total and the last
    # page, which it does — it is a live list — without tolerating a real hole.
    if not MAX_PAGES and len(jobs) < total * 0.9:
        sys.stderr.write(f'collected {len(jobs)} of {total} advertised — walk is incomplete\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
