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
  coverage_end(counts, cap)      the last month the data covers: where a window ends
  aggregate(moves, start, end)   canonical rows (docs/talent-flows-plan.md),
                                 less acquisition transfers, non-employers and
                                 moves inside one employer (SAME_EMPLOYER)

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
    title: str = ''         # the job the person joined in; used for skills, never stored


@dataclass(frozen=True)
class Move:
    from_ref: str
    from_name: str
    to_ref: str
    to_name: str
    month: str | None       # YYYY-MM the new job started; None = year-only dates
    # The title of the job moved INTO. Read once, by skills_of(), and never
    # stored: the collector keeps the skills it implies and drops the text.
    to_title: str = ''


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
            cur = Spell(key, p.company, p.start, p.end, p.title or '')
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
        out.moves.append(Move(s.key, s.name, t.key, t.name, month, t.title))
    return out


# ── skills ──────────────────────────────────────────────────────────────────
#
# A move's skills are the skills of the job it went INTO, matched from that
# job's title by the app's own matcher: skillsForText in
# src/employsi/data/skillsTaxonomy.ts, run through scripts/skills-for-titles.ts
# as one long-lived bun process. Not the Python port in skills_taxonomy.py:
# that one reads only top-level skills with no industry gates, and measured
# 2026-09-25 it disagreed with the app on "Workforce Planning Lead" (the app
# adds the child skill Workforce Planning) and "Truck Driver" (Truck Driving).
# CLAUDE.md asks for one matcher wherever a role enters.
#
# A title can match several skills, so skill counts do not sum to the move
# count. A title that matches none gives no skill row, and the move still
# counts at company level. The title goes to the local bun process and is
# not stored: only the skill names come back from this function.

_skill_proc = None
_skill_memo: dict[str, list[str]] = {}


def _skills_for_title(title: str) -> list[str]:
    global _skill_proc
    import json
    import os
    import subprocess
    if title in _skill_memo:
        return _skill_memo[title]
    if _skill_proc is None or _skill_proc.poll() is not None:
        here = os.path.dirname(os.path.abspath(__file__))
        _skill_proc = subprocess.Popen(
            ['bun', 'run', os.path.join(here, 'skills-for-titles.ts')],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
            cwd=os.path.dirname(here))
    _skill_proc.stdin.write(json.dumps(title) + '\n')
    _skill_proc.stdin.flush()
    line = _skill_proc.stdout.readline()
    if not line:
        raise RuntimeError('scripts/skills-for-titles.ts stopped answering')
    _skill_memo[title] = json.loads(line)
    return _skill_memo[title]


def skills_of(move) -> list[str]:
    title = (move['to_title'] if isinstance(move, dict) else move.to_title) or ''
    return _skills_for_title(title) if title.strip() else []


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
    # Rio Tinto completed its purchase of Arcadium Lithium on 6 March 2025.
    # Allkem merged into Arcadium in January 2024, so an Allkem page after the
    # deal is the same business under a name its staff never updated.
    # Measured 2026-09-25 on 7,820 Rio Tinto profiles: one Arcadium -> Rio
    # Tinto move, dated 2025-03. The Allkem -> Rio Tinto moves of 2019, 2022
    # and 2023 were hires, and stay.
    Acquisition('li:arcadiumlithium', 'li:rio-tinto', '2025-03',
                'Rio Tinto 6-K "Rio Tinto completes acquisition of Arcadium Lithium", '
                '6 March 2025: https://www.sec.gov/Archives/edgar/data/863064/'
                '000162828025016021/ex04d06arcadiumcomplete.htm'),
    Acquisition('li:allkemltd', 'li:rio-tinto', '2025-03',
                'as Arcadium: Allkem and Livent merged as Arcadium Lithium in January 2024'),
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


