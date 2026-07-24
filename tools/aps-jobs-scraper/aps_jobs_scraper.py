#!/usr/bin/env python3
"""
APS Jobs (apsjobs.gov.au) scraper — the federal counterpart of the SA scraper.

apsjobs.gov.au is a Salesforce Experience Cloud (Aura) site: the job results are
fetched by the page's JavaScript from a session-gated Aura ApexAction endpoint
(/s/sfsites/aura) and rendered client-side. A plain HTTP client gets an
"invalidSession / Guest user access is not allowed" shell, and the Apex action
descriptor isn't discoverable without observing the live browser call — so, like
the SA board, the only reliable reader is a real browser.

This module drives Chromium (Playwright), loads the job-search page, lets
Salesforce fire its own Aura calls, and INTERCEPTS the /s/sfsites/aura JSON
responses — then deep-scans them for job records (Salesforce nests + renames
fields between releases, so the scan is defensive). It's imported by
scripts/aps-to-d1.py, which maps skills + archives to D1.

Each job → {t (title), agency, loc, salary, classification, url, close}.
"""
from __future__ import annotations
import json, os, re, time

SEARCH_URL = 'https://www.apsjobs.gov.au/s/job-search?offset={offset}'
AURA_MARK = '/sfsites/aura'
PER_PAGE = 15
BLOCK_MARKS = ('Attention Required', 'Access Denied', 'Request Rejected')


def chromium_executable():
    base = os.environ.get('PLAYWRIGHT_BROWSERS_PATH')
    if base and os.path.isdir(base):
        for root, _dirs, files in os.walk(base):
            for f in files:
                if f in ('chrome', 'chrome.exe', 'headless_shell'):
                    return os.path.join(root, f)
    return None


def open_session(p, headful=False, proxy=None, profile=None):
    exe = chromium_executable()
    args = {'headless': not headful}
    if exe:
        args['executable_path'] = exe
    if proxy:
        args['proxy'] = {'server': proxy}
    ua = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
    if profile:
        ctx = p.chromium.launch_persistent_context(
            profile, **args, user_agent=ua, locale='en-AU',
            viewport={'width': 1440, 'height': 960})
        return ctx, ctx.pages[0] if ctx.pages else ctx.new_page()
    browser = p.chromium.launch(**args)
    ctx = browser.new_context(user_agent=ua, locale='en-AU',
                              viewport={'width': 1440, 'height': 960})
    return ctx, ctx.new_page()


# ── defensive job-record extraction from an Aura payload ──────────────────────
# Salesforce Aura returns {"actions":[{"returnValue":{...}}]} with the job list
# nested somewhere inside. We recursively find dict/list nodes that look like a
# job posting (a title-ish field + at least one of agency/location/close).
TITLE_KEYS = re.compile(r'^(title|jobtitle|position|positiontitle|name|vacancytitle)$', re.I)
AGENCY_KEYS = re.compile(r'^(agency|agencyname|department|organisation|organization|employer)$', re.I)
LOC_KEYS = re.compile(r'^(location|locations|joblocation|worklocation|city|state)$', re.I)
SALARY_KEYS = re.compile(r'(salary|remuneration|classification|joblevel|level|grade)', re.I)
URL_KEYS = re.compile(r'(url|link|jobid|id|recordid|vacancyid)', re.I)
CLOSE_KEYS = re.compile(r'(close|closing|closedate|expiry|deadline)', re.I)


def _val(d, rx):
    for k, v in d.items():
        if rx.match(k) if hasattr(rx, 'match') and rx.pattern.startswith('^') else rx.search(k):
            if isinstance(v, (str, int, float)) and str(v).strip():
                return str(v).strip()
            if isinstance(v, dict):
                for vv in v.values():
                    if isinstance(vv, (str, int, float)) and str(vv).strip():
                        return str(vv).strip()
            if isinstance(v, list) and v:
                first = v[0]
                if isinstance(first, (str, int, float)):
                    return str(first).strip()
                if isinstance(first, dict):
                    for vv in first.values():
                        if isinstance(vv, (str, int, float)) and str(vv).strip():
                            return str(vv).strip()
    return ''


def _looks_like_job(d: dict) -> bool:
    has_title = any((TITLE_KEYS.match(k) and isinstance(v, (str, int, float)) and str(v).strip())
                    for k, v in d.items())
    has_ctx = any(AGENCY_KEYS.match(k) or LOC_KEYS.match(k) or CLOSE_KEYS.search(k) for k in d.keys())
    return has_title and has_ctx


def extract_jobs(node, out: list, depth=0):
    if depth > 8:
        return
    if isinstance(node, dict):
        if _looks_like_job(node):
            out.append({
                't': _val(node, TITLE_KEYS),
                'agency': _val(node, AGENCY_KEYS),
                'loc': _val(node, LOC_KEYS),
                'salary': _val(node, SALARY_KEYS) or None,
                'classification': _val(node, re.compile(r'(classification|joblevel|grade)', re.I)),
                'url': _val(node, URL_KEYS),
                'close': _val(node, CLOSE_KEYS),
            })
            return
        for v in node.values():
            extract_jobs(v, out, depth + 1)
    elif isinstance(node, list):
        for v in node:
            extract_jobs(v, out, depth + 1)


def _absolute_url(u: str) -> str:
    if not u:
        return ''
    if u.startswith('http'):
        return u
    if re.fullmatch(r'[a-zA-Z0-9]{15,18}', u):  # a Salesforce record Id
        return f'https://www.apsjobs.gov.au/s/job-details?jobId={u}'
    return 'https://www.apsjobs.gov.au' + (u if u.startswith('/') else '/' + u)


def scrape(page, max_pages=40, page_delay=1.6):
    """Walk the APS board (offset pagination), intercepting the Aura JSON."""
    captured: list = []

    def on_response(resp):
        try:
            if AURA_MARK in resp.url and resp.request.method == 'POST':
                body = resp.text()
                if '{' not in body:
                    return
                # Aura sometimes prefixes junk; find the JSON object
                j = json.loads(body[body.index('{'):])
                found: list = []
                extract_jobs(j, found)
                captured.extend(found)
        except Exception:
            pass

    page.on('response', on_response)
    jobs, seen, blocked = [], set(), False
    try:
        for pg in range(max_pages):
            before = len(captured)
            offset = pg * PER_PAGE
            try:
                page.goto(SEARCH_URL.format(offset=offset), wait_until='networkidle', timeout=45000)
            except Exception:
                page.wait_for_timeout(2500)
            page.wait_for_timeout(1500)
            html = ''
            try:
                html = page.content()[:3000]
            except Exception:
                pass
            if any(m in html for m in BLOCK_MARKS) and before == len(captured):
                blocked = True
                break
            fresh = captured[before:]
            if pg > 0 and not fresh:
                break
            time.sleep(page_delay)
    finally:
        try:
            page.remove_listener('response', on_response)
        except Exception:
            pass

    for r in captured:
        title = r.get('t')
        if not title:
            continue
        key = (title.lower(), (r.get('agency') or '').lower(), (r.get('loc') or '').lower())
        if key in seen:
            continue
        seen.add(key)
        r['url'] = _absolute_url(r.get('url') or '')
        jobs.append(r)
    return jobs, blocked
