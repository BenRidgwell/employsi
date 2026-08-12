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
bun run scripts/check-skills.ts            # skill taxonomy invariants
bun run scripts/check-analyst-followups.ts # a follow-up resolves to the scope it names
bun run scripts/check-analyst-scope.ts     # every analyst scope excludes the closed corpora
bun run scripts/check-skill-trends.ts      # the card's per-skill/per-area reconstruction
python scripts/test_skills_taxonomy.py
python scripts/test_jobs_extract.py
python scripts/test_rosters.py             # roster parsers still read their data files
python -m compileall -q scripts/*.py
```

The three `check-*.ts` beyond the taxonomy one all guard the same class of bug: an
aggregate that still renders a plausible number after the reasoning behind it breaks.
None of them would fail visibly in the app — that is the point of asserting them.

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

The custom domain is attached to `benridgwell-globe-gazer-hr` in the Cloudflare
dashboard, so nothing in `wrangler.jsonc` reveals it. A bare `npx wrangler deploy`
uses the name in the config and therefore hits that Worker: `employsi.com.au` and
`benridgwell-globe-gazer-hr.employsi.workers.dev` are one Worker serving
byte-identical assets, and deploying to "the workers.dev URL" is deploying to the
public site.

**There IS a preview Worker, despite what this file said until 2026-08-12.**
`employsi-preview.employsi.workers.dev` is a separate Worker running the same
codebase, and it is the right target for "deploy so I can look at it". Nothing in
this repo references it — no `wrangler.jsonc`, no workflow in `.github/` — so it is
invisible from the source tree and easy to miss. `wrangler deploy --name` is how you
reach it; the comment at the top of `wrangler.jsonc` already documents that pattern
for the prod/mobile split.

Workers on the account, verified 2026-08-12:

| Worker | What it is |
| --- | --- |
| `benridgwell-globe-gazer-hr` | **PRODUCTION.** Carries `employsi.com.au` |
| `employsi-preview` | Preview of the same app — deploy here to be looked at |
| `benridgwell-globe-gazer-hr-mobile` | Mobile build |
| `benridgwell-globe-gazer-hr-mapbox-trial` | Trial, last touched 2026-07-15 |
| `employsi-jobs-cron` | The scraper. Separate config, separate deploy |
| `employsi` | Another deployment of this same app, last built 2026-08-06. Purpose unrecorded — do not deploy over it without asking |

`--name` cannot capture the custom domain, because neither `wrangler.jsonc` nor the
generated `.output/server/wrangler.json` declares `routes` or `custom_domain` — the
attachment is dashboard-side. Verify that still holds before trusting it.

**A `--name` deploy inherits the PRODUCTION bindings.** They are declared in the
config, not per-Worker, so the preview reads and writes the real `JOBS_ARCHIVE` D1
and the real `OPEN_ROLES_HISTORY` KV. Reads are the point — the preview shows real
data — but nothing is isolated, so a change that writes needs thinking about before
it runs there.

**THE APP IS AT `/app`. `/` IS THE WAITLIST, ON EVERY HOST.** `src/routes/index.tsx`
is the marketing page; `src/routes/app.tsx` is the product. Send a reviewer to
`…workers.dev/app` — a link to `/` shows them the waitlist and nothing you built.

This is easy to get backwards, and this file said the opposite until 2026-08-12.
`app.tsx` imports `MobileFramePreview` statically, so that chunk appears in
`/app`'s asset list on every host and the route looks like the mobile frame. It
is not: the frame only wraps the app when the hostname matches `-mobile`, and
the app itself is `lazy(() => import("@/employsi/App"))`, so it loads after
hydration and never shows up in the SSR HTML. Read the `<title>` instead —
"Employsi map — the live labour-market globe" is the app, "Employsi — Exploring
the world of work" is the waitlist.

The apex serves the waitlist ONLY: `employsi.com.au/app` 302s away (see
`APP_ONLY_PATHS` in `src/server.ts`). So a production deploy of app work is
reachable at `benridgwell-globe-gazer-hr.employsi.workers.dev/app` and nowhere
else — checking `employsi.com.au` returns 200 proves the waitlist is up, not
that the app deployed.

**Production does not track `main`.** The live site was built from
`claude/waitlist-page-updates-053rss`, which carries the D1-backed landing stats
(`src/employsi/lib/landingStatsFn.ts`), the domain routing in `src/server.ts` and the
un-clipped hero graphic. A deploy from a branch missing those silently reverts them:
the ticker falls back to hardcoded placeholders and the hero clips. This happened on
2026-08-10 and was recovered with `wrangler rollback`. **Check before deploying
anything** — the test is whether your branch contains that one, not what it is named:

```bash
git fetch origin claude/waitlist-page-updates-053rss
git merge-base --is-ancestor origin/claude/waitlist-page-updates-053rss HEAD \
  && echo safe || echo "WOULD REVERT PRODUCTION"
```

To let someone LOOK at a change, either deploy to the preview Worker or upload a
version to production without shifting traffic — the second prints its own URL:

```bash
npx wrangler deploy --name employsi-preview   # -> employsi-preview.employsi.workers.dev
npx wrangler versions upload                  # builds + uploads, serves 0% of traffic
npx wrangler versions list                    # find a version id
npx wrangler rollback <version-id> --message "why"            # production
npx wrangler rollback <version-id> --name employsi-preview --message "why"
```

### The preview Worker — `employsi-preview`

A version-upload URL is fine for LOOKING at a change, but it cannot be used to
test **signing in**. `BETTER_AUTH_URL` is a fixed origin, so the OAuth
`redirect_uri` always points at whatever that says no matter which host served
the page — start on a version preview and the round trip finishes on the *other*
origin, the cookie is set there, and the preview stays signed out. It reads
exactly like "login is broken". Version URLs also change hash on every upload,
so they can never be registered with Google or LinkedIn.

So auth testing has its own Worker, at a hostname that does not move:

```bash
npm run build
npx wrangler deploy --name employsi-preview     # NOT prod; see below
```

https://employsi-preview.employsi.workers.dev

It is a **separate Worker** that happens to run the same code. It has no custom
domain (the generated `wrangler.json` carries no `routes`; employsi.com.au is
attached to the other Worker in the dashboard), and `robots.txt` already
disallows every non-apex host, so it is not indexed. Deploying to it cannot
touch employsi.com.au — but note that the safety comes entirely from `--name`.
**A bare `npx wrangler deploy` is still production**, even in a session where
every other command was aimed here.

It shares the production D1 and KV, deliberately: the point is to test against
real users, follows and vacancies. Sign-ins there write real rows to the live
`user` table.

Secrets are per-Worker, which is what makes role testing safe — `ADMIN_EMAILS`
here is independent of production, so flipping an address in and out to compare
the admin and end-user surfaces never changes who is an admin on the live site.

Its OAuth client IDs and `BETTER_AUTH_URL` are set; each provider also needs its
`*_CLIENT_SECRET` set here and its redirect URI registered:

```
https://employsi-preview.employsi.workers.dev/api/auth/callback/google
https://employsi-preview.employsi.workers.dev/api/auth/callback/linkedin
```

Until both halves of a provider exist, `authAvailable()` is false and the app
says "Sign-in is not configured on this deployment" rather than offering a
button that 500s. That message is the expected state of a half-set-up provider,
not a bug to chase.

**A SECRET IS NOT LIVE UNTIL ITS VERSION IS DEPLOYED**, and on this Worker
`wrangler secret put` does NOT deploy it. It uploads a new version and leaves
traffic where it was, so the secret store and the running code disagree:

```bash
npx wrangler secret list     --name employsi-preview   # shows the secret
npx wrangler versions list   --name employsi-preview   # "Add secret: X" — a version_upload
npx wrangler deployments list --name employsi-preview  # still the OLDER version at 100%
```

Measured 2026-08-12: both client secrets were set, `secret list` showed them,
and the app still answered "Sign-in is not configured on this deployment"
because 100% of traffic was on a version uploaded an hour earlier. Promote the
newest version and it works immediately:

```bash
npx wrangler versions deploy <newest-version-id>@100% --name employsi-preview --yes
```

This is worth knowing because the symptom is indistinguishable from a secret
that failed to save, and the natural next move — setting it again — produces
another undeployed version and the same result. Check `deployments list`, not
`secret list`. A secret-only version carries the code of whatever was live when
it was created, so promoting one does not change the build; confirm that anyway
by comparing the served asset hash, since a surprise code change here would be
silent.

Deploys, when actually asked for:

```bash
npx wrangler deploy                                          # the app worker -> PRODUCTION
npx wrangler deploy --config workers/jobs-cron/wrangler.jsonc # the scraper worker
```

Two independent deploys — doing one does not update the other. Record the version id
you are replacing before either: `wrangler deployments list` prints it, and it is the
only cheap way back.

**Both tokens must be in the environment, and the second one is easy to miss.**

- `CLOUDFLARE_API_TOKEN` — needs Workers Scripts:Edit to deploy.
- `VITE_MAPBOX_TOKEN` — a BUILD-time inline. `vite.config.ts` refuses to build
  without it, which is the guard working. Do not satisfy it with a placeholder to
  get a build out: the deploy succeeds and the map then fails to render for every
  visitor. If a build was made with a dummy value, throw it away and rebuild —
  `grep -rl "pk\.eyJ" .output/public/` should find the real token, and
  `grep -rl "build-check" .output/` should find nothing.

Do **not** pass `--noproxy '*'` to Cloudflare API calls in this sandbox; it breaks
them.

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

**A window over the archive is only as wide as the feeds covering it.** The single most
productive bug in this codebase: a daily series climbs because the ARCHIVE was filling out,
not because anyone was hiring, and the change figure over it is enormous and entirely false.
Measured instances — Mater's areas at +996% when SEEK picked the employer up mid-window; BHP's
top skill at +347.6% over 30 days as its ten feeds came online across three weeks; BHP's
analyst volume at −75% because "now" was a day still being collected and the comparison day
was not.

It has two ends and both bite:

- **The start.** A series can only begin once the feeds carrying this employer had arrived.
  `foldSkillRows` computes that (`feedStart`), and the areas take the later of it and their
  own feeds' arrival (`areaStart`).
- **The end.** A day is only complete once the feeds have reported it. Today never is, and
  yesterday often is not either — `coverageDay` in `analystFn` picks the last day that holds.

Both weigh feeds by share rather than waiting for every one, at 95%: `sourceStart` is the
oldest row a feed still holds, so a small fast-churn feed always looks like it just started,
and a strict rule lets three ads collapse a series to nothing. Both are asserted in the check
scripts. **Never compare two days measured different ways** — an exact-day count against a
`first_seen <= D AND last_seen >= D` reconstruction is mostly measuring the difference
between the two methods. And report the span actually drawn, never the one requested.

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
