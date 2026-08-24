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
from collections import Counter

TAG = re.compile(r'<[^>]+>')
WS = re.compile(r'\s+')


def text_of(fragment: str) -> str:
    """Visible text of an HTML fragment."""
    return WS.sub(' ', htmllib.unescape(TAG.sub(' ', fragment or ''))).strip()


# ── date normalisation ───────────────────────────────────────────────────────
# The `posted` column is documented as YYYY-MM-DD, and everything downstream
# (the analyst's history charts, any "posted N days ago") reads it as a sortable
# ISO day. Two feeds were writing something else into it — SA wrote Australian
# d/m/Y, and the APS label-scraper wrote the literal string "Date 09 Aug 2026"
# because its regex matched "Closing" and captured the rest of "Closing Date …".
# Neither is parseable, and a column that is a date for 30 sources and free text
# for two is worse than one that is empty for two.
#
# So every date reaching `posted` passes through here. Day-first is assumed on
# ambiguous numeric dates because every board feeding this module is Australian;
# an unparseable value returns '' rather than a guess, because a wrong date is
# indistinguishable from a right one once stored.
_MONTHS = {m: i + 1 for i, m in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}


def iso_date(raw) -> str:
    """Normalise a board's date text to YYYY-MM-DD, or '' if it isn't one."""
    s = WS.sub(' ', str(raw or '')).strip()
    if not s:
        return ''
    # Strip a leading label the scraper may have captured with the value
    # ("Closing Date 09 Aug 2026", "Posted: 3 March 2026").
    s = re.sub(r'^\s*(closing|closes|posted|posting|published|advertised|expiry|expires|start)?'
               r'\s*(date)?\s*[:\-]?\s*', '', s, flags=re.I).strip()
    if not s:
        return ''

    # Already ISO, possibly with a time component.
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        return _ymd(m.group(1), m.group(2), m.group(3))

    # 09 Aug 2026 / 9 August 2026 / Aug 9, 2026
    m = re.match(r'^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})', s)
    if m and m.group(2)[:3].lower() in _MONTHS:
        return _ymd(m.group(3), _MONTHS[m.group(2)[:3].lower()], m.group(1))
    m = re.match(r'^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})', s)
    if m and m.group(1)[:3].lower() in _MONTHS:
        return _ymd(m.group(3), _MONTHS[m.group(1)[:3].lower()], m.group(2))

    # 09/08/2026 or 9-8-26 — DAY FIRST (see above).
    m = re.match(r'^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$', s)
    if m:
        y = m.group(3)
        if len(y) == 2:
            y = ('20' if int(y) < 70 else '19') + y
        return _ymd(y, m.group(2), m.group(1))

    return ''


def _ymd(y, m, d) -> str:
    """Assemble and range-check, so 31/13/2026 is rejected rather than stored."""
    try:
        y, m, d = int(y), int(m), int(d)
    except (TypeError, ValueError):
        return ''
    if not (1990 <= y <= 2100 and 1 <= m <= 12 and 1 <= d <= 31):
        return ''
    return f'{y:04d}-{m:02d}-{d:02d}'


# ── 1. embedded JSON ─────────────────────────────────────────────────────────
# Keys that plausibly carry each field, most specific first. Matching is done on
# a normalised key (lowercased, non-alphanumerics stripped) so jobTitle,
# job_title and JobTitle all hit the same rule.
# `jobname` / `departmentname` / `jobclosedate` / `jobposteddate` /
# `applicationurl` are the APS board's Aura schema, read off the live response on
# 2026-08-16:
#
#   {"jobListingCount":608,"jobListings":[{"jobName":…,"departmentName":…,
#    "jobLocation":…,"jobPostedDate":…,"jobCloseDate":…,"jobId":…,
#    "applicationURL":…,"vacancyNumber":…}]}
#
# Only `jobLocation` and `jobId` were already covered, and a record with a
# location and an id but no TITLE is not job-like, so every one of these was
# discarded. The board's data had been arriving intact all along and failing this
# one test — which is why the feed fell back to mining the rendered cards.
TITLE_KEYS = ('jobtitle', 'positiontitle', 'roletitle', 'advertisedtitle', 'jobname',
              'title', 'name')
