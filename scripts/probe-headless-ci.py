#!/usr/bin/env python3
"""
Does a headless browser on a PLAIN CI address get these boards, or do they need
the residential IP too?

WHY THIS EXISTS
This answers one question for the WHOLE Oxylabs surface: which of these feeds is
the proxy actually buying something for, measured from the environment the feeds
run in rather than from a developer sandbox.

Two groups are probed, and they are asking different things.

The RENDER-GATED group came first: Stockland, Dyno Nobel and Sandfire (SAP
SuccessFactors RCM), Whitehaven (Dayforce), APS Jobs (Salesforce Aura), Naukri
and Zhaopin. From a datacentre address without a browser they return 200 and a
full-looking page carrying no readable jobs, because the results arrive after
load. That proves they need a BROWSER; it says nothing about the IP.

The ADDRESS group is everything else on the proxy — Jora, SimplyHired, LinkedIn
jobs and posts, GulfTalent, startup.jobs, the NSW bearer step, jobs.govt.nz,
NAB, Auckland Airport, TechnologyOne. Those go through Oxylabs for the exit
address, and most of those dependencies were established long enough ago that
they are beliefs rather than measurements.

WHY IT IS WORTH A RUNNER-MINUTE
One verdict in this repo's history was wrong in exactly this way. jobs.govt.nz
was moved off the proxy on 2026-08-04 on the strength of a sandbox probe, and
timed out on every request from the first real scheduled run. The sandbox
egresses through an agent proxy: a 403 there is solid evidence, a 200 is weak
evidence. This script runs where the feeds run, so its 200s mean something.

WHAT IT DOES
Drives Chromium through the same sequence the Oxylabs `browser_instructions`
describe — load, settle, and where the board pages, click through — then counts
rows THE WAY THE SCRAPER DOES: its own row regex, or for APS and Zhaopin its
actual parser (`jobs_extract.extract_jobs`, `zhaopin.parse_search_html`), since
those two read a payload rather than markup. A bespoke "did it look right" check
would pass on a page the real scraper cannot read.

Verdict per board:
    ROWS       rows found — a browser alone is enough, no residential IP needed
    NO ROWS    browser ran, page loaded, no rows — needs more than a browser
    BLOCKED    never got a usable page at all

Run: python3 scripts/probe-headless-ci.py [--headful] [--json out.json]
Needs: pip install playwright && playwright install chromium
"""
from __future__ import annotations
import json
import os
import re
from urllib.parse import quote
import sys
import traceback

# The real parsers for the boards that do not use a regex live beside this file.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import browser_fetch  # noqa: E402
sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'tools', 'zhaopin-company-scraper'))
sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'tools', 'indeed-company-scraper'))

# ── the boards, with the settle/click behaviour their scrapers ask for ───────
# `rows` is copied verbatim from each scraper so this measures the same thing
# the nightly run measures.
SF_ROWS = r'<tr class="jobResultItem">'
SF_TITLE = r'<a class="jobTitle"[^>]*href="[^"]*career_job_req_id=\d+'

