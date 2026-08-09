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

RUNNING IT THROUGH A RESIDENTIAL EXIT
--via-proxy sends Chromium out through SCRAPE_PROXY instead of the runner, which
turns "does a plain CI address work" into "does OUR exit work". The two runs are
only comparable if the proxy was genuinely used, so that is CHECKED rather than
displayed: the run also fetches the runner's own address with no proxy, and ends
non-zero if the two match. See check_egress().

    SCRAPE_PROXY=http://user:pass@host:port

For IPRoyal residential the host is geo.iproyal.com:12321 and the targeting
options ride on the PASSWORD, not the path:

    http://USER:PASS_country-au@geo.iproyal.com:12321                 rotating
    http://USER:PASS_country-au_session-abc123_lifetime-30m@geo...    sticky

Which of those you want depends on the question. The volume walk is asking
whether ONE residential address survives 355 searches a night, and a rotating
pool answers it with 355 different addresses — a much prettier number about
something else. Use a sticky session for the volume walk. The run reports which
mode it got either way, by sampling the address twice.

Run: python3 scripts/probe-headless-ci.py [--headful] [--json out.json]
     python3 scripts/probe-headless-ci.py --via-proxy --proxy-check
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
import http_fetch  # noqa: E402
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
# --proxy-check: stop after check_egress(). Three requests instead of an hour,
# for confirming the secret is right before spending the hour.
PROXY_CHECK = '--proxy-check' in args
# --aps-paging: one board, one question, ~2 minutes. Does anything advance the
# APS result set past the first fifteen rows?
APS_PAGING = '--aps-paging' in args
# --tunnel-check: does the proxy open a CONNECT tunnel to these hosts at all?
# Seconds, not minutes, and it answers a question no board probe can.
TUNNEL_CHECK = '--tunnel-check' in args
# --nab-route: can careers.nab.com.au be walked from a plain runner?
NAB_ROUTE = '--nab-route' in args

PROXY = browser_fetch.proxy_from_env() if VIA_PROXY else None
if VIA_PROXY and not PROXY:
    sys.exit('--via-proxy needs SCRAPE_PROXY set (http://user:pass@host:port).')
if PROXY_CHECK and not VIA_PROXY:
    sys.exit('--proxy-check only means something with --via-proxy: without it there '
             'is no proxy to check.')


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
# Three feeds walk COMPANY NAMES and three walk SLUGS, and mixing those up
# would not fail loudly — it would 404 its way through the run and be recorded
# as a block. So the query source is declared per target.
#
# The LinkedIn slugs are REAL ONES, read out of the production company_slugs
# cache in D1 (78 confirmed 2026-08-05..08). Deriving them from company names
# would have produced mostly-wrong guesses, and a wrong slug is a 404 rather
# than a refusal — the exact confusion this measurement exists to avoid.
LINKEDIN_SLUGS = [
    'ansell', 'aragroup', 'aurizon', 'bolton-clarke',
    'brisbane-catholic-education', 'consolidatedtravel', 'evolution-mining',
    'evt-limited', 'fortescue', 'goodstart-early-learning',
    'great-southern-bank', 'hansen-technologies', 'harvey-norman',
    'iluka-resources', 'kennardshire', 'macmahon', 'mecca-brands', 'meriton',
    'merivale', 'metcash', 'mirvac', 'orabandamining', 'perpetual',
    'perseus-mining-limited', 'perth-airport', 'resolute-mining', 'san-remo',
    'shell', 'sims-metal', 'super-retail-group', 'talent-international',
    'teamglobalexpress', 'treasury-wine-estates', 'village-roadshow',
    'wisetech-global', 'worley', '4dmedical', 'adco-constructions', 'akd',
    'asx', 'australian-unity', 'bank-of-queensland', 'bega-cheese-limited',
    'bhp', 'canberra-airport', 'car-group', 'cmv-group', 'creation-homes',
    'dalrymple-bay-infrastructure', 'deterra-royalties', 'drake-supermarkets',
    'dyno-nobel', 'gold-road-resources', 'hcf', 'jupitermines',
    'kennards-self-storage', 'king-and-wood-mallesons', 'kpmg', 'lendlease',
    'mineral-resources-limited', 'nickel-industries-limited',
    'opal-aged-care', 'pallion', 'pro-medicus-limited', 'qube-holdings',
    'regis-resources', 'richard-crookes-constructions', 'sigma-healthcare',
    'sonic-healthcare', 'stanmore-resources-limited',
    'stanmore-resources-limited', 'tabcorp', 'tasmea-limited',
    'the-lottery-corporation', 'thomas-foods-international', 'transurban',
    'turosi', 'woolworths',
]

