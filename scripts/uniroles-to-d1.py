#!/usr/bin/env python3
"""Uni Roles (uniroles.com.au) → the D1 job archive.

A BOARD WALK, NOT A PER-COMPANY SEARCH. Every other keyword feed here is walked
once per rostered employer, because the board has no way to list everything.
This one does: the search page with no filters is the whole job list, and it
prints its own total. So one pass reads every ad on the site, which is both far
cheaper (43 requests against 395 searches) and complete by construction — a
university that is hiring cannot be missed because nobody thought to search for
it.

MEASURED AGAINST THE LIVE SITE, 2026-08-12, before this parser was written:

    https://uniroles.com.au/search-results-jobs/?action=search
        &listing_type[equal]=Job&page=N

    "422 Jobs Found"      the advertised total, in the results header
    10 listings per page  -> 43 pages
    422 parsed / 422 advertised, no duplicates

`page=N` alone is enough — the site also carries a `searchId` in its own links,
and it is NOT needed; walking without one returns the same list.

THE BOARD IS NOT ONLY AUSTRALIAN. Of those 422, eighty-five were New Zealand
(Auckland, Otago, Canterbury, Waikato, Victoria University of Wellington, AUT,
Lincoln, Massey) and one was the University of Macau. They are dropped, not
because they are bad rows but because they are not on the roster this archive
covers — the same advertiser gate every other keyword feed uses. If NZ ever
joins the roster they will start landing with no change here.

WHY THE TOTAL IS LOAD-BEARING. `pagedParallel`-style walks in this repo have
twice truncated silently, because a fetch failure and the end of a list look
identical — both return nothing. This walk is bounded by the advertised total
instead: it knows it wants 43 pages, and it reports any it did not get rather
than stopping early and calling it a day.

Env:
  CLOUDFLARE_API_TOKEN  required, D1 edit
  CF_ACCOUNT_ID, D1_DATABASE_ID  optional overrides

Run: python scripts/uniroles-to-d1.py [--dry] [--limit N] [--no-skills]
"""
from __future__ import annotations
import datetime
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from advertiser_match import advertiser_matches, near_miss, norm  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

SOURCE = 'uniroles'
SITE = 'https://uniroles.com.au'
UA = 'Mozilla/5.0 (compatible; EmploysiBot/1.0; +https://employsi.com.au)'
PER_PAGE = 10          # measured: the board serves 10 listings per page
PAUSE_S = 0.7          # polite, and well inside what the site served happily

args = sys.argv[1:]
DRY = '--dry' in args
NO_SKILLS = '--no-skills' in args


def _opt(flag: str, default=None):
    return args[args.index(flag) + 1] if flag in args and args.index(flag) + 1 < len(args) else default


LIMIT_PAGES = int(_opt('--limit', 0) or 0)   # 0 = every page the total implies

# ── parsing ───────────────────────────────────────────────────────────────────
# One <div class="listing-section"> per ad. Bounded by the NEXT listing-section
# or the end of the results table, so a block can never swallow the one after it.
BLOCK_RE = re.compile(
    r'<div class="listing-section">(.*?)(?=<div class="listing-section">|</tbody>)', re.S)
TITLE_RE = re.compile(r'<div class="listing-title">.*?<a href="([^"]+)"[^>]*>(.*?)</a>', re.S)
# Fields are label/value span pairs: <span class="captions">Location:</span>
# <span class="captions-field">…</span>. Reading them by LABEL rather than by
# position means a new field, or a reordering, cannot shift the others.
EMPLOYER_RE = re.compile(
    r'<span class="captions">Employer:</span>.*?<a href="[^"]*/company/(\d+)/[^"]*">(.*?)</a>', re.S)
TOTAL_RE = re.compile(r'([\d,]+)\s+Jobs?\s+Found', re.I)


def _field(label: str) -> re.Pattern:
    return re.compile(
        r'<span class="captions">' + label +
        r':</span>\s*<span class="captions-field">(.*?)</span>', re.S)


