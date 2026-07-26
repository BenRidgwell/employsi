#!/usr/bin/env python3
"""Defensive job extraction from a rendered job-board page.

Every modern gov job board we scrape (NSW iworkfor = Next.js, APS = Salesforce
Aura, SA = BigRedSky) renders its results client-side and ships the underlying
records as JSON embedded in the page. Anchor-scraping the DOM is brittle against
those (the NSW rewrite failed for exactly this reason: 0 `<a href="/job/...">`
because the list lives in the Next.js flight payload).

So this module extracts jobs the robust way, in priority order:
  1. EMBEDDED JSON — Next.js flight chunks (`self.__next_f.push`), `__NEXT_DATA__`,
     Aura action payloads, and any other <script> JSON — walked for "job-like"
     objects (a title-ish field plus at least one corroborating field).
  2. DOM ANCHORS — links matching the board's job-detail URL pattern, with the
     surrounding block's text mined for organisation/location.
Whichever yields more rows wins, so a board can change rendering without the
scraper silently returning zero.

Shared by scripts/{nsw-gov,aps,sa-gov}-to-d1.py. Pure-python, no dependencies, so
it is unit-testable offline against fixtures (see scripts/test_jobs_extract.py).
"""
from __future__ import annotations
import html as htmllib
import json
import re
import sys

TAG = re.compile(r'<[^>]+>')
WS = re.compile(r'\s+')


def text_of(fragment: str) -> str:
    """Visible text of an HTML fragment."""
    return WS.sub(' ', htmllib.unescape(TAG.sub(' ', fragment or ''))).strip()


# ── 1. embedded JSON ─────────────────────────────────────────────────────────
# Keys that plausibly carry each field, most specific first. Matching is done on
# a normalised key (lowercased, non-alphanumerics stripped) so jobTitle,
# job_title and JobTitle all hit the same rule.
TITLE_KEYS = ('jobtitle', 'positiontitle', 'roletitle', 'advertisedtitle', 'title', 'name')
ORG_KEYS = ('organisation', 'organization', 'agency', 'department', 'employer',
            'agencyname', 'organisationname', 'cluster', 'company', 'entity')
LOC_KEYS = ('location', 'joblocation', 'worklocation', 'region', 'suburb', 'city', 'locationname')
URL_KEYS = ('url', 'joburl', 'link', 'href', 'applyurl', 'detailurl')
SALARY_KEYS = ('salary', 'salaryrange', 'remuneration', 'packagerange', 'salarydescription')
CLOSE_KEYS = ('closingdate', 'closedate', 'closes', 'applicationclosingdate', 'expirydate')
ID_KEYS = ('jobid', 'id', 'jobreference', 'referencenumber', 'requisitionid', 'vacancyid')

# Titles this short/long are almost certainly not real job titles.
MIN_TITLE, MAX_TITLE = 4, 160


def _norm_key(k: str) -> str:
    k = str(k).lower()
    # Salesforce custom fields arrive as Agency__c / Location__c — drop the
    # trailing __c so they normalise onto the same names as everything else.
    k = re.sub(r'__c$', '', k)
    return re.sub(r'[^a-z0-9]', '', k)


def _pick(d: dict, keys: tuple[str, ...]):
    """First value in `d` whose normalised key matches one of `keys` (in order)."""
    norm = {_norm_key(k): v for k, v in d.items()}
    for want in keys:
        v = norm.get(want)
        if isinstance(v, (str, int, float)) and str(v).strip():
            return str(v).strip()
        # some payloads nest the display value: {"location": {"label": "Sydney"}}
        if isinstance(v, dict):
            for sub in ('label', 'name', 'value', 'text', 'displayvalue'):
                sv = {_norm_key(k2): v2 for k2, v2 in v.items()}.get(sub)
                if isinstance(sv, (str, int, float)) and str(sv).strip():
                    return str(sv).strip()
        if isinstance(v, list) and v:
            first = v[0]
            if isinstance(first, (str, int, float)) and str(first).strip():
                return str(first).strip()
    return ''


def looks_like_job(d: dict) -> bool:
    """A dict is job-like if it has a plausible title AND corroborating context."""
    if not isinstance(d, dict) or len(d) < 2:
        return False
    title = _pick(d, TITLE_KEYS)
    if not (MIN_TITLE <= len(title) <= MAX_TITLE):
        return False
    # Require a STRONG corroborating field. A url/href alone is not enough — nav
    # entries and breadcrumbs are all {name, href} and would otherwise flood in.
    strong = sum(bool(_pick(d, ks)) for ks in (ORG_KEYS, LOC_KEYS, SALARY_KEYS,
                                               CLOSE_KEYS, ID_KEYS))
    return strong >= 1


def job_from(d: dict) -> dict:
    return {
        't': _pick(d, TITLE_KEYS),
        'agency': _pick(d, ORG_KEYS),
        'loc': _pick(d, LOC_KEYS),
        'url': _pick(d, URL_KEYS),
        'salary': _pick(d, SALARY_KEYS),
        'close': _pick(d, CLOSE_KEYS),
        'id': _pick(d, ID_KEYS),
    }


def walk_json(node, out: list, depth: int = 0, seen: set | None = None) -> None:
    """Recursively collect job-like dicts from an arbitrary JSON tree."""
    if depth > 30:
        return
    if seen is None:
        seen = set()
    if isinstance(node, dict):
        if looks_like_job(node):
            j = job_from(node)
            key = (j['t'].lower(), j['id'], j['loc'].lower())
            if key not in seen:
                seen.add(key)
                out.append(j)
            # A job object can still contain nested detail; don't recurse into it.
            return
        for v in node.values():
            walk_json(v, out, depth + 1, seen)
    elif isinstance(node, list):
        for v in node:
            walk_json(v, out, depth + 1, seen)


