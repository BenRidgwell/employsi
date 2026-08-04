#!/usr/bin/env python3
"""
Render a page with a local headless Chromium, executing the SAME instruction
vocabulary Oxylabs' `browser_instructions` uses.

WHY THIS SHAPE
Five scrapers went through Oxylabs purely for `render=True` — they need a
browser, not a residential IP. Measured on an ordinary GitHub runner
(.github/workflows/probe-headless-ci.yml, 2026-08-04): Stockland 10 rows, Dyno
Nobel 10, Sandfire 6, Whitehaven 25 (and its page-2 click), APS 15. Naukri and
Zhaopin were probed the same way and do NOT belong here — Naukri answers a
headless CI browser with an Akamai 403 and Zhaopin with a 200 challenge page —
so they stay on the proxy.

Each of those five already described what the browser should do as a list of
dicts. Keeping that vocabulary and swapping only the executor makes the port a
one-line change per scraper and leaves the instruction lists — the part that
encodes what each board actually needs — untouched and reviewable. It also means
`--oxylabs` can hand the identical list back to the proxy on a bad day.

Supported instructions, matching what those scrapers emit:

    {'type': 'wait',  'wait_time_s': 8}
    {'type': 'click', 'selector': {'type': 'css',   'value': '.ant-pagination-item-2 a'}}
    {'type': 'click', 'selector': {'type': 'xpath', 'value': "(//a[@title='Next Page'])[1]"}}

An unknown instruction is a hard error rather than a skip: silently ignoring a
step would produce page 1 while the caller believed it had page 4, and the rows
would look real.

ONE BROWSER PER PROCESS. Chromium takes seconds to start and these scrapers
render several pages each; the browser is created on first use and closed at
exit. Each render still gets a FRESH CONTEXT and re-navigates from the listing
URL, exactly as the Oxylabs call did — a port is not the place to switch to
keeping one page alive and clicking forward, because every one of these parsers
assumes a full render of the page it is looking at.

Run: pip install playwright && playwright install chromium
"""
from __future__ import annotations
import atexit
import os
import sys

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')

# Headful is occasionally the only way to see why a board stopped rendering.
HEADFUL = os.environ.get('BROWSER_FETCH_HEADFUL') == '1'

# Use a Chromium that is already on the machine instead of the one Playwright
# would download. CI runs `playwright install chromium` and needs neither, but a
# prepared image often ships a browser whose build number does not match the pip
# package's expectation — and Playwright's response to that mismatch is to refuse
# to launch, which reads as "the scraper is broken" rather than "the binary is
# one release old". Pointing at the existing binary is the documented way out.
EXECUTABLE = os.environ.get('BROWSER_FETCH_EXECUTABLE') or None

_pw = None
_browser = None


def _browser_once():
    global _pw, _browser
    if _browser is not None:
        return _browser
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit('playwright is required: pip install playwright '
                 '&& python -m playwright install chromium\n'
                 '(or pass --oxylabs to use the Web Scraper API instead)')
    _pw = sync_playwright().start()
    launch: dict = {'headless': not HEADFUL}
    if EXECUTABLE:
        launch['executable_path'] = EXECUTABLE
    _browser = _pw.chromium.launch(**launch)
    atexit.register(_close)
    return _browser


def _close() -> None:
    global _pw, _browser
    try:
        if _browser is not None:
            _browser.close()
        if _pw is not None:
            _pw.stop()
    except Exception:  # noqa: BLE001
        pass
    _browser = _pw = None


def _locator(page, selector: dict):
    kind = (selector or {}).get('type')
    value = (selector or {}).get('value', '')
    if kind == 'xpath':
        return page.locator(f'xpath={value}')
    if kind == 'css':
        return page.locator(value)
    raise ValueError(f'browser_fetch: unsupported selector type {kind!r}')


def render(url: str, instructions: list[dict] | None = None,
           locale: str = 'en-AU', timeout_s: int = 90) -> str | None:
    """Load `url`, run `instructions`, return the rendered HTML (or None).

    Returns None on any failure rather than a partial page: these scrapers treat
    an empty pull as "leave yesterday's rows alone", and half a render would be
    written as if it were the whole board."""
    browser = _browser_once()
    ctx = None
    try:
        ctx = browser.new_context(user_agent=UA, locale=locale,
                                  viewport={'width': 1440, 'height': 900})
        page = ctx.new_page()
        page.goto(url, wait_until='domcontentloaded', timeout=timeout_s * 1000)
        for ins in (instructions or []):
            kind = ins.get('type')
            if kind == 'wait':
                page.wait_for_timeout(float(ins.get('wait_time_s', 1)) * 1000)
            elif kind == 'click':
                # .first, because these boards render the same control more than
                # once (a top and a bottom pager). Oxylabs' xpath instructions
                # already say "(...)[1]" for that reason; making it explicit here
                # keeps a css selector from raising strict-mode violations.
                _locator(page, ins.get('selector', {})).first.click(
                    timeout=timeout_s * 1000)
            else:
                raise ValueError(f'browser_fetch: unsupported instruction {kind!r}')
        return page.content()
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  browser render failed for {url[:70]}: {str(e)[:160]}\n')
        return None
    finally:
        if ctx is not None:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == '__main__':
    # quick check: python3 scripts/browser_fetch.py <url> [settle_s]
    u = sys.argv[1] if len(sys.argv) > 1 else 'https://example.com'
    settle = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    html = render(u, [{'type': 'wait', 'wait_time_s': settle}])
    sys.stderr.write(f'len={len(html or "")}\n')
    print((html or '')[:600])
