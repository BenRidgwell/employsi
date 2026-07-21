# wayback-mcp

An MCP server that relays your queries to the **Wayback Machine**
(`web.archive.org`). Run it on a machine with open network access and any MCP
client (Claude Code, Claude Desktop) can look up archived pages through it.

Built originally to pull **historical job-posting counts** off archived pages
like `careers.bhp.com/search?...` — but it works for any URL.

> **Note on the remote sandbox:** if your Claude session runs in a locked-down
> remote environment whose network policy blocks `web.archive.org`, running this
> server *inside* that sandbox will not help — the block is at the network layer
> and a subprocess is subject to it too. This server unblocks Wayback for
> sessions where **it** runs on a host with open egress (your local machine, or
> any environment with an open network policy).

## Tools

| Tool | What it does |
| --- | --- |
| `wayback_available` | Closest snapshot of a URL (optionally near a `timestamp`). |
| `wayback_snapshots` | List captures via the CDX API. Supports `matchType: prefix/host/domain` for wildcard crawls, plus `from`/`to`/`filter`/`collapse`/`limit`. |
| `wayback_fetch` | Fetch the archived content of one snapshot (`url` + `timestamp`). |

## Setup

```bash
cd tools/wayback-mcp
npm install
```

### Claude Code

```bash
claude mcp add wayback -- node /absolute/path/to/tools/wayback-mcp/index.mjs
```

or add it to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "wayback": {
      "command": "node",
      "args": ["/absolute/path/to/tools/wayback-mcp/index.mjs"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "wayback": {
      "command": "node",
      "args": ["/absolute/path/to/tools/wayback-mcp/index.mjs"]
    }
  }
}
```

Restart the client; the three `wayback_*` tools appear.

## Example — BHP historical vacancies

1. `wayback_snapshots` with
   `url: "careers.bhp.com/search*"`, `matchType: "prefix"`,
   `from: "2015"`, `filter: "statuscode:200"`, `collapse: "timestamp:6"`
   → one capture per month.
2. `wayback_fetch` each `{original, timestamp}` and read the total-results count
   off the archived page to build a vacancy time series.

## Requirements

Node ≥ 18 (uses global `fetch`). Depends on `@modelcontextprotocol/sdk` + `zod`.
