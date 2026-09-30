#!/usr/bin/env python3
"""
Scrape each mapped Chinese company's Zhaopin (智联招聘) postings across Beijing /
Shanghai / Shenzhen / Hong Kong and archive them to the D1 jobs table, deduped —
the Zhaopin counterpart of scripts/indeed-to-d1.py.

Meant to run from YOUR OWN machine on a schedule (cron / launchd / Task
Scheduler), NOT from CI/Workers: Zhaopin's anti-bot returns an empty shell to
non-browser clients, so only a real browser on a residential connection reliably
reads results. It drives the tools/zhaopin-company-scraper browser (one warmed
Chromium reused across companies), maps skills for parity via the worker's own
taxonomy (scripts/map-skills.ts — now covers Chinese titles), drops any role
already archived for that company by another source, and upserts through the D1
HTTP API with the same source|title|company|location key + upsert as
src/employsi/lib/jobArchive.ts.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
Run:  python3 scripts/zhaopin-to-d1.py [--only id1,id2] [--limit N] [--headful]
                                       [--profile DIR] [--max-pages N] [--solve]

First time on a fresh machine:
    pip3 install playwright && python3 -m playwright install chromium
"""
from __future__ import annotations
import json, os, random, re, subprocess, sys, time, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools', 'zhaopin-company-scraper'))
try:
    import zhaopin_company_scraper as zp  # noqa: E402
except ImportError as e:
    sys.exit(f'Missing dependency ({e}).')
# Playwright only for the browser fallback; the Oxylabs path (OXYLABS_USERNAME)
# runs without it.
try:
    from playwright.sync_api import sync_playwright  # noqa: E402
except ImportError:
    sync_playwright = None

import urllib.request  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
LIMIT = int(_opt('--limit', 10**9))
MAX_PAGES = int(_opt('--max-pages', 5))
# Parallel Oxylabs requests — keep ≤ your Oxylabs plan's concurrency limit.
CONCURRENCY = int(_opt('--concurrency', 8))
HEADFUL = '--headful' in args
PROFILE = _opt('--profile', None)
PROXY = _opt('--proxy', None)
# --proxy-list <file-or-url>: rotate through a proxy pool, moving to the next
# working proxy when the current IP gets blocked (see scripts/proxy_pool.py).
PROXY_LIST = _opt('--proxy-list', None)
NO_SKILLS = '--no-skills' in args
SOLVE = '--solve' in args
# --cffi: fetch Zhaopin over plain HTTPS with a spoofed Chrome TLS fingerprint
# (curl_cffi `impersonate`), through SCRAPE_PROXY. See the block above
# cffi_fetch() for why this exists and what it replaces.
VIA_CFFI = '--cffi' in args
# Which curl_cffi browser profile to present. chrome131 is what the upstream
# tool ships; exposed as a flag because the profile is the whole mechanism, so
# re-testing a different one must not need a code change.
IMPERSONATE = _opt('--impersonate', 'chrome131')
MIN_DELAY = float(_opt('--min-delay', 6))
MAX_DELAY = float(_opt('--max-delay', 18))

if not SOLVE and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). '
             '(Not needed with --solve, which skips the D1 write.)')


# ── dedup key, identical to src/employsi/lib/jobArchive.ts ────────────────────
# Han, kana, Hangul. Mirrors jobArchive.ts: a string containing any of them
# keeps every letter and digit (the ASCII rule below erased CJK titles to "",
# collapsing a Chinese board to one row per city); every other string keys
# exactly as before, so no existing Latin key moves.
_CJK = re.compile(r'[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]')


def norm(s: str) -> str:
    if _CJK.search(s or ''):
        return re.sub(r'[\W_]+', ' ', (s or '').lower()).strip()[:120]
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


