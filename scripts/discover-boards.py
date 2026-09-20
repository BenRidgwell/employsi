#!/usr/bin/env python3
"""Which ATS does an employer's careers site run? — REPORT ONLY.

WHY THIS RUNS ON A RUNNER AND NOT IN THE SANDBOX
Two different walls, and telling them apart is most of this file's value.

  403 FROM A DATACENTRE ADDRESS. Corporate sites in front of Akamai, Imperva or
  Cloudflare routinely refuse the address range the dev sandbox sits in while
  serving a GitHub runner normally. Measured 2026-09-19: careers.se.com resolves
  to 23.62.84.220 and answers the sandbox 403; hcf.com.au and minterellison.com
  do the same. A runner is a different address, which is the only thing needed.

  A HOSTNAME THAT DOES NOT EXIST. jobs.griffith.edu.au, careers.hcf.com.au and
  uow.nga.net.au all failed with `Name or service not known` — no DNS record at
  all. That is not a block and no runner fixes it: it means somebody guessed a
  subdomain. Several batches of this project lost time to exactly that mistake,
  so this script reports DNS failure as its own outcome and never lets it read
  as "blocked" or as "no board".

WHAT IT DOES
For each domain given, it tries the conventional careers hostnames and paths,
then reads the employer's own homepage and follows any careers/jobs link it
finds — because the board is often on a host nothing predicts (Team Global
Express's Workday tenant is `agreenspace`, BMD's is careers.bmdgroup.global, the
AFL's is a bare `.afl` TLD). Every page that answers is fingerprinted against
the platforms workers/jobs-cron/careerSites.ts already reads, so a hit names the
`platform:` value to put in a SiteDef rather than something still to interpret.

THE RENDERED FALLBACK (--render)
Two outcomes from the plain sweep are worth a second look with a real browser,
and they are different problems:

  OK BUT NO ATS MARKER. A marketing careers page whose board is a client-rendered
  widget — the University of Wollongong's and Salesforce's both read this way.
  Nothing is wrong with the fetch; the rows simply are not in the served HTML.

  BLOCKED. A 403 can be a check on headers or TLS fingerprint rather than on the
  address, and Playwright passes several that urllib does not. Griffith's
  careers page 403s even a runner, so the address is not the whole story there.

WHERE IT FINDS SOMETHING, THE REPORT SAYS "rendered", because a PAGE that only
carries its marker after hydration cannot be parsed by a careerSites.ts fetcher
— those get served HTML and no browser.

BUT "THE PAGE NEEDS A BROWSER" IS NOT "THE BOARD NEEDS A BROWSER", and reading
it that way costs feeds. The actionable output of a hit is the TENANT, and a
tenant's own API is usually plain JSON that answers anything:

  Griffith's SmartRecruiters marker was visible only in a rendered page — the
  university 403s a datacentre address on every path — and yet
  api.smartrecruiters.com/v1/companies/GriffithUniversity/postings answered the
  dev sandbox on the first call. It is an ordinary in-Worker feed.

  Village Roadshow was reported rendered-only twice. The pages the sweep reached
  were the client-rendered job DETAIL pages; the LISTING at /jobs/search is
  server-rendered and answers a plain GET with all 30 cards. The sweep had
  simply never asked for it.

So a rendered-only hit means: try the platform's API and its listing path before
reaching for browser_fetch. An Action (the way scripts/dayforce-to-d1.py and the
Stockland and Whitehaven feeds work) is the answer only once those have failed.

Off by default. It needs playwright and a Chromium download, and most sites
answer the plain sweep perfectly well.

WHAT IT DELIBERATELY DOES NOT DO
No D1 writes, no repo edits, no guessing. A fingerprint is reported only when the
page actually contains the marker; "reachable, no ATS marker" is a real and
common answer (a marketing careers page with the board behind a JS widget), and
it is reported as that rather than dressed up.

Run: python scripts/discover-boards.py --domains se.com,hcf.com.au [--json out.json]
     python scripts/discover-boards.py --urls https://careers.example.com/ --render
"""
from __future__ import annotations
import html as htmlmod
import json
import os
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')

