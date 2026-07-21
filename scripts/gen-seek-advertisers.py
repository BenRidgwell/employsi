#!/usr/bin/env python3
"""
Resolve every AU_JOBS_TARGETS company to its SEEK advertiser id (once), so the
jobs-cron Worker can pull a company's SEEK board by id — one request, no live
name resolution. Writes src/employsi/data/seekAdvertisers.ts.

SEEK's search API filters by `advertiserid` (one employer, all classifications).
Ids aren't published, so we resolve each company by a keyword search and keep the
advertiser whose own name matches — exact-normalised only, to avoid false
positives (a recruiter or a same-word company). Companies with no current SEEK
ads simply don't resolve and are omitted; SEEK contributes where it can, exactly
like The Muse.

Run from a host that can reach seek.com.au (not the Workers datacenter IPs):

    python scripts/gen-seek-advertisers.py

Re-run periodically to pick up newly-advertising companies / id changes.
"""
from __future__ import annotations
import json, re, sys, time
from urllib.parse import urlencode
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/17.4.1 Safari/605.1.15')
API = 'https://www.seek.com.au/api/jobsearch/v5/search'
PAUSE = 1.2

def norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r'\b(pty|ltd|limited|inc|group|holdings|corporation|corp|co|the|australia|australian|au|nz|plc)\b', '', s)
    s = re.sub(r'[^a-z0-9]+', '', s)
    return s

def get(params: dict) -> dict:
    url = f'{API}?{urlencode(params)}'
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                if r.status == 200:
                    return json.loads(r.read().decode('utf-8'))
        except Exception as e:
            sys.stderr.write(f'  retry {attempt+1}: {e}\n')
            time.sleep(2 * (attempt + 1))
    return {}

def resolve(name: str) -> dict | None:
    params = {
        'siteKey': 'AU-Main', 'sourcesystem': 'houston', 'where': 'All Australia',
        'keywords': name, 'page': 1, 'pageSize': 100, 'locale': 'en-AU',
    }
    data = get(params)
    counts: dict[str, dict] = {}
    for job in data.get('data', []):
        adv = job.get('advertiser') or {}
        aid = str(adv.get('id') or '')
        desc = adv.get('description') or job.get('companyName') or ''
        if not aid:
            continue
        row = counts.setdefault(aid, {'id': aid, 'desc': desc, 'hits': 0})
        row['hits'] += 1
    want = norm(name)
    exact = [r for r in counts.values() if norm(r['desc']) == want]
    if not exact:
        return None
    exact.sort(key=lambda r: r['hits'], reverse=True)
    return exact[0]

def main() -> int:
    pairs = json.load(open('/tmp/au_targets.json'))
    out: dict[str, dict] = {}
    for i, (cid, name) in enumerate(pairs):
        sys.stderr.write(f'[{i+1}/{len(pairs)}] {cid} "{name}"... ')
        m = resolve(name)
        if m:
            out[cid] = {'advertiserId': m['id'], 'name': m['desc']}
            sys.stderr.write(f'-> {m["id"]} "{m["desc"]}" ({m["hits"]} hits)\n')
        else:
            sys.stderr.write('no exact match\n')
        time.sleep(PAUSE)
    json.dump(out, open('/tmp/seek_advertisers.json', 'w'), indent=1)
    sys.stderr.write(f'\nResolved {len(out)}/{len(pairs)} companies.\n')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