def _iter_json_candidates(html: str):
    """Yield JSON-ish strings embedded in the page."""
    # a) Next.js flight chunks: self.__next_f.push([1,"...escaped json..."])
    for m in re.finditer(r'__next_f\.push\(\s*\[\s*\d+\s*,\s*"((?:[^"\\]|\\.)*)"', html):
        try:
            yield json.loads('"' + m.group(1) + '"')  # unescape the JS string
        except Exception:  # noqa: BLE001
            continue
    # b) classic embedded state blobs
    for pat in (r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>',
                r'<script[^>]+type="application/json"[^>]*>(.*?)</script>',
                r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>'):
        for m in re.finditer(pat, html, re.S | re.I):
            yield m.group(1)
    # c) generic assignments: window.__X__ = {...};  /  "actions":[...]  (Aura)
    for m in re.finditer(r'=\s*(\{.{200,}?\})\s*;?\s*</script>', html, re.S):
        yield m.group(1)


def _json_objects(blob: str):
    """Parse a blob, or salvage the JSON objects/arrays inside it."""
    blob = (blob or '').strip()
    if not blob:
        return
    try:
        yield json.loads(blob)
        return
    except Exception:  # noqa: BLE001
        pass
    # Salvage: scan for balanced {...} / [...] regions and parse each.
    for start_ch, end_ch in (('{', '}'), ('[', ']')):
        i = 0
        while True:
            i = blob.find(start_ch, i)
            if i < 0:
                break
            depth, j, in_str, esc = 0, i, False, False
            while j < len(blob):
                c = blob[j]
                if in_str:
                    if esc:
                        esc = False
                    elif c == '\\':
                        esc = True
                    elif c == '"':
                        in_str = False
                elif c == '"':
                    in_str = True
                elif c == start_ch:
                    depth += 1
                elif c == end_ch:
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            if depth == 0 and j > i and (j - i) > 80:
                try:
                    yield json.loads(blob[i:j + 1])
                except Exception:  # noqa: BLE001
                    pass
                i = j + 1
            else:
                i += 1


def jobs_from_embedded_json(html: str) -> list[dict]:
    out: list[dict] = []
    seen: set = set()
    for blob in _iter_json_candidates(html or ''):
        for obj in _json_objects(blob):
            walk_json(obj, out, 0, seen)
    return out


# ── 2. DOM anchors (fallback) ────────────────────────────────────────────────
def jobs_from_anchors(html: str, href_re: str, site: str = '') -> list[dict]:
    """Extract jobs by anchoring on job-detail links, mining the surrounding block."""
    rows, seen = [], set()
    pat = re.compile(r'<a\b[^>]*href="([^"]*' + href_re + r'[^"]*)"[^>]*>(.*?)</a>', re.S | re.I)
    for m in pat.finditer(html or ''):
        href, inner = m.group(1), m.group(2)
        title = text_of(inner)
        if not (MIN_TITLE <= len(title) <= MAX_TITLE):
            continue
        if title.lower() in seen:
            continue
        seen.add(title.lower())
        s, e = max(0, m.start() - 1200), min(len(html), m.end() + 1200)
        block = text_of(html[s:e])

        def grab(labels):
            for lb in labels:
                g = re.search(lb + r'\s*[:\-]?\s*([^|\n]{2,70})', block, re.I)
                if g:
                    return g.group(1).strip()
            return ''
        rows.append({
            't': title,
            'agency': grab([r'organisation', r'organization', r'agency', r'department', r'cluster', r'employer']),
            'loc': grab([r'location', r'region']),
            'url': href if href.startswith('http') else (site.rstrip('/') + href if href.startswith('/') else href),
            'salary': grab([r'salary', r'remuneration']),
            'close': grab([r'closing', r'closes']),
            'id': '',
        })
    return rows


# ── combined ─────────────────────────────────────────────────────────────────
def extract_jobs(html: str, href_re: str = r'/job/\d+', site: str = '') -> tuple[list[dict], str]:
    """Best-effort job extraction. Returns (rows, strategy-used)."""
    via_json = jobs_from_embedded_json(html)
    via_dom = jobs_from_anchors(html, href_re, site)
    if len(via_json) >= len(via_dom) and via_json:
        return via_json, 'embedded-json'
    if via_dom:
        return via_dom, 'dom-anchors'
    return [], 'none'


def diagnose(html: str, where: str, out=sys.stderr) -> None:
    """Dump enough structure to fix a parser from a CI log, without the full page."""
    html = html or ''
    tm = re.search(r'<title[^>]*>(.*?)</title>', html, re.S | re.I)
    title = text_of(tm.group(1))[:80] if tm else ''
    out.write(
        f'  [diag {where}] len={len(html)} title={title!r} '
        f'next_f={len(re.findall(r"__next_f", html))} '
        f'nextdata={"y" if "__NEXT_DATA__" in html else "n"} '
        f'aura={"y" if "sfsites/aura" in html or "auraConfig" in html else "n"} '
        f'jsonld={len(re.findall(r"application/ld.json", html))} '
        f'anchors={len(re.findall(r"<a ", html))}\n')
    # Which JSON keys actually appear — the fastest way to see the real schema.
    keys = re.findall(r'"([A-Za-z_][A-Za-z0-9_]{2,30})"\s*:', html)
    if keys:
        from collections import Counter
        common = ', '.join(f'{k}({n})' for k, n in Counter(keys).most_common(25))
        out.write(f'  [diag keys] {common}\n')
    for probe in ('title', 'Title', 'location', 'Location', 'organisation', 'agency'):
        i = html.find(f'"{probe}"')
        if i >= 0:
            out.write(f'  [diag ctx {probe}] ...{WS.sub(" ", html[max(0,i-120):i+260])}...\n')
            break