ORG_KEYS = ('organisation', 'organization', 'agency', 'agencyname', 'departmentname',
            'department', 'employer', 'organisationname', 'cluster', 'company', 'entity')
LOC_KEYS = ('location', 'joblocation', 'worklocation', 'region', 'suburb', 'city', 'locationname')
URL_KEYS = ('url', 'joburl', 'applicationurl', 'link', 'href', 'applyurl', 'detailurl')
SALARY_KEYS = ('salary', 'salaryrange', 'remuneration', 'packagerange', 'salarydescription')
CLOSE_KEYS = ('closingdate', 'closedate', 'jobclosedate', 'closes',
              'applicationclosingdate', 'expirydate')
# The date the ad went UP, which is what the archive's `posted` column means.
# Kept strictly separate from CLOSE_KEYS: a closing date is not a posting date,
# and conflating them is exactly the bug this set exists to fix.
POSTED_KEYS = ('posteddate', 'postingdate', 'jobposteddate', 'dateposted', 'publisheddate',
               'publicationdate', 'advertiseddate', 'opendate', 'startdate',
               'createddate', 'posted', 'published')
ID_KEYS = ('jobid', 'id', 'jobreference', 'referencenumber', 'requisitionid', 'vacancyid')

# ── which of the above are strong enough to say "this dict is a vacancy" ─────
# A JSON payload for a job board is mostly NOT jobs. iworkfor.nsw.gov.au ships a
# Next.js flight payload whose every nav link and every filter facet is
# {"id": 5432, "name": "Sydney Region"} — and under the original rule (any title
# key + any id key) each of those was a job. 303 rows of site chrome went into
# the archive as NSW vacancies: "Accessibility", "Privacy and security", "Job
# alerts", every region filter and every job-category label. Not one of the 303
# was a real ad, and they looked exactly like ads to everything downstream.
#
# The hole was that BOTH halves of the test were generic. `name` is a title key
# and `id` is an id key, so {id, name} — the shape of every enumerable thing in
# every payload — qualified. So:
#
#   • a JOB-SPECIFIC title key ("jobTitle", "positionTitle") is enough on its
#     own: nothing calls a nav label a jobTitle;
#   • a generic title ("title", "name") needs real corroboration — an
#     organisation, a location, a salary, a closing date, or a JOB-specific id.
#     A bare "id" is not corroboration, because everything has one.
JOB_TITLE_KEYS = ('jobtitle', 'positiontitle', 'roletitle', 'advertisedtitle', 'jobname')
STRONG_ID_KEYS = ('jobid', 'jobreference', 'requisitionid', 'vacancyid', 'referencenumber',
                  'vacancynumber')

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
    # An unambiguous job-title field stands on its own.
    if _pick(d, JOB_TITLE_KEYS):
        return True
    # Otherwise the title came from a generic "title"/"name", so require a STRONG
    # corroborating field. A url/href alone is not enough — nav entries and
    # breadcrumbs are all {name, href}. Neither is a bare "id": facets are all
    # {id, name}, which is what put 303 filter labels in the archive (see
    # STRONG_ID_KEYS above).
    strong = sum(bool(_pick(d, ks)) for ks in (ORG_KEYS, LOC_KEYS, SALARY_KEYS,
                                               CLOSE_KEYS, STRONG_ID_KEYS))
    return strong >= 1


