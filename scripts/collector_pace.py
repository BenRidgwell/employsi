#!/usr/bin/env python3
"""Pacing and halt state for collect-talent-flows.py.

WHY THIS IS SEPARATE FROM THE COLLECTOR
The collector already stopped on push-back, but its pacing was, in its own
words, "a courtesy pace, not a measured safe limit": a FIXED 60s gap, a cap
that counted only the current run, and a stop that lasted until the next
command. Each of those is the kind of control that looks like a safeguard and
is not one, so they are gathered here where they can be read and tested
without a LinkedIn session.

WHAT IT CANNOT DO, STATED ONCE
None of this makes an account safe. LinkedIn's User Agreement prohibits
automated access and the detection that matters is not only pacing — it is
also reading hundreds of profiles with no connection to you, from a browser
fingerprint and an IP that are not your usual ones. These controls lower the
rate and stop on the first refusal. They do not make the activity permitted,
and no setting here is a measured safe limit; there isn't one to measure.

THE FOUR CONTROLS

1. JITTER, not a fixed interval. A request exactly every 60.0s is a cleaner
   signal of automation than a fast one: humans do not have a clock. Each gap
   is drawn uniformly from [MIN_GAP, MAX_GAP], and a longer break follows
   every BREAK_EVERY profiles, because an unbroken hour of profile views is
   not a shape a person makes either.

2. A DAILY CAP THAT SURVIVES THE PROCESS. `--max-profiles` bounded one run,
   so ten runs was ten times the cap with nothing to notice. The cap here is
   counted from the log, by local calendar day, so re-running after a stop
   resumes against the same budget rather than resetting it.

3. HOURS AND DAYS. Reads happen inside a waking-hours window in the machine's
   own timezone, which is the user's; 03:00 activity is a signal pacing cannot
   hide. Weekends are off by default for the same reason a seven-day pattern
   is: people take days off.

4. A HALT THAT PERSISTS. A rate limit, checkpoint or captcha writes a halt row
   and every later run refuses to start until a person clears it. The run that
   gets a checkpoint and tries again an hour later is the one that turns a
   warning into a restriction, and the collector cannot tell the difference
   from inside. Clearing is deliberate and manual (`--clear-halt`).

Every request is logged — time, tool, outcome — so the pace can be audited
after the fact rather than trusted. The log holds no profile identifiers: the
unit is "a profile was read", never which one.
"""
from __future__ import annotations

import datetime as dt
import random
import sqlite3

# Defaults. Deliberately slow; see the note above on what they are not.
MIN_GAP = 45.0          # seconds between reads, lower bound
MAX_GAP = 90.0          # upper bound; each gap is drawn uniformly between them
DAILY_CAP = 120         # profile reads per local calendar day, all runs together
BREAK_EVERY = 25        # profiles between longer breaks
BREAK_MIN = 300.0       # 5–12 minutes, also jittered
BREAK_MAX = 720.0
START_HOUR = 8          # local clock, inclusive
END_HOUR = 20           # local clock, exclusive: a read may not START at 20:00
WEEKENDS = False        # Mon–Fri only unless opted in

SCHEMA = """
-- One row per request sent to LinkedIn, for auditing the pace afterwards.
-- No profile identifier: the unit is "a profile was read", never which one.
CREATE TABLE IF NOT EXISTS pace_log (
  at      TEXT NOT NULL,          -- ISO local timestamp
  day     TEXT NOT NULL,          -- YYYY-MM-DD, local; the daily cap counts these
  tool    TEXT NOT NULL,          -- the MCP tool called
  kind    TEXT NOT NULL,          -- profile | list | other
  outcome TEXT NOT NULL,          -- ok | error | stop
  note    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pace_log_day ON pace_log (day);
-- At most one row. Its presence means every run must refuse to start.
CREATE TABLE IF NOT EXISTS pace_halt (
  at     TEXT NOT NULL,
  reason TEXT NOT NULL
);
"""


class Halted(Exception):
    """A previous run met push-back. Refuse to start until a person clears it."""


class CapReached(Exception):
    """The day's budget is spent, or the window has closed. Not an error."""


