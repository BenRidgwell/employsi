# linkedin-mcp

An MCP server that exposes the [`joeyism/linkedin_scraper`](https://github.com/joeyism/linkedin_scraper)
library (v3+, Playwright) to any MCP client — Claude Code, Claude Desktop,
Cursor, etc. It drives your **logged-in** LinkedIn session to pull company,
job-search, company-post and person data as MCP tools.

> ⚠️ **Terms of Service.** LinkedIn prohibits automated scraping and actively
> enforces it. This runs on **your** machine with **your** account/session, at
> your own risk. Favour the company / job tools (aggregate labour-market
> signal); the person tool returns an individual's personal data — use it
> sparingly and lawfully, never in bulk.

## Tools

| Tool | Purpose |
| --- | --- |
| `linkedin_company` | Company page → name, industry, size, HQ, founded, specialties, about |
| `linkedin_job_search` | Search jobs by keywords (+ location) → title, company, location, description, type, seniority, URL (limit ≤ 50) |
| `linkedin_company_posts` | Recent company posts → text, date, reaction/comment/repost counts, images (limit ≤ 25) |
| `linkedin_person` | A single profile → name, headline, experience, education, skills (use sparingly) |

## Setup

```bash
cd tools/linkedin-mcp
pip install -r requirements.txt
playwright install chromium        # if not already installed

# One-time: log in by hand and save the session (clears 2FA yourself)
python session_setup.py            # opens a browser, writes session.json
```

`session.json` holds your authenticated cookies — it's git-ignored; keep it
private. Re-run `session_setup.py` if the session expires.

### Register with Claude Code

```bash
claude mcp add linkedin -- python /absolute/path/to/tools/linkedin-mcp/server.py
```

or in `.mcp.json` / your client's MCP config:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "python",
      "args": ["/absolute/path/to/tools/linkedin-mcp/server.py"],
      "env": { "LINKEDIN_SESSION": "/absolute/path/to/tools/linkedin-mcp/session.json" }
    }
  }
}
```

Restart the client; the four `linkedin_*` tools appear.

## Environment variables

| Var | Meaning |
| --- | --- |
| `LINKEDIN_SESSION` | Path to the saved session json (default `./session.json`) |
| `LINKEDIN_HEADLESS` | `0` to show the browser window (default headless `1`) |
| `LINKEDIN_EMAIL` / `LINKEDIN_PASSWORD` | Optional — only used to auto-create a session if none exists. Prefer `session_setup.py` so no password is stored. |

## Notes on the remote sandbox

Like any scraper that needs a residential/logged-in session, this belongs on a
machine you control — not the app's Cloudflare Workers or a datacenter IP, where
LinkedIn will challenge or block the login. Feeding its output into the Employsi
pipeline is a manual/offline step, not a live Worker call.

## Requirements

Python ≥ 3.9. Depends on `linkedin_scraper` (v3+), `mcp`, `playwright`.