# ── target companies (parsed from the generated TS) ───────────────────────────
# Quote-AGNOSTIC — see the same note in scripts/seek-to-d1.py. This pattern
# assumed single quotes; Prettier reformatted chinaJobsTargets.ts to double
# quotes and it went from 93 matches to 0, after which the scraper walked no
# companies and exited 0 every night.
# TWO BUGS LIVED IN THIS PATTERN AND BOTH FAILED SILENTLY. Measured against the
# live data file 2026-08-09: it matched 46 of the 93 records, and 17 of those 46
# carried a corrupted keyword.
#
#   1. TRAILING COMMA. Every record is written `hub: "beijing",\n  }` and the
#      pattern ended `\s*\}` — no comma allowed — so only the records Prettier
#      happened to leave without one matched. 47 targets, half the Chinese
#      roster, were never walked at all and nothing said so.
#   2. QUOTES INSIDE THE VALUE CLASS. `[^\\]` excludes backslashes but NOT the
#      quote that terminates the value, so a non-greedy kw match crossed its own
#      closing quote and ran on until it could satisfy the FOLLOWING record's
#      `cityId:`. The result was keywords like
#      `华能",\n cityId: 530,\n hub: "beijing",\n },\n { id: "beijing-601398"...`
#      searched against Zhaopin verbatim.
#
# Both are the same class as the bug the note below already records: this file
# reads TypeScript with a regex, so every assumption about the formatting is
# load-bearing and none of them announce themselves when they break.
TARGET_RE = re.compile(
    r'\{\s*id:\s*(["\'])(.*?)\1\s*,\s*'
    r'name:\s*(["\'])((?:[^"\'\\]|\\.)*?)\3\s*,\s*'
    r'kw:\s*(["\'])((?:[^"\'\\]|\\.)*?)\5\s*,\s*'
    r'cityId:\s*(\d+)\s*,\s*'
    r'hub:\s*(["\'])([^"\']+)\8\s*,?\s*\}'
)


def load_targets() -> list[dict]:
    txt = open(os.path.join(ROOT, 'src/employsi/data/chinaJobsTargets.ts')).read()
    # THE FILE'S OWN RECORD COUNT IS THE FLOOR. Counting `cityId:` needs no
    # regex agreement with the rest of the pattern, so it still holds when the
    # pattern stops matching — which is exactly when it is needed. Parsing
    # fewer targets than the file contains has happened twice and been invisible
    # both times.
    # `cityId:\s*\d` and not a bare `cityId:` — the interface declares
    # `cityId: number;` and counting that would make the floor demand one target
    # more than the file holds, failing every run for the sake of a type.
    declared = len(re.findall(r'cityId:\s*\d', txt))
    out = []
    for m in TARGET_RE.finditer(txt):
        cid = m.group(2)
        if ONLY and cid not in ONLY:
            continue
        unq = lambda s: s.replace("\\'", "'").replace('\\"', '"')  # noqa: E731
        out.append({'id': cid, 'name': unq(m.group(4)), 'kw': unq(m.group(6)),
                    'cityId': int(m.group(7)), 'hub': m.group(9)})
    if not ONLY and declared and len(out) < declared:
        sys.exit(f'chinaJobsTargets.ts declares {declared} targets and TARGET_RE '
                 f'parsed {len(out)}. The file was reformatted and this regex no '
                 f'longer reads all of it — fix the pattern rather than walking '
                 f'the {len(out)} it still happens to match.')
    return out


# ── skills parity via the worker's own taxonomy (offline bun helper) ──────────
def map_skills(titles: list) -> list:
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=json.dumps(titles).encode(), capture_output=True, timeout=180)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:
        sys.stderr.write(f'  map-skills error: {e}\n')
    return [[] for _ in titles]


