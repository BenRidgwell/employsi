#!/usr/bin/env python3
"""
Which roster companies have stopped trading?

WHY THIS EXISTS
An acquired company does not leave the roster on its own. It keeps its card, its
headcount, its open-roles figure and its map pin, and simply stops being real —
every number on it now describes a business that no longer exists. De Grey
Mining sat on the Perth map for months after Northern Star bought it in 2025,
showing a 280-person headcount and 52 open roles, and was caught only because
its logo happened to break. Nothing else would have found it: the scrapers write
no rows for a company with no board, and "no rows" is indistinguishable from
"not hiring".

THE SIGNAL
stockanalysis.com — the source scripts/gen-headcount.py already uses — DELETES
the quote page for a delisted non-US listing and KEEPS a marked-up page for a
delisted US one. Both are checked, because either alone misses half the world:

    404                     the listing is gone         (ASX, LSE, HKEX, …)
    200 + "was delisted"    page kept, marked inactive  (NYSE, NASDAQ)

Validated against known outcomes before being trusted, because a check that has
never flagged anything is not a check (scripts/check-listings.py --controls):

    DEG  404  De Grey -> Northern Star, 2025     caught
    OZL  404  OZ Minerals -> BHP, 2023           caught
    NCM  404  Newcrest -> Newmont, 2023          caught
    CSR  404  CSR -> Saint-Gobain, 2024          caught
    TWTR 200  Twitter -> taken private, 2022     caught by the marker
    AZJ  200  Aurizon, still listed              not flagged
    NEC  200  Nine Entertainment, still listed   not flagged

WHICH VENUE TO ASK ABOUT
Most roster tickers record their exchange, but 49 do not. Defaulting those to
ASX would be a fabrication — Chevron's CVX resolves to a real, unrelated
Australian listing — so instead the venue is INFERRED from the city the company
is plotted on, and the US path is tried as well. That is what rescues Chevron:
it sits on the Perth map, so /quote/asx/CVX/ 404s and /stocks/cvx/ answers.

A company is called DELISTED only when EVERY candidate venue says so. Where no
venue can be formed, or the host cannot be reached, the answer is UNVERIFIED
rather than delisted: reporting a company as gone because we did not know where
to look is the failure this is meant to prevent, not a version of it.

WHY PYTHON, when the roster is TypeScript
The roster is read by running the TypeScript (scripts/listings-roster.ts through
bun), the way scripts/roster.py and seek-to-d1.py already do. The HTTP is done
here because that is what works from every environment this repo runs in.

Run:  python scripts/check-listings.py [--city perth] [--only id1,id2]
                                       [--limit N] [--controls]
Exit: 1 if anything is delisted, 0 otherwise. UNVERIFIED never fails the run.
"""
from __future__ import annotations
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/17.4.1 Safari/605.1.15')
BASE = 'https://stockanalysis.com'

# stockanalysis.com's own path segment per exchange. Every one measured against
# a known-live listing on that venue (2026-08-08) rather than guessed — the
# codes are not the exchanges' own: NZX is "nze", JPX is "tyo", HKEX is "hkg",
# SIX is "swx", SSE is "sha".
VENUE = {
    'ASX': 'asx', 'LSE': 'lon', 'NZX': 'nze', 'HKEX': 'hkg', 'JPX': 'tyo',
    'KRX': 'krx', 'NSE': 'nse', 'EPA': 'epa', 'JSE': 'jse', 'SGX': 'sgx',
    'TSX': 'tsx', 'SIX': 'swx', 'SSE': 'sha', 'ADX': 'adx', 'DFM': 'dfm',
}
US_EXCHANGES = {'NYSE', 'NASDAQ', 'AMEX'}  # these use /stocks/<ticker>/, not /quote/

# City a company is plotted on -> the venue its ticker most likely trades on.
# Only consulted when the roster records no exchange, and never alone: the US
# path is always tried too, so a US listing plotted on an Australian city still
# resolves.
CITY_VENUE = {
    'perth': 'asx', 'sydney': 'asx', 'melbourne': 'asx', 'brisbane': 'asx',
    'adelaide': 'asx', 'canberra': 'asx', 'darwin': 'asx', 'hobart': 'asx',
    'auckland': 'nze', 'wellington': 'nze', 'london': 'lon', 'hongkong': 'hkg',
    'tokyo': 'tyo', 'seoul': 'krx', 'paris': 'epa', 'zurich': 'swx',
    'johannesburg': 'jse', 'singapore': 'sgx', 'toronto': 'tsx',
    'shanghai': 'sha', 'mumbai': 'nse', 'bengaluru': 'nse', 'dubai': 'dfm',
}

