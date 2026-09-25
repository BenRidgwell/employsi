#!/usr/bin/env python3
"""Load one talent-flow delivery (canonical format) into D1.

INPUT is a directory holding the two files docs/talent-flows-plan.md defines:

  flows.csv    from_ref,from_name,to_ref,to_name,period_start,period_end,moves,count_kind
  import.json  source, product, delivered, method, scope, base_company_ref,
               top_n, filters, notes — and, for a sampled source, `sample`
               ({ref: profiles}) and optionally `seeds` ({ref: company id})

Whatever produced them — a vendor adapter, a Talent Insights export turned
round by hand — this script does not care. It never sees a person: the
canonical format has none, and it refuses a file with a column that looks
like one.

WHAT IT DOES
  1. Validates both files. A bad row fails the load; nothing is half-written.
  2. Resolves every ref to an app company id, in this order, and never by a
     fuzzy match:
       flow_company_map        a decision already made (including "not ours")
       import.json `seeds`     the delivery says which company it sampled
       li:<slug>               a LinkedIn slug confirmed in company_slugs
       exact name              the normalised name equals exactly ONE roster
                               company's (scripts/roster.ts --with-cities)
  3. Prints the unmatched report, biggest volume first, so the misses that
     matter are at the top.
  4. With --write: writes flow_import, flows and flow_sample, records the
     matches it made in flow_company_map, and marks older imports from the
     same source (and base company) superseded.

DRY RUN IS THE DEFAULT. Nothing touches D1 without --write. The preview
Worker shares production D1, so a write is live on both at once.

Run:
  python scripts/flows-to-d1.py path/to/delivery/            # dry run
  python scripts/flows-to-d1.py path/to/delivery/ --write    # needs D1 edit
  python scripts/flows-to-d1.py path/to/delivery/ --offline  # no D1 reads either

Env: CLOUDFLARE_API_TOKEN (not needed with --offline)
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'

args = sys.argv[1:]
WRITE = '--write' in args
OFFLINE = '--offline' in args
POSITIONAL = [a for a in args if not a.startswith('--')]

COLUMNS = ['from_ref', 'from_name', 'to_ref', 'to_name', 'period_start',
           'period_end', 'moves', 'count_kind']
COUNT_KINDS = {'observed', 'weighted', 'nowcast', 'sampled'}
SCOPES = {'all pairs', 'base company', 'sampled profiles'}
# A column with any of these names means the file is not the canonical
# aggregate — most likely a vendor's person-level file passed by mistake.
PERSONAL = re.compile(r'user|person|member|profile|name_first|first_name|last_name|email|url',
                      re.IGNORECASE)
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
REF = re.compile(r'^[a-z][a-z0-9-]*:.+$')


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def d1(sql: str, params: list | None = None) -> list[dict]:
    body = json.dumps({'sql': sql, 'params': params or []}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                j = json.loads(r.read().decode())
            if j.get('success'):
                return j['result'][0].get('results') or []
            raise RuntimeError(str(j.get('errors'))[:300])
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            if attempt == 3:
                raise RuntimeError(f'D1 {e.code}: {detail}')
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
        time.sleep(attempt + 1)
    return []


# ── validation ──────────────────────────────────────────────────────────────

def load(delivery: str) -> tuple[dict, list[dict], str]:
    hp, fp = os.path.join(delivery, 'import.json'), os.path.join(delivery, 'flows.csv')
    for p in (hp, fp):
        if not os.path.exists(p):
            sys.exit(f'missing {p}')
    with open(hp) as f:
        header = json.load(f)
    with open(fp, 'rb') as f:
        raw = f.read()
    rows = list(csv.DictReader(raw.decode('utf-8-sig').splitlines()))
    # skill_flows.csv is optional (0004). When present it is part of the
    # delivery, so it is part of the digest: a changed skill file is a new
    # import, not "already loaded".
    sp = os.path.join(delivery, 'skill_flows.csv')
    skill_raw = open(sp, 'rb').read() if os.path.exists(sp) else b''
    digest = hashlib.sha256(raw + skill_raw).hexdigest()[:12] if skill_raw \
        else hashlib.sha256(raw).hexdigest()[:12]
    skill_rows = list(csv.DictReader(skill_raw.decode('utf-8-sig').splitlines())) if skill_raw else []

    errs: list[str] = []
    for k in ('source', 'delivered', 'method', 'scope'):
        if not header.get(k):
            errs.append(f'import.json: {k} is required')
    if header.get('scope') and header['scope'] not in SCOPES:
        errs.append(f'import.json: scope must be one of {sorted(SCOPES)}')
    if header.get('delivered') and not DATE.match(str(header['delivered'])):
        errs.append('import.json: delivered must be YYYY-MM-DD')
    if header.get('scope') == 'base company' and not header.get('base_company_ref'):
        errs.append('import.json: scope "base company" needs base_company_ref')
    if header.get('scope') == 'sampled profiles' and not header.get('sample'):
        errs.append('import.json: a sampled source needs `sample` ({ref: profiles})')

    cols = list(rows[0].keys()) if rows else COLUMNS
    extra = [c for c in cols if c not in COLUMNS]
    missing = [c for c in COLUMNS if c not in cols]
    if missing:
        errs.append(f'flows.csv: missing columns {missing}')
    personal = [c for c in extra if PERSONAL.search(c)]
    if personal:
        errs.append(f'flows.csv: columns {personal} look person-level. This loader only '
                    'takes aggregated counts; aggregate before loading.')
    elif extra:
        errs.append(f'flows.csv: unexpected columns {extra}')

    seen = set()
    for n, r in enumerate(rows, start=2):
        where = f'flows.csv line {n}'
        for c in ('from_ref', 'to_ref'):
            if not REF.match(r.get(c) or ''):
                errs.append(f'{where}: {c} {r.get(c)!r} is not vendor:id')
        if r.get('from_ref') == r.get('to_ref'):
            errs.append(f'{where}: from and to are the same company')
        for c in ('period_start', 'period_end'):
            if not DATE.match(r.get(c) or ''):
                errs.append(f'{where}: {c} must be YYYY-MM-DD')
        if (r.get('period_start') or '') > (r.get('period_end') or ''):
            errs.append(f'{where}: period_start after period_end')
        try:
            if float(r.get('moves') or 'x') < 0:
                raise ValueError
        except ValueError:
            errs.append(f'{where}: moves must be a number >= 0')
        if r.get('count_kind') not in COUNT_KINDS:
            errs.append(f'{where}: count_kind must be one of {sorted(COUNT_KINDS)}')
        k = (r.get('from_ref'), r.get('to_ref'), r.get('period_start'), r.get('count_kind'))
        if k in seen:
            errs.append(f'{where}: duplicate of an earlier row')
        seen.add(k)
    if header.get('scope') == 'sampled profiles' and any(
            r.get('count_kind') != 'sampled' for r in rows):
        errs.append('a sampled source must mark every row count_kind=sampled')

    if skill_rows:
        cols = list(skill_rows[0].keys())
        want = COLUMNS + ['skill']
        if sorted(cols) != sorted(want):
            errs.append(f'skill_flows.csv: columns must be exactly {want}, got {cols}')
        pairs = {(r.get('from_ref'), r.get('to_ref'), r.get('period_start')) for r in rows}
        seen = set()
        for n, r in enumerate(skill_rows, start=2):
            where = f'skill_flows.csv line {n}'
            if not (r.get('skill') or '').strip():
                errs.append(f'{where}: skill is empty')
            for c in ('from_ref', 'to_ref'):
                if not REF.match(r.get(c) or ''):
                    errs.append(f'{where}: {c} {r.get(c)!r} is not vendor:id')
            try:
                if float(r.get('moves') or 'x') < 0:
                    raise ValueError
            except ValueError:
                errs.append(f'{where}: moves must be a number >= 0')
            if r.get('count_kind') not in COUNT_KINDS:
                errs.append(f'{where}: count_kind must be one of {sorted(COUNT_KINDS)}')
            # A skill row is a slice of a company row; one with no company
            # row behind it means the two files were exported differently.
            if (r.get('from_ref'), r.get('to_ref'), r.get('period_start')) not in pairs:
                errs.append(f'{where}: no company row for this pair and period in flows.csv')
            k = (r.get('from_ref'), r.get('to_ref'), r.get('period_start'), r.get('skill'),
                 r.get('count_kind'))
            if k in seen:
                errs.append(f'{where}: duplicate of an earlier row')
            seen.add(k)
    if errs:
        print('\n'.join(errs[:40]))
        if len(errs) > 40:
            print(f'... and {len(errs) - 40} more')
        sys.exit(1)
    return header, rows, digest, skill_rows


# ── matching ────────────────────────────────────────────────────────────────

def roster_names() -> dict[str, list[str]]:
    p = subprocess.run(['bun', 'run', os.path.join(HERE, 'roster.ts'), '--with-cities'],
                       capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        sys.exit(f'scripts/roster.ts failed: {p.stderr[:300]}')
    by_name: dict[str, list[str]] = defaultdict(list)
    for c in json.loads(p.stdout):
        by_name[norm(c['name'])].append(c['id'])
    return by_name


def resolve(refs: dict[str, str], header: dict) -> tuple[dict[str, str | None], dict[str, str]]:
    """ref -> company id (or None), and ref -> how it was decided."""
    known: dict[str, str | None] = {}
    how: dict[str, str] = {}
    slugs: dict[str, str] = {}
    if not OFFLINE:
        for r in d1('SELECT ref, company_id FROM flow_company_map'):
            known[r['ref']] = r['company_id']
            how[r['ref']] = 'map'
        for r in d1('SELECT company_id, slug FROM company_slugs'):
            if r.get('slug'):
                slugs[f'li:{r["slug"].lower()}'] = r['company_id']
    names = roster_names()
    seeds = header.get('seeds') or {}
    out: dict[str, str | None] = {}
    for ref, name in refs.items():
        if ref in known:
            out[ref] = known[ref]
        elif ref in seeds:
            out[ref], how[ref] = seeds[ref], 'seed'
        elif ref in slugs:
            out[ref], how[ref] = slugs[ref], 'linkedin-slug'
        elif len(names.get(norm(name), [])) == 1:
            out[ref], how[ref] = names[norm(name)][0], 'exact-name'
        else:
            out[ref] = None
            how[ref] = 'ambiguous-name' if len(names.get(norm(name), [])) > 1 else 'unmatched'
    return out, how


# ── main ────────────────────────────────────────────────────────────────────

def main() -> int:
    if not POSITIONAL:
        print(__doc__)
        return 2
    if WRITE and OFFLINE:
        sys.exit('--write needs D1; drop --offline.')
    if not OFFLINE and not TOKEN:
        sys.exit('CLOUDFLARE_API_TOKEN is required (or pass --offline for a dry run '
                 'that skips the D1 lookups).')
    header, rows, digest, skill_rows = load(POSITIONAL[0])
    import_id = f'{header["source"]}|{header["delivered"]}|{digest}'

    refs: dict[str, str] = {}
    volume: Counter = Counter()
    for r in rows:
        refs.setdefault(r['from_ref'], r['from_name'])
        refs.setdefault(r['to_ref'], r['to_name'])
        volume[r['from_ref']] += float(r['moves'])
        volume[r['to_ref']] += float(r['moves'])
    for r in skill_rows:
        refs.setdefault(r['from_ref'], r['from_name'])
        refs.setdefault(r['to_ref'], r['to_name'])
    for ref in (header.get('sample') or {}):
        refs.setdefault(ref, ref.split(':', 1)[-1])
    ids, how = resolve(refs, header)

    both = sum(float(r['moves']) for r in rows if ids[r['from_ref']] and ids[r['to_ref']])
    total = sum(float(r['moves']) for r in rows)
    periods = sorted({(r['period_start'], r['period_end']) for r in rows})
    print(f'import   {import_id}')
    print(f'source   {header["source"]} ({header["scope"]}), delivered {header["delivered"]}')
    print(f'rows     {len(rows)} pairs, {total:g} moves, periods {periods[:3]}'
          f'{" ..." if len(periods) > 3 else ""}')
    print(f'matched  {sum(1 for v in ids.values() if v)} of {len(ids)} companies; '
          f'{both:g} of {total:g} moves have both ends on the roster')
    print(f'by       {dict(Counter(how.values()))}')
    if skill_rows:
        print(f'skills   {len(skill_rows)} rows over {len({r["skill"] for r in skill_rows})} skills, '
              f'{sum(float(r["moves"]) for r in skill_rows):g} skill moves, from '
              f'{sum((header.get("skills") or {}).get("sample", {}).values())} profiles with skills')
    unmatched = sorted((r for r in refs if not ids[r]), key=lambda r: -volume[r])
    if unmatched:
        print('\nunmatched, biggest first (map one with a flow_company_map row, method=manual):')
        for ref in unmatched[:25]:
            print(f'  {volume[ref]:>8g}  {ref}  {refs[ref]!r}  [{how[ref]}]')
        if len(unmatched) > 25:
            print(f'  ... and {len(unmatched) - 25} more')

    if not WRITE:
        print('\nDRY RUN — nothing written. Re-run with --write to load.')
        return 0

    now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    if d1('SELECT 1 FROM flow_import WHERE import_id = ?', [import_id]):
        sys.exit(f'{import_id} is already loaded. Nothing written.')

    # Rows first, the import record last: flowsFn only reads imports that
    # exist, so a load that dies half way is invisible rather than partial.
    per = 9  # 11 bound params a row; D1 caps a statement at 100
    for i in range(0, len(rows), per):
        chunk = rows[i:i + per]
        d1('INSERT INTO flows (import_id, from_ref, from_name, to_ref, to_name, from_id, '
           'to_id, period_start, period_end, moves, count_kind) VALUES '
           + ','.join(['(?,?,?,?,?,?,?,?,?,?,?)'] * len(chunk)),
           [v for r in chunk for v in (
               import_id, r['from_ref'], r['from_name'], r['to_ref'], r['to_name'],
               ids[r['from_ref']], ids[r['to_ref']], r['period_start'], r['period_end'],
               float(r['moves']), r['count_kind'])])
    for ref, n in (header.get('sample') or {}).items():
        d1('INSERT INTO flow_sample (import_id, ref, company_id, profiles) VALUES (?,?,?,?)',
           [import_id, ref, ids.get(ref), int(n)])
    per_s = 8  # 12 bound params a row
    for i in range(0, len(skill_rows), per_s):
        chunk = skill_rows[i:i + per_s]
        d1('INSERT INTO flow_skills (import_id, from_ref, from_name, to_ref, to_name, from_id, '
           'to_id, period_start, period_end, skill, moves, count_kind) VALUES '
           + ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?)'] * len(chunk)),
           [v for r in chunk for v in (
               import_id, r['from_ref'], r['from_name'], r['to_ref'], r['to_name'],
               ids.get(r['from_ref']), ids.get(r['to_ref']), r['period_start'], r['period_end'],
               r['skill'], float(r['moves']), r['count_kind'])])
    for ref, n in ((header.get('skills') or {}).get('sample') or {}).items():
        d1('INSERT INTO flow_skill_sample (import_id, ref, company_id, profiles) VALUES (?,?,?,?)',
           [import_id, ref, ids.get(ref), int(n)])
    for ref, method in how.items():
        if method in ('linkedin-slug', 'exact-name', 'seed') and ids.get(ref):
            d1('INSERT OR IGNORE INTO flow_company_map (ref, company_id, method, checked_at) '
               'VALUES (?,?,?,?)', [ref, ids[ref], method, now[:10]])
    d1('INSERT INTO flow_import (import_id, source, product, delivered, loaded_at, method, '
       'scope, base_ref, top_n, filters, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
       [import_id, header['source'], header.get('product'), header['delivered'], now,
        header['method'], header['scope'], header.get('base_company_ref'),
        header.get('top_n'), json.dumps(header.get('filters') or {}), header.get('notes')])
    d1('UPDATE flow_import SET superseded_by = ? WHERE source = ? AND import_id != ? '
       'AND superseded_by IS NULL AND COALESCE(base_ref, \'\') = COALESCE(?, \'\')',
       [import_id, header['source'], import_id, header.get('base_company_ref')])
    print(f'\nwrote {len(rows)} flows as {import_id}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