# Marker -> the `platform` string in careerSites.ts.
#
# EVERY HOST-BEARING PATTERN CAPTURES ITS TENANT, and that is not cosmetic. The
# first sweep reported HCF as `workday [HCF_External_Career_Site]` — the site
# without the hostname — and the tenant turned out to be the half that could not
# be guessed: seven invented slugs all failed against the API while the answer
# was the obvious name on a pod nobody had tried. The second sweep repeated the
# mistake one platform over, reporting People First Bank as a bare `oracle` with
# no pod and no site number. A fingerprint that names a platform but not the
# tenant is half an answer, and the missing half is always the hard one.
#
# Ordered most specific first: a Workday tenant url also contains "myworkdayjobs", and the PageUp
# "Sites" theme is recognised by its own card class rather than by the vendor
# name, because the classic theme shares the vendor and needs a different
# reader.
FINGERPRINTS: list[tuple[str, str]] = [
    (r'job-search-results-card-title', 'pageupsites'),
    (r'<(?:tbody|div) id="search-results-content"', 'pageupclassic'),
    (r'([a-z0-9-]+\.pageuppeople\.com(?:/\d+/[a-z]+)?)', 'pageup (theme unknown — check for the card class)'),
    # TENANT, POD AND SITE, because a Workday url carries the tenant in the
    # HOSTNAME and the site in the path, and the endpoint needs both:
    # https://<tenant>.<pod>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs.
    # An earlier version captured only the path segment, which reported
    # "workday [HCF_External_Career_Site]" and left the tenant — the half that
    # cannot be guessed — out of the answer.
    (r'([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?(?:wday/cxs/[^/]+/)?([A-Za-z0-9_-]+)',
     'workday'),
    (r'smartrecruiters\.com/([A-Za-z0-9_-]+)', 'smartrecruiters'),
    (r'bootstrap/[0-9._]+_NES', 'successfactors (NES theme — check it renders rows)'),
    (r'successfactors', 'successfactors'),
    (r'([a-z0-9-]+\.fa\.[a-z0-9]+\.oraclecloud\.com)(?:/hcmUI/CandidateExperience/[a-z-]+/sites/([A-Za-z0-9_]+))?', 'oracle'),
    (r'dayforcehcm\.com/(?:CandidatePortal/)?(?:[a-z]{2}-[A-Z]{2}/)?([A-Za-z0-9_-]+)', 'dayforce (expect a 403 on the search API)'),
    (r'([a-z0-9-]+)\.csod\.com', 'cornerstone'),
    (r'services\.employmenthero\.com|employmenthero\.com/jobs', 'employmenthero'),
    (r'sjobs\.brassring\.com|brassring', 'brassring'),
    (r'phenom|widgets/jobs', 'phenom'),
    (r'livehire\.com/careers/([a-z0-9-]+)', 'livehire'),
    (r'boards(?:-api)?\.greenhouse\.io/[a-z]+/([a-z0-9-]+)', 'greenhouse'),
    (r'jobs\.lever\.co/([a-z0-9-]+)', 'lever'),
    (r'icims\.com|iCIMS', 'icims (NO READER IN careerSites.ts — would need one)'),
    (r'([a-z0-9-]+)\.taleo\.net', 'taleo'),
    (r'([a-z0-9-]+)\.avature\.net', 'avature'),
    (r'eightfold\.ai|api/apply/v2/jobs', 'eightfold'),
    (r'expr3ss', 'expr3ss'),
    (r'jobadder', 'jobadder'),
    (r'workable\.com', 'workable'),
    (r'elmotalent', 'elmo'),
    (r'\.nga\.net\.au', 'nga (NO READER — common on Australian universities)'),
    (r'cloud\.coveo\.com', 'coveo index (client-rendered; needs an org id + key)'),
]

# Set from --render in main(); read by the report so "no marker" can say whether
# a rendered attempt was even made.
render_on = False

# How far the corridor goes. QUEUE_CAP bounds how many candidate links may be
# waiting at once, LINK_BUDGET how many the sweep actually follows for one
# employer, and the two render budgets how
# many pages may be rendered — a render is seconds where a fetch is
# milliseconds, so it is the one worth rationing. They are SEPARATE on purpose:
# an employer whose every page 403s (Griffith) would otherwise spend the whole
# allowance on its seeds and reach the corridor with nothing left, which is the
# half of the sweep that actually finds boards.
# QUEUE_CAP replaced a `[:8]` slice over each page's links. That slice was the
# bug: it kept the first eight IN DOCUMENT ORDER, which on a university careers
# page is the student-services nav. The queue is ranked now, so it has to be
# allowed to hold the whole page's links for the ranking to have anything to
# choose between.
QUEUE_CAP = 32
LINK_BUDGET = 14
SEED_RENDER_BUDGET = 4
RENDER_BUDGET = 6

