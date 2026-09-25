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
    --skills              re-read a seed on its own cursor to record skills for profiles
                          counted before skills were kept (new profiles are counted in full)
    --restart             drop the seeds' saved cursors and read from the top
                          (needed after a dataset refresh; see collect())
    --pause S             seconds between calls (default 2)
    --server-cmd CMD      MCP server command (default "npx -y @brightdata/mcp@2.11.3")
    --state PATH          local SQLite (default ~/.employsi/brightdata-talent-flows.sqlite)
    --window-months N     export window length (default 24)
    --lag-months N        the latest a window may end, in months before today (default 3);
                          it ends earlier, at the last month the data covers, when that is earlier
    --sync-d1             push new profiles' counts + keys and the cursors to D1 (0003)
    --pull-d1             fetch the cursors and counted keys from D1 before a run here
    --from-d1             with --export: export everything synced, from any machine
    --purge               delete local state and salt
"""
from __future__ import annotations

import asyncio
import csv
import datetime as dt
import hashlib
import json
import os
import secrets
import shlex
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from talent_flows import (  # noqa: E402
    MAX_GAP_MONTHS, aggregate, coverage_end, exclusion_report, moves_from, person_key,
    positions_from_brightdata, skills_of, tail_counts, window_note)

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
  status     TEXT NOT NULL,        -- ok | empty | remote (counted on another machine; key only)
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
-- Skills of the job each move went into (talent_flows.skills_of), one row per
-- skill. No title: the matcher's answer is kept, the text is not.
CREATE TABLE IF NOT EXISTS skill_moves (
  person_key TEXT NOT NULL,
  from_ref   TEXT NOT NULL,
  from_name  TEXT NOT NULL,
  to_ref     TEXT NOT NULL,
  to_name    TEXT NOT NULL,
  month      TEXT NOT NULL,
  skill      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_moves_person ON skill_moves (person_key);
-- Profiles whose skills are recorded. Separate from `people` because the
-- skills pass re-reads profiles counted before skills were kept.
CREATE TABLE IF NOT EXISTS skill_people (
  person_key TEXT PRIMARY KEY,
  seed_ref   TEXT NOT NULL,
  status     TEXT NOT NULL,        -- ok | empty | remote
  synced     INTEGER NOT NULL DEFAULT 0
);
"""


class Stop(Exception):
    """Out of quota, bad token, or Bright Data pushing back. End the run."""


def db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    conn = sqlite3.connect(STATE)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    if 'synced' not in {r['name'] for r in conn.execute('PRAGMA table_info(people)')}:
        conn.execute('ALTER TABLE people ADD COLUMN synced INTEGER NOT NULL DEFAULT 0')
    return conn


def salt() -> bytes:
    """The HMAC key behind every person_key. BRIGHTDATA_FLOWS_SALT (hex) wins
    over the local file, so keys stay the same on a new machine; without it,
    profiles already in D1 would get new keys and be counted twice. It is
    never written to D1."""
    env = os.environ.get('BRIGHTDATA_FLOWS_SALT', '').strip()
    have_file = os.path.exists(SALT_FILE)
    if env:
        if have_file:
            with open(SALT_FILE) as f:
                if f.read().strip() != env:
                    sys.exit(f'BRIGHTDATA_FLOWS_SALT differs from {SALT_FILE}: the keys already '
                             'stored would not match new ones. Keep one salt.')
        return bytes.fromhex(env)
    os.makedirs(os.path.dirname(SALT_FILE), exist_ok=True)
    if not have_file:
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


def _record_skills(conn: sqlite3.Connection, pk: str, seed_ref: str, parsed, mv) -> None:
    """The skill rows for one profile's dated moves, and its mark in
    skill_people. Titles are read by skills_of() and not kept."""
    conn.executemany('INSERT INTO skill_moves VALUES (?,?,?,?,?,?,?)', [
        (pk, m.from_ref, m.from_name, m.to_ref, m.to_name, m.month, sk)
        for m in mv.moves if m.month for sk in skills_of(m)])
    conn.execute('INSERT OR IGNORE INTO skill_people (person_key, seed_ref, status) VALUES (?,?,?)',
                 (pk, seed_ref, 'ok' if parsed.positions else 'empty'))


