#!/usr/bin/env python3
"""Checks for scripts/collector_pace.py.

These assert the four controls that are easy to write and easy to get subtly
wrong, and whose failure is silent: a cap that resets, a halt that lifts
itself, a window that only closes at the start of a run, and a "jittered"
gap that is not. None of them would look broken while running — the collector
would simply read more, or later, or at a steadier rhythm, than intended.

Run: python scripts/test_collector_pace.py
"""
from __future__ import annotations

import datetime as dt
import os
import random
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collector_pace import (  # noqa: E402
    CapReached, Halted, Pacer, clear_halt, format_log, halt, halted, in_window, read_today)

failures = 0


def check(name, cond, detail=''):
    global failures
    if cond:
        print(f'  ok  {name}')
    else:
        failures += 1
        print(f'FAIL  {name}{" — " + str(detail) if detail else ""}')


def conn() -> sqlite3.Connection:
    c = sqlite3.connect(':memory:')
    c.row_factory = sqlite3.Row
    return c


# A Wednesday at 10:00, inside every default window.
WED_10 = dt.datetime(2026, 10, 7, 10, 0)
SAT_10 = dt.datetime(2026, 10, 10, 10, 0)
WED_03 = dt.datetime(2026, 10, 7, 3, 0)
WED_20 = dt.datetime(2026, 10, 7, 20, 0)


def test_halt_persists():
    c = conn()
    p = Pacer(c)
    p.check_start(WED_10)  # fine before anything happens
    halt(c, 'checkpoint challenge')
    # A NEW Pacer is the next run: the halt has to outlive the process.
    p2 = Pacer(c)
    try:
        p2.check_start(WED_10)
        check('halt stops a later run', False, 'check_start returned')
    except Halted as e:
        check('halt stops a later run', 'checkpoint challenge' in str(e))
        check('halt says how to clear it', '--clear-halt' in str(e), str(e))
    halt(c, 'something else later')
    check('halt keeps the FIRST reason', 'checkpoint' in (halted(c) or ('', ''))[1], halted(c))
    check('clear_halt removes it', clear_halt(c) == 1 and halted(c) is None)
    Pacer(c).check_start(WED_10)  # no raise
    check('a cleared halt lets a run start', True)


def test_halt_beats_the_window():
    c = conn()
    halt(c, 'rate limited')
    try:
        Pacer(c).check_start(WED_03)  # outside hours AND halted
        check('halt is reported ahead of the window', False)
    except Halted:
        check('halt is reported ahead of the window', True)
    except CapReached:
        check('halt is reported ahead of the window', False,
              'reported as out-of-hours, so clearing the clock would hide a halt')


def test_daily_cap_survives_the_process():
    c = conn()
    clock = lambda: WED_10  # noqa: E731 — one fixed clock for log and gates alike
    p = Pacer(c, daily_cap=5, clock=clock)
    for _ in range(5):
        p.log('get_person_profile', 'profile', 'ok')
    check('the cap counts what was logged', read_today(c, WED_10) == 5)
    # The old per-run cap reset here. This is the regression that matters.
    p2 = Pacer(c, daily_cap=5, clock=clock)
    try:
        p2.check_start(WED_10)
        check('a second run in the same day is refused', False, 'check_start returned')
    except CapReached as e:
        check('a second run in the same day is refused', 'daily cap' in str(e))
    check('remaining_today is 0, not negative', p2.remaining_today() == 0)


def test_cap_counts_profiles_only():
    c = conn()
    p = Pacer(c, daily_cap=3, clock=lambda: WED_10)
    p.log('get_company_employees', 'list', 'ok')
    p.log('get_company_employees', 'list', 'ok')
    check('an employee-list call is logged', c.execute('SELECT COUNT(*) FROM pace_log').fetchone()[0] == 2)
    check('...but does not spend the profile budget', p.remaining_today() == 3)
    p.log('get_person_profile', 'profile', 'stop')
    check('a refused read does not spend it either', p.remaining_today() == 3)
    p.log('get_person_profile', 'profile', 'ok')
    check('a read does', p.remaining_today() == 2)


def test_the_cap_follows_the_clock_over_midnight():
    # Both the log and the gate must answer "which day" the same way, or a run
    # spanning midnight either resets its budget or refuses with one left.
    c = conn()
    day1, day2 = dt.datetime(2026, 10, 7, 23, 59), dt.datetime(2026, 10, 8, 10, 0)
    now = [day1]
    p = Pacer(c, daily_cap=2, clock=lambda: now[0])
    p.log('get_person_profile', 'profile', 'ok')
    p.log('get_person_profile', 'profile', 'ok')
    check('the cap is spent on day one', p.remaining_today() == 0)
    now[0] = day2
    check('a new day restores the budget', p.remaining_today() == 2)
    Pacer(c, daily_cap=2, clock=lambda: day2).check_start()
    check('...and a run may start on it', True)


def test_window():
    check('a weekday mid-morning is inside', in_window(WED_10))
    check('03:00 is outside', not in_window(WED_03))
    check('the end hour is exclusive', not in_window(WED_20))
    check('a weekend is outside by default', not in_window(SAT_10))
    check('...and inside when opted in', in_window(SAT_10, weekends=True))
    c = conn()
    try:
        Pacer(c).check_start(WED_03)
        check('check_start refuses out of hours', False)
    except CapReached as e:
        check('check_start refuses out of hours', 'window' in str(e))


