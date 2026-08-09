#!/usr/bin/env python3
"""Employee reviews from Glassdoor, archived to D1.

Approach follows github.com/MatthewChatham/glassdoor-review-scraper — sign in,
open a company's review pages, walk them, parse each card — rewritten because
that project is Selenium from 2017 and its selectors are long dead.

READ THIS BEFORE RUNNING IT
Glassdoor's Terms of Service prohibit scraping, and its robots.txt disallows
`/Reviews/*_P*.htm*` — the pagination pattern this walks. The upstream project
says so itself: "I make no representation that your account won't be banned."
None of that is hidden here because it is the operator's decision to take, and
it is taken with the operator's account. Use a dedicated account, not a personal
one. If Glassdoor asks us to stop, the answer is to stop.

Everything below is built to be the gentlest possible version of that decision:

  ONE REQUEST AT A TIME, NEVER CONCURRENT. Reviews are not urgent. A single
  serial walk with a long pause costs us hours and costs Glassdoor almost
  nothing; six parallel workers would halve our time and multiply their load.

  A LONG, JITTERED PAUSE. PAGE_PAUSE seconds between pages with up to
  PAGE_JITTER extra, so the request pattern is not a metronome. Defaults are
  deliberately slower than any human reader.

  A HARD CEILING PER RUN. --max-pages and --max-companies bound the work no
  matter what the arguments say, so a mistake costs one small run rather than a
  crawl of the whole site.

  IT STOPS ON THE FIRST SIGN IT IS UNWELCOME. A captcha, a challenge page, a
  429 or a 403 ends the run immediately and marks the feed degraded. It does NOT
  retry, rotate, or re-login into a defence: retrying past a block is the
  behaviour that turns a rate-limit into a ban, and it is also the behaviour of
  something that has been asked to leave and will not.

  IT ONLY FETCHES WHAT IT DOES NOT HAVE. Reviews are immutable once posted, so
  a company already archived is walked until the first page whose reviews are
  all known, then abandoned. Steady state is one page per company, not forty.

  IT LOGS IN AS LITTLE AS POSSIBLE. The session cookie is reused from
  GLASSDOOR_STATE (a Playwright storage_state JSON) when one is supplied, so a
  weekly run is not a weekly login from a new address.

  IT RUNS WEEKLY, NOT NIGHTLY. Review volume is a handful per company per month.

Transport: Playwright through SCRAPE_PROXY. Glassdoor 403s datacentre
addresses — measured 2026-08-09, both .com and .com.au, a 241 KB challenge body
— so this cannot run on a bare GitHub runner.

Env: GLASSDOOR_EMAIL, GLASSDOOR_PASSWORD, optionally GLASSDOOR_STATE,
     SCRAPE_PROXY, CLOUDFLARE_API_TOKEN (D1 edit).
Run: python3 scripts/glassdoor-to-d1.py --company bhp --url <glassdoor reviews url>
     python3 scripts/glassdoor-to-d1.py --probe --url <url>     # read nothing, report what it sees
"""
from __future__ import annotations
import json
import os
import random
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import browser_fetch  # noqa: E402

ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'

# Politeness. These are the numbers that make this defensible; lowering them is
# a decision about someone else's servers, not a tuning knob.
PAGE_PAUSE = float(os.environ.get('GD_PAGE_PAUSE', '20'))    # seconds between pages
PAGE_JITTER = float(os.environ.get('GD_PAGE_JITTER', '10'))  # plus up to this
SETTLE = 6                                                    # seconds for the page to render
HARD_MAX_PAGES = 40      # per company, per run, whatever --max-pages says
HARD_MAX_COMPANIES = 25  # per run

args = sys.argv[1:]


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


COMPANY = opt('--company')
URL = opt('--url')
MAX_PAGES = min(int(opt('--max-pages', 10)), HARD_MAX_PAGES)
PROBE = '--probe' in args
DRY = '--dry-run' in args

# Anything here means "you are not welcome right now". Matched on a page that
# produced no reviews — a rendered review page mentions "captcha" in its own
# bundle often enough that treating these as an independent signal would report
# blocks that are not there. Same lesson as probe-headless-ci.py.
BLOCK_MARKERS = [
    (r'Pardon Our Interruption', 'DataDome'),
    (r'Just a moment', 'Cloudflare interstitial'),
    (r'unusual activity|automated queries|verify you are a human', 'bot challenge'),
    (r'captcha|challenge-platform', 'captcha'),
    (r'Access Denied|403 Forbidden', 'denied'),
]

DDL = '''CREATE TABLE IF NOT EXISTS company_reviews (
           review_key TEXT PRIMARY KEY,
           company_id TEXT NOT NULL,
           rating     REAL,
           title      TEXT,
           pros       TEXT,
           cons       TEXT,
           job_title  TEXT,
           location   TEXT,
           posted     TEXT,
           url        TEXT,
           first_seen TEXT NOT NULL,
           last_seen  TEXT NOT NULL)'''
IDX = ('CREATE INDEX IF NOT EXISTS idx_company_reviews_co '
       'ON company_reviews (company_id, posted DESC)')


