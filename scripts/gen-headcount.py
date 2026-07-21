#!/usr/bin/env python3
"""Regenerate src/employsi/data/companyHeadcount.ts — real workforce headcount
(current + prior reporting year) for the AU roster companies, sourced from each
company's annual report via stockanalysis.com (which refreshes once per year
after each filing). Static by design; there is no live HRIS/LinkedIn feed. The
year-on-year growth % is computed from now vs prev.

Usage: python3 scripts/gen-headcount.py
Only keeps figures dated in the last ~2 filing years so stale entries are
dropped rather than shown wrong. Companies not resolved keep their existing
fallback figure in the card (buildPanel).
"""
import re, json, time, urllib.request

ROOT = __file__.rsplit('/scripts/', 1)[0]
OUT = f'{ROOT}/src/employsi/data/companyHeadcount.ts'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36'
MIN_YEAR = 2024

# company id -> ASX ticker (Arrow Energy + Jellinbah are private; BHP's employee
# vs total-workforce definition is ambiguous on the aggregator, so it's omitted).
ASX = {
    'alk': 'ALK', 'asb': 'ASB', 'beach': 'BPT', 'bmn': 'BMN', 'boe': 'BOE', 'ccv': 'CCV',
    'cmm': 'CMM', 'cvn': 'CVN', 'cxo': 'CXO', 'deg': 'DEG', 'del': 'DEL', 'dyl': 'DYL',
    'fmg': 'FMG', 'gmd': 'GMD', 'gor': 'GOR', 'hgo': 'HGO', 'igo': 'IGO', 'ilu': 'ILU',
    'jms': 'JMS', 'ltr': 'LTR', 'mah': 'MAH', 'mgt': 'MGT', 'min': 'MIN', 'mmi': 'MMI',
    'mnd': 'MND', 'nhc': 'NHC', 'nst': 'NST', 'nwh': 'NWH', 'pdn': 'PDN', 'pls': 'PLS',
    'pru': 'PRU', 'rio': 'RIO', 'rms': 'RMS', 'rrl': 'RRL', 's32': 'S32', 'sfr': 'SFR',
    'sgq': 'SGQ', 'smr': 'SMR', 'sto': 'STO', 'stx': 'STX', 'sw1': 'SW1', 'swm': 'SWM',
    'wds': 'WDS', 'wes': 'WES', 'wgx': 'WGX',
}
US = {'chevron': 'CVX', 'shell': 'SHEL', 'rio': 'RIO'}  # dual-listed / global majors

SENT = re.compile(
    r'had ([\d,]+) employees as of ([A-Za-z0-9, ]+?)\. The number of employees '
    r'(?:(increased|decreased) by ([\d,]+) or (-?[\d.]+)%|(did not change|remained))', re.I)


def fetch(url):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}),
                                      timeout=25).read().decode('utf-8', 'replace')
    except Exception:
        return ''


def parse(h):
    m = SENT.search(h)
    if not m:
        return None
    cur = int(m.group(1).replace(',', ''))
    asof = m.group(2).strip()
    ym = re.search(r'20\d\d', asof)
    yr = int(ym.group(0)) if ym else 0
    if m.group(3):
        delta = int(m.group(4).replace(',', ''))
        prev = cur + delta if m.group(3).lower() == 'decreased' else cur - delta
    else:
        prev = cur
    return {'now': cur, 'prev': prev, 'asof': asof, 'yr': yr}


def short(asof):
    m = re.match(r'([A-Za-z]+)\s+\d+,\s*(20\d\d)', asof)
    return f'{m.group(1)[:3]} {m.group(2)}' if m else asof


def main():
    data = {}
    for cid, tk in ASX.items():
        r = parse(fetch(f'https://stockanalysis.com/quote/asx/{tk}/employees/'))
        if (not r or r['yr'] < MIN_YEAR) and cid in US:
            r2 = parse(fetch(f'https://stockanalysis.com/stocks/{US[cid]}/employees/'))
            if r2 and r2['yr'] >= MIN_YEAR:
                r = r2
        if r and r['yr'] >= MIN_YEAR:
            data[cid] = r
        time.sleep(0.25)
    for cid, tk in US.items():
        if data.get(cid):
            continue
        r = parse(fetch(f'https://stockanalysis.com/stocks/{tk}/employees/'))
        if r and r['yr'] >= MIN_YEAR:
            data[cid] = r
        time.sleep(0.25)

    L = [
        '// GENERATED — do not edit by hand. Run scripts/gen-headcount.py.',
        "// Real workforce headcount for the current + prior reporting year, sourced",
        "// from each company's annual report (via stockanalysis.com, which refreshes",
        '// once per year after each filing). Static by design — there is no live HRIS/',
        '// LinkedIn feed — with the year-on-year growth % computed from now vs prev.',
        'export interface Headcount { now: number; prev: number; yoy: number; asof: string; }',
        'export const COMPANY_HEADCOUNT: Record<string, Headcount> = {',
    ]
    for cid in sorted(data):
        v = data[cid]
        yoy = round((v['now'] - v['prev']) / v['prev'] * 100, 1) if v['prev'] else 0.0
        L.append(f"  {cid!r}: {{ now: {v['now']}, prev: {v['prev']}, yoy: {yoy}, asof: {short(v['asof'])!r} }},")
    L.append('};')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))
    print(f'wrote {OUT} with {len(data)} companies')


if __name__ == '__main__':
    main()