CAREERS_LINK = re.compile(
    r'href=["\']([^"\']*(?:career|job|vacanc|work-with-us|work-for-us|join-us'
    r'|employment|opportunit|positions)[^"\']*)["\']',
    re.I)

# LINKS WORTH FOLLOWING, BEST FIRST — and the ones never worth following.
#
# MEASURED 2026-09-19, and the reason this ranking exists. On griffith.edu.au
# and uow.edu.au the first eight "careers" links in document order were all the
# STUDENT careers service — career planning, career readiness, applying for
# jobs, find-a-job, CareerHub — and the staff vacancy board was never reached
# on either. At a university "careers" overwhelmingly means the service FOR
# students, not the employer's own vacancies, which live at /jobs, /employment
# or /about/jobs. UOW additionally spent three of its eight slots on a favicon
# and two stylesheets, because their paths contained "career".
#
# So the corridor no longer follows links in the order a page happens to list
# them. It follows the best first, and skips what cannot be a board at all.
LINK_SKIP = re.compile(r"""
      \.(?:css|js|mjs|ico|png|jpe?g|gif|svg|webp|woff2?|ttf|eot|pdf|zip|xml)(?:[?#]|$)
    # /student matches "students-graduates" too, which a `students?(?:[/?#]|$)`
    # anchor did not — that is the exact path Griffith's whole corridor went
    # down. "graduate" alone stays out of this list and is merely demoted: on a
    # corporate site /careers/graduate-program is a real recruitment page.
    | /students?[-_/]? | /alumni | /undergraduate | /postgraduate
    | /(?:study|news|events?)(?:[/?#]|$)
    # The separator is [-+_ ]* because UOW writes it "careers+expos" in a path.
    | careers?[-+_ ]*(?:planning|readiness|development|advice|guide|universe|fair|expo|hub)
    | careerhub
    | /(?:login|signin|register|apply-now)(?:[/?#]|$)
""", re.I | re.X)

# Lower rank is followed first. The bands: an actual list of vacancies; a page
# whose path is the employer's own jobs section; a graduate or early-careers
# page, which is a real recruitment page but rarely the main board; anything
# else that merely contains "career".
LINK_PRIORITY = [
    (re.compile(r'vacanc|current-opportunit|job-search|search-jobs|job-openings'
                r'|all-jobs|job-listings|opportunities', re.I), 0),
    (re.compile(r'/jobs?(?:[/?#]|$)|/employment|/work-with-us|/work-for-us'
                r'|/join-us|/positions|/about/jobs|careers/jobs', re.I), 1),
    (re.compile(r'graduate|early-career|intern|apprentice|trainee', re.I), 3),
]


# How far a rank is pushed back for being on somebody else's domain. Enough to
# put every off-site link behind every on-site one, without flattening the
# ranking within each group.
OFF_SITE_PENALTY = 4


def same_site(url: str, home: str) -> bool:
    """Is this url on the employer's own registered domain?"""
    host = (urllib.parse.urlparse(url).hostname or '').lower()
    home = home.lower()
    return host == home or host.endswith('.' + home)


def link_rank(url: str, home: str | None = None) -> int | None:
    """How promising a link is, or None for one that cannot be a vacancy board.

    OFF-DOMAIN LINKS ARE FOLLOWED BUT DEMOTED, never dropped: the board is
    routinely on a host nothing predicts — BMD's is careers.bmdgroup.global,
    the AFL's is a bare `.afl` TLD — so a same-domain-only corridor would miss
    exactly the cases the corridor exists for. Demoting them spends the budget
    on the employer's own site first, which is where the board usually is.

    Measured 2026-09-19: sweeping flinders.edu.au followed links to kpmg.com and
    reported KPMG's SmartRecruiters tenant under Flinders, because a university
    careers page lists its graduate-employer partners. See the report, which
    marks a hit found on somebody else's page rather than letting it read as
    this employer's board.
    """
    if LINK_SKIP.search(url):
        return None
    rank = 2
    for pat, r in LINK_PRIORITY:
        if pat.search(url):
            rank = r
            break
    if home and not same_site(url, home):
        rank += OFF_SITE_PENALTY
    return rank