# What the site prints on a page it has KEPT for a listing that has stopped
# trading. Matched against visible text only: the page's embedded JSON carries
# "delisted" as a field name on every stock, live ones included.
DELISTED = re.compile(r'\bwas delisted\b|\bInactive\b\s*[·|]|\bhas been delisted\b'
                      r'|\bno longer trades\b|\bdelisted after\b', re.I)
# The page prints the date it stopped trading beside the marker. Worth pulling
# out: "delisted" is the finding, but WHEN is what tells you how long the roster
# has been describing a company that no longer exists.
LAST_TRADE = re.compile(r'Last trade price on ([A-Z][a-z]{2} \d{1,2},? \d{4})')

args = sys.argv[1:]


def opt(flag, default=None):
    return args[args.index(flag) + 1] if flag in args else default


ONLY_CITY = opt('--city')
ONLY_IDS = set(opt('--only').split(',')) if '--only' in args else None
LIMIT = int(opt('--limit', 10 ** 9))
CONTROLS = '--controls' in args


def load_roster() -> list[dict]:
    """Every company with a ticker, read by RUNNING the TypeScript.

    No regex fallback, for scripts/roster.py's reason: a short roster that looks
    like a successful run is the failure mode this whole script exists to catch.
    """
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'listings-roster.ts')],
                           capture_output=True, timeout=180, cwd=ROOT)
    except FileNotFoundError as e:
        raise RuntimeError('bun is required to read the roster. https://bun.sh') from e
    if p.returncode != 0:
        raise RuntimeError(f'roster dump failed: {p.stderr.decode()[:300]}')
    rows = json.loads(p.stdout.decode())
    if not rows:
        raise RuntimeError('roster dump was empty')
    return rows


def candidates(ticker: str, exchange: str, city: str) -> list[str]:
    urls: list[str] = []

    def push(u):
        if u not in urls:
            urls.append(u)

    t = ticker.strip()
    if exchange in US_EXCHANGES:
        push(f'{BASE}/stocks/{t.lower()}/')
    elif exchange in VENUE:
        push(f'{BASE}/quote/{VENUE[exchange]}/{t}/')
    elif not exchange:
        if CITY_VENUE.get(city):
            push(f'{BASE}/quote/{CITY_VENUE[city]}/{t}/')
        push(f'{BASE}/stocks/{t.lower()}/')
    return urls


def look(url: str) -> tuple[int, bool, str]:
    """(status, page says it has stopped trading, last trade date if printed)."""
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                body = r.read().decode('utf-8', 'replace')
                text = re.sub(r'<script[\s\S]*?</script>', ' ', body, flags=re.I)
                # Whitespace collapsed before matching: stripping tags leaves
                # newlines and runs of spaces where the markup was, and the
                # date phrase spans several elements.
                text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', text))
                last = LAST_TRADE.search(text)
                return r.status, bool(DELISTED.search(text)), (last.group(1) if last else '')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, True, ''
            time.sleep(1.5 * (attempt + 1))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return 0, False, ''


def check(row: dict) -> dict:
    urls = candidates(row['ticker'], row['exchange'], row.get('city', ''))
    if not urls:
        row['verdict'] = 'UNVERIFIED'
        row['detail'] = (f"no path for exchange {row['exchange']}" if row['exchange']
                         else 'no exchange recorded and no venue for its city')
        return row
    seen = []
    for url in urls:
        status, dead, last = look(url)
        seen.append(f"{url.replace(BASE, '')} {status}")
        if status == 0:
            row['verdict'] = 'UNVERIFIED'
            row['detail'] = 'host unreachable: ' + ', '.join(seen)
            return row
        if status == 200 and not dead:
            row['verdict'] = 'LISTED'
            row['detail'] = seen[-1]
            return row
        if status == 200 and dead:
            row['verdict'] = 'DELISTED'
            row['detail'] = (f'last traded {last} — ' if last else 'marked inactive — ') + seen[-1]
            return row
    row['verdict'] = 'DELISTED'
    row['detail'] = 'no listing at ' + ', '.join(seen)
    return row