def job_from(d: dict) -> dict:
    return {
        't': _pick(d, TITLE_KEYS),
        'agency': _pick(d, ORG_KEYS),
        'loc': _pick(d, LOC_KEYS),
        'url': _pick(d, URL_KEYS),
        'salary': _pick(d, SALARY_KEYS),
        'close': _pick(d, CLOSE_KEYS),
        'posted': iso_date(_pick(d, POSTED_KEYS)),
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


def _inner_json_strings(node, depth: int = 0):
    """Yield string values that are themselves JSON documents.

    Salesforce Aura returns its payload double-encoded — the action's
    `returnValue` is a STRING containing the JSON, not the JSON itself:

        {"actions":[{"returnValue":{"returnValue":"{\\"jobs\\":[ ... ]}"}}]}

    walk_json only descends real dicts and lists, so without this the records
    are invisible: the response parses, the walk finds nothing job-like, and the
    caller concludes the endpoint carries no jobs.
    """
    if depth > 30:
        return
    if isinstance(node, str):
        s = node.strip()
        if len(s) > 2 and s[0] in '{[':
            yield s
        return
    if isinstance(node, dict):
        for v in node.values():
            yield from _inner_json_strings(v, depth + 1)
    elif isinstance(node, list):
        for v in node:
            yield from _inner_json_strings(v, depth + 1)


# Anti-JSON-hijacking prefixes. Salesforce and several other frameworks send
# one ahead of the payload so a <script src> of the endpoint cannot read it;
# json.loads sees it as a syntax error.
_JSON_GUARD = re.compile(r"^\s*(?:while\s*\(\s*1\s*\)\s*;|for\s*\(\s*;\s*;\s*\)\s*;|\)\]\}'?,?)")


def json_shape(text: str, top: int = 26) -> str:
    """A one-line description of a JSON body that yielded no jobs.

    Written for the case where a capture is plainly working — the APS board's
    ApexAction responses arrive at 1.78MB apiece — and the parser still finds
    nothing in them. The two things that distinguish "wrong schema" from "not
    actually JSON" are the opening bytes and the key names, and neither is worth
    dumping 1.78MB to a CI log to see.
    """
    t = (text or '').strip()
    head = t[:120].replace('\n', ' ')
    keys = Counter(re.findall(r'"([A-Za-z_][A-Za-z0-9_]{1,40})"\s*:', t))
    common = ' '.join(f'{k}×{n}' for k, n in keys.most_common(top))
    return f'head={head!r}\n      keys: {common}'


def jobs_from_json_text(text: str) -> list[dict]:
    """Job-like records from a RAW JSON body — an XHR response, not a page.

    `jobs_from_embedded_json` above mines JSON out of HTML (script blobs, Next.js
    flight chunks). This one takes a body that is already JSON, which is what a
    captured API response is, and unwraps one level of double-encoding on the way
    so an Aura payload is read rather than walked past.
    """
    out: list[dict] = []
    seen: set = set()
    body = _JSON_GUARD.sub('', text or '', count=1)
    for obj in _json_objects(body):
        walk_json(obj, out, 0, seen)
        for inner in _inner_json_strings(obj):
            for sub in _json_objects(inner):
                walk_json(sub, out, 0, seen)
    return out


# ── block mining, shared by the two DOM strategies below ─────────────────────
# Labels that are ALSO the first word of many employers' own names. "Department
# of Foreign Affairs and Trade" is not a labelled field — the whole string is the
# VALUE, and there is no label anywhere near it.
#
# This mattered because the separator below is optional, which it has to be:
# plenty of boards render "Organisation" and its value as sibling elements with
# nothing but whitespace between them once `text_of` has flattened them. But that
# same optional separator let `department` match the employer's own first word,
# start the capture AFTER it, and then take a blind 70 characters — which on the
# APS board runs straight through the job title and into the salary:
#
#   Department of Finance Senior Drupal Developer $ 101,355 to $ 123,702 Opport…
#            ->  "of Finance Senior Drupal Developer $ 101,355 to $ 123,702 Opp"
#
# Measured 2026-08-16, that had put 230 of the aps-gov feed's 232 rows in the
# unattributed bucket, each stored under a 70-character fragment as its employer
# name, every daily run green throughout.
#
# So when one of these labels matches WITHOUT a real separator, the label word is
# kept as part of the value instead of being eaten. Boards that do write
# "Department: X" are unaffected — they have a separator, and take the labelled
# branch exactly as before.
NAME_INITIAL_LABELS = ('department',)
_SEP = r'[:\-–—]'


def _grab(block: str, labels) -> str:
    """First labelled value found in `block`, '' if none of `labels` appear."""
    for lb in labels:
        m = re.search(r'(' + lb + r')(\s*' + _SEP + r'\s*|\s+)([^|\n]{2,70})',
                      block or '', re.I)
        if not m:
            continue
        label, sep, value = m.group(1), m.group(2), m.group(3).strip()
        if lb in NAME_INITIAL_LABELS and not re.search(_SEP, sep):
            value = f'{label} {value}'.strip()
        if value:
            return value
    return ''


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
            return _grab(block, labels)
        rows.append({
            't': title,
            'agency': grab([r'organisation', r'organization', r'agency', r'department', r'cluster', r'employer']),
            'loc': grab([r'location', r'region']),
            'url': href if href.startswith('http') else (site.rstrip('/') + href if href.startswith('/') else href),
            'salary': grab([r'salary', r'remuneration']),
            'close': grab([r'closing(?:\s+date)?', r'closes(?:\s+on)?']),
            'posted': iso_date(grab([r'posted(?:\s+date)?', r'posting\s+date',
                                     r'date\s+posted', r'published(?:\s+date)?',
                                     r'advertised(?:\s+date)?'])),
            'id': '',
        })
    return rows


# ── 3. job cards grouped by their detail link ────────────────────────────────
# Boards built on a component library (NSW iworkfor = Ant Design + React SSR)
# render one card as SEVERAL sibling anchors that all point at the same job URL —
# one for the title, one for the organisation, one for the location — each
# labelled for screen readers as `aria-label="Organization: <org> for <title>"`.
# Anchor-scraping such a card naively takes the ORG as the title (the <a> around
# the org span has the org as its text), which is why grouping by href and
# reading the aria-labels is the correct read.
ARIA_FIELD = re.compile(r'^\s*([A-Za-z ]{3,20})\s*:\s*(.+?)\s+for\s+(.+?)\s*$', re.S)
ARIA_TO_FIELD = {
    'organization': 'agency', 'organisation': 'agency', 'agency': 'agency',
    'department': 'agency', 'employer': 'agency', 'cluster': 'agency',
    'location': 'loc', 'region': 'loc',
    'salary': 'salary', 'remuneration': 'salary',
    'closing date': 'close', 'closes': 'close', 'job type': '', 'work type': '',
    'posted date': 'posted', 'posting date': 'posted', 'date posted': 'posted',
    'published date': 'posted',
}


def jobs_from_cards(html: str, href_re: str, site: str = '') -> list[dict]:
    """Group every anchor by its job-detail href and merge them into one record."""
    by_href: dict[str, dict] = {}
    order: list[str] = []
    pat = re.compile(r'<a\b([^>]*?)href="([^"]*' + href_re + r'[^"]*)"([^>]*)>(.*?)</a>', re.S | re.I)
    for m in pat.finditer(html or ''):
        attrs = (m.group(1) or '') + (m.group(3) or '')
        href, inner = m.group(2), m.group(4)
        rec = by_href.get(href)
        if rec is None:
            rec = {'t': '', 'agency': '', 'loc': '', 'salary': '', 'close': '', 'posted': '',
                   'url': href if href.startswith('http') else (site.rstrip('/') + href
                                                                if href.startswith('/') else href),
                   'id': ''}
            by_href[href] = rec
            order.append(href)
            # the numeric id usually tails the slug: .../my-role-591328
            tail = re.search(r'-(\d{3,})(?:[/?#]|$)', href)
            if tail:
                rec['id'] = tail.group(1)
        al = re.search(r'aria-label="([^"]*)"', attrs)
        text = text_of(inner)
        if al:
            lab = htmllib.unescape(al.group(1))
            fm = ARIA_FIELD.match(lab)
            if fm:
                field = ARIA_TO_FIELD.get(fm.group(1).strip().lower(), None)
                # "<Field>: <value> for <job title>" — carries the title too.
                if not rec['t']:
                    rec['t'] = fm.group(3).strip()
                if field and not rec[field]:
                    rec[field] = fm.group(2).strip()
                continue
            # a plain aria-label on the title anchor
            if not rec['t'] and MIN_TITLE <= len(lab) <= MAX_TITLE and ':' not in lab:
                rec['t'] = lab.strip()
        if text and not rec['t'] and MIN_TITLE <= len(text) <= MAX_TITLE:
            rec['t'] = text
        # Remember where this card sits so we can mine its block below.
        rec.setdefault('_span', (m.start(), m.end()))
        rec['_span'] = (min(rec['_span'][0], m.start()), max(rec['_span'][1], m.end()))

    # Boards that don't use aria-labels (SA/BigRedSky) put the organisation and
    # location in sibling elements instead — mine the surrounding block for any
    # field the anchors didn't supply, so grouping never loses context.
    for rec in by_href.values():
        span = rec.pop('_span', None)
        if not span or all(rec[k] for k in ('agency', 'loc')):
            continue
        s, e = max(0, span[0] - 1200), min(len(html or ''), span[1] + 1200)
        block = text_of((html or '')[s:e])

        def grab(labels):
            return _grab(block, labels)
        if not rec['agency']:
            rec['agency'] = grab([r'organisation', r'organization', r'agency',
                                  r'department', r'cluster', r'employer'])
        if not rec['loc']:
            rec['loc'] = grab([r'location', r'region'])
        if not rec['salary']:
            rec['salary'] = grab([r'salary', r'remuneration'])
        if not rec['close']:
            rec['close'] = grab([r'closing(?:\s+date)?', r'closes(?:\s+on)?'])
        if not rec['posted']:
            rec['posted'] = iso_date(grab([r'posted(?:\s+date)?', r'posting\s+date',
                                           r'date\s+posted', r'published(?:\s+date)?',
                                           r'advertised(?:\s+date)?']))
    return [by_href[h] for h in order if MIN_TITLE <= len(by_href[h]['t']) <= MAX_TITLE]


# ── combined ─────────────────────────────────────────────────────────────────
def extract_jobs(html: str, href_re: str = r'/job/[\w-]+', site: str = '') -> tuple[list[dict], str]:
    """Best-effort job extraction. Returns (rows, strategy-used).

    Strategy order matters. Embedded JSON and grouped job-cards are both
    structurally correct, so we take whichever finds more. Raw dom-anchors is a
    LAST RESORT — on a card-based board it returns one row per anchor (three per
    job on NSW) with the organisation as the title, so it would out-count and
    corrupt a correct card parse if allowed to compete on volume alone."""
    via_json = jobs_from_embedded_json(html)
    via_cards = jobs_from_cards(html, href_re, site)
    if via_json or via_cards:
        return ((via_json, 'embedded-json') if len(via_json) >= len(via_cards)
                else (via_cards, 'job-cards'))
    via_dom = jobs_from_anchors(html, href_re, site)
    return (via_dom, 'dom-anchors') if via_dom else ([], 'none')


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
    # The single most useful line when a parse returns 0: the actual hrefs. A
    # pattern mismatch (e.g. expecting /job/<digits> when the board serves
    # /job/<slug>-<id>) is obvious at a glance instead of costing a whole run.
    hrefs = re.findall(r'href="([^"#?]{4,90})"', html)
    if hrefs:
        from collections import Counter
        shapes = Counter(re.sub(r'\d+', 'N', h.rsplit('/', 1)[0] + '/') for h in hrefs)
        out.write('  [diag href shapes] ' + ', '.join(f'{p}({n})' for p, n in shapes.most_common(8)) + '\n')
        jobish = [h for h in hrefs if re.search(r'job|vacanc|career|position', h, re.I)][:5]
        if jobish:
            out.write('  [diag job hrefs] ' + ' | '.join(jobish) + '\n')
    # And whether aria-labels carry the fields (the NSW pattern).
    aria = re.findall(r'aria-label="([^"]{10,120})"', html)[:3]
    if aria:
        out.write('  [diag aria] ' + ' | '.join(aria) + '\n')
