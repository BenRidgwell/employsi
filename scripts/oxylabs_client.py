#!/usr/bin/env python3
"""
Oxylabs Web Scraper API client — the no-browser, no-proxy way to fetch pages
that block datacenter IPs or need JavaScript (Indeed's DataDome, Zhaopin's
anti-bot). Oxylabs handles the residential IP, fingerprinting, CAPTCHA and JS
rendering server-side and returns the finished HTML/JSON, so our scrapers become
plain HTTP calls (they can run anywhere — GitHub Actions, a Worker, your PC).

Realtime (synchronous) endpoint: POST https://realtime.oxylabs.io/v1/queries with
HTTP Basic auth, JSON body {source, url, render, geo_location, ...}; the response
is {"results":[{"content": "<rendered html/json>", "status_code": 200}]}.

Env: OXYLABS_USERNAME, OXYLABS_PASSWORD  (Web Scraper API sub-user credentials).
"""
from __future__ import annotations
import base64
import json
import os
import random
import sys
import time
import urllib.request

ENDPOINT = 'https://realtime.oxylabs.io/v1/queries'


def _auth_header() -> str:
    u = os.environ.get('OXYLABS_USERNAME')
    p = os.environ.get('OXYLABS_PASSWORD')
    if not u or not p:
        sys.exit('Set OXYLABS_USERNAME and OXYLABS_PASSWORD (Oxylabs Web Scraper API credentials).')
    return 'Basic ' + base64.b64encode(f'{u}:{p}'.encode()).decode()


# ── polite-scraping controls ─────────────────────────────────────────────────
# Every scraper in this repo funnels its page fetches through fetch() below, so
# the throttle + backoff policy lives here once rather than being re-implemented
# (inconsistently) per script.
#
#  • MIN_INTERVAL paces successive requests from this process, with jitter, so we
#    never hammer a target at full loop speed even when responses are fast.
#  • 429 / 503 are treated as explicit "slow down" signals: we honour Retry-After
#    when the server sends it, else back off exponentially.
#  • Backoff is exponential WITH jitter (not the old linear 3s/6s/9s), which is
#    what avoids synchronised retry storms when several jobs run at once.
# Tunable per-process via env so a heavy multi-company driver (Indeed/LinkedIn)
# can pace itself differently from a single-board walk.
MIN_INTERVAL = float(os.environ.get('OXY_MIN_INTERVAL', '1.0'))   # seconds between calls
JITTER = float(os.environ.get('OXY_JITTER', '0.6'))               # extra random 0..JITTER
MAX_BACKOFF = float(os.environ.get('OXY_MAX_BACKOFF', '60'))
# Statuses worth another attempt.
#
# 429 and the 5xx family are the target rate-limiting or wobbling. 612 and 613
# are OXYLABS' OWN fault codes — 613 is "faulted", meaning its worker could not
# complete the fetch — and they are just as transient, but they were missing
# here. That gap took the NSW government scraper down for a whole day: one 613
# on page 1 and the run exited 2 with the board perfectly healthy, which a
# retry moments later confirmed (the same URL returned 200 with 1.1MB). Naukri
# and GulfTalent hit the same code earlier for the same reason.
RETRY_STATUSES = {429, 500, 502, 503, 504, 522, 524, 612, 613}

_last_call = 0.0


def _throttle() -> None:
    """Space out successive requests (min interval + jitter)."""
    global _last_call
    now = time.monotonic()
    wait = (_last_call + MIN_INTERVAL) - now
    if wait > 0:
        time.sleep(wait)
    if JITTER > 0:
        time.sleep(random.uniform(0, JITTER))
    _last_call = time.monotonic()


def _backoff(attempt: int, retry_after: float | None = None) -> float:
    """Exponential backoff with full jitter, honouring Retry-After when given."""
    if retry_after is not None:
        return min(retry_after, MAX_BACKOFF)
    return min(MAX_BACKOFF, random.uniform(0, (2 ** attempt) * 3.0))


def _retry_after_seconds(e) -> float | None:
    try:
        v = e.headers.get('Retry-After') if getattr(e, 'headers', None) else None
        return float(v) if v and str(v).strip().isdigit() else None
    except Exception:  # noqa: BLE001
        return None


def fetch(url: str, geo: str | None = None, render: bool = True,
          source: str = 'universal', user_agent_type: str = 'desktop',
          timeout: int = 240, retries: int = 4, extra: dict | None = None):
    """Fetch `url` through Oxylabs. Returns (content, status_code) or (None, None).

    `content` is the fully-rendered page (HTML) when render=True, or the raw body
    otherwise. `geo` is an Oxylabs geo_location string (e.g. "Australia", "China").

    `extra` is merged into the request payload for options only one caller needs
    — chiefly `browser_instructions`, which is what gets past an interstitial
    that resolves itself a second or two after load. NAB's careers site sits
    behind an AWS WAF like that: rendering alone returns the challenge page,
    rendering plus a wait returns the jobs.

    Requests are throttled and retried politely — see the controls above. A
    target-side 429/5xx (reported by Oxylabs in the result's status_code) is
    retried with backoff rather than being surfaced as a hard failure."""
    payload: dict = {'source': source, 'url': url, 'user_agent_type': user_agent_type}
    if render:
        payload['render'] = 'html'
    if geo:
        payload['geo_location'] = geo
    if extra:
        payload.update(extra)
    body = json.dumps(payload).encode()
    last = None
    for attempt in range(retries):
        _throttle()
        try:
            req = urllib.request.Request(ENDPOINT, data=body, headers={
                'Authorization': _auth_header(), 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                j = json.loads(r.read().decode('utf-8', 'replace'))
            res = (j.get('results') or [{}])[0]
            content, status = res.get('content'), res.get('status_code')
            # The TARGET rate-limited us (Oxylabs relays its status): back off.
            if status in RETRY_STATUSES and attempt < retries - 1:
                delay = _backoff(attempt)
                sys.stderr.write(f'  target returned {status}; backing off {delay:.1f}s\n')
                time.sleep(delay)
                last = f'target status {status}'
                continue
            return content, status
        except urllib.error.HTTPError as e:
            last = f'HTTP {e.code}: {e.read().decode("utf-8", "replace")[:160]}'
            if e.code in RETRY_STATUSES and attempt < retries - 1:
                time.sleep(_backoff(attempt, _retry_after_seconds(e)))
                continue
            if e.code in (401, 403):  # bad/expired credentials — retrying won't help
                sys.stderr.write(f'  oxylabs auth failed ({e.code}) — check OXYLABS_USERNAME/PASSWORD\n')
                return None, e.code
        except Exception as e:  # noqa: BLE001
            last = str(e)[:160]
        if attempt < retries - 1:
            time.sleep(_backoff(attempt))
    sys.stderr.write(f'  oxylabs fetch failed for {url[:70]}: {last}\n')
    return None, None


if __name__ == '__main__':
    # quick check: python3 scripts/oxylabs_client.py <url> [geo]
    u = sys.argv[1] if len(sys.argv) > 1 else 'https://ip.oxylabs.io/location'
    g = sys.argv[2] if len(sys.argv) > 2 else None
    content, code = fetch(u, geo=g)
    sys.stderr.write(f'status={code} len={len(content or "")}\n')
    print((content or '')[:500])