LOCATION_RE = _field('Location')
CLOSING_RE = _field('Closing')


def text(raw: str | None) -> str:
    return html.unescape(re.sub(r'<[^>]+>', ' ', raw or '')).replace('\xa0', ' ').strip()


def parse_page(doc: str) -> list[dict]:
    out = []
    for block in BLOCK_RE.findall(doc):
        t = TITLE_RE.search(block)
        if not t:
            continue
        emp = EMPLOYER_RE.search(block)
        loc = LOCATION_RE.search(block)
        close = CLOSING_RE.search(block)
        title = text(t.group(2))
        if not title:
            continue
        out.append({
            'title': title,
            'url': text(t.group(1)).split('?')[0],   # drop the per-session searchId
            'employer': text(emp.group(2)) if emp else '',
            'location': text(loc.group(1)) if loc else '',
            'closing': text(close.group(1)) if close else '',
        })
    return out


def fetch(page: int) -> str:
    q = urllib.parse.urlencode(
        {'action': 'search', 'listing_type[equal]': 'Job', 'page': page})
    req = urllib.request.Request(f'{SITE}/search-results-jobs/?{q}',
                                 headers={'User-Agent': UA})
    last = ''
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:  # noqa: BLE001
            last = str(e)[:120]
            time.sleep(2 ** attempt)
    raise RuntimeError(f'page {page}: {last}')


# ── D1 ────────────────────────────────────────────────────────────────────────
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


def _bridge(script: str, payload, fallback):
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, script)],
                           input=json.dumps(payload).encode(),
                           capture_output=True, timeout=180, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  {script} failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  {script} error: {e}\n')
    return fallback


def map_skills(titles: list, sector: str) -> list:
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    return _bridge('map-skills.ts', {'titles': titles, 'sector': sector},
                   [[] for _ in titles])


def map_hubs(locations: list, home: str | None) -> list:
    if not locations:
        return []
    return _bridge('map-hubs.ts', {'locations': locations, 'home': home},
                   [None for _ in locations])


def job_key(title: str, company: str, location: str) -> str:
    return '|'.join([SOURCE, norm(title), norm(company), norm(location)])[:400]


def load_roster() -> list:
    p = subprocess.run(['bun', 'run', os.path.join(HERE, 'roster.ts')],
                       capture_output=True, timeout=180, cwd=ROOT)
    if p.returncode != 0:
        sys.exit(f'roster.ts failed: {p.stderr.decode()[:300]}')
    return json.loads(p.stdout.decode())


def upsert(company: dict, jobs: list) -> int:
    skills = map_skills([j['title'] for j in jobs], company.get('sector') or '')
    home = (company.get('cities') or [None])[0]
    hubs = map_hubs([j['location'] for j in jobs], home)
    rows, seen = [], set()
    for j, sk, hub in zip(jobs, skills, hubs):
        key = job_key(j['title'], company['name'], j['location'])
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], company['name'], company['id'],
                     hub, j['location'], 'Higher education', None,
                     j['url'], TODAY, json.dumps(sk) if sk else None))
    written = 0
    for i in range(0, len(rows), 7):  # D1 caps ~100 bound params a query
        chunk = rows[i:i + 7]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'] * len(chunk))
        sql = ('INSERT INTO jobs '
               '(job_key, source, title, company, company_id, hub, location, category, '
               'salary, url, posted, skills, first_seen, last_seen, seen_count) '
               f'VALUES {values} '
               'ON CONFLICT(job_key) DO UPDATE SET '
               'last_seen = excluded.last_seen, seen_count = seen_count + 1, '
               "url = COALESCE(NULLIF(jobs.url, ''), excluded.url), "
               'skills = COALESCE(jobs.skills, excluded.skills)')
        params = []
        for r in chunk:
            params.extend([*r, TODAY, TODAY])
        d1(sql, params)
        written += len(chunk)
    return written


