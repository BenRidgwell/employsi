# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Employsi** — an HR-intelligence labour-market map. A Mapbox globe you zoom through four
layers (global → domestic region → local city → company card), showing real job-vacancy and
skill-demand data scraped nightly from employer career portals, government job boards and
job-board APIs.

The app is `src/employsi/` (the rest of `src/` is TanStack Start scaffolding and unused
shadcn/ui components). It ships as **two separate Cloudflare Workers** that share one KV
namespace and one D1 database.

## Commands

```bash
npm run dev                       # vite dev server
npm run build                     # vite build -> .output/server (nitro cloudflare preset)
npm run lint                      # eslint; must stay at 0 errors (8 react-refresh warnings are pre-existing)
npx eslint <file> --fix           # prettier is enforced through eslint, so this is the formatter
npx tsc --noEmit -p tsconfig.json # typecheck
```

There is **no test runner**. What CI actually checks (`.github/workflows/skills-check.yml`,
`scraper-check.yml`) is:

```bash
bun run scripts/check-skills.ts       # skill taxonomy invariants
python scripts/test_skills_taxonomy.py
python scripts/test_jobs_extract.py
python scripts/test_rosters.py         # roster parsers still read their data files
python -m compileall -q scripts/*.py
```

To exercise a scraper without deploying, call it directly through `tsx` — the fetchers are
plain exported functions:

```bash
npx tsx -e 'import {SITES,fetchPortal} from "./workers/jobs-cron/careerSites";
  fetchPortal(SITES.find(s=>(s.key??s.id)==="bhp")!).then(j=>console.log(j.length))'
```

### Deploying

> **`npx wrangler deploy` PUBLISHES TO PRODUCTION — https://employsi.com.au.**
> Never run it unless the user has asked for that deploy **in this conversation**.
> "Deploy so I can look at it" is not that request; see the preview options below.

There is **no separate staging environment**. The custom domain is attached to the
same Worker as `benridgwell-globe-gazer-hr.employsi.workers.dev` (the attachment lives
in the Cloudflare dashboard, so nothing in `wrangler.jsonc` reveals it). Deploying to
"the workers.dev preview" *is* deploying to the public site — they are one Worker,
serving byte-identical assets.

**Production does not track `main`.** As of 2026-08-12 the live site is version
`52e5abaa-dccb-434a-8c15-da93871d0974`, deployed from
`claude/employsi-indexing-seo-u2yzcv`. That branch contains all of
`claude/waitlist-page-updates-053rss` (the previous production branch) plus the
crawler files in `src/server.ts` and `src/lib/site.ts`.

Everything the older note warned about still applies, because `main` still lacks
it all: the D1-backed landing stats (`src/employsi/lib/landingStatsFn.ts`), the
domain routing in `src/server.ts` and the un-clipped hero graphic. A deploy from
`main` silently reverts them — the ticker falls back to the hardcoded `SEED`
placeholders in `src/components/Ticker.tsx`, and the hero clips. It would now
also drop `/sitemap.xml` and the social card. **Check what branch production is
on before deploying anything.** The revert happened on 2026-08-10 and was
recovered with `wrangler rollback`.

Deploying needs `VITE_MAPBOX_TOKEN` as well as `CLOUDFLARE_API_TOKEN` —
`vite.config.ts` refuses to build without it, so a deploy cannot be done from an
environment that only has the Cloudflare credential.

**Cloudflare caches `/sitemap.xml` and `/robots.txt` at the edge.** A 404 fetched
before a deploy is still served for a while after it, so verifying with a bare
`curl` can show the pre-deploy answer and read as a failed deploy. Bust it with a
query string (`/sitemap.xml?cb=1`) before concluding anything.

To let someone LOOK at a change without touching the public site, upload a version
without shifting traffic — this prints its own preview URL:

```bash
npx wrangler versions upload      # builds + uploads, serves 0% of traffic
npx wrangler versions list        # find a version id
npx wrangler rollback <version-id> --message "why"   # emergency restore
```

Deploys, when actually asked for:

```bash
npx wrangler deploy                                          # the app worker -> PRODUCTION
npx wrangler deploy --config workers/jobs-cron/wrangler.jsonc # the scraper worker
```

Two independent deploys — doing one does not update the other.

`CLOUDFLARE_API_TOKEN` must be in the environment. Do **not** pass `--noproxy '*'` to
Cloudflare API calls in this sandbox; it breaks them.

### Firing a cron by hand

```bash
npx wrangler dev --config workers/jobs-cron/wrangler.jsonc --remote --test-scheduled --port 8801
curl --noproxy 127.0.0.1 "http://127.0.0.1:8801/__scheduled?cron=20+4+*+*+*"
```

