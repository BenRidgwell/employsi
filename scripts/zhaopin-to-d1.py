#!/usr/bin/env python3
"""
Scrape each mapped Chinese company's Zhaopin (智联招聘) postings across Beijing /
Shanghai / Shenzhen / Hong Kong and archive them to the D1 jobs table, deduped —
the Zhaopin counterpart of scripts/indeed-to-d1.py.

Meant to run from YOUR OWN machine on a schedule (cron / launchd / Task
Scheduler), NOT from CI/Workers: Zhaopin's anti-bot returns an empty shell to
non-browser clients, so only a real browser on a residential connection reliably
reads results. It drives the tools/zhaopin-company-scraper browser (one warmed
Chromium reused across companies), maps skills for parity via the worker's own
taxonomy (scripts/map-skills.ts — now covers Chinese titles), drops any role
already archived for that company by another source, and upserts through the D1
HTTP API with the same source|title|company|location key + upsert as
src/employsi/lib/jobArchive.ts.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
Run:  python3 scripts/zhaopin-to-d1.py [--only id1,id2] [--limit N] [--headful]
                                       [--profile DIR] [--max-pages N] [--solve]

First time on a fresh machine:
    pip3 install playwright && python3 -m playwright install chromium
"""
from __future__ import annotations
import json, os, random, re, subprocess, sys, time, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools', 'zhaopin-company-scraper'))
try:
    import zhaopin_company_scraper as zp  # noqa: E402
except ImportError as e:
    sys.exit(f'Missing dependency ({e}).')
# Playwright only for the browser fallback; the Oxylabs path (OXYLABS_USERNAME)
# runs without it.
try:
    from playwright.sync_api import sync_playwright  # noqa: E402
except ImportError:
    sync_playwright = None

import urllib.request  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
LIMIT = int(_opt('--limit', 10**9))
MAX_PAGES = int(_opt('--max-pages', 5))
HEADFUL = '--headful' in args
PROFILE = _opt('--profile', None)
PROXY = _opt('--proxy', None)
# --proxy-list <file-or-url>: rotate through a proxy pool, moving to the next
# working proxy when the current IP gets blocked (see scripts/proxy_pool.py).
PROXY_LIST = _opt('--proxy-list', None)
NO_SKILLS = '--no-skills' in args
SOLVE = '--solve' in args
MIN_DELAY = float(_opt('--min-delay', 6))
MAX_DELAY = float(_opt('--max-delay', 18))

if not SOLVE and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). '
             '(Not needed with --solve, which skips the D1 write.)')


# ── dedup key, identical to src/employsi/lib/jobArchive.ts ────────────────────
def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


# ── target companies (parsed from the generated TS) ───────────────────────────
def load_targets() -> list[dict]:
    txt = open(os.path.join(ROOT, 'src/employsi/data/chinaJobsTargets.ts')).read()
    out = []
    for m in re.finditer(
        r"\{\s*id:\s*'([^']+)',\s*name:\s*'((?:[^'\\]|\\.)*)',\s*kw:\s*'((?:[^'\\]|\\.)*)',"
        r"\s*cityId:\s*(\d+),\s*hub:\s*'([^']+)'\s*\}", txt):
        cid = m.group(1)
        if ONLY and cid not in ONLY:
            continue
        out.append({'id': cid, 'name': m.group(2).replace("\\'", "'"),
                    'kw': m.group(3).replace("\\'", "'"),
                    'cityId': int(m.group(4)), 'hub': m.group(5)})
    return out


# ── skills parity via the worker's own taxonomy (offline bun helper) ──────────
def map_skills(titles: list) -> list:
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=json.dumps(titles).encode(), capture_output=True, timeout=180)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:
        sys.stderr.write(f'  map-skills error: {e}\n')
    return [[] for _ in titles]