def fetch(url: str, timeout: int = 20) -> dict:
    """One GET, with the outcome CLASSIFIED rather than collapsed to a failure.

    The four outcomes are deliberately distinct: `dns` means the hostname does
    not exist and no address will ever reach it; `blocked` means a live host
    refused this address and another one may not be; `error` is everything else;
    `ok` carries the body. Collapsing the first two is the mistake this file
    exists to stop.
    """
    host = urllib.parse.urlparse(url).hostname or ''
    try:
        socket.getaddrinfo(host, 443)
    except socket.gaierror as e:
        return {'url': url, 'outcome': 'dns', 'detail': f'{host}: {e.strerror or e}'}
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-AU,en;q=0.9',
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(1_500_000).decode('utf-8', 'replace')
            return {'url': url, 'outcome': 'ok', 'status': r.status,
                    'final': r.geturl(), 'body': body}
    except urllib.error.HTTPError as e:
        kind = 'blocked' if e.code in (401, 403, 405, 406, 429) else 'error'
        return {'url': url, 'outcome': kind, 'status': e.code}
    except Exception as e:  # noqa: BLE001 - a probe never aborts the sweep
        return {'url': url, 'outcome': 'error', 'detail': f'{type(e).__name__}: {e}'[:120]}



# Set once a render fails in a way that looks like the environment rather than
# the page. A sweep may render up to RENDER_BUDGET + one per candidate, and a
# broken browser fails every one of them: measured locally, the first failure was
# "Executable doesn't exist" and the SECOND became "Playwright Sync API inside
# the asyncio loop" — the first failure had left the driver unusable. Fourteen
# cascading errors bury the real one and make the report unreadable, so the first
# is reported and the rest are skipped.
_render_broken = ''


def rendered_html(url: str, settle_s: int = 8) -> tuple[str | None, str]:
    """Render one page with the local headless Chromium.

    Returns (html, error). THE ERROR IS RETURNED RATHER THAN LOGGED because a
    render that could not run and a render that found nothing are different
    answers, and the report has to be able to tell them apart. Collapsing them
    would let "Chromium is not installed" read as "this employer has no board" —
    the same conflation between an environment limit and a finding that the
    dns/blocked split exists to prevent.

    IMPORTED LAZILY. browser_fetch pulls in playwright, which the plain sweep
    does not need and which is absent unless the caller asked for --render.

    It cannot be exercised from the dev sandbox at all: Chromium does not trust
    the agent proxy's CA, so every navigation fails ERR_CERT_AUTHORITY_INVALID
    (CLAUDE.md records the same limit for visual checks). A runner has no proxy.
    That is why the error text is surfaced verbatim instead of being summarised.
    """
    global _render_broken
    if _render_broken:
        return None, f'skipped, the browser is not usable here ({_render_broken})'
    try:
        import browser_fetch  # noqa: PLC0415 - optional, see above
    except ImportError as e:
        _render_broken = 'playwright not installed'
        return None, f'playwright not installed ({e})'
    try:
        html = browser_fetch.render(url, [{'type': 'wait', 'wait_time_s': settle_s}])
    except Exception as e:  # noqa: BLE001 - a render failure never aborts the sweep
        msg = f'{type(e).__name__}: {str(e)[:110]}'
        # A launch or driver failure is about this machine, not this page, and
        # every later render will hit it too. A timeout or navigation error is
        # about the page, so it does NOT disable the rest.
        if any(k in str(e) for k in ("BrowserType.launch", "Executable doesn't exist",
                                     'asyncio loop', 'playwright install')):
            _render_broken = msg
        return None, msg
    if not html:
        # browser_fetch prints its own diagnosis and returns None.
        return None, 'render returned nothing (see the message above)'
    return html, ''