CONTROL_ROWS = [
    {'id': 'ctl-deg', 'name': 'De Grey Mining (acquired 2025)', 'ticker': 'DEG', 'exchange': 'ASX', 'city': ''},
    {'id': 'ctl-ozl', 'name': 'OZ Minerals (acquired 2023)', 'ticker': 'OZL', 'exchange': 'ASX', 'city': ''},
    {'id': 'ctl-ncm', 'name': 'Newcrest (acquired 2023)', 'ticker': 'NCM', 'exchange': 'ASX', 'city': ''},
    {'id': 'ctl-csr', 'name': 'CSR (acquired 2024)', 'ticker': 'CSR', 'exchange': 'ASX', 'city': ''},
    {'id': 'ctl-twtr', 'name': 'Twitter (taken private 2022)', 'ticker': 'TWTR', 'exchange': 'NYSE', 'city': ''},
    {'id': 'ctl-azj', 'name': 'Aurizon (still listed)', 'ticker': 'AZJ', 'exchange': 'ASX', 'city': ''},
    {'id': 'ctl-nec', 'name': 'Nine Entertainment (still listed)', 'ticker': 'NEC', 'exchange': 'ASX', 'city': ''},
]
CONTROL_EXPECT = {'ctl-deg': 'DELISTED', 'ctl-ozl': 'DELISTED', 'ctl-ncm': 'DELISTED',
                  'ctl-csr': 'DELISTED', 'ctl-twtr': 'DELISTED',
                  'ctl-azj': 'LISTED', 'ctl-nec': 'LISTED'}


def run(rows: list[dict], workers: int = 4) -> list[dict]:
    done: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        for i, r in enumerate(ex.map(check, rows)):
            done.append(r)
            if (i + 1) % 25 == 0:
                sys.stderr.write(f'  {i + 1}/{len(rows)}\n')
    return done


def main() -> int:
    if CONTROLS:
        # Prove the check can still fail before believing a clean run.
        print('Controls — known outcomes, to show the check still discriminates\n')
        bad = 0
        for r in run(CONTROL_ROWS, workers=3):
            want = CONTROL_EXPECT[r['id']]
            ok = r['verdict'] == want
            bad += not ok
            print(f"  {'ok  ' if ok else 'FAIL'}  {r['ticker']:<6} {r['name'][:36]:<37} "
                  f"{r['verdict']:<11} {r['detail'][:52]}")
        print(f"\n{len(CONTROL_ROWS) - bad}/{len(CONTROL_ROWS)} controls behaved as expected")
        return 1 if bad else 0

    rows = load_roster()
    if ONLY_CITY:
        rows = [r for r in rows if r.get('city') == ONLY_CITY]
    if ONLY_IDS:
        rows = [r for r in rows if r['id'] in ONLY_IDS]
    rows = rows[:LIMIT]
    where = f' on {ONLY_CITY}' if ONLY_CITY else ''
    print(f'Checking {len(rows)} listed companies{where} against stockanalysis.com\n')

    done = run(rows)
    pick = lambda v: sorted([r for r in done if r['verdict'] == v], key=lambda r: r['name'])  # noqa: E731
    delisted, unverified = pick('DELISTED'), pick('UNVERIFIED')

    if delisted:
        print('DELISTED — the roster is describing a company that has stopped trading:')
        for r in delisted:
            print(f"  {r['ticker']:<8} {r['name'][:38]:<39} {r['id']:<28} {r['detail'][:60]}")
        print()
    if unverified:
        print(f'Could not verify ({len(unverified)}) — NOT a finding, just unchecked:')
        for r in unverified[:20]:
            print(f"  {r['ticker']:<8} {r['name'][:38]:<39} {r['detail'][:60]}")
        if len(unverified) > 20:
            print(f'  …and {len(unverified) - 20} more')
        print()
    print(f"{len(pick('LISTED'))} listed · {len(delisted)} delisted · {len(unverified)} unverified")
    return 1 if delisted else 0


if __name__ == '__main__':
    raise SystemExit(main())