# ── D1 HTTP API ───────────────────────────────────────────────────────────────
def d1(sql: str, params: list):
    body = json.dumps({'sql': sql, 'params': params}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
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


def existing_titles(company_id: str) -> set:
    # Only OTHER sources — so a Zhaopin job that duplicates another source's role
    # is counted once, while Zhaopin's own prior jobs re-upsert (refresh last_seen).
    r = d1("SELECT DISTINCT title FROM jobs WHERE company_id = ? AND source != 'zhaopin'", [company_id])
    return {norm(str(x.get('title') or '')) for x in (r[0]['results'] if r else [])}


def upsert(t: dict, jobs: list) -> int:
    titles = [j['t'] for j in jobs]
    skills = map_skills(titles)
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        company = j.get('company') or t['name']
        location = j.get('loc') or t['hub']
        key = job_key('zhaopin', j['t'], company, location)
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, 'zhaopin', j['t'], company or None, t['id'],
                     t['hub'], location, 'Zhaopin', j.get('salary'),
                     j.get('url') or '', j.get('date') or '',
                     json.dumps(sk) if sk else None))
    written = 0
    for i in range(0, len(rows), 7):  # D1 caps ~100 bound params/query
        chunk = rows[i:i + 7]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'] * len(chunk))
        sql = ('INSERT INTO jobs '
               '(job_key, source, title, company, company_id, hub, location, category, salary, url, posted, skills, first_seen, last_seen, seen_count) '
               f'VALUES {values} '
               'ON CONFLICT(job_key) DO UPDATE SET '
               'last_seen = excluded.last_seen, seen_count = seen_count + 1, '
               "salary = COALESCE(jobs.salary, excluded.salary), "
               "url = COALESCE(NULLIF(jobs.url, ''), excluded.url), "
               "posted = COALESCE(NULLIF(jobs.posted, ''), excluded.posted), "
               'skills = COALESCE(jobs.skills, excluded.skills)')
        params = []
        for r in chunk:
            params.extend([*r, TODAY, TODAY])
        d1(sql, params)
        written += len(chunk)
    return written


