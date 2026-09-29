#!/usr/bin/env python3
"""Where is each Queensland statutory body's annual report? Run this on a runner.

    python3 scripts/qld-agency-probe.py            # all of them
    python3 scripts/qld-agency-probe.py qcaa       # one, by key

WHY THIS EXISTS. Nineteen Queensland cards carried some version of "no row names
it; statutory authority, outside the collection". That is a true statement about
the State of the Sector workbooks, which cover DEPARTMENTS, and it was never a
statement about the bodies: each publishes an annual report under Queensland's
annual-report requirements, which mandate a workforce section. Four of them have
since been read and three are filed (see AGENCY_REPORTS in gen-gov-workforce.py).

THE REST NEED A BROWSER, NOT JUST A RUNNER, AND ROUND ONE OF THIS PROBE PROVED
IT THE HARD WAY. It fetched with urllib only, and every host that answers 403
here answered 403 on the RUNNER too, with publications.qld.gov.au returning its
`202 and zero bytes` there as well. For about a minute that read as "the runner
is blocked, so the route out of South Australia does not work for Queensland".
It is nothing of the kind: the Queensland doorman is an AWS WAF JAVASCRIPT
challenge — the one this whole workflow drives a browser for — and a plain
urllib fetch from a runner can execute JavaScript exactly as well as one from
here, which is to say not at all. get() now falls back to gen-gov-workforce.py's
own fetch(), browser and all.

Measured 2026-09-29 from the authoring sandbox, plain:

    www.qcaa.qld.edu.au        403      5,644 bytes
    www.qleave.qld.gov.au      403      5,646
    www.qric.qld.gov.au        403      5,644
    www.ombudsman.qld.gov.au   403      1,139
    www.ewoq.com.au            403        371
    documents.parliament.qld.gov.au   403   1,233

and publications.qld.gov.au — the central portal that would list every one of
these documents at once — answers its HOMEPAGE with 200 and its /dataset SEARCH
with `202 and zero bytes`, which is the AWS WAF challenge shape this repo
already records for data.qld.gov.au. That challenge is the whole reason
gov-workforce.yml drives a browser, so the search belongs there rather than here.

WHAT IS BEING ASKED IS "WHERE IS THE DOCUMENT", NOT "HOW MANY PEOPLE". Every one
of these reports has a workforce section; what is missing is its URL, and four
rounds of the South Australian probe established that guessing a path measures
the guess. So this prints the links each site actually publishes, and the specs
get written against documents rather than against hope.

THREE OF THESE SITES ARE REACHABLE AND STILL DON'T LINK A REPORT FROM THEIR
ROOT — the Public Guardian, the Queensland Audit Office and Stadiums Queensland
— so they are here for their own reason: not a blocked host, a report filed
somewhere the root does not point at.
"""
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')

# A challenge answered with a 2xx is the failure this file exists for, so it is
# named rather than left to look like a page with no links on it. The Queensland
# one is an AWS WAF action and arrives as `202 with an empty body`, which no
# pattern can match — probe() checks the length instead.
CHALLENGE = ('Just a moment', 'Security Checkpoint', 'Checking your browser',
             'Attention Required!', 'challenge-platform', 'Client Challenge',
             'awsWafCoo', '/.safeline/', 'slg-title')

# live ads at 2026-09-29, for whoever picks this up next
SITES = {
    'qcaa':       ('https://www.qcaa.qld.edu.au/', 8),
    # TWO HOSTS FOR ONE BODY, and both refuse this sandbox: oir.qld.gov.au
    # answers 403 (2,789 bytes) and worksafe.qld.gov.au — where its
    # operational content lives — answers 403 as well. The question for OIR
    # is not a head count but WHICH DEPARTMENT it sits in: its reason records
    # that it is an office inside one and that which one is not established.
    'oir':        ('https://www.oir.qld.gov.au/our-role', 6),
    'oir-worksafe':('https://www.worksafe.qld.gov.au/about/careers/'
                   'people-and-careers', 0),
    'pubguardian':('https://www.publicguardian.qld.gov.au/', 2),
    'parlserv':   ('https://www.parliament.qld.gov.au/', 2),
    'qleave':     ('https://www.qleave.qld.gov.au/', 1),
    'qric':       ('https://www.qric.qld.gov.au/', 1),
    'oic':        ('https://www.oic.qld.gov.au/', 1),
    'niisq':      ('https://niis.qld.gov.au/news-and-research/annual-reports/', 1),
    'qmhc':       ('https://www.qmhc.qld.gov.au/about/publications/browse/annual-reports', 1),
    'ombudsman':  ('https://www.ombudsman.qld.gov.au/', 0),
    'stadiums':   ('https://stadiums.qld.gov.au/', 0),
    'ewoq':       ('https://www.ewoq.com.au/', 0),
    'qao':        ('https://www.qao.qld.gov.au/', 0),
    'pharmcouncil':('https://www.health.qld.gov.au/system-governance/licences/pharmacy', 0),
    # NOT A CARD — the document that would settle the PUBLIC GUARDIAN's. Its own
    # report gives 372 people at 30 June 2025; what is unknown is whether they
    # are inside the Department of Justice's 4,629, and a department's workforce
    # note is where that is stated (DCCEEW's Table 7 note is the model). This
    # resource answers `202 and zero bytes` to a plain fetch.
    'doj':        ('https://www.publications.qld.gov.au/dataset/'
                   '2025-26-doj-annual-report', 0),
}

