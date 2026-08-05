#!/usr/bin/env python3
"""Company LinkedIn posts -> D1 `company_posts`, for the "in the news" card.

WHAT THIS SCRAPES, AND WHY NOT THE REFERENCED SCRAPER
The brief pointed at scrapfly/scrapfly-scrapers/linkedin-scraper. That project
scrapes five things — profiles, company OVERVIEW pages, job search, job detail
and articles — and its own source confirms none of its functions fetch a
company's posts or activity feed. So it could not have been used as-is.

Measured against the live site instead (2026-08-01, BHP):

  • https://www.linkedin.com/company/<slug>/posts/  returns a 54KB SHELL with
    zero post markup for a logged-out client. This is the obvious URL and it is
    the wrong one.
  • https://www.linkedin.com/company/<slug>/        returns ~440KB containing
    TEN guest-visible post cards: `main-feed-activity-card`, each with a
    `data-activity-urn`, its commentary text, a permalink and media images.

So the company landing page is the target. Ten posts is what LinkedIn shows a
guest; there is no pagination without an account, and this does not attempt one.

DATES ARE REAL, NOT RELATIVE
The cards print a relative label ("1w", "2w") and no absolute date. Storing a
date derived from "1w" would be a fabrication to the nearest week. LinkedIn's
activity id encodes its creation time in the high bits — `id >> 22` is a Unix
millisecond timestamp — and that was verified against the labels on the live
page before being relied on here: 7485808745000640513 decodes to 2026-07-22,
which is exactly the "1w" the page printed on 2026-08-01. Ten of ten matched.

ATTRIBUTION IS CHECKED, NOT ASSUMED
A slug guessed from a company name resolves to whoever owns it — the same fault
class as the advertiser bug that filed 31 Manila roles under IGO. Every fetched
page must name the company we asked for (the feed-actor name), or the rows are
discarded and the slug reported as unresolved.

THE WALK IS THE ROSTER, AND IT BANKS AS IT GOES
Two faults measured on 2026-08-04, both fixed here. It walked all 1,503 entries
of the company dump — every government agency included — rather than the
355-company roster the other walkers use; and it wrote to D1 exactly once, at
the end, so when the job timeout stopped it at company 100 the 519 posts it had
already collected were discarded. It now walks the roster (see load_companies)
and flushes every FLUSH_ROWS, so an interrupted run costs the tail, not the run.

Env: OXYLABS_USERNAME, OXYLABS_PASSWORD, CLOUDFLARE_API_TOKEN.
Usage:
  python3 scripts/linkedin-posts-to-d1.py [--limit N] [--only bhp,rio] [--dry-run]
  python3 scripts/linkedin-posts-to-d1.py --all      # one-off: the full 1,503
"""
from __future__ import annotations
import argparse
import datetime as dt
import html as htmllib
import importlib.util
import json
import os
import re
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = importlib.util.spec_from_file_location('oxy', os.path.join(HERE, 'oxylabs_client.py'))
oxy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oxy)

ACCOUNT = '080a66721e2d85950d9d7dc939e08b76'
DATABASE = '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DATABASE}/query'

PAGE = 'https://www.linkedin.com/company/{slug}/'
TAG = re.compile(r'<[^>]+>')
WS = re.compile(r'\s+')

# LinkedIn snowflake: the low 22 bits are a sequence, the rest are epoch ms.
ACTIVITY_EPOCH_SHIFT = 22


def text_of(fragment: str) -> str:
    return WS.sub(' ', htmllib.unescape(TAG.sub(' ', fragment or ''))).strip()


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def posted_at(activity_id: str) -> str:
    """Absolute publish time from the activity id. '' when it doesn't decode."""
    try:
        ms = int(activity_id) >> ACTIVITY_EPOCH_SHIFT
    except (TypeError, ValueError):
        return ''
    # Sanity-bound it: a snowflake from the wrong field would land in 1970 or
    # the far future, and a bad date is worse than no date.
    if not (1_400_000_000_000 <= ms <= 4_000_000_000_000):
        return ''
    return dt.datetime.utcfromtimestamp(ms / 1000).replace(microsecond=0).isoformat() + 'Z'


