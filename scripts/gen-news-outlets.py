#!/usr/bin/env python3
"""Regenerate src/employsi/data/newsOutletFeeds.ts from plenaryapp/awesome-rss-feeds.

WHAT THIS IS FOR
The "in the news" card already pulls a shared pool of recent articles from three
hand-picked outlets (mining.com, Business News WA, Bloomberg markets) and keeps
the ones whose headline names the company. That pool is the highest-quality part
of the card — real images, links straight to the publisher, no Bing proxy — and
it is three feeds covering one country and one industry. This widens it to the
national press of every country on the roster, plus a business-and-economy pool
that applies everywhere.

    https://github.com/plenaryapp/awesome-rss-feeds

WHY EVERY FEED IS FETCHED BEFORE IT IS WRITTEN
A curated list is a snapshot of when someone curated it. Publishers move feeds,
drop them, or park them behind Cloudflare, and a dead entry in this file costs a
request on every pool refresh and returns nothing — invisibly, because the pool
is best-effort and swallows its own failures. So nothing is written that did not,
at generation time, answer with a parseable feed containing at least one item.
The run reports what it dropped and why.

Freshness is checked too, not just parseability. A feed whose newest item is
years old still parses perfectly and will never contribute an article about
anything current; it is recorded with its age so a stale one can be seen rather
than assumed live.

WHAT IS DELIBERATELY EXCLUDED
  * YouTube feeds (youtube.com/feeds/videos.xml). The list carries several under
    business headings — "Bloomberg Originals" and friends — and they are video
    channels. The card shows headlines and links to articles; a video entry is
    not that, and would be indistinguishable in the UI from one that is.
  * PODCASTS, detected from the feed body rather than the title: an <itunes:*>
    namespace or an <enclosure type="audio/*">. The Business & Economy list is
    half podcasts — EconTalk, Planet Money, HBR IdeaCast, How I Built This — and
    an episode rendered as a news item is a headline the reader cannot read,
    about a company it probably only mentions in passing.
  * Anything already in OUTLET_FEEDS, so the hand-picked three are not fetched
    twice under two names.

COUNTRY COVERAGE IS PARTIAL AND THE FILE SAYS SO
The upstream list carries 24 countries. Ten of them are on our roster; seven
roster countries have no entry at all (New Zealand, UAE, Switzerland, South
Korea, China, Singapore, Malaysia), which is about 249 plotted companies whose
national press this cannot reach. That is written into the generated file rather
than left for someone to infer from a missing key.

Run:  python3 scripts/gen-news-outlets.py [--limit-per-country N]
Then: npx eslint src/employsi/data/newsOutletFeeds.ts --fix
"""
from __future__ import annotations
import concurrent.futures as cf
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'src/employsi/data/newsOutletFeeds.ts')
RAW = 'https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/master'
UA = 'employsi/1.0 (labour-market map; RSS pool builder)'

args = sys.argv[1:]
LIMIT = int(args[args.index('--limit-per-country') + 1]) if '--limit-per-country' in args else 40

# Upstream country name -> the country key the app uses. Only the roster's
# countries are pulled; the rest of the list is real but would be dead weight in
# the bundle and in the request budget.
COUNTRIES = {
    'Australia': 'au',
    'Canada': 'ca',
    'France': 'fr',
    'Hong Kong SAR China': 'hk',
    'India': 'in',
    'Japan': 'jp',
    'Philippines': 'ph',
    'South Africa': 'za',
    'United Kingdom': 'gb',
    'United States': 'us',
}
# Roster countries the upstream list does not cover, named in the output so the
# gap is visible rather than implied by an absent key.
UNCOVERED = ['New Zealand', 'United Arab Emirates', 'Switzerland', 'South Korea',
             'China', 'Singapore', 'Malaysia']

