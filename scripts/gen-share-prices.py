#!/usr/bin/env python3
"""Real monthly share prices per ticker -> src/employsi/data/sharePrices.ts

WHY THIS EXISTS
data/finance.ts carried eight QUARTERLY points per company. Three of them were
real reference figures (52-week low, 52-week high, last close) and the path
between them was, in the file's own words, illustrative; every ticker outside
that hand-written list of thirteen got a series derived from a hash of its own
symbol. That is fine as a sparkline and unusable as data — it cannot be
correlated with anything, it cannot be re-derived, and the anchors go stale
silently (BHP's hand-entered 52-week low read 37.74 against an actual 39.18,
and its last close 56.87 against 60.31, when this was first run).

This replaces all of it with a real monthly series: Yahoo Finance's chart API,
`interval=1mo`, which returns open/high/low/close/volume plus a split- and
dividend-adjusted close per calendar month.

WHY OXYLABS
Yahoo's edge returns 429 to this repo's egress IPs — both directly and from
GitHub Actions runners. Same reason SEEK, Indeed and Jora go through Oxylabs
(see workers/jobs-cron/ARCHIVE.md); this joins them rather than inventing a
second mechanism.

WHAT IS STORED, AND WHAT IS NOT
Only the ADJUSTED CLOSE, monthly, on a shared month axis. The full OHLC is
fetched and validated but not written out: nothing in the app plots an intraday
range, and eleven data files already show what happens to a repo when a
generator writes more than its consumers read. Adjusted rather than raw close
because a series spanning a split is otherwise a chart of the split.

THE CURRENT MONTH IS DROPPED. Yahoo returns an in-progress bar whose "close" is
the live price, so including it makes the last point mean something different
from every other point — it moves during the day and is not a month's close.
A partial month is not a data point.

Usage:
  OXYLABS_USERNAME=... OXYLABS_PASSWORD=... python3 scripts/gen-share-prices.py \
      [--exchanges ASX,NZX,SGX,HKEX,NYSE,NASDAQ] [--years 5] [--limit N] [--dry-run]

Re-runnable and idempotent: it rewrites the whole file from whatever it fetched
plus whatever the existing file already held, so a partial run adds coverage
rather than destroying it.
"""
from __future__ import annotations
import argparse
import datetime as dt
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'src/employsi/data/sharePrices.ts')

_spec = importlib.util.spec_from_file_location('oxy', os.path.join(HERE, 'oxylabs_client.py'))
oxy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oxy)

# ── exchange -> Yahoo symbol suffix ──────────────────────────────────────────
# Yahoo identifies a listing as SYMBOL.SUFFIX, with US listings unsuffixed.
# Every mapping here was confirmed against a live quote for one of our own
# tickers on that exchange before being added; an exchange absent from this map
# is SKIPPED rather than guessed at, because a wrong suffix does not error — it
# silently resolves to a different company's listing on another market.
SUFFIX = {
    'ASX': '.AX',      # BHP.AX
    'NZX': '.NZ',      # AIA.NZ
    'SGX': '.SI',      # D05.SI
    'HKEX': '.HK',     # 0005.HK
    'JPX': '.T',       # 7203.T
    'LSE': '.L',       # SHEL.L
    'TSX': '.TO',      # RY.TO
    'NSE': '.NS',      # TCS.NS
    'SZSE': '.SZ',
    'SSE': '.SS',
    'SIX': '.SW',      # NESN.SW
    'EPA': '.PA',      # AI.PA
    'KRX': '.KS',      # 005930.KS
    'JSE': '.JO',      # NPN.JO
    'NASDAQ': '',
    'NYSE': '',
}
# Deliberately unmapped: DFM and ADX (Yahoo's Gulf coverage is patchy and the
# suffix differs per listing), "Private" (no listing exists), and blank (the
# roster records a symbol but not where it trades, so there is nothing to
# resolve it against). Each is reported at the end rather than passed over.

CHART = ('https://query1.finance.yahoo.com/v8/finance/chart/{sym}'
         '?interval=1mo&range={years}y')


def load_companies() -> list[dict]:
    """Ticker + exchange as the APP sees them, via scripts/dump-tickers.ts.

    COMPANIES is assembled at runtime from several roster files, so TypeScript
    is the only correct reading of "which tickers does the app have". Regexing
    companies.ts saw 50 of 1,413 and gave all of them the ASX default — which
    would have fetched CVX.AX for Chevron.
    """
    import subprocess
    p = subprocess.run(['npx', 'tsx', os.path.join(HERE, 'dump-tickers.ts')],
                       capture_output=True, timeout=300, cwd=ROOT)
    if p.returncode != 0:
        sys.exit('dump-tickers.ts failed:\n' + p.stderr.decode()[-800:])
    return json.loads(p.stdout.decode().strip().splitlines()[-1])


