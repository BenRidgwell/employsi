#!/usr/bin/env python3
"""MCP server wrapping the locally-installed `linkedin_scraper` library (v3+).

Exposes LinkedIn company / job-search / company-posts / person scraping to any
MCP client (Claude Code, Claude Desktop, Cursor, …) as tools. It drives a real
logged-in browser via the library's Playwright backend, so it runs on the
machine where you've installed `linkedin_scraper` and authenticated.

  ⚠️  LinkedIn's Terms of Service prohibit automated scraping. This uses YOUR
      account/session, on your own machine, at your own risk. Prefer the
      company / job tools (aggregate labour-market signal) over harvesting
      individuals' personal profiles.

Auth: on first use it loads a saved Playwright session from
LINKEDIN_SESSION (default ./session.json). If none exists and LINKEDIN_EMAIL /
LINKEDIN_PASSWORD are set, it logs in programmatically and saves the session so
later runs reuse it (fewer logins = less chance of a security challenge). If
neither is available, create the session once with `python session_setup.py`.

Env:
  LINKEDIN_SESSION   path to the saved session json (default ./session.json)
  LINKEDIN_EMAIL     account email (only used to create a session if missing)
  LINKEDIN_PASSWORD  account password (only used to create a session if missing)
  LINKEDIN_HEADLESS  "0" to show the browser window (default headless "1")
"""
from __future__ import annotations

import asyncio
import os
from typing import Any

from mcp.server.fastmcp import FastMCP

# The library the user installed locally (v3+: Playwright, async, Pydantic).
from linkedin_scraper import (  # type: ignore
    BrowserManager,
    login_with_credentials,
    PersonScraper,
    CompanyScraper,
    JobSearchScraper,
    CompanyPostsScraper,
)

SESSION_PATH = os.environ.get("LINKEDIN_SESSION", "session.json")
HEADLESS = os.environ.get("LINKEDIN_HEADLESS", "1") != "0"

mcp = FastMCP("linkedin")

# One shared, lazily-opened browser session, serialised behind a lock — a single
# logged-in page reused across calls (opening a new browser per call both
# wastes time and looks more bot-like to LinkedIn).
_browser: BrowserManager | None = None
_lock = asyncio.Lock()


async def _ensure_browser() -> BrowserManager:
    global _browser
    if _browser is not None:
        return _browser
    bm = BrowserManager(headless=HEADLESS)
    await bm.__aenter__()  # opened for the process lifetime; closed at exit
    try:
        if os.path.exists(SESSION_PATH):
            await bm.load_session(SESSION_PATH)
        elif os.environ.get("LINKEDIN_EMAIL") and os.environ.get("LINKEDIN_PASSWORD"):
            await bm.page.goto("https://www.linkedin.com/login")
            await login_with_credentials(
                bm.page,
                username=os.environ["LINKEDIN_EMAIL"],
                password=os.environ["LINKEDIN_PASSWORD"],
            )
            await bm.save_session(SESSION_PATH)
        else:
            await bm.__aexit__(None, None, None)
            raise RuntimeError(
                f"No LinkedIn session at {SESSION_PATH} and no LINKEDIN_EMAIL/PASSWORD set. "
                "Create a session once with `python session_setup.py`, or set the credentials."
            )
    except Exception:
        _browser = None
        raise
    _browser = bm
    return bm


def _to_dict(obj: Any) -> Any:
    """Pydantic model / list / plain object → JSON-serialisable structure."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, list):
        return [_to_dict(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _to_dict(v) for k, v in obj.items()}
    for attr in ("model_dump", "dict"):  # pydantic v2, then v1
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                return fn()
            except Exception:
                pass
    if hasattr(obj, "__dict__"):
        return {k: _to_dict(v) for k, v in vars(obj).items() if not k.startswith("_")}
    return str(obj)


@mcp.tool()
async def linkedin_company(url: str) -> dict:
    """Scrape a LinkedIn company page. Give its URL
    (e.g. https://www.linkedin.com/company/microsoft/). Returns name, industry,
    company_size, headquarters, founded, specialties and the about text."""
    async with _lock:
        bm = await _ensure_browser()
        company = await CompanyScraper(bm.page).scrape(url)
        return _to_dict(company)


@mcp.tool()
async def linkedin_job_search(keywords: str, location: str = "", limit: int = 15) -> dict:
    """Search LinkedIn jobs by keywords (and optional location). `limit` is
    capped at 50. Returns a list of jobs with title, company, location,
    description, employment_type, seniority_level and linkedin_url."""
    limit = max(1, min(int(limit), 50))
    async with _lock:
        bm = await _ensure_browser()
        jobs = await JobSearchScraper(bm.page).search(keywords=keywords, location=location or None, limit=limit)
        return {"count": len(jobs), "jobs": _to_dict(jobs)}


@mcp.tool()
async def linkedin_company_posts(url: str, limit: int = 10) -> dict:
    """Scrape recent posts from a company's LinkedIn page. `limit` capped at 25.
    Returns posts with text, posted_date, reaction/comment/repost counts and
    image URLs — useful signal on a company's activity and hiring pushes."""
    limit = max(1, min(int(limit), 25))
    async with _lock:
        bm = await _ensure_browser()
        posts = await CompanyPostsScraper(bm.page).scrape(url, limit=limit)
        return {"count": len(posts), "posts": _to_dict(posts)}


@mcp.tool()
async def linkedin_person(url: str) -> dict:
    """Scrape a single LinkedIn person profile by URL. Note: this returns an
    individual's personal data (name, headline, experience, education, skills) —
    use it sparingly and only where you have a legitimate basis; do not harvest
    profiles in bulk."""
    async with _lock:
        bm = await _ensure_browser()
        person = await PersonScraper(bm.page).scrape(url)
        return _to_dict(person)


if __name__ == "__main__":
    mcp.run()  # stdio transport
