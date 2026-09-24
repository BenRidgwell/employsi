#!/usr/bin/env python3
"""Fetch the Queensland workforce workbook past its WAF, and report its shape.

WHY A BROWSER, not just a runner. www.data.qld.gov.au answers a plain request
for the file with `x-amzn-waf-action: challenge` and 2,027 bytes of
`window.awsWafCoo…` — an AWS WAF JavaScript challenge. Measured from the
authoring sandbox AND from a GitHub runner on 2026-09-24: both get the same
interstitial, so this was never an IP block and moving the fetch to a runner
alone does nothing. The challenge has to be executed.

That is the same doorman browser-portals.yml already documents on NGA.NET,
where it is the heavier `captcha` action; this is the lighter `challenge`,
which a real browser clears on its own with no human step. So: load the dataset
page, let the challenge run and set its cookie, then pull the file from inside
the same browser context.

WHAT THIS PRINTS. The workbook's structure, to the job log. The parser is
deliberately not written yet — the current product is the "State of the sector
report" workbook, which is a different shape from the "biannual workforce
profile" the CKAN datastore holds, and writing a parser against a file nobody
has opened is a guess. Once the log shows the real thing, load_qld() goes into
scripts/gen-gov-workforce.py.

    python3 scripts/qld-workforce-probe.py        # needs playwright + chromium
"""
import io, json, re, sys, urllib.request

API = 'https://data.qld.gov.au/api/3/action'
DATASET = 'queensland-public-service-workforce-quarterly-profile'
PAGE = f'https://www.data.qld.gov.au/dataset/{DATASET}'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')


def newest_resource():
    """The newest State of the Sector workbook. The CKAN API itself is NOT
    behind the WAF — only the file downloads are — so this stays plain urllib."""
    req = urllib.request.Request(f'{API}/package_show?id={DATASET}',
                                 headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        pkg = json.load(r)['result']
    cands = [x for x in pkg['resources']
             if 'state of the sector' in x['name'].lower()
             and (x.get('format') or '').lower() in ('xlsx', 'xls')]
    if not cands:
        return None
    cands.sort(key=lambda x: (re.search(r'(20\d\d)', x['name']) or ['', '0'])[1],
               reverse=True)
    return cands[0]


def main():
    res = newest_resource()
    if not res:
        print('NO state-of-the-sector workbook in the dataset', file=sys.stderr)
        return 1
    print(f'resource : {res["name"]}')
    print(f'url      : {res["url"]}')

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        ctx = browser.new_context(user_agent=UA, locale='en-AU')
        page = ctx.new_page()
        page.goto(PAGE, wait_until='domcontentloaded', timeout=90_000)
        # The challenge runs after load and then reloads the document itself.
        # Two and a half seconds is what probe-headless-ci settles for on the
        # same doorman.
        page.wait_for_timeout(2500)
        names = {c['name'] for c in ctx.cookies()}
        got_token = any('waf' in n.lower() for n in names)
        print(f'cookies  : {sorted(names)}')
        print(f'waf token: {got_token}')

        # Inside the browser context, so the cookie and the TLS fingerprint are
        # the ones the challenge was issued to.
        r = ctx.request.get(res['url'], timeout=120_000)
        raw = r.body()
        print(f'status   : {r.status}')
        print(f'bytes    : {len(raw)}')
        browser.close()

    if raw[:2] != b'PK':
        print('STILL NOT A WORKBOOK — first 300 bytes follow.')
        print(raw[:300].decode('utf-8', 'replace'))
        return 1

    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    print(f'sheets   : {len(wb.sheetnames)}')
    for n in wb.sheetnames:
        print(f'  - {n}')
    for n in wb.sheetnames:
        ws = wb[n]
        print(f'\n===== {n} =====')
        for i, row in enumerate(ws.iter_rows(min_row=1, max_row=14, values_only=True)):
            cells = ['' if c is None else str(c).strip() for c in (row or ())[:10]]
            if any(cells):
                print(f'  {i+1:3d} | ' + ' | '.join(c[:30] for c in cells))
    return 0


if __name__ == '__main__':
    sys.exit(main())