# WHERE A FINGERPRINT NAMES A PLATFORM BUT NO HOST, the sweep has proved what the
# board runs on and not where it is — which is not enough to write a SiteDef.
#
# Measured 2026-09-20: Charles Sturt reported `pageupclassic` off a RENDERED
# www.csu.edu.au/jobs/our-vacancies and had to be left out of that batch, because
# the PageUp fingerprints match a CSS id and a card class and neither carries a
# hostname. careers.csu.edu.au does not resolve and the endpoint could not be
# guessed, so 187 archived ads stayed uncovered over a missing string that was
# sitting in the page all along.
#
# So a hostless hit now goes looking. These are the listing paths the readers in
# careerSites.ts actually take — /en/listing/ for PageUp classic, /jobs/search
# for the Sites theme — plus the hosted careers.pageuppeople.com form.
BOARD_URL = re.compile(
    r"""https?://[A-Za-z0-9.-]+(?:/[A-Za-z0-9._~%+-]+)*?
        /(?:en/listing|listing|jobs/search|jobs/searchresults|job-search|search-results)
        /?(?:\?[^"'\s<>]*)?""",
    re.I | re.X)

# Any host that IS the ATS, whatever path it was linked with. Kept separate
# because a bare tenant root carries no board path to match on.
BOARD_HOST = re.compile(
    r"""https?://[A-Za-z0-9.-]*
        (?:pageuppeople\.com|myworkdayjobs\.com|smartrecruiters\.com|csod\.com
          |dayforcehcm\.com|oraclecloud\.com|icims\.com|taleo\.net|avature\.net
          |livehire\.com|expr3ss\.com|nga\.net\.au)
        (?:/[^"'\s<>]*)?""",
    re.I | re.X)


# Hosts that serve a site's assets, not its board. A listing PATH on one of these
# is a stylesheet: measured on a CSU-shaped page, static.csu.edu.au/assets/en/
# listing/main.css matched BOARD_URL, and truncating it at the path meant the
# `.css` LINK_SKIP would have caught was no longer on the end of the string.
# The label can be anywhere in the leading name, not only at the start:
# careers-static.pageuppeople.com is Deakin's, and an anchored pattern read it as
# a tenant called "careers".
ASSET_HOST = re.compile(r'(?:^|[.-])(?:static|assets?|cdn|img|images|media|fonts)[.-]', re.I)

# Paths on an ATS host that are not the list of jobs — an application form, a job
# alert subscription, the vendor's own marketing. Still reported, just last,
# because a PageUp instance id ("949/cw") is often only visible in one of them
# and that id is the part nobody can guess.
NOT_A_LISTING = re.compile(r'/apply/|applicationform|/subscribe|powered-by|/login', re.I)


def board_urls(html: str, base: str, limit: int = 6) -> list[str]:
    """Candidate board urls on a page, for a hit that named no host.

    RANKED, because the first match in a page is routinely the wrong one: on a
    CSU-shaped page an unrelated employer's Workday link appeared above the
    university's own /en/listing/. A url whose path IS a listing path comes
    first, then any ATS host, then the rest.

    Reported rather than acted on: this says "the board is probably one of
    these", and the endpoint still gets measured against the live board before it
    becomes a SiteDef, as every other value in careerSites.ts was.
    """
    LISTING_END = re.compile(
        r'/(?:en/listing|listing|jobs/search|jobs/searchresults|job-search|search-results)/?$',
        re.I)
    seen: set[str] = set()
    ranked: list[tuple[int, int, str]] = []
    order = 0
    for pat in (BOARD_URL, BOARD_HOST):
        for m in pat.findall(html):
            raw = m if isinstance(m, str) else m[0]
            u = urllib.parse.urljoin(base, htmlmod.unescape(raw))
            if u in seen:
                continue
            host = (urllib.parse.urlparse(u).hostname or '')
            # The skip is tested on the RAW match, before the path truncation
            # that hid the asset extension.
            if ASSET_HOST.match(host) or LINK_SKIP.search(raw):
                continue
            seen.add(u)
            order += 1
            rank = 0 if LISTING_END.search(urllib.parse.urlparse(u).path) else 1
            if NOT_A_LISTING.search(u):
                rank = 2
            ranked.append((rank, order, u))
    ranked.sort()
    return [u for _, _, u in ranked[:limit]]


def fingerprint(body: str) -> list[str]:
    hits: list[str] = []
    for pat, platform in FINGERPRINTS:
        m = re.search(pat, body, re.I)
        if not m:
            continue
        # ALL the non-empty groups, joined — not just the first. A Workday match
        # is (tenant, pod, site) and any one of the three on its own is not
        # enough to build an endpoint from.
        parts = [g for g in (m.groups() or ()) if g]
        label = f'{platform} [{"/".join(parts)}]' if parts else platform
        if label not in hits:
            hits.append(label)
    return hits


