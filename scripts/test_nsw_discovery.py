#!/usr/bin/env python3
"""Offline tests for the NSW credential discovery in scripts/nsw-gov-to-d1.py.

WHAT THIS GUARDS, and it is a diagnosis rather than a calculation. Discovery has
exactly two outcomes that matter and they need opposite responses:

  BLOCKED      Cloudflare refused the render or the chunk fetches. A fresh
               session may clear it, so retry — _discover_once returns None.
  CHANGED      Every chunk was read and none carried the credentials. No number
               of retries will help, so stop and say so — sys.exit.

Conflating them is what broke this feed. _discover_once used to sys.exit on ANY
empty-handed scan, from inside the four-attempt retry loop, so the first
partly-challenged render killed the whole night's archive AND reported the site
as rebuilt. Measured 2026-09-21: one 403 on a chunk fetch, 10 chunk references
where a cleared page carries ~40, and nsw-gov silent for two days while every
other gov feed stayed current.

A test is worth having because neither outcome is visible from the rows: a feed
that writes nothing looks the same either way, and the only thing that tells you
which happened is a message that was wrong.

No network: browser_fetch.Session is stubbed.

Run: python3 scripts/test_nsw_discovery.py
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

sys.argv = ['nsw-gov-to-d1.py']
os.environ.setdefault('CLOUDFLARE_API_TOKEN', 'test-token-not-used')

_spec = importlib.util.spec_from_file_location(
    'nsw_to_d1', os.path.join(HERE, 'nsw-gov-to-d1.py'))
nsw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(nsw)

FAILS = []


def check(name, cond, detail=''):
    print(('  PASS  ' if cond else '  FAIL  ') + name
          + (f'  — {detail}' if detail and not cond else ''))
    if not cond:
        FAILS.append(name)


# A token shaped like the real one — JWT_RE needs eyJ + 10 chars, a 20-char
# body and a 10-char signature — but DELIBERATELY NOT an HS256 header. The
# repo's pre-commit leak grep (see CLAUDE.md) keys on the base64 of that
# header, so a fixture using it would flag this file on every future scan, and
# a check that cries wolf is one people stop reading. This decodes to
# {"typ":"JWT"} instead.
CREDS_JS = ('var a="https://api.ad-core04.com/api/",'
            'b="eyJ0eXAiOiJKV1QifQ.ZmFrZS1ib2R5LWZvci10ZXN0cy1vbmx5.bm90LWEtc2lnbmF0dXJl";')
PLAIN_JS = 'var x=1;function noop(){}'


def page_with(n):
    """A jobs page carrying `n` distinct chunk references, over the 60KB floor."""
    refs = ''.join(
        f'<script src="/_next/static/chunks/chunk-{i:04d}.js"></script>' for i in range(n))
    return '<html><body>' + refs + ('<div>padding</div>' * 4000) + '</body></html>'


class FakeSession:
    """Stands in for browser_fetch.Session. `bodies` maps chunk src -> text|None."""

    def __init__(self, page, bodies):
        self._page, self._bodies = page, bodies
        self.fetched = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def html(self, _url, _settle):
        return self._page

    def text(self, url):
        src = url.replace(nsw.SITE, '')
        self.fetched.append(src)
        return self._bodies.get(src)


def run_once(page, bodies):
    """Call _discover_once with a stubbed session. Returns (result, exited, session)."""
    made = {}

    class _Factory:
        def __call__(self, *a, **k):
            made['ses'] = FakeSession(page, bodies)
            return made['ses']

    nsw.browser_fetch.Session = _Factory()
    try:
        return nsw._discover_once(), None, made.get('ses')
    except SystemExit as e:
        return None, str(e), made.get('ses')


N = nsw.HEALTHY_CHUNKS + 5          # a healthy page
SRC = [f'/_next/static/chunks/chunk-{i:04d}.js' for i in range(N)]

# ── the happy path still works ───────────────────────────────────────────────
print('\ncredentials are found and returned:')
got, exited, ses = run_once(page_with(N), {**{s: PLAIN_JS for s in SRC}, SRC[3]: CREDS_JS})
check('returns (base, token)', isinstance(got, tuple) and len(got) == 2, f'got {got!r}')
check('base url is the api root', got and got[0] == 'https://api.ad-core04.com/api/')
check('token is the JWT', got and got[1].startswith('eyJ'))
check('stops scanning once found', ses and len(ses.fetched) == 4, f'fetched {ses and len(ses.fetched)}')
check('did not exit', exited is None, exited or '')

# ── THE BUG: a blocked scan must retry, not exit ─────────────────────────────
print('\nevery chunk fetch blocked -> retryable, NOT a contract change:')
got, exited, _ = run_once(page_with(N), {s: None for s in SRC})
check('returns None so the caller retries', got is None)
check('does NOT sys.exit', exited is None, f'exited with: {exited}')

print('\nSOME chunks blocked and the rest carry nothing -> still retryable:')
bodies = {s: PLAIN_JS for s in SRC}
bodies[SRC[0]] = None
bodies[SRC[1]] = None
got, exited, _ = run_once(page_with(N), bodies)
check('returns None', got is None)
check('does NOT sys.exit', exited is None, f'exited with: {exited}')

# ── a genuine contract change must still stop ────────────────────────────────
print('\nevery chunk READ and none carry credentials -> a real change, so exit:')
got, exited, _ = run_once(page_with(N), {s: PLAIN_JS for s in SRC})
check('does sys.exit', exited is not None)
check('says they were read successfully', exited and 'READ successfully' in exited, exited or '')
check('does not blame the challenge', exited and 'blocked' not in exited.lower(), exited or '')

# ── a partial render is retried before any chunk is fetched ──────────────────
print('\na page with too few chunks is a partial render, not a rebuild:')
got, exited, ses = run_once(page_with(10), {s: CREDS_JS for s in SRC})
check('returns None', got is None)
check('does NOT sys.exit', exited is None, f'exited with: {exited}')
check('fetched no chunks at all', ses and ses.fetched == [], f'fetched {ses and len(ses.fetched)}')
check('the 2026-09-21 count (10) is below the floor', 10 < nsw.HEALTHY_CHUNKS)
check('the measured healthy count (40) is above it', 40 >= nsw.HEALTHY_CHUNKS)

# ── the interstitial is still told apart from a rebuild ──────────────────────
print('\nno chunks at all: short page retries, full page reports a rebuild:')
got, exited, _ = run_once('<html>Just a moment...</html>', {})
check('short challenge page -> retry', got is None and exited is None, exited or '')
got, exited, _ = run_once('<html>' + ('x' * 70_000) + '</html>', {})
check('full page with no chunks -> exit', exited is not None and 'rebuilt' in exited, exited or '')

if FAILS:
    print(f'\n{len(FAILS)} check(s) failed.')
    sys.exit(1)
print('\nNSW discovery blocked-vs-changed OK.')
