#!/usr/bin/env python3
"""
Proxy-pool helper for the browser scrapers (Indeed / Zhaopin).

Loads a proxy list (a local file or a URL — e.g. the iplocate/free-proxy-list
all-proxies.txt), liveness-filters it against the target site, and hands the
scraper a working proxy, rotating to the next one when the current proxy gets
blocked. Playwright takes the proxy at browser-launch, so "rotating" means
relaunching the browser with the next candidate — the driver does that on a run
of consecutive blocks.

Note on free lists: public/free proxies are mostly datacenter IPs that DataDome
(Indeed) and Zhaopin's anti-bot already blocklist, and many are dead/slow — so
expect a low hit rate. The same mechanism works with a paid RESIDENTIAL list
(one entry like http://user:pass@gw.provider.com:port), which is what actually
gets through; just point --proxy-list at that.

Line formats accepted (one per line, '#' comments ignored):
    http://1.2.3.4:8080
    https://1.2.3.4:8080
    socks5://1.2.3.4:1080
    1.2.3.4:8080            (assumed http)
    http://user:pass@host:port
"""
from __future__ import annotations
import random
import sys
import time
import urllib.request

_LINE = None  # lazily-imported re
import re

_PROXY_RE = re.compile(
    r'^\s*(?:(?P<scheme>https?|socks[45]h?)://)?'
    r'(?P<auth>[^@/\s]+@)?'
    r'(?P<host>[A-Za-z0-9.\-]+):(?P<port>\d{2,5})\s*$'
)


def load_proxies(src: str) -> list[str]:
    """Read proxies from a URL or a local file → list of full proxy URLs."""
    if src.startswith('http://') or src.startswith('https://'):
        req = urllib.request.Request(src, headers={'User-Agent': 'employsi-proxy-pool/1.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode('utf-8', 'replace')
    else:
        with open(src, encoding='utf-8', errors='replace') as f:
            text = f.read()
    out, seen = [], set()
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        m = _PROXY_RE.match(line)
        if not m:
            continue
        scheme = (m.group('scheme') or 'http').lower()
        url = f"{scheme}://{m.group('auth') or ''}{m.group('host')}:{m.group('port')}"
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def _http_reachable(proxy: str, test_url: str, timeout: float) -> bool:
    """True if `test_url` returns a non-blocked HTTP status via `proxy`.

    Only http/https proxies can be tested with urllib; socks5 is left for the
    browser to try (returns True optimistically so it stays in the pool)."""
    if proxy.startswith('socks'):
        return True  # can't pre-test without PySocks; let the browser attempt it
    try:
        handler = urllib.request.ProxyHandler({'http': proxy, 'https': proxy})
        opener = urllib.request.build_opener(handler)
        opener.addheaders = [('User-Agent',
                              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                              'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36')]
        with opener.open(test_url, timeout=timeout) as r:
            # 2xx/3xx = usable; 403/429 = blocked/challenged; others = flaky.
            return 200 <= getattr(r, 'status', r.getcode()) < 400
    except urllib.error.HTTPError as e:
        return 200 <= e.code < 400
    except Exception:
        return False


class ProxyRotator:
    """Serves working proxies from a pool, testing on demand and remembering
    dead ones so it never retries them within a run."""

    # Playwright accepts only these proxy schemes (socks4 is unsupported, and
    # socks5 with auth is unsupported — the free list's socks5 are auth-less).
    SUPPORTED = ('http', 'https', 'socks5')

    def __init__(self, proxies: list[str], test_url: str, timeout: float = 8.0, shuffle: bool = True):
        self.pool = [p for p in proxies if p.split('://', 1)[0] in self.SUPPORTED]
        if shuffle:
            random.shuffle(self.pool)
        self.test_url = test_url
        self.timeout = timeout
        self.i = 0
        self.dead: set[str] = set()
        self.tested = 0

    def next_working(self, max_tries: int = 200) -> str | None:
        """Return the next proxy that reaches the target, or None if exhausted."""
        tries = 0
        while self.i < len(self.pool) and tries < max_tries:
            proxy = self.pool[self.i]
            self.i += 1
            tries += 1
            if proxy in self.dead:
                continue
            self.tested += 1
            if _http_reachable(proxy, self.test_url, self.timeout):
                sys.stderr.write(f'  proxy OK: {proxy}  (tested {self.tested})\n')
                return proxy
            self.dead.add(proxy)
        return None


def rotator_from(src: str, test_url: str, **kw) -> ProxyRotator:
    proxies = load_proxies(src)
    sys.stderr.write(f'  loaded {len(proxies)} proxies from {src[:60]}\n')
    return ProxyRotator(proxies, test_url, **kw)


def open_resilient(open_fn, rotator, proxy, max_launch_tries: int = 8):
    """Open a browser session via open_fn(proxy), rotating past proxies that
    fail to launch (dead/unsupported). Returns (proxy, session, page); falls back
    to a direct (proxy=None) session when the pool can't launch. open_fn must
    accept a proxy string or None and return (session_or_context, page)."""
    tries = 0
    while proxy is not None and tries < max_launch_tries:
        try:
            session, page = open_fn(proxy)
            return proxy, session, page
        except Exception as e:
            sys.stderr.write(f'  launch failed on {proxy}: {str(e)[:70]}\n')
            tries += 1
            proxy = rotator.next_working() if rotator else None
    session, page = open_fn(None)  # direct
    return None, session, page


if __name__ == '__main__':
    # quick self-check: python3 scripts/proxy_pool.py <list> [test_url]
    src = sys.argv[1] if len(sys.argv) > 1 else 'https://raw.githubusercontent.com/iplocate/free-proxy-list/main/all-proxies.txt'
    test_url = sys.argv[2] if len(sys.argv) > 2 else 'https://httpbin.org/ip'
    rot = rotator_from(src, test_url, timeout=6.0)
    t0 = time.time()
    p = rot.next_working(max_tries=50)
    sys.stderr.write(f'first working: {p} (in {time.time()-t0:.0f}s, {rot.tested} tested)\n')
