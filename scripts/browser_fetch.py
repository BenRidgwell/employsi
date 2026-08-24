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
import re as _re
import sys

# Consulted ONLY to label a non-2xx in text(). A fully rendered board mentions
# "captcha" in its own JavaScript often enough that treating these as an
# independent signal would report blocks that are not there — so they never
# decide anything, they only put a name on a status the server already gave us.
BLOCK_MARKERS = [
    (r'Just a moment', 'Cloudflare interstitial'),
    (r'Access Denied', 'Akamai deny'),
    (r'Pardon Our Interruption', 'DataDome'),
    (r'Request unsuccessful|Incapsula', 'Imperva'),
    (r'Vercel Security Checkpoint', 'Vercel checkpoint'),
    (r'captcha|challenge-platform', 'captcha / challenge'),
]

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

# ── fingerprint ──────────────────────────────────────────────────────────────
# WHY THIS EXISTS, in one measurement taken 2026-08-09 from a GitHub runner:
#
#     plain urllib through IPRoyal   1 of 12 boards answered
#     Chromium through IPRoyal       11 of 20 rows found
#
# Same exit addresses, same targets. That ~10x gap is not the address — it is
# the CLIENT. urllib's TLS handshake, its HTTP/2 settings and its header order
# say "script"; Chromium's say "Chrome". Which means the remaining refusals
# (Naukri and GulfTalent on Akamai, Zhaopin on a captcha) may be a harder
# version of the same gap rather than a different problem, and the cheapest
# thing to try before renting a fingerprint from anyone is to stop advertising
# that this one is automated.
#
# THREE THINGS GIVE US AWAY, in descending order of how loudly:
#
#   1. THE BINARY. `chromium.launch(headless=True)` resolves to
#      chromium-headless-shell — a stripped build, not Chrome. The CI logs say
#      so out loud ("Chrome Headless Shell 151.0.7922.34"). It is missing
#      proprietary codecs, has different WebGL vendor strings and no
#      chrome.runtime, and it is the single most fingerprintable browser in
#      common use. BROWSER_FETCH_CHANNEL=chrome launches real Chrome instead.
#   2. HEADLESSNESS ITSELF, which is detectable independently of the binary.
#      Running headful under Xvfb costs one apt package and removes the flag.
#   3. AUTOMATION ARTEFACTS in the page: navigator.webdriver, an empty plugin
#      list, a missing window.chrome, a SwiftShader WebGL renderer. STEALTH_JS
#      below patches the ones that are patchable from script.
#
# All three are OFF BY DEFAULT and switched on by environment, so the feeds that
# already work keep the exact launch they were measured with. Nothing here is
# assumed to help: probe-headless-ci.py --fingerprint measures it.
CHANNEL = os.environ.get('BROWSER_FETCH_CHANNEL') or None
STEALTH = os.environ.get('BROWSER_FETCH_STEALTH') == '1'

