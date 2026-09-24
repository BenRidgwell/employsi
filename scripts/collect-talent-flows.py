#!/usr/bin/env python3
"""Talent flows from a sample of LinkedIn profiles, collected on YOUR machine.

WHAT IT DOES
Drives stickerdaniel/linkedin-mcp-server (your own signed-in LinkedIn session,
in a browser on this machine) over MCP stdio:

  1. For each seed company, get_company_employees(<linkedin slug>) lists some
     current employees (the server returns about a dozen profile links a call).
  2. For each person not already seen, get_person_profile(sections=
     "experience") fetches their dated work history.
  3. scripts/talent_flows.py turns that into employer-to-employer moves.
  4. The moves are kept in a local SQLite file under a salted hash of the
     profile name. The page text, the name, the profile url and the job
     titles are discarded as soon as the profile is parsed.

`--export` then writes the canonical files docs/talent-flows-plan.md
describes, which scripts/flows-to-d1.py loads. Only company-to-company COUNTS
ever leave this machine.

READ BEFORE RUNNING
- This uses your LinkedIn account. LinkedIn's User Agreement prohibits
  automated access, and the usual consequence is a restricted account. That is
  your call; this script does not try to hide what it is doing from LinkedIn.
  It uses the server exactly as shipped: no proxy, no second account, no
  randomised timing, and it STOPS on the first rate-limit, checkpoint or
  sign-in signal instead of retrying past it.
- The people whose profiles are read have not been asked. The Privacy Act
  applies to collecting their information even transiently; the
  minimisation above (hash, discard, counts only) reduces what is held, it
  does not make the question go away.
- The defaults (40 profiles a run, 60s apart) are a courtesy pace for a
  personal account, not a measured safe limit. No limit is measured.

WHAT THE NUMBERS MEAN
A sample: people LinkedIn lists as current employees of the seed companies,
up to the budget. It over-represents whoever LinkedIn shows first and people
who keep their profile current, and it sees a "lost to" flow only when the
destination is also seeded. The export says `count_kind: sampled` and carries
the per-company sample size so the app can say "N moves among M profiles"
rather than implying a workforce total.

SETUP (once)
    pip install "mcp>=1.28,<3"
    uvx mcp-server-linkedin@4.24.4 --login     # sign in by hand in the window

USAGE
    # calibrate the parser against one real profile; stores nothing
    python scripts/collect-talent-flows.py --inspect some-username

    # collect. Seeds: app company id = LinkedIn company slug
    python scripts/collect-talent-flows.py --seed bhp=bhp --seed perth-wds=woodside-energy
    # or every roster company whose slug is confirmed in D1 (company_slugs)
    CLOUDFLARE_API_TOKEN=... python scripts/collect-talent-flows.py --seed-from-d1

    python scripts/collect-talent-flows.py --stats
    python scripts/collect-talent-flows.py --export out/     # flows.csv + import.json

    python scripts/collect-talent-flows.py --purge           # delete local state

Options:
    --max-profiles N   profiles fetched this run (default 40)
    --pause S          seconds between LinkedIn calls (default 60)
    --state PATH       local SQLite (default ~/.employsi/talent-flows.sqlite)
    --server-cmd CMD   MCP server command (default "uvx mcp-server-linkedin@4.24.4")
    --window-months N  export window length (default 24)
    --lag-months N     months before the export date the window ends (default 3)

The server version is PINNED because the README's own @latest auto-update
changes the code driving your account without asking. Bump it deliberately
(and re-run --inspect) when LinkedIn's layout moves.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import re
import secrets
import shlex
import sqlite3
import sys
import time
import urllib.request
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from talent_flows import (  # noqa: E402
    MAX_GAP_MONTHS, aggregate, moves_from, parse_experience, person_key)

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


def _all(name) -> list[str]:
    return [args[i + 1] for i, a in enumerate(args) if a == name and i + 1 < len(args)]


HOME = os.path.expanduser('~/.employsi')
STATE = _opt('--state', os.path.join(HOME, 'talent-flows.sqlite'))
SALT_FILE = os.path.join(os.path.dirname(STATE), 'talent-flows.salt')
SERVER_CMD = _opt('--server-cmd', 'uvx mcp-server-linkedin@4.24.4')
MAX_PROFILES = int(_opt('--max-profiles', 40))
PAUSE = float(_opt('--pause', 60))
WINDOW_MONTHS = int(_opt('--window-months', 24))
LAG_MONTHS = int(_opt('--lag-months', 3))
# A call that fails this many times running, for reasons that are NOT a rate
# limit, stops the run anyway: a broken session looks like this too.
MAX_CONSECUTIVE_ERRORS = 3

# Anything that smells of LinkedIn pushing back. Matched against the error
# text the server returns; a false positive only ends a run early.
STOP_SIGNAL = re.compile(
    r'rate.?limit|too many|checkpoint|captcha|challenge|authwall|security '
    r'verification|verify|sign.?in|log.?in|authenticat|restricted|blocked',
    re.IGNORECASE)

SCHEMA = """
CREATE TABLE IF NOT EXISTS seeds (
  seed_ref   TEXT PRIMARY KEY,   -- li:<slug>
  company_id TEXT NOT NULL,
  slug       TEXT NOT NULL
);
-- One row per profile read. person_key is an HMAC of the vanity name under a
-- salt kept beside this file; nothing else about the person is stored.
CREATE TABLE IF NOT EXISTS people (
  person_key TEXT PRIMARY KEY,
  seed_ref   TEXT NOT NULL,      -- the company whose list they were found on
  fetched    TEXT NOT NULL,      -- YYYY-MM-DD
  status     TEXT NOT NULL,      -- ok | empty | error
  positions  INTEGER NOT NULL DEFAULT 0,
  dropped    TEXT,               -- JSON counter of positions the parser refused
  skipped    TEXT                -- JSON counter of moves the rules refused
);
CREATE TABLE IF NOT EXISTS moves (
  person_key TEXT NOT NULL,
  from_ref   TEXT NOT NULL,
  from_name  TEXT NOT NULL,
  to_ref     TEXT NOT NULL,
  to_name    TEXT NOT NULL,
  month      TEXT                -- YYYY-MM; NULL when the profile gave years only
);
CREATE INDEX IF NOT EXISTS idx_moves_person ON moves (person_key);
"""


class Stop(Exception):
    """LinkedIn pushed back, or the session is not usable. End the run."""


def db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    conn = sqlite3.connect(STATE)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def salt() -> bytes:
    """Created once, kept beside the state, never printed. Losing it only
    means people already read would be read (and counted) again."""
    os.makedirs(os.path.dirname(SALT_FILE), exist_ok=True)
    if not os.path.exists(SALT_FILE):
        fd = os.open(SALT_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(secrets.token_hex(32))
    with open(SALT_FILE) as f:
        return bytes.fromhex(f.read().strip())


# ── MCP ─────────────────────────────────────────────────────────────────────

def payload(result) -> dict:
    """The tool's dict, from either SDK generation (1.x camelCase attributes,
    2.x snake_case). Raises Stop on an error that looks like push-back."""
    is_error = getattr(result, 'is_error', None)
    if is_error is None:
        is_error = getattr(result, 'isError', False)
    content = getattr(result, 'content', None) or []
    text = ' '.join(getattr(c, 'text', '') or '' for c in content)
    if is_error:
        if STOP_SIGNAL.search(text):
            raise Stop(text[:300])
        raise RuntimeError(text[:300] or 'tool error')
    structured = getattr(result, 'structured_content', None)
    if structured is None:
        structured = getattr(result, 'structuredContent', None)
    if isinstance(structured, dict):
        # FastMCP wraps non-object returns as {"result": ...}.
        return structured.get('result', structured) if len(structured) == 1 else structured
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        raise RuntimeError(f'unreadable tool result: {text[:200]}')


def check_sections(data: dict) -> None:
    for name, err in (data.get('section_errors') or {}).items():
        if isinstance(err, dict) and err.get('error_type') == 'rate_limit':
            raise Stop(f'{name}: {err.get("error_message")}')


class LinkedIn:
    def __init__(self, session):
        self.s = session
        self.calls = 0
        self.last = 0.0

    async def call(self, tool: str, arguments: dict) -> dict:
        wait = self.last + PAUSE - time.monotonic()
        if self.calls and wait > 0:
            await asyncio.sleep(wait)
        self.calls += 1
        try:
            res = await self.s.call_tool(tool, arguments)
        finally:
            self.last = time.monotonic()
        data = payload(res)
        check_sections(data)
        return data

    async def employees(self, slug: str) -> list[str]:
        data = await self.call('get_company_employees', {'company_name': slug})
        refs = (data.get('references') or {}).get('employees') or []
        out = []
        for r in refs:
            m = re.search(r'/in/([^/?#]+)', str(r.get('url') or '')) if r.get('kind') == 'person' else None
            if m and m.group(1) not in out:
                out.append(m.group(1))
        return out

    async def experience(self, username: str) -> tuple[str, list]:
        data = await self.call('get_person_profile',
                               {'linkedin_username': username, 'sections': 'experience'})
        text = (data.get('sections') or {}).get('experience') or ''
        refs = (data.get('references') or {}).get('experience') or []
        return text, refs


async def with_server(fn):
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError:
        sys.exit('The MCP client is needed: pip install "mcp>=1.28,<3"')
    cmd = shlex.split(SERVER_CMD)
    params = StdioServerParameters(
        command=cmd[0], args=cmd[1:] + ['--transport', 'stdio'],
        env={**os.environ, 'UV_HTTP_TIMEOUT': '300'})
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as session:
            await session.initialize()
            return await fn(LinkedIn(session))


# ── commands ────────────────────────────────────────────────────────────────

async def inspect(li: LinkedIn, username: str) -> int:
    text, refs = await li.experience(username)
    print('── raw experience text ' + '─' * 50)
    print(text or '(empty)')
    print('── company references ' + '─' * 51)
    for r in refs:
        print(f'  {r.get("kind"):8} {r.get("url")}  {r.get("text", "")}')
    parsed = parse_experience(text, refs)
    print('── positions parsed ' + '─' * 53)
    for p in parsed.positions:
        end = p.end.iso() or p.end.year if p.end else 'Present'
        print(f'  {p.start.iso() or p.start.year} → {end}  {p.company!r} '
              f'[{p.key}]  {p.title!r}{"  (side role)" if p.side_role else ""}')
    if parsed.dropped:
        print(f'  dropped: {dict(parsed.dropped)}')
    mv = moves_from(parsed.positions)
    print('── moves ' + '─' * 64)
    for m in mv.moves:
        print(f'  {m.month or "year only"}  {m.from_name} → {m.to_name}')
    if mv.skipped:
        print(f'  not counted: {dict(mv.skipped)}')
    print('\nNothing was stored.')
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


async def collect(li: LinkedIn, conn: sqlite3.Connection, seeds: list[tuple[str, str]]) -> int:
    key_salt = salt()
    today = dt.date.today().isoformat()
    for cid, slug in seeds:
        conn.execute('INSERT OR REPLACE INTO seeds VALUES (?,?,?)', (f'li:{slug.lower()}', cid, slug))
    conn.commit()

    fetched, errors_in_a_row = 0, 0
    # Round-robin: one profile per seed per pass, fetching a seed's employee
    # list the first time it comes up. A budget smaller than the roster then
    # samples many companies a little instead of the first company a lot.
    pending = list(seeds)
    queues: dict[str, list[str]] = {}

    def failed(e: Exception) -> None:
        nonlocal errors_in_a_row
        errors_in_a_row += 1
        if errors_in_a_row >= MAX_CONSECUTIVE_ERRORS:
            raise Stop(f'{errors_in_a_row} failures in a row; last: {e}')

    try:
        while fetched < MAX_PROFILES and pending:
            for seed in list(pending):
                if fetched >= MAX_PROFILES:
                    break
                slug = seed[1]
                seed_ref = f'li:{slug.lower()}'
                if slug not in queues:
                    try:
                        people = await li.employees(slug)
                        errors_in_a_row = 0
                    except Stop:
                        raise
                    except Exception as e:  # noqa: BLE001
                        print(f'  {slug}: employee list failed: {e}')
                        queues[slug] = []
                        pending.remove(seed)
                        failed(e)
                        continue
                    queues[slug] = [u for u in people if not conn.execute(
                        'SELECT 1 FROM people WHERE person_key = ?',
                        (person_key(u, key_salt),)).fetchone()]
                    print(f'  {slug}: {len(people)} listed, {len(queues[slug])} not yet read')
                if not queues[slug]:
                    pending.remove(seed)
                    continue

                username = queues[slug].pop(0)
                pk = person_key(username, key_salt)
                try:
                    text, refs = await li.experience(username)
                    errors_in_a_row = 0
                except Stop:
                    raise
                except Exception as e:  # noqa: BLE001
                    conn.execute('INSERT OR REPLACE INTO people VALUES (?,?,?,?,?,?,?)',
                                 (pk, seed_ref, today, 'error', 0, None, None))
                    conn.commit()
                    failed(e)
                    continue
                fetched += 1
                parsed = parse_experience(text, refs)
                mv = moves_from(parsed.positions)
                # Everything personal goes before anything is written.
                del text, refs, username
                status = 'ok' if parsed.positions else 'empty'
                conn.execute('DELETE FROM moves WHERE person_key = ?', (pk,))
                conn.executemany('INSERT INTO moves VALUES (?,?,?,?,?,?)', [
                    (pk, m.from_ref, m.from_name, m.to_ref, m.to_name, m.month) for m in mv.moves])
                conn.execute('INSERT OR REPLACE INTO people VALUES (?,?,?,?,?,?,?)', (
                    pk, seed_ref, today, status, len(parsed.positions),
                    json.dumps(dict(parsed.dropped)), json.dumps(dict(mv.skipped))))
                conn.commit()
                print(f'    profile {fetched}/{MAX_PROFILES} ({slug}): '
                      f'{len(parsed.positions)} positions, {len(mv.moves)} moves')
    except Stop as e:
        print(f'\nSTOPPED: {e}\nLinkedIn pushed back or the session is not usable. '
              'Nothing was retried. Wait before running again.')
        return 3
    print(f'\n{fetched} profiles read, {li.calls} LinkedIn calls.')
    return 0


def stats(conn: sqlite3.Connection) -> int:
    rows = conn.execute('SELECT status, COUNT(*) n FROM people GROUP BY status').fetchall()
    print('profiles:', {r['status']: r['n'] for r in rows})
    dropped, skipped = Counter(), Counter()
    for r in conn.execute("SELECT dropped, skipped FROM people WHERE status = 'ok'"):
        dropped.update(json.loads(r['dropped'] or '{}'))
        skipped.update(json.loads(r['skipped'] or '{}'))
    positions = conn.execute('SELECT COALESCE(SUM(positions),0) FROM people').fetchone()[0]
    print(f'positions parsed: {positions}; refused by the parser: {dict(dropped)}')
    print(f'moves not counted: {dict(skipped)}')
    total = conn.execute('SELECT COUNT(*) FROM moves').fetchone()[0]
    undated = conn.execute('SELECT COUNT(*) FROM moves WHERE month IS NULL').fetchone()[0]
    print(f'moves: {total} ({undated} year-only, never exported)')
    per_seed = conn.execute(
        "SELECT seed_ref, COUNT(*) n FROM people WHERE status = 'ok' GROUP BY seed_ref ORDER BY n DESC").fetchall()
    print('sample per seed:', {r['seed_ref']: r['n'] for r in per_seed})
    # A parser that has stopped understanding the page shows up here first.
    empties = sum(r['n'] for r in rows if r['status'] == 'empty')
    oks = sum(r['n'] for r in rows if r['status'] == 'ok')
    if oks + empties and empties / (oks + empties) > 0.2:
        print(f'\nWARNING: {empties} of {oks + empties} profiles parsed to nothing. '
              'Run --inspect on one before collecting more.')
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
    os.makedirs(out_dir, exist_ok=True)
    cols = ['from_ref', 'from_name', 'to_ref', 'to_name', 'period_start', 'period_end',
            'moves', 'count_kind']
    import csv
    with open(os.path.join(out_dir, 'flows.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    header = {
        'source': 'linkedin-sample',
        'product': 'linkedin-mcp-server get_person_profile(experience)',
        'delivered': today.isoformat(),
        'method': (f'Sampled LinkedIn profiles of current employees of {len(sample)} seed '
                   f'companies; a move is a new employer starting within '
                   f'{MAX_GAP_MONTHS} months of the last ending; side roles excluded'),
        'scope': 'sampled profiles',
        'base_company_ref': None,
        'top_n': None,
        'filters': {'window_months': WINDOW_MONTHS, 'lag_months': LAG_MONTHS},
        'sample': sample,
        'seeds': seeds,
        'notes': ('Counts of moves among sampled profiles, not workforce totals. '
                  f'The window ends {LAG_MONTHS} months before collection because '
                  'profiles are updated late; that lag is an assumption, not a '
                  'measurement.'),
    }
    with open(os.path.join(out_dir, 'import.json'), 'w') as f:
        json.dump(header, f, indent=2)
    print(f'{len(rows)} company pairs, {sum(r["moves"] for r in rows)} moves, '
          f'{start} to {end}, from {sum(sample.values())} profiles -> {out_dir}')
    return 0


def main() -> int:
    if '--purge' in args:
        for p in (STATE, SALT_FILE):
            if os.path.exists(p):
                os.remove(p)
                print(f'deleted {p}')
        return 0
    if '--inspect' in args:
        return asyncio.run(with_server(lambda li: inspect(li, _opt('--inspect'))))
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
    return asyncio.run(with_server(lambda li: collect(li, conn, seeds)))


if __name__ == '__main__':
    sys.exit(main())