# Already in liveNewsFn's OUTLET_FEEDS; skipped so one outlet cannot enter the
# pool twice under two publisher names.
ALREADY = {
    'https://www.mining.com/feed/',
    'https://www.businessnews.com.au/rssfeed/latest.rss',
    'https://feeds.bloomberg.com/markets/news.rss',
}


# A browser User-Agent, tried second, because newspapers often refuse a
# non-browser agent on their own public RSS. MEASURED: it recovered nothing.
# The Independent, CNBC, The Indian Express, Moneycontrol, Asahi Shimbun and the
# News Corp Australia mastheads answered 403 to both agents, so on those the
# refusal is about the ADDRESS this runs from, not the agent it claims to be.
# Kept because it is one cheap retry and the next host to be blocked may well be
# blocked on the agent instead.
BROWSER_UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
              '(KHTML, like Gecko) Version/17.4.1 Safari/605.1.15')


def get(url: str, timeout: int = 30, ua: str = UA) -> bytes:
    req = urllib.request.Request(url, headers={
        'User-Agent': ua,
        'Accept': 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_either(url: str, timeout: int = 25) -> tuple[str, str]:
    """(body, why-it-failed). Tries the honest agent, then a browser one."""
    last = ''
    for ua in (UA, BROWSER_UA):
        try:
            return get(url, timeout=timeout, ua=ua).decode('utf-8', 'replace'), ''
        except Exception as e:  # noqa: BLE001
            last = f'{type(e).__name__}: {str(e)[:60]}'
    return '', last


def opml_feeds(path: str) -> list[tuple[str, str]]:
    """[(title, xmlUrl)] from an OPML file, outer category outline ignored."""
    try:
        body = get(f'{RAW}/{urllib.parse.quote(path)}', timeout=45).decode('utf-8', 'replace')
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  could not read {path}: {str(e)[:90]}\n')
        return []
    out = []
    for m in re.finditer(r'<outline\b([^>]*)/>', body):
        attrs = m.group(1)
        url = re.search(r'xmlUrl="([^"]+)"', attrs)
        title = re.search(r'title="([^"]*)"', attrs) or re.search(r'text="([^"]*)"', attrs)
        if url:
            out.append((html.unescape(title.group(1)) if title else '', html.unescape(url.group(1))))
    return out


ITEM_RE = re.compile(r'<(item|entry)[\s>]', re.I)
DATE_RE = re.compile(r'<(?:pubDate|published|updated|dc:date)[^>]*>([^<]+)<', re.I)


def parse_date(s: str) -> dt.datetime | None:
    s = s.strip()
    for fmt in ('%a, %d %b %Y %H:%M:%S %z', '%a, %d %b %Y %H:%M:%S %Z',
                '%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%d %H:%M:%S',
                '%Y-%m-%dT%H:%M:%S.%f%z', '%Y-%m-%d'):
        try:
            d = dt.datetime.strptime(s.replace('GMT', '+0000'), fmt)
            return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
    return None


def check(entry: tuple[str, str]) -> dict:
    """Does this feed answer, parse, and carry anything recent?"""
    title, url = entry
    res = {'title': title, 'url': url, 'ok': False, 'why': '', 'items': 0, 'age_days': None}
    if 'youtube.com/feeds' in url:
        res['why'] = 'YouTube channel, not an article feed'
        return res
    if url in ALREADY:
        res['why'] = 'already in OUTLET_FEEDS'
        return res
    body, why = get_either(url)
    if not body:
        res['why'] = why
        return res
    items = len(ITEM_RE.findall(body))
    if not items:
        res['why'] = 'no <item>/<entry> in the response'
        return res
    if re.search(r'<itunes:|<enclosure[^>]+type="audio/', body, re.I):
        res['why'] = 'podcast feed, not an article feed'
        return res
    res['items'] = items
    dates = [d for d in (parse_date(x) for x in DATE_RE.findall(body)[:40]) if d]
    if dates:
        newest = max(dates)
        res['age_days'] = (dt.datetime.now(dt.timezone.utc) - newest).days
        # ABANDONED, not merely quiet. A feed whose newest item is over a year
        # old parses perfectly and will never contribute an article about
        # anything current — it is a request per refresh spent on a guaranteed
        # miss. Measured on the first run: WSJ World News 558 days, an Oneindia
        # feed 1,296, a US one 1,208.
        if res['age_days'] > 365:
            res['why'] = f'nothing published in {res["age_days"]} days'
            return res
    res['ok'] = True
    return res


def publisher_of(title: str, url: str) -> str:
    """A short, human publisher name for the card's byline.

    The OPML titles are feed titles, not mastheads — "Latest News and News
    Headlines | Daily Telegraph", "The Age - Latest News" — so the tail after a
    separator is preferred when there is one, and the host is the fallback. The
    card shows this string next to a headline, so it has to read like a
    newspaper rather than like a feed.
    """
    t = title.strip()
    for sep in (' | ', ' - ', ' – '):
        if sep in t:
            parts = [p.strip() for p in t.split(sep) if p.strip()]
            # "X | Daily Telegraph" -> the masthead is the longer-lived tail;
            # "The Age - Latest News" -> it is the head. Prefer whichever does
            # not look like a generic feed label.
            generic = re.compile(r'latest|news headlines|headlines|breaking|rss|feed|top stories', re.I)
            named = [p for p in parts if not generic.fullmatch(p.strip()) and not generic.search(p)]
            if named:
                t = max(named, key=len)
                break
    # A generic feed label is not a masthead. "All News" (investing.com) and
    # "Business" tell a reader nothing about who published the story, and the
    # byline is the whole reason the pool is preferred over Bing's proxies — so
    # those fall back to the host, which at least names the publisher.
    if not t or len(t) > 42 or re.fullmatch(
            r'(all )?news|business|latest|top stories|headlines|home|rss|feed', t, re.I):
        host = urllib.parse.urlsplit(url).hostname or ''
        t = host.replace('www.', '')
    return t


def main() -> int:
    jobs: list[tuple[str, str, str]] = []  # (bucket, title, url)
    for name, code in COUNTRIES.items():
        feeds = opml_feeds(f'countries/with_category/{name}.opml')
        if not feeds:
            feeds = opml_feeds(f'countries/without_category/{name}.opml')
        sys.stderr.write(f'{name}: {len(feeds)} listed\n')
        for t, u in feeds[:LIMIT]:
            jobs.append((code, t, u))
    biz = opml_feeds('recommended/with_category/Business & Economy.opml')
    sys.stderr.write(f'Business & Economy: {len(biz)} listed\n')
    for t, u in biz:
        jobs.append(('business', t, u))

    seen: set[str] = set()
    uniq = []
    for bucket, t, u in jobs:
        if u in seen:
            continue
        seen.add(u)
        uniq.append((bucket, t, u))
    sys.stderr.write(f'\nchecking {len(uniq)} distinct feeds...\n')

    results: dict[str, list[dict]] = {}
    dropped: list[str] = []
    refused: list[dict] = []
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(check, (t, u)): (bucket, t, u) for bucket, t, u in uniq}
        for i, f in enumerate(cf.as_completed(futs), 1):
            bucket, t, u = futs[f]
            r = f.result()
            if r['ok']:
                results.setdefault(bucket, []).append(
                    {'url': u, 'publisher': publisher_of(t, u), 'age_days': r['age_days']})
            elif re.search(r'HTTP Error (40[35]|429|5\d\d)', r['why']):
                # REFUSED THIS HOST, which is not the same as dead. These
                # answered a 403/405/429/5xx to both agents from a datacentre
                # address; a Cloudflare Worker asks from somewhere else and may
                # well be served. Recorded rather than dropped, so the
                # information is not lost and a later probe can retest them
                # from where the app actually runs. NOT used by the app.
                refused.append({'bucket': bucket, 'url': u,
                                'publisher': publisher_of(t, u), 'why': r['why']})
            else:
                dropped.append(f'{bucket} · {publisher_of(t, u)} · {r["why"]}')
            if i % 25 == 0:
                sys.stderr.write(f'  {i}/{len(uniq)}\n')

    total = sum(len(v) for v in results.values())
    stale = [f'{b}:{f["publisher"]} ({f["age_days"]}d)'
             for b, v in results.items() for f in v
             if f['age_days'] is not None and f['age_days'] > 120]

    L = ['// GENERATED — do not edit by hand. Run scripts/gen-news-outlets.py.',
         '// Source: github.com/plenaryapp/awesome-rss-feeds (country lists + the',
         '// Business & Economy recommended list), filtered to the roster\'s countries.',
         '//',
         '// These widen the shared article pool the "in the news" card already uses:',
         '// recent articles are fetched from the outlets for a company\'s OWN country',
         '// plus the business pool, and kept when the headline names the company.',
         '//',
         '// EVERY FEED HERE ANSWERED AND PARSED AT GENERATION TIME, with at least one',
         '// item. A curated list is a snapshot of when it was curated, and a dead entry',
         '// costs a request per refresh and returns nothing — invisibly, because the',
         '// pool swallows its own failures. Feeds that failed were dropped, not carried.',
         '//',
         '// COVERAGE IS PARTIAL. The upstream list has no feeds for these roster',
         f'// countries: {", ".join(UNCOVERED)}.',
         '// Companies plotted there fall back to Bing and the hand-picked outlets, as',
         '// they did before this file existed.',
         '',
         'export interface OutletFeed {',
         '  url: string;',
         '  publisher: string;',
         '}',
         '',
         '/** Country code → national outlets. "business" is global, used everywhere. */',
         'export const NEWS_OUTLETS: Record<string, OutletFeed[]> = {']
    for bucket in sorted(results):
        L.append(f'  {json.dumps(bucket)}: [')
        for f in sorted(results[bucket], key=lambda x: x['publisher'].lower()):
            L.append(f'    {{ url: {json.dumps(f["url"])}, '
                     f'publisher: {json.dumps(f["publisher"])} }},')
        L.append('  ],')
    L.append('};')
    L.append('')
    L.append('/** Roster countries the upstream list does not cover. */')
    L.append('export const OUTLETS_UNCOVERED: string[] = ' + json.dumps(UNCOVERED) + ';')
    L.append('')
    L.append('/**')
    L.append(' * Feeds that REFUSED THE GENERATOR\'S ADDRESS (403/405/429/5xx), which is not')
    L.append(' * the same as being dead. These were checked from a datacentre host; the app')
    L.append(' * asks from a Cloudflare Worker, which may be served. They are NOT used —')
    L.append(' * they are kept so the finding is not lost and can be retested from where the')
    L.append(' * app actually runs, rather than being silently re-dropped by every rerun.')
    L.append(' */')
    L.append('export const OUTLETS_REFUSED_FROM_GENERATOR: OutletFeed[] = [')
    for f in sorted(refused, key=lambda x: (x['bucket'], x['publisher'].lower())):
        L.append(f'  {{ url: {json.dumps(f["url"])}, '
                 f'publisher: {json.dumps(f["publisher"])} }}, // {f["bucket"]}: {f["why"][:40]}')
    L.append('];')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))

    print(f'{total} feeds verified live across {len(results)} buckets -> {OUT}')
    for b in sorted(results):
        print(f'  {b}: {len(results[b])}')
    print(f'\n{len(refused)} refused this host (recorded, not used):')
    for f in sorted(refused, key=lambda x: (x['bucket'], x['publisher'].lower())):
        print(f'  {f["bucket"]} · {f["publisher"]} · {f["why"][:40]}')
    print(f'\n{len(dropped)} dropped as dead:')
    for d in sorted(dropped):
        print(f'  {d}')
    if stale:
        print(f'\n{len(stale)} parse but have published nothing in 120+ days:')
        for s in sorted(stale):
            print(f'  {s}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