# ── D1 HTTP API ───────────────────────────────────────────────────────────────
def d1(sql: str, params: list):
    body = json.dumps({'sql': sql, 'params': params}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                j = json.loads(r.read().decode())
                if j.get('success'):
                    return j['result']
                raise RuntimeError(str(j.get('errors')))
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            if attempt == 3:
                raise RuntimeError(f'D1 {e.code}: {detail}')
            time.sleep(attempt + 1)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def existing_titles(company_id: str) -> set:
    # Only OTHER sources — so a Zhaopin job that duplicates another source's role
    # is counted once, while Zhaopin's own prior jobs re-upsert (refresh last_seen).
    r = d1("SELECT DISTINCT title FROM jobs WHERE company_id = ? AND source != 'zhaopin'", [company_id])
    return {norm(str(x.get('title') or '')) for x in (r[0]['results'] if r else [])}


def upsert(t: dict, jobs: list) -> int:
    titles = [j['t'] for j in jobs]
    skills = map_skills(titles)
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        company = j.get('company') or t['name']
        location = j.get('loc') or t['hub']
        key = job_key('zhaopin', j['t'], company, location)
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, 'zhaopin', j['t'], company or None, t['id'],
                     t['hub'], location, 'Zhaopin', j.get('salary'),
                     j.get('url') or '', j.get('date') or '',
                     json.dumps(sk) if sk else None))
    written = 0
    for i in range(0, len(rows), 7):  # D1 caps ~100 bound params/query
        chunk = rows[i:i + 7]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'] * len(chunk))
        sql = ('INSERT INTO jobs '
               '(job_key, source, title, company, company_id, hub, location, category, salary, url, posted, skills, first_seen, last_seen, seen_count) '
               f'VALUES {values} '
               'ON CONFLICT(job_key) DO UPDATE SET '
               'last_seen = excluded.last_seen, seen_count = seen_count + 1, '
               "salary = COALESCE(jobs.salary, excluded.salary), "
               "url = COALESCE(NULLIF(jobs.url, ''), excluded.url), "
               "posted = COALESCE(NULLIF(jobs.posted, ''), excluded.posted), "
               'skills = COALESCE(jobs.skills, excluded.skills)')
        params = []
        for r in chunk:
            params.extend([*r, TODAY, TODAY])
        d1(sql, params)
        written += len(chunk)
    return written


# ── the curl_cffi transport ──────────────────────────────────────────────────
# WHY THIS EXISTS. The Oxylabs path below has returned nothing since 2026-08-28:
# `oxylabs auth failed (401)` on every one of 93 companies, six consecutive red
# scheduled runs to 2026-09-29. That is the account being rejected, not a quota
# (which is a 429), and the same credential took Indeed down on the same day.
#
# WHAT IT BORROWS. jiangyuxue666/job-market-analyzer (MIT) reaches Zhaopin with
# no proxy and no browser at all: curl_cffi presenting Chrome's TLS fingerprint
# (`impersonate="chrome131"`), then CSS selectors over the returned markup. The
# fingerprint is the whole trick — Zhaopin's wall reads the TLS ClientHello, and
# a stock Python client is identifiable before it has sent a single header.
#
# WHAT IT ADDS, AND WHY IT HAS TO. That technique ALONE does not clear the wall
# from a non-China datacentre address. Measured 2026-09-29 from CI's address
# class, with the impersonation confirmed live (JA3 differs per profile, so the
# spoofed hello really does reach the far end):
#
#   sou.zhaopin.com / www.zhaopin.com   "Security Verification", 1,930 bytes
#   fe-api /search/positions (POST)     HTTP 200, isVerification=1, 0 results
#   fe-api /c/i/sou (legacy GET)        HTTP 200, numTotal=0, empty on every
#                                       parameter variant tried
#   fe-api /city-page/user-city         HTTP 200, REAL DATA
#
# That last line is what rules out a blanket ban on the address: the host
# answers us, it just will not serve job results. The upstream tool is a
# Chinese-language tool for domestic use and carries no proxy layer because its
# author never needed one — from inside China the fingerprint is the only wall.
#
# So this pairs its fingerprint with the address the site wants:
# SCRAPE_PROXY_COUNTRY=cn, which http_fetch folds onto the IPRoyal password.
# Neither half is expected to work alone.
def cffi_fetch(url: str):
    """(text, status) for a Zhaopin URL, or ('', code) — never raises.

    Returns the body even on a non-200 so the caller can tell a challenge page
    from an empty one; a swallowed error here reads downstream as "this company
    has no vacancies", which is the failure mode this feed already has a
    red-on-zero-rows guard for.
    """
    try:
        from curl_cffi import requests as cffi_requests
    except ImportError:
        sys.exit('--cffi needs curl_cffi: pip install curl_cffi')
    import http_fetch
    proxy = http_fetch.scrape_proxy_url()
    kw = {'headers': _CFFI_HEADERS, 'impersonate': IMPERSONATE, 'timeout': 40}
    if proxy:
        kw['proxies'] = {'http': proxy, 'https': proxy}
    try:
        r = cffi_requests.get(url, **kw)
        return r.text or '', r.status_code
    except Exception as e:
        sys.stderr.write(f'  fetch failed: {type(e).__name__}: {str(e)[:120]}\n')
        return '', 0