BOARDS = [
    {
        'name': 'Stockland (SuccessFactors)',
        'script': 'scripts/stockland-to-d1.py',
        'url': ('https://career10.successfactors.com/career?company=stocklanddP2'
                '&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH'),
        'settle': 6,
        'rows': SF_ROWS,
        'title': SF_TITLE,
        # The scrapers page by clicking this; we only need page 1 to answer the
        # question, but the selector is recorded so a follow-up can use it.
        'next': 'a.paginationItemLast, a[title="Next"]',
    },
    {
        'name': 'Dyno Nobel (SuccessFactors)',
        'script': 'scripts/dyno-to-d1.py',
        'url': ('https://career4.successfactors.com/career?company=IncitecPivot'
                '&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH'
                '&rcm_site_locale=en_GB'),
        'settle': 8,
        'rows': SF_ROWS,
        'title': SF_TITLE,
        'next': 'a.paginationItemLast, a[title="Next"]',
    },
    {
        'name': 'Sandfire (SuccessFactors EU)',
        'script': 'scripts/sandfire-to-d1.py',
        'url': ('https://career55.sapsf.eu/career?company=minasdeagu'
                '&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH'
                '&rcm_site_locale=en_GB'),
        'settle': 8,
        'rows': SF_ROWS,
        'title': SF_TITLE,
        'next': 'a.paginationItemLast, a[title="Next"]',
    },
    {
        'name': 'Whitehaven (Dayforce)',
        'script': 'scripts/whitehaven-dayforce-to-d1.py',
        'url': 'https://jobs.dayforcehcm.com/en-AU/whitehavencoal/CANDIDATEPORTAL',
        'settle': 8,
        'rows': r'test-id="job-posting-card"',
        'title': r'test-id="job-title"',
        'next': '.ant-pagination-item-2 a',
    },
    # The three added after the first four all came back ROWS. Same question,
    # same method — these are the rest of the render-gated group.
    {
        'name': 'APS Jobs (Salesforce Aura)',
        'script': 'scripts/aps-to-d1.py',
        'url': 'https://www.apsjobs.gov.au/s/job-search?offset=0',
        'settle': 12,  # Aura hydrates in two steps; 8s was not always enough
        # APS does not parse with a regex — it goes through the shared
        # defensive extractor. `counter` runs the real thing, so this measures
        # what the scraper measures rather than something adjacent to it.
        'counter': 'aps',
        'rows': r'job-details',
        'title': r'job-details',
        'next': None,
    },
    {
        'name': 'Naukri (Mumbai search)',
        'script': 'scripts/naukri-to-d1.py',
        # A company+city search, the shape the scraper actually walks, rather
        # than the home page — the home page renders for anyone and would have
        # told us nothing.
        'url': 'https://www.naukri.com/tata-consultancy-services-jobs-in-mumbai',
        'settle': 10,
        'rows': r'srp-jobtuple-wrapper',
        'title': r'class="[^"]*\btitle\b[^"]*"',
        'next': None,
    },
    {
        'name': 'Zhaopin (Shanghai search)',
        'script': 'scripts/zhaopin-to-d1.py',
        # jl=538 is Shanghai in Zhaopin's city ids.
        'url': 'https://sou.zhaopin.com/?kw=HSBC&jl=538&p=1',
        'settle': 10,
        # Zhaopin's rows live in a __INITIAL_STATE__ island, not in markup, so
        # the row count comes from the real parser via `counter`.
        'counter': 'zhaopin',
        'rows': r'positionURL',
        'title': r'positionURL',
        'next': None,
    },
    {
        # THE QUESTION THIS ONE ANSWERS. indeed-to-d1.py has two transports: an
        # Oxylabs path and a Playwright path. The Oxylabs path is currently
        # dead — 613 ("faulted") on essentially every request, every company
        # returning 0 jobs — so the obvious move is to run the browser path on
        # CI instead. The script's own docstring says that cannot work, that
        # "Indeed's DataDome hard-blocks datacenter IPs" and it is meant to run
        # from a residential machine. That claim is older than this probe and
        # has never been tested from a runner, and today's nzgov regression came
        # from trusting exactly this kind of untested belief about where a fetch
        # runs from. So it gets measured.
        #
        # Counted with the scraper's OWN parser, not a marker: a page that
        # renders Indeed chrome but no cards would otherwise look like a pass.
        'name': 'Indeed (AU company search)',
        'script': 'scripts/indeed-to-d1.py',
        'url': 'https://au.indeed.com/jobs?q=%22BHP%22&l=&start=0',
        'settle': 10,
        'counter': 'indeed',
        'rows': r'job_seen_beacon|jobTitle|data-jk=',
        'title': r'jobTitle',
        'next': None,
    },
    {
        # jobs.ca is a CANDIDATE, not an existing scraper — there is no script
        # for it yet. It is here to answer one question before any is written:
        # a plain request from this repo's sandbox gets HTTP 429 with a "Vercel
        # Security Checkpoint" page on EVERY path, robots.txt included, so the
        # board is unreadable without either a residential exit or a real
        # browser. If a headless Chromium on an ordinary runner address clears
        # the checkpoint, jobs.ca can be built on Playwright like the five
        # boards above; if it does not, it needs the proxy and that is a
        # different decision.
        'name': 'jobs.ca (Canada board, CANDIDATE)',
        'script': '(none yet — probing feasibility)',
        # A real employer search, not the home page: the home page may well be
        # served to anyone, and would answer a question nobody asked.
        'url': 'https://www.jobs.ca/search?q=Shopify',
        'settle': 10,
        # Deliberately loose. Nothing is known about this board's markup yet, so
        # a wrong-but-specific selector would report zero rows and be read as a
        # block. Any hit at all means the checkpoint was cleared, which is the
        # only thing this entry is asked to establish.
        'rows': r'job-?(card|item|result|listing)|/job/|data-job',
        'title': r'<h[23][^>]*>',
        'next': None,
    },
    # ── The rest of the Oxylabs surface, added 2026-08-07 ────────────────────
    # The first eight entries above were the RENDER-gated group: boards that
    # need a browser, asked whether they also need the IP. These eleven are the
    # other question — the feeds that go through Oxylabs for the ADDRESS, whose
    # dependency has never been re-measured from a runner. Each URL is the shape
    # its scraper actually walks, and each `rows` marker is copied from that
    # scraper, so a pass here means the nightly run would work.
    #
    # This matters because one verdict in this file's own history was wrong:
    # jobs.govt.nz was moved to direct on a sandbox measurement and timed out on
    # every request from the first real runner. A 200 from the wrong vantage
    # point is weak evidence; this is the right vantage point.
    {
        'name': 'Jora (AU company search)',
        'script': 'scripts/jora-to-d1.py',
        'url': 'https://au.jora.com/j?q=BHP&l=Australia&p=1',
        'settle': 6,
        'rows': r'data-braze-job-panel-view="',
        'title': r'data-braze-job-panel-view="',
        'next': None,
    },
    {
        'name': 'SimplyHired (AU search)',
        'script': 'scripts/simplyhired-to-d1.py',
        # The rows live in a __NEXT_DATA__ island. Quotes inside a <script> are
        # not entity-escaped, so the marker matches page.content() directly.
        'url': 'https://www.simplyhired.com.au/search?q=BHP',
        'settle': 8,
        'rows': r'"jobKey"',
        'title': r'"jobKey"',
        'next': None,
    },
    {
        'name': 'LinkedIn jobs (guest search)',
        'script': 'scripts/linkedin-to-d1.py',
        # The guest endpoint the scraper uses, not the logged-in job search —
        # it returns an HTML fragment of cards.
        'url': ('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings'
                '/search?keywords=BHP&start=0&sortBy=DD'),
        'settle': 5,
        'rows': r'/jobs/view/',
        'title': r'/jobs/view/',
        'next': None,
    },
    {
        'name': 'LinkedIn posts (company page)',
        'script': 'scripts/linkedin-posts-to-d1.py',
        # Measured from a hosted runner once before: 0 posts in 100 requests,
        # authwalled from the first. Re-asked because that is the single most
        # expensive feed to keep on the proxy if it ever stops being true.
        'url': 'https://www.linkedin.com/company/bhp/',
        'settle': 10,
        'rows': r'urn:li:activity',
        'title': r'urn:li:activity',
        'next': None,
    },
    {
        'name': 'GulfTalent (jobs API)',
        'script': 'scripts/gulftalent-to-d1.py',
        # A JSON endpoint. See `json_key`: navigating a browser to JSON wraps it
        # in <pre> and entity-escapes the quotes, so this is counted by parsing
        # the body text rather than by a regex over the markup.
        'url': 'https://www.gulftalent.com/api/jobs/search?limit=50&offset=0',
        'settle': 3,
        'json_key': 'positions',
        'rows': r'"positions"',
        'title': r'"positions"',
        'next': None,
    },
    {
        'name': 'startup.jobs (company page)',
        'script': 'scripts/startupjobs-to-d1.py',
        # Only the per-company pages need the proxy; the 42,885-company sitemap
        # on cdn.startup.jobs already answers a plain request.
        # A slug taken from the company sitemap the scraper itself reads, NOT
        # guessed: the first run of this entry used /company/canva, which does
        # not exist. The runner answered 404 — reachable, wrong page — and the
        # bare marker matched once on the 404 body, so it scored ROWS=1 and
        # would have been read as a pass. The marker now requires the href the
        # scraper's own CARD regex requires, so a stray attribute cannot score.
        'url': 'https://startup.jobs/company/twitch',
        'settle': 6,
        'rows': r'data-post-template-target="title"[^>]*href="/',
        'title': r'data-post-template-target="title"[^>]*href="/',
        'next': None,
    },
    {
        'name': 'NSW iworkfor (bearer step)',
        'script': 'scripts/nsw-gov-to-d1.py',
        # The search API (api.ad-core04.com) is already plain HTTP. Oxylabs is
        # bought for ONE step: reading the OAuth bearer out of the site's own JS
        # bundle, because iworkfor.nsw.gov.au sits behind Cloudflare's "Just a
        # moment" and 403s a datacentre IP even for static /_next/ chunks. So
        # the marker is the bundle, not a job.
        'url': 'https://iworkfor.nsw.gov.au/',
        'settle': 10,
        'rows': r'/_next/static/',
        'title': r'/_next/static/',
        'next': None,
    },
    {
        'name': 'jobs.govt.nz (Auckland page 1)',
        'script': 'scripts/nzgov-to-d1.py',
        # THE ONE THAT REVERTED. Moved to direct 2026-08-04 on a sandbox
        # measurement, then timed out on every request from the first real
        # runner and went back on the proxy. This is that measurement, taken
        # from the environment the feed actually runs in.
        'url': ('https://jobs.govt.nz/jobtools/jncustomsearch.searchResults'
                '?in_organid=16563&in_jobDate=All&in_location=Auckland&in_pg=0'),
        'settle': 5,
        'rows': r'<td class="job_title">',
        'title': r'<td class="job_title">',
        'next': None,
    },
    {
        'name': 'NAB careers (Clinch cards)',
        'script': 'scripts/nab-to-d1.py',
        # 12s is the settle its own scraper uses: below that the capture can
        # still be the WAF challenge rather than the board.
        'url': 'https://careers.nab.com.au/jobs/search',
        'settle': 12,
        'rows': r'job-search-results-card-col',
        'title': r'job-search-results-card-title',
        'next': None,
    },
    {
        'name': 'Auckland Airport (WPJB)',
        'script': 'scripts/aucklandairport-to-d1.py',
        'url': 'https://careers.aucklandairport.co.nz/jobs/',
        'settle': 6,
        'rows': r'wpjb-job-tile',
        'title': r'wpjb-job-tile',
        'next': None,
    },
    {
        'name': 'TechnologyOne (join-the-team)',
        'script': 'scripts/technologyone-to-d1.py',
        'url': 'https://www.technology1.com/company/life-at-techone/join-the-team',
        'settle': 8,
        'rows': r'<tr data-referrals="',
        'title': r'<tr data-referrals="',
        'next': None,
    },
]


