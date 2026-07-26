#!/usr/bin/env python3
"""Fetch real, source-attributed facts for the Top-150 private companies and write
src/employsi/data/privateCompanyFacts.ts.

The private companies are the one roster with no market feed behind it: they file
no ASX accounts, so stockanalysis.com (which powers COMPANY_HEADCOUNT for the
listed names) has nothing for them. Their card currently shows an estimated
headcount derived from revenue, which is why panel.ts correctly reports
headcountReal=false and suppresses the workforce chart.

This pipeline collects what IS genuinely public, and records WHERE each number
came from so the UI can be honest about it:

  • glassdoorRating  — the employer's Glassdoor overall rating (out of 5).
                       A real, attributable figure. Fetched through Oxylabs
                       because Glassdoor 403s datacenter IPs.
  • employeeBand     — Glassdoor's self-reported company-size BAND
                       (e.g. "1001 to 5000 Employees"). This is a BAND, not an
                       audited headcount, so it is stored separately and is NOT
                       promoted to a real headcount: a band cannot produce a
                       year-on-year percentage, and inventing one would be
                       fabrication. It is shown as context only.

What this deliberately does NOT do: derive a headcount YoY. That requires two
years of audited figures from each company's annual report. Most of these 150 are
proprietary companies whose reports are not machine-readable (or not published),
so there is no honest way to automate it at scale — those stay "not disclosed"
until real figures are supplied.

Env: OXYLABS_USERNAME, OXYLABS_PASSWORD.
Usage: python3 scripts/fetch-private-facts.py [--limit N]
"""
from __future__ import annotations
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
try:
    import oxylabs_client as oxy
except ImportError as e:
    sys.exit(f'Missing helper module ({e}).')

PRIV = f'{ROOT}/src/employsi/data/topPrivateCompanies.ts'
OUT = f'{ROOT}/src/employsi/data/privateCompanyFacts.ts'

args = sys.argv[1:]
LIMIT = int(args[args.index('--limit') + 1]) if '--limit' in args else 10 ** 9


def private_companies() -> list[tuple[str, str]]:
    """[(id, name)] for every Top-150 private company."""
    txt = open(PRIV).read()
    raw = re.search(r'const RAW: Raw\[\] = \[(.*?)\n\];', txt, re.S).group(1)
    out = []
    for m in re.finditer(r"\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*'[^']+'\s*,\s*[\d.]+", raw):
        name = m.group(1).replace("\\'", "'")
        slug = re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', name.lower()))
        out.append((f'pvt-{slug}', name))
    return out


def glassdoor(name: str):
    """Return (rating, band) from the employer's Glassdoor overview, or (None, None)."""
    q = re.sub(r'\s+', '-', name.strip())
    url = ('https://www.glassdoor.com.au/Search/results.htm?keyword='
           + re.sub(r'\s+', '%20', name.strip()))
    content, status = oxy.fetch(url, geo='Australia', render=True)
    if not content:
        return None, None, f'status={status}'
    # Rating appears as a bare 1-5 number next to the employer name in several
    # markups; prefer an explicit ratingValue when present (schema.org).
    rating = None
    m = (re.search(r'"ratingValue"\s*:\s*"?([0-5](?:\.\d)?)"?', content)
         or re.search(r'"overallRating"\s*:\s*([0-5](?:\.\d)?)', content))
    if m:
        try:
            v = float(m.group(1))
            rating = v if 0 < v <= 5 else None
        except ValueError:
            rating = None
    band = None
    b = re.search(r'([\d,]+\s*(?:to|-)\s*[\d,]+|\d[\d,]*\+)\s*Employees', content, re.I)
    if b:
        band = re.sub(r'\s+', ' ', b.group(0)).strip()
    return rating, band, 'ok'


def main() -> int:
    if not (os.environ.get('OXYLABS_USERNAME') and os.environ.get('OXYLABS_PASSWORD')):
        sys.exit('OXYLABS_USERNAME / OXYLABS_PASSWORD required (Web Scraper API).')
    companies = private_companies()[:LIMIT]
    sys.stderr.write(f'Fetching Glassdoor facts for {len(companies)} private companies…\n')

    facts: dict[str, dict] = {}
    misses = []
    for i, (cid, name) in enumerate(companies, 1):
        rating, band, why = glassdoor(name)
        if rating or band:
            rec = {}
            if rating:
                rec['glassdoorRating'] = rating
            if band:
                rec['employeeBand'] = band
            facts[cid] = rec
            sys.stderr.write(f'  [{i:3}/{len(companies)}] {name[:38]:38} rating={rating} band={band}\n')
        else:
            misses.append(name)
            sys.stderr.write(f'  [{i:3}/{len(companies)}] {name[:38]:38} no data ({why})\n')

    L = ['// GENERATED — do not edit by hand. Run scripts/fetch-private-facts.py.',
         '// Source-attributed public facts for the Top-150 private companies.',
         '//',
         '// glassdoorRating is the employer\'s real Glassdoor overall rating (out of 5).',
         '// employeeBand is Glassdoor\'s self-reported company-size BAND — deliberately',
         '// NOT treated as a headcount: a band cannot yield a year-on-year figure, and',
         '// these companies file no public accounts, so an audited headcount/YoY is not',
         '// automatable for them. Anything absent stays "not disclosed" on the card',
         '// rather than being estimated.',
         '',
         'export interface PrivateFacts {',
         '  glassdoorRating?: number;',
         '  employeeBand?: string;',
         '}',
         '',
         'export const PRIVATE_COMPANY_FACTS: Record<string, PrivateFacts> = {']
    for cid in sorted(facts):
        L.append(f'  {json.dumps(cid)}: {json.dumps(facts[cid])},')
    L.append('};')
    open(OUT, 'w').write('\n'.join(L) + '\n')

    sys.stderr.write(f'\nWrote facts for {len(facts)}/{len(companies)} companies -> {OUT}\n')
    if misses:
        sys.stderr.write(f'No public data found for {len(misses)} (left "not disclosed"):\n')
        for n in misses[:20]:
            sys.stderr.write(f'  · {n}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