def install(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def halt(conn: sqlite3.Connection, reason: str) -> None:
    """Record push-back. Idempotent: the FIRST reason is kept, because that is
    the one that describes what actually happened.

    Installs the schema itself rather than assuming a Pacer built it. This is
    reached from an error path, and a halt that throws because a table is
    missing would leave the collector free to run again — the one failure
    this module exists to prevent."""
    install(conn)
    if not conn.execute('SELECT 1 FROM pace_halt').fetchone():
        conn.execute('INSERT INTO pace_halt VALUES (?,?)',
                     (dt.datetime.now().isoformat(timespec='seconds'), reason[:300]))
        conn.commit()


def halted(conn: sqlite3.Connection) -> tuple[str, str] | None:
    install(conn)  # a missing table must read as "not halted", never as a crash
    row = conn.execute('SELECT at, reason FROM pace_halt').fetchone()
    return (row[0], row[1]) if row else None


def clear_halt(conn: sqlite3.Connection) -> int:
    n = conn.execute('DELETE FROM pace_halt').rowcount
    conn.commit()
    return n


def read_today(conn: sqlite3.Connection, now: dt.datetime | None = None) -> int:
    """Profile reads already logged for the local calendar day."""
    day = (now or dt.datetime.now()).date().isoformat()
    return conn.execute(
        "SELECT COUNT(*) FROM pace_log WHERE day = ? AND kind = 'profile' AND outcome != 'stop'",
        (day,)).fetchone()[0]


def in_window(now: dt.datetime, start: int = START_HOUR, end: int = END_HOUR,
              weekends: bool = WEEKENDS) -> bool:
    if not weekends and now.weekday() >= 5:
        return False
    return start <= now.hour < end


class Pacer:
    """Decides whether the next read may happen, and how long to wait first.

    It does not sleep: the caller does, so a test can read the gap without
    waiting for it and the collector can print what it is waiting for.
    """

    def __init__(self, conn: sqlite3.Connection, *, min_gap: float = MIN_GAP,
                 max_gap: float = MAX_GAP, daily_cap: int = DAILY_CAP,
                 break_every: int = BREAK_EVERY, break_min: float = BREAK_MIN,
                 break_max: float = BREAK_MAX, start_hour: int = START_HOUR,
                 end_hour: int = END_HOUR, weekends: bool = WEEKENDS,
                 rng: random.Random | None = None, clock=None):
        if min_gap > max_gap:
            raise ValueError('min_gap is above max_gap')
        self.conn = conn
        # ONE clock for both the log and the gates. They used to read the time
        # separately, which made "which day is it" answerable two ways — a
        # disagreement that is invisible except across midnight, where the cap
        # would reset mid-run or fail to.
        self.clock = clock or dt.datetime.now
        self.min_gap, self.max_gap = min_gap, max_gap
        self.daily_cap = daily_cap
        self.break_every, self.break_min, self.break_max = break_every, break_min, break_max
        self.start_hour, self.end_hour, self.weekends = start_hour, end_hour, weekends
        self.rng = rng or random.Random()
        self.this_run = 0
        install(conn)

    # ── gates ───────────────────────────────────────────────────────────────

    def check_start(self, now: dt.datetime | None = None) -> None:
        """Raise before the first request of a run. Halt beats the window:
        a halted collector is not merely out of hours."""
        now = now or self.clock()
        h = halted(self.conn)
        if h:
            raise Halted(
                f'halted {h[0]} after LinkedIn pushed back: {h[1]}\n'
                'Nothing will run until this is cleared by hand (--clear-halt). '
                'Clear it only after signing in to LinkedIn in a normal browser '
                'and confirming the account is in good standing.')
        if not in_window(now, self.start_hour, self.end_hour, self.weekends):
            raise CapReached(
                f'outside the collecting window ({self.start_hour:02d}:00–{self.end_hour:02d}:00 '
                f'{"Mon–Sun" if self.weekends else "Mon–Fri"} local); it is '
                f'{now:%a %H:%M}')
        left = self.daily_cap - read_today(self.conn, now)
        if left <= 0:
            raise CapReached(f'the daily cap of {self.daily_cap} profiles is already spent')

    def remaining_today(self, now: dt.datetime | None = None) -> int:
        return max(0, self.daily_cap - read_today(self.conn, now or self.clock()))

    # ── the gap before the next read ────────────────────────────────────────

    def next_gap(self) -> tuple[float, str]:
        """Seconds to wait before the next profile read, and why.

        The first read of a run waits too. Starting instantly makes the gap
        between two runs the one interval nothing paces, which is where a
        stopped-and-restarted run would otherwise burst.
        """
        if self.this_run and self.break_every and self.this_run % self.break_every == 0:
            return self.rng.uniform(self.break_min, self.break_max), 'break'
        return self.rng.uniform(self.min_gap, self.max_gap), 'gap'

    # ── logging ─────────────────────────────────────────────────────────────

    def log(self, tool: str, kind: str, outcome: str, note: str = '') -> None:
        now = self.clock()
        self.conn.execute('INSERT INTO pace_log VALUES (?,?,?,?,?,?)', (
            now.isoformat(timespec='seconds'), now.date().isoformat(),
            tool, kind, outcome, note[:200] or None))
        self.conn.commit()
        if kind == 'profile' and outcome != 'stop':
            self.this_run += 1

    def check_continue(self, now: dt.datetime | None = None) -> None:
        """Raise before each FURTHER read. The window is re-checked every time:
        a long run started at 19:50 must not read its way past the end hour."""
        now = now or self.clock()
        if not in_window(now, self.start_hour, self.end_hour, self.weekends):
            raise CapReached(f'the collecting window closed at {self.end_hour:02d}:00')
        if self.remaining_today(now) <= 0:
            raise CapReached(f'the daily cap of {self.daily_cap} profiles is spent')


def format_log(conn: sqlite3.Connection, days: int = 14) -> str:
    """The pace, by day, for auditing after the fact."""
    since = (dt.date.today() - dt.timedelta(days=days - 1)).isoformat()
    rows = conn.execute(
        "SELECT day, SUM(kind = 'profile' AND outcome != 'stop') AS profiles, "
        "COUNT(*) AS calls, SUM(outcome = 'error') AS errors, MIN(at) AS first, MAX(at) AS last "
        "FROM pace_log WHERE day >= ? GROUP BY day ORDER BY day", (since,)).fetchall()
    if not rows:
        return 'No requests logged.'
    out = [f'{"day":<12}{"profiles":>9}{"calls":>7}{"errors":>8}   first–last (local)']
    for r in rows:
        out.append(f'{r["day"]:<12}{r["profiles"]:>9}{r["calls"]:>7}{r["errors"]:>8}   '
                   f'{r["first"][11:16]}–{r["last"][11:16]}')
    h = halted(conn)
    if h:
        out.append(f'\nHALTED {h[0]}: {h[1]}')
    return '\n'.join(out)
