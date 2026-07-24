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


def fetch(url: str, geo: str | None = None, render: bool = True,
          source: str = 'universal', user_agent_type: str = 'desktop',
          timeout: int = 240, retries: int = 3):
    """Fetch `url` through Oxylabs. Returns (content, status_code) or (None, None).

    `content` is the fully-rendered page (HTML) when render=True, or the raw body
    otherwise. `geo` is an Oxylabs geo_location string (e.g. "Australia", "China")."""
    payload: dict = {'source': source, 'url': url, 'user_agent_type': user_agent_type}
    if render:
        payload['render'] = 'html'
    if geo:
        payload['geo_location'] = geo
    body = json.dumps(payload).encode()
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(ENDPOINT, data=body, headers={
                'Authorization': _auth_header(), 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                j = json.loads(r.read().decode('utf-8', 'replace'))
            res = (j.get('results') or [{}])[0]
            return res.get('content'), res.get('status_code')
        except urllib.error.HTTPError as e:
            last = f'HTTP {e.code}: {e.read().decode("utf-8", "replace")[:160]}'
        except Exception as e:  # noqa: BLE001
            last = str(e)[:160]
        if attempt < retries - 1:
            time.sleep(3 * (attempt + 1))
    sys.stderr.write(f'  oxylabs fetch failed for {url[:70]}: {last}\n')
    return None, None


if __name__ == '__main__':
    # quick check: python3 scripts/oxylabs_client.py <url> [geo]
    u = sys.argv[1] if len(sys.argv) > 1 else 'https://ip.oxylabs.io/location'
    g = sys.argv[2] if len(sys.argv) > 2 else None
    content, code = fetch(u, geo=g)
    sys.stderr.write(f'status={code} len={len(content or "")}\n')
    print((content or '')[:500])
