#!/usr/bin/env python3
"""
indeed-company-scraper — every Indeed listing for a *company*, across all the
locations it's recruiting in.

Repurposed from Eben001/IndeedJobScraper
(https://github.com/Eben001/IndeedJobScraper), which drives a stealth browser to
Indeed's search results for a given JOB POSITION + LOCATION and emails a CSV.
This tool keeps that project's core — a real (stealth) browser rendering
Indeed's `job_seen_beacon` result cards, then parsing them with the same
resilient selectors — but repurposes it in two ways:

  1. COMPANY-LEVEL, ALL LOCATIONS. Instead of `q=<position>&l=<location>`, it
     searches `q=company:"<Company>"` with NO location filter, so it returns
     that employer's *entire* live board across every city/region it's hiring
     in — and reports a per-location breakdown.

  2. FILE OUTPUT, NO EMAIL. It writes CSV + JSON (like the other tools in
     tools/) and prints a summary, instead of emailing.

    python indeed_company_scraper.py "BHP"                     # AU, all locations
    python indeed_company_scraper.py "Fortescue" --country au
    python indeed_company_scraper.py "Woodside" --headful      # watch / clear a wall
    python indeed_company_scraper.py "Canva" --country us --max-pages 15
    python indeed_company_scraper.py "BHP" --location "Perth WA"   # scope to a city

Switch `--browser`:
  * playwright (default) — uses the Chromium this repo already ships.
  * If Indeed's DataDome wall still blocks you, run `--headful` from a
    residential IP, or point `--proxy` at a residential proxy.

IMPORTANT — where to run it. Indeed sits behind DataDome, which hard-blocks
datacenter / CI / Cloudflare-Workers IPs (a plain request returns HTTP 403 — I
verified this from a datacenter host). So, exactly like the reference project
and like tools/seek-company-scraper: run this MANUALLY, from a residential IP,
for your own analysis — never from the app's Cloudflare Workers. It is a
deliberately standalone tool. The scraper detects the DataDome / "verify you are
human" wall and tells you when it's hit one (with a screenshot), rather than
silently returning nothing.
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import random
import re
import sys
import time
from urllib.parse import quote

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("playwright is required: pip install -r requirements.txt")

# Indeed country sites (from the reference project). The key is what you pass to
# --country; the value is the site's base URL.
COUNTRIES = {
    'au': 'https://au.indeed.com',
    'us': 'https://www.indeed.com',
    'uk': 'https://uk.indeed.com',
    'ca': 'https://ca.indeed.com',
    'nz': 'https://nz.indeed.com',
    'sg': 'https://www.indeed.com.sg',
    'ie': 'https://ie.indeed.com',
    'de': 'https://de.indeed.com',
    'fr': 'https://www.indeed.fr',
    'za': 'https://za.indeed.com',
    'ae': 'https://www.indeed.ae',
    'in': 'https://www.indeed.co.in',
    'jp': 'https://jp.indeed.com',
}
DEFAULT_COUNTRY = 'au'

UA = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
)

# Signs the page is a bot wall rather than real results.
BLOCK_SIGNS = [
    'just a moment', 'verifying you are human', 'datadome', 'captcha-delivery',
    'px-captcha', 'additional verification required', 'unusual traffic',
    'enable javascript and cookies to continue',
]

# Injected before any page script to soften the most obvious automation tells
# (the reference relies on selenium-stealth for the same purpose).
STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
window.chrome = { runtime: {} };
"""


# Use a Chromium that's already provisioned (this repo's environment ships one),
# so we don't force a `playwright install`. Falls back to Playwright's own
# managed browser on a normal machine after `playwright install chromium`.
def chromium_executable() -> str | None:
    env = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH')
    if env and os.path.exists(env):
        return env
    for pat in (
        '/opt/pw-browsers/chromium-*/chrome-linux/chrome',
        '/opt/pw-browsers/chromium-*/chrome-linux/headless_shell',
    ):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    return None


def norm(s: str) -> str:
    s = (s or '').lower()
    s = re.sub(r'\b(pty|ltd|limited|inc|group|holdings|corporation|corp|co|the|plc)\b', '', s)
    return re.sub(r'[^a-z0-9]+', '', s)


def search_url(base: str, company: str, location: str, start: int) -> str:
    # `company:"Name"` is Indeed's company filter; empty `l` = every location.
    q = quote(f'company:"{company}"')
    url = f'{base}/jobs?q={q}&sort=date&start={start}'
    if location:
        url += f'&l={quote(location)}'
    return url


