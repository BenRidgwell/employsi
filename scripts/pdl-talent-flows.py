#!/usr/bin/env python3
"""Talent flows from People Data Labs person records.

WHAT IT DOES
For each seed company, asks PDL's Person Search API for people whose work
history includes that company (current OR former), and turns each record's
dated `experience` into employer-to-employer moves with the same rules the
LinkedIn parser uses (scripts/talent_flows.py: promotions are not moves, side
roles are excluded, ambiguous next employers are skipped). `--export` writes
the canonical files docs/talent-flows-plan.md defines, which
scripts/flows-to-d1.py loads.

No LinkedIn account is involved. PDL is a licensed data vendor, and this is a
plain REST client of its documented API.

WHAT IS KEPT, AND WHAT NEVER ARRIVES
The request asks PDL for work history ONLY (`data_include`): record id,
employer name / id / LinkedIn url, start and end dates, and the job title.
No name, email, phone, location, education or profile url is requested, so
none is received. The title is used to drop side roles and then discarded.
What is written to ~/.employsi/pdl-talent-flows.sqlite is a salted hash of
PDL's record id and the moves (employer -> employer, month). Only
company-to-company COUNTS ever leave this machine.

That minimises what is held; it does not remove the obligation. PDL's records
are personal information under the Privacy Act while they are in memory here,
and PDL's own terms govern what the results may be used for.

WHAT IT COSTS — READ THIS
PDL bills ONE CREDIT PER RECORD RETURNED (Reference - Person Search API,
read 2026-09-24). `--max-records` caps a run (default 100) and is enforced
before each request, so a run never asks for more than is left. The default
rate limit is 10 requests a minute; requests are paced 6.5s apart.
`--estimate` asks for size=1 per seed to read PDL's `total` — that costs one
credit per seed that has any match.

WHAT THE NUMBERS MEAN
A sample: PDL returns matches sorted by profile completeness, and a budget
smaller than `total` takes the most complete profiles first. Unlike the
LinkedIn route, the query reaches FORMER employees too, so a seed's "lost to"
side is observed without seeding the destination. The export carries the
per-seed sample size and PDL's `total`, and marks every row
`count_kind: sampled`.

USAGE
    export PDL_API_KEY=...
    python scripts/pdl-talent-flows.py --seed bhp=bhp --estimate
    python scripts/pdl-talent-flows.py --seed bhp=bhp --max-records 100
    python scripts/pdl-talent-flows.py --stats
    python scripts/pdl-talent-flows.py --export out/
    python scripts/flows-to-d1.py out/                   # dry run

    # every roster company whose LinkedIn slug is confirmed in D1
    CLOUDFLARE_API_TOKEN=... python scripts/pdl-talent-flows.py --seed-from-d1 --estimate

Options:
    --seed ID=SLUG       app company id = LinkedIn company slug (repeatable)
    --seed-from-d1       seeds from D1 company_slugs (needs CLOUDFLARE_API_TOKEN)
    --country NAME       PDL location_country filter (default australia; "any" to drop)
    --max-records N      credits this run may spend (default 100)
    --per-seed N         cap per seed within the run (default: no cap)
    --state PATH         local SQLite (default ~/.employsi/pdl-talent-flows.sqlite)
    --window-months N    export window length (default 24)
    --lag-months N       months before today the window ends (default 3)
    --purge              delete local state and salt
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from talent_flows import (  # noqa: E402
    MAX_GAP_MONTHS, aggregate, moves_from, positions_from_pdl)

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


def _all(name) -> list[str]:
    return [args[i + 1] for i, a in enumerate(args) if a == name and i + 1 < len(args)]


API_KEY = os.environ.get('PDL_API_KEY', '')
# Overridable so the end-to-end test can point this at a local stand-in.
API = os.environ.get('PDL_API_BASE', 'https://api.peopledatalabs.com') + '/v5/person/search'
HOME = os.path.expanduser('~/.employsi')
STATE = _opt('--state', os.path.join(HOME, 'pdl-talent-flows.sqlite'))
SALT_FILE = os.path.join(os.path.dirname(STATE), 'pdl-talent-flows.salt')
COUNTRY = _opt('--country', 'australia')
MAX_RECORDS = int(_opt('--max-records', 100))
PER_SEED = int(_opt('--per-seed', 10 ** 9))
WINDOW_MONTHS = int(_opt('--window-months', 24))
LAG_MONTHS = int(_opt('--lag-months', 3))
# 10 requests/minute is PDL's documented default; 6.5s keeps under it.
PACE = float(os.environ.get('PDL_PACE_SECONDS', 6.5))
PAGE = 100  # PDL's maximum `size`

# Work history only. Nothing that identifies the person is requested.
DATA_INCLUDE = ','.join([
    'id',
    'experience.company.name',
    'experience.company.id',
    'experience.company.linkedin_url',
    'experience.start_date',
    'experience.end_date',
    'experience.title.name',
])

SCHEMA = """
CREATE TABLE IF NOT EXISTS seeds (
  seed_ref     TEXT PRIMARY KEY,   -- li:<slug>
  company_id   TEXT NOT NULL,
  slug         TEXT NOT NULL,
  total        INTEGER,            -- PDL's match count when last asked
  scroll_token TEXT,               -- where the next run resumes
  exhausted    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS people (
  person_key TEXT PRIMARY KEY,     -- HMAC of PDL's record id; nothing else about the person
  seed_ref   TEXT NOT NULL,
  fetched    TEXT NOT NULL,
  status     TEXT NOT NULL,        -- ok | empty
  positions  INTEGER NOT NULL DEFAULT 0,
  dropped    TEXT,
  skipped    TEXT
);
CREATE TABLE IF NOT EXISTS moves (
  person_key TEXT NOT NULL,
  from_ref   TEXT NOT NULL,
  from_name  TEXT NOT NULL,
  to_ref     TEXT NOT NULL,
  to_name    TEXT NOT NULL,
  month      TEXT
);
CREATE INDEX IF NOT EXISTS idx_moves_person ON moves (person_key);
"""


class Stop(Exception):
    """Out of credits, bad key, or PDL pushing back. End the run."""


def db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    conn = sqlite3.connect(STATE)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def salt() -> bytes:
    os.makedirs(os.path.dirname(SALT_FILE), exist_ok=True)
    if not os.path.exists(SALT_FILE):
        fd = os.open(SALT_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(secrets.token_hex(32))
    with open(SALT_FILE) as f:
        return bytes.fromhex(f.read().strip())


def record_key(pdl_id: str, key_salt: bytes) -> str:
    """HMAC of PDL's persistent record id, exactly as given. Not
    talent_flows.person_key, which lowercases for LinkedIn usernames: PDL ids
    are case-sensitive ("qEnOZ5Oh0poWnQ1luFBfVw_0000" in their docs)."""
    return hmac.new(key_salt, f'pdl:{pdl_id}'.encode(), hashlib.sha256).hexdigest()[:32]


def sql_for(slug: str) -> str:
    # PDL stores company LinkedIn urls without scheme or www, lowercased
    # ("linkedin.com/company/peopledatalabs" in their schema docs).
    s = slug.lower().replace("'", "''")
    where = f"experience.company.linkedin_url='linkedin.com/company/{s}'"
    if COUNTRY and COUNTRY.lower() != 'any':
        where += f" AND location_country='{COUNTRY.lower().replace(chr(39), chr(39) * 2)}'"
    return f'SELECT * FROM person WHERE {where}'


_last_call = [0.0]


def search(sql: str, size: int, scroll_token: str | None) -> dict:
    wait = _last_call[0] + PACE - time.monotonic()
    if _last_call[0] and wait > 0:
        time.sleep(wait)
    body = {'sql': sql, 'size': size, 'data_include': DATA_INCLUDE, 'titlecase': True}
    if scroll_token:
        body['scroll_token'] = scroll_token
    req = urllib.request.Request(API, data=json.dumps(body).encode(), headers={
        'X-Api-Key': API_KEY, 'Content-Type': 'application/json'})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                _last_call[0] = time.monotonic()
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            _last_call[0] = time.monotonic()
            detail = e.read().decode('utf-8', 'replace')[:300]
            if e.code == 404:
                # PDL's "no records matched"; nothing was billed.
                return {'status': 404, 'data': [], 'total': 0}
            if e.code == 429 and attempt == 0:
                print('  429 rate limited; waiting 60s once')
                time.sleep(60)
                continue
            if e.code in (401, 402, 403, 429):
                raise Stop(f'PDL {e.code}: {detail}')
            raise RuntimeError(f'PDL {e.code}: {detail}')
    raise Stop('PDL kept rate limiting')


def seeds_from_d1() -> list[tuple[str, str]]:
    token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
    if not token:
        sys.exit('--seed-from-d1 needs CLOUDFLARE_API_TOKEN (D1 read).')
    account = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
    dbid = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
    api = f'https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{dbid}/query'
    body = json.dumps({'sql': 'SELECT company_id, slug FROM company_slugs ORDER BY company_id'}).encode()
    req = urllib.request.Request(api, data=body, headers={
        'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.loads(r.read().decode())
    if not j.get('success'):
        sys.exit(f'D1: {str(j.get("errors"))[:300]}')
    return [(row['company_id'], row['slug']) for row in j['result'][0]['results'] if row.get('slug')]


# ── commands ────────────────────────────────────────────────────────────────

def estimate(seeds: list[tuple[str, str]]) -> int:
    print(f'Asking PDL for match counts (size=1: up to {len(seeds)} credits).')
    grand = 0
    for cid, slug in seeds:
        try:
            res = search(sql_for(slug), 1, None)
        except Stop as e:
            print(f'\nSTOPPED: {e}')
            return 3
        total = int(res.get('total') or 0)
        grand += total
        print(f'  {cid:<20} linkedin.com/company/{slug:<30} {total:>8,} records')
    print(f'\n{grand:,} records in total = {grand:,} credits to pull every one.')
    return 0


def collect(conn: sqlite3.Connection, seeds: list[tuple[str, str]]) -> int:
    key_salt = salt()
    today = dt.date.today().isoformat()
    for cid, slug in seeds:
        conn.execute('INSERT OR IGNORE INTO seeds (seed_ref, company_id, slug) VALUES (?,?,?)',
                     (f'li:{slug.lower()}', cid, slug))
    conn.commit()

    spent, new_people, repeats = 0, 0, 0
    try:
        for cid, slug in seeds:
            seed_ref = f'li:{slug.lower()}'
            row = conn.execute('SELECT * FROM seeds WHERE seed_ref = ?', (seed_ref,)).fetchone()
            if row['exhausted']:
                print(f'  {slug}: already read to the end of PDL\'s matches')
                continue
            token = row['scroll_token']
            taken = 0
            while spent < MAX_RECORDS and taken < PER_SEED:
                # Never request more than the budget has left: PDL bills
                # every record it returns.
                size = min(PAGE, MAX_RECORDS - spent, PER_SEED - taken)
                res = search(sql_for(slug), size, token)
                data = res.get('data') or []
                spent += len(data)
                taken += len(data)
                token = res.get('scroll_token')
                done = not data or not token or len(data) < size
                conn.execute('UPDATE seeds SET total = ?, scroll_token = ?, exhausted = ? '
                             'WHERE seed_ref = ?', (res.get('total'), token, int(done), seed_ref))
                for rec in data:
                    if not rec.get('id'):
                        continue
                    pk = record_key(str(rec['id']), key_salt)
                    if conn.execute('SELECT 1 FROM people WHERE person_key = ?', (pk,)).fetchone():
                        # Same person reached through a second seed: their
                        # moves are already counted once.
                        repeats += 1
                        continue
                    parsed = positions_from_pdl(rec)
                    mv = moves_from(parsed.positions)
                    new_people += 1
                    conn.executemany('INSERT INTO moves VALUES (?,?,?,?,?,?)', [
                        (pk, m.from_ref, m.from_name, m.to_ref, m.to_name, m.month)
                        for m in mv.moves])
                    conn.execute('INSERT INTO people VALUES (?,?,?,?,?,?,?)', (
                        pk, seed_ref, today, 'ok' if parsed.positions else 'empty',
                        len(parsed.positions), json.dumps(dict(parsed.dropped)),
                        json.dumps(dict(mv.skipped))))
                conn.commit()
                print(f'  {slug}: +{len(data)} records (total at PDL {res.get("total") or 0:,}); '
                      f'{spent}/{MAX_RECORDS} credits used')
                if done:
                    break
            if spent >= MAX_RECORDS:
                break
    except Stop as e:
        print(f'\nSTOPPED: {e}\nNothing further was requested.')
        return 3
    print(f'\n{spent} credits used; {new_people} new people, {repeats} already counted via another seed.')
    return 0


def stats(conn: sqlite3.Connection) -> int:
    rows = conn.execute('SELECT status, COUNT(*) n FROM people GROUP BY status').fetchall()
    print('people:', {r['status']: r['n'] for r in rows})
    dropped, skipped = Counter(), Counter()
    for r in conn.execute("SELECT dropped, skipped FROM people WHERE status = 'ok'"):
        dropped.update(json.loads(r['dropped'] or '{}'))
        skipped.update(json.loads(r['skipped'] or '{}'))
    print(f'experience entries refused: {dict(dropped)}')
    print(f'moves not counted: {dict(skipped)}')
    total = conn.execute('SELECT COUNT(*) FROM moves').fetchone()[0]
    undated = conn.execute('SELECT COUNT(*) FROM moves WHERE month IS NULL').fetchone()[0]
    print(f'moves: {total} ({undated} year-only, never exported)')
    for s in conn.execute("SELECT s.seed_ref, s.total, s.exhausted, "
                          "(SELECT COUNT(*) FROM people p WHERE p.seed_ref = s.seed_ref) n "
                          "FROM seeds s ORDER BY n DESC"):
        print(f'  {s["seed_ref"]:<35} {s["n"]:>6} read of {s["total"] or "?"} at PDL'
              f'{"  (all read)" if s["exhausted"] else ""}')
    return 0


def month_add(ym: str, n: int) -> str:
    y, m = map(int, ym.split('-'))
    i = y * 12 + m - 1 + n
    return f'{i // 12:04d}-{i % 12 + 1:02d}'


def export(conn: sqlite3.Connection, out_dir: str) -> int:
    today = dt.date.today()
    end = month_add(today.strftime('%Y-%m'), -LAG_MONTHS)
    start = month_add(end, -(WINDOW_MONTHS - 1))
    moves = [dict(r) for r in conn.execute(
        "SELECT m.* FROM moves m JOIN people p USING (person_key) WHERE p.status = 'ok'")]
    rows = aggregate(moves, start, end)
    sample = {r['seed_ref']: r['n'] for r in conn.execute(
        "SELECT seed_ref, COUNT(*) n FROM people WHERE status = 'ok' GROUP BY seed_ref")}
    if not sample:
        sys.exit('Nothing collected yet.')
    seeds = {r['seed_ref']: r['company_id'] for r in conn.execute('SELECT * FROM seeds')}
    totals = {r['seed_ref']: r['total'] for r in conn.execute('SELECT * FROM seeds')}
    os.makedirs(out_dir, exist_ok=True)
    cols = ['from_ref', 'from_name', 'to_ref', 'to_name', 'period_start', 'period_end',
            'moves', 'count_kind']
    with open(os.path.join(out_dir, 'flows.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    header = {
        'source': 'pdl',
        'product': 'People Data Labs Person Search API v5',
        'delivered': today.isoformat(),
        'method': (f'PDL person records whose work history includes one of {len(sample)} '
                   f'seed companies; a move is a new employer starting within '
                   f'{MAX_GAP_MONTHS} months of the last ending; side roles excluded'),
        'scope': 'sampled profiles',
        'base_company_ref': None,
        'top_n': None,
        'filters': {'country': COUNTRY, 'window_months': WINDOW_MONTHS, 'lag_months': LAG_MONTHS,
                    'pdl_total_per_seed': totals},
        'sample': sample,
        'seeds': seeds,
        'notes': ('Counts of moves among sampled PDL records (most complete profiles first), '
                  'not workforce totals. Current and former employees of each seed are both '
                  f'included. The window ends {LAG_MONTHS} months before collection because '
                  'job changes reach the data late; that lag is an assumption, not a measurement.'),
    }
    with open(os.path.join(out_dir, 'import.json'), 'w') as f:
        json.dump(header, f, indent=2)
    print(f'{len(rows)} company pairs, {sum(r["moves"] for r in rows)} moves, '
          f'{start} to {end}, from {sum(sample.values())} records -> {out_dir}')
    return 0


def main() -> int:
    if '--purge' in args:
        for p in (STATE, SALT_FILE):
            if os.path.exists(p):
                os.remove(p)
                print(f'deleted {p}')
        return 0
    conn = db()
    if '--stats' in args:
        return stats(conn)
    if '--export' in args:
        return export(conn, _opt('--export'))
    seeds = [tuple(s.split('=', 1)) for s in _all('--seed') if '=' in s]
    if '--seed-from-d1' in args:
        seeds += seeds_from_d1()
    if not seeds:
        print(__doc__)
        return 2
    if not API_KEY:
        sys.exit('Set PDL_API_KEY.')
    if '--estimate' in args:
        return estimate(seeds)
    return collect(conn, seeds)


if __name__ == '__main__':
    sys.exit(main())