def main() -> int:
    targets = load_targets()
    mode = 'SOLVE / reachability check — no D1 write' if SOLVE else 'Zhaopin -> D1'
    sys.stderr.write(f'{mode}: {len(targets)} company(ies) across '
                     f'{len({t["hub"] for t in targets})} cities '
                     f'({"HEADFUL" if HEADFUL else "headless"}'
                     f'{", profile=" + PROFILE if PROFILE else ""}).\n')
    if not HEADFUL and not PROFILE:
        sys.stderr.write('  tip: first run with --headful --profile <dir> to clear Zhaopin\'s '
                         'security check by hand; the profile then reuses the solved session.\n')

    # ── Oxylabs Web Scraper API path (no browser / no proxy) ──────────────────
    # When OXYLABS_USERNAME is set we fetch Zhaopin's rendered search page through
    # Oxylabs (China geo + JS render + anti-bot bypass) and parse the embedded
    # __INITIAL_STATE__ job records — no Playwright, runs on any host.
    if os.environ.get('OXYLABS_USERNAME'):
        import oxylabs_client as oxy
        from urllib.parse import quote
        sys.stderr.write('  via Oxylabs Web Scraper API (geo=China) — no browser.\n')
        total_fetch = total_new = empty = done = 0
        for t in targets:
            if done >= LIMIT:
                break
            jobs, seen = [], set()
            for pg in range(1, MAX_PAGES + 1):
                url = f"https://sou.zhaopin.com/?kw={quote(t['kw'])}&jl={t['cityId']}&p={pg}"
                content, _ = oxy.fetch(url, geo='China', render=True)
                if not content:
                    break
                new = 0
                for j in zp.parse_search_html(content):
                    k = (j['t'], j['loc'])
                    if k in seen:
                        continue
                    seen.add(k)
                    jobs.append(j)
                    new += 1
                if new == 0:
                    break
            total_fetch += len(jobs)
            if SOLVE:
                sys.stderr.write(f'  {t["id"]:22} {len(jobs):3} jobs · reachable ✓ ({t["kw"]})\n')
            elif not jobs:
                empty += 1
                sys.stderr.write(f'  {t["id"]:22}   0 jobs ({t["kw"]})\n')
            else:
                have = existing_titles(t['id'])
                fresh = [j for j in jobs if norm(j['t']) not in have]
                written = upsert(t, fresh) if fresh else 0
                total_new += written
                sys.stderr.write(f'  {t["id"]:22} {len(jobs):3} zhaopin · {written:3} new '
                                 f'({len(jobs) - len(fresh)} already archived)\n')
            done += 1
        if SOLVE:
            sys.stderr.write(f'\n✓ {done} companies reachable via Oxylabs.\n')
            return 0
        sys.stderr.write(f'\nDone (Oxylabs). {total_fetch} listings fetched, {total_new} new rows '
                         f'archived, {empty} companies with 0 jobs.\n')
        return 0

    if sync_playwright is None:
        sys.exit('No browser: install Playwright, or set OXYLABS_USERNAME/OXYLABS_PASSWORD '
                 'to use the Oxylabs Web Scraper API path.')

    # Optional proxy pool: pick an initial working proxy, rotate on repeated blocks.
    rotator = proxy = open_resilient = None
    if PROXY_LIST:
        try:
            from proxy_pool import rotator_from, open_resilient
            rotator = rotator_from(PROXY_LIST, 'https://www.zhaopin.com/', timeout=8.0)
            proxy = rotator.next_working()
            sys.stderr.write(f'  starting with proxy {proxy}\n' if proxy
                             else '  no working proxy in the pool — running direct.\n')
        except Exception as e:
            sys.stderr.write(f'  proxy pool error ({e}) — running direct.\n')
    else:
        proxy = PROXY

    total_fetch = total_new = blocked = done = 0
    consecutive_blocks = 0
    with sync_playwright() as p:
        open_fn = lambda pr: zp.open_session(p, headful=HEADFUL, proxy=pr, profile=PROFILE)
        if open_resilient:
            proxy, ctx, page = open_resilient(open_fn, rotator, proxy)
        else:
            ctx, page = open_fn(proxy)
        first = True
        for t in targets:
            if done >= LIMIT:
                break
            if not first:
                time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))
            first = False
            jobs, was_blocked = zp.scrape_company(page, t['kw'], t['cityId'], max_pages=MAX_PAGES)
            if was_blocked:
                blocked += 1
                consecutive_blocks += 1
                sys.stderr.write(f'  {t["id"]:22} BLOCKED (security check)\n')
                if consecutive_blocks >= 3:
                    nxt = rotator.next_working() if rotator else None
                    if nxt:
                        sys.stderr.write(f'  rotating proxy → {nxt}\n')
                        try:
                            ctx.close()
                        except Exception:
                            pass
                        proxy = nxt
                        ctx, page = zp.open_session(p, headful=HEADFUL, proxy=proxy, profile=PROFILE)
                        consecutive_blocks = 0
                        continue
                    sys.stderr.write('  3 consecutive blocks and no more proxies — stopping.\n')
                    break
                done += 1
                continue
            consecutive_blocks = 0
            total_fetch += len(jobs)
            if SOLVE:
                sys.stderr.write(f'  {t["id"]:22} {len(jobs):3} jobs · reachable ✓ ({t["kw"]})\n')
                done += 1
                continue
            if not jobs:
                sys.stderr.write(f'  {t["id"]:22}   0 jobs ({t["kw"]})\n')
                done += 1
                continue
            have = existing_titles(t['id'])
            fresh = [j for j in jobs if norm(j['t']) not in have]
            written = upsert(t, fresh) if fresh else 0
            total_new += written
            sys.stderr.write(f'  {t["id"]:22} {len(jobs):3} zhaopin · {written:3} new '
                             f'({len(jobs) - len(fresh)} already archived)\n')
            done += 1
        ctx.close()

    if SOLVE:
        ok = done - blocked
        sys.stderr.write(f'\n{"✓ Reachable" if ok and not blocked else ("Partially blocked" if ok else "✗ Blocked")}'
                         f' — {ok} reachable, {blocked} blocked. '
                         f'{"Cached to " + PROFILE if PROFILE else "Tip: add --profile <dir> to keep the solved session."}\n')
        return 2 if (targets and blocked >= done) else 0

    sys.stderr.write(f'\nDone. {total_fetch} Zhaopin listings fetched, {total_new} new rows archived, '
                     f'{blocked} companies blocked.\n')
    if targets and blocked > len(targets) * 0.5:
        sys.stderr.write('WARNING: over half blocked — solve the security check via --headful --profile.\n')
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