def count_with_real_parser(which: str, html: str) -> int | None:
    """Row count from the scraper's own parser, for the boards that do not use a
    regex. Returns None if the helper cannot be imported, so a missing module
    degrades to the regex count rather than silently reporting zero."""
    try:
        if which == 'aps':
            import jobs_extract as jx
            rows, _how = jx.extract_jobs(html, r'job-details', 'https://www.apsjobs.gov.au')
            return len(rows)
        if which == 'zhaopin':
            import zhaopin_company_scraper as zp
            return len(zp.parse_search_html(html))
        if which == 'indeed':
            import indeed_company_scraper as ind
            return len(ind.parse_search_html(html, 'https://au.indeed.com'))
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  real-parser count unavailable for {which}: {str(e)[:90]}\n')
    return None

# A challenge page is not a board. Counting rows on one would report NO ROWS,
# which is the wrong diagnosis — "blocked" and "rendered but empty" need
# different fixes, so they are told apart explicitly.
#
# These are matched ONLY when the page yielded no rows. The first run of this
# probe reported "[Akamai deny]" against all three SuccessFactors boards and
# "[captcha / challenge]" against Dayforce while simultaneously finding 10, 10,
# 6 and 25 rows — the strings live in the pages' own JavaScript (error handling,
# an application-form captcha widget), not in a block page. Searching a fully
# rendered application for the words a block page uses will always find them
# somewhere. A block is a diagnosis for an EMPTY result, not an independent
# signal, so it is only asked about when there is an emptiness to explain.
BLOCK_MARKERS = [
    (r'Just a moment', 'Cloudflare interstitial'),
    (r'Access Denied', 'Akamai deny'),
    (r'captcha|challenge-platform', 'captcha / challenge'),
    (r'Request unsuccessful|Incapsula', 'Imperva'),
    (r'Pardon Our Interruption', 'DataDome'),
    (r'Vercel Security Checkpoint', 'Vercel checkpoint'),
]

