#!/usr/bin/env python3
"""
Generate src/employsi/data/fxRates.ts — foreign currency → AUD, for normalising
advertised salaries onto one scale.

WHY A GENERATED FILE AND NOT A LIVE LOOKUP
The ticker's pay figure is a labour-market measurement, and a number that moves
because the dollar moved is not one. Pinning the rates makes the figure change
only when hiring changes, keeps the app's read path free of a network
dependency that can fail mid-render, and puts the exact rates used under review
in git. The cost is that they go stale, which is why the capture date is part of
the generated file and is surfaced to the reader.

A few percent of FX drift is immaterial to a figure the ticker prints rounded to
the nearest thousand — a 3% move on a $120k median is $3.6k, inside the rounding
most readers apply anyway. Re-run this when that stops being true:

    python3 scripts/gen-fx-rates.py

SOURCE
open.er-api.com (exchangerate-api.com's free endpoint, no key). It publishes
`rates` as 1 AUD → N foreign, so each is inverted here: the app only ever needs
foreign → AUD.

Only the currencies the archive actually advertises in are written out. Adding a
market means adding its currency here and to CURRENCY_BY_COUNTRY in
src/employsi/lib/salaryParse.ts.
"""
from __future__ import annotations
import datetime
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'employsi', 'data', 'fxRates.ts')
API = 'https://open.er-api.com/v6/latest/AUD'

# The currencies the archive's salary strings and hubs actually produce. Keep in
# step with CURRENCY_BY_COUNTRY in lib/salaryParse.ts.
WANTED = [
    'USD', 'GBP', 'EUR', 'CAD', 'NZD', 'SGD', 'MYR', 'PHP', 'CNY', 'HKD',
    'INR', 'JPY', 'KRW', 'AED', 'SAR', 'QAR', 'THB', 'IDR', 'CHF', 'ZAR',
]


def main() -> int:
    req = urllib.request.Request(API, headers={'User-Agent': 'employsi-fx/1.0'})
    with urllib.request.urlopen(req, timeout=45) as r:
        data = json.loads(r.read().decode())
    if data.get('result') != 'success':
        sys.exit(f'FX API returned {data.get("result")!r}')
    rates = data.get('rates') or {}
    missing = [c for c in WANTED if c not in rates]
    if missing:
        sys.exit(f'FX API did not quote: {", ".join(missing)}')
    # The API gives 1 AUD -> N foreign. The app wants foreign -> AUD.
    to_aud = {c: 1.0 / float(rates[c]) for c in WANTED}
    as_at = datetime.datetime.utcfromtimestamp(
        int(data.get('time_last_update_unix') or 0)).date().isoformat()

    lines = [
        '// GENERATED — do not edit by hand. Run: python3 scripts/gen-fx-rates.py',
        '//',
        '// Foreign currency → AUD, used to put every advertised salary on one',
        '// scale (see lib/salaryParse). Pinned rather than fetched live so the',
        '// ticker moves when hiring moves and not when the dollar does; the',
        '// capture date below is what the app shows readers.',
        f'export const FX_AS_AT = "{as_at}";',
        '',
        'export const FX_TO_AUD: Record<string, number> = {',
        '  AUD: 1,',
    ]
    for c in WANTED:
        lines.append(f'  {c}: {to_aud[c]:.6f},')
    lines.append('};')
    lines.append('')
    with open(OUT, 'w') as f:
        f.write('\n'.join(lines))
    sys.stderr.write(f'wrote {OUT} — {len(WANTED)} currencies, rates as at {as_at}\n')
    for c in ('USD', 'GBP', 'SGD', 'CNY', 'PHP'):
        sys.stderr.write(f'  1 {c} = {to_aud[c]:.4f} AUD\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