# zh-CN first, and a sou.zhaopin.com referer, exactly as the upstream tool sends
# them — a Chinese board reading an en-US Accept-Language from a Chinese address
# is a mismatch it can price in.
_CFFI_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://sou.zhaopin.com/',
}

# The marker of the interstitial measured above. Naming it lets one run say
# "challenged" rather than "0 jobs", which is the difference between knowing the
# exit was refused and thinking Chinese employers stopped hiring.
_CHALLENGE = ('Security Verification', '安全验证', '验证码')


def cffi_parse(html: str):
    """(jobs, which_parser).

    The tuple survives the second parser it was built to choose between: a run
    that collects nothing needs to say whether the page was unreadable or
    merely empty, and this is what the summary line prints. See the note above
    parse_search_html() for the reading that was tried and dropped.
    """
    jobs = zp.parse_search_html(html)
    return (jobs, '__INITIAL_STATE__') if jobs else ([], '')


def main() -> int:
    targets = load_targets()
    if not targets and not ONLY:
        # Nothing parsed from a file that exists means its format changed, not
        # that China has no employers. Fail rather than archive nothing quietly.
        sys.stderr.write(
            'No targets parsed from src/employsi/data/chinaJobsTargets.ts — the file is '
            'present but nothing matched, so its format has changed. Treating as a failure.\n')
        return 1
    mode = 'SOLVE / reachability check — no D1 write' if SOLVE else 'Zhaopin -> D1'
    sys.stderr.write(f'{mode}: {len(targets)} company(ies) across '
                     f'{len({t["hub"] for t in targets})} cities '
                     f'({"HEADFUL" if HEADFUL else "headless"}'
                     f'{", profile=" + PROFILE if PROFILE else ""}).\n')
    if not HEADFUL and not PROFILE:
        sys.stderr.write('  tip: first run with --headful --profile <dir> to clear Zhaopin\'s '
                         'security check by hand; the profile then reuses the solved session.\n')

    # ── curl_cffi path (TLS impersonation + a China exit) ─────────────────────
    # CHECKED BEFORE THE OXYLABS GATE BELOW, and that ordering is the point: the
    # Oxylabs branch fires on `OXYLABS_USERNAME` merely being SET, so with a
    # dead-but-present secret in CI it captures every run and 401s. An explicit
    # flag has to win over an implicit credential.
    if VIA_CFFI:
        from urllib.parse import quote
        from concurrent.futures import ThreadPoolExecutor
        import threading, http_fetch
        sel = targets[:LIMIT] if LIMIT < len(targets) else targets
        exit_label = http_fetch.proxy_label()
        country = (os.environ.get('SCRAPE_PROXY_COUNTRY') or '').lower()
        if exit_label == 'direct':
            sys.stderr.write(
                '  WARNING: SCRAPE_PROXY is unset, so this runs from the runner\'s own\n'
                '  address. Measured 2026-09-29: that address gets a Security\n'
                '  Verification page, not results. Expect zero rows and a red run.\n')
        elif country != 'cn':
            sys.stderr.write(
                f'  WARNING: SCRAPE_PROXY_COUNTRY={country or "(unset)"}, not cn. The\n'
                '  fingerprint alone was measured insufficient; Zhaopin wants a\n'
                '  Chinese address too.\n')
        sys.stderr.write(f'  via curl_cffi impersonate={IMPERSONATE} through {exit_label} '
                         f'(country={country or "default"}) — {len(sel)} companies, '
                         f'no browser.\n')
        lock = threading.Lock()
        # `reach` counts companies that actually returned ROWS. The SOLVE
        # branch returns before `empty` is ever incremented, so deriving
        # reachability as done-minus-empty reported "3 of 3 returned listings
        # (0 in total)" — a green-looking tick on a walk that collected nothing,
        # which is the exact failure the red-on-zero guard below exists to stop.
        st = {'fetch': 0, 'new': 0, 'empty': 0, 'done': 0, 'reach': 0,
              'challenged': 0, 'parsers': {}}

        def work(t):
            jobs, seen, challenged = [], set(), False
            for pg in range(1, MAX_PAGES + 1):
                url = f"https://sou.zhaopin.com/?kw={quote(t['kw'])}&jl={t['cityId']}&p={pg}"
                html, code = cffi_fetch(url)
                if not html:
                    break
                # SAY "CHALLENGED", NOT "0 JOBS". The interstitial is a 200 with
                # a normal-looking body, so without this the run reports a quiet
                # employer and the summary blames the roster instead of the exit.
                if any(m in html for m in _CHALLENGE):
                    challenged = True
                    break
                page_jobs, which = cffi_parse(html)
                if which:
                    with lock:
                        st['parsers'][which] = st['parsers'].get(which, 0) + 1
                new = 0
                for j in page_jobs:
                    k = (j['t'], j['loc'])
                    if k in seen:
                        continue
                    seen.add(k)
                    jobs.append(j)
                    new += 1
                if new == 0:
                    break
            if SOLVE:
                with lock:
                    st['fetch'] += len(jobs); st['done'] += 1
                    if jobs:
                        st['reach'] += 1
                    if challenged:
                        st['challenged'] += 1
                flag = 'CHALLENGED' if challenged else ('reachable ✓' if jobs else 'NOTHING')
                sys.stderr.write(f'  {t["id"]:22} {len(jobs):3} jobs · {flag} ({t["kw"]})\n')
                return
            if not jobs:
                with lock:
                    st['empty'] += 1; st['done'] += 1
                    if challenged:
                        st['challenged'] += 1
                sys.stderr.write(f'  {t["id"]:22}   0 jobs'
                                 f'{" · CHALLENGED" if challenged else ""} ({t["kw"]})\n')
                return
            have = existing_titles(t['id'])
            fresh = [j for j in jobs if norm(j['t']) not in have]
            written = upsert(t, fresh) if fresh else 0
            with lock:
                st['fetch'] += len(jobs); st['new'] += written; st['done'] += 1
            sys.stderr.write(f'  {t["id"]:22} {len(jobs):3} zhaopin · {written:3} new '
                             f'({len(jobs) - len(fresh)} already archived)\n')

        with ThreadPoolExecutor(max_workers=max(1, CONCURRENCY)) as ex:
            list(ex.map(work, sel))

        # WHICH PARSER READ THE PAGE IS THE POINT OF THE FIRST REAL RUN. Two are
        # shipped because nobody could load a results page to tell; this line is
        # how that gets settled, so it prints even on a walk that collected
        # nothing.
        parsers = ', '.join(f'{k}×{v}' for k, v in st['parsers'].items()) or 'none matched'
        sys.stderr.write(f'\nParser that read the pages: {parsers}\n')
        # A FEW CHALLENGES AND MOSTLY CHALLENGES ARE DIFFERENT FAULTS, and the
        # first version of this line sent you to the same place for both. The
        # proxy is a ROTATING pool, so an occasional company lands on an address
        # Zhaopin has seen too much of — measured 2026-09-29: 2 of 93, while the
        # other 91 read fine through the same configuration. Telling someone to
        # go and check SCRAPE_PROXY_COUNTRY on that evidence points them at a
        # setting that is demonstrably correct. Only a walk that is mostly
        # challenges is the exit itself.
        if st['challenged']:
            share = st['challenged'] / max(1, st['done'])
            if share >= 0.5:
                sys.stderr.write(
                    f'{st["challenged"]} of {st["done"]} companies got the Security '
                    f'Verification interstitial rather than results — at that share '
                    f'it is the EXIT being refused, not the roster being quiet. '
                    f'Check SCRAPE_PROXY_COUNTRY is cn and that the pool still has '
                    f'Chinese addresses.\n')
            else:
                sys.stderr.write(
                    f'{st["challenged"]} of {st["done"]} companies got the Security '
                    f'Verification interstitial ({share:.0%}). At this share that is '
                    f'the rotating pool handing out a burnt address for one walk, not '
                    f'a broken configuration — the rest of the roster read fine '
                    f'through the same settings. Worth acting on only if it climbs.\n')
        if SOLVE:
            sys.stderr.write(f'\n{st["reach"]} of {st["done"]} companies returned '
                             f'listings via curl_cffi ({st["fetch"]} in total).\n')
            return 0 if st['fetch'] else 2
        sys.stderr.write(f'\nDone (curl_cffi via {exit_label}). {st["fetch"]} listings '
                         f'fetched, {st["new"]} new rows archived, {st["empty"]} companies '
                         f'with 0 jobs.\n')
        if sel and not st['fetch']:
            sys.stderr.write(
                f'FAILED: {len(sel)} targets walked and not one listing fetched. '
                f'See the challenge count and parser line above — they separate '
                f'"the exit was refused" from "the markup moved".\n')
            return 2
        return 0

    # ── Oxylabs Web Scraper API path (no browser / no proxy) ──────────────────
    # When OXYLABS_USERNAME is set we fetch Zhaopin's rendered search page through
    # Oxylabs (China geo + JS render + anti-bot bypass) and parse the embedded
    # __INITIAL_STATE__ job records — no Playwright, runs on any host.
    if os.environ.get('OXYLABS_USERNAME'):
        import oxylabs_client as oxy
        from urllib.parse import quote
        from concurrent.futures import ThreadPoolExecutor
        import threading
        sel = targets[:LIMIT] if LIMIT < len(targets) else targets
        sys.stderr.write(f'  via Oxylabs Web Scraper API (geo=China, concurrency={CONCURRENCY}) '
                         f'— {len(sel)} companies, no browser.\n')
        lock = threading.Lock()
        st = {'fetch': 0, 'new': 0, 'empty': 0, 'done': 0}

        def work(t):
            jobs, seen = [], set()
            for pg in range(1, MAX_PAGES + 1):
                url = f"https://sou.zhaopin.com/?kw={quote(t['kw'])}&jl={t['cityId']}&p={pg}"
                content, _ = oxy.fetch(url, geo='China', render=True)
                if not content:
                    break
                new = 0
                for j in zp.parse_search_html(content):
                    k = (j['t'], j['loc'])
                    if k in seen:
                        continue
                    seen.add(k)
                    jobs.append(j)
                    new += 1
                if new == 0:
                    break
            if SOLVE:
                with lock:
                    st['fetch'] += len(jobs); st['done'] += 1
                sys.stderr.write(f'  {t["id"]:22} {len(jobs):3} jobs · reachable ✓ ({t["kw"]})\n')
                return
            if not jobs:
                with lock:
                    st['empty'] += 1; st['done'] += 1
                sys.stderr.write(f'  {t["id"]:22}   0 jobs ({t["kw"]})\n')
                return
            have = existing_titles(t['id'])
            fresh = [j for j in jobs if norm(j['t']) not in have]
            written = upsert(t, fresh) if fresh else 0
            with lock:
                st['fetch'] += len(jobs); st['new'] += written; st['done'] += 1
            sys.stderr.write(f'  {t["id"]:22} {len(jobs):3} zhaopin · {written:3} new '
                             f'({len(jobs) - len(fresh)} already archived)\n')

        with ThreadPoolExecutor(max_workers=max(1, CONCURRENCY)) as ex:
            list(ex.map(work, sel))
        if SOLVE:
            sys.stderr.write(f'\n✓ {st["done"]} companies reachable via Oxylabs.\n')
            return 0
        sys.stderr.write(f'\nDone (Oxylabs). {st["fetch"]} listings fetched, {st["new"]} new rows '
                         f'archived, {st["empty"]} companies with 0 jobs.\n')
        # ZERO LISTINGS ACROSS THE WHOLE WALK IS A FAILURE. Measured 2026-08-09:
        # every one of 46 targets came back empty because the Oxylabs plan's
        # quota was exhausted — each request answered HTTP 429 — and this run
        # printed "0 new rows archived" and exited GREEN. A feed that collected
        # nothing must go red, whatever the reason; the reason is in the fetch
        # errors above.
        if sel and not st['fetch']:
            sys.stderr.write(
                f'FAILED: {len(sel)} targets walked and not one listing fetched. '
                f'Check the fetch errors above — an HTTP 429 is the Oxylabs plan '
                f'quota, not Zhaopin refusing us.\n')
            return 2
        return 0

    if sync_playwright is None:
        sys.exit('No browser: install Playwright, or set OXYLABS_USERNAME/OXYLABS_PASSWORD '
                 'to use the Oxylabs Web Scraper API path.')

    # Optional proxy pool: pick an initial working proxy, rotate on repeated blocks.
    rotator = proxy = open_resilient = None
    if PROXY_LIST:
        try:
            from proxy_pool import rotator_from, open_resilient
            rotator = rotator_from(PROXY_LIST, 'https://www.zhaopin.com/', timeout=8.0)
            proxy = rotator.next_working()
            sys.stderr.write(f'  starting with proxy {proxy}\n' if proxy
                             else '  no working proxy in the pool — running direct.\n')
        except Exception as e:
            sys.stderr.write(f'  proxy pool error ({e}) — running direct.\n')
    else:
        proxy = PROXY

    total_fetch = total_new = blocked = done = 0
    consecutive_blocks = 0
    with sync_playwright() as p:
        open_fn = lambda pr: zp.open_session(p, headful=HEADFUL, proxy=pr, profile=PROFILE)
        if open_resilient:
            proxy, ctx, page = open_resilient(open_fn, rotator, proxy)
        else:
            ctx, page = open_fn(proxy)
        first = True
        for t in targets:
            if done >= LIMIT:
                break
            if not first:
                time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))
            first = False
            jobs, was_blocked = zp.scrape_company(page, t['kw'], t['cityId'], max_pages=MAX_PAGES)
            if was_blocked:
                blocked += 1
                consecutive_blocks += 1
                sys.stderr.write(f'  {t["id"]:22} BLOCKED (security check)\n')
                if consecutive_blocks >= 3:
                    nxt = rotator.next_working() if rotator else None
                    if nxt:
                        sys.stderr.write(f'  rotating proxy → {nxt}\n')
                        try:
                            ctx.close()
                        except Exception:
                            pass
                        proxy = nxt
                        ctx, page = zp.open_session(p, headful=HEADFUL, proxy=proxy, profile=PROFILE)
                        consecutive_blocks = 0
                        continue
                    sys.stderr.write('  3 consecutive blocks and no more proxies — stopping.\n')
                    break
                done += 1
                continue
            consecutive_blocks = 0
            total_fetch += len(jobs)
            if SOLVE:
                sys.stderr.write(f'  {t["id"]:22} {len(jobs):3} jobs · reachable ✓ ({t["kw"]})\n')
                done += 1
                continue
            if not jobs:
                sys.stderr.write(f'  {t["id"]:22}   0 jobs ({t["kw"]})\n')
                done += 1
                continue
            have = existing_titles(t['id'])
            fresh = [j for j in jobs if norm(j['t']) not in have]
            written = upsert(t, fresh) if fresh else 0
            total_new += written
            sys.stderr.write(f'  {t["id"]:22} {len(jobs):3} zhaopin · {written:3} new '
                             f'({len(jobs) - len(fresh)} already archived)\n')
            done += 1
        ctx.close()

    if SOLVE:
        ok = done - blocked
        sys.stderr.write(f'\n{"✓ Reachable" if ok and not blocked else ("Partially blocked" if ok else "✗ Blocked")}'
                         f' — {ok} reachable, {blocked} blocked. '
                         f'{"Cached to " + PROFILE if PROFILE else "Tip: add --profile <dir> to keep the solved session."}\n')
        return 2 if (targets and blocked >= done) else 0

    sys.stderr.write(f'\nDone. {total_fetch} Zhaopin listings fetched, {total_new} new rows archived, '
                     f'{blocked} companies blocked.\n')
    if targets and not total_fetch:
        sys.stderr.write(f'FAILED: {len(targets)} targets walked and not one listing '
                         f'fetched.\n')
        return 2
    if targets and blocked > len(targets) * 0.5:
        sys.stderr.write('WARNING: over half blocked — solve the security check via --headful --profile.\n')
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
