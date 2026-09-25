#!/usr/bin/env python3
"""Company-to-company moves from a LinkedIn experience section.

WHAT THIS IS
The pure half of the talent-flow collector (scripts/collect-talent-flows.py).
Nothing here touches the network, the MCP server, SQLite or D1, which is what
makes it testable (scripts/test_talent_flows.py) and importable by both the
collector and the loader.

  parse_experience(text, refs)   positions out of the /details/experience/ page
  positions_from_brightdata(p)   positions out of a Bright Data LinkedIn profile record
  moves_from(positions)          the employer changes those positions imply
  person_key(username, salt)     a salted hash; the only per-person id kept
  company_ref(slug, name)        the vendor-style ref the canonical format uses
  aggregate(moves, start, end)   canonical rows (docs/talent-flows-plan.md),
                                 less acquisition transfers (ACQUISITIONS)

WHERE THE INPUT COMES FROM
stickerdaniel/linkedin-mcp-server's get_person_profile(sections="experience")
returns the page's innerText as one string plus up to 12 typed links per
section (link_metadata._REFERENCE_CAPS["experience"] == 12). The text has no
structure; the links carry /company/<slug>/ for employers that have a page.

THE PARSER HAS NOT SEEN A REAL PAGE. It is written from LinkedIn's layout as
publicly documented and the server's own code, because this sandbox cannot
sign in to LinkedIn. The fixtures in test_talent_flows.py are synthetic and say
so. Before trusting a run, calibrate with

    python scripts/collect-talent-flows.py --inspect <username>

which prints the raw text beside what this module made of it and stores
nothing. When the real layout disagrees, fix the rule here and add the real
shape (with the person's details replaced) as a fixture.

WHAT IT REFUSES TO GUESS
A position whose employer cannot be read is dropped and counted, not filed
under a neighbour. A move is only emitted when the next employer is
unambiguous. Every refusal is a counter the collector reports, so a layout
change shows up as a collapse in parsed positions rather than as fewer moves.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

MONTHS = {m: i for i, m in enumerate(
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], start=1)}
_MON = '|'.join(MONTHS)
_DATE = rf'(?:(?:{_MON})\s+)?\d{{4}}'

# "Jan 2020 - Present · 4 yrs 9 mos", "2016 - 2019 · 3 yrs", en dash or hyphen.
DATE_RANGE = re.compile(
    rf'^(?P<start>{_DATE})\s*[-–]\s*(?P<end>Present|{_DATE})(?:\s*·.*)?$')
ONE_DATE = re.compile(rf'^(?:(?P<mon>{_MON})\s+)?(?P<year>\d{{4}})$')

EMPLOYMENT_TYPES = (
    'Full-time', 'Part-time', 'Self-employed', 'Freelance', 'Contract',
    'Internship', 'Apprenticeship', 'Seasonal', 'Casual', 'Permanent',
    'Temporary', 'Volunteer')
_EMP = '|'.join(re.escape(t) for t in EMPLOYMENT_TYPES)
EMP_ONLY = re.compile(rf'^(?:{_EMP})$')
# "BHP · Full-time" — the single-role layout puts the employment type after
# the company on one line.
COMPANY_WITH_EMP = re.compile(rf'^(?P<company>.+?)\s*·\s*(?P<emp>{_EMP})$')
# A grouped entry's summary line: "Full-time · 5 yrs 2 mos", "3 yrs",
# "less than a year". It has a DURATION and no range, which is what tells a
# group header apart from a single role (whose duration rides on its range).
_DUR = r'(?:\d+\s+yrs?(?:\s+\d+\s+mos?)?|\d+\s+mos?|less than a year)'
DURATION_ONLY = re.compile(rf'^(?:(?:{_EMP})\s*·\s*)?{_DUR}$')

# Lines that are page furniture, not content. Dropped before anything else.
NOISE = re.compile(
    r'^(?:Experience|Show all.*|Show more.*|Show less.*|…see more|see more|'
    r'Skills:.*|\d+ endorsements?|Load more)$', re.IGNORECASE)

# Positions that are not someone's job: a board seat held alongside one, an
# advisory role, volunteering. Their end is not a move, and counting it as one
# is how a non-executive director becomes "talent lost to" the next board.
SIDE_ROLE_TITLE = re.compile(
    r'\b(?:board member|member of the board|non[- ]executive|advisor|adviser|'
    r'advisory|trustee|volunteer|mentor|ambassador|board of directors|'
    r'chair(?:man|woman|person)?)\b', re.IGNORECASE)
SIDE_ROLE_EMP = {'Self-employed', 'Freelance', 'Volunteer', 'Seasonal'}

# Move rules. GAP matches LinkedIn Talent Insights' own company-to-company
# definition (next role started < 6 months after the last ended), so the two
# sources at least disagree about coverage rather than about what a move is.
MAX_GAP_MONTHS = 6
# Overlap tolerated at the seam: people start the new job a few weeks before
# their old end date as written on the profile.
MAX_OVERLAP_MONTHS = 2


@dataclass(frozen=True)
class Month:
    """A calendar month, or a bare year (month=None) when that is all a
    profile gives. A bare year never becomes a move date: guessing January
    would be inventing precision the profile did not state."""
    year: int
    month: int | None

    @property
    def index(self) -> int | None:
        return None if self.month is None else self.year * 12 + self.month - 1

    def iso(self) -> str | None:
        return None if self.month is None else f'{self.year:04d}-{self.month:02d}'


def parse_month(s: str) -> Month | None:
    m = ONE_DATE.match(s.strip())
    if not m:
        return None
    mon = m.group('mon')
    return Month(int(m.group('year')), MONTHS[mon] if mon else None)


@dataclass
class Position:
    company: str
    slug: str | None
    title: str
    start: Month
    end: Month | None          # None = Present
    employment: str | None = None

    @property
    def key(self) -> str:
        return company_ref(self.slug, self.company)

    @property
    def side_role(self) -> bool:
        return bool(SIDE_ROLE_TITLE.search(self.title or '')) or (
            self.employment in SIDE_ROLE_EMP)


@dataclass
class ParseResult:
    positions: list[Position] = field(default_factory=list)
    dropped: Counter = field(default_factory=Counter)


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def company_ref(slug: str | None, name: str) -> str:
    """`li:<slug>` when the profile linked the employer's page, else
    `name:<normalised name>`. Only the first can be matched to the roster
    without judgement; the second is kept so off-roster volume is countable."""
    if slug:
        return f'li:{slug.lower()}'
    return f'name:{norm(name)}'


_SLUG = re.compile(r'/company/([^/?#]+)')


def company_links(refs) -> dict[str, str]:
    """normalised company name -> slug, from the section's references.

    Accepts the server's shape — a list of {kind, url, text} — or a dict of
    section -> list, in which case only "experience" is read."""
    if isinstance(refs, dict):
        refs = refs.get('experience') or []
    out: dict[str, str] = {}
    for r in refs or []:
        if not isinstance(r, dict) or r.get('kind') != 'company':
            continue
        m = _SLUG.search(str(r.get('url') or ''))
        text = re.sub(r'\s+logo$', '', str(r.get('text') or ''), flags=re.I).strip()
        if m and text:
            out.setdefault(norm(text), m.group(1))
    return out


def clean_lines(text: str) -> list[str]:
    lines = []
    for raw in (text or '').splitlines():
        line = raw.strip()
        if not line or NOISE.match(line):
            continue
        # LinkedIn renders most strings twice (a visible span and a
        # screen-reader span), and innerText keeps both. Adjacent duplicates
        # are never meaningful, so they collapse.
        if lines and lines[-1] == line:
            continue
        lines.append(line)
    return lines


def parse_experience(text: str, refs=None) -> ParseResult:
    """Positions from the experience page's text.

    Two layouts, told apart by a line only one of them has:

      single role              grouped (several roles at one employer)
      -----------              ---------------------------------------
      Title                    Company
      Company · Full-time      Full-time · 5 yrs 2 mos   <- DURATION_ONLY
      Jan 2020 - Present · …   Title A
      Location                 Jan 2022 - Present · …
                               Title B
                               Full-time                  (sometimes)
                               Jan 2019 - Dec 2021 · …

    Each date range is one position. Its employer is read from the line above
    it (single role) or from the open group header (grouped). A line above
    that is neither a linked company, nor carries an employment type, nor sits
    inside a group is not guessed at: the position is dropped and counted.
    """
    links = company_links(refs)
    lines = clean_lines(text)
    result = ParseResult()
    group: tuple[str, str | None] | None = None

    for i, line in enumerate(lines):
        # A group header is the line before a duration-only summary.
        if i + 1 < len(lines) and DURATION_ONLY.match(lines[i + 1]) \
                and not DATE_RANGE.match(line):
            group = (line, links.get(norm(line)))
            continue

        m = DATE_RANGE.match(line)
        if not m:
            continue
        start = parse_month(m.group('start'))
        end_s = m.group('end')
        end = None if end_s == 'Present' else parse_month(end_s)
        if start is None or (end_s != 'Present' and end is None):
            result.dropped['unreadable_date'] += 1
            continue

        above = lines[i - 1] if i >= 1 else ''
        above2 = lines[i - 2] if i >= 2 else ''
        emp = None

        cm = COMPANY_WITH_EMP.match(above)
        if cm and not DURATION_ONLY.match(above):
            # Single role: "Company · Full-time" above the range.
            company, emp, title = cm.group('company'), cm.group('emp'), above2
            group = None
        elif norm(above) in links and not EMP_ONLY.match(above):
            # Single role at a linked employer, no employment type given.
            company, title = above, above2
            group = None
        elif group is not None:
            # Inside a group: the line above is the title, or an employment
            # type with the title above that.
            company = group[0]
            if EMP_ONLY.match(above):
                emp, title = above, above2
            else:
                title = above
        else:
            result.dropped['no_employer'] += 1
            continue

        if not company or DATE_RANGE.match(company) or DURATION_ONLY.match(company):
            result.dropped['no_employer'] += 1
            continue
        slug = group[1] if (group and company == group[0]) else links.get(norm(company))
        result.positions.append(Position(
            company=company, slug=slug, title=title, start=start, end=end,
            employment=emp))
    return result


# ── Bright Data ────────────────────────────────────────────────────────────
#
# Bright Data's LinkedIn people-profiles dataset (gd_l1viktl72bvl7bjuj0,
# reached through @brightdata/mcp's search_dataset) returns work history
# already structured, so there is no layout to parse. Measured on Bright
# Data's own sample output (brightdata/linkedin-scraper-python,
# examples/sample_output.json, read 2026-09-24), each `experience` entry is
#
#   {"title": "Chairman and CEO", "company": "Microsoft",
#    "company_id": "microsoft",                       <- the LinkedIn slug
#    "url": "https://www.linkedin.com/company/microsoft",
#    "start_date": "Feb 2014", "end_date": "Present", "location": ...}
#
# Dates were "Mon YYYY" or "YYYY" there, and "Present" for a current role.
# One entry in that sample pointed at /school/ ("Member Board Of Trustees",
# University of Chicago): a school is not an employer move, so it is dropped.
# That sample is ONE profile, so any other shape is refused and counted, not
# guessed, and `--inspect` in the collector exists to see more before trusting
# a run. Entries carrying a `positions` list (several roles at one employer)
# are read defensively; that shape has not been seen in a real record.


def _bd_month(s) -> Month | None:
    return parse_month(re.sub(r'\s+', ' ', str(s or '').strip()))


def positions_from_brightdata(profile: dict) -> ParseResult:
    """Positions from one Bright Data LinkedIn profile record."""
    result = ParseResult()
    entries = []
    for e in profile.get('experience') or []:
        if not isinstance(e, dict):
            continue
        subs = e.get('positions')
        if isinstance(subs, list) and subs:
            for sub in subs:
                if isinstance(sub, dict):
                    entries.append({**e, **sub, 'positions': None})
        else:
            entries.append(e)
    for e in entries:
        url = str(e.get('url') or '')
        if '/school/' in url:
            result.dropped['school'] += 1
            continue
        name = str(e.get('company') or '').strip()
        if not name:
            result.dropped['no_employer'] += 1
            continue
        start = _bd_month(e.get('start_date'))
        if start is None:
            result.dropped['no_start_date'] += 1
            continue
        end_raw = str(e.get('end_date') or '').strip()
        if end_raw.lower() == 'present':
            end = None
        else:
            end = _bd_month(end_raw)
            if end is None:
                # Blank or unreadable is not "still there": reading it that
                # way would invent a current job.
                result.dropped['unreadable_end_date'] += 1
                continue
        m = _SLUG.search(url)
        slug = str(e.get('company_id') or '').strip() or (m.group(1) if m else None)
        result.positions.append(Position(
            company=name, slug=slug, title=str(e.get('title') or ''),
            start=start, end=end))
    return result


# ── moves ──────────────────────────────────────────────────────────────────

@dataclass
class Spell:
    """Consecutive positions at one employer, merged. Promotions inside a
    company are not moves."""
    key: str
    name: str
    start: Month
    end: Month | None


@dataclass(frozen=True)
class Move:
    from_ref: str
    from_name: str
    to_ref: str
    to_name: str
    month: str | None       # YYYY-MM the new job started; None = year-only dates


@dataclass
class MoveResult:
    moves: list[Move] = field(default_factory=list)
    skipped: Counter = field(default_factory=Counter)


def _end_index(m: Month | None) -> float:
    return float('inf') if m is None else (m.index if m.index is not None else m.year * 12 + 11)


def _start_index(m: Month) -> int:
    return m.index if m.index is not None else m.year * 12


def spells_from(positions: list[Position]) -> list[Spell]:
    by_key: dict[str, list[Position]] = defaultdict(list)
    for p in positions:
        if not p.side_role:
            by_key[p.key].append(p)
    spells: list[Spell] = []
    for key, ps in by_key.items():
        ps.sort(key=lambda p: _start_index(p.start))
        cur: Spell | None = None
        for p in ps:
            # A return to the same employer after a real gap is a new spell
            # (a boomerang), not one long tenure.
            if cur is not None and _start_index(p.start) <= _end_index(cur.end) + MAX_GAP_MONTHS:
                if _end_index(p.end) > _end_index(cur.end):
                    cur.end = p.end
                continue
            cur = Spell(key, p.company, p.start, p.end)
            spells.append(cur)
    spells.sort(key=lambda s: _start_index(s.start))
    return spells


def moves_from(positions: list[Position]) -> MoveResult:
    """Employer changes: spell S ends, spell T at another employer starts
    within [S.end - MAX_OVERLAP_MONTHS, S.end + MAX_GAP_MONTHS].

    Skipped, and counted, rather than guessed:
      ongoing      S has not ended
      no_next      nothing starts in the window (a career break, retirement,
                   or a next job at an employer without a readable date)
      ambiguous    two different employers start in the same earliest month
      concurrent   another employer's spell runs straight across S's end, so
                   S may have been the side job
    """
    out = MoveResult()
    spells = spells_from(positions)
    for s in spells:
        if s.end is None:
            out.skipped['ongoing'] += 1
            continue
        s_end = _end_index(s.end)
        concurrent = [u for u in spells if u is not s and u.key != s.key
                      and _start_index(u.start) < s_end - MAX_OVERLAP_MONTHS
                      and _end_index(u.end) > s_end + MAX_GAP_MONTHS]
        if concurrent:
            out.skipped['concurrent'] += 1
            continue
        cands = [t for t in spells if t.key != s.key
                 and _start_index(t.start) > _start_index(s.start)
                 and s_end - MAX_OVERLAP_MONTHS <= _start_index(t.start) <= s_end + MAX_GAP_MONTHS]
        if not cands:
            out.skipped['no_next'] += 1
            continue
        first = min(_start_index(t.start) for t in cands)
        firsts = {t.key for t in cands if _start_index(t.start) == first}
        if len(firsts) > 1:
            out.skipped['ambiguous'] += 1
            continue
        t = next(t for t in cands if _start_index(t.start) == first)
        month = None if (s.end.month is None or t.start.month is None) else t.start.iso()
        out.moves.append(Move(s.key, s.name, t.key, t.name, month))
    return out


# ── identity and aggregation ───────────────────────────────────────────────

def person_key(username: str, salt: bytes) -> str:
    """HMAC of the profile's vanity name. It exists so the same person is not
    counted twice across runs; without the salt it cannot be reversed by
    hashing candidate usernames."""
    if not salt:
        raise ValueError('person_key needs a non-empty salt')
    u = username.strip().rstrip('/').rsplit('/', 1)[-1].lower()
    return hmac.new(salt, u.encode(), hashlib.sha256).hexdigest()[:32]


@dataclass(frozen=True)
class Acquisition:
    acquired: str       # company ref of the business bought
    acquirer: str       # company ref of the buyer
    completed: str      # YYYY-MM the deal completed
    evidence: str


# A move between an acquired company and its buyer, dated at or after
# completion, is a change of owner on the payslip, not a hire: the person
# stayed where they were and the employer's name changed. Left in, it reads
# as a large, false flow of talent.
#
# Measured 2026-09-25 on 7,160 BHP profiles: OZ Minerals -> BHP ran at about
# one move every few months from 2015 to 2020, none in 2023-01..04, then 22
# dated 2023-05 and 12 more by 2024-04, making it BHP's second-largest source
# of hires (40 of 890 over 60 months). The later trickle is profiles updated
# late, so the rule is open-ended rather than one month wide: after
# completion there is no independent OZ Minerals to be hired from.
#
# Both directions are dropped (BHP -> OZ Minerals after completion is an
# internal transfer too). Matching is by ref only: a name-matched variant
# such as "OZ Minerals/BHP" is not caught, and would need its own entry.
ACQUISITIONS = (
    Acquisition('li:oz-minerals', 'li:bhp', '2023-05',
                'BHP media release "Completion of OZ Minerals acquisition", 2 May 2023: '
                'https://www.bhp.com/news/media-centre/releases/2023/05/completion-of-oz-minerals-acquisition'),
)


def acquisition_of(from_ref: str, to_ref: str, month: str | None) -> Acquisition | None:
    """The acquisition that makes this move a transfer, or None. A move with
    no month cannot be placed either side of completion, and aggregate()
    already leaves it out."""
    if not month:
        return None
    for a in ACQUISITIONS:
        if {from_ref, to_ref} == {a.acquired, a.acquirer} and month >= a.completed:
            return a
    return None


def exclusion_report(excluded: Counter) -> list[dict]:
    """What aggregate() left out as acquisition transfers, for import.json:
    a reader of the export must be able to see a flow was removed, and why."""
    out = []
    for (f, t), n in sorted(excluded.items(), key=lambda kv: (-kv[1], kv[0])):
        a = next(x for x in ACQUISITIONS if {f, t} == {x.acquired, x.acquirer})
        out.append({'from_ref': f, 'to_ref': t, 'moves': n,
                    'reason': f'{a.acquirer} acquired {a.acquired}; moves from {a.completed} on '
                              'are transfers', 'evidence': a.evidence})
    return out


def aggregate(moves, start: str, end: str, excluded: Counter | None = None) -> list[dict]:
    """Canonical rows (from_ref, from_name, to_ref, to_name, period_start,
    period_end, moves, count_kind) for moves whose month is inside
    [start, end] (YYYY-MM, inclusive). Year-only moves are left out: they
    cannot be placed inside a window. Moves that ACQUISITIONS marks as
    transfers are left out too, and counted into `excluded` by
    (from_ref, to_ref) when it is given, so the export can say so."""
    counts: Counter = Counter()
    names: dict[str, Counter] = defaultdict(Counter)
    for mv in moves:
        month = mv['month'] if isinstance(mv, dict) else mv.month
        if not month or not (start <= month <= end):
            continue
        get = (lambda k: mv[k]) if isinstance(mv, dict) else (lambda k: getattr(mv, k))
        if acquisition_of(get('from_ref'), get('to_ref'), month):
            if excluded is not None:
                excluded[(get('from_ref'), get('to_ref'))] += 1
            continue
        counts[(get('from_ref'), get('to_ref'))] += 1
        names[get('from_ref')][get('from_name')] += 1
        names[get('to_ref')][get('to_name')] += 1
    first = f'{start}-01'
    y, m = map(int, end.split('-'))
    last_day = [31, 29 if (y % 4 == 0 and (y % 100 or y % 400 == 0)) else 28,
                31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    last = f'{end}-{last_day:02d}'
    return [{
        'from_ref': f, 'from_name': names[f].most_common(1)[0][0],
        'to_ref': t, 'to_name': names[t].most_common(1)[0][0],
        'period_start': first, 'period_end': last,
        'moves': n, 'count_kind': 'sampled',
    } for (f, t), n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