def main() -> int:
    if not TOKEN and not DRY:
        sys.exit('CLOUDFLARE_API_TOKEN is not set.')

    first = fetch(1)
    m = TOTAL_RE.search(first)
    if not m:
        # The header is how the walk knows when it is finished. Without it we
        # would be guessing, and a guess that stops early looks exactly like a
        # quiet job market.
        sys.stderr.write('No "N Jobs Found" header on the results page — the '
                         'page layout has changed. Refusing to guess how many '
                         'pages there are.\n')
        return 1
    total = int(m.group(1).replace(',', ''))
    pages = (total + PER_PAGE - 1) // PER_PAGE
    if LIMIT_PAGES:
        pages = min(pages, LIMIT_PAGES)
    sys.stderr.write(f'Uni Roles -> D1: {total} ads advertised, {pages} pages'
                     f'{", DRY RUN" if DRY else ""}.\n')

    ads, seen_urls, failed = parse_page(first), set(), []
    seen_urls.update(a['url'] for a in ads)
    for p in range(2, pages + 1):
        time.sleep(PAUSE_S)
        try:
            doc = fetch(p)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f'  page {p} FAILED: {e}\n')
            failed.append(p)
            continue
        for a in parse_page(doc):
            if a['url'] not in seen_urls:
                seen_urls.add(a['url'])
                ads.append(a)

    sys.stderr.write(f'  {len(ads)} ads parsed of {total} advertised'
                     f'{f", {len(failed)} pages failed" if failed else ""}.\n')
    if not ads:
        sys.stderr.write('No ads at all — that is a parse or fetch failure, not '
                         'an empty board. Nothing written.\n')
        return 1
    # A shortfall is worth saying out loud but is not itself a failure: ads are
    # taken down while a walk is in progress, so parsed can legitimately trail
    # the total by a little. A LARGE shortfall means the parser or the paging
    # stopped working, and that must not pass silently.
    if len(ads) < total * 0.8 and not failed:
        sys.stderr.write(f'Only {len(ads)} of {total} advertised ads parsed with no '
                         f'failed pages — the listing markup has probably changed.\n')
        return 1

    roster = load_roster()
    by_id = {c['id']: c for c in roster}
    grouped: dict[str, list] = {}
    misses: dict[str, int] = {}
    for a in ads:
        adv = a['employer']
        hit = next((c['id'] for c in roster
                    if adv and advertiser_matches(adv, c['name'])), None)
        if not hit:
            misses[adv or '(no employer)'] = misses.get(adv or '(no employer)', 0) + 1
            continue
        grouped.setdefault(hit, []).append(a)

    kept = sum(len(v) for v in grouped.values())
    sys.stderr.write(f'  {kept} ads kept for {len(grouped)} employers; '
                     f'{len(ads) - kept} not on the roster.\n')
    # The board carries New Zealand and other overseas universities, so most of
    # what is dropped here is correct. Printing them anyway is what makes an
    # Australian employer that STOPPED matching visible — a near miss is the
    # signature of a renamed institution, not of a foreign one.
    for adv, n in sorted(misses.items(), key=lambda kv: -kv[1])[:12]:
        flag = ''
        if any(near_miss(adv, c['name']) for c in roster):
            flag = '   <- NEAR MISS: shares a roster name\'s leading words'
        sys.stderr.write(f'      {n:4}  {adv[:52]}{flag}\n')

    total_rows = 0
    for cid, jobs in sorted(grouped.items()):
        if DRY:
            sys.stderr.write(f'  {cid:44} {len(jobs):>4} ads\n')
            total_rows += len(jobs)
            continue
        n = upsert(by_id[cid], jobs)
        sys.stderr.write(f'  {cid:44} {n:>4} rows\n')
        total_rows += n

    sys.stderr.write(f'\n{total_rows} rows {"parsed" if DRY else "upserted"} '
                     f'to D1 as {SOURCE}.\n')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