def slug_candidates(name: str, domain: str) -> list[str]:
    """Plausible LinkedIn vanity slugs, most likely first.

    Only ever used to LOOK; whatever is fetched is then checked against the
    company name before anything is stored.
    """
    out: list[str] = []
    d = (domain or '').strip().lower()
    if d:
        host = d.split('/')[0].replace('www.', '')
        base = host.split('.')[0]
        if base:
            out.append(base)
    n = norm(name)
    if n:
        out.append(n.replace(' ', '-'))
        out.append(n.replace(' ', ''))
    seen, uniq = set(), []
    for s in out:
        s = re.sub(r'[^a-z0-9-]', '', s)
        if s and s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq[:3]


def parse_posts(html: str) -> tuple[str, list[dict]]:
    """(actor name, posts) from a company landing page."""
    actor = ''
    m = re.search(r'aria-label="View organization page for ([^"]+)"', html)
    if m:
        actor = htmllib.unescape(m.group(1)).strip()

    posts: list[dict] = []
    # Each card starts at its activity urn; slice to the next one so text and
    # images cannot bleed across cards.
    marks = [mm.start() for mm in re.finditer(r'data-activity-urn="urn:li:activity:\d+"', html)]
    for i, start in enumerate(marks):
        end = marks[i + 1] if i + 1 < len(marks) else min(len(html), start + 20000)
        card = html[start:end]
        aid = re.search(r'data-activity-urn="urn:li:activity:(\d+)"', card)
        if not aid:
            continue
        activity = aid.group(1)

        body = ''
        bm = re.search(r'main-feed-activity-card__commentary[^>]*>(.*?)</p>', card, re.S)
        if bm:
            body = text_of(bm.group(1))
        if not body:
            continue  # a card with no words is a reshare stub, not a post

        # The permalink appears just BEFORE the card (it wraps it), so look back.
        link = ''
        lm = re.search(r'href="(https://[a-z.]*linkedin\.com/posts/[^"?]+)',
                       html[max(0, start - 1200):start])
        if lm:
            link = lm.group(1)
        if not link:
            link = f'https://www.linkedin.com/feed/update/urn:li:activity:{activity}/'

        image = ''
        im = re.search(r'data-delayed-url="(https://media\.licdn\.com/[^"]+)"', card)
        if im:
            u = htmllib.unescape(im.group(1))
            # The actor's own logo appears on every card; it is not post media.
            if 'company-logo' not in u:
                image = u

        posts.append({
            'activity': activity,
            'body': body,
            'url': link,
            'image': image,
            'posted': posted_at(activity),
        })
    return actor, posts


def d1(sql: str, params: list):
    token = os.environ.get('CLOUDFLARE_API_TOKEN')
    if not token:
        sys.exit('Set CLOUDFLARE_API_TOKEN.')
    req = urllib.request.Request(
        API, data=json.dumps({'sql': sql, 'params': params}).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=45) as r:
        j = json.loads(r.read().decode())
    if not j.get('success'):
        raise RuntimeError(str(j.get('errors'))[:300])
    return j['result']


