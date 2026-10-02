#!/usr/bin/env python3
"""Proxy preflight for collect-talent-flows.py (IPRoyal or any provider).

READ THIS BEFORE TURNING A PROXY ON
A proxy does not make a logged-in scrape safer. You are signed in as yourself,
so the account is the identity; the address only ever adds or removes
suspicion. linkedin-mcp-server's own README puts it plainly:

    "LinkedIn scores the address a session signs in from. Your account's usual
     IP address is the safe one."

So if the collector runs on your own machine at home, the right setting is NO
PROXY. Routing your usual session through IPRoyal moves it to an address
LinkedIn has never seen you on, which is the shape of an account takeover and
a good way to be handed the checkpoint the pacing exists to avoid.

A proxy earns its place in one case: the collector is NOT running from your
usual address — a VPS, a spare box, another country — and you want the session
to appear from your own city rather than a datacentre. Then a sticky
residential session in that city is better than the datacentre address, and
worse than simply running it at home.

WHAT THIS MODULE DOES
Three checks, all before the browser ever signs in:

1. ROTATION IS REFUSED, BY MEASUREMENT. A per-request rotating endpoint is the
   single worst configuration here: every page load arrives from a new
   address. The README says "never per-request rotation" and this does not
   take the endpoint's word for it — it probes the exit address several times
   and refuses if it moves. IPRoyal's sticky sessions are selected in the
   USERNAME (a session token with a lifetime), so a plausible-looking host and
   port prove nothing on their own.

2. THE COUNTRY IS CHECKED. An AU account signing in from a US exit is the
   mismatch that triggers a checkpoint fastest. `--proxy-country au` fails the
   run rather than discovering it afterwards.

3. THE ADDRESS IS PINNED. The first successful preflight records the exit IP.
   A later run on a DIFFERENT address halts, because moving an established
   session between addresses is the documented checkpoint trigger — the same
   failure whether it comes from a rotating endpoint, an expired sticky
   session, or someone editing the config. This is the check that matters most
   over time, and the one no provider gives you.

Credentials are read from the environment and never logged: the describe()
output carries host and port only. Chromium cannot authenticate to a SOCKS
proxy, so an authenticated endpoint must be http(s) (README, Troubleshooting).
"""
from __future__ import annotations

import json
import os
import sqlite3
import urllib.request

# Read by linkedin-mcp-server itself; the collector only passes them through.
PROXY_SERVER = 'PROXY_SERVER'
PROXY_USERNAME = 'PROXY_USERNAME'
PROXY_PASSWORD = 'PROXY_PASSWORD'

# Probed to learn the exit address. Two services, so one being down is not
# read as a rotating proxy. Both answer with JSON holding an "ip" field.
ECHO_URLS = ('https://ipinfo.io/json', 'https://api.ipify.org?format=json')
PROBES = 3          # exit-address reads per preflight; all must agree
PROBE_TIMEOUT = 20

SCHEMA = """
-- The exit address this collector established its LinkedIn session on. One
-- row. A later run from a different address is the documented checkpoint
-- trigger, so it halts instead of signing in.
CREATE TABLE IF NOT EXISTS proxy_pin (
  ip      TEXT NOT NULL,
  country TEXT,
  at      TEXT NOT NULL
);
"""


class ProxyProblem(Exception):
    """The proxy is misconfigured, rotating, or has moved. Do not sign in."""


def configured() -> bool:
    return bool(os.environ.get(PROXY_SERVER, '').strip())


def describe() -> str:
    """The endpoint, WITHOUT credentials — this is printed and logged.

    PROXY_SERVER may legitimately carry `user:pass@`, so the userinfo is cut
    rather than assumed absent."""
    raw = os.environ.get(PROXY_SERVER, '').strip()
    if not raw:
        return 'none'
    scheme, _, rest = raw.rpartition('://')
    host = rest.rpartition('@')[2]  # drop any user:pass@
    return f'{scheme}://{host}' if scheme else host


def _opener() -> urllib.request.OpenerDirector:
    """A urllib opener that goes through the configured proxy.

    Credentials ride in the URL because ProxyHandler takes them that way; they
    are assembled here and never printed."""
    raw = os.environ.get(PROXY_SERVER, '').strip()
    if not raw:
        raise ProxyProblem(f'{PROXY_SERVER} is not set')
    scheme, sep, rest = raw.rpartition('://')
    scheme = scheme or 'http'
    if not sep:
        rest = raw
    user = os.environ.get(PROXY_USERNAME, '')
    pw = os.environ.get(PROXY_PASSWORD, '')
    if user and '@' not in rest:
        rest = f'{user}:{pw}@{rest}'
    url = f'{scheme}://{rest}'
    # Both schemes point at the same endpoint: an https target is reached by
    # CONNECT through an http proxy, which is the usual provider setup.
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({'http': url, 'https': url}))


