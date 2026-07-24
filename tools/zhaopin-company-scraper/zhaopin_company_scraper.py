#!/usr/bin/env python3
"""
Zhaopin (智联招聘) company scraper — repurposed from github.com/iszhouhua/zhaopin.

That project works by INTERCEPTING the browser's own request to Zhaopin's search
API (https://fe-api.zhaopin.com/c/i/sou) and reading the JSON. We do the same,
because Zhaopin hard-blocks non-browser clients: a plain HTTP GET of that API
returns an empty shell (numFound:999999, results:[]) and www.zhaopin.com serves a
"Security Verification" page. So the only reliable reader is a real browser on a
residential connection — exactly like the Indeed scraper.

This module drives Chromium (Playwright), searches Zhaopin by company keyword
within a city, captures the fe-api /c/i/sou JSON responses the page fires, and
parses each posting defensively (Zhaopin renames fields between versions). It's
imported by scripts/zhaopin-to-d1.py, which maps skills + archives to D1.

Fields returned per job: {t (title), company, loc, salary, url, exp, edu, date}.
"""
from __future__ import annotations
import json, os, random, re, time
from urllib.parse import quote

SEARCH_URL = 'https://sou.zhaopin.com/?jl={city}&kw={kw}&p={page}'
API_MARK = '/c/i/sou'

# Zhaopin cityId codes (jl param). Best-effort; verify with --solve if a city
# returns nothing. Beijing 530, Shanghai 538, Shenzhen 765, Hong Kong 702.
CITY_NAMES = {530: 'Beijing', 538: 'Shanghai', 765: 'Shenzhen', 702: 'Hong Kong'}


def chromium_executable():
    base = os.environ.get('PLAYWRIGHT_BROWSERS_PATH')
    if base and os.path.isdir(base):
        for root, _dirs, files in os.walk(base):
            for f in files:
                if f in ('chrome', 'chrome.exe', 'headless_shell'):
                    return os.path.join(root, f)
    return None


def open_session(p, headful=False, proxy=None, profile=None):
    """Launch Chromium; a persistent profile lets Zhaopin's anti-bot cookies
    survive between runs (solve the verification once, reuse it)."""
    exe = chromium_executable()
    args = {'headless': not headful}
    if exe:
        args['executable_path'] = exe
    if proxy:
        args['proxy'] = {'server': proxy}
    ua = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
    if profile:
        ctx = p.chromium.launch_persistent_context(
            profile, **args, user_agent=ua, locale='zh-CN',
            viewport={'width': 1440, 'height': 900})
        return ctx, ctx.pages[0] if ctx.pages else ctx.new_page()
    browser = p.chromium.launch(**args)
    ctx = browser.new_context(user_agent=ua, locale='zh-CN',
                              viewport={'width': 1440, 'height': 900})
    return ctx, ctx.new_page()


def _first(d: dict, *paths):
    """Return the first present value across dotted paths (e.g. 'company.name')."""
    for path in paths:
        cur = d
        ok = True
        for key in path.split('.'):
            if isinstance(cur, dict) and key in cur and cur[key] is not None:
                cur = cur[key]
            else:
                ok = False
                break
        if ok and cur not in (None, '', [], {}):
            return cur
    return None


def parse_result(r: dict) -> dict | None:
    """Defensively map one Zhaopin result item to our job shape."""
    title = _first(r, 'name', 'jobName', 'jobTitle')
    if not title:
        return None
    company = _first(r, 'company.name', 'companyName', 'company.companyName') or ''
    loc = _first(r, 'city.display', 'city.items.0.name', 'workCity', 'cityDistrict') or ''
    if isinstance(loc, list):
        loc = loc[0] if loc else ''
    salary = _first(r, 'salary', 'salary60', 'salaryReal', 'salaryCount') or ''
    url = _first(r, 'positionURL', 'positionUrl', 'jobUrl', 'vagueUrl') or ''
    exp = _first(r, 'workingExp.name', 'workingExp', 'workingExperience') or ''
    edu = _first(r, 'eduLevel.name', 'eduLevel', 'education') or ''
    date = _first(r, 'updateDate', 'publishTime', 'firstPublishTime', 'createDate') or ''
    return {
        't': re.sub(r'\s+', ' ', str(title)).strip(),
        'company': str(company).strip(),
        'loc': str(loc).strip(),
        'salary': (str(salary).strip() or None),
        'url': str(url).strip(),
        'exp': str(exp).strip(),
        'edu': str(edu).strip(),
        'date': str(date)[:10],
    }