def load_companies(everything: bool = False) -> list[dict]:
    """The companies to walk, WITH their domains.

    dump-companies.ts returns all 1,503 COMPANIES — every government agency
    included — and walking that at ~25 seconds a company is a ten-hour job
    against a one-hour budget, which is why this feed never finished. The other
    roster walkers use scripts/roster.py's 355 instead.

    Switching loaders outright would have made resolution WORSE, though:
    load_roster() carries no `domain`, and the domain is slug_candidates' first
    and best guess (bhp.com -> /bhp). So the dump is kept for its domains and
    filtered down to the roster's ids — measured, all 355 are present in the
    dump and all 355 carry a domain, so nothing is lost but the agencies.

    `everything=True` restores the full 1,503 for a one-off backfill."""
    p = subprocess.run(['npx', 'tsx', os.path.join(HERE, 'dump-companies.ts')],
                       capture_output=True, timeout=300, cwd=ROOT)
    if p.returncode != 0:
        sys.exit('dump-companies.ts failed:\n' + p.stderr.decode()[-800:])
    full = json.loads(p.stdout.decode().strip().splitlines()[-1])
    if everything:
        return full
    from roster import load_roster
    keep = {c['id'] for c in load_roster()}
    return [c for c in full if c['id'] in keep]


# A post's first line is its headline on the card. LinkedIn posts have no title
# field, so one is DERIVED rather than invented: the first sentence, trimmed.
def headline(body: str, limit: int = 120) -> str:
    first = re.split(r'(?<=[.!?])\s|\n', body.strip())[0].strip()
    if len(first) <= limit:
        return first
    cut = first[:limit].rsplit(' ', 1)[0]
    return cut + '…'


DDL = '''CREATE TABLE IF NOT EXISTS company_posts (
           post_key   TEXT PRIMARY KEY,
           company_id TEXT NOT NULL,
           author     TEXT,
           title      TEXT NOT NULL,
           body       TEXT,
           url        TEXT NOT NULL,
           image      TEXT,
           posted     TEXT NOT NULL,
           first_seen TEXT NOT NULL,
           last_seen  TEXT NOT NULL)'''
IDX = ('CREATE INDEX IF NOT EXISTS idx_company_posts_co '
       'ON company_posts (company_id, posted DESC)')

# Roughly 25 companies' worth of posts (measured ~10 stored posts a company), so
# the walk banks progress about every ten minutes rather than only at the end.
FLUSH_ROWS = 250


def ensure_table() -> None:
    d1(DDL, [])
    d1(IDX, [])


def write_rows(rows: list[tuple]) -> int:
    """Insert a batch and return how many rows went in. Safe to call repeatedly:
    the table is append-only and self-deduping."""
    today = dt.date.today().isoformat()
    written = 0
    for i in range(0, len(rows), 8):
        chunk = rows[i:i + 8]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?)'] * len(chunk))
        params: list = []
        for r in chunk:
            params.extend([*r, today, today])
        # Append-only and self-deduping, the same contract the jobs table uses:
        # a post seen again refreshes last_seen and nothing else, so an edited
        # headline never rewrites what we first recorded.
        d1(f'''INSERT INTO company_posts
                 (post_key, company_id, author, title, body, url, image, posted,
                  first_seen, last_seen)
               VALUES {values}
               ON CONFLICT(post_key) DO UPDATE SET last_seen = excluded.last_seen''', params)
        written += len(chunk)
    return written


