#!/usr/bin/env python3
"""One-off measurement: does a real browser through SCRAPE_PROXY get ZipRecruiter's
website, and what does a search page carry?

WHY. The JobSpy transport (ziprecruiter-to-d1.py) is refused from both a runner
and the IPRoyal US exit — 403 "forbidden cf-waf" / "forbidden aa" on the app
API, run 35967097119. The website is a different surface behind a Cloudflare
challenge, which is the wall a browser clears for SimplyHired. Nothing is
assumed about it: this records, per browser profile,

  1. the egress address, proxied and direct — identical means the proxy was not
     used and nothing below is about it;
  2. whether the challenge clears on the home page and on a search page;
  3. what the search page is made of: <script> blocks with JSON, markers that
     look like job cards, the page title;
  4. whether an in-page fetch() of a search URL returns the page after the
     clearance (raw_get's model) or is scored separately (startup.jobs' case);
  5. every JSON response the page itself requests from ziprecruiter.com — the
     site's own API, if the cards are loaded that way.

Every body is saved under $OUT_DIR for the parser to be written against real
bytes. Exit 0 always: a block is a result, not a failure of the probe.

Run: SCRAPE_PROXY=... SCRAPE_PROXY_COUNTRY=us python scripts/probe-ziprecruiter.py
"""
from __future__ import annotations
import json
import os
import re
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import browser_fetch  # noqa: E402

OUT = os.environ.get('OUT_DIR') or os.path.join(HERE, '..', 'zr-probe')
os.makedirs(OUT, exist_ok=True)
SITE = 'https://www.ziprecruiter.com'
QUERIES = ['Chevron', 'ConocoPhillips', 'Walmart']

MARKERS = {
    'cloudflare': r'Just a moment|challenge-platform|cf-chl',
    'captcha': r'captcha',
    'job_card': r'job_result|job-card|jobList|job_title|"jobTitle"|data-job-id|listing_key|listingKey',
    'next_data': r'__NEXT_DATA__',
    'ld_json': r'application/ld\+json',
    'hiring_company': r'hiring_company|hiringCompany|"company"',
}

UA_US = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')

PROFILES = {
    # What SimplyHired runs today: stock headless Chromium, no patches.
    'A-headless-shell': dict(channel=None, stealth=False),
    # The strongest profile this repo has: real Chrome + stealth patches.
    'B-chrome-stealth': dict(channel='chrome', stealth=True),
}


def summarise(html: str) -> dict:
    s = {k: len(re.findall(p, html or '', re.I)) for k, p in MARKERS.items()}
    t = re.search(r'<title[^>]*>(.*?)</title>', html or '', re.S | re.I)
    s['title'] = ' '.join((t.group(1) if t else '').split())[:100]
    s['bytes'] = len(html or '')
    scripts = []
    for m in re.finditer(r'<script([^>]*)>(.*?)</script>', html or '', re.S | re.I):
        attrs, body = m.group(1), m.group(2)
        if len(body) < 400:
            continue
        idm = re.search(r'id="([^"]+)"', attrs)
        typ = re.search(r'type="([^"]+)"', attrs)
        scripts.append({'id': idm.group(1) if idm else '', 'type': typ.group(1) if typ else '',
                        'len': len(body), 'head': ' '.join(body[:140].split())})
    s['big_scripts'] = sorted(scripts, key=lambda x: -x['len'])[:8]
    return s


def egress(page) -> str:
    try:
        page.goto('https://api.ipify.org?format=json', timeout=30000)
        return page.evaluate('document.body.innerText')[:80]
    except Exception as e:  # noqa: BLE001
        return f'unknown ({type(e).__name__})'


