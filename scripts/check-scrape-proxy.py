#!/usr/bin/env python3
"""Does SCRAPE_PROXY work, and which boards does it actually recover?

WHY THIS EXISTS RATHER THAN JUST FLIPPING THE SCRAPERS
Moving a feed off Oxylabs is a one-line change and an untestable claim. This
repo has already paid for that once: jobs.govt.nz was moved to direct on
2026-08-04 on the strength of a sandbox probe and timed out on every request
from the first real scheduled run. So nothing moves until a run from CI, through
the exit the scrapers will actually use, says the target answers.

It measures the plain-HTTP transport specifically. probe-headless-ci.py checks
the same question through Chromium, and the two can disagree: most of these
boards are fetched by urllib via http_fetch.get(), and a proxy that a browser
negotiates happily can still fail an HTTP CONNECT from urllib, or vice versa.

WHAT IT REPORTS
  1. The egress address, direct and through the proxy. Identical addresses mean
     the proxy was not used, and every result below would be about this runner —
     which is the failure mode that reads as success.
  2. Per board: the status the target returns, and whether the body looks like
     the page the scraper needs rather than a challenge. A 200 carrying a
     Cloudflare interstitial is not a working feed.

Exit code is 1 when the proxy is unusable, 0 otherwise — a blocked board is a
RESULT, not a failure of the check.

Run: SCRAPE_PROXY=http://user:pass@host:port python3 scripts/check-scrape-proxy.py
"""
from __future__ import annotations
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import http_fetch  # noqa: E402

# The boards whose scrapers fetch over plain HTTP and go through a proxy for the
# EXIT ADDRESS. Each `want` is a marker copied from that scraper, so a pass here
# means the scraper could read the page — not merely that something answered.
# The render-gated boards (Naukri, Zhaopin, APS, the SuccessFactors set) are
# deliberately absent: they need a browser, and probe-headless-ci.py is where
# they are measured.
BOARDS = [
    ('indeed', 'https://au.indeed.com/jobs?q=%22BHP%22&l=&start=0',
     r'job_seen_beacon|data-jk='),
    ('simplyhired', 'https://www.simplyhired.com.au/search?q=BHP', r'"jobKey"'),
    ('jora', 'https://au.jora.com/j?q=BHP&l=Australia&p=1', r'data-braze-job-panel-view="'),
    ('linkedin-jobs', 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings'
     '/search?keywords=BHP&start=0&sortBy=DD', r'/jobs/view/'),
    ('linkedin-posts', 'https://www.linkedin.com/company/bhp/', r'urn:li:activity'),
    ('startupjobs', 'https://startup.jobs/company/twitch',
     r'data-post-template-target="title"[^>]*href="/'),
    ('gulftalent', 'https://www.gulftalent.com/api/jobs/search?limit=50&offset=0', r'"positions"'),
    ('jobsdb', 'https://hk.jobsdb.com/hk/search-jobs/bhp/1', r'data-automation="job'),
    ('nzgov', 'https://jobs.govt.nz/jobtools/jncustomsearch.searchResults'
     '?in_organid=16563&in_jobDate=All&in_location=Auckland&in_pg=0', r'<td class="job_title">'),
    ('nsw-iworkfor', 'https://iworkfor.nsw.gov.au/', r'/_next/static/'),
    ('nab', 'https://careers.nab.com.au/jobs/search', r'job-search-results-card-col'),
    ('technologyone', 'https://www.technology1.com/company/life-at-techone/join-the-team',
     r'<tr data-referrals="'),
    ('aucklandairport', 'https://careers.aucklandairport.co.nz/jobs/', r'wpjb-job-tile'),
]

# Only consulted when a page yields no rows: a fully rendered board contains the
# word "captcha" in its own JavaScript often enough that treating these as an
# independent signal reports blocks that are not there.
BLOCKS = [
    (r'Just a moment', 'Cloudflare interstitial'),
    (r'Access Denied', 'Akamai deny'),
    (r'Pardon Our Interruption', 'DataDome'),
    (r'Request unsuccessful|Incapsula', 'Imperva'),
    (r'Vercel Security Checkpoint', 'Vercel checkpoint'),
    (r'captcha|challenge-platform', 'captcha / challenge'),
]


def ip_via(opener) -> str:
    try:
        req = urllib.request.Request('https://api.ipify.org?format=json',
                                     headers={'User-Agent': http_fetch.UA})
        fn = opener.open if opener else urllib.request.urlopen
        with fn(req, timeout=30) as r:
            return json.loads(r.read().decode()).get('ip', '?')
    except Exception as e:  # noqa: BLE001
        return f'unknown ({type(e).__name__}: {str(e)[:50]})'


def main() -> int:
    if not (os.environ.get('SCRAPE_PROXY') or '').strip():
        sys.exit('SCRAPE_PROXY is not set — nothing to check. '
                 'Format: http://user:pass@host:port')

    print(f'exit: {http_fetch.proxy_label()}')
    proxied = ip_via(http_fetch._opener)
    direct = ip_via(None)
    print(f'  address through the proxy : {proxied}')
    print(f'  address with no proxy     : {direct}')
    if proxied.startswith('unknown'):
        print('\nFAILED: nothing answered through the proxy. Every board below would '
              'fail and be recorded as blocked, so the run stops here.')
        return 1
    if proxied == direct:
        print('\nFAILED: the proxied address IS this host. Chromium/urllib is not '
              'egressing through the proxy, so no result below would be about it.')
        return 1
    print()

    ok, blocked = [], []
    for name, url, want in BOARDS:
        body, status = http_fetch.get(url, retries=2, quiet=True)
        hits = len(re.findall(want, body)) if body else 0
        why = ''
        if not hits and body:
            why = next((label for pat, label in BLOCKS if re.search(pat, body, re.I)), '')
        verdict = 'ROWS' if hits else ('BLOCKED' if (why or not body) else 'NO ROWS')
        (ok if hits else blocked).append(name)
        print(f'  {name:16} {verdict:8} status={status} '
              f'bytes={len(body) if body else 0} hits={hits}'
              + (f'  [{why}]' if why else ''))

    print(f'\n{len(ok)} of {len(BOARDS)} answered readable rows through this exit.')
    if ok:
        print('  can move off Oxylabs: ' + ', '.join(ok))
    if blocked:
        print('  still need Oxylabs (or a browser): ' + ', '.join(blocked))
    # A blocked board is a measurement, not a failure of this script.
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