def write_sql(rows: list[tuple], path: str) -> None:
    today = dt.date.today().isoformat()

    def lit(v):
        return 'NULL' if v is None or v == '' else "'" + str(v).replace("'", "''") + "'"

    out = [DDL + ';', IDX + ';']
    for r in rows:
        vals = ','.join(lit(x) for x in [*r, today, today])
        out.append(
            'INSERT INTO company_posts (post_key, company_id, author, title, body, '
            'url, image, posted, first_seen, last_seen) VALUES (' + vals + ') '
            'ON CONFLICT(post_key) DO UPDATE SET last_seen = excluded.last_seen;')
    open(path, 'w').write('\n'.join(out) + '\n')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--only', default='')
    ap.add_argument('--dry-run', action='store_true')
    # Walk all 1,503 COMPANIES instead of the 355 the roster defines. Kept as an
    # escape hatch, not a default — see load_companies() for why.
    ap.add_argument('--all', action='store_true')
    # The Cloudflare D1 HTTP API is reset by the dev sandbox's proxy (see
    # CLAUDE.md). In GitHub Actions the HTTP path works, same as every other
    # *-to-d1.py; locally, emit the statements and apply them with
    # `npx wrangler d1 execute employsi-jobs-archive --remote --file=...`.
    ap.add_argument('--sql-out', default='')
    a = ap.parse_args()

    companies = load_companies(everything=a.all)
    if a.only:
        want = {x.strip().lower() for x in a.only.split(',') if x.strip()}
        companies = [c for c in companies if c['id'].lower() in want]
    if a.limit:
        companies = companies[:a.limit]

    sys.stderr.write(f'{len(companies)} companies to try\n')
    rows, resolved, unresolved = [], [], []
    # Rows already sent to D1, so the end-of-run total is the real total rather
    # than whatever happens to be left in the buffer.
    banked = 0
    live = not (a.dry_run or a.sql_out)
    if live:
        ensure_table()

    for i, c in enumerate(companies, 1):
        got = None
        for slug in slug_candidates(c['name'], c.get('domain') or ''):
            try:
                body = oxy.fetch(PAGE.format(slug=slug))
            except Exception as e:  # noqa: BLE001
                sys.stderr.write(f'  {c["id"]}/{slug}: {str(e)[:80]}\n')
                continue
            if isinstance(body, tuple):
                body = body[0]
            actor, posts = parse_posts(body or '')
            if not posts:
                continue
            # ATTRIBUTION GATE — see the module docstring. One name must contain
            # the other, on normalised tokens, or this is somebody else's page.
            an, cn = norm(actor), norm(c['name'])
            if not an or not cn or not (an in cn or cn in an):
                sys.stderr.write(f'  {c["id"]}: /{slug} is "{actor}" — not {c["name"]}, skipped\n')
                continue
            got = (slug, actor, posts)
            break

        if not got:
            unresolved.append(c['id'])
            continue
        slug, actor, posts = got
        resolved.append((c['id'], slug))
        for p in posts:
            if not p['posted']:
                continue  # no trustworthy date -> not stored
            rows.append((
                f'li:{p["activity"]}', c['id'], actor, headline(p['body']), p['body'][:2000],
                p['url'], p['image'], p['posted'],
            ))
        # BANK PROGRESS AS IT IS EARNED. This walk is long enough that it used to
        # be killed by the job timeout before reaching the write at the bottom,
        # and because that write was the only one, every post collected was
        # thrown away — measured 2026-08-04: 519 posts from 54 companies
        # discarded when the run was stopped at company 100. Flushing here means
        # an interrupted run costs the tail, not the whole thing.
        if live and len(rows) >= FLUSH_ROWS:
            banked += write_rows(rows)
            rows = []
        if i % 10 == 0 or i == len(companies):
            sys.stderr.write(f'  [{i}/{len(companies)}] posts={banked + len(rows)} '
                             f'resolved={len(resolved)} unresolved={len(unresolved)}\n')

    sys.stderr.write(f'\n{banked + len(rows)} posts from {len(resolved)} companies; '
                     f'{len(unresolved)} unresolved\n')
    if a.dry_run:
        for r in rows[:8]:
            sys.stderr.write(f'  {r[1]:14s} {r[7][:10]}  {r[3][:70]}\n')
        return 0
    if not (banked + len(rows)):
        sys.stderr.write('nothing to write — leaving the table alone\n')
        return 1

    if a.sql_out:
        write_sql(rows, a.sql_out)
        sys.stderr.write(f'wrote {len(rows)} statements to {a.sql_out}\n')
        return 0 if resolved else 2

    if rows:
        banked += write_rows(rows)
    sys.stderr.write(f'wrote {banked} rows\n')
    if unresolved:
        sys.stderr.write('unresolved: ' + ', '.join(unresolved[:25]) + '\n')
    # A run that resolved nothing is a broken run, not an empty market.
    return 0 if resolved else 2


if __name__ == '__main__':
    raise SystemExit(main())