def candidates(domain: str) -> list[str]:
    """The paths to try before reading the site's own links.

    /careers ALONE IS NOT ENOUGH, and on a university it is actively the wrong
    place: griffith.edu.au and uow.edu.au both put the student careers service
    at /careers and their staff vacancies somewhere else entirely. UOW's is
    /about/jobs. Seeding the jobs-side paths costs a DNS lookup each when they
    do not exist and finds the board directly when they do.
    """
    d = domain.strip().lstrip('.')
    if d.startswith('http'):
        return [d]
    bare = d[4:] if d.startswith('www.') else d
    return [
        f'https://careers.{bare}/',
        f'https://jobs.{bare}/',
        f'https://www.{bare}/careers',
        f'https://www.{bare}/careers/',
        f'https://www.{bare}/jobs',
        f'https://www.{bare}/employment',
        f'https://www.{bare}/about/jobs',
        f'https://www.{bare}/work-with-us',
        f'https://www.{bare}/',
    ]


def sweep(domain: str, render: bool = False) -> dict:
    """Probe one employer's conventional careers urls, then its own links.

    THE LINK-FOLLOWING USED TO BE SKIPPED WHENEVER --render WAS ON. It sat in an
    `elif` chained after the render branch, so the two were mutually exclusive
    and switching on the browser silently switched off the step most likely to
    find the board. Measured on the same target: the plain sweep of
    salesforce.com followed 8 careers links, the rendered sweep followed none.
    That is why the rendered runs kept coming back "reachable, no marker" —
    they were reaching the front door and never trying the corridor.

    The two are now independent, and the render is a FALLBACK on each page
    rather than an alternative to exploring: every page that answers gets its
    links harvested, and a page that yields nothing gets one render.
    """
    tried: list[dict] = []
    found: dict[str, list[str]] = {}
    # Kept apart from `found` all the way to the report: a board that is only
    # there after hydration cannot be an in-Worker feed, so merging the two would
    # send the next reader to write a fetcher that always returns zero.
    found_rendered: dict[str, list[str]] = {}
    followed: list[str] = []
    seen: set[str] = set()
    # The employer's own REGISTERED domain — not the first candidate's hostname,
    # which is `careers.<domain>` and made a Flinders sweep label flinders.edu.au
    # itself as somebody else's site.
    if domain.strip().startswith('http'):
        home = (urllib.parse.urlparse(domain.strip()).hostname or '').lower()
        home = home[4:] if home.startswith('www.') else home
    else:
        home = bare_root(domain).lower()
    queue: list[tuple[int, int, str]] = []
    order = 0

    def harvest(html: str, base: str) -> None:
        """Queue the careers/jobs links on one page, however it was obtained.

        Also called on RENDERED html, which is the point of the rewrite before
        this one: a careers page a browser can reach but urllib cannot —
        Griffith, Tesla and Village Roadshow — has its links visible only after
        the render, and before that they were never read.

        Links are RANKED rather than taken in document order; see LINK_PRIORITY
        for the measurement that forced it.
        """
        nonlocal order
        for href in dict.fromkeys(CAREERS_LINK.findall(html)):
            # Unescaped because hrefs carry entities: salesforce.com's careers
            # link was followed as `...?cid=X&amp;utm_source=...`, with the
            # `&amp;` intact, which is a different URL from the one on the page.
            nxt = urllib.parse.urljoin(base, htmlmod.unescape(href)).split('#')[0]
            if not nxt.startswith('http') or nxt in seen:
                continue
            rank = link_rank(nxt, home)
            if rank is None:
                continue
            seen.add(nxt)
            order += 1
            queue.append((rank, order, nxt))
            if len(queue) >= QUEUE_CAP:
                break

    # A hostless hit is recorded WITH the board candidates from the same page.
    # Done here rather than at each of the five places a hit can be found, so one
    # of them cannot quietly skip it.
    boards: dict[str, list[str]] = {}

    def note(where: dict, page: str, hits: list[str], html: str) -> None:
        hits = [h for h in hits if h]
        if not hits:
            return
        where[page] = hits
        # A CAPTURED ASSET HOST IS NOT A TENANT. Deakin's board matches the
        # pageuppeople pattern on careers-static.pageuppeople.com, which looks
        # like a host in the label and cannot be fetched as a board — so it
        # counts as hostless here. Without this, a page whose ONLY hit was that
        # pattern would suppress the candidate search that exists for it.
        def hostless(h: str) -> bool:
            inner = h[h.index('[') + 1:].strip('[] ') if '[' in h else ''
            return not inner or bool(ASSET_HOST.search(inner))

        if any(hostless(h) for h in hits):
            cands = board_urls(html, page)
            if cands:
                boards[page] = cands

    seed_renders = SEED_RENDER_BUDGET
    for url in candidates(domain):
        seen.add(url)
        res = fetch(url)
        row = {k: v for k, v in res.items() if k != 'body'}
        if res['outcome'] == 'ok':
            hits = fingerprint(res['body'])
            row['platforms'] = hits
            if hits:
                note(found, res.get('final', url), hits, res['body'])
            else:
                harvest(res['body'], res.get('final', url))
                if render and seed_renders > 0:
                    # Served HTML carried no marker. The board may be a widget
                    # that only exists after hydration — the common shape on a
                    # marketing careers page.
                    seed_renders -= 1
                    html, err = rendered_html(res.get('final', url))
                    if err:
                        row['rendered'] = f'could not render — {err}'
                    else:
                        rhits = fingerprint(html or '')
                        row['rendered'] = 'rendered' if rhits else 'rendered, no marker'
                        if rhits:
                            row['rendered_platforms'] = rhits
                            note(found_rendered, res.get('final', url), rhits, html or '')
                        else:
                            harvest(html or '', res.get('final', url))
        # A 403 can be a header or TLS-fingerprint check rather than an address
        # one, and a real browser passes several that urllib does not — measured
        # on Griffith, Tesla and Village Roadshow, all three reachable rendered.
        elif render and res['outcome'] == 'blocked' and seed_renders > 0:
            seed_renders -= 1
            html, err = rendered_html(url)
            if err:
                row['rendered'] = f'could not render — {err}'
            else:
                hits = fingerprint(html or '')
                row['rendered'] = 'reachable with a browser'
                row['rendered_platforms'] = hits
                if hits:
                    note(found_rendered, url, hits, html or '')
                else:
                    harvest(html or '', url)
        tried.append(row)

    # THE CORRIDOR. Bounded, because a careers page links to a dozen others and
    # an unbounded walk of a large corporate site is not a discovery sweep.
    #
    # BEST-FIRST, not first-come: the queue is re-sorted each time round because
    # a page followed at rank 2 can surface a rank-0 vacancy list that then has
    # to jump ahead of everything already waiting. Sorting on (rank, order)
    # keeps it stable, so equal-ranked links still go in the order they appeared.
    renders_left = RENDER_BUDGET
    while queue and len(followed) < LINK_BUDGET:
        queue.sort()
        _, _, nxt = queue.pop(0)
        followed.append(nxt)
        sub = fetch(nxt)
        if sub['outcome'] == 'ok':
            h = fingerprint(sub['body'])
            if h:
                note(found, sub.get('final', nxt), h, sub['body'])
                continue
            harvest(sub['body'], sub.get('final', nxt))
        # Plain fetch found nothing here. One render, while the budget lasts —
        # this is the path that was missing entirely, and the one Griffith needs.
        if render and renders_left > 0 and sub['outcome'] in ('ok', 'blocked'):
            renders_left -= 1
            html, err = rendered_html(nxt)
            if not err:
                rh = fingerprint(html or '')
                if rh:
                    note(found_rendered, nxt, rh, html or '')
                else:
                    harvest(html or '', nxt)

    return {'domain': domain, 'home': home, 'tried': tried, 'found': found,
            'boards': boards,
            'found_rendered': found_rendered, 'followed': followed}