# --skills: the pass that re-reads a seed to record skills for profiles counted
# before skills were kept. It walks its own cursor ('skills:' + seed_ref), so
# the main cursor is left where it was; a profile not yet counted at all is
# counted in full on the way, so the pass also finishes an unfinished seed.
SKILLS_PASS = '--skills' in args


def _cursor_ref(slug: str) -> str:
    return ('skills:' if SKILLS_PASS else '') + f'li:{slug.lower()}'


async def collect(bd: BrightData, conn: sqlite3.Connection, seeds: list[tuple[str, str]]) -> int:
    key_salt = salt()
    today = dt.date.today().isoformat()
    for cid, slug in seeds:
        conn.execute('INSERT OR IGNORE INTO seeds (seed_ref, company_id, slug) VALUES (?,?,?)',
                     (_cursor_ref(slug), cid, slug))
        if '--restart' in args:
            # A saved cursor does not survive a dataset refresh: measured
            # 2026-09-25, a cursor saved the day before failed twice with
            # "HTTP 500: Response Error" while a fresh search worked and
            # total_hits had moved (21,360 -> 21,358). Restarting re-reads
            # from the top; people already counted are skipped by key, so
            # the cost is the requests spent re-reading them.
            conn.execute('UPDATE seeds SET search_after = NULL, exhausted = 0 WHERE seed_ref = ?',
                         (_cursor_ref(slug),))
    conn.commit()

    got, new_people, repeats, skill_only = 0, 0, 0, 0
    try:
        for cid, slug in seeds:
            seed_ref = f'li:{slug.lower()}'
            cursor_ref = _cursor_ref(slug)
            row = conn.execute('SELECT * FROM seeds WHERE seed_ref = ?', (cursor_ref,)).fetchone()
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
                              int(done), cursor_ref))
                for hit in hits:
                    p = profile_of(hit)
                    pid = str(p.get('id') or p.get('linkedin_id') or '').strip()
                    if not pid:
                        continue
                    pk = person_key(f'bd:{pid}', key_salt)
                    if conn.execute('SELECT 1 FROM people WHERE person_key = ?', (pk,)).fetchone():
                        if SKILLS_PASS and not conn.execute(
                                'SELECT 1 FROM skill_people WHERE person_key = ?', (pk,)).fetchone():
                            parsed = positions_from_brightdata(p)
                            mv = moves_from(parsed.positions)
                            del p, pid
                            _record_skills(conn, pk, seed_ref, parsed, mv)
                            skill_only += 1
                        else:
                            repeats += 1
                        continue
                    parsed = positions_from_brightdata(p)
                    mv = moves_from(parsed.positions)
                    # Everything personal goes before anything is written.
                    del p, pid
                    new_people += 1
                    _record_skills(conn, pk, seed_ref, parsed, mv)
                    conn.executemany('INSERT INTO moves VALUES (?,?,?,?,?,?)', [
                        (pk, m.from_ref, m.from_name, m.to_ref, m.to_name, m.month)
                        for m in mv.moves])
                    # Named columns: `synced` is added by migration on an
                    # older file, and a positional insert broke on it.
                    conn.execute('INSERT INTO people (person_key, seed_ref, fetched, status, '
                                 'positions, dropped, skipped) VALUES (?,?,?,?,?,?,?)', (
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
          f'{skill_only} given skills, {repeats} already counted.')
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
    cap = month_add(today.strftime('%Y-%m'), -LAG_MONTHS)
    # The window ends where the data does (talent_flows.coverage_end), so the
    # month totals are read before anything else.
    if '--from-d1' in args:
        per_month = {r['month']: int(r['n']) for r in d1(
            'SELECT month, SUM(moves) n FROM flow_collect_moves WHERE source = ? GROUP BY month',
            [SOURCE])}
    else:
        per_month = {r['month']: r['n'] for r in conn.execute(
            "SELECT m.month, COUNT(*) n FROM moves m JOIN people p USING (person_key) "
            "WHERE p.status = 'ok' AND m.month IS NOT NULL GROUP BY m.month")}
    end = coverage_end(per_month, cap)
    if end is None:
        sys.exit('No month is covered: nothing to export.')
    start = month_add(end, -(WINDOW_MONTHS - 1))
    if '--from-d1' in args:
        # Everything synced, from any machine. Run --sync-d1 first so this
        # machine's own profiles are in it.
        moves = [m for r in d1('SELECT from_ref, from_name, to_ref, to_name, month, '
                               'SUM(moves) n FROM flow_collect_moves WHERE source = ? '
                               'AND month BETWEEN ? AND ? GROUP BY 1,2,3,4,5',
                               [SOURCE, start, end])
                 for m in [dict(r)] * int(r['n'])]
        sample = {r['seed_ref']: int(r['n']) for r in d1(
            'SELECT seed_ref, SUM(profiles_ok) n FROM flow_collect_batch WHERE source = ? '
            'GROUP BY seed_ref', [SOURCE])}
        seed_rows = d1('SELECT seed_ref, company_id, total FROM flow_collect_seed WHERE source = ?',
                       [SOURCE])
    else:
        moves = [dict(r) for r in conn.execute(
            "SELECT m.* FROM moves m JOIN people p USING (person_key) WHERE p.status = 'ok'")]
        sample = {r['seed_ref']: r['n'] for r in conn.execute(
            "SELECT seed_ref, COUNT(*) n FROM people WHERE status = 'ok' GROUP BY seed_ref")}
        seed_rows = [dict(r) for r in conn.execute('SELECT * FROM seeds')]
    excluded: Counter = Counter()
    rows = aggregate(moves, start, end, excluded)
    if not sample:
        sys.exit('Nothing collected yet.')
    # The skills pass keeps its own cursors ('skills:li:…'); they are not seeds.
    seed_rows = [r for r in seed_rows if not str(r['seed_ref']).startswith('skills:')]
    seeds = {r['seed_ref']: r['company_id'] for r in seed_rows}
    totals = {r['seed_ref']: r['total'] for r in seed_rows}
    os.makedirs(out_dir, exist_ok=True)
    skill_rows, skill_sample = _export_skills(conn, out_dir, start, end)
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
                    'lag_months': LAG_MONTHS, 'window_end': end, 'window_end_cap': cap,
                    'window_end_rule': 'last month holding moves, with the two before it '
                                       'holding moves too, no later than the cap',
                    'moves_per_month_to_end': tail_counts(per_month, end),
                    'total_hits_per_seed': totals,
                    'excluded': exclusion_report(excluded)},
        'sample': sample,
        'seeds': seeds,
        # skill_flows.csv: the same window and the same exclusions, per skill.
        # A move's skills are those of the job it went INTO (skillsForText on
        # its title). A move can carry several skills or none, so skill rows
        # do not sum to the company rows. They rest on skill_sample, which
        # falls short of `sample` until the skills pass has re-read a seed.
        'skills': {'basis': 'skills of the job moved into, by skillsForText',
                   'sample': skill_sample, 'rows': len(skill_rows)},
        'notes': ('Counts of moves among sampled profiles, not workforce totals. Profiles are '
                  'current employees of each seed, so a flow out of a seed is only seen when '
                  f'the destination is also seeded. ' + window_note(end, cap)
                  + (f' {sum(n for k, n in excluded.items() if k[0] != "merged")} moves are '
                     'excluded: transfers between an acquired company and its buyer after '
                     'completion, moves inside one employer (between two of its own '
                     'LinkedIn pages), and moves to or from a way of working rather than an '
                     'employer, such as Freelance. Pages that are an employer\'s own '
                     'subsidiary or site are counted under the employer '
                     '(filters.excluded).' if excluded else '')),
    }
    with open(os.path.join(out_dir, 'import.json'), 'w') as f:
        json.dump(header, f, indent=2)
    print(f'{len(rows)} company pairs, {sum(r["moves"] for r in rows)} moves, '
          f'{start} to {end}, from {sum(sample.values())} profiles -> {out_dir}')
    for (why, a, b), n in sorted(excluded.items()):
        verb = 'counted under its employer' if why == 'merged' else f'excluded, {why}'
        print(f'  {verb}: {a} {"/" if why in ("not_employer", "merged") else "->"} {b}: {n}')
    return 0