`--test-scheduled` fires the handler over HTTP, and **its `waitUntil` allowance is shorter
than a real scheduled invocation's**. A run that logs `waitUntil() tasks did not complete
within the allowed time and have been cancelled` writes nothing at all — always confirm the
rows landed in D1 rather than trusting `Ran scheduled event`.

To stop the dev server, match on `wrangler[ ]dev`. Plain `pkill -f "wrangler dev"` matches
the killing shell's own command line and takes out your Bash session (exit 144).

## Architecture

### Two workers

- **App worker** — root `wrangler.jsonc`, entry `src/server.ts`. Nitro deep-merges the root
  `wrangler.jsonc` bindings into `.output/server/wrangler.json` on every build. `server.ts`
  mounts `/api/auth/*` (Better Auth) *before* the TanStack entry, because auth needs raw
  Request/Response and must never enter the router.
- **Scraper worker** — `workers/jobs-cron/`, entry `index.ts`. Pure cron, no routes. Every
  scrape is dispatched by matching `event.cron` against a tick map.

### The data pipeline

All vacancy sources converge on one D1 table (`jobs`) via `src/employsi/lib/jobArchive.ts`:

```
job_key = source|normTitle|normCompany|normLocation
ON CONFLICT(job_key) DO UPDATE SET last_seen = ?, seen_count = seen_count + 1
```

So the archive is append-only and self-deduping; "currently advertised" is
`last_seen >= date('now','-1 day')`, and taken-down ads age out on their own. A role on two
boards collapses to one row. **Two rows that differ only because a parser bug dropped the
location are two different keys** — a parser fix can therefore double-count until the stale
variants age out.

Three source families feed it:

1. **In-Worker fetchers** (`workers/jobs-cron/*.ts`) — Adzuna/Muse/Jooble APIs, state
   government boards (`waGov`, `vicGov`, `qldGov`, `ntGov`, `tasGov`), and 30+ employer
   career portals (`careerSites.ts`).
2. **GitHub Actions** (`.github/workflows/*-archive.yml` → `scripts/*-to-d1.py`) for sources
   that block Cloudflare IPs. SEEK 403s a Worker on a Cloudflare-to-Cloudflare fingerprint;
   Indeed/Jora/NAB need Oxylabs (`scripts/oxylabs_client.py`). These write the same D1 rows
   through the HTTP API and exit non-zero when a run degrades, so a block shows red.
3. **Generated static data** — `scripts/gen-*.py` → `src/employsi/data/*.ts`.

`workers/jobs-cron/ARCHIVE.md` documents each feed and, importantly, *why* the ones that
can't run in-Worker can't.

### Career portals (`workers/jobs-cron/careerSites.ts`)

The largest single file. 13 ATS platforms, one `SiteDef` per feed. Four things must stay in
step or a portal silently stops running:

`SITES` → `PORTAL_GROUPS` (which feeds share a tick) → `PORTAL_TICKS` in `index.ts` (cron
string → group index) → `crons` in `workers/jobs-cron/wrangler.jsonc`.

- `id` is the app company id; `key` distinguishes multiple feeds for one employer (Brambles,
  Transurban, Woolworths' page windows). Feeds sharing an `id` all land on one company.
- Per-tenant quirks (`pageSize`, `siteNumber`, `avatureCells`, `pageFrom`, `maxPages`) are
  **measured against the live site and commented with the measurement**, never guessed. Two
  tenants on the same platform routinely disagree.
- `pagedParallel` stops at the first short page. A fetch failure also returns zero rows, so
  it is indistinguishable from the end of a list — this has caused silent truncation twice.
  Prefer bounding a walk by an advertised total, and treat "empty" as end-of-list only after
  several consecutive empties.
- An empty pull is never written, so a portal that rate-limits leaves yesterday's rows alone
  instead of blanking the card.

### Skills

`src/employsi/data/skillsTaxonomy.ts` is the single matcher (`skillsForText`) used by the
Worker, the scripts and the app, so a role maps identically wherever it enters. Read stored
skills with `parseStoredSkills` — it applies `SKILL_ALIAS` and drops names no longer in the
taxonomy, which is why legacy values in old archive rows don't need a migration.

### Map layers

`src/employsi/state/store.ts` (zustand) owns the layer state; `WorldMapbox.tsx` handles
global + domestic, `PerthMapbox.tsx` the local 3D city. Layer crossings are driven by zoom
thresholds (`CROSS_GLOBAL_TO_DOMESTIC` etc.) plus a `LAYER_COOLDOWN` barrier so one wheel
gesture can't skip a layer. Those constants are **zoom levels, not pixels** — resizing the
map frame does not invalidate them.

Company pin placement is `spreadCoordsCity()` in `data/rosters.ts`: a phyllotaxis fan around
a verified CBD anchor, with per-city `CITY_PLACEMENT` arcs chosen to keep pins off water.
Those arcs were measured against OpenStreetMap coastlines; changing one moves real markers
into the sea.

### Generated data files

Eleven files under `src/employsi/data/` carry a `GENERATED — do not edit by hand` header and
are ESLint-ignored. Prettier would reformat their compact one-record-per-line arrays into
hundreds of thousands of lines and the next generator run would undo it. Change the
generator in `scripts/`, not the output.

## Conventions

**Data honesty is the core discipline of this codebase.** Suppress rather than fabricate;
report collected-vs-advertised; let a real zero be zero. When a card shows a number, it came
from a row somewhere. Several past bugs were "a plausible-looking figure that was invented",
so a new stat needs a source, not a formula over a hash.

**Verify against the live thing before you write the parser**, and record the measurement in
a comment next to the code that depends on it. Nearly every comment in `careerSites.ts` that
looks over-explanatory is load-bearing: it names the assumption a future breakage will
violate.

**Secrets** (Oxylabs, Cloudflare, TheirStack) live only in the environment, never in the
repo. Before committing:

```bash
grep -rn "qMOOs\|StephenCurry30\|cfut_\|eyJhbGciOiJIUzI1NiI" src/ scripts/ workers/ .github/
```

**This repo syncs to Lovable** (see `AGENTS.md`): do not force-push, rebase, amend or squash
commits that are already pushed — it rewrites history on Lovable's side and the user can
lose their project history. Keep the pushed branch in a working state.

**No visual verification is possible from this sandbox** — Chromium cannot reach remote hosts
through the proxy. Deploy and ask the user to look, rather than claiming a UI change renders.