VOLUME_TARGETS = {
    'indeed': {'url': 'https://au.indeed.com/jobs?q=%22{q}%22&l=&start=0',
               'rows': r'job_seen_beacon|jobTitle|data-jk=', 'source': 'names'},
    'simplyhired': {'url': 'https://www.simplyhired.com.au/search?q={q}',
                    'rows': r'"jobKey"', 'source': 'names'},
    'jora': {'url': 'https://au.jora.com/j?q={q}&l=Australia&p=1',
             'rows': r'data-braze-job-panel-view="', 'source': 'names'},
    'linkedin-jobs': {
        'url': ('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings'
                '/search?keywords={q}&start=0&sortBy=DD'),
        'rows': r'/jobs/view/', 'source': 'names'},
    'linkedin-posts': {'url': 'https://www.linkedin.com/company/{q}/',
                       'rows': r'urn:li:activity', 'source': 'li-slugs'},
    'startupjobs': {'url': 'https://startup.jobs/company/{q}',
                    'rows': r'data-post-template-target="title"[^>]*href="/',
                    'source': 'sj-slugs'},
}


def startupjobs_slugs(n: int) -> list[str]:
    """Real slugs from the company sitemap the scraper itself reads.

    The sitemap is on cdn.startup.jobs, which answers a plain request — it is
    the half of that feed that never needed a proxy. Served uncompressed
    despite the .gz name, which is why this does not gunzip it."""
    import urllib.request
    try:
        req = urllib.request.Request(
            'https://cdn.startup.jobs/sitemaps/startupjobs/companies.xml.gz',
            headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=90) as r:
            body = r.read(400_000).decode('utf-8', 'replace')
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  could not read the startup.jobs sitemap: {str(e)[:90]}\n')
        return []
    return re.findall(r'<loc>https://startup\.jobs/company/([a-z0-9-]+)</loc>', body)[:n]


def volume_queries(which: str, n: int) -> list[str]:
    src = VOLUME_TARGETS[which]['source']
    if src == 'names':
        return roster_names(n)
    if src == 'li-slugs':
        return LINKEDIN_SLUGS[:n]
    return startupjobs_slugs(n)


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
    spec = VOLUME_TARGETS[which]
    tmpl, row_re = spec['url'], spec['rows']
    names = volume_queries(which, n)
    res = {'target': which, 'requested': n, 'attempted': len(names),
           'ok': 0, 'not_found': 0, 'first_block_at': None,
           'consecutive_fail_tail': 0}
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
            status = None
            try:
                r = page.goto(url, wait_until='domcontentloaded', timeout=60_000)
                status = r.status if r else None
                page.wait_for_timeout(2500)
                hits = len(re.findall(row_re, page.content()))
            except Exception:  # noqa: BLE001
                hits = 0
            if hits:
                res['ok'] += 1
                run = 0
            elif status == 404:
                # A MISSING PAGE IS NOT A REFUSAL. The slug-driven feeds walk
                # names that can legitimately no longer exist, and counting
                # those as blocks would manufacture a wall out of churn. Not
                # counted either way, and not allowed to end the walk.
                res['not_found'] += 1
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


def egress_ip(pw, proxy: dict | None = None) -> str:
    """What the TARGETS see. Printed before anything else, because the failure
    this guards against is silent: a proxy that is misconfigured, unreachable or
    ignored leaves Chromium egressing from the runner, every board passes, and
    the run is read as "our residential exit works" when it was never used. An
    address is the only thing that distinguishes those two outcomes."""
    browser = pw.chromium.launch(headless=True, **({'proxy': proxy} if proxy else {}))
    try:
        page = browser.new_page()
        page.goto('https://api.ipify.org?format=json', timeout=45_000)
        return json.loads(page.evaluate('document.body.innerText')).get('ip', '?')
    except Exception as e:  # noqa: BLE001
        return f'unknown ({str(e)[:60]})'
    finally:
        browser.close()