def bare_root(domain: str) -> str:
    d = domain.strip().lstrip('.')
    return d[4:] if d.startswith('www.') else d


def main() -> int:
    args = sys.argv[1:]

    def opt(flag: str, default: str = '') -> str:
        return args[args.index(flag) + 1] if flag in args and args.index(flag) + 1 < len(args) else default

    global render_on
    render_on = '--render' in args
    domains = [d for d in opt('--domains').split(',') if d.strip()]
    urls = [u for u in opt('--urls').split(',') if u.strip()]
    targets = domains + urls
    if not targets:
        return print(__doc__.strip().splitlines()[-2].strip()) or 2

    out = []
    for t in targets:
        r = sweep(t, render=render_on)
        out.append(r)
        print(f'\n=== {t}')
        for row in r['tried']:
            bits = [row['outcome'], str(row.get('status', '')), row.get('detail', '')]
            plats = ', '.join(row.get('platforms') or [])
            rplats = ', '.join(row.get('rendered_platforms') or [])
            print(f'  {row["url"]}\n      {" ".join(b for b in bits if b)}'
                  + (f'\n      platforms: {plats}' if plats else '')
                  + (f'\n      {row["rendered"]}' if row.get('rendered') else '')
                  + (f'\n      rendered platforms: {rplats}' if rplats else ''))
        # A MARKER IS ONLY THIS EMPLOYER'S IF IT WAS ON THIS EMPLOYER'S PAGE.
        # The url here is the page the marker was read from, not the ATS host
        # named inside it, so the test is exact: flinders.edu.au/jobs carrying a
        # Workday tenant is Flinders', and kpmg.com/au/en/careers carrying a
        # SmartRecruiters tenant is KPMG's however it was reached. Measured
        # 2026-09-19 — a Flinders sweep reported KPMG, because the university
        # lists its graduate-employer partners. Unlabelled, that is a SiteDef
        # filing one employer's vacancies under another.
        def mark(u: str) -> str:
            if same_site(u, r['home']):
                return u
            host = urllib.parse.urlparse(u).hostname or '?'
            return f'{u}\n      [OFF-SITE — read from {host}, not {r["home"]}; confirm whose board it is]'

        if r['found']:
            print('  FOUND in served HTML — can be an in-Worker feed:')
            for u, h in r['found'].items():
                print(f'    {mark(u)}\n      -> {", ".join(h)}')
        if r.get('boards'):
            # THE MISSING HALF OF A HOSTLESS HIT. A platform name without an
            # endpoint cannot become a SiteDef; these are the board urls found on
            # the same page. Candidates, not answers — measure one against the
            # live board before writing it down, as every other value in
            # careerSites.ts was.
            print('  BOARD URL CANDIDATES (a hit above named a platform but no host):')
            for page, cands in r['boards'].items():
                print(f'    on {page}')
                for c in cands:
                    print(f'      -> {c}')
        if r.get('found_rendered'):
            print('  FOUND ONLY AFTER RENDERING — this PAGE needs a browser, which does')
            print('  not mean the BOARD does. Try the platform API for the tenant below,')
            print('  and the listing path (/jobs/search, /en/listing/), before reaching')
            print('  for a browser_fetch Action: both Griffith and Village Roadshow read')
            print('  this way here and are in-Worker feeds in careerSites.ts.')
            for u, h in r['found_rendered'].items():
                print(f'    {mark(u)}\n      -> {", ".join(h)}')
        if not r['found'] and not r.get('found_rendered'):
            # A render that COULD NOT RUN is not a finding about the employer, and
            # saying so is the point: otherwise a missing Chromium reads as an
            # employer with no board, which is the conflation this whole file is
            # built to avoid.
            broke = [row for row in r['tried'] if str(row.get('rendered', '')).startswith('could not')]
            if broke:
                print(f'  INCONCLUSIVE — {len(broke)} page(s) could not be rendered; '
                      'this says nothing about whether a board exists')
            else:
                print('  no ATS marker on any page reached'
                      + (f' ({len(r["followed"])} careers links followed)' if r['followed'] else '')
                      + (' (rendered too)' if render_on else ' — try --render'))
                # WHERE THE CORRIDOR WENT, not just how far. A bare count made
                # the 2026-09-19 sweep unreadable: Griffith and UOW both said
                # "no marker, 10 links followed" and only the JSON artifact
                # showed that every one of those links was the student careers
                # service. A negative result has to carry the evidence for
                # whether it looked in the right place.
                for u in r['followed'][:LINK_BUDGET]:
                    print(f'      followed {u}')

    dest = opt('--json')
    if dest:
        open(dest, 'w').write(json.dumps(out, indent=1))
        print(f'\nwrote {dest}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