args = sys.argv[1:]
HEADFUL = '--headful' in args
OUT = args[args.index('--json') + 1] if '--json' in args else None

# --via-proxy: egress through SCRAPE_PROXY instead of the runner's own address.
# The whole point of the run changes with this flag — without it the question is
# "does a plain CI address work", with it "does OUR residential exit work" — so
# it is recorded in the JSON and printed in the header rather than left implicit.
VIA_PROXY = '--via-proxy' in args
# --volume N: for the roster-wide feeds, walk N DIFFERENT company queries in
# sequence and report where blocking starts. See volume_walk() for why a
# single-request probe is not evidence for these.
VOLUME = int(args[args.index('--volume') + 1]) if '--volume' in args else 0

PROXY = browser_fetch.proxy_from_env() if VIA_PROXY else None
if VIA_PROXY and not PROXY:
    sys.exit('--via-proxy needs SCRAPE_PROXY set (http://user:pass@host:port).')


def blocked_as(html: str) -> str | None:
    for pat, label in BLOCK_MARKERS:
        if re.search(pat, html, re.I):
            return label
    return None


# ── volume ───────────────────────────────────────────────────────────────────
# WHY A SECOND MODE EXISTS AT ALL
# The per-board probe answers "is the door open", by making ONE request. For the
# roster-wide feeds that is not the question. Indeed walks 355 companies a night,
# SimplyHired 355, Jora 355 — and the thing that blocks them is not the first
# request, it is the four-hundredth from the same address. A single green request
# through a residential exit is exactly the kind of positive result from an
# unrepresentative sample that this repo has already been burned by twice.
#
# So this walks N DIFFERENT company queries in sequence, against the real search
# URL each scraper uses, and reports the request number at which rows stop
# coming back. "Blocked from request 1" and "blocked from request 220" are
# different answers with different consequences, and neither is visible from a
# single fetch.
VOLUME_TARGETS = {
    'indeed': ('https://au.indeed.com/jobs?q=%22{q}%22&l=&start=0',
               r'job_seen_beacon|jobTitle|data-jk='),
    'simplyhired': ('https://www.simplyhired.com.au/search?q={q}', r'"jobKey"'),
    'jora': ('https://au.jora.com/j?q={q}&l=Australia&p=1',
             r'data-braze-job-panel-view="'),
}


