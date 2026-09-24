#!/usr/bin/env python3
"""Talent flows from Bright Data's LinkedIn people-profiles dataset, via MCP.

WHAT IT DOES
Drives Bright Data's official MCP server (@brightdata/mcp, pinned) over stdio
and calls its `search_dataset` tool against the LinkedIn people-profiles
dataset (gd_l1viktl72bvl7bjuj0). For each seed company it asks for profiles
whose current employer is that company's LinkedIn page. Each hit is a whole
stored profile, work history included, so there is no second per-profile
fetch. scripts/talent_flows.py turns each work history into employer-to-
employer moves with the same rules as every other source (promotions are not
moves, board and school roles are excluded, ambiguous next employers are
skipped). `--export` writes the canonical files docs/talent-flows-plan.md
defines, which scripts/flows-to-d1.py loads.

No LinkedIn account is involved: Bright Data collects the data and serves it
from its own store.

WHAT IS KEPT
A hit carries the whole profile: name, profile url, photo, about text and the
rest. The MCP tool has no field selection, so all of it arrives. This script
reads `id` and `experience` and nothing else, drops the hit, and writes a
salted hash of the id plus the moves (employer -> employer, month) to
~/.employsi/brightdata-talent-flows.sqlite. Titles are used to exclude side
roles and then discarded. Nothing else is printed or stored; `--inspect`
prints only the work-history entries. Only company-to-company COUNTS ever
leave this machine.

That minimises what is held; it does not remove the obligation. Those records
are personal information under the Privacy Act while they are in memory here,
and Bright Data's terms govern what the results may be used for.

WHAT IT COSTS
Bright Data's MCP free tier is 5,000 requests a month, renewing on the 1st
(brightdata-mcp README, read 2026-09-24). This script makes one request per
`search_dataset` call, and each call returns at most 10 profiles (the MCP
tool's own cap). `--max-requests` (default 50, so up to 500 profiles) caps a
run; set a spend cap in Bright Data's control panel too, so nothing beyond the
free tier can be billed. An error that looks like quota, auth or payment
stops the run (exit 3).

THE FILTERS (measured live 2026-09-24)
`list_dataset_fields` lists `current_company_company_id` and `country_code`,
and bhp + AU returned 21,360 hits. There is no way to FORMER employees:
`experience` is listed only as an array, and `--filter-field
experience.company_id` is refused ("unsupported filters"). Of 10 real BHP
profiles, 7 had one experience entry with no start date and parsed to
nothing; `--inspect --n 10` prints what refused entries hold.

WHAT THE NUMBERS MEAN
A sample of profiles Bright Data holds for current employees of each seed, in
the dataset's default order. "Lost to" flows for a seed are only seen when
the destination is also seeded. Every row is `count_kind: sampled`, and the
export carries the per-seed sample size and Bright Data's `total_hits`.

SETUP (once)
    pip install "mcp>=1.28,<3"          # the MCP client
    # Node 18+ for npx. API token: brightdata.com/cp/setting/users
    export BRIGHTDATA_API_TOKEN=...

USAGE
    python scripts/brightdata-talent-flows.py --fields                # 1 request
    python scripts/brightdata-talent-flows.py --inspect bhp           # 1 request, stores nothing
    python scripts/brightdata-talent-flows.py --inspect bhp --n 10    # still 1 request, 10 profiles
    python scripts/brightdata-talent-flows.py --seed bhp=bhp --max-requests 5
    python scripts/brightdata-talent-flows.py --stats
    python scripts/brightdata-talent-flows.py --export out/
    python scripts/flows-to-d1.py out/                                # dry run

Options:
    --n N                 profiles --inspect asks for (1-10, same one request)
    --seed ID=SLUG        app company id = LinkedIn company slug (repeatable)
    --seed-from-d1        seeds from D1 company_slugs (needs CLOUDFLARE_API_TOKEN)
    --country CODE        country_code filter (default AU; "any" to drop)
    --filter-field NAME   field matched against the slug (default current_company_company_id;
                          experience.company_id is refused by Bright Data)
    --max-requests N      MCP calls this run may make (default 50)
    --per-seed N          profiles per seed within the run (default: no cap)
    --pause S             seconds between calls (default 2)
    --server-cmd CMD      MCP server command (default "npx -y @brightdata/mcp@2.11.3")
    --state PATH          local SQLite (default ~/.employsi/brightdata-talent-flows.sqlite)
    --window-months N     export window length (default 24)
    --lag-months N        months before today the window ends (default 3)
    --purge               delete local state and salt
"""
from __future__ import annotations