def yahoo_symbol(ticker: str, exchange: str) -> str | None:
    if exchange not in SUFFIX:
        return None
    sfx = SUFFIX[exchange]
    t = ticker.strip().upper()
    # Asian exchanges quote numeric codes zero-padded to four digits; the roster
    # stores them unpadded ("5" for HSBC's 0005.HK), which Yahoo does not match.
    if exchange == 'HKEX' and t.isdigit():
        t = t.zfill(4)
    if exchange == 'KRX' and t.isdigit():
        t = t.zfill(6)
    return t + sfx


def month_of(epoch: int, tz_offset: int) -> str:
    """The exchange-local calendar month a bar belongs to."""
    d = dt.datetime.utcfromtimestamp(epoch + (tz_offset or 0))
    return f'{d.year:04d}-{d.month:02d}'


def fetch_series(sym: str, years: int) -> tuple[list[tuple[str, float]], str]:
    """(months, adjusted closes) oldest first, plus the quoted currency."""
    body = oxy.fetch(CHART.format(sym=sym, years=years))
    if isinstance(body, tuple):
        body = body[0]
    try:
        j = json.loads(body)
    except Exception:
        return [], ''
    res = ((j.get('chart') or {}).get('result') or [None])[0]
    if not res:
        return [], ''
    meta = res.get('meta') or {}
    stamps = res.get('timestamp') or []
    adj = (((res.get('indicators') or {}).get('adjclose') or [{}])[0] or {}).get('adjclose') or []
    quote = (((res.get('indicators') or {}).get('quote') or [{}])[0] or {})
    closes = quote.get('close') or []
    tz = meta.get('gmtoffset') or 0

    # This month's bar is still open — see the module docstring.
    this_month = month_of(int(dt.datetime.now(dt.timezone.utc).timestamp()), tz)

    rows: list[tuple[str, float]] = []
    for i, ts in enumerate(stamps):
        v = None
        if i < len(adj) and isinstance(adj[i], (int, float)):
            v = adj[i]
        elif i < len(closes) and isinstance(closes[i], (int, float)):
            v = closes[i]
        if v is None or v <= 0:
            continue
        mo = month_of(int(ts), tz)
        if mo >= this_month:
            continue
        rows.append((mo, round(float(v), 4)))

    # Yahoo occasionally repeats a month across the boundary; keep the last.
    dedup: dict[str, float] = {}
    for mo, v in rows:
        dedup[mo] = v
    rows = sorted(dedup.items())
    return rows, str(meta.get('currency') or '')


def read_existing() -> dict:
    """Parse the previous output so a partial run adds rather than replaces."""
    if not os.path.exists(OUT):
        return {}
    txt = open(OUT).read()
    m = re.search(r'export const SHARE_PRICES[^=]*=\s*(\{.*?\});', txt, re.S)
    if not m:
        return {}
    # The emitted object ends every line with a comma, including the last, which
    # is valid TypeScript and invalid JSON. Without stripping it this parse threw,
    # read_existing returned {} and EVERY RUN SILENTLY DISCARDED the coverage
    # before it — a scoped run replaced the file instead of adding to it.
    try:
        return json.loads(re.sub(r',(\s*})', r'\1', m.group(1)))
    except Exception:
        return {}