def _echo_once(opener, url: str) -> tuple[str, str | None]:
    with opener.open(url, timeout=PROBE_TIMEOUT) as r:
        data = json.loads(r.read().decode()[:4000])
    ip = str(data.get('ip') or '').strip()
    if not ip:
        raise ProxyProblem(f'{url} returned no ip field')
    return ip, (str(data.get('country')).lower() if data.get('country') else None)


def exit_address(probes: int = PROBES) -> tuple[str, str | None, list[str]]:
    """The exit address, read `probes` times.

    Returns (ip, country, every_ip_seen). The caller decides what a
    disagreement means; this only reports it.
    """
    opener = _opener()
    seen: list[str] = []
    country: str | None = None
    last_err: Exception | None = None
    for i in range(max(1, probes)):
        url = ECHO_URLS[i % len(ECHO_URLS)]
        try:
            ip, c = _echo_once(opener, url)
        except (OSError, ValueError) as e:
            # OSError, not URLError: a refused connection or a socket-level
            # failure arrives as a bare OSError and would otherwise escape as a
            # traceback, losing the message that names the likeliest cause.
            # URLError and socket.timeout are both OSError subclasses, so this
            # is wider, not different. ValueError covers unreadable JSON.
            last_err = e
            continue
        seen.append(ip)
        country = country or c
    if not seen:
        raise ProxyProblem(
            f'the proxy did not answer ({describe()}): {last_err}. '
            'Check the host, port and credentials. A wrong password shows up as '
            'a timeout, not as an auth error.')
    return seen[0], country, seen


def preflight(expect_country: str | None = None, probes: int = PROBES
              ) -> tuple[str, str | None]:
    """Refuse a rotating endpoint or the wrong country. Returns (ip, country)."""
    ip, country, seen = exit_address(probes)
    if len(set(seen)) > 1:
        raise ProxyProblem(
            f'the exit address CHANGES between requests ({", ".join(sorted(set(seen)))}). '
            'That is per-request rotation, which this collector will not use: every '
            'page load would reach LinkedIn from a different address while signed in '
            'as one person. Select a STICKY residential session instead — with '
            'IPRoyal that is a session token in the proxy USERNAME, not a different '
            'host — and give it a lifetime longer than a collecting run.')
    if expect_country and country and country != expect_country.lower():
        raise ProxyProblem(
            f'the proxy exits in {country.upper()}, not {expect_country.upper()}. '
            'An account signing in from a country it has never been seen in is the '
            'fastest way to a checkpoint. Fix the session\'s geo-targeting.')
    if expect_country and not country:
        print(f'  note: the echo service did not report a country; '
              f'{expect_country.upper()} was NOT verified.')
    return ip, country


# ── pinning the address across runs ──────────────────────────────────────────

def install(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def pinned(conn: sqlite3.Connection) -> tuple[str, str | None, str] | None:
    install(conn)
    row = conn.execute('SELECT ip, country, at FROM proxy_pin').fetchone()
    return (row[0], row[1], row[2]) if row else None


def pin(conn: sqlite3.Connection, ip: str, country: str | None) -> None:
    """Record the address the session belongs to. Replaces any previous pin,
    so clearing is just re-pinning after a deliberate change."""
    import datetime as dt
    install(conn)
    conn.execute('DELETE FROM proxy_pin')
    conn.execute('INSERT INTO proxy_pin VALUES (?,?,?)',
                 (ip, country, dt.datetime.now().isoformat(timespec='seconds')))
    conn.commit()


def check_stable(conn: sqlite3.Connection, ip: str, country: str | None) -> str:
    """Compare the current exit address with the pinned one.

    Returns a line to print. Raises ProxyProblem when the address has moved:
    a session established on one address and used from another is the
    documented checkpoint trigger, and it is better to stop here than to find
    out from LinkedIn.
    """
    was = pinned(conn)
    if was is None:
        pin(conn, ip, country)
        return (f'  pinned this session to {ip}'
                f'{" (" + country.upper() + ")" if country else ""}. '
                'A later run from a different address will halt.')
    if was[0] == ip:
        return f'  exit address {ip} matches the pin from {was[2]}.'
    raise ProxyProblem(
        f'the exit address has MOVED: pinned {was[0]} on {was[2]}, now {ip}.\n'
        'A LinkedIn session used from a new address is the documented trigger for '
        'a checkpoint, so nothing was requested.\n'
        'If the sticky session simply expired, the safe order is: start a new '
        'sticky session, sign in again from it (uvx mcp-server-linkedin --login), '
        'then re-pin with --pin-proxy. Do not sign in on one address and collect '
        'from another.')