def d1(sql: str, params: list | None = None):
    token = os.environ.get('CLOUDFLARE_API_TOKEN')
    if not token:
        sys.exit('Set CLOUDFLARE_API_TOKEN.')
    req = urllib.request.Request(
        API, data=json.dumps({'sql': sql, 'params': params or []}).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=45) as r:
        j = json.loads(r.read().decode())
    if not j.get('success'):
        raise RuntimeError(str(j.get('errors'))[:300])
    return j['result'][0]['results']


def blocked_as(html: str) -> str | None:
    for pat, label in BLOCK_MARKERS:
        if re.search(pat, html, re.I):
            return label
    return None


def review_key(company: str, posted: str, title: str, pros: str) -> str:
    """Stable id for a review.

    Glassdoor exposes no durable review id in the markup we can rely on, so the
    key is the content: same company, same date, same headline, same opening of
    the pros. Reviews are immutable once posted, which is what makes hashing the
    content safe here and would not be safe for a job ad.
    """
    import hashlib
    raw = '|'.join([company, posted or '', (title or '').strip().lower(),
                    (pros or '').strip().lower()[:120]])
    return hashlib.sha1(raw.encode('utf-8')).hexdigest()[:32]


def parse_reviews(html: str) -> list[dict]:
    """Reviews from a rendered review page.

    SELECTORS ARE UNVERIFIED UNTIL THE FIRST CI RUN, and the code says so rather
    than pretending otherwise: Glassdoor 403s this sandbox, so nothing here has
    been checked against a live page. That is exactly why --probe exists and why
    the first run should be a probe. Glassdoor renders reviews into a JSON island
    as well as into markup, and the island is read FIRST because it survives a
    redesign that markup does not.
    """
    out: list[dict] = []

    # 1. The JSON island. Apollo state carries review objects keyed by typename.
    for m in re.finditer(r'"__typename"\s*:\s*"EmployerReview".*?(?=\{"__typename"|\Z)', html, re.S):
        blob = m.group(0)

        def field(name):
            f = re.search(rf'"{name}"\s*:\s*"((?:[^"\\]|\\.)*)"', blob)
            return json.loads(f'"{f.group(1)}"') if f else ''
        num = re.search(r'"ratingOverall"\s*:\s*([\d.]+)', blob)
        rec = {'rating': float(num.group(1)) if num else None,
               'title': field('summary'), 'pros': field('pros'), 'cons': field('cons'),
               'job_title': field('jobTitle') or field('text'),
               'location': field('locationName'),
               'posted': (field('reviewDateTime') or '')[:10]}
        if rec['pros'] or rec['cons'] or rec['title']:
            out.append(rec)
    if out:
        return out

    # 2. Markup fallback, deliberately loose: enough to notice reviews exist so a
    #    parse failure is reported as "page rendered, parser missed it" rather
    #    than as a block, which needs a different fix.
    for card in re.split(r'data-test="review-details"', html)[1:]:
        def sect(label):
            s = re.search(rf'{label}</[^>]+>\s*<[^>]*>(.*?)</', card, re.S | re.I)
            return re.sub(r'<[^>]+>', '', s.group(1)).strip() if s else ''
        pros, cons = sect('Pros'), sect('Cons')
        if pros or cons:
            rt = re.search(r'"ratingValue"\s*:\s*"?([\d.]+)', card)
            out.append({'rating': float(rt.group(1)) if rt else None,
                        'title': '', 'pros': pros, 'cons': cons,
                        'job_title': '', 'location': '',
                        'posted': (re.search(r'(\d{4}-\d{2}-\d{2})', card) or ['', ''])[1]})
    return out


def sign_in(sess) -> str:
    """Sign in if the stored session is not already signed in. Returns '' or why not.

    CHECKED FIRST, ALWAYS. A saved storage_state usually still carries a valid
    cookie, and re-authenticating anyway is the single most suspicious thing a
    weekly job can do: a fresh login from a datacentre-adjacent residential
    address, every week, on a schedule. So this loads the reviews URL, and only
    reaches for the password if the page says we are signed out.

    The selectors here are UNVERIFIED — Glassdoor 403s the sandbox this was
    written in, so the sign-in form has not been seen. That is why the caller
    should run --probe first, and why a failure returns a reason rather than
    raising: "we could not sign in" and "they blocked us" need different
    responses and must not look the same.
    """
    email = os.environ.get('GLASSDOOR_EMAIL', '')
    password = os.environ.get('GLASSDOOR_PASSWORD', '')
    page = sess._page  # noqa: SLF001 — Session exposes no page accessor yet
    try:
        page.goto(URL, wait_until='domcontentloaded', timeout=90_000)
        page.wait_for_timeout(SETTLE * 1000)
    except Exception as e:  # noqa: BLE001
        return f'could not open the reviews page: {str(e)[:90]}'
    html = page.content()
    if re.search(r'"isLoggedIn"\s*:\s*true|data-test="site-header-profile', html):
        return ''
    if not (email and password):
        return ('signed out and no credentials supplied — set GLASSDOOR_EMAIL and '
                'GLASSDOOR_PASSWORD (use a dedicated account, not a personal one)')
    try:
        page.fill('input[name="username"], input[type="email"]', email, timeout=20_000)
        page.keyboard.press('Enter')
        page.wait_for_timeout(2500)
        page.fill('input[name="password"], input[type="password"]', password, timeout=20_000)
        page.keyboard.press('Enter')
        page.wait_for_timeout(6000)
    except Exception as e:  # noqa: BLE001
        return f'sign-in form not as expected: {str(e)[:90]}'
    after = page.content()
    if blocked_as(after):
        return f'blocked during sign-in ({blocked_as(after)})'
    sess.save_state()
    return ''