import asyncio
import csv
import datetime as dt
import json
import os
import secrets
import shlex
import sqlite3
import sys
import time
import urllib.request
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from talent_flows import (  # noqa: E402
    MAX_GAP_MONTHS, aggregate, moves_from, person_key, positions_from_brightdata)

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


def _all(name) -> list[str]:
    return [args[i + 1] for i, a in enumerate(args) if a == name and i + 1 < len(args)]


API_TOKEN = os.environ.get('BRIGHTDATA_API_TOKEN', '')
DATASET = 'gd_l1viktl72bvl7bjuj0'  # LinkedIn people profiles (brightdata-mcp search_dataset_schema.js)
PAGE = 10                          # search_dataset's own maximum `size`
HOME = os.path.expanduser('~/.employsi')
STATE = _opt('--state', os.path.join(HOME, 'brightdata-talent-flows.sqlite'))
SALT_FILE = os.path.join(os.path.dirname(STATE), 'brightdata-talent-flows.salt')
# Pinned: an MCP server that auto-updates can change what is fetched, and
# billed, without anyone deciding to. Bump deliberately and re-run --fields.
SERVER_CMD = _opt('--server-cmd', 'npx -y @brightdata/mcp@2.11.3')
COUNTRY = _opt('--country', 'AU')
FILTER_FIELD = _opt('--filter-field', 'current_company_company_id')
MAX_REQUESTS = int(_opt('--max-requests', 50))
PER_SEED = int(_opt('--per-seed', 10 ** 9))
PAUSE = float(_opt('--pause', 2))
WINDOW_MONTHS = int(_opt('--window-months', 24))
LAG_MONTHS = int(_opt('--lag-months', 3))