# Applied via add_init_script, so it runs before any page script can look.
# Deliberately conservative: each patch fixes a property that a stock automated
# Chromium reports differently from a real one. Over-patching is its own tell —
# a browser claiming forty plugins is as odd as one claiming none.
STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
Object.defineProperty(navigator, 'languages', {get: () => ['en-AU', 'en-US', 'en']});
Object.defineProperty(navigator, 'plugins', {
  get: () => [
    {name: 'PDF Viewer', filename: 'internal-pdf-viewer'},
    {name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer'},
    {name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer'},
  ],
});
window.chrome = window.chrome || {runtime: {}, loadTimes: () => ({}), csi: () => ({})};
// Headless Chromium renders through SwiftShader and says so. A real machine
// reports its GPU; these are the strings an ordinary Windows laptop returns.
const _gp = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function (p) {
  if (p === 37445) return 'Intel Inc.';
  if (p === 37446) return 'Intel Iris OpenGL Engine';
  return _gp.apply(this, [p]);
};
// Stock automation resolves this to 'denied' while Notification.permission is
// 'default' — a contradiction no real browser produces.
const _q = window.navigator.permissions.query;
window.navigator.permissions.query = (p) =>
  p.name === 'notifications'
    ? Promise.resolve({state: Notification.permission})
    : _q(p);
"""

# --disable-blink-features=AutomationControlled removes the flag that sets
# navigator.webdriver at the engine level, which is a cleaner fix than patching
# the getter afterwards (the patch stays for the properties there is no flag for).
STEALTH_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-sandbox',
]

# Context options that have to AGREE with each other. A UA claiming Windows
# beside an Australia/Perth timezone and a 1440x900 viewport is coherent; the
# tell is not any single value but a combination no real machine produces.
CONTEXT_KW = dict(
    viewport={'width': 1440, 'height': 900},
    device_scale_factor=1,
    timezone_id='Australia/Perth',
    has_touch=False,
    is_mobile=False,
)


def stealth_context(browser, locale: str = 'en-AU', **extra):
    """A context with the fingerprint patches applied, when they are enabled."""
    opts = dict(user_agent=UA, locale=locale, **CONTEXT_KW)
    opts.update(extra)
    ctx = browser.new_context(**opts)
    if STEALTH:
        ctx.add_init_script(STEALTH_JS)
    return ctx




def proxy_from_env() -> dict | None:
    """Playwright proxy config from SCRAPE_PROXY, or None.

    SCRAPE_PROXY is one URL so it fits in one secret:
        http://user:pass@host:port   (or socks5://, or no credentials)

    Returning None means "go direct", which is the right default: every caller
    here worked without a proxy before this existed. It is deliberately NOT an
    error for the variable to be unset.

    The credentials are PERCENT-DECODED, and they have to be. A residential
    provider's password is a random string that can contain `@` or `:`, and
    either character makes the URL unparseable unless it is encoded — so
    encoding it is the only way to express such a password here, and passing
    the encoded form through to Chromium would authenticate with the wrong
    secret. The failure that causes is a 407 from the proxy on every request,
    which this probe would otherwise report as "the boards blocked us".
    """
    # Through http_fetch so the two transports read ONE definition of the exit,
    # including its per-run targeting flags. They were separate, and a sticky
    # session set for a browser run would silently not apply to a urllib one.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from http_fetch import scrape_proxy_url  # noqa: PLC0415
    raw = scrape_proxy_url()
    if not raw:
        return None
    from urllib.parse import unquote, urlsplit
    u = urlsplit(raw)
    if not u.hostname:
        sys.exit(f'SCRAPE_PROXY is not a URL: {raw[:40]!r}')
    cfg: dict = {'server': f'{u.scheme}://{u.hostname}:{u.port}' if u.port
                 else f'{u.scheme}://{u.hostname}'}
    if u.username:
        cfg['username'] = unquote(u.username)
        cfg['password'] = unquote(u.password or '')
    return cfg

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
    # channel and executable_path are mutually exclusive in Playwright: a
    # channel names an installed browser, a path names a binary. Passing both
    # is an error, and the channel is the more specific request.
    if CHANNEL:
        launch['channel'] = CHANNEL
    elif EXECUTABLE:
        launch['executable_path'] = EXECUTABLE
    if STEALTH:
        launch['args'] = STEALTH_ARGS
    # Proxy at LAUNCH rather than per-context: Chromium resolves DNS through the
    # proxy this way, so a target cannot see the runner's resolver even though
    # its requests come from the proxy. Set per-context it would leak lookups.
    prox = proxy_from_env()
    if prox:
        launch['proxy'] = prox
        sys.stderr.write(f'  browser egressing via {prox["server"]}\n')
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
    if kind == 'text':
        # Matches a button or a link by its visible label, which is what a
        # pager diagnostic can actually report. Case-insensitive substring, so
        # "Load More" still matches "Load more results".
        return page.get_by_text(_re.compile(_re.escape(value), _re.I))
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
        ctx = stealth_context(browser, locale=locale)
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


def render_capturing(url: str, capture: str, instructions: list[dict] | None = None,
                     locale: str = 'en-AU', timeout_s: int = 90,
                     ) -> tuple[str | None, list[dict]]:
    """Like `render`, but also returns the XHR bodies whose URL matches `capture`.

    WHY A PAGE'S HTML IS NOT ALWAYS ITS DATA. A Salesforce Aura board fetches its
    results through a session-gated endpoint and renders them client-side, so
    `page.content()` gives the RENDERED CARDS — the same figures with the
    structure thrown away. Everything downstream then has to recover fields by
    mining flattened text, which is how the APS feed ended up filing 230 of 232
    rows under a fragment of a job ad: the response it needed had the agency in
    its own field the whole time, and nothing was reading it.

    So this listens to the traffic instead. The response objects are collected in
    the handler and their bodies read AFTER the waits finish: reading a body from
    inside a Playwright sync event handler re-enters the event loop and can
    deadlock, while the bodies stay retrievable as long as the page has not
    navigated away — which it has not, because instructions here only wait and
    click.

    Returns (html, [{url, body, post_data}, ...]). The REQUEST body is carried
    alongside the response because on an RPC-style endpoint it is the only place
    the parameters appear — a Salesforce ApexAction is one URL for every call, so
    the page number, page size and filters live in the POST and nowhere else.
    Without it, "which request produced these 15 of 608 rows" is unanswerable.

    A body that cannot be read is skipped rather than failing the render: a
    capture is an extra, and the HTML path behind it still works.
    """
    browser = _browser_once()
    ctx = None
    pat = _re.compile(capture, _re.I)
    pending: list = []
    try:
        ctx = stealth_context(browser, locale=locale)
        page = ctx.new_page()
        page.on('response', lambda r: pat.search(r.url) and pending.append(r))
        page.goto(url, wait_until='domcontentloaded', timeout=timeout_s * 1000)
        for ins in (instructions or []):
            kind = ins.get('type')
            if kind == 'wait':
                page.wait_for_timeout(float(ins.get('wait_time_s', 1)) * 1000)
            elif kind == 'click':
                _locator(page, ins.get('selector', {})).first.click(
                    timeout=timeout_s * 1000)
            elif kind == 'click_until_gone':
                # "Load More" pagination: click, let the fetch land, click again,
                # and stop when the control is no longer there. The capture above
                # collects every response these produce, so one render yields the
                # whole board instead of one page of it.
                #
                # STOPPING IS THE WHOLE DESIGN HERE. The control vanishing is the
                # end of the list and NOT an error, so a failed click ends the
                # loop quietly; anything else and a board whose last page has no
                # button would fail the entire render. `max` bounds it so a
                # control that never disappears cannot spin forever — it is a
                # backstop, not the expected exit.
                sel = ins.get('selector', {})
                limit = int(ins.get('max', 50))
                gap = float(ins.get('wait_s', 2))
                clicks = 0
                for _ in range(limit):
                    try:
                        loc = _locator(page, sel).first
                        if not loc.is_visible(timeout=4000):
                            break
                        loc.click(timeout=8000)
                    except Exception:  # noqa: BLE001
                        break
                    clicks += 1
                    page.wait_for_timeout(gap * 1000)
                sys.stderr.write(f'  clicked {ins.get("label", "control")} {clicks}×\n')
            else:
                raise ValueError(f'browser_fetch: unsupported instruction {kind!r}')
        bodies: list[dict] = []
        for r in pending:
            try:
                body = r.text()
            except Exception:  # noqa: BLE001
                continue
            try:
                post = r.request.post_data or ''
            except Exception:  # noqa: BLE001
                post = ''
            bodies.append({'url': r.url, 'body': body, 'post_data': post})
        return page.content(), bodies
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  browser render failed for {url[:70]}: {str(e)[:160]}\n')
        return None, []
    finally:
        if ctx is not None:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass


class Session:
    """One browser context held open across several fetches.

    `render()` above makes a FRESH context per call, which is right for the
    boards it was written for — each is a full page load that stands alone. It
    is wrong when a page and the assets it references have to be fetched
    together: the NSW jobs site sits behind a Cloudflare interstitial, and the
    clearance the render earns lives in that context's cookies. Re-navigating
    from a new context would face the challenge again for every chunk.

    `text()` fetches from INSIDE the page rather than by navigating to the URL.
    That matters twice over: the request carries the clearance cookie and the
    page's own Referer, and the response comes back as the raw body. Navigating
    a browser to a .js or .json URL instead yields a document wrapping it in
    <pre> with every quote entity-escaped, which silently breaks any regex
    written against the real thing.
    """

    def __init__(self, locale: str = 'en-AU', timeout_s: int = 90,
                 storage_state: str | None = None):
        self._locale = locale
        self._timeout_s = timeout_s
        # A saved Playwright storage_state (cookies + localStorage). Supplied so
        # a site that needs a SIGN-IN can be visited without signing in again on
        # every run: repeated logins from a fresh address are both the slowest
        # part of a run and the part most likely to look like an attack. Missing
        # or unreadable is not an error — the caller logs in and calls
        # save_state() to create it.
        self._state_path = storage_state
        self._ctx = None
        self._page = None

    def __enter__(self):
        browser = _browser_once()
        extra = {}
        if self._state_path and os.path.exists(self._state_path):
            extra['storage_state'] = self._state_path
        self._ctx = stealth_context(browser, locale=self._locale, **extra)
        self._page = self._ctx.new_page()
        return self

    def save_state(self) -> None:
        """Persist cookies so the next run does not have to sign in again."""
        if self._ctx is not None and self._state_path:
            self._ctx.storage_state(path=self._state_path)

    def __exit__(self, *_exc):
        if self._ctx is not None:
            try:
                self._ctx.close()
            except Exception:  # noqa: BLE001
                pass
        self._ctx = None
        self._page = None
        return False

    def html(self, url: str, instructions: list[dict] | None = None) -> str | None:
        """Navigate and return the rendered HTML, running the same instruction
        vocabulary render() accepts."""
        try:
            self._page.goto(url, wait_until='domcontentloaded',
                            timeout=self._timeout_s * 1000)
            for ins in (instructions or []):
                kind = ins.get('type')
                if kind == 'wait':
                    self._page.wait_for_timeout(float(ins.get('wait_time_s', 1)) * 1000)
                elif kind == 'click':
                    _locator(self._page, ins.get('selector', {})).first.click(
                        timeout=self._timeout_s * 1000)
                else:
                    raise ValueError(f'browser_fetch: unsupported instruction {kind!r}')
            return self._page.content()
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f'  session render failed for {url[:70]}: {str(e)[:160]}\n')
            return None

    def text(self, url: str) -> str | None:
        """Fetch `url` from inside the current page and return the raw body.

        A NON-2xx SAYS SO. This used to be `if (!r.ok) return null` — the status
        was discarded inside the page and nothing was written anywhere, so a 403
        challenge and a genuinely empty board arrived at the caller as the same
        None. Measured 2026-08-09: the first startup.jobs run through IPRoyal
        walked 58 employers, archived nothing, and printed not one line
        explaining why. The status is the whole diagnosis, and it was being
        thrown away one stack frame from where it was needed.
        """
        try:
            res = self._page.evaluate(
                """async (u) => {
                     try {
                       const r = await fetch(u, {credentials: 'include'});
                       return {ok: r.ok, status: r.status, body: await r.text()};
                     } catch (e) {
                       return {ok: false, status: 0, body: '', error: String(e)};
                     }
                   }""", url)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f'  session asset fetch failed for {url[:70]}: {str(e)[:120]}\n')
            return None
        if not res:
            sys.stderr.write(f'  session asset fetch returned nothing for {url[:70]}\n')
            return None
        if not res.get('ok'):
            body = res.get('body') or ''
            why = next((label for pat, label in BLOCK_MARKERS
                        if _re.search(pat, body, _re.I)), '')
            sys.stderr.write(
                f'  in-page fetch {res.get("status")} for {url[:70]}'
                f'{" [" + why + "]" if why else ""}'
                f'{" " + str(res.get("error"))[:80] if res.get("error") else ""}'
                f' ({len(body)}B)\n')
            return None
        return res.get('body')


# ── raw bytes through a cleared browser ──────────────────────────────────────
# One Session per process, opened on first use.
_raw_session = None
_raw_cleared: set[str] = set()


def raw_get(url: str, settle: int = 6, locale: str = 'en-AU') -> str | None:
    """Return the RAW body of `url`, fetched from inside a browser that has
    already cleared the site's challenge.

    WHY NOT render(): render() hands back `page.content()`, which is the
    SERIALISED DOM and not the bytes the server sent. The browser normalises
    whitespace, may reorder attributes, and inserts nodes of its own. Parsers
    written against raw HTML can stop matching on markup that is otherwise
    perfectly correct — measured 2026-08-08, when Auckland Airport's
    `<div class="wpjb-job-tile...">\s*<a href=` found nothing in a rendered page
    that a probe had just counted 56 tiles in. TechnologyOne's regex, which
    requires no adjacency, survived the same treatment. That difference is the
    whole bug: it is silent, and it looks exactly like a block.

    So the browser is used for what it is actually needed for — satisfying the
    Cloudflare challenge once — and every page after that is fetched with
    `fetch()` from inside the cleared page, which returns the original body.

    It is also much cheaper. A full render per page cost ~7x a plain fetch
    (19.4s against 2.8s on jobs.govt.nz); this pays that once per origin and
    then runs at fetch speed.
    """
    global _raw_session
    from urllib.parse import urlsplit
    origin = '{0.scheme}://{0.netloc}'.format(urlsplit(url))
    if _raw_session is None:
        _raw_session = Session(locale=locale)
        _raw_session.__enter__()
        atexit.register(lambda: _raw_session.__exit__(None, None, None))
    if origin not in _raw_cleared:
        # Navigate once to earn the clearance cookie for this origin.
        if _raw_session.html(origin + '/', [{'type': 'wait', 'wait_time_s': settle}]) is None:
            return None
        _raw_cleared.add(origin)
    return _raw_session.text(url)


def reset_session() -> None:
    """Throw away the shared browser session so the next fetch opens a new one.

    WHAT THIS IS FOR. raw_get earns an origin's Cloudflare clearance once and
    then pulls every later page with fetch() from inside that cleared page. When
    the site decides it does not like the caller, that judgement sticks to the
    session: the clearance navigation keeps succeeding and every in-page fetch
    comes back 403, for the rest of the run. SimplyHired did exactly that on
    2026-08-07, -08 and -09 — three whole nights archived nothing, each ending

        in-page fetch 403 for https://www.simplyhired.com.au/search?q=... (48B)
        0 employers advertising, 0 rows archived.

    and recovered on its own on the 10th, which is the signature of a decision
    made about the exit rather than about the scraper.

    Dropping the session drops the cookie jar AND the connection, so the next
    call re-clears the origin over a new one. SCRAPE_PROXY's stored credential
    is rotating (see http_fetch.scrape_proxy_url), so that reconnection is
    normally a different residential address — which is the point. It is NOT
    guaranteed: with SCRAPE_PROXY_SESSION set the exit is deliberately sticky
    and a reset will return to the same address, so a caller that resets forever
    would just spin. Callers must bound their retries.

    Deliberately quiet on teardown failure: this runs when things are already
    going wrong, and a browser that will not close cleanly must not be the
    reason a scrape that could still recover dies instead.
    """
    global _raw_session
    if _raw_session is not None:
        try:
            _raw_session.__exit__(None, None, None)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f'  (session teardown failed, continuing: {str(e)[:100]})\n')
    _raw_session = None
    _raw_cleared.clear()


def nav_get(url: str, settle: int = 6, locale: str = 'en-AU') -> str | None:
    """Return `url` by NAVIGATING to it in a reused browser context.

    THE DIFFERENCE FROM raw_get, AND WHY BOTH EXIST. raw_get clears an origin's
    challenge once and then pulls every later page with fetch() from inside the
    cleared page. That is cheaper, and it hands back the server's own bytes.
    It also assumes the site treats an in-page fetch the way it treats a
    document navigation, and some do not:

        in-page fetch 403 for https://startup.jobs/company/abbvie
            [Cloudflare interstitial] (5914B)

    Measured 2026-08-09. The clearance navigation to https://startup.jobs/
    succeeded; every fetch() for a /company/ page from inside that cleared page
    came back 403 with an interstitial. Cloudflare was scoring the XHR
    separately from the document, and no amount of settle time changes that.
    Navigating to the same URL returns the page — which is what
    probe-headless-ci.py had measured all along, and the mistake was porting a
    scraper onto a transport the probe had never exercised.

    So: use raw_get where a parser needs the raw bytes and the site allows the
    fetch (jora, jobs.govt.nz, Auckland Airport, TechnologyOne all do). Use
    nav_get where the site only serves documents. The cost is a real navigation
    per page instead of a fetch, and the return value is `page.content()` — the
    SERIALISED DOM, so check any adjacency-sensitive regex against it before
    switching a parser over. For the two callers here that check is the probe's
    own row counts, which were taken from exactly this.

    The context is shared with raw_get's, so the clearance is earned once
    whichever way a given origin is read.
    """
    global _raw_session
    if _raw_session is None:
        _raw_session = Session(locale=locale)
        _raw_session.__enter__()
        atexit.register(lambda: _raw_session.__exit__(None, None, None))
    return _raw_session.html(url, [{'type': 'wait', 'wait_time_s': settle}])


def json_get(url: str, settle: int = 3, locale: str = 'en-AU') -> str | None:
    """Return a JSON endpoint's body, read from a browser that has cleared the
    site's challenge.

    WHY NOT nav_get. Navigating Chromium to a JSON URL does not hand back JSON:
    the browser wraps it in a document — `<pre>` with every quote
    entity-escaped — so page.content() is HTML that json.loads cannot read, and
    a regex written against the real payload matches nothing. probe-headless-ci
    hit exactly this on GulfTalent and had to add a `json_key` path for it.

    document.body.innerText is the way out. It is the TEXT the browser rendered
    into that <pre>, entities already decoded, which is byte-for-byte the
    original payload.

    Shares raw_get's session, so the Akamai clearance earned by one request
    carries to the next.
    """
    global _raw_session
    if _raw_session is None:
        _raw_session = Session(locale=locale)
        _raw_session.__enter__()
        atexit.register(lambda: _raw_session.__exit__(None, None, None))
    if _raw_session.html(url, [{'type': 'wait', 'wait_time_s': settle}]) is None:
        return None
    try:
        return _raw_session._page.evaluate('document.body.innerText')
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  json_get could not read the body of {url[:70]}: {str(e)[:120]}\n')
        return None


if __name__ == '__main__':
    # quick check: python3 scripts/browser_fetch.py <url> [settle_s]
    u = sys.argv[1] if len(sys.argv) > 1 else 'https://example.com'
    settle = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    html = render(u, [{'type': 'wait', 'wait_time_s': settle}])
    sys.stderr.write(f'len={len(html or "")}\n')
    print((html or '')[:600])