def parse_cards(page, base: str) -> list[dict]:
    """Parse the visible job_seen_beacon result cards on the current page."""
    js = r"""
    () => {
      const out = [];
      const cards = document.querySelectorAll('div.job_seen_beacon');
      for (const c of cards) {
        const a = c.querySelector('a[data-jk]') || c.querySelector('a.jcs-JobTitle') ||
                  c.querySelector('a[class*="JobTitle"]');
        const jk = a ? (a.getAttribute('data-jk') || '') : '';
        const titleEl = c.querySelector('a[class*="JobTitle"] span, a.jcs-JobTitle span, [id^="jobTitle-"]')
                        || (a || {});
        const title = (titleEl.textContent || '').trim();
        const companyEl = c.querySelector('[data-testid="company-name"]');
        const company = companyEl ? companyEl.textContent.trim() : '';
        const locEl = c.querySelector('[data-testid="text-location"]');
        const location = locEl ? locEl.textContent.trim() : '';
        const dateEl = c.querySelector('[data-testid="myJobsStateDate"], span.date');
        const date = dateEl ? dateEl.textContent.replace(/employer ?active/i, '').trim() : '';
        // Salary / attribute snippets (best-effort; Indeed varies these a lot).
        let salary = '';
        const salEl = c.querySelector('[data-testid="attribute_snippet_testid"], .salary-snippet-container, .metadata.salary-snippet-container');
        if (salEl && /\$|per (year|hour|annum)|a year|an hour/i.test(salEl.textContent)) salary = salEl.textContent.trim();
        if (!salary) {
          for (const m of c.querySelectorAll('.metadataContainer li, [class*="metadata"]')) {
            if (/\$|a year|an hour|per year|per hour/i.test(m.textContent)) { salary = m.textContent.trim(); break; }
          }
        }
        const href = a ? a.getAttribute('href') : '';
        out.push({ jk, title, company, location, date, salary, href });
      }
      return out;
    }
    """
    rows = page.evaluate(js)
    jobs = []
    for r in rows:
        title = (r.get('title') or '').strip()
        if not title:
            continue
        href = r.get('href') or ''
        jk = r.get('jk') or ''
        url = ''
        if jk:
            url = f'{base}/viewjob?jk={jk}'
        elif href:
            url = href if href.startswith('http') else base + href
        jobs.append({
            'job_id': jk,
            'title': title,
            'company': (r.get('company') or '').strip(),
            'location': (r.get('location') or '').strip(),
            'date': (r.get('date') or '').strip(),
            'salary': (r.get('salary') or '').strip(),
            'url': url,
        })
    return jobs


def is_blocked(page) -> bool:
    try:
        body = page.content().lower()
    except Exception:
        return False
    return any(s in body for s in BLOCK_SIGNS)


FIELDS = ['job_id', 'title', 'company', 'location', 'date', 'salary', 'url', 'country']


def write_csv(rows: list[dict], path: str) -> None:
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, '') for k in FIELDS})


LAUNCH_ARGS = ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage']


def launch_browser(p, headful: bool = False, proxy: str | None = None):
    """Launch Chromium (using a pre-provisioned binary when available)."""
    kw = {'headless': not headful, 'args': LAUNCH_ARGS}
    if proxy:
        kw['proxy'] = {'server': proxy}
    exe = chromium_executable()
    if exe:
        kw['executable_path'] = exe
    return p.chromium.launch(**kw)


CTX_KW = dict(user_agent=UA, locale='en-AU', viewport={'width': 1360, 'height': 940},
              timezone_id='Australia/Perth')


def new_stealth_page(browser):
    """A fresh page in a stealth-tuned context — reuse one across companies."""
    ctx = browser.new_context(**CTX_KW)
    ctx.add_init_script(STEALTH_JS)
    return ctx.new_page()


def open_session(p, headful: bool = False, proxy: str | None = None, profile: str | None = None):
    """
    Open a browsing session. Returns (closeable, page); call closeable.close()
    to tear it down. With `profile` set, uses a PERSISTENT context stored in that
    directory — cookies (incl. a solved DataDome challenge) survive across runs,
    so a session you clear once with --headful stays trusted on later scheduled
    runs. Without it, a fresh ephemeral browser each time.
    """
    exe = chromium_executable()
    if profile:
        kw = dict(user_data_dir=profile, headless=not headful, args=LAUNCH_ARGS, **CTX_KW)
        if proxy:
            kw['proxy'] = {'server': proxy}
        if exe:
            kw['executable_path'] = exe
        ctx = p.chromium.launch_persistent_context(**kw)
        ctx.add_init_script(STEALTH_JS)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        return ctx, page
    browser = launch_browser(p, headful=headful, proxy=proxy)
    return browser, new_stealth_page(browser)