def parse_search_html(html: str) -> list:
    """Parse a rendered sou.zhaopin.com page (as returned by the Oxylabs Web
    Scraper API) into job dicts — the no-browser counterpart of scrape_company.
    The page embeds the fe-api results in window.__INITIAL_STATE__; we parse that
    JSON and deep-scan for the job records (dicts carrying a positionURL)."""
    m = re.search(r'__INITIAL_STATE__\s*=\s*(\{)', html)
    if not m:
        return []
    try:
        obj, _ = json.JSONDecoder().raw_decode(html[m.start(1):])
    except Exception:
        return []
    records: list = []

    def scan(n, depth=0):
        if depth > 10:
            return
        if isinstance(n, dict):
            if 'positionURL' in n or 'positionUrl' in n:
                records.append(n)
            else:
                for v in n.values():
                    scan(v, depth + 1)
        elif isinstance(n, list):
            for v in n:
                scan(v, depth + 1)

    scan(obj)
    out, seen = [], set()
    for r in records:
        job = parse_result(r)
        if not job:
            continue
        k = (job['t'], job['company'], job['loc'])
        if k in seen:
            continue
        seen.add(k)
        out.append(job)
    return out


def _results_from_payload(payload: dict) -> list:
    """Pull the results array out of a /c/i/sou JSON payload (shape drifts)."""
    data = payload.get('data') if isinstance(payload, dict) else None
    if isinstance(data, dict):
        for key in ('results', 'list', 'items'):
            if isinstance(data.get(key), list):
                return data[key]
    if isinstance(payload, dict) and isinstance(payload.get('results'), list):
        return payload['results']
    return []


BLOCK_MARKS = ('Security Verification', '安全验证', 'verify.zhaopin', '滑动验证')


def scrape_company(page, kw: str, city_id: int, max_pages=5, page_delay=(2.0, 5.0)):
    """Search Zhaopin for `kw` in city `city_id`, returning (jobs, blocked).

    Captures every fe-api /c/i/sou JSON response the page fires while paging."""
    captured: list = []

    def on_response(resp):
        try:
            if API_MARK in resp.url and resp.status == 200:
                payload = resp.json()
                captured.extend(_results_from_payload(payload))
        except Exception:
            pass

    page.on('response', on_response)
    jobs, seen, blocked = [], set(), False
    try:
        for pg in range(1, max_pages + 1):
            before = len(captured)
            url = SEARCH_URL.format(city=city_id, kw=quote(kw), page=pg)
            try:
                page.goto(url, wait_until='networkidle', timeout=45000)
            except Exception:
                page.wait_for_timeout(2500)
            # Give late XHRs a beat, and nudge lazy loading.
            page.wait_for_timeout(1500)
            try:
                page.mouse.wheel(0, 4000)
                page.wait_for_timeout(1200)
            except Exception:
                pass
            html = ''
            try:
                html = page.content()[:4000]
            except Exception:
                pass
            if any(m in html for m in BLOCK_MARKS) and before == len(captured):
                blocked = True
                break
            fresh = captured[before:]
            if pg > 1 and not fresh:
                break  # no more pages
            time.sleep(random.uniform(*page_delay))
    finally:
        try:
            page.remove_listener('response', on_response)
        except Exception:
            pass

    for r in captured:
        job = parse_result(r) if isinstance(r, dict) else None
        if not job:
            continue
        key = (job['t'], job['company'], job['loc'])
        if key in seen:
            continue
        seen.add(key)
        jobs.append(job)
    return jobs, blocked