# Names that are a way of working, not an employer. A move to or from one is
# not a flow between companies, so neither end is counted; the spell still
# separates the jobs either side of it, so X -> Freelance -> BHP is not
# turned into X -> BHP. Compared after norm(), whatever the ref: "Independent
# Consultant" arrives as a LinkedIn page (li:hd-independent-consultant).
# Measured 2026-09-25 on the 60-month export of 7,160 BHP profiles:
# Freelance 11 moves, Self-employed 7, Independent Consultant 1. The rest
# are LinkedIn's own labels for the same thing. A name that normalises to
# nothing ("-", 1 move) became the ref `name:`, which flows-to-d1.py
# refuses, failing the whole file; it is dropped here too.
#
# Added 2026-09-25 when Fortescue's 7,928 profiles joined BHP's: every label
# that meant "no employer" and moved 3 or more moves across both seeds, all
# time. Various / Various Companies 30, N/A / none 26, Independent 5,
# Travelling 4, Self 3, Private 3, "n/a - currently unemployed" 3,
# "Consultant / Self-Employed" 3. Exact names only: "Independent Metallurgical
# Operations (IMO)" is a company and stays. Left out at 2 each: "Various
# (Temporary Assignments)", "Various Temporary Agencies", "Various Small
# Business" (the first two are agency work, not no employer).
NOT_EMPLOYERS = frozenset(norm(n) for n in (
    'Freelance', 'Freelancer', 'Self-employed', 'Self employed',
    'Independent Consultant', 'Independent Contractor', 'Career Break',
    'Various', 'Various Companies', 'N/A', 'None', 'Independent', 'Travelling',
    'Self', 'Private', 'n/a - currently unemployed', 'Consultant / Self-Employed',
    # With the Rio Tinto seed: Sabbatical 4, Maternity Leave 4, On Maternity
    # Leave 3, "Freelance (Self employed)" 3. "Travelers" and "Travel Money
    # Oz" are companies, as is "Independent Market Operator".
    'Sabbatical', 'Maternity Leave', 'On Maternity Leave', 'Freelance (Self employed)'))


def not_employer(ref: str, name: str) -> bool:
    return ref == 'name:' or not norm(name) or norm(name) in NOT_EMPLOYERS


# Pages that are the same employer as a roster company: its subsidiaries,
# operations and old names. A profile that lists "BHP Billiton Nickel West"
# then "BHP" has not changed employer, and counting it made BHP one of its own
# sources of hires. aggregate() maps each alias to its employer's ref, so a
# move between two of them is dropped as internal and a move from elsewhere
# into one of them counts as a hire into the employer.
#
# BHP, measured 2026-09-25 on the 60-month export of 15,490 BHP profiles: 29 refs
# that look like BHP moved 70 moves, 39 of them into BHP. The 22 below are
# BHP's own. Left out on purpose, and why:
#   - agency labels ("BHP (Contracting through Chandler Macleod)", "BHP
#     (Spencer Ogden)", "BMA - Workpac", "Michael Page Contractor for BHP",
#     "BHP/Programmed"): the employer of record was the agency;
#   - (was: "BHP Billiton Mitsui Coal", left out as sold to Stanmore in 2022.
#     Added with the Rio Tinto seed: a label that carries the parent's name
#     only existed while the parent ran it, so the move was inside BHP.
#     After the sale the same mine is listed under Stanmore's name.)
#   - "OS BHP", "BMA Systems Pty Ltd": not clear what they are.
# Matching is by exact ref, like ACQUISITIONS: a new spelling needs a line.
SAME_EMPLOYER: dict[str, tuple[str, frozenset[str]]] = {
    'li:bhp': ('BHP', frozenset((
        'name:bhp', 'name:bhp billiton', 'name:bhp biliton',
        # Nickel West, wholly owned
        'li:bhp-billiton-nickel-west-pty-ltd', 'name:bhp billiton nickel west pty ltd',
        'name:bhp nickel west mt keith', 'name:bhp billiton mt keith operation',
        'name:bhp nickel west refinery',
        # BHP Mitsubishi Alliance: a 50:50 joint venture that BHP operates
        'name:bhp billiton mitsubishi alliance pty limited', 'name:bhp mitsubishi alliance',
        'name:bma bhp mitsubishi alliance', 'name:caval ridge bma',
        # Western Australia Iron Ore and its sites
        'name:bhp billiton western australian iron ore', 'name:bhp waio technology',
        'name:bhp mining area c waio', 'name:bhp billiton newman operations',
        'name:bhp south flank project',
        # others
        'name:bhp olympic dam', 'li:bhp-copper-inc',
        'name:bhp operation services',   # BHP Operations Services, its own labour-hire arm
        'li:bhp-billiton-mitsui-coal-pty.-ltd.',  # the BHP-era name, before the 2022 sale
        'name:oz minerals bhp',          # "OZ Minerals/BHP": after the 2023 acquisition
    ))),
    # Measured 2026-09-25 on the 60-month export of both seeds: 12 refs that
    # look like Fortescue, ~20 moves. These 8 are Fortescue's own. Left out
    # as agency or contractor labels: "WorkPac- FMG", "Chandler Macleod FMG
    # Cloudbreak", "FMG Civeo – Eliwana" (Civeo runs the camps),
    # "Wirlu-Murra FMG" (a contracting company that works on FMG sites).
    'li:fortescue': ('Fortescue', frozenset((
        'name:fortescue metals group', 'name:fortescue metals group ltd',
        'name:fortescue metal group', 'name:fortescue metals', 'name:fmg',
        'li:fortescue-metals-group-ltd-cloud-break', 'name:fmg christmas creek',
        'name:fmg ironbridge project',   # Iron Bridge: a joint venture Fortescue operates
    ))),
    # Measured 2026-09-25 on 7,820 Rio Tinto profiles, all time: ~60 refs
    # that look like Rio Tinto. These are its own: its names and business
    # units, the old names of businesses it owns outright (Hamersley Iron,
    # Argyle, Pacific Aluminium, Alcan's Australian operations after 2007),
    # Robe River and Dampier Salt, which it runs. Labels carrying "Rio Tinto"
    # for businesses since sold (Coal Australia, Kestrel) are in as well:
    # such a label only existed while Rio Tinto ran them. Left out, as their
    # own employers: Queensland Alumina, Tomago Aluminium and Boyne Smelters
    # (joint ventures that employ their own staff), Energy Resources of
    # Australia (listed separately, and the employer even when a profile
    # writes "Rio Tinto Energy Resources of Australia"), Alcan before Rio
    # Tinto bought it in 2007, and the WorkPac labels.
    'li:rio-tinto': ('Rio Tinto', frozenset((
        'name:rio tinto', 'name:riotinto', 'name:rtio',
        'name:rio tinto iron ore', 'name:riotinto iron ore', 'name:rio tinto minerals',
        'name:rio tinto exploration', 'li:rio-tinto-mining-and-exploration-limited',
        'name:rio tinto procurement', 'name:rio tinto shared services', 'name:rio tinto copper',
        'name:rio tinto iron and titanium', 'name:rio tinto diamonds',
        'name:rio tinto aluminium', 'li:rio-tinto-aluminium',
        'name:rio tinto alcan', 'name:rio tinto alcan yarwun', 'name:rio tinto yarwun',
        'name:rio tinto alcan gove',
        'name:hamersley iron', 'name:hamersley iron pty ltd', 'li:hamersley-iron-pty-ltd.',
        'name:robe river iron', 'li:robe-river-limited',
        'name:argyle diamonds', 'li:argyle-diamonds-limited', 'name:rio tinto argyle diamonds',
        'name:argyle diamond mine',
        'li:dampier-salt-limited',
        'name:pacific aluminium', 'li:pacific-aluminium-pty-limited',
        'name:rio tinto coal australia', 'name:rio tinto kestrel',
        # Added when the seed completed (16,752 profiles), same rules: its own
        # sites and units, a second spelling of Robe River and Dampier Salt,
        # and Comalco, Rio Tinto Aluminium's name until 2006. Still left out:
        # "Kestrel Coal Resources" (the name after the sale), the DT
        # Workforce and WorkPac labels (agencies), Oyu Tolgoi (a joint
        # venture with its own staff), Argyle Engineering and Alcan
        # Engineering (other companies).
        'name:rio tinto marandoo', 'name:rio tinto iron ore brockman 4',
        'name:rio tinto bell bay aluminium', 'name:rio tinto pacific aluminium',
        'name:rio tinto technology innovation', 'name:rio tinto is t',
        'name:rio tinto growth innovation',
        'name:robe river iron associates', 'name:dampier salt limited',
        'name:comalco', 'name:comalco aluminium ltd',
    ))),
}
_ALIAS = {a: (canon, name) for canon, (name, aliases) in SAME_EMPLOYER.items() for a in aliases}


