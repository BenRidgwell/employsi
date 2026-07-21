#!/usr/bin/env python3
"""
seek-company-scraper — every open SEEK listing for a *company*, across regions.

Repurposed from qinscode/SeekSpider (https://github.com/qinscode/SeekSpider),
which crawls seek.com.au for *IT* jobs by iterating the Information &
Communication Technology classification and its sub-classifications. This tool
keeps that project's core discovery — SEEK's undocumented but public search API
at `/api/jobsearch/v5/search` — but repurposes it two ways:

  1. COMPANY-LEVEL, ALL JOB TYPES. Instead of filtering by `classification`
     (IT), it filters by `advertiserid` — a single employer — and applies no
     classification filter, so it returns that company's *entire* live board:
     mining roles, HR, finance, trades, apprenticeships, everything.

  2. ALL SUPPORTED REGIONS. It runs across every SEEK country site (AU + NZ)
     and, within a site, either the whole country in one pass or a named city
     (see regions.py). Each job already carries its own location, so you get
     per-region breakdown for free.

Because advertiser IDs are per-site and not public, the tool first RESOLVES a
company name to its advertiser id(s) on each site (a keyword search, then a
match on the advertiser's own name), then scrapes every listing under those
ids. Pass `--advertiser-id` to skip resolution if you already know it.

    python seek_company_scraper.py "Fortescue"                 # AU, all regions
    python seek_company_scraper.py "Fortescue" --site nz       # NZ instead
    python seek_company_scraper.py "Fortescue" --all-sites     # AU + NZ
    python seek_company_scraper.py "BHP" --region Perth        # scope to a city
    python seek_company_scraper.py "" --advertiser-id 61981911 # skip resolution
    python seek_company_scraper.py "Woodside" --list-advertisers  # just resolve

Output: prints a summary and writes CSV (--out, default seek_<company>.csv) and,
with --json, a JSON file alongside it. No database, no Scrapy, no AI — a single
stdlib + requests script, matching the other standalone tools in tools/.

IMPORTANT — where to run it. SEEK's terms prohibit automated access, and SEEK
fronts the site with Cloudflare that blocks many datacenter/CI IP ranges (the
search API may answer, but detail pages and sustained traffic get challenged).
Run this politely, from a residential IP, for your own analysis — not from the
app's Cloudflare Workers. It is deliberately a manual tool, like
tools/google-jobs-scraper.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from urllib.parse import urlencode

import requests

from regions import (
    DEFAULT_SITE,
    get_all_sites,
    get_regions,
    get_site,
    get_where,
    is_valid_region,
)

UA = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/605.1.15 (KHTML, like Gecko) '
    'Version/17.4.1 Safari/605.1.15'
)
PAGE_SIZE = 100  # SEEK caps the API page; 100 is accepted and keeps calls low.
REQUEST_PAUSE = 1.2  # be polite between requests
MAX_PAGES = 40  # safety cap (~4,000 jobs per region) — no single employer hits this


def _api_url(site_cfg: dict) -> str:
    return f"https://{site_cfg['host']}/api/jobsearch/v5/search"


def _norm(name: str) -> str:
    """Loose company-name key for matching advertiser descriptions."""
    s = name.lower()
    s = re.sub(r'\b(pty|ltd|limited|inc|group|holdings|australia|au|nz)\b', '', s)
    s = re.sub(r'[^a-z0-9]+', '', s)
    return s


def _get(session: requests.Session, url: str, params: dict, tries: int = 4) -> dict:
    """GET the search API with polite retry/backoff. Returns parsed JSON or {}."""
    qs = urlencode(params)
    full = f'{url}?{qs}'
    delay = 2.0
    for attempt in range(1, tries + 1):
        try:
            r = session.get(full, headers={'User-Agent': UA}, timeout=30)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (403, 429, 503):
                # Cloudflare / rate-limit — back off and retry.
                sys.stderr.write(
                    f'  [{r.status_code}] throttled (attempt {attempt}/{tries}), '
                    f'waiting {delay:.0f}s\n'
                )
            else:
                sys.stderr.write(f'  [{r.status_code}] unexpected response\n')
                return {}
        except (requests.RequestException, ValueError) as e:
            sys.stderr.write(f'  request error (attempt {attempt}/{tries}): {e}\n')
        if attempt < tries:
            time.sleep(delay)
            delay *= 2
    return {}


def resolve_advertisers(
    session: requests.Session, site: str, company: str, limit: int = PAGE_SIZE
) -> list[dict]:
    """
    Find the advertiser id(s) matching a company name on a site.

    Runs a keyword search for the name, tallies the distinct advertisers that
    come back, and keeps those whose own description matches the query name
    (exact-normalised first; substring as a fallback). Returns a list of
    {id, description, hits} sorted by hits desc.
    """
    site_cfg = get_site(site)
    params = {
        'siteKey': site_cfg['site_key'],
        'sourcesystem': 'houston',
        'where': site_cfg['all'],
        'keywords': company,
        'page': 1,
        'pageSize': limit,
        'locale': site_cfg['locale'],
    }
    data = _get(session, _api_url(site_cfg), params)
    counts: dict[str, dict] = {}
    for job in data.get('data', []):
        adv = job.get('advertiser') or {}
        aid = str(adv.get('id') or '')
        desc = adv.get('description') or job.get('companyName') or ''
        if not aid:
            continue
        row = counts.setdefault(aid, {'id': aid, 'description': desc, 'hits': 0})
        row['hits'] += 1

    want = _norm(company)
    exact = [r for r in counts.values() if _norm(r['description']) == want]
    if exact:
        matches = exact
    else:
        matches = [
            r for r in counts.values()
            if want and (want in _norm(r['description']) or _norm(r['description']) in want)
        ]
    matches.sort(key=lambda r: r['hits'], reverse=True)
    return matches


def scrape_advertiser(
    session: requests.Session, site: str, advertiser_id: str, where: str
) -> list[dict]:
    """Page through every listing for one advertiser id within a `where` scope."""
    site_cfg = get_site(site)
    url = _api_url(site_cfg)
    out: list[dict] = []
    page = 1
    total_pages = 1
    while page <= total_pages and page <= MAX_PAGES:
        params = {
            'siteKey': site_cfg['site_key'],
            'sourcesystem': 'houston',
            'where': where,
            'advertiserid': advertiser_id,
            'page': page,
            'pageSize': PAGE_SIZE,
            'locale': site_cfg['locale'],
        }
        data = _get(session, url, params)
        jobs = data.get('data', [])
        if page == 1:
            total = int(data.get('totalCount', 0) or 0)
            per = int(data.get('solMetadata', {}).get('pageSize', PAGE_SIZE) or PAGE_SIZE)
            total_pages = max(1, (total + per - 1) // per)
            sys.stderr.write(
                f'    advertiser {advertiser_id} @ "{where}": '
                f'{total} jobs, {total_pages} page(s)\n'
            )
        for j in jobs:
            out.append(_parse_job(j, site))
        if not jobs:
            break
        page += 1
        time.sleep(REQUEST_PAUSE)
    return out


def _parse_job(j: dict, site: str) -> dict:
    """Flatten one SEEK API job object into a flat record (all classifications)."""
    adv = j.get('advertiser') or {}
    cls = (j.get('classifications') or [{}])[0]
    classification = (cls.get('classification') or {}).get('description', '')
    subclassification = (cls.get('subclassification') or {}).get('description', '')
    locs = j.get('locations') or [{}]
    location = locs[0].get('label', '')
    # Derive a broad region label from the location hierarchy when present.
    hierarchy = locs[0].get('seoHierarchy') or []
    region = hierarchy[-1]['contextualName'] if hierarchy else location
    work_types = j.get('workTypes') or []
    site_cfg = get_site(site)
    job_id = str(j.get('id', ''))
    return {
        'job_id': job_id,
        'title': j.get('title', ''),
        'company': j.get('companyName') or adv.get('description', ''),
        'advertiser_id': str(adv.get('id', '')),
        'classification': classification,
        'subclassification': subclassification,
        'work_type': work_types[0] if work_types else '',
        'salary': j.get('salaryLabel', ''),
        'location': location,
        'region': region,
        'site': site,
        'posted_date': j.get('listingDate', ''),
        'url': f"https://{site_cfg['host']}/job/{job_id}",
    }


FIELDS = [
    'job_id', 'title', 'company', 'advertiser_id', 'classification',
    'subclassification', 'work_type', 'salary', 'location', 'region',
    'site', 'posted_date', 'url',
]


def write_csv(rows: list[dict], path: str) -> None:
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def _summarise(rows: list[dict]) -> None:
    if not rows:
        sys.stderr.write('No listings found.\n')
        return
    from collections import Counter
    by_class = Counter(r['classification'] or '(unlabelled)' for r in rows)
    by_region = Counter(r['region'] or '(unknown)' for r in rows)
    sys.stderr.write(f'\n{len(rows)} listing(s) total.\n')
    sys.stderr.write('  By classification:\n')
    for name, n in by_class.most_common():
        sys.stderr.write(f'    {n:4d}  {name}\n')
    sys.stderr.write('  By region:\n')
    for name, n in by_region.most_common(15):
        sys.stderr.write(f'    {n:4d}  {name}\n')


def main() -> int:
    ap = argparse.ArgumentParser(
        description='Scrape every SEEK listing for a company across regions.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument('company', help='Company name to resolve (or "" with --advertiser-id).')
    ap.add_argument('--site', default=DEFAULT_SITE,
                    help=f'SEEK site: {", ".join(get_all_sites())} (default {DEFAULT_SITE}).')
    ap.add_argument('--all-sites', action='store_true',
                    help='Scrape every supported site (AU + NZ).')
    ap.add_argument('--region', default=None,
                    help='Scope to one named region/city (default: whole country).')
    ap.add_argument('--advertiser-id', default=None,
                    help='Skip name resolution and scrape this advertiser id directly '
                         '(implies a single --site).')
    ap.add_argument('--list-advertisers', action='store_true',
                    help='Only resolve + print matching advertisers, do not scrape.')
    ap.add_argument('--out', default=None, help='CSV output path.')
    ap.add_argument('--json', action='store_true', help='Also write a .json file.')
    args = ap.parse_args()

    sites = get_all_sites() if args.all_sites else [args.site]
    session = requests.Session()
    all_rows: list[dict] = []
    seen: set[tuple[str, str]] = set()  # (site, job_id) dedupe

    for site in sites:
        if site not in get_all_sites():
            sys.stderr.write(f'Unknown site "{site}", skipping.\n')
            continue
        if args.region and not is_valid_region(site, args.region):
            valid = ', '.join(get_regions(site).keys())
            sys.stderr.write(
                f'Region "{args.region}" not valid for {site}. Options: {valid}\n'
            )
            continue
        where = get_where(site, args.region)

        # Resolve advertiser ids for this site.
        if args.advertiser_id:
            advertisers = [{'id': args.advertiser_id, 'description': args.company or '(given id)', 'hits': 0}]
        else:
            sys.stderr.write(f'[{site}] resolving "{args.company}"...\n')
            advertisers = resolve_advertisers(session, site, args.company)
            if not advertisers:
                sys.stderr.write(f'  no advertiser matched "{args.company}" on {site}.\n')
                continue
            for a in advertisers:
                sys.stderr.write(f'  matched id={a["id"]} "{a["description"]}" ({a["hits"]} kw-hits)\n')

        if args.list_advertisers:
            continue

        for a in advertisers:
            rows = scrape_advertiser(session, site, a['id'], where)
            for r in rows:
                key = (r['site'], r['job_id'])
                if key in seen:
                    continue
                seen.add(key)
                all_rows.append(r)

    if args.list_advertisers:
        return 0

    _summarise(all_rows)
    if not all_rows:
        return 1

    safe = re.sub(r'[^A-Za-z0-9]+', '_', args.company or args.advertiser_id or 'seek').strip('_').lower()
    out = args.out or f'seek_{safe}.csv'
    write_csv(all_rows, out)
    sys.stderr.write(f'\nWrote {len(all_rows)} rows -> {out}\n')
    if args.json:
        jpath = out.rsplit('.', 1)[0] + '.json'
        with open(jpath, 'w', encoding='utf-8') as f:
            json.dump(all_rows, f, indent=2, ensure_ascii=False)
        sys.stderr.write(f'Wrote JSON        -> {jpath}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
