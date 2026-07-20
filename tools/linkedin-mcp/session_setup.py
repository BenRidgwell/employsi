#!/usr/bin/env python3
"""One-time LinkedIn session setup for the MCP server.

Opens a real browser window and lets you log in **by hand, at your own pace** —
including any 2FA / SMS / email code / security checkpoint. There is no login
timer: when your LinkedIn home feed has loaded, come back to this terminal and
press Enter, and the authenticated session is saved to session.json. The MCP
server reuses that session, so it never logs in again (no stored password,
fewer logins = far less chance of a security challenge). Re-run this whenever
the session expires.

    python3 session_setup.py
"""
import asyncio
import os

from linkedin_scraper import BrowserManager  # type: ignore

SESSION_PATH = os.environ.get("LINKEDIN_SESSION", "session.json")


async def _prompt(msg: str) -> str:
    # Read from the terminal without blocking Playwright's event loop, so the
    # browser stays fully responsive while you take your time logging in.
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, input, msg)


async def main() -> None:
    # headless=False so you can actually see + use the login page.
    async with BrowserManager(headless=False) as browser:
        await browser.page.goto("https://www.linkedin.com/login")
        print("\n  A browser window has opened on the LinkedIn login page.")
        print("  Log in fully — take as long as you need, clear any 2FA / checkpoint.")
        print("  When your LinkedIn feed has loaded, come back here and press Enter.\n")
        await _prompt("  Press Enter once you're logged in to save the session… ")
        await browser.save_session(SESSION_PATH)
        print(f"\n  ✓ Saved session to {os.path.abspath(SESSION_PATH)}")
        print("  You can close the browser and run the MCP server now.\n")


if __name__ == "__main__":
    asyncio.run(main())
