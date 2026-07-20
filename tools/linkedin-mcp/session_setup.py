#!/usr/bin/env python3
"""One-time LinkedIn session setup for the MCP server.

Opens a real browser window, lets you log in by hand (so you clear any 2FA /
security check yourself), then saves the authenticated session to session.json.
The MCP server reuses that session, so it never has to log in again — the safest
pattern (no stored password, fewer logins). Re-run this if the session expires.

    python session_setup.py
"""
import asyncio
import os

from linkedin_scraper import BrowserManager, wait_for_manual_login  # type: ignore

SESSION_PATH = os.environ.get("LINKEDIN_SESSION", "session.json")


async def main() -> None:
    async with BrowserManager(headless=False) as browser:
        await browser.page.goto("https://www.linkedin.com/login")
        print("Log in to LinkedIn in the browser window (clear any 2FA/checks)…")
        await wait_for_manual_login(browser.page, timeout=300)
        await browser.save_session(SESSION_PATH)
        print(f"Saved session to {SESSION_PATH}. You can close this and run the MCP server.")


if __name__ == "__main__":
    asyncio.run(main())