SCHEMA = """
CREATE TABLE IF NOT EXISTS seeds (
  seed_ref     TEXT PRIMARY KEY,   -- li:<slug>
  company_id   TEXT NOT NULL,
  slug         TEXT NOT NULL,
  total        INTEGER,            -- Bright Data's total_hits when last asked
  search_after TEXT,               -- JSON cursor the next run resumes from
  exhausted    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS people (
  person_key TEXT PRIMARY KEY,     -- HMAC of the profile id; nothing else about the person
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
    """Out of quota, bad token, or Bright Data pushing back. End the run."""


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


def filter_for(slug: str) -> dict:
    leaves = [{'name': FILTER_FIELD, 'operator': '=', 'value': slug.lower()}]
    if COUNTRY and COUNTRY.lower() != 'any':
        leaves.append({'name': 'country_code', 'operator': '=', 'value': COUNTRY.upper()})
    return leaves[0] if len(leaves) == 1 else {'operator': 'and', 'filters': leaves}


def profile_of(hit) -> dict:
    """A hit is the stored record; tolerate an Elasticsearch-style wrapper
    in case the search endpoint returns one."""
    if isinstance(hit, dict) and 'experience' not in hit and isinstance(hit.get('_source'), dict):
        return hit['_source']
    return hit if isinstance(hit, dict) else {}


# ── MCP ─────────────────────────────────────────────────────────────────────

def payload(result):
    """The tool's JSON, from either SDK generation (1.x camelCase, 2.x
    snake_case).

    ANY tool error stops the run. The error text cannot be relied on to say
    why: the real server passes Bright Data's message through (its free-tier
    exhaustion message says "monthly limit"), but an MCP server can also mask
    it to "Error executing tool search_dataset", which is what the end-to-end
    test's stand-in did — and a quota error read as a transient one would be
    retried on a metered API. Stopping costs one re-run; the cursor is saved."""
    is_error = getattr(result, 'is_error', None)
    if is_error is None:
        is_error = getattr(result, 'isError', False)
    text = ' '.join(getattr(c, 'text', '') or '' for c in (getattr(result, 'content', None) or []))
    if is_error:
        raise Stop(text[:300] or 'tool error with no message')
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        raise Stop(f'unreadable tool result: {text[:200]}')


class BrightData:
    def __init__(self, session):
        self.s = session
        self.calls = 0
        self.last = 0.0

    async def call(self, tool: str, arguments: dict):
        if self.calls >= MAX_REQUESTS:
            raise Stop(f'--max-requests {MAX_REQUESTS} reached')
        wait = self.last + PAUSE - time.monotonic()
        if self.calls and wait > 0:
            await asyncio.sleep(wait)
        self.calls += 1
        try:
            res = await self.s.call_tool(tool, arguments)
        finally:
            self.last = time.monotonic()
        return payload(res)

    async def search(self, slug: str, size: int, cursor):
        body = {'dataset_id': DATASET, 'filter': filter_for(slug), 'size': size, 'sort': 'default'}
        if cursor is not None:
            body['search_after'] = cursor
        return await self.call('search_dataset', body)


async def with_server(fn):
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError:
        sys.exit('The MCP client is needed: pip install "mcp>=1.28,<3"')
    if not API_TOKEN:
        sys.exit('Set BRIGHTDATA_API_TOKEN.')
    cmd = shlex.split(SERVER_CMD)
    # The server reads API_TOKEN; GROUPS=social exposes search_dataset,
    # list_dataset_fields and the LinkedIn tools and nothing unrelated.
    env = {**os.environ, 'API_TOKEN': API_TOKEN, 'GROUPS': 'social'}
    params = StdioServerParameters(command=cmd[0], args=cmd[1:], env=env)
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as session:
            await session.initialize()
            # Caught here, inside the session: raised any further out, anyio's
            # task groups wrap it in an ExceptionGroup and it prints as a crash.
            try:
                return await fn(BrightData(session))
            except Stop as e:
                print(f'\nSTOPPED: {e}\nNothing further was requested.')
                return 3


# ── commands ────────────────────────────────────────────────────────────────

async def fields(bd: BrightData) -> int:
    got = await bd.call('list_dataset_fields', {'dataset_id': DATASET})
    rows = got if isinstance(got, list) else []
    for f in sorted(rows, key=lambda f: f.get('name', '')):
        print(f'  {f.get("name", ""):<40} {f.get("type", ""):<10} {(f.get("description") or "")[:70]}')
    names = {f.get('name') for f in rows}
    for need in (FILTER_FIELD, 'country_code'):
        print(f'\n{need}: {"filterable" if need in names else "NOT LISTED — set --filter-field / --country any"}')
    exp = sorted(n for n in names if n and 'experience' in n)
    if exp:
        print(f'experience fields listed: {exp} (a company field here would reach former employees)')
    return 0


def _parse_report(p: dict, seed: str) -> tuple[object, object, str]:
    """Parsed positions, moves, and whether the latest position is at `seed`
    (read from the work history, so it also shows a filter that matched a
    former employee)."""
    parsed = positions_from_brightdata(p)
    mv = moves_from(parsed.positions)
    ongoing = [x for x in parsed.positions if not x.end and not x.side_role]
    here = 'yes' if any(x.key == f'li:{seed.lower()}' for x in ongoing) else 'no'
    return parsed, mv, here


async def inspect(bd: BrightData, slug: str, n: int) -> int:
    res = await bd.search(slug, min(max(n, 1), PAGE), None)
    hits = res.get('hits') or []
    print(f'filter: {json.dumps(filter_for(slug))}')
    print(f'total_hits for {slug}: {res.get("total_hits")}   returned: {len(hits)}')
    if not hits:
        print('No profile matched. Check the slug and run --fields.')
        return 0
    p = profile_of(hits[0])
    print('── profile 1: experience entries (nothing else from the profile is shown) ' + '─' * 3)
    print(json.dumps(p.get('experience'), indent=1, ensure_ascii=False))
    parsed, mv, _ = _parse_report(p, slug)
    print('── positions parsed ' + '─' * 53)
    for x in parsed.positions:
        end = (x.end.iso() or x.end.year) if x.end else 'Present'
        print(f'  {x.start.iso() or x.start.year} → {end}  {x.company!r} [{x.key}]'
              f'{"  (side role)" if x.side_role else ""}')
    if parsed.dropped:
        print(f'  refused: {dict(parsed.dropped)}')
    print('── moves ' + '─' * 64)
    for m in mv.moves:
        print(f'  {m.month or "year only"}  {m.from_name} → {m.to_name}')
    if mv.skipped:
        print(f'  not counted: {dict(mv.skipped)}')
    if len(hits) > 1:
        # One line per profile: counts and the employer-to-employer moves only.
        # No titles, no dates beyond the move month, no raw entries.
        print('── every returned profile, summarised ' + '─' * 35)
        tot_pos = tot_mv = empty = 0
        refused, skipped = Counter(), Counter()
        for i, h in enumerate(hits, 1):
            p = profile_of(h)
            parsed, mv, here = _parse_report(p, slug)
            n_exp = len(p.get('experience') or []) if isinstance(p.get('experience'), list) else 0
            tot_pos += len(parsed.positions)
            tot_mv += len(mv.moves)
            empty += not parsed.positions
            refused.update(parsed.dropped)
            skipped.update(mv.skipped)
            print(f'  #{i:<2} entries={n_exp:<2} positions={len(parsed.positions):<2} '
                  f'moves={len(mv.moves):<2} current-at-{slug}={here}'
                  f'{"  refused=" + str(dict(parsed.dropped)) if parsed.dropped else ""}'
                  f'{"  not-counted=" + str(dict(mv.skipped)) if mv.skipped else ""}')
            for m in mv.moves:
                print(f'        {m.month or "year only"}  {m.from_name} → {m.to_name}')
            if parsed.dropped:
                # What a refused entry looked like: its field names and dates,
                # so a new shape can be told from missing data. Titles, urls
                # and descriptions are not printed.
                for e in p.get('experience') or []:
                    if isinstance(e, dict):
                        print(f'        entry fields={sorted(e)} start_date={e.get("start_date")!r} '
                              f'end_date={e.get("end_date")!r} company_id={e.get("company_id")!r}'
                              f'{" positions=" + str(len(e["positions"])) if isinstance(e.get("positions"), list) else ""}')
        print(f'  total: {len(hits)} profiles, {tot_pos} positions, {tot_mv} moves, '
              f'{empty} parsed to nothing')
        if refused:
            print(f'  refused, all profiles: {dict(refused)}')
        if skipped:
            print(f'  not counted, all profiles: {dict(skipped)}')
    print('\nNothing was stored.')
    return 0


async def collect(bd: BrightData, conn: sqlite3.Connection, seeds: list[tuple[str, str]]) -> int:
    key_salt = salt()
    today = dt.date.today().isoformat()
    for cid, slug in seeds:
        conn.execute('INSERT OR IGNORE INTO seeds (seed_ref, company_id, slug) VALUES (?,?,?)',
                     (f'li:{slug.lower()}', cid, slug))
    conn.commit()

    got, new_people, repeats = 0, 0, 0
    try:
        for cid, slug in seeds:
            seed_ref = f'li:{slug.lower()}'
            row = conn.execute('SELECT * FROM seeds WHERE seed_ref = ?', (seed_ref,)).fetchone()
            if row['exhausted']:
                print(f'  {slug}: already read to the end of Bright Data\'s matches')
                continue
            cursor = json.loads(row['search_after']) if row['search_after'] else None
            taken = 0
            while taken < PER_SEED:
                size = min(PAGE, PER_SEED - taken)
                res = await bd.search(slug, size, cursor)
                hits = res.get('hits') or []
                got += len(hits)
                taken += len(hits)
                cursor = res.get('search_after')
                done = not hits or cursor is None or len(hits) < size
                conn.execute('UPDATE seeds SET total = ?, search_after = ?, exhausted = ? '
                             'WHERE seed_ref = ?',
                             (res.get('total_hits'), json.dumps(cursor) if cursor is not None else None,
                              int(done), seed_ref))
                for hit in hits:
                    p = profile_of(hit)
                    pid = str(p.get('id') or p.get('linkedin_id') or '').strip()
                    if not pid:
                        continue
                    pk = person_key(f'bd:{pid}', key_salt)
                    if conn.execute('SELECT 1 FROM people WHERE person_key = ?', (pk,)).fetchone():
                        repeats += 1
                        continue
                    parsed = positions_from_brightdata(p)
                    mv = moves_from(parsed.positions)
                    # Everything personal goes before anything is written.
                    del p, pid
                    new_people += 1
                    conn.executemany('INSERT INTO moves VALUES (?,?,?,?,?,?)', [
                        (pk, m.from_ref, m.from_name, m.to_ref, m.to_name, m.month)
                        for m in mv.moves])
                    conn.execute('INSERT INTO people VALUES (?,?,?,?,?,?,?)', (
                        pk, seed_ref, today, 'ok' if parsed.positions else 'empty',
                        len(parsed.positions), json.dumps(dict(parsed.dropped)),
                        json.dumps(dict(mv.skipped))))
                del hits
                conn.commit()
                print(f'  {slug}: +{taken} profiles so far (total_hits {res.get("total_hits")}); '
                      f'{bd.calls}/{MAX_REQUESTS} requests')
                if done:
                    break
    except Stop as e:
        conn.commit()
        print(f'\nSTOPPED: {e}\nNothing further was requested.')
        return 3 if 'max-requests' not in str(e) else 0
    print(f'\n{bd.calls} requests; {got} profiles returned; {new_people} new people, '
          f'{repeats} already counted.')
    return 0


def stats(conn: sqlite3.Connection) -> int:
    rows = conn.execute('SELECT status, COUNT(*) n FROM people GROUP BY status').fetchall()
    print('people:', {r['status']: r['n'] for r in rows})
    # Refusals over EVERY profile: counting only the 'ok' ones hid why the
    # empty ones were empty, which is what the warning below asks about.
    dropped, dropped_empty, skipped = Counter(), Counter(), Counter()
    for r in conn.execute('SELECT status, dropped, skipped FROM people'):
        d = json.loads(r['dropped'] or '{}')
        dropped.update(d)
        if r['status'] == 'empty':
            dropped_empty.update(d)
        skipped.update(json.loads(r['skipped'] or '{}'))
    print(f'experience entries refused: {dict(dropped)}')
    print(f'  of which in profiles that gave nothing: {dict(dropped_empty)}')
    print(f'moves not counted: {dict(skipped)}')
    total = conn.execute('SELECT COUNT(*) FROM moves').fetchone()[0]
    undated = conn.execute('SELECT COUNT(*) FROM moves WHERE month IS NULL').fetchone()[0]
    print(f'moves: {total} ({undated} year-only, never exported)')
    for s in conn.execute("SELECT s.seed_ref, s.total, s.exhausted, "
                          "(SELECT COUNT(*) FROM people p WHERE p.seed_ref = s.seed_ref) n "
                          "FROM seeds s ORDER BY n DESC"):
        print(f'  {s["seed_ref"]:<35} {s["n"]:>6} read of {s["total"] or "?"}'
              f'{"  (all read)" if s["exhausted"] else ""}')
    empties = sum(r['n'] for r in rows if r['status'] == 'empty')
    oks = sum(r['n'] for r in rows if r['status'] == 'ok')
    if oks + empties and empties / (oks + empties) > 0.2:
        print(f'\nWARNING: {empties} of {oks + empties} profiles gave no usable positions. '
              'Run --inspect before collecting more.')
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
        'source': 'brightdata',
        'product': f'Bright Data LinkedIn people profiles ({DATASET}) via @brightdata/mcp search_dataset',
        'delivered': today.isoformat(),
        'method': (f'Bright Data LinkedIn profiles whose current employer is one of {len(sample)} '
                   f'seed companies; a move is a new employer starting within '
                   f'{MAX_GAP_MONTHS} months of the last ending; board, school and side roles excluded'),
        'scope': 'sampled profiles',
        'base_company_ref': None,
        'top_n': None,
        'filters': {'country': COUNTRY, 'filter_field': FILTER_FIELD, 'window_months': WINDOW_MONTHS,
                    'lag_months': LAG_MONTHS, 'total_hits_per_seed': totals},
        'sample': sample,
        'seeds': seeds,
        'notes': ('Counts of moves among sampled profiles, not workforce totals. Profiles are '
                  'current employees of each seed, so a flow out of a seed is only seen when '
                  f'the destination is also seeded. The window ends {LAG_MONTHS} months before '
                  'collection because profiles are updated late; that lag is an assumption, '
                  'not a measurement.'),
    }
    with open(os.path.join(out_dir, 'import.json'), 'w') as f:
        json.dump(header, f, indent=2)
    print(f'{len(rows)} company pairs, {sum(r["moves"] for r in rows)} moves, '
          f'{start} to {end}, from {sum(sample.values())} profiles -> {out_dir}')
    return 0


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


def main() -> int:
    if '--purge' in args:
        for p in (STATE, SALT_FILE):
            if os.path.exists(p):
                os.remove(p)
                print(f'deleted {p}')
        return 0
    if '--fields' in args:
        return asyncio.run(with_server(fields))
    if '--inspect' in args:
        return asyncio.run(with_server(lambda bd: inspect(bd, _opt('--inspect'), int(_opt('--n', 1)))))
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
    return asyncio.run(with_server(lambda bd: collect(bd, conn, seeds)))


if __name__ == '__main__':
    sys.exit(main())