def test_window_is_rechecked_mid_run():
    # A run that starts at 19:50 must not read its way into the night.
    c = conn()
    p = Pacer(c)
    p.check_start(dt.datetime(2026, 10, 7, 19, 50))
    try:
        p.check_continue(dt.datetime(2026, 10, 7, 20, 1))
        check('the window is re-checked before each read', False, 'check_continue returned')
    except CapReached as e:
        check('the window is re-checked before each read', 'closed' in str(e))


def test_gap_is_jittered_and_bounded():
    c = conn()
    p = Pacer(c, min_gap=45, max_gap=90, break_every=0, rng=random.Random(7))
    gaps = []
    for _ in range(40):
        g, why = p.next_gap()
        gaps.append(g)
        check_bounds = 45 <= g <= 90
        if not check_bounds:
            break
        p.log('get_person_profile', 'profile', 'ok')
    check('every gap is inside the bounds', all(45 <= g <= 90 for g in gaps), min(gaps), )
    check('the gaps are not a fixed interval', len(set(round(g, 3) for g in gaps)) > 30,
          f'{len(set(round(g, 3) for g in gaps))} distinct values in 40')
    check('the first read of a run waits too', gaps[0] >= 45)


def test_breaks():
    c = conn()
    p = Pacer(c, min_gap=45, max_gap=90, break_every=5, break_min=300, break_max=720,
              rng=random.Random(3))
    kinds = []
    for _ in range(12):
        _, why = p.next_gap()
        kinds.append(why)
        p.log('get_person_profile', 'profile', 'ok')
    # Breaks fall after the 5th and 10th read, i.e. before reads 6 and 11.
    check('a longer break follows every Nth profile',
          [i for i, k in enumerate(kinds) if k == 'break'] == [5, 10], kinds)


def test_log_reports():
    c = conn()
    p = Pacer(c)
    p.log('get_person_profile', 'profile', 'ok')
    p.log('get_person_profile', 'profile', 'error', 'timeout')
    out = format_log(c)
    check('the audit log reports the day', dt.date.today().isoformat() in out, out)
    halt(c, 'captcha')
    check('the audit log shows a halt', 'HALTED' in format_log(c))
    check('the log stores no profile identifier',
          all('person' not in (r[0] or '').lower() or r[0] == 'get_person_profile'
              for r in c.execute('SELECT note FROM pace_log')))


def test_the_collector_actually_halts_on_pushback():
    """The wiring, not the pacer: a push-back reaching LinkedIn.call must write
    the halt there and then. The pacer being correct is worth nothing if the
    collector never tells it anything."""
    import asyncio
    import importlib.util
    import types
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'collect-talent-flows.py')
    spec = importlib.util.spec_from_file_location('ctf_under_test', path)
    mod = importlib.util.module_from_spec(spec)
    argv = sys.argv
    sys.argv = ['collect-talent-flows.py']  # it reads sys.argv[1:] at import
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = argv

    class Res:
        def __init__(self, text):
            self.is_error = True
            self.content = [types.SimpleNamespace(text=text)]
            self.structured_content = None

    class Sess:
        def __init__(self, text):
            self.text = text

        async def call_tool(self, tool, args):
            return Res(self.text)

    async def one(text):
        c = conn()
        p = Pacer(c, min_gap=0, max_gap=0, break_every=0, clock=lambda: WED_10)
        li = mod.LinkedIn(Sess(text), p)
        raised = None
        try:
            await li.call('get_person_profile', {}, 'profile')
        except Exception as e:  # noqa: BLE001
            raised = e
        return c, raised

    c, raised = asyncio.run(one('Rate limit exceeded, please try again later'))
    check('push-back raises Stop', isinstance(raised, mod.Stop), type(raised).__name__)
    check('push-back writes the halt', halted(c) is not None)
    check('push-back is logged as a stop',
          c.execute("SELECT COUNT(*) FROM pace_log WHERE outcome = 'stop'").fetchone()[0] == 1)
    check('a refused read does not spend the budget', read_today(c, WED_10) == 0)

    # A timeout is not LinkedIn objecting. Halting on it would mean one flaky
    # minute stops collecting until someone notices.
    c2, raised2 = asyncio.run(one('upstream request timed out'))
    check('a plain error does not raise Stop', not isinstance(raised2, mod.Stop),
          type(raised2).__name__)
    check('a plain error does not halt', halted(c2) is None)
    check('a plain error is still logged',
          c2.execute("SELECT COUNT(*) FROM pace_log WHERE outcome = 'error'").fetchone()[0] == 1)


for t in [test_halt_persists, test_halt_beats_the_window, test_daily_cap_survives_the_process,
          test_cap_counts_profiles_only, test_window, test_window_is_rechecked_mid_run,
          test_gap_is_jittered_and_bounded, test_breaks, test_log_reports,
          test_the_collector_actually_halts_on_pushback]:
    print(f'\n{t.__name__}:')
    t()

if failures:
    print(f'\n{failures} failure(s)')
    sys.exit(1)
print('\nall pacing checks passed')