def check_egress(pw) -> dict:
    """Establish, before spending the runner's time, that the proxy is real.

    Printing the address was not enough. It made the silent failure VISIBLE but
    still left it up to a human to notice that the "residential exit" run
    reported the runner's own datacentre address — and the whole reason this
    check exists is that such a run reads as a pass on every board. So the
    comparison is made here and a match ends the run non-zero.

    Three samples, answering three different things:

      direct   the runner's own address, fetched with no proxy at all. Without
               it there is nothing to compare against and "is that a datacentre
               address?" is a judgement call rather than a test.
      first    the address the targets see through SCRAPE_PROXY.
      second   the same request again. STICKY vs ROTATING changes what the
               volume walk means, and neither mode is wrong — but a rotating
               pool answering 80 queries is 80 addresses sharing the load, and
               reading that as "one residential IP survives 80 requests" is the
               same unrepresentative-sample error this probe was written to
               stop. It is recorded rather than assumed.

    A failed DIRECT sample is only a warning: it makes the comparison
    impossible, but it is not itself evidence the proxy went unused.
    """
    first = egress_ip(pw, PROXY)
    info = {'egress_ip': first, 'direct_ip': None, 'second_ip': None, 'rotates': None}
    print(f'Egress address the targets see: {first}')
    if not VIA_PROXY:
        return info

    direct = egress_ip(pw, None)
    second = egress_ip(pw, PROXY)
    info.update(direct_ip=direct, second_ip=second)
    print(f'Runner address with no proxy:   {direct}')
    print(f'Second sample through it:       {second}')

    if first.startswith('unknown'):
        # A DEAD PROXY IS NOT A BLOCKED BOARD, and left alone it would be
        # recorded as twenty of them: every fetch fails, every verdict is
        # BLOCKED, and the summary line reads "None — these need the
        # residential IP as well as the browser". That is the strongest
        # possible wrong conclusion, drawn from the proxy never having
        # answered. The same-address check below cannot catch it, because an
        # unreachable proxy never matches anything.
        sys.exit(f'\nFAILED: nothing answered through SCRAPE_PROXY — {first}.\n'
                 + (f'The runner itself reached the check from {direct}, so the '
                    'proxy is the part that is down, not the network.\n'
                    if not direct.startswith('unknown') else '')
                 + 'Every board would fail below and be recorded as a block, so the '
                   'run stops here. Check the host, port and credentials.')

    if direct.startswith('unknown'):
        print('  WARNING: could not read the runner\'s own address, so "was the '
              'proxy used?" could not be checked. Read the result accordingly.')
    elif first == direct:
        sys.exit('\nFAILED: the address through SCRAPE_PROXY is the runner\'s own '
                 f'address ({direct}).\nChromium is not egressing through the proxy, '
                 'so every board result below would be about this runner rather than '
                 'your residential exit. Fix the secret and re-dispatch; a pass here '
                 'would be meaningless.')

    if not first.startswith('unknown') and not second.startswith('unknown'):
        info['rotates'] = first != second
        print('  Session: ' + ('ROTATING — a new address per request, so the volume '
                               'walk below measures a POOL, not one address.'
                               if info['rotates'] else
                               'STICKY — one address for the whole run, which is what '
                               'the volume walk needs to mean anything.'))
    return info


# ── can NAB be walked without a proxy at all? ────────────────────────────────
# careers.nab.com.au runs Clinch and SERVER-RENDERS its job list — no JavaScript
# is needed to read a card. What stops a plain address is an AWS WAF that flags
# by reputation and VOLUME, and the note in nab-to-d1.py is precise about the
# shape: "the first request returned the full page, and subsequent ones a 202
# with an empty body".
#
# A first request that works is the whole opening. Two things follow from it and
# neither has been measured:
#
#   1. HOW FAR does a plain runner actually get, and does pacing move that line?
#      The scraper walks ~20 pages of 30 cards. If a paced walk gets all of them
#      the feed needs no proxy at all. If it dies at page 2 no pacing will save
#      it. Either way it is one runner-minute to know.
#   2. WHAT DOES THE PAGE TALK TO? This repo has twice found an ATS's JSON API
#      on a host the WAF does not cover (/api/pcsx/search, /api/apply/v2/jobs).
#      Every request the page makes is captured here, so the answer comes from
#      the site rather than from guessing Clinch's URL scheme.
#
# A 202 WITH AN EMPTY BODY IS THE WAF, NOT AN EMPTY BOARD, and the two are told
# apart explicitly — reporting "0 cards" for a throttled page is how a blocked
# feed gets recorded as a quiet employer.
NAB_SEARCH = 'https://careers.nab.com.au/jobs/search'
NAB_CARD = r'job-search-results-card-col'   # copied from nab-to-d1.py's CARD_SPLIT


