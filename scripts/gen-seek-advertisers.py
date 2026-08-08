#!/usr/bin/env python3
"""
Resolve roster companies to their SEEK advertiser ids, so the jobs-cron Worker
can pull a company's whole SEEK board by id — one request, no live name
resolution. Writes src/employsi/data/seekAdvertisers.ts.

SEEK's search API filters by `advertiserid` (one employer, all classifications).
Ids aren't published, so each company is resolved by a keyword search, keeping
the advertiser whose own name matches exact-normalised. Exact only, deliberately:
a looser rule files a recruiter's ad, or a same-word company's, as the employer's.
The cost of that strictness is that a group hiring under its brands never
resolves — see src/employsi/data/seekTradingNames.ts, which is the hand-checked
other half and which this script must never touch.

    python scripts/gen-seek-advertisers.py [--only id1,id2] [--limit N] [--prune]

MERGE, DON'T REPLACE
An earlier version wrote whatever this run resolved and nothing else. That is
wrong, because resolution depends on the company having ads TODAY: a company
between campaigns returns no advertiser, and rewriting the file would drop its
id — so the next time it advertised we would not pull it until somebody
happened to re-run this. So a run ADDS and UPDATES, and reports (without
deleting) entries that no longer resolve. `--prune` opts into removing them,
which is only ever right when you have looked at the list.

Run from a host that can reach seek.com.au — not the Workers datacenter IPs,
whose fingerprint SEEK's Cloudflare front challenges.
"""
from __future__ import annotations
import json, os, re, subprocess, sys, time
from urllib.parse import urlencode
import urllib.request

from roster import load_roster

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'src/employsi/data/seekAdvertisers.ts')

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/17.4.1 Safari/605.1.15')
API = 'https://www.seek.com.au/api/jobsearch/v5/search'
PAUSE = 1.2

args = sys.argv[1:]
ONLY = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
LIMIT = int(args[args.index('--limit') + 1]) if '--limit' in args else None
PRUNE = '--prune' in args


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
    data = get({
        'siteKey': 'AU-Main', 'sourcesystem': 'houston', 'where': 'All Australia',
        'keywords': name, 'page': 1, 'pageSize': 100, 'locale': 'en-AU',
    })
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


def load_existing() -> dict:
    """The map as it stands, read by running the module (see seek-advertisers.ts).

    --generated-only, so the hand-written trading names never enter this file's
    output. Folding them in here would look harmless and would delete them: the
    next run resolves them by name, fails (that is why they are hand-written),
    and drops them.
    """
    p = subprocess.run(['bun', 'run', os.path.join(HERE, 'seek-advertisers.ts'),
                        '--generated-only'], capture_output=True, timeout=120, cwd=ROOT)
    if p.returncode != 0:
        raise RuntimeError(f'could not read the existing map: {p.stderr.decode()[:300]}')
    return json.loads(p.stdout.decode())


def write_ts(rows: dict) -> None:
    key = lambda k: k if re.fullmatch(r'[A-Za-z_$][\w$]*', k) else json.dumps(k)  # noqa: E731
    body = '\n'.join(
        f'  {key(cid)}: {{ advertiserId: {json.dumps(v["advertiserId"])}, '
        f'name: {json.dumps(v["name"])} }},'
        for cid, v in sorted(rows.items())
    )
    open(OUT, 'w').write(f'''// AUTO-GENERATED — SEEK advertiser ids for roster companies.
// Maps each app company id to its SEEK employer ("advertiser") id, resolved
// offline by exact-name match against SEEK's search API. The jobs-cron Worker
// pulls a company's full SEEK board (all classifications) by this id — one
// request, no live name resolution.
//
// A company only resolves while it has live ads, so this file is written by
// MERGE: scripts/gen-seek-advertisers.py adds and updates, and never drops an
// id just because that company is between campaigns (--prune does that, on
// purpose). Companies that have never advertised are simply absent and fall
// back to Adzuna/Muse.
//
// Groups that hire under their brands rather than their own name cannot resolve
// here by construction — the exact-name rule is what keeps recruiters out. Those
// live in seekTradingNames.ts, which is hand-checked and which the generator
// does not read or write.
//
// Regenerate with scripts/gen-seek-advertisers.py (from a host that can reach
// seek.com.au — not the Workers datacenter IPs).
export interface SeekAdvertiser {{
  advertiserId: string;
  name: string;
}}
export const SEEK_ADVERTISERS: Record<string, SeekAdvertiser> = {{
{body}
}};
''')


def main() -> int:
    existing = load_existing()
    roster = load_roster(only=ONLY, limit=LIMIT)
    sys.stderr.write(f'{len(roster)} roster companies · {len(existing)} already mapped\n')

    added, updated, kept, lost = {}, {}, 0, []
    for i, c in enumerate(roster):
        cid, name = c['id'], c['name']
        sys.stderr.write(f'[{i+1}/{len(roster)}] {cid} "{name}"... ')
        m = resolve(name)
        if m:
            row = {'advertiserId': m['id'], 'name': m['desc']}
            was = existing.get(cid)
            if not was:
                added[cid] = row
                sys.stderr.write(f'NEW -> {m["id"]} "{m["desc"]}" ({m["hits"]} hits)\n')
            elif was != row:
                updated[cid] = row
                sys.stderr.write(f'CHANGED {was["advertiserId"]} -> {m["id"]} "{m["desc"]}"\n')
            else:
                kept += 1
                sys.stderr.write('unchanged\n')
            existing[cid] = row
        elif cid in existing:
            # Not an error: a mapped company with no ads today. Kept, because
            # dropping it costs us the day it starts advertising again.
            lost.append(cid)
            sys.stderr.write('no ads today (kept)\n')
        else:
            sys.stderr.write('no exact match\n')
        time.sleep(PAUSE)

    if PRUNE and lost:
        for cid in lost:
            existing.pop(cid, None)

    write_ts(existing)
    sys.stderr.write(
        f'\n{len(added)} added, {len(updated)} updated, {kept} unchanged, '
        f'{len(lost)} mapped-but-quiet {"PRUNED" if PRUNE else "kept"}.\n'
        f'Wrote {len(existing)} advertisers to src/employsi/data/seekAdvertisers.ts\n')
    if added:
        sys.stderr.write('  new: ' + ', '.join(sorted(added)) + '\n')
    if lost:
        sys.stderr.write('  no ads today: ' + ', '.join(sorted(lost)) + '\n')
    sys.stderr.write('Run `npx eslint src/employsi/data/seekAdvertisers.ts --fix` '
                     'before committing.\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
