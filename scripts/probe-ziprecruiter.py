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
    # Round 2: the same, HEADFUL under Xvfb — removes headlessness as a tell.
    'C-chrome-headful': dict(channel='chrome', stealth=True, headful=True),
}

# ROUND 1 (run 35967763233): /jobs-search answered 403 with a Cloudflare
# MANAGED challenge ("Just a moment...", cType 'managed') in both A and B after
# a 5s wait, while the home page loaded 200 in both. Round 2 waits up to 30s
# for the challenge to clear itself, and tries other ways in.
CHALLENGE_WAIT_S = 30


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
        launch: dict = {'headless': not cfg.get('headful')}
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

        def settle(label):
            """Wait for a managed challenge to clear itself, up to the limit."""
            waited = 0
            while waited < CHALLENGE_WAIT_S:
                page.wait_for_timeout(2000)
                waited += 2
                try:
                    if 'just a moment' not in (page.title() or '').lower():
                        break
                except Exception:  # noqa: BLE001 — mid-navigation
                    pass
            return waited

        def nav(label, url):
            t0 = time.time()
            status = None
            try:
                resp = page.goto(url, timeout=60000, wait_until='domcontentloaded')
                status = resp.status if resp else None
                waited = settle(label)
                html = page.content()
            except Exception as e:  # noqa: BLE001
                html, status, waited = '', f'error {type(e).__name__}: {str(e)[:80]}', 0
            record(label, html, status, t0, waited)

        def record(label, html, status, t0, waited):
            fn = f'{name}-{label}.html'
            open(os.path.join(OUT, fn), 'w').write(html)
            navs.append({'label': label, 'status': status, 'secs': round(time.time() - t0, 1),
                         'waited': waited, 'final_url': page.url[:120], 'file': fn,
                         **summarise(html)})

        navs = []
        nav('home', SITE + '/')
        # A person's route in: type into the home page's search box and submit.
        t0 = time.time()
        try:
            box = page.locator('input[role="combobox"]').first
            box.click(timeout=10000)
            box.type('Chevron', delay=80)
            box.press('Enter')
            page.wait_for_load_state('domcontentloaded', timeout=60000)
            waited = settle('form')
            record('form-Chevron', page.content(), 'form', t0, waited)
        except Exception as e:  # noqa: BLE001
            record('form-Chevron', '', f'error {type(e).__name__}: {str(e)[:80]}', t0, 0)
        for label, url in [
                ('search-Chevron', f'{SITE}/jobs-search?' + urllib.parse.urlencode({'search': 'Chevron', 'location': ''})),
                ('search-Walmart-p2', f'{SITE}/jobs-search?' + urllib.parse.urlencode({'search': 'Walmart', 'location': '', 'page': 2})),
                ('browse', f'{SITE}/browse'),
                ('Jobs-Chevron', f'{SITE}/Jobs/Chevron'),
                ('co-Chevron', f'{SITE}/co/Chevron/Jobs')]:
            nav(label, url)
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


# ROUND 3. Round 2 (run 35968150046): every listing path stayed on the managed
# challenge for 30s in all three profiles, headful Chrome included. But the home
# page's own JS called /api/web.job_search.proto.v1.API/AutocompleteLocation and
# got a 200 with JSON — a Connect-style RPC service the challenge does not cover.
# This mode maps that service from the site's own bundles and tries its
# search-shaped methods from inside the cleared home page.
API_JS = r"""async () => {
  const srcs = [...document.querySelectorAll('script[src]')].map(s => s.src)
      .filter(u => u.includes('ziprecruiter.com'));
  const methods = new Set(), ctx = {};
  for (const u of srcs) {
    let t = '';
    try { t = await (await fetch(u)).text(); } catch (e) { continue; }
    for (const m of t.matchAll(/([a-z_.]+\.proto\.v\d+\.[A-Za-z]+)\/?["']?\s*[,:]?\s*["']?([A-Z][A-Za-z]+)?/g)) {
      methods.add(m[1] + (m[2] ? '/' + m[2] : ''));
    }
    for (const m of t.matchAll(/(?:name|method|methodName)\s*:\s*["']([A-Z][A-Za-z]*(?:Search|Job|Jobs|Listing)[A-Za-z]*)["']/g)) {
      methods.add('name:' + m[1]);
      const i = m.index;
      ctx[m[1]] = (ctx[m[1]] || []).concat([t.slice(Math.max(0, i - 300), i + 500)]).slice(0, 2);
    }
  }
  return {srcs: srcs.length, methods: [...methods].sort(), ctx};
}"""

