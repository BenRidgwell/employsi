#!/usr/bin/env python3
"""
LinkedIn company job scraper — the LinkedIn counterpart of the Indeed / Zhaopin
tools. LinkedIn exposes a lightweight, *guest* (no-login) jobs search endpoint
that returns server-rendered HTML job cards:

    https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
        ?keywords=<company>&location=<place>&start=<n>

Each request returns up to 25 <li> cards (title, company, location, posted date,
canonical /jobs/view/ URL). No JavaScript is needed to read it — but LinkedIn
hard-blocks datacenter IPs (HTTP 429 / auth-wall), so in practice we fetch it
through the Oxylabs Web Scraper API (residential IP), exactly like Indeed. This
module only builds the URLs and parses the returned HTML; scripts/linkedin-to-d1
does the fetching, skill-mapping and D1 archival.

Fields returned per job: {title, company, location, url, date}.
"""
from __future__ import annotations
import html as _html
import re
from urllib.parse import quote

GUEST_SEARCH = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'
PER_PAGE = 25  # cards per guest-API page (start advances in 25s)

# Oxylabs geo_location per LinkedIn location filter, so the residential exit node
# sits in-country (LinkedIn tailors/permits results by requester geo).
GEO_FOR = {
    'Australia': 'Australia', 'United States': 'United States',
    'United Kingdom': 'United Kingdom', 'Canada': 'Canada',
    'New Zealand': 'New Zealand', 'Singapore': 'Singapore',
    'Hong Kong': 'Hong Kong', 'India': 'India',
}


def search_url(company: str, location: str, start: int) -> str:
    """Guest jobs-search URL for a company name within a location, paged by
    `start` (a multiple of PER_PAGE). Sorted newest-first (sortBy=DD)."""
    url = f'{GUEST_SEARCH}?keywords={quote(company)}&start={start}&sortBy=DD'
    if location:
        url += f'&location={quote(location)}'
    return url


def _clean(x: str) -> str:
    return _html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', x or ''))).strip()


def _field(card: str, pattern: str) -> str:
    m = re.search(pattern, card, re.S | re.I)
    return _clean(m.group(1)) if m else ''


def parse_search_html(html: str) -> list:
    """Parse a guest-API results fragment (a run of <li> job cards, as returned
    by Oxylabs) into job dicts. Defensive to LinkedIn's periodic class renames:
    falls back to broader anchors when the primary class isn't present."""
    if not html:
        return []
    # Each result is one <li> … </li>; the fragment is just a list of them.
    cards = re.findall(r'<li[^>]*>(.*?)</li>', html, re.S | re.I)
    if not cards:
        # Some responses wrap cards in <div class="base-card"> instead of <li>.
        cards = re.findall(r'<div[^>]*class="[^"]*base-card[^"]*"[^>]*>(.*?)</div>\s*(?=<div[^>]*class="[^"]*base-card|$)', html, re.S | re.I)
    out, seen = [], set()
    for card in cards:
        title = _field(card, r'class="[^"]*base-search-card__title[^"]*"[^>]*>(.*?)<')
        if not title:
            title = _field(card, r'<h3[^>]*>(.*?)</h3>')
        if not title:
            continue
        company = _field(card, r'class="[^"]*base-search-card__subtitle[^"]*"[^>]*>\s*(?:<a[^>]*>)?(.*?)<')
        if not company:
            company = _field(card, r'<h4[^>]*>(?:\s*<a[^>]*>)?(.*?)<')
        location = _field(card, r'class="[^"]*job-search-card__location[^"]*"[^>]*>(.*?)<')
        # Canonical job URL from the card's full-link anchor.
        m = re.search(r'href="(https://[^"]*?/jobs/view/[^"?]+)', card)
        url = _html.unescape(m.group(1)) if m else ''
        # Posted date from the <time datetime="YYYY-MM-DD"> element.
        dm = re.search(r'datetime="(\d{4}-\d{2}-\d{2})', card)
        date = dm.group(1) if dm else ''
        key = (title.lower(), (location or '').lower())
        if key in seen:
            continue
        seen.add(key)
        out.append({'title': title, 'company': company, 'location': location,
                    'url': url, 'date': date})
    return out