def roster_names(n: int) -> list[str]:
    """Real employer names, so the walk looks like the walk it is modelling.

    N repetitions of one query would be cached upstream and would test nothing;
    the nightly runs search a different company every time. Read straight out of
    auJobsTargets.ts because this file cannot run bun."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        'src', 'employsi', 'data', 'auJobsTargets.ts')
    try:
        names = re.findall(r'name:\s*"([^"]+)"', open(path, encoding='utf-8').read())
    except OSError:
        names = []
    seen, out = set(), []
    for nm in names:
        if nm.lower() in seen:
            continue
        seen.add(nm.lower())
        out.append(nm)
    return out[:n]


def volume_walk(pw, which: str, n: int) -> dict:
    tmpl, row_re = VOLUME_TARGETS[which]
    names = roster_names(n)
    res = {'target': which, 'requested': n, 'attempted': len(names),
           'ok': 0, 'first_block_at': None, 'consecutive_fail_tail': 0}
    browser = pw.chromium.launch(headless=not HEADFUL,
                                 **({'proxy': PROXY} if PROXY else {}))
    try:
        ctx = browser.new_context(
            user_agent=('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) '
                        'Chrome/126.0.0.0 Safari/537.36'),
            locale='en-AU')
        page = ctx.new_page()
        run = 0
        for i, nm in enumerate(names, 1):
            url = tmpl.format(q=quote(f'"{nm}"' if which == 'indeed' else nm))
            try:
                page.goto(url, wait_until='domcontentloaded', timeout=60_000)
                page.wait_for_timeout(2500)
                hits = len(re.findall(row_re, page.content()))
            except Exception:  # noqa: BLE001
                hits = 0
            if hits:
                res['ok'] += 1
                run = 0
            else:
                run += 1
                if res['first_block_at'] is None:
                    res['first_block_at'] = i
            res['consecutive_fail_tail'] = run
            # A long unbroken failure run means the address is done; walking the
            # rest wastes minutes to learn nothing new.
            if run >= 12:
                res['stopped_early_at'] = i
                break
        ctx.close()
    finally:
        browser.close()
    return res


def egress_ip(pw) -> str:
    """What the TARGETS see. Printed before anything else, because the failure
    this guards against is silent: a proxy that is misconfigured, unreachable or
    ignored leaves Chromium egressing from the runner, every board passes, and
    the run is read as "our residential exit works" when it was never used. An
    address is the only thing that distinguishes those two outcomes."""
    browser = pw.chromium.launch(headless=True, **({'proxy': PROXY} if PROXY else {}))
    try:
        page = browser.new_page()
        page.goto('https://api.ipify.org?format=json', timeout=45_000)
        return json.loads(page.evaluate('document.body.innerText')).get('ip', '?')
    except Exception as e:  # noqa: BLE001
        return f'unknown ({str(e)[:60]})'
    finally:
        browser.close()


def probe(pw, board: dict) -> dict:
    res = {'name': board['name'], 'script': board['script'], 'url': board['url']}
    browser = pw.chromium.launch(headless=not HEADFUL,
                                 **({'proxy': PROXY} if PROXY else {}))
    try:
        ctx = browser.new_context(
            user_agent=('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) '
                        'Chrome/126.0.0.0 Safari/537.36'),
            viewport={'width': 1440, 'height': 900},
            locale='en-AU',
        )
        page = ctx.new_page()
        r = page.goto(board['url'], wait_until='domcontentloaded', timeout=90_000)
        res['status'] = r.status if r else None
        # The settle wait is what the Oxylabs instruction list does: these boards
        # fetch their rows AFTER load, so reading the DOM immediately is the same
        # mistake as reading the served HTML.
        page.wait_for_timeout(board['settle'] * 1000)
        html = page.content()
        res['bytes'] = len(html)
        res['rows'] = len(re.findall(board['rows'], html))
        res['titles'] = len(re.findall(board['title'], html))
        # A JSON endpoint navigated by a BROWSER is not JSON any more: Chromium
        # wraps it in <pre> and entity-escapes every quote, so `"positions"`
        # matches nothing and the target reads as blocked when it answered
        # perfectly. These are counted off the body text instead, and the count
        # is the length of the array the scraper reads rather than a marker.
        if board.get('json_key'):
            try:
                doc = json.loads(page.evaluate('document.body.innerText'))
                arr = doc.get(board['json_key']) or []
                res['rows'] = len(arr)
                res['titles'] = len(arr)
            except Exception as e:  # noqa: BLE001
                res['json_error'] = str(e)[:120]
                res['rows'] = 0
                res['titles'] = 0
        # Where the scraper uses a parser rather than a regex, that parser is
        # the authority: a marker appearing in the markup is not the same claim
        # as the scraper being able to read a job out of it.
        if board.get('counter'):
            real = count_with_real_parser(board['counter'], html)
            if real is not None:
                res['regex_hits'] = res['rows']
                res['rows'] = real
                res['titles'] = real
        # Only when there is an emptiness to explain — see BLOCK_MARKERS.
        res['blocked_as'] = None if res['rows'] else blocked_as(html)

        # One paging click, to show the interaction the nightly run depends on
        # also works — a board that renders page 1 but refuses to page is only
        # half solved.
        res['page2_rows'] = None
        if res['rows'] and board.get('next'):
            try:
                el = page.query_selector(board['next'])
                if el:
                    el.click()
                    page.wait_for_timeout(board['settle'] * 1000)
                    res['page2_rows'] = len(re.findall(board['rows'], page.content()))
            except Exception as e:  # noqa: BLE001
                res['page2_error'] = str(e)[:120]
        ctx.close()
    except Exception as e:  # noqa: BLE001
        res['error'] = str(e)[:200]
        res['rows'] = 0
    finally:
        browser.close()

    if res.get('rows'):
        res['verdict'] = 'ROWS'
    elif res.get('blocked_as') or res.get('error'):
        res['verdict'] = 'BLOCKED'
    else:
        res['verdict'] = 'NO ROWS'
    return res


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit('playwright not installed: pip install playwright && playwright install chromium')

    where = 'via SCRAPE_PROXY' if VIA_PROXY else 'from this runner'
    print(f'Headless Chromium {where}, against {len(BOARDS)} Oxylabs targets.')
    print("Counting rows the way each scraper does — its own regex, or its own "
          "parser where it uses one.")
    out = []
    with sync_playwright() as pw:
        ip = egress_ip(pw)
        print(f'Egress address the targets see: {ip}')
        if VIA_PROXY:
            print('  (if that is a datacentre address, the proxy is not being '
                  'used and every result below is about the runner, not your exit.)')
        print()
        vol = []
        if VOLUME:
            print(f'Volume walk: {VOLUME} different company queries per feed.\n')
            for which in VOLUME_TARGETS:
                r = volume_walk(pw, which, VOLUME)
                vol.append(r)
                print(f"  {which:<14} {r['ok']}/{r['attempted']} returned rows"
                      + (f", first block at #{r['first_block_at']}"
                         if r['first_block_at'] else ', no blocks')
                      + (f", stopped early at #{r['stopped_early_at']}"
                         if r.get('stopped_early_at') else ''))
            print()
        for b in BOARDS:
            try:
                r = probe(pw, b)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                r = {'name': b['name'], 'verdict': 'BLOCKED', 'error': 'probe crashed'}
            out.append(r)
            print(f"  {r['name']:32} {r['verdict']:8} "
                  f"status={r.get('status')} bytes={r.get('bytes')} "
                  f"rows={r.get('rows')} titles={r.get('titles')}"
                  + (f" page2_rows={r['page2_rows']}" if r.get('page2_rows') is not None else '')
                  + (f"  [{r['blocked_as']}]" if r.get('blocked_as') else '')
                  + (f"  err={r['error']}" if r.get('error') else ''))

    got = [r for r in out if r['verdict'] == 'ROWS']
    print(f"\n{len(got)} of {len(out)} boards returned rows to a headless browser "
          f"on a plain CI address.")
    if len(got) == len(out):
        print('=> A self-hosted Playwright would replace Oxylabs for all four. '
              'No residential IP needed.')
    elif got:
        print('=> Mixed: ' + ', '.join(r['name'] for r in got) + ' need only a browser; '
              'the rest need more.')
    else:
        print('=> None. These need the residential IP as well as the browser, '
              'so they stay on a proxy.')

    if OUT:
        # The transport and the egress address are part of the RESULT, not
        # context around it: the same board list means opposite things read
        # from a runner and read through a residential exit, and an artifact
        # that records only the rows cannot tell you which run it was.
        with open(OUT, 'w') as f:
            json.dump({'via_proxy': VIA_PROXY, 'egress_ip': ip,
                       'volume': vol, 'boards': out}, f, indent=2)
        print(f'wrote {OUT}')
    # Always exit 0: this is a measurement, and "they are blocked" is a real
    # result rather than a failure of the probe.
    return 0


if __name__ == '__main__':
    sys.exit(main())