def _export_skills(conn: sqlite3.Connection, out_dir: str, start: str, end: str):
    """skill_flows.csv: company-pair rows per skill, through aggregate() so
    every exclusion the company rows get applies here too."""
    if '--from-d1' in args:
        try:
            raw = d1('SELECT from_ref, from_name, to_ref, to_name, month, skill, SUM(moves) n '
                     'FROM flow_collect_skill_moves WHERE source = ? AND month BETWEEN ? AND ? '
                     'GROUP BY 1,2,3,4,5,6', [SOURCE, start, end])
            skill_sample = {r['seed_ref']: int(r['n']) for r in d1(
                'SELECT seed_ref, SUM(profiles_ok) n FROM flow_collect_skill_batch '
                'WHERE source = ? GROUP BY seed_ref', [SOURCE])}
        except RuntimeError:
            raw, skill_sample = [], {}   # 0004 not applied: no skills yet
        by_skill: dict[str, list] = defaultdict(list)
        for r in raw:
            by_skill[r['skill']].extend([dict(r)] * int(r['n']))
    else:
        by_skill = defaultdict(list)
        for r in conn.execute("SELECT s.* FROM skill_moves s JOIN skill_people p USING (person_key) "
                              "WHERE p.status = 'ok'"):
            by_skill[r['skill']].append(dict(r))
        skill_sample = {r['seed_ref']: r['n'] for r in conn.execute(
            "SELECT seed_ref, COUNT(*) n FROM skill_people WHERE status = 'ok' GROUP BY seed_ref")}
    rows = []
    for skill in sorted(by_skill):
        for r in aggregate(by_skill[skill], start, end):
            rows.append({**r, 'skill': skill})
    cols = ['from_ref', 'from_name', 'to_ref', 'to_name', 'period_start', 'period_end',
            'skill', 'moves', 'count_kind']
    with open(os.path.join(out_dir, 'skill_flows.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f'{len(rows)} skill rows over {len(by_skill)} skills, '
          f'from {sum(skill_sample.values())} profiles with skills')
    return rows, skill_sample


# ── D1: collection state (workers/jobs-cron/migrations/0003) ────────────────

SOURCE = 'brightdata'
MIN_BATCH = 20  # fewer new profiles than this wait: a batch of one IS a person's history
D1_API = ('https://api.cloudflare.com/client/v4/accounts/'
          f'{os.environ.get("CF_ACCOUNT_ID") or "080a66721e2d85950d9d7dc939e08b76"}/d1/database/'
          f'{os.environ.get("D1_DATABASE_ID") or "1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1"}/query')


def d1(sql: str, params: list | None = None) -> list[dict]:
    token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
    if not token:
        sys.exit('D1 needs CLOUDFLARE_API_TOKEN.')
    body = json.dumps({'sql': sql, 'params': params or []}).encode()
    req = urllib.request.Request(D1_API, data=body, headers={
        'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.loads(r.read().decode())
            if j.get('success'):
                return j['result'][0].get('results') or []
            raise RuntimeError(str(j.get('errors'))[:300])
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            if attempt == 3:
                sys.exit(f'D1 {e.code}: {detail}')
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
        time.sleep(attempt + 1)
    return []


def _chunks(rows: list, width: int):
    per = max(1, 100 // width)  # D1 caps a statement at 100 bound params
    for i in range(0, len(rows), per):
        yield rows[i:i + per]


def sync_d1(conn: sqlite3.Connection) -> int:
    """Both halves: the profiles' move counts, then their skill counts."""
    rc = _sync_people(conn)
    return rc or _sync_skills(conn)


def _sync_skills(conn: sqlite3.Connection) -> int:
    """Skill counts (0004) for profiles whose skills were recorded here but
    not yet synced, as one batch, with the same rules as the move counts:
    MIN_BATCH, a batch id derived from the batch's keys, OR IGNORE, counts
    before keys before the local mark."""
    now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    people = [dict(r) for r in conn.execute(
        "SELECT * FROM skill_people WHERE synced = 0 AND status IN ('ok', 'empty') "
        "ORDER BY person_key")]
    if not people:
        print('no new skill profiles to sync.')
        return 0
    if len(people) < MIN_BATCH:
        print(f'{len(people)} skill profiles wait here until there are {MIN_BATCH}.')
        return 0
    keys = [p['person_key'] for p in people]
    batch = 'sk' + hashlib.sha256('\n'.join(keys).encode()).hexdigest()[:14]
    per_seed: Counter = Counter()
    per_seed_ok: Counter = Counter()
    for p in people:
        per_seed[p['seed_ref']] += 1
        per_seed_ok[p['seed_ref']] += p['status'] == 'ok'
    counts: Counter = Counter()
    marks = ','.join('?' * len(keys))
    for m in conn.execute(f'SELECT * FROM skill_moves WHERE person_key IN ({marks})', keys):
        counts[(m['from_ref'], m['from_name'], m['to_ref'], m['to_name'], m['month'],
                m['skill'])] += 1
    rows = [(batch, SOURCE, *k, n) for k, n in counts.items()]
    for chunk in _chunks(rows, 9):
        d1('INSERT OR IGNORE INTO flow_collect_skill_moves (batch_id, source, from_ref, '
           'from_name, to_ref, to_name, month, skill, moves) VALUES '
           + ','.join(['(?,?,?,?,?,?,?,?,?)'] * len(chunk)), [v for r in chunk for v in r])
    for seed_ref, n in per_seed.items():
        d1('INSERT OR IGNORE INTO flow_collect_skill_batch (batch_id, seed_ref, source, '
           'profiles_ok, profiles_empty, synced_at) VALUES (?,?,?,?,?,?)',
           [batch, seed_ref, SOURCE, per_seed_ok[seed_ref], n - per_seed_ok[seed_ref], now])
    for chunk in _chunks(keys, 1):
        d1('INSERT OR IGNORE INTO flow_collect_skill_seen (person_key) VALUES '
           + ','.join(['(?)'] * len(chunk)), chunk)
    conn.executemany('UPDATE skill_people SET synced = 1 WHERE person_key = ?',
                     [(k,) for k in keys])
    conn.commit()
    print(f'synced skill batch {batch}: {len(keys)} profiles, {len(rows)} month-pair-skill rows '
          f'({sum(counts.values())} skill moves).')
    return 0


def _sync_people(conn: sqlite3.Connection) -> int:
    """Push profiles counted here but not yet in D1, as one batch.

    Order matters for a sync that dies half way: counts first, keys next,
    the local 'synced' mark last. Every insert is OR IGNORE under a batch_id
    derived from the batch's own keys, so re-running the same sync rewrites
    nothing, and a key is only ever marked seen alongside its counts."""
    now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    for r in conn.execute('SELECT * FROM seeds'):
        d1('INSERT INTO flow_collect_seed (seed_ref, source, company_id, slug, total, '
           'search_after, exhausted, updated_at) VALUES (?,?,?,?,?,?,?,?) '
           'ON CONFLICT(seed_ref) DO UPDATE SET total = excluded.total, '
           'search_after = excluded.search_after, exhausted = excluded.exhausted, '
           'updated_at = excluded.updated_at',
           [r['seed_ref'], SOURCE, r['company_id'], r['slug'], r['total'], r['search_after'],
            r['exhausted'], now])
    people = [dict(r) for r in conn.execute(
        "SELECT * FROM people WHERE synced = 0 AND status IN ('ok', 'empty') ORDER BY person_key")]
    if not people:
        print('seed cursors synced; no new profiles to sync.')
        return 0
    if len(people) < MIN_BATCH:
        print(f'seed cursors synced; {len(people)} new profiles wait here until there are '
              f'{MIN_BATCH} (a smaller batch would be close to one person\'s history).')
        return 0
    keys = [p['person_key'] for p in people]
    batch = hashlib.sha256('\n'.join(keys).encode()).hexdigest()[:16]

    per_seed: dict[str, dict] = {}
    for p in people:
        b = per_seed.setdefault(p['seed_ref'], {'ok': 0, 'empty': 0, 'refused': Counter(),
                                                'skipped': Counter(), 'year_only': 0})
        b['ok' if p['status'] == 'ok' else 'empty'] += 1
        b['refused'].update(json.loads(p['dropped'] or '{}'))
        b['skipped'].update(json.loads(p['skipped'] or '{}'))
    counts: Counter = Counter()
    marks = ','.join('?' * len(keys))
    for m in conn.execute(f'SELECT m.*, p.seed_ref FROM moves m JOIN people p USING (person_key) '
                          f'WHERE p.person_key IN ({marks})', keys):
        if not m['month']:
            per_seed[m['seed_ref']]['year_only'] += 1
            continue
        counts[(m['from_ref'], m['from_name'], m['to_ref'], m['to_name'], m['month'])] += 1

    rows = [(batch, SOURCE, *k, n) for k, n in counts.items()]
    for chunk in _chunks(rows, 8):
        d1('INSERT OR IGNORE INTO flow_collect_moves (batch_id, source, from_ref, from_name, '
           'to_ref, to_name, month, moves) VALUES ' + ','.join(['(?,?,?,?,?,?,?,?)'] * len(chunk)),
           [v for r in chunk for v in r])
    for seed_ref, b in per_seed.items():
        d1('INSERT OR IGNORE INTO flow_collect_batch (batch_id, seed_ref, source, profiles_ok, '
           'profiles_empty, refused, not_counted, year_only, synced_at) VALUES (?,?,?,?,?,?,?,?,?)',
           [batch, seed_ref, SOURCE, b['ok'], b['empty'], json.dumps(dict(b['refused'])),
            json.dumps(dict(b['skipped'])), b['year_only'], now])
    for chunk in _chunks(keys, 1):
        d1('INSERT OR IGNORE INTO flow_collect_seen (person_key) VALUES '
           + ','.join(['(?)'] * len(chunk)), chunk)
    conn.executemany('UPDATE people SET synced = 1 WHERE person_key = ?', [(k,) for k in keys])
    conn.commit()
    print(f'synced batch {batch}: {len(keys)} profiles, {len(rows)} month-pair rows '
          f'({sum(counts.values())} moves), {len(per_seed)} seed(s).')
    return 0


def pull_d1(conn: sqlite3.Connection) -> int:
    """Bring the seed cursors and the counted keys to this machine, so a run
    here resumes where the last one stopped and skips everyone already counted."""
    salt()  # refuse early on a salt mismatch
    waiting = conn.execute("SELECT COUNT(*) FROM people WHERE synced = 0 "
                           "AND status IN ('ok', 'empty')").fetchone()[0]
    if waiting >= MIN_BATCH:
        # A sync that died half way leaves some of these keys in D1; pulling
        # them would split the batch and the rest would be counted twice.
        sys.exit(f'{waiting} profiles here are not synced yet. Run --sync-d1 first.')
    waiting = conn.execute("SELECT COUNT(*) FROM skill_people WHERE synced = 0 "
                           "AND status IN ('ok', 'empty')").fetchone()[0]
    if waiting >= MIN_BATCH:
        sys.exit(f'{waiting} skill profiles here are not synced yet. Run --sync-d1 first.')
    for r in d1('SELECT * FROM flow_collect_seed WHERE source = ?', [SOURCE]):
        conn.execute('INSERT INTO seeds (seed_ref, company_id, slug, total, search_after, exhausted) '
                     'VALUES (?,?,?,?,?,?) ON CONFLICT(seed_ref) DO UPDATE SET total = excluded.total, '
                     'search_after = excluded.search_after, exhausted = excluded.exhausted',
                     [r['seed_ref'], r['company_id'], r['slug'], r['total'], r['search_after'],
                      r['exhausted']])
    got, after = 0, ''
    while True:
        page = d1('SELECT person_key FROM flow_collect_seen WHERE person_key > ? '
                  'ORDER BY person_key LIMIT 5000', [after])
        if not page:
            break
        # Already here and unsynced (fewer than MIN_BATCH): D1 has them, so
        # they must not be pushed again.
        conn.executemany("INSERT INTO people (person_key, seed_ref, fetched, status, "
                         "positions, synced) VALUES (?, '', '', 'remote', 0, 1) "
                         "ON CONFLICT(person_key) DO UPDATE SET synced = 1",
                         [(r['person_key'],) for r in page])
        got += len(page)
        after = page[-1]['person_key']
    skill_got, after = 0, ''
    while True:
        try:
            page = d1('SELECT person_key FROM flow_collect_skill_seen WHERE person_key > ? '
                      'ORDER BY person_key LIMIT 5000', [after])
        except RuntimeError:
            break  # 0004 not applied yet: no skills anywhere
        if not page:
            break
        conn.executemany("INSERT INTO skill_people (person_key, seed_ref, status, synced) "
                         "VALUES (?, '', 'remote', 1) "
                         "ON CONFLICT(person_key) DO UPDATE SET synced = 1",
                         [(r['person_key'],) for r in page])
        skill_got += len(page)
        after = page[-1]['person_key']
    conn.commit()
    print(f'pulled {got} counted keys, {skill_got} skill keys and the seed cursors from D1.')
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
    if '--sync-d1' in args:
        return sync_d1(conn)
    if '--pull-d1' in args:
        return pull_d1(conn)
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
