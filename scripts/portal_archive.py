#!/usr/bin/env python3
"""Shared plumbing for the single-employer career-portal drivers.

WHY THIS EXISTS. Every portal that cannot run inside the jobs-cron Worker gets a
driver in this directory, and by the time there were a dozen of them the halves
that are genuinely per-portal (find the API, parse its shape) had been buried
under a hundred lines each of identical D1 batching, skills/hub bridging and
argument handling — copied, so a fix to one never reached the others. The
uniroles walk still carries its own copy; this is the extracted version the
2026-09-18 batch was written against, and the older drivers can move onto it a
file at a time without a flag day.

WHAT IT DELIBERATELY DOES NOT DO: fetch anything. A portal driver's whole value
is the measurement of one live site, and hiding that behind a generic fetcher is
how a per-tenant quirk gets "simplified" out. The driver owns the request and
hands back plain dicts.

The row contract is `jobs` in workers/jobs-cron/migrations/0001_jobs_archive.sql,
written with the same ON CONFLICT upsert as the Worker's archiveJobs — so a role
this writes and a role the Worker writes collapse to one row rather than
double-counting.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
"""
from __future__ import annotations

import datetime
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from advertiser_match import norm  # noqa: E402

ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

# A browser UA, because several of these boards serve a different (or empty)
# document to anything that announces itself as a bot. Where a board is happy
# with an honest one the driver overrides it.
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')

# D1 caps a query at roughly 100 bound parameters and a row costs 14, so seven
# rows a statement is the largest batch that fits. It is not a tuning knob.
ROWS_PER_STATEMENT = 7


def token() -> str:
    return os.environ.get('CLOUDFLARE_API_TOKEN', '')


def d1(sql: str, params: list):
    """One D1 query, retried four times with a linear backoff."""
    body = json.dumps({'sql': sql, 'params': params}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {token()}', 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                j = json.loads(r.read().decode())
                if j.get('success'):
                    return j['result']
                raise RuntimeError(str(j.get('errors')))
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            if attempt == 3:
                raise RuntimeError(f'D1 {e.code}: {detail}')
            time.sleep(attempt + 1)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def _bridge(script: str, payload, fallback):
    """Run one of the bun bridges in scripts/ and read its JSON back.

    The taxonomy and the hub matcher live in TypeScript because the app, the
    Worker and these drivers must map a role identically; shelling out is what
    keeps that single copy. A failed bridge degrades to the fallback rather than
    killing the run, because rows with no skills are still rows.
    """
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, script)],
                           input=json.dumps(payload).encode(),
                           capture_output=True, timeout=180, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  {script} failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  {script} error: {e}\n')
    return fallback


def map_skills(titles: list, sector: str, enabled: bool = True) -> list:
    if not enabled or not titles:
        return [[] for _ in titles]
    return _bridge('map-skills.ts', {'titles': titles, 'sector': sector},
                   [[] for _ in titles])


def map_hubs(locations: list, home: str | None) -> list:
    if not locations:
        return []
    return _bridge('map-hubs.ts', {'locations': locations, 'home': home},
                   [None for _ in locations])


def job_key(source: str, title: str, company: str, location: str) -> str:
    """The archive's dedup key. Mirrors jobKey() in src/employsi/lib/jobArchive.ts.

    It MUST stay in step with that function: the key is what makes a role seen
    by both this driver and the Worker one row instead of two.
    """
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


def archive(jobs: list, *, source: str, company_id: str, company: str,
            sector: str, home_hub: str | None, category: str = 'Career portal',
            skills: bool = True, dry: bool = False) -> tuple[int, int]:
    """Upsert a portal's roles. Returns (rows written, rows after dedup).

    `jobs` are dicts of {title, location, url, posted}. Rows are deduped on the
    archive key first, so a board that lists one role under several categories
    costs one row rather than several — and the count returned is the honest
    one, not the board's own listing count.
    """
    deduped, seen = [], set()
    for j in jobs:
        title = (j.get('title') or '').strip()
        if not title:
            continue
        loc = (j.get('location') or '').strip()
        key = job_key(source, title, company, loc)
        if key in seen:
            continue
        seen.add(key)
        deduped.append((key, title, loc, j.get('url') or '', j.get('posted') or TODAY))

    sk = map_skills([t for _, t, _, _, _ in deduped], sector, enabled=skills)
    hubs = map_hubs([loc for _, _, loc, _, _ in deduped], home_hub)

    rows = []
    for i, (key, title, loc, url, posted) in enumerate(deduped):
        s = sk[i] if i < len(sk) else []
        rows.append((key, source, title, company, company_id,
                     hubs[i] if i < len(hubs) else home_hub, loc, category, None,
                     url, posted, json.dumps(s) if s else None))

    if dry:
        return 0, len(rows)

    written = 0
    for i in range(0, len(rows), ROWS_PER_STATEMENT):
        chunk = rows[i:i + ROWS_PER_STATEMENT]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'] * len(chunk))
        sql = ('INSERT INTO jobs '
               '(job_key, source, title, company, company_id, hub, location, category, '
               'salary, url, posted, skills, first_seen, last_seen, seen_count) '
               f'VALUES {values} '
               'ON CONFLICT(job_key) DO UPDATE SET '
               'last_seen = excluded.last_seen, seen_count = seen_count + 1, '
               "url = COALESCE(NULLIF(jobs.url, ''), excluded.url), "
               'skills = COALESCE(jobs.skills, excluded.skills)')
        params = []
        for r in chunk:
            params.extend([*r, TODAY, TODAY])
        d1(sql, params)
        written += len(chunk)
    return written, len(rows)


def flag(args: list, name: str) -> bool:
    return name in args


def opt(args: list, name: str, default=None):
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else default
