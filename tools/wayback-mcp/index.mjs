#!/usr/bin/env node
// Wayback Machine MCP server — relays queries to web.archive.org from a host
// with open network access, exposing three tools to any MCP client:
//   • wayback_available   — closest archived snapshot of a URL
//   • wayback_snapshots   — list snapshots via the CDX API (supports wildcards)
//   • wayback_fetch       — fetch the archived content of a specific snapshot
//
// stdio transport, so it runs as a subprocess of the MCP client. See README.md.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const UA = 'wayback-mcp/1.0 (+https://archive.org)';

async function getText(url, { timeoutMs = 30000, maxChars = 0 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' });
    let body = await res.text();
    let truncated = false;
    if (maxChars && body.length > maxChars) {
      body = body.slice(0, maxChars);
      truncated = true;
    }
    return { ok: res.ok, status: res.status, finalUrl: res.url, body, truncated };
  } finally {
    clearTimeout(t);
  }
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const err = (s) => ({ content: [{ type: 'text', text: s }], isError: true });

const server = new McpServer({ name: 'wayback', version: '1.0.0' });

// ── wayback_available ──────────────────────────────────────────────────────
server.tool(
  'wayback_available',
  'Find the closest Wayback Machine snapshot of a URL. Optionally target a moment in time with `timestamp` (YYYYMMDD or YYYYMMDDhhmmss). Returns the snapshot URL, its capture timestamp and HTTP status, or a note if none exists.',
  {
    url: z.string().describe('The page URL to look up in the archive.'),
    timestamp: z.string().optional().describe('Preferred moment, YYYYMMDD[hhmmss]. Returns the nearest capture to it.'),
  },
  async ({ url, timestamp }) => {
    const q = new URLSearchParams({ url });
    if (timestamp) q.set('timestamp', timestamp);
    try {
      const r = await getText(`https://archive.org/wayback/available?${q}`);
      const data = JSON.parse(r.body);
      const snap = data?.archived_snapshots?.closest;
      if (!snap) return text(`No archived snapshot found for ${url}.`);
      return text(JSON.stringify({ url, closest: snap }, null, 2));
    } catch (e) {
      return err(`wayback_available failed: ${e.message}`);
    }
  },
);

// ── wayback_snapshots (CDX) ─────────────────────────────────────────────────
server.tool(
  'wayback_snapshots',
  'List Wayback Machine captures of a URL via the CDX API. Use matchType "prefix" or "host"/"domain" for wildcard-style crawls (e.g. all captures under careers.example.com/search). Returns rows of {timestamp, original, statuscode, mimetype, length}.',
  {
    url: z.string().describe('URL or URL pattern (host/path). With matchType prefix, captures everything beneath it.'),
    matchType: z.enum(['exact', 'prefix', 'host', 'domain']).optional().describe('exact (default), prefix, host, or domain.'),
    from: z.string().optional().describe('Earliest capture, YYYYMMDD[hhmmss].'),
    to: z.string().optional().describe('Latest capture, YYYYMMDD[hhmmss].'),
    limit: z.number().int().optional().describe('Max rows (default 50). Negative returns the most recent N.'),
    filter: z.string().optional().describe('CDX filter, e.g. "statuscode:200" or "mimetype:text/html".'),
    collapse: z.string().optional().describe('Collapse adjacent rows on a field, e.g. "digest" (dedupe identical captures) or "timestamp:8" (one per day).'),
  },
  async ({ url, matchType, from, to, limit, filter, collapse }) => {
    const q = new URLSearchParams({ url, output: 'json', fl: 'timestamp,original,statuscode,mimetype,length' });
    if (matchType) q.set('matchType', matchType);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    q.set('limit', String(limit ?? 50));
    if (filter) q.set('filter', filter);
    if (collapse) q.set('collapse', collapse);
    try {
      const r = await getText(`https://web.archive.org/cdx/search/cdx?${q}`, { timeoutMs: 45000 });
      if (!r.ok) return err(`CDX API returned HTTP ${r.status}.`);
      const rows = JSON.parse(r.body || '[]');
      if (!rows.length) return text(`No captures found for ${url}.`);
      const [head, ...data] = rows;
      const out = data.map((row) => Object.fromEntries(head.map((k, i) => [k, row[i]])));
      return text(JSON.stringify({ count: out.length, snapshots: out }, null, 2));
    } catch (e) {
      return err(`wayback_snapshots failed: ${e.message}`);
    }
  },
);

// ── wayback_fetch ───────────────────────────────────────────────────────────
server.tool(
  'wayback_fetch',
  'Fetch the archived content of a specific Wayback snapshot. Give the original URL + its capture timestamp (from wayback_snapshots / wayback_available). Returns the raw page as it was captured.',
  {
    url: z.string().describe('The original URL that was archived.'),
    timestamp: z.string().describe('The capture timestamp, YYYYMMDDhhmmss (from wayback_snapshots).'),
    raw: z.boolean().optional().describe('True (default) fetches the original bytes with no Wayback rewriting (the id_ modifier).'),
    maxChars: z.number().int().optional().describe('Truncate the returned body to this many characters (default 20000).'),
  },
  async ({ url, timestamp, raw, maxChars }) => {
    const mod = raw === false ? '' : 'id_';
    const snapUrl = `https://web.archive.org/web/${timestamp}${mod}/${url}`;
    try {
      const r = await getText(snapUrl, { timeoutMs: 45000, maxChars: maxChars ?? 20000 });
      const header = `# ${snapUrl}\n# HTTP ${r.status}${r.truncated ? ' · truncated' : ''}\n\n`;
      return text(header + r.body);
    } catch (e) {
      return err(`wayback_fetch failed: ${e.message}`);
    }
  },
);

await server.connect(new StdioServerTransport());
console.error('wayback-mcp: ready on stdio');