def employer_of(ref: str, name: str) -> tuple[str, str]:
    """The (ref, name) a move is counted under: the employer's own for an
    alias in SAME_EMPLOYER, unchanged otherwise."""
    return _ALIAS.get(ref, (ref, name))


def exclusion_report(excluded: Counter) -> dict:
    """What aggregate() left out, for import.json: a reader of the export
    must be able to see a flow was removed, and why."""
    out = {'acquisition_transfers': [], 'not_employers': [], 'same_employer': [],
           'merged_into_employer': []}
    for key, n in sorted(excluded.items(), key=lambda kv: (-kv[1], kv[0])):
        if key[0] == 'acquisition':
            _, f, t = key
            a = next(x for x in ACQUISITIONS if {f, t} == {x.acquired, x.acquirer})
            out['acquisition_transfers'].append({
                'from_ref': f, 'to_ref': t, 'moves': n,
                'reason': f'{a.acquirer} acquired {a.acquired}; moves from {a.completed} on '
                          'are transfers', 'evidence': a.evidence})
        elif key[0] == 'same_employer':
            _, f, t = key
            out['same_employer'].append({'from_ref': f, 'to_ref': t, 'moves': n,
                                         'employer': employer_of(f, '')[0]})
        elif key[0] == 'merged':
            # Not removed: counted under the employer instead of the alias.
            _, ref, name = key
            out['merged_into_employer'].append({'ref': ref, 'name': name, 'moves': n,
                                                'employer': employer_of(ref, name)[0]})
        else:
            _, ref, name = key
            out['not_employers'].append({'ref': ref, 'name': name, 'moves': n})
    return out


