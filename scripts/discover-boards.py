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

WHERE IT FINDS SOMETHING, THE REPORT SAYS "rendered" — and that is the
actionable half. A board only present after hydration CANNOT be an in-Worker
feed however tidy its markup: careerSites.ts fetchers get served HTML and no
browser, so a rendered-only hit means a GitHub Action using browser_fetch, the
way scripts/dayforce-to-d1.py and the Stockland and Whitehaven feeds already do.
Reporting the two as one thing would send the next reader to write a fetcher
that always returns zero.

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
    (r'[a-z0-9-]+\.pageuppeople\.com', 'pageup (theme unknown — check for the card class)'),
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

CAREERS_LINK = re.compile(
    r'href=["\']([^"\']*(?:career|job|vacanc|work-with-us|join-us|employment)[^"\']*)["\']',
    re.I)


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
    try:
        import browser_fetch  # noqa: PLC0415 - optional, see above
    except ImportError as e:
        return None, f'playwright not installed ({e})'
    try:
        html = browser_fetch.render(url, [{'type': 'wait', 'wait_time_s': settle_s}])
    except Exception as e:  # noqa: BLE001 - a render failure never aborts the sweep
        return None, f'{type(e).__name__}: {str(e)[:110]}'
    if not html:
        # browser_fetch prints its own diagnosis and returns None.
        return None, 'render returned nothing (see the message above)'
    return html, ''

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
    d = domain.strip().lstrip('.')
    if d.startswith('http'):
        return [d]
    bare = d[4:] if d.startswith('www.') else d
    return [
        f'https://careers.{bare}/',
        f'https://jobs.{bare}/',
        f'https://www.{bare}/careers',
        f'https://www.{bare}/careers/',
        f'https://www.{bare}/',
    ]


def sweep(domain: str, render: bool = False) -> dict:
    tried: list[dict] = []
    found: dict[str, list[str]] = {}
    # Kept apart from `found` all the way to the report: a board that is only
    # there after hydration cannot be an in-Worker feed, so merging the two would
    # send the next reader to write a fetcher that always returns zero.
    found_rendered: dict[str, list[str]] = {}
    followed: list[str] = []
    for url in candidates(domain):
        res = fetch(url)
        row = {k: v for k, v in res.items() if k != 'body'}
        # A 403 can be a header or TLS-fingerprint check rather than an address
        # one, and a real browser passes several that urllib does not. Worth one
        # render before calling a host unreachable.
        if render and res['outcome'] == 'blocked':
            html, err = rendered_html(url)
            if err:
                row['rendered'] = f'could not render — {err}'
            else:
                hits = fingerprint(html or '')
                row['rendered'] = 'reachable with a browser'
                row['rendered_platforms'] = hits
                if hits:
                    found_rendered[url] = hits
        if res['outcome'] == 'ok':
            hits = fingerprint(res['body'])
            row['platforms'] = hits
            if hits:
                found[res.get('final', url)] = hits
            elif render:
                # Served HTML carried no marker. The board may be a widget that
                # only exists after hydration — the common shape on a marketing
                # careers page.
                html, err = rendered_html(res.get('final', url))
                if err:
                    row['rendered'] = f'could not render — {err}'
                else:
                    rhits = fingerprint(html or '')
                    row['rendered'] = 'rendered, no marker' if not rhits else 'rendered'
                    if rhits:
                        row['rendered_platforms'] = rhits
                        found_rendered[res.get('final', url)] = rhits
            # Follow the employer's own careers links — the board is often on a
            # host nothing predicts, and this is the step that finds it.
            elif url.rstrip('/').endswith(bare_root(domain)) or '/careers' in url:
                for href in list(dict.fromkeys(CAREERS_LINK.findall(res['body'])))[:8]:
                    nxt = urllib.parse.urljoin(res.get('final', url), href)
                    if nxt in followed or not nxt.startswith('http'):
                        continue
                    followed.append(nxt)
                    sub = fetch(nxt)
                    if sub['outcome'] == 'ok':
                        h = fingerprint(sub['body'])
                        if h:
                            found[sub.get('final', nxt)] = h
        tried.append(row)
    return {'domain': domain, 'tried': tried, 'found': found,
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
        if r['found']:
            print('  FOUND in served HTML — can be an in-Worker feed:')
            for u, h in r['found'].items():
                print(f'    {u}\n      -> {", ".join(h)}')
        if r.get('found_rendered'):
            print('  FOUND ONLY AFTER RENDERING — needs a GitHub Action using')
            print('  browser_fetch, NOT a careerSites.ts fetcher (those get served HTML):')
            for u, h in r['found_rendered'].items():
                print(f'    {u}\n      -> {", ".join(h)}')
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

    dest = opt('--json')
    if dest:
        open(dest, 'w').write(json.dumps(out, indent=1))
        print(f'\nwrote {dest}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