def run_profile(name: str, cfg: dict, proxy: dict | None) -> dict:
    from playwright.sync_api import sync_playwright
    rep: dict = {'profile': name}
    with sync_playwright() as pw:
        launch: dict = {'headless': True}
        if cfg['channel']:
            launch['channel'] = cfg['channel']
        elif browser_fetch.EXECUTABLE:
            launch['executable_path'] = browser_fetch.EXECUTABLE
        if cfg['stealth']:
            launch['args'] = browser_fetch.STEALTH_ARGS
        if proxy:
            launch['proxy'] = proxy
        browser = pw.chromium.launch(**launch)
        ctx = browser.new_context(user_agent=UA_US, locale='en-US',
                                  timezone_id='America/Chicago',
                                  viewport={'width': 1440, 'height': 900})
        if cfg['stealth']:
            ctx.add_init_script(browser_fetch.STEALTH_JS.replace("'en-AU', ", ''))
        page = ctx.new_page()
        rep['egress'] = egress(page)

        api_hits: list[dict] = []

        def on_response(r):
            try:
                ct = r.headers.get('content-type', '')
                if 'ziprecruiter' in r.url and 'json' in ct:
                    body = r.text()
                    fn = f'{name}-xhr-{len(api_hits):02d}.json'
                    open(os.path.join(OUT, fn), 'w').write(body)
                    api_hits.append({'url': r.url[:160], 'status': r.status,
                                     'bytes': len(body), 'file': fn})
            except Exception:  # noqa: BLE001
                pass
        page.on('response', on_response)

        navs = []
        for label, url in [('home', SITE + '/')] + [
                (f'search-{q}', f'{SITE}/jobs-search?' + urllib.parse.urlencode({'search': q, 'location': ''}))
                for q in QUERIES] + [
                ('search-Walmart-p2', f'{SITE}/jobs-search?' + urllib.parse.urlencode({'search': 'Walmart', 'location': '', 'page': 2}))]:
            t0 = time.time()
            try:
                resp = page.goto(url, timeout=60000, wait_until='domcontentloaded')
                page.wait_for_timeout(8000 if label == 'home' else 5000)
                html = page.content()
                status = resp.status if resp else None
            except Exception as e:  # noqa: BLE001
                html, status = '', f'error {type(e).__name__}: {str(e)[:80]}'
            fn = f'{name}-{label}.html'
            open(os.path.join(OUT, fn), 'w').write(html)
            navs.append({'label': label, 'status': status, 'secs': round(time.time() - t0, 1),
                         'final_url': page.url[:120], 'file': fn, **summarise(html)})
        rep['navigations'] = navs

        # raw_get's model: fetch() from inside the cleared page.
        url = f'{SITE}/jobs-search?' + urllib.parse.urlencode({'search': 'Chevron', 'location': ''})
        try:
            res = page.evaluate("""async (u) => {
                try { const r = await fetch(u, {credentials: 'include'});
                      return {status: r.status, body: await r.text()}; }
                catch (e) { return {status: null, body: '', error: String(e)}; } }""", url)
        except Exception as e:  # noqa: BLE001
            res = {'status': None, 'body': '', 'error': str(e)[:100]}
        fn = f'{name}-inpage-fetch.html'
        open(os.path.join(OUT, fn), 'w').write(res.get('body') or '')
        rep['in_page_fetch'] = {'status': res.get('status'), 'error': res.get('error'),
                                'file': fn, **summarise(res.get('body') or '')}
        rep['json_responses'] = api_hits
        browser.close()
    return rep


def main() -> int:
    proxy = browser_fetch.proxy_from_env()
    print(f'proxy: {proxy["server"] if proxy else "NONE — direct"}')
    reports = []
    only = os.environ.get('PROFILES')
    for name, cfg in PROFILES.items():
        if only and name not in only.split(','):
            continue
        try:
            reports.append(run_profile(name, cfg, proxy))
        except Exception as e:  # noqa: BLE001
            reports.append({'profile': name, 'error': f'{type(e).__name__}: {str(e)[:200]}'})
    # The direct address, for the "was the proxy actually used" comparison.
    try:
        import urllib.request
        with urllib.request.urlopen('https://api.ipify.org?format=json', timeout=20) as r:
            direct = r.read().decode()[:80]
    except Exception as e:  # noqa: BLE001
        direct = f'unknown ({type(e).__name__})'
    out = {'direct_egress': direct, 'reports': reports}
    open(os.path.join(OUT, 'report.json'), 'w').write(json.dumps(out, indent=1))

    print(f'direct egress: {direct}')
    for r in reports:
        print(f'\n== {r["profile"]} ==')
        if 'error' in r:
            print('  ERROR', r['error'])
            continue
        print(f'  egress: {r["egress"]}')
        for n in r['navigations']:
            print(f'  {n["label"]:22} status={n["status"]} {n["secs"]}s bytes={n["bytes"]} '
                  f'cf={n["cloudflare"]} captcha={n["captcha"]} cards={n["job_card"]} '
                  f'next={n["next_data"]} ld={n["ld_json"]} title="{n["title"]}"')
            for s in n['big_scripts'][:4]:
                print(f'      script id={s["id"]!r} type={s["type"]!r} len={s["len"]} :: {s["head"][:100]}')
        f = r['in_page_fetch']
        print(f'  in-page fetch: status={f["status"]} bytes={f["bytes"]} cf={f["cloudflare"]} '
              f'cards={f["job_card"]} title="{f["title"]}" {f.get("error") or ""}')
        print(f'  json responses from ziprecruiter: {len(r["json_responses"])}')
        for h in r['json_responses'][:15]:
            print(f'      {h["status"]} {h["bytes"]:>7}B {h["url"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