CALL_JS = r"""async ([path, body]) => {
  try {
    const r = await fetch(path, {method: 'POST', credentials: 'include',
      headers: {'content-type': 'application/json', 'connect-protocol-version': '1'},
      body: JSON.stringify(body)});
    return {status: r.status, ct: r.headers.get('content-type'), body: await r.text()};
  } catch (e) { return {status: null, body: '', error: String(e)}; }
}"""


def api_probe(proxy) -> dict:
    from playwright.sync_api import sync_playwright
    rep: dict = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, channel='chrome',
                                     args=browser_fetch.STEALTH_ARGS,
                                     **({'proxy': proxy} if proxy else {}))
        ctx = browser.new_context(user_agent=UA_US, locale='en-US', timezone_id='America/Chicago',
                                  viewport={'width': 1440, 'height': 900})
        ctx.add_init_script(browser_fetch.STEALTH_JS.replace("'en-AU', ", ''))
        page = ctx.new_page()
        rep['egress'] = egress(page)
        seen = []
        page.on('request', lambda r: seen.append({'url': r.url[:160], 'method': r.method,
                                                   'post': (r.post_data or '')[:400]})
                if '/api/' in r.url else None)
        resp = page.goto(SITE + '/', timeout=60000, wait_until='domcontentloaded')
        page.wait_for_timeout(6000)
        rep['home_status'] = resp.status if resp else None
        rep['api_requests_seen'] = seen[:20]
        m = page.evaluate(API_JS)
        rep['bundles'] = m['srcs']
        rep['methods'] = m['methods']
        rep['method_context'] = m['ctx']
        open(os.path.join(OUT, 'api-methods.json'), 'w').write(json.dumps(m, indent=1))
        base = '/api/web.job_search.proto.v1.API/'
        names = sorted({x.split('/')[-1].replace('name:', '') for x in m['methods']
                        if re.search(r'Search|Job', x.split('/')[-1])})
        names = [n for n in names if n != 'AutocompleteLocation'][:12] or [
            'SearchJobs', 'JobSearch', 'Search', 'GetJobs', 'ListJobs']
        calls = []
        for n in names:
            for body in ({}, {'search': 'Chevron', 'location': ''},
                         {'query': 'Chevron', 'location': ''}):
                r = page.evaluate(CALL_JS, [base + n, body])
                fn = f'api-{n}-{len(calls):02d}.txt'
                open(os.path.join(OUT, fn), 'w').write(r.get('body') or '')
                calls.append({'method': n, 'body': body, 'status': r.get('status'),
                              'ct': r.get('ct'), 'head': ' '.join((r.get('body') or '')[:300].split()),
                              'error': r.get('error')})
        rep['calls'] = calls
        browser.close()
    return rep


def main() -> int:
    if os.environ.get('PROBE_MODE') == 'api':
        proxy = browser_fetch.proxy_from_env()
        rep = api_probe(proxy)
        open(os.path.join(OUT, 'report-api.json'), 'w').write(json.dumps(rep, indent=1))
        print(f'egress {rep["egress"]}  home {rep["home_status"]}  bundles {rep["bundles"]}')
        print('api requests the page made:')
        for r in rep['api_requests_seen']:
            print(f'  {r["method"]} {r["url"]}  post={r["post"][:200]}')
        print(f'methods found ({len(rep["methods"])}):')
        for x in rep['methods'][:80]:
            print('  ', x)
        print('calls:')
        for c in rep['calls']:
            print(f'  {c["method"]:28} {json.dumps(c["body"]):45} -> {c["status"]} {c["ct"]} :: {c["head"][:200]} {c.get("error") or ""}')
        return 0
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
            print(f'  {n["label"]:22} status={n["status"]} {n["secs"]}s waited={n["waited"]}s -> {n["final_url"][:70]}\n'
                  f'  {"":22} bytes={n["bytes"]} '
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