# THE PORTAL THAT WOULD ANSWER ALL OF THEM AT ONCE, asked here because the
# runner is where the WAF challenge can be executed. If this works, the per-site
# probes above become a fallback rather than the route.
PORTAL = ('https://www.publications.qld.gov.au/dataset?q=',
          ['annual report 2025-26', 'queensland curriculum annual report',
           'qleave annual report', 'racing integrity annual report'])


# THE BROWSER FETCH IS IMPORTED, NOT REIMPLEMENTED. gen-gov-workforce.py's
# fetch() already carries everything this needs — the pinned Chromium path, the
# four interstitial patterns, the challenge waits — and a second, weaker copy
# here would be a copy that goes stale the first time one of them is fixed.
# Loaded by path because the module name has hyphens; importing it runs the
# table definitions and nothing else, since its work is under __main__.
def _gen():
    import importlib.util
    import pathlib
    if _GEN['m'] is None:
        path = pathlib.Path(__file__).with_name('gen-gov-workforce.py')
        spec = importlib.util.spec_from_file_location('_gengov', path)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _GEN['m'] = m
    return _GEN['m']


_GEN = {'m': None}


def get(url, timeout=90):
    """Plain fetch, then the browser if the plain one is turned away.

    ROUND ONE OF THIS PROBE USED urllib ONLY, AND ITS RESULT WAS MISREAD FOR
    ABOUT A MINUTE. Every host that answers 403 here answered 403 on the RUNNER
    too, and publications.qld.gov.au returned its `202 and zero bytes` there as
    well — which reads as "the runner is blocked, the way out of South Australia
    does not work for Queensland". It is not that. The Queensland doorman is an
    AWS WAF JavaScript challenge, and clearing it is the whole reason
    gov-workforce.yml drives a browser at all; a plain urllib fetch from a
    runner is no more able to execute JavaScript than one from here.
    """
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
        if r.status == 200 and len(body) > 400:
            return r.status, body
        plain = (r.status, body)
    except urllib.error.HTTPError as e:
        plain = (e.code, b'')
    except Exception as e:                                        # noqa: BLE001
        plain = (None, f'{type(e).__name__}: {e}'.encode())

    try:
        html = _gen().fetch(url, via_browser=True, render=True)
        print(f'  (plain fetch gave {plain[0]}; retried through the browser)',
              flush=True)
        return 200, html.encode('utf-8', 'replace')
    except Exception as e:                                        # noqa: BLE001
        print(f'  (browser retry also failed: {type(e).__name__}: '
              f'{str(e)[:90]})', flush=True)
        return plain


def report_links(base, html):
    out, seen = [], set()
    for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.S | re.I):
        href = urllib.parse.urljoin(base, m.group(1).replace('&amp;', '&'))
        lab = ' '.join(re.sub(r'<[^>]+>', ' ', m.group(2)).split())
        if not re.search(r'(?i)annual.?report|\.pdf', href + ' ' + lab):
            continue
        if href in seen:
            continue
        seen.add(href)
        out.append((href, lab))
    return out


def probe(key, url, ads):
    print(f'\n{"=" * 70}\n{key} ({ads} live ads): {url}', flush=True)
    st, body = get(url)
    if st != 200:
        print(f'  HTTP {st} — {body[:90].decode("utf-8", "replace")}', flush=True)
        return
    print(f'  HTTP {st}, {len(body):,} bytes', flush=True)
    if len(body) < 400:
        print('  A BODY TOO SHORT TO BE A PAGE — the WAF challenge, not the '
              'site, and the browser retry did not clear it either', flush=True)
        return
    html = body.decode('utf-8', 'replace')
    if any(c in html for c in CHALLENGE):
        print('  AN INTERSTITIAL, NOT THE PAGE — the runner is challenged too',
              flush=True)
        return
    hits = report_links(url, html)
    if not hits:
        print('  200 and NO annual-report link — a finding about this page, not '
              'about the body; try its publications or about section', flush=True)
    for href, lab in hits[:10]:
        print(f'    {href[:118]}  |{lab[:40]}|', flush=True)


def main():
    want = [a for a in sys.argv[1:] if not a.startswith('-')]
    for key, (url, ads) in SITES.items():
        if want and key not in want:
            continue
        probe(key, url, ads)
    if want and 'portal' not in want:
        return
    base, queries = PORTAL
    for q in queries:
        probe(f'portal:{q}', base + urllib.parse.quote(q), 0)


if __name__ == '__main__':
    main()