def month_add(ym: str, n: int) -> str:
    y, m = map(int, ym.split('-'))
    i = y * 12 + m - 1 + n
    return f'{i // 12:04d}-{i % 12 + 1:02d}'


# THE WINDOW ENDS WHERE THE DATA DOES, not at today minus a lag. Measured
# 2026-09-25 on 18,646 dated moves from 14,040 BHP profiles: the latest move
# was 2025-10, while today minus the 3-month lag the exports used gave
# 2026-06. That window ran eight empty months past the data. Moves a month
# also thin out toward the end (~50-60 in 2023, ~40 in 2024, ~25 by mid-2025,
# 13 in 2025-10): the source was collected months ago and people update
# profiles late. The lag was recorded as an assumption, and this measurement
# showed it was wrong. It stays as a cap, for a source that is current.
#
# `run` guards against a lone profile dated past the rest: the end month
# and the run-1 months before it must all hold moves. Nothing here decides
# how thin a month may be before it is "incomplete". That would be a
# threshold with no measurement behind it, so the export reports the last
# months' counts (tail_counts) and a reader can see the thinning.
def coverage_end(month_counts, cap: str, run: int = 3) -> str | None:
    """The latest YYYY-MM no later than `cap` that holds moves, with each of
    the `run`-1 months before it holding moves too. None if no month does."""
    have = {m for m, n in month_counts.items() if n and m and len(m) == 7 and m <= cap}
    for m in sorted(have, reverse=True):
        if all(month_add(m, -i) in have for i in range(run)):
            return m
    return None


def tail_counts(month_counts, end: str, n: int = 6) -> dict[str, int]:
    """Moves in each of the `n` months up to `end`, oldest first."""
    return {m: int(month_counts.get(m, 0)) for m in (month_add(end, -i) for i in range(n - 1, -1, -1))}


def window_note(end: str, cap: str) -> str:
    """The sentence import.json's notes carry about where the window ends."""
    if end < cap:
        return (f'The window ends at {end}, the last month the collected profiles cover, '
                f'not at {cap}: the profiles were collected months before the export, and '
                'the last months before the end are thin because people update profiles '
                'late (filters.moves_per_month_to_end).')
    return (f'The window ends at {end}, {cap} being the cap: profiles are updated late, so '
            'the months before the end may be thin (filters.moves_per_month_to_end).')


def aggregate(moves, start: str, end: str, excluded: Counter | None = None) -> list[dict]:
    """Canonical rows (from_ref, from_name, to_ref, to_name, period_start,
    period_end, moves, count_kind) for moves whose month is inside
    [start, end] (YYYY-MM, inclusive). Year-only moves are left out: they
    cannot be placed inside a window. Moves that ACQUISITIONS marks as
    transfers, moves to or from a NOT_EMPLOYERS name, and moves between two
    pages of one SAME_EMPLOYER are left out too; an alias's other moves are
    counted under its employer. Both are counted into `excluded` when it is
    given, so the export can say so."""
    counts: Counter = Counter()
    names: dict[str, Counter] = defaultdict(Counter)
    for mv in moves:
        month = mv['month'] if isinstance(mv, dict) else mv.month
        if not month or not (start <= month <= end):
            continue
        get = (lambda k: mv[k]) if isinstance(mv, dict) else (lambda k: getattr(mv, k))
        drop = None
        for end_ in ('from', 'to'):
            if not_employer(get(f'{end_}_ref'), get(f'{end_}_name')):
                drop = ('not_employer', get(f'{end_}_ref'), get(f'{end_}_name'))
                break
        f_ref, f_name = employer_of(get('from_ref'), get('from_name'))
        t_ref, t_name = employer_of(get('to_ref'), get('to_name'))
        if drop is None and f_ref == t_ref:
            drop = ('same_employer', get('from_ref'), get('to_ref'))
        if drop is None and acquisition_of(f_ref, t_ref, month):
            drop = ('acquisition', f_ref, t_ref)
        if drop:
            if excluded is not None:
                excluded[drop] += 1
            continue
        if excluded is not None:
            for end_, ref in (('from', f_ref), ('to', t_ref)):
                if ref != get(f'{end_}_ref'):
                    excluded[('merged', get(f'{end_}_ref'), get(f'{end_}_name'))] += 1
        counts[(f_ref, t_ref)] += 1
        names[f_ref][f_name] += 1
        names[t_ref][t_name] += 1
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