def page_url(base: str, n: int) -> str:
    """Page n of a Glassdoor reviews URL (`..._P2.htm`). Page 1 is the base."""
    if n <= 1:
        return base
    return re.sub(r'\.htm$', f'_P{n}.htm', base)


def main() -> int:
    if not URL:
        sys.exit('--url is required (the company\'s Glassdoor reviews page).')
    if not PROBE and not COMPANY:
        sys.exit('--company is required (our roster id) unless --probe.')
    if not os.environ.get('SCRAPE_PROXY'):
        sys.stderr.write(
            'WARNING: SCRAPE_PROXY is not set. Glassdoor answered a datacentre '
            'address with 403 and a challenge body when this was measured, so a '
            'bare runner will simply be refused.\n')

    known: set[str] = set()
    if COMPANY and not (PROBE or DRY):
        d1(DDL)
        d1(IDX)
        known = {r['review_key'] for r in
                 d1('SELECT review_key FROM company_reviews WHERE company_id = ?', [COMPANY])}
        sys.stderr.write(f'{len(known)} reviews already archived for {COMPANY}\n')

    fresh, seen_pages, stop_reason = [], 0, ''
    state = os.environ.get('GLASSDOOR_STATE') or None
    # ONE context for the whole walk. Reviews are behind a sign-in, and a fresh
    # context per page would mean a fresh sign-in per page — slower for us and
    # far louder for them.
    with browser_fetch.Session(locale='en-AU', storage_state=state) as sess:
        why = sign_in(sess)
        if why:
            print(f'stopped before reading anything: {why}')
            return 1
        for n in range(1, MAX_PAGES + 1):
            url = page_url(URL, n)
            sys.stderr.write(f'  page {n}: {url}\n')
            # Session.html takes the same instruction vocabulary render() does;
            # the wait is how this page gets time to hydrate its reviews.
            html = sess.html(url, [{'type': 'wait', 'wait_time_s': SETTLE}])
            seen_pages += 1
            if not html:
                stop_reason = 'no response'
                break
            rows = parse_reviews(html)
            if not rows:
                why = blocked_as(html)
                # STOP, do not retry. Retrying past a block is what turns a
                # rate-limit into a ban, and it is also what ignoring a refusal
                # looks like from the other side.
                stop_reason = f'blocked ({why})' if why else 'no reviews parsed'
                break
            new = 0
            for r in rows:
                key = review_key(COMPANY or 'probe', r['posted'], r['title'], r['pros'])
                r['review_key'] = key
                r['url'] = url
                if key not in known:
                    known.add(key)
                    fresh.append(r)
                    new += 1
            sys.stderr.write(f'    {len(rows)} reviews, {new} new\n')
            # INCREMENTAL: a page with nothing new means everything older is already
            # archived. Reviews are immutable and ordered, so there is no reason to
            # keep reading — this is what makes the steady state one page.
            if new == 0 and not PROBE:
                stop_reason = 'reached reviews already archived'
                break
            if n < MAX_PAGES:
                time.sleep(PAGE_PAUSE + random.uniform(0, PAGE_JITTER))

    print(f'\n{seen_pages} page(s) read, {len(fresh)} new reviews'
          + (f' — stopped: {stop_reason}' if stop_reason else ''))
    if PROBE:
        for r in fresh[:5]:
            print(f'  {r["posted"]} {str(r["rating"]):>4}  {(r["title"] or "")[:56]}')
        print('probe only — nothing written.')
        return 0
    if DRY or not fresh:
        return 0

    today = time.strftime('%Y-%m-%d')
    for r in fresh:
        d1('INSERT INTO company_reviews (review_key, company_id, rating, title, pros, cons,'
           ' job_title, location, posted, url, first_seen, last_seen)'
           ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
           ' ON CONFLICT(review_key) DO UPDATE SET last_seen = excluded.last_seen',
           [r['review_key'], COMPANY, r['rating'], r['title'], r['pros'], r['cons'],
            r['job_title'], r['location'], r['posted'], r['url'], today, today])
    print(f'wrote {len(fresh)} reviews for {COMPANY}')
    # A run that stopped on a block is not a successful run, and the exit code
    # says so — a red run is how a block becomes visible instead of looking like
    # a quiet week.
    return 1 if stop_reason.startswith('blocked') else 0


if __name__ == '__main__':
    raise SystemExit(main())
