#!/usr/bin/env python3
"""Checks for scripts/collector_proxy.py.

The proxy checks guard three failures that all look like success until
LinkedIn decides otherwise: a rotating endpoint (every page from a new
address), a geo-mismatch (an AU account signing in from the US), and an exit
address that moved between runs. None of them raises an error on its own; the
collector would simply carry on and collect its way into a checkpoint.

The exit address is read through a stubbed opener, so nothing here touches a
proxy or the network.

Run: python scripts/test_collector_proxy.py
"""
from __future__ import annotations

import io
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collector_proxy as cp  # noqa: E402

failures = 0


def check(name, cond, detail=''):
    global failures
    if cond:
        print(f'  ok  {name}')
    else:
        failures += 1
        print(f'FAIL  {name}{" — " + str(detail) if detail else ""}')


class FakeOpener:
    """Answers each probe with the next address in `ips`, cycling."""

    def __init__(self, ips, country='au'):
        self.ips, self.country, self.n = list(ips), country, 0

    def open(self, url, timeout=None):
        ip = self.ips[self.n % len(self.ips)]
        self.n += 1
        body = {'ip': ip}
        if self.country:
            body['country'] = self.country.upper()
        return io.BytesIO(json.dumps(body).encode())


def with_opener(ips, country='au'):
    cp._opener = lambda: FakeOpener(ips, country)  # noqa: SLF001


def conn():
    c = sqlite3.connect(':memory:')
    cp.install(c)
    return c


def test_describe_hides_credentials():
    os.environ[cp.PROXY_SERVER] = 'http://user:sup3rsecret@geo.example.net:12321'
    d = cp.describe()
    check('describe() keeps the endpoint', 'geo.example.net:12321' in d, d)
    check('describe() drops the password', 'sup3rsecret' not in d, d)
    check('describe() drops the username', 'user' not in d.replace('http://', ''), d)
    os.environ[cp.PROXY_SERVER] = ''
    check('no proxy reads as none', cp.describe() == 'none' and not cp.configured())


def test_rotation_is_refused():
    with_opener(['203.0.113.7', '203.0.113.9', '203.0.113.7'])
    try:
        cp.preflight(probes=3)
        check('a rotating endpoint is refused', False, 'preflight returned')
    except cp.ProxyProblem as e:
        check('a rotating endpoint is refused', 'rotation' in str(e).lower(), str(e)[:80])
        check('...and the message says what to use instead', 'sticky' in str(e).lower())


def test_a_sticky_session_passes():
    with_opener(['203.0.113.7'])
    ip, country = cp.preflight(probes=3)
    check('one stable address passes', ip == '203.0.113.7' and country == 'au')


def test_country_mismatch_is_refused():
    with_opener(['198.51.100.4'], country='us')
    try:
        cp.preflight(expect_country='au', probes=2)
        check('the wrong country is refused', False, 'preflight returned')
    except cp.ProxyProblem as e:
        check('the wrong country is refused', 'US' in str(e) and 'AU' in str(e), str(e)[:90])
    with_opener(['203.0.113.7'], country='au')
    cp.preflight(expect_country='AU', probes=2)
    check('the right country passes, case-insensitively', True)


def test_country_unknown_is_not_silently_passed():
    # An echo service that reports no country must not read as a match: the
    # check would then be a no-op nobody noticed.
    with_opener(['203.0.113.7'], country=None)
    ip, country = cp.preflight(expect_country='au', probes=1)
    check('an unknown country does not fail the run', ip == '203.0.113.7')
    check('...and is reported as unverified rather than matched', country is None)


def test_the_address_is_pinned_and_a_move_halts():
    c = conn()
    msg = cp.check_stable(c, '203.0.113.7', 'au')
    check('the first run pins the address', 'pinned' in msg and cp.pinned(c)[0] == '203.0.113.7')
    msg = cp.check_stable(c, '203.0.113.7', 'au')
    check('the same address passes', 'matches' in msg, msg)
    try:
        cp.check_stable(c, '203.0.113.99', 'au')
        check('a MOVED address halts', False, 'check_stable returned')
    except cp.ProxyProblem as e:
        check('a MOVED address halts', 'MOVED' in str(e), str(e)[:80])
        check('...and says the safe order for a new session',
              '--login' in str(e) and '--pin-proxy' in str(e))


def test_a_dead_proxy_is_not_read_as_rotation():
    class Dead:
        def open(self, url, timeout=None):
            raise OSError('connection refused')
    cp._opener = lambda: Dead()  # noqa: SLF001
    try:
        cp.preflight(probes=3)
        check('an unreachable proxy raises', False, 'preflight returned')
    except cp.ProxyProblem as e:
        check('an unreachable proxy raises', 'did not answer' in str(e), str(e)[:80])
        check('...and points at the password, which fails as a timeout',
              'password' in str(e).lower(), str(e)[:120])


def test_the_collector_gate_refuses():
    """The wiring: collect-talent-flows.py's own gate must call the preflight
    and refuse. The checks being right is worth nothing if the collector signs
    in before running them."""
    import importlib.util
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'collect-talent-flows.py')
    spec = importlib.util.spec_from_file_location('ctf_proxy_under_test', path)
    mod = importlib.util.module_from_spec(spec)
    argv = sys.argv
    sys.argv = ['collect-talent-flows.py']
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = argv

    os.environ[cp.PROXY_SERVER] = 'http://geo.example.net:12321'
    c = conn()
    with_opener(['203.0.113.7'])
    check('a stable proxy passes the gate', mod.proxy_gate(c) == 0)
    check('...and the gate pinned it', cp.pinned(c)[0] == '203.0.113.7')

    with_opener(['203.0.113.99'])  # the address moved between runs
    check('a moved address fails the gate', mod.proxy_gate(c) == 3)

    with_opener(['203.0.113.7', '203.0.113.8'])  # rotating
    c2 = conn()
    check('a rotating proxy fails the gate', mod.proxy_gate(c2) == 3)
    check('...and nothing was pinned', cp.pinned(c2) is None)

    os.environ[cp.PROXY_SERVER] = ''
    check('no proxy is a pass, not a failure', mod.proxy_gate(conn()) == 0)


for t in [test_describe_hides_credentials, test_rotation_is_refused,
          test_a_sticky_session_passes, test_country_mismatch_is_refused,
          test_country_unknown_is_not_silently_passed,
          test_the_address_is_pinned_and_a_move_halts,
          test_a_dead_proxy_is_not_read_as_rotation,
          test_the_collector_gate_refuses]:
    print(f'\n{t.__name__}:')
    t()

if failures:
    print(f'\n{failures} failure(s)')
    sys.exit(1)
print('\nall proxy checks passed')
