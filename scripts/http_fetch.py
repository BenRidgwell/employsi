#!/usr/bin/env python3
"""
Polite HTTP fetch — the throttle/backoff policy every scraper shares, plus a
plain urllib fetcher that applies it.

WHY THIS EXISTS
The policy used to live inside oxylabs_client.py, which meant it only applied to
requests that went THROUGH Oxylabs. Each scraper's `--direct` path was a bare
`urlopen` with no pacing and no retries — fine for the one-off local debugging it
was written for, but it made "stop using Oxylabs" quietly mean "stop being
polite", which is not a trade worth making. A board that answers a datacentre IP
happily at one request a second will still rate-limit six concurrent ones, and
jobsdb walks the roster six-wide.

So the policy lives here, oxylabs_client imports it, and the direct paths call
`get()`. Both transports then share ONE clock: a process mixing direct and
proxied calls is spaced as a single stream rather than two independent ones.

  * MIN_INTERVAL spaces successive requests from this process, with jitter, so a
    fast target is not hammered at full loop speed.
  * 429 / 5xx are explicit "slow down" signals: Retry-After is honoured when
    sent, else the backoff is exponential WITH jitter, which is what avoids
    synchronised retry storms when several threads or jobs run at once.

Env (names unchanged, so anything already setting them keeps working):
    OXY_MIN_INTERVAL, OXY_JITTER, OXY_MAX_BACKOFF
"""
from __future__ import annotations
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request

MIN_INTERVAL = float(os.environ.get('OXY_MIN_INTERVAL', '1.0'))   # seconds between calls
JITTER = float(os.environ.get('OXY_JITTER', '0.6'))               # extra random 0..JITTER
MAX_BACKOFF = float(os.environ.get('OXY_MAX_BACKOFF', '60'))

# Statuses worth another attempt: the target rate-limiting or wobbling.
# oxylabs_client adds its provider-specific codes (612/613) to this set.
RETRY_STATUSES = {429, 500, 502, 503, 504, 522, 524}

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')

_last_call = 0.0
# Serialises the spacing calculation, because callers may be threads (jobsdb and
# the Wayback backfill both fetch concurrently). Without the lock every thread
# reads the same `_last_call`, every thread computes "no wait needed", and they
# all fire at once — the exact opposite of a throttle. The sleep is held INSIDE
# the lock on purpose: that is what makes MIN_INTERVAL a real ceiling on requests
# per second regardless of how many threads are running.
_throttle_lock = threading.Lock()


def throttle() -> None:
    """Space out successive requests (min interval + jitter). Thread-safe."""
    global _last_call
    with _throttle_lock:
        now = time.monotonic()
        wait = (_last_call + MIN_INTERVAL) - now
        if wait > 0:
            time.sleep(wait)
        if JITTER > 0:
            time.sleep(random.uniform(0, JITTER))
        _last_call = time.monotonic()


def backoff(attempt: int, retry_after: float | None = None) -> float:
    """Exponential backoff with full jitter, honouring Retry-After when given."""
    if retry_after is not None:
        return min(retry_after, MAX_BACKOFF)
    return min(MAX_BACKOFF, random.uniform(0, (2 ** attempt) * 3.0))


def retry_after_seconds(e) -> float | None:
    try:
        v = e.headers.get('Retry-After') if getattr(e, 'headers', None) else None
        return float(v) if v and str(v).strip().isdigit() else None
    except Exception:  # noqa: BLE001
        return None


def get(url: str, headers: dict | None = None, timeout: int = 45,
        retries: int = 4, quiet: bool = False) -> tuple[str | None, int | None]:
    """Fetch `url` directly, throttled and retried. Returns (text, status).

    Returns (None, status) when the retries did not clear the failure, so a
    caller can tell "the target said no" from "the body was empty" — a
    distinction that matters here, because several of these boards return an
    empty 200 instead of an error when they are rate-limiting."""
    hdrs = {'User-Agent': UA, **(headers or {})}
    last = None
    for attempt in range(retries):
        throttle()
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode('utf-8', 'replace'), getattr(r, 'status', 200)
        except urllib.error.HTTPError as e:
            last = f'HTTP {e.code}'
            if e.code in RETRY_STATUSES and attempt < retries - 1:
                time.sleep(backoff(attempt, retry_after_seconds(e)))
                continue
            return None, e.code
        except Exception as e:  # noqa: BLE001
            last = str(e)[:160]
            if attempt < retries - 1:
                time.sleep(backoff(attempt))
    if not quiet:
        sys.stderr.write(f'  direct fetch failed for {url[:70]}: {last}\n')
    return None, None