def nab_route(pw, pages: int = 8, pace_s: float = 6.0) -> dict:
    res = {'pages': [], 'network': [], 'pace_s': pace_s}
    browser = pw.chromium.launch(headless=not HEADFUL,
                                 **({'proxy': PROXY} if PROXY else {}))
    try:
        ctx = browser.new_context(
            user_agent=('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                        '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'),
            viewport={'width': 1440, 'height': 900}, locale='en-AU')
        page = ctx.new_page()

        seen_hosts: dict = {}

        def note(response):
            try:
                from urllib.parse import urlsplit
                u = urlsplit(response.url)
                ct = (response.headers or {}).get('content-type', '')
                # JSON off ANY host is the interesting case — that is what an
                # ATS API looks like, and it is what could take this off the
                # proxy for nothing.
                if 'json' in ct.lower():
                    k = f'{u.netloc}{u.path}'
                    if k not in seen_hosts:
                        seen_hosts[k] = {'url': response.url[:160],
                                         'status': response.status,
                                         'content_type': ct[:60]}
            except Exception:  # noqa: BLE001
                pass

        page.on('response', note)

        for n in range(1, pages + 1):
            url = f'{NAB_SEARCH}?page={n}'
            row = {'page': n}
            try:
                r = page.goto(url, wait_until='domcontentloaded', timeout=90_000)
                row['status'] = r.status if r else None
                page.wait_for_timeout(3000)
                html = page.content()
                row['bytes'] = len(html)
                # The split yields one leading chunk before the first card.
                row['cards'] = max(0, len(re.split(NAB_CARD, html)) - 1)
                if row['status'] == 202 or (row['bytes'] < 2000 and not row['cards']):
                    row['waf'] = True
                elif not row['cards']:
                    row['blocked_as'] = blocked_as(html)
            except Exception as e:  # noqa: BLE001
                row['error'] = str(e)[:140]
            res['pages'].append(row)
            if n < pages:
                page.wait_for_timeout(int(pace_s * 1000))
        res['network'] = list(seen_hosts.values())[:20]
        ctx.close()
    except Exception as e:  # noqa: BLE001
        res['error'] = str(e)[:200]
    finally:
        browser.close()
    return res


def nab_report(pw) -> int:
    where = 'via SCRAPE_PROXY' if VIA_PROXY else 'from this runner, NO proxy'
    print(f'NAB route probe, {where}.')
    print('Asking two things: how far a paced walk gets, and whether the page '
          'talks to a JSON API on a host the WAF does not cover.\n')
    r = nab_route(pw)
    ok = 0
    for row in r['pages']:
        if row.get('error'):
            print(f"  page {row['page']:<2} ERROR {row['error']}")
            continue
        tag = ('WAF' if row.get('waf') else
               (row.get('blocked_as') or 'ok') if not row.get('cards') else 'CARDS')
        if row.get('cards'):
            ok += 1
        print(f"  page {row['page']:<2} {tag:<22} status={row.get('status')} "
              f"bytes={row.get('bytes')} cards={row.get('cards')}")
    print(f"\n  {ok} of {len(r['pages'])} pages returned cards at "
          f"{r['pace_s']}s spacing, no proxy.")
    print('\n  JSON endpoints the page called:')
    if not r['network']:
        print('      (none — the list really is server-rendered HTML only, so '
              'there is no API shortcut to take)')
    for n in r['network']:
        print(f"      {n['status']} {n['url']}")
    if r.get('error'):
        print(f"\n  probe error: {r['error']}")
    print()
    if ok == len(r['pages']):
        print('VERDICT: a paced walk got every page from a plain runner. NAB can '
              'come off the proxy — port it to browser_fetch with this spacing '
              'and keep the existing "no cards = exit non-zero" floor.')
    elif ok:
        print(f'VERDICT: it dies after {ok} page(s). Pacing alone is not enough for '
              f'a full walk; if a JSON endpoint appeared above, that is the route '
              f'worth taking instead.')
    else:
        print('VERDICT: not one page from a plain runner. The WAF is on the address '
              'and NAB stays on a paid exit.')
    return 0


# ── why the proxy refuses a tunnel ───────────────────────────────────────────
# PROXY FAIL is one bucket hiding at least three different causes, and they have
# different fixes: a provider-side domain blocklist (ask them to lift it), a
# plan or port restriction (change plan), or DNS. Chromium collapses all of them
# into ERR_TUNNEL_CONNECTION_FAILED, which names none.
#
# So this skips Chromium and speaks HTTP CONNECT to the proxy directly. The
# proxy's OWN status line is the diagnosis — 403 is a blocklist, 407 is
# credentials, 502/504 is upstream — and it is the sentence to quote at support.
#
# A CONTROL HOST RUNS IN THE SAME PASS. Without it, "the tunnel failed" cannot
# be told apart from "the proxy is down today", and a support ticket built on
# the second one wastes everybody's time.
TUNNEL_HOSTS = [
    ('api.ipify.org', 'control — must succeed for anything below to mean anything'),
    ('www.linkedin.com', 'linkedin-to-d1.py, linkedin-posts-to-d1.py'),
    ('careers.nab.com.au', 'nab-to-d1.py'),
    ('www.apsjobs.gov.au', 'aps-to-d1.py (already off the proxy; asked for completeness)'),
    ('iworkfor.nsw.gov.au', 'nsw-gov-to-d1.py (already off the proxy; asked for completeness)'),
]


def tunnel_check(host: str, port: int = 443) -> dict:
    """Ask the proxy for a tunnel to `host` and report what it says back."""
    import base64
    import socket
    from urllib.parse import urlsplit

    out = {'host': host}
    prox = browser_fetch.proxy_from_env()
    if not prox:
        return {**out, 'result': 'SCRAPE_PROXY not set'}
    u = urlsplit(prox['server'])
    req = f'CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n'
    if prox.get('username'):
        # Credentials come back DECODED from proxy_from_env, which is what the
        # Basic header needs — encoding them twice authenticates as nobody and
        # returns a 407 that reads exactly like a blocklist.
        tok = base64.b64encode(
            f"{prox['username']}:{prox['password']}".encode()).decode()
        req += f'Proxy-Authorization: Basic {tok}\r\n'
    req += '\r\n'
    try:
        with socket.create_connection((u.hostname, u.port or 8080), timeout=30) as sk:
            sk.sendall(req.encode())
            sk.settimeout(30)
            raw = b''
            while b'\r\n\r\n' not in raw and len(raw) < 8192:
                chunk = sk.recv(4096)
                if not chunk:
                    break
                raw += chunk
    except Exception as e:  # noqa: BLE001
        return {**out, 'result': f'{type(e).__name__}: {str(e)[:120]}'}
    if not raw:
        return {**out, 'result': 'proxy closed the connection without answering'}
    head = raw.decode('latin-1', 'replace').split('\r\n\r\n')[0]
    lines = [ln for ln in head.split('\r\n') if ln.strip()]
    status = lines[0] if lines else '(no status line)'
    code = 0
    parts = status.split()
    if len(parts) > 1 and parts[1].isdigit():
        code = int(parts[1])
    return {**out, 'status': status, 'code': code,
            'headers': lines[1:6], 'ok': 200 <= code < 300}


def tunnel_report() -> int:
    print('CONNECT tunnel check, straight to the proxy — no browser.')
    print(f'exit: {http_fetch.proxy_label()}\n')
    rows = [(h, why, tunnel_check(h)) for h, why in TUNNEL_HOSTS]
    for host, why, r in rows:
        verdict = ('OPEN' if r.get('ok') else
                   'REFUSED' if r.get('code') else 'NO ANSWER')
        print(f'  {host:24} {verdict:<10} {r.get("status") or r.get("result")}')
        for h in r.get('headers') or []:
            print(f'      {h[:100]}')
        print(f'      ({why})')
    print()
    control = next((r for h, _w, r in rows if h == 'api.ipify.org'), {})
    if not control.get('ok'):
        print('The CONTROL host did not tunnel either. Nothing below it is evidence '
              'about any particular target — the proxy or the credentials are the '
              'problem. Fix that before reading the rest or raising a ticket.')
        return 1
    refused = [(h, r) for h, _w, r in rows
               if h != 'api.ipify.org' and not r.get('ok')]
    if not refused:
        print('Every host tunnels. The earlier PROXY FAILs were not a blocklist — '
              're-run the board probe (--via-proxy) and read the targets instead.')
        return 0
    print('The control tunnels and these do not, so the refusal is per-HOST — '
          'a provider-side blocklist rather than a broken exit:')
    for h, r in refused:
        print(f'  {h}: {r.get("status") or r.get("result")}')
    print('\nQuote those status lines at IPRoyal and ask whether the domain can be '
          'enabled on this plan.')
    return 0


# ── APS pagination: does page 2 hold DIFFERENT jobs? ─────────────────────────
# aps-to-d1.py pages by rewriting ?offset= and stops as soon as a page yields no
# NEW jobs. Its nightly log says:
#
#     page 1: 15 rows (15 new) via job-cards
#     page 2: 15 rows (0 new) via job-cards
#     scraped 15 vacancies
#
# Page 2 returned the SAME fifteen. So either the board really does advertise
# fifteen roles across 49 federal agencies, or the offset does nothing and the
# walk has been reading page 1 twice and calling it the whole board. Those two
# possibilities produce identical logs and an identical green tick, which is
# why this has to be measured rather than reasoned about.
#
# COUNTING ROWS CANNOT ANSWER IT. The uniform `next` click in probe() reports
# page-2 ROW COUNT, and the failing case returns 15 there too. This compares
# job IDENTITY — the same (title, id, location) key the scraper dedupes on —
# so "advanced" and "re-rendered page 1" cannot look alike.
#
# It also captures the board's OWN advertised total, which is the thing that
# settles the question in one number, and dumps the pagination controls actually
# present in the DOM so the fix can be written against the real mechanism
# instead of a guessed one.
APS_URL = 'https://www.apsjobs.gov.au/s/job-search'
APS_SETTLE = 12

# "1 - 15 of 1,234", "1,234 jobs", "1,234 results" — whichever the board uses.
APS_TOTAL_PATTERNS = [
    r'of\s+([\d,]+)\s+(?:jobs?|results?|vacanc)',
    r'([\d,]+)\s+(?:jobs?|results?|vacancies)\s+found',
    r'([\d,]+)\s+(?:jobs?|results?|vacancies)\b',
]


def aps_jobs(html: str) -> list:
    """(title, id, location) keys via the scraper's own extractor."""
    import jobs_extract as jx
    rows, _how = jx.extract_jobs(html, r'job-details', 'https://www.apsjobs.gov.au')
    return [(r['t'].strip().lower(), r.get('id') or '', (r.get('loc') or '').strip().lower())
            for r in rows]


def aps_total(text: str):
    for pat in APS_TOTAL_PATTERNS:
        m = re.search(pat, text, re.I)
        if m:
            try:
                return int(m.group(1).replace(',', ''))
            except ValueError:
                pass
    return None


def aps_controls(page) -> list:
    """Every clickable that looks like pagination, so the real mechanism is
    visible rather than guessed at."""
    try:
        return page.evaluate("""() => {
            const out = [];
            for (const el of document.querySelectorAll('a,button,li,span[role=button]')) {
                const t = (el.innerText || '').trim().slice(0, 30);
                const al = el.getAttribute('aria-label') || '';
                const cl = (el.className && el.className.baseVal !== undefined
                            ? el.className.baseVal : el.className) || '';
                const hay = (t + ' ' + al + ' ' + cl).toLowerCase();
                if (/next|paginat|page|more|load/.test(hay)) {
                    out.push({tag: el.tagName.toLowerCase(), text: t, aria: al,
                              cls: String(cl).slice(0, 60),
                              disabled: el.disabled === true ||
                                        el.getAttribute('aria-disabled') === 'true'});
                }
            }
            return out.slice(0, 25);
        }""")
    except Exception as e:  # noqa: BLE001
        return [{'error': str(e)[:120]}]


def aps_open(pw):
    browser = pw.chromium.launch(headless=not HEADFUL,
                                 **({'proxy': PROXY} if PROXY else {}))
    ctx = browser.new_context(
        user_agent=('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'),
        viewport={'width': 1440, 'height': 900}, locale='en-AU')
    return browser, ctx


def aps_paging(pw) -> dict:
    """Which mechanism, if any, actually advances the APS result set."""
    res = {'page1': {}, 'attempts': []}
    browser, ctx = aps_open(pw)
    try:
        page = ctx.new_page()
        page.goto(f'{APS_URL}?offset=0', wait_until='domcontentloaded', timeout=90_000)
        page.wait_for_timeout(APS_SETTLE * 1000)
        html = page.content()
        first = aps_jobs(html)
        body = page.evaluate('document.body.innerText')
        res['page1'] = {
            'rows': len(first),
            'advertised_total': aps_total(body),
            'sample': [t for t, _i, _l in first[:3]],
        }
        res['controls'] = aps_controls(page)

        # THE MECHANISM THE SCRAPER USES, first. PAGE_SIZE is 20 in
        # aps-to-d1.py but the board returns 15 a page, so both steps are tried
        # — if the offset works at all, 20 skips five jobs per page and 15 is
        # the right step.
        for label, url in (('?offset=15', f'{APS_URL}?offset=15'),
                           ('?offset=20', f'{APS_URL}?offset=20'),
                           ('?page=2', f'{APS_URL}?page=2')):
            try:
                page.goto(url, wait_until='domcontentloaded', timeout=90_000)
                page.wait_for_timeout(APS_SETTLE * 1000)
                got = aps_jobs(page.content())
                fresh = [k for k in got if k not in set(first)]
                res['attempts'].append({
                    'how': label, 'rows': len(got), 'new_vs_page1': len(fresh),
                    'sample_new': [t for t, _i, _l in fresh[:3]],
                })
            except Exception as e:  # noqa: BLE001
                res['attempts'].append({'how': label, 'error': str(e)[:140]})

        # And the interaction, which is how every other Aura/SuccessFactors
        # board here pages.
        for sel in ('button[aria-label*="Next" i]', 'a[aria-label*="Next" i]',
                    'button:has-text("Next")', 'lightning-button:has-text("Next")',
                    '.slds-button:has-text("Next")'):
            try:
                page.goto(f'{APS_URL}?offset=0', wait_until='domcontentloaded',
                          timeout=90_000)
                page.wait_for_timeout(APS_SETTLE * 1000)
                el = page.query_selector(sel)
                if not el:
                    continue
                el.click()
                page.wait_for_timeout(APS_SETTLE * 1000)
                got = aps_jobs(page.content())
                fresh = [k for k in got if k not in set(first)]
                res['attempts'].append({
                    'how': f'click {sel}', 'rows': len(got),
                    'new_vs_page1': len(fresh),
                    'sample_new': [t for t, _i, _l in fresh[:3]],
                })
                break
            except Exception as e:  # noqa: BLE001
                res['attempts'].append({'how': f'click {sel}', 'error': str(e)[:140]})
        ctx.close()
    except Exception as e:  # noqa: BLE001
        res['error'] = str(e)[:200]
    finally:
        browser.close()
    return res


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
    elif 'ERR_TUNNEL_CONNECTION_FAILED' in (res.get('error') or '') or \
         'ERR_PROXY_CONNECTION_FAILED' in (res.get('error') or ''):
        # THE PROXY FAILED, NOT THE BOARD. Chromium reports this when it cannot
        # open a CONNECT tunnel to the host — the target never saw a request and
        # has refused nothing. Reporting it as BLOCKED puts a working feed in the
        # "still needs Oxylabs" column and would keep us paying for a board that
        # was never asked. Residential providers commonly refuse certain hosts
        # outright (LinkedIn especially), so this is a routine outcome, not an
        # exotic one.
        res['verdict'] = 'PROXY FAIL'
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

    if TUNNEL_CHECK:
        # No browser at all: this speaks CONNECT to the proxy itself, so
        # launching Chromium would only add a way to fail.
        return tunnel_report()

    if NAB_ROUTE:
        with sync_playwright() as pw:
            return nab_report(pw)

    if APS_PAGING:
        # No egress check: this asks about a board's paginator, not about an
        # exit, and it runs from a plain runner where APS already works.
        print(f'APS pagination probe, {where}.')
        print('Comparing job IDENTITY across pages — a row COUNT cannot tell '
              '"advanced" from "re-rendered page 1".\n')
        with sync_playwright() as pw:
            r = aps_paging(pw)
        p1 = r.get('page1') or {}
        print(f"  page 1: {p1.get('rows')} rows"
              f"{'  ·  board advertises ' + str(p1['advertised_total']) if p1.get('advertised_total') else '  ·  no advertised total found'}")
        for t in p1.get('sample') or []:
            print(f'      e.g. {t[:70]}')
        print()
        for a in r.get('attempts') or []:
            if a.get('error'):
                print(f"  {a['how']:<34} ERROR {a['error']}")
                continue
            verdict = 'ADVANCES' if a['new_vs_page1'] else 'SAME PAGE'
            print(f"  {a['how']:<34} {verdict:<10} {a['rows']} rows, "
                  f"{a['new_vs_page1']} new vs page 1")
            for t in a.get('sample_new') or []:
                print(f'      new: {t[:70]}')
        print('\n  pagination controls in the DOM:')
        for c in (r.get('controls') or [])[:15]:
            print(f'      {c}')
        if r.get('error'):
            print(f"\n  probe error: {r['error']}")
        works = [a for a in (r.get('attempts') or []) if a.get('new_vs_page1')]
        total = p1.get('advertised_total')
        print()
        if works:
            print(f"VERDICT: {works[0]['how']} advances the board. The nightly walk's "
                  f"?offset= is not the mechanism, so it has been archiving page 1 only.")
        elif total and total > (p1.get('rows') or 0):
            print(f"VERDICT: nothing tried advances it, and the board itself advertises "
                  f"{total} against the {p1.get('rows')} we read. Truncated, mechanism "
                  f"still unknown — see the controls above.")
        elif p1.get('rows'):
            print(f"VERDICT: nothing advances it and no larger total is advertised. "
                  f"{p1.get('rows')} may genuinely be the whole board.")
        else:
            print('VERDICT: page 1 itself returned nothing — fix that before paging.')
        if OUT:
            with open(OUT, 'w') as f:
                json.dump({'via_proxy': VIA_PROXY, 'aps_paging': r}, f, indent=2)
            print(f'wrote {OUT}')
        return 0

    print(f'Headless Chromium {where}, against {len(BOARDS)} Oxylabs targets.')
    print("Counting rows the way each scraper does — its own regex, or its own "
          "parser where it uses one.")
    out = []
    with sync_playwright() as pw:
        egress = check_egress(pw)
        ip = egress['egress_ip']
        print()
        if PROXY_CHECK:
            # The point of stopping here is cost. The full run is 20 boards plus
            # an optional volume walk and takes most of an hour; getting the
            # secret's format wrong is the likeliest way for that hour to be
            # wasted, and it is answerable in three requests.
            print('--proxy-check: the proxy answered and is not the runner. '
                  'Re-dispatch without it for the boards.')
            if OUT:
                with open(OUT, 'w') as f:
                    json.dump({'via_proxy': VIA_PROXY, **egress,
                               'proxy_check_only': True}, f, indent=2)
                print(f'wrote {OUT}')
            return 0
        vol = []
        if VOLUME:
            print(f'Volume walk: {VOLUME} different company queries per feed.\n')
            for which in VOLUME_TARGETS:
                r = volume_walk(pw, which, VOLUME)
                vol.append(r)
                print(f"  {which:<15} {r['ok']}/{r['attempted']} returned rows"
                      + (f", {r['not_found']} not-found (not blocks)"
                         if r['not_found'] else '')
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
    tunnel = [r for r in out if r['verdict'] == 'PROXY FAIL']
    # The transport belongs in the headline. This sentence used to say "on a
    # plain CI address" unconditionally, so a run through the residential exit
    # reported the opposite of what it did — and that headline is the line
    # somebody quotes when deciding what to migrate.
    where = 'through SCRAPE_PROXY' if VIA_PROXY else 'on a plain CI address'
    print(f"\n{len(got)} of {len(out)} boards returned rows to a headless browser "
          f"{where}.")
    if tunnel:
        print(f"{len(tunnel)} never reached their target — the proxy could not open a "
              f"tunnel, so these are UNMEASURED rather than blocked: "
              + ', '.join(r['name'] for r in tunnel))
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
            json.dump({'via_proxy': VIA_PROXY, **egress,
                       'volume': vol, 'boards': out}, f, indent=2)
        print(f'wrote {OUT}')
    # Always exit 0: this is a measurement, and "they are blocked" is a real
    # result rather than a failure of the probe.
    return 0


if __name__ == '__main__':
    sys.exit(main())