def scrape_company(page, base: str, company: str, max_pages: int = 20,
                   location: str = '', strict_company: bool = False, country: str = '',
                   page_delay: tuple = (2.0, 6.0), log=None) -> tuple[list[dict], bool]:
    """
    Every Indeed listing for one company across all locations, using an existing
    page. Returns (jobs, blocked). Importable so both the CLI and the D1
    orchestrator (scripts/indeed-to-d1.py) drive one warmed browser.

    `page_delay` is a (min, max) seconds range; the wait between result pages is
    randomised within it (plus a randomised settle after each load) so the
    request pattern doesn't read as a fixed-interval bot.
    """
    logw = (log or sys.stderr).write
    want = norm(company)
    jobs_out: list[dict] = []
    seen: set[str] = set()
    blocked = False
    for i in range(max_pages):
        url = search_url(base, company, location, i * 10)
        try:
            page.goto(url, timeout=60000, wait_until='domcontentloaded')
        except Exception as e:
            logw(f'    page {i+1}: navigation error: {repr(e)[:100]}\n')
            break
        page.wait_for_timeout(int(random.uniform(2200, 4500)))  # randomised settle
        if is_blocked(page):
            shot = f'indeed_blocked_{norm(company) or "x"}_p{i+1}.png'
            try:
                page.screenshot(path=shot)
            except Exception:
                pass
            logw(f'    page {i+1}: BLOCKED (DataDome wall). Screenshot {shot}\n')
            blocked = True
            break
        cards = parse_cards(page, base)
        if not cards:
            break
        added = 0
        for j in cards:
            key = j['job_id'] or (norm(j['title']) + '|' + norm(j['location']))
            if key in seen:
                continue
            if strict_company and j['company'] and norm(j['company']) != want and want not in norm(j['company']):
                continue
            seen.add(key)
            j['country'] = country
            jobs_out.append(j)
            added += 1
        if added == 0:
            break
        time.sleep(random.uniform(*page_delay))  # jittered gap between pages
    return jobs_out, blocked


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Scrape every Indeed listing for a company across all its locations.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument('company', help='Company name to scrape (Indeed company: filter).')
    ap.add_argument('--country', default=DEFAULT_COUNTRY,
                    help=f'Indeed site: {", ".join(COUNTRIES)} (default {DEFAULT_COUNTRY}).')
    ap.add_argument('--location', default='', help='Optional: scope to one location (default: all).')
    ap.add_argument('--max-pages', type=int, default=20, help='Max result pages (15 jobs each).')
    ap.add_argument('--headful', action='store_true', help='Show the browser (clear a wall by hand).')
    ap.add_argument('--proxy', default=None, help='Proxy server, e.g. http://user:pass@host:port (use a residential proxy if blocked).')
    ap.add_argument('--profile', default=None, help='Persistent browser-profile dir; cookies (a solved wall) survive across runs.')
    ap.add_argument('--page-min', type=float, default=2.0, help='Min seconds between result pages (jittered).')
    ap.add_argument('--page-max', type=float, default=6.0, help='Max seconds between result pages (jittered).')
    ap.add_argument('--strict-company', action='store_true',
                    help='Keep only cards whose company name matches (drops recruiter noise).')
    ap.add_argument('--out', default=None, help='CSV output path.')
    ap.add_argument('--json', action='store_true', help='Also write a .json file.')
    args = ap.parse_args()

    base = COUNTRIES.get(args.country)
    if not base:
        sys.exit(f'Unknown --country "{args.country}". Options: {", ".join(COUNTRIES)}')

    all_jobs: list[dict] = []
    blocked_once = False
    with sync_playwright() as p:
        session, page = open_session(p, headful=args.headful, proxy=args.proxy, profile=args.profile)
        all_jobs, blocked_once = scrape_company(
            page, base, args.company, max_pages=args.max_pages, location=args.location,
            strict_company=args.strict_company, country=args.country,
            page_delay=(args.page_min, args.page_max),
        )
        session.close()

    if not all_jobs:
        sys.stderr.write('\nNo listings collected.'
                         + (' (Indeed blocked this host.)\n' if blocked_once else '\n'))
        return 2 if blocked_once else 1

    # Summary: total + per-location breakdown (the point of a company-wide pull).
    from collections import Counter
    by_loc = Counter(j['location'] or '(unspecified)' for j in all_jobs)
    sys.stderr.write(f'\n{len(all_jobs)} listing(s) for "{args.company}" on {args.country}.indeed.\n')
    sys.stderr.write('  By location:\n')
    for name, n in by_loc.most_common(30):
        sys.stderr.write(f'    {n:4d}  {name}\n')

    safe = re.sub(r'[^A-Za-z0-9]+', '_', args.company).strip('_').lower()
    out = args.out or f'indeed_{safe}_{args.country}.csv'
    write_csv(all_jobs, out)
    sys.stderr.write(f'\nWrote {len(all_jobs)} rows -> {out}\n')
    if args.json:
        jpath = out.rsplit('.', 1)[0] + '.json'
        with open(jpath, 'w', encoding='utf-8') as f:
            json.dump(all_jobs, f, indent=2, ensure_ascii=False)
        sys.stderr.write(f'Wrote JSON        -> {jpath}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