def write_ts(series: dict, months: list[str], meta: dict) -> None:
    today = dt.date.today().isoformat()
    lines = [
        '// GENERATED — do not edit by hand. Run scripts/gen-share-prices.py.',
        '//',
        '// Real monthly share prices: Yahoo Finance chart API (interval=1mo),',
        '// split- and dividend-ADJUSTED close, one point per completed calendar',
        f'// month. Fetched {today}.',
        '//',
        '// This replaced the eight illustrative quarterly points per company that',
        '// data/finance.ts used to carry (three real anchors, an invented path',
        '// between them, and a hash-derived series for every other ticker).',
        '//',
        '// The in-progress current month is NOT included: its "close" is the live',
        '// price, which would make the last point mean something different from',
        '// every other point on the line.',
        '',
        '/** Month axis, oldest first, shared by every series below. */',
        'export const SHARE_MONTHS: string[] = ' + json.dumps(months) + ';',
        '',
        '/** Currency each listing is quoted in, keyed "TICKER|EXCHANGE". */',
        'export const SHARE_CURRENCY: Record<string, string> = {',
    ]
    for t in sorted(meta):
        lines.append(f'  {json.dumps(t)}: {json.dumps(meta[t])},')
    lines += [
        '};',
        '',
        '/**',
        ' * Ticker -> adjusted close per month, index-aligned with SHARE_MONTHS.',
        ' *',
        ' * `null` marks a month the listing did not trade in (it had not floated',
        ' * yet, or was suspended). Callers must skip nulls rather than treating',
        ' * them as zero — a gap is not a price of nothing.',
        ' */',
        'export const SHARE_PRICES: Record<string, (number | null)[]> = {',
    ]
    for t in sorted(series):
        row = series[t]
        lines.append(f'  {json.dumps(t)}: [' + ','.join('null' if v is None else str(v) for v in row) + '],')
    lines += ['};', '']
    with open(OUT, 'w') as f:
        f.write('\n'.join(lines))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--exchanges', default='',
                    help='comma-separated exchange filter; default = every mapped exchange')
    ap.add_argument('--years', type=int, default=5)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true')
    # Treat a blank exchange as ASX. companies.ts documents ASX as the roster
    # default and the Australian core (BHP, RIO, FMG, S32, WDS…) all carry no
    # exchange, so without this the listings the app most needs are the ones it
    # never fetches. Opt-in rather than automatic, because the same blank also
    # appears on private companies whose "ticker" is an abbreviation and which
    # have no listing at all — those simply fail to resolve and are reported.
    ap.add_argument('--assume-asx', action='store_true')
    # Restrict to one roster group, e.g. the only group whose card draws a
    # share chart.
    ap.add_argument('--group', default='')
    # Explicit symbols, e.g. --only BHP,RIO,S32. `group` is derived downstream
    # (buildPanel), NOT stored on the roster row, so --group silently excluded
    # every flagship Australian miner on the first attempt. This is the reliable
    # way to name a set.
    ap.add_argument('--only', default='')
    a = ap.parse_args()

    want = {x.strip().upper() for x in a.exchanges.split(',') if x.strip()}
    only = {x.strip().upper() for x in a.only.split(',') if x.strip()}
    companies = load_companies()

    targets, skipped = [], {}
    for c in companies:
        ex = c['exchange'] or ('ASX' if a.assume_asx else '')
        c['exchange'] = ex
        sym = yahoo_symbol(c['ticker'], ex) if ex else None
        if not sym:
            skipped.setdefault(c['exchange'] or '(no exchange)', 0)
            skipped[c['exchange'] or '(no exchange)'] += 1
            continue
        if want and c['exchange'] not in want:
            continue
        if a.group and (c.get('group') or '') != a.group:
            continue
        if only and c['ticker'].upper() not in only:
            continue
        targets.append((f"{c['ticker']}|{ex}", sym))
    if a.limit:
        targets = targets[:a.limit]

    sys.stderr.write(f'{len(companies)} tickers in the roster, {len(targets)} to fetch\n')
    for ex, n in sorted(skipped.items(), key=lambda kv: -kv[1]):
        sys.stderr.write(f'  skipped {n:4d} on {ex} (no verified Yahoo suffix)\n')
    if a.dry_run:
        for t, s in targets[:20]:
            sys.stderr.write(f'  {t} -> {s}\n')
        return 0

    fetched: dict[str, list[tuple[str, float]]] = {}
    currency: dict[str, str] = {}
    failed: list[str] = []
    for i, (rowkey, sym) in enumerate(targets, 1):
        try:
            rows, cur = fetch_series(sym, a.years)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f'  [{i}/{len(targets)}] {sym}: {str(e)[:90]}\n')
            failed.append(sym)
            continue
        # A listing with almost no history is not worth a line on a chart, and
        # is usually a symbol that resolved to the wrong thing.
        if len(rows) < 12:
            sys.stderr.write(f'  [{i}/{len(targets)}] {sym}: only {len(rows)} months — skipped\n')
            failed.append(sym)
            continue
        fetched[rowkey] = rows
        if cur:
            currency[rowkey] = cur
        if i % 25 == 0 or i == len(targets):
            sys.stderr.write(f'  [{i}/{len(targets)}] ok={len(fetched)} failed={len(failed)}\n')

    if not fetched:
        sys.stderr.write('nothing fetched — not touching the output file\n')
        return 1

    # Merge with whatever the file already had, on a union month axis, so a run
    # scoped to one exchange does not wipe the others.
    prev = read_existing()
    prev_months: list[str] = []
    if os.path.exists(OUT):
        m = re.search(r'export const SHARE_MONTHS[^=]*=\s*(\[[^\]]*\]);', open(OUT).read())
        if m:
            try:
                prev_months = json.loads(m.group(1))
            except Exception:
                prev_months = []

    months = sorted({mo for rows in fetched.values() for mo, _ in rows} | set(prev_months))
    idx = {mo: i for i, mo in enumerate(months)}

    series: dict[str, list] = {}
    for t, old in prev.items():
        row: list = [None] * len(months)
        for i, mo in enumerate(prev_months):
            if i < len(old) and old[i] is not None:
                row[idx[mo]] = old[i]
        series[t] = row
    for t, rows in fetched.items():
        row: list = [None] * len(months)
        for mo, v in rows:
            row[idx[mo]] = v
        series[t] = row  # a fresh fetch always wins over the stored copy

    prev_cur = {}
    if os.path.exists(OUT):
        m = re.search(r'export const SHARE_CURRENCY[^=]*=\s*\{(.*?)\};', open(OUT).read(), re.S)
        if m:
            for km in re.finditer(r'"([^"]+)":\s*"([^"]*)"', m.group(1)):
                prev_cur[km.group(1)] = km.group(2)
    prev_cur.update(currency)

    write_ts(series, months, prev_cur)
    sys.stderr.write(
        f'\nwrote {OUT}\n  {len(series)} tickers, {len(months)} months '
        f'({months[0]} .. {months[-1]})\n  fetched now: {len(fetched)}, failed: {len(failed)}\n')
    if failed:
        sys.stderr.write('  failed symbols: ' + ', '.join(failed[:30]) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
