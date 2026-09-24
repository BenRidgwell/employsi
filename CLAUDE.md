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
npm run typecheck                 # BOTH trees — see below; `:app` and `:workers` run one each
```

**`npm run typecheck` means two compilers, and for a long time it meant one.** The root
tsconfig includes only `src/**`, so nothing typechecked `workers/` at all: on 2026-09-22
the app side was clean while the scraper Worker carried **54 errors**. One of them was
live in production. `SOURCE_TAG` in `careerSites.ts` is `Record<Platform, string>`, two
platforms were added without their tags, and tsc had the error ready (TS2739, naming both)
— pointed at nothing. The rows went to D1 as `portal-undefined`.

`workers/jobs-cron/tsconfig.json` is separate rather than folded into the root include
because the two environments disagree about what globals exist — the app is a DOM program
typed against `vite/client`, the Worker has `KVNamespace`, `D1Database`,
`ScheduledController` and `ExecutionContext` ambient from `@cloudflare/workers-types` and
no `document`. One `lib` cannot describe both. Same `strict: true` on both sides, because
the side that writes to the archive is the side where a silent wrong value costs most.

Most of those 54 were one bug shape: `JSON.parse` results read as `any`. `src/employsi/lib/
json.ts` (`asRecord` / `asRecords` / `str` / `num`) is the fix — coerce at the boundary,
then the field name is checked. `str()` trims, which is safe against `job_key` drift only
because `normTitle` already trims; check that before extending the pattern somewhere new.

`.github/workflows/workers-typecheck.yml` runs both. It is path-filtered, so do **not**
make it a required status check (see the note in `portal-ticks-check.yml` for why a
path-filtered required check leaves PRs pending forever).

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

**`scripts/check-company-live.ts` is deliberately NOT in that list, and must not be
added to it.** It asks whether each roster company still EXISTS — every other check
here verifies that a company is *wired* correctly, none can tell whether it is still a
company. Marathon Oil sat on the Houston roster for two years after ConocoPhillips
bought it, because a dead employer just stops appearing in the feeds, which looks
exactly like one that stopped advertising. It is network-bound by nature: it reads a
few hundred third-party sites, so its result depends on their WAFs and this machine's
exit IP. It exits 0 on findings, reports a blocked host as inconclusive rather than as
a failure, and is meant to be run by hand or on a schedule that files a report.

```bash
bun run scripts/check-company-live.ts --country au          # or --city, --ids, --limit
bun run scripts/check-company-live.ts --city houston --logos  # + the badge-collision pass
```

It reports four things worth acting on: a domain that redirects to a **different**
registrable domain (what an acquisition looks like from outside), a page that names
**another** roster company, a domain that is **for sale** — the failure that put a red
"SALE" tag on Occidental Petroleum's card and a broker's logo on eighteen others — and
a 404/410. Everything else is `blocked` or `unsure` and is not a fix list.

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
| `employsi` | **The Workers Builds CI target since 2026-09-21** — every push to `main` lands here. Was an unrecorded deployment last built 2026-08-06 (version `966ce664`); the first CI build replaced it with `c8adc711`. Still do not deploy over it by hand without asking |

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

**Production was built from `claude/waitlist-page-updates-053rss`**, which carries the
D1-backed landing stats (`src/employsi/lib/landingStatsFn.ts`), the domain routing in
`src/server.ts` and the un-clipped hero graphic. A deploy from a tree missing those
silently reverts them: the ticker falls back to hardcoded placeholders and the hero
clips. That happened on 2026-08-10 and was recovered with `wrangler rollback`.

**THAT BRANCH SHARES NO HISTORY WITH `main`** — different root commits, no merge base.
Measured 2026-09-21. Two consequences, and the second one bit:

- **Do not try to merge it.** `git merge` refuses outright, and
  `--allow-unrelated-histories` would drag 771 commits of a disjoint tree across the
  99 files that differ — on most of which `main` is NEWER (it carries the Inter
  webfont swap the branch predates). The merge would revert `main`, not protect prod.
- **The old ancestry check was broken**, and it read as a real blocker rather than as
  a broken test. It was

      git merge-base --is-ancestor origin/claude/waitlist-page-updates-053rss HEAD

  which on disjoint histories can NEVER pass, so it printed "WOULD REVERT PRODUCTION"
  no matter what `main` contained — including when `main` contained every one of the
  files it was protecting, byte for byte.

**Check the CONTENT, not the ancestry.** Measured 2026-09-21: all three
production-critical files are identical on `main`, as is every file touched by the
five commits the ancestry check flagged as missing. The only file absent from `main`
is `src/employsi/data/privateCompanyFacts.ts`, which nothing in `main` imports.

```bash
git fetch origin claude/waitlist-page-updates-053rss
for f in src/employsi/lib/landingStatsFn.ts src/server.ts src/routes/index.tsx \
         public/waitlist-preview.html; do
  a=$(git rev-parse HEAD:$f 2>/dev/null)
  b=$(git rev-parse origin/claude/waitlist-page-updates-053rss:$f 2>/dev/null)
  [ -n "$a" ] && [ "$a" = "$b" ] && echo "same  $f" || echo "DIFFERS/MISSING  $f"
done
```

A `DIFFERS` is not automatically a revert — `main` may simply be ahead, as it is on the
font — so read the diff before deciding. What must never happen is deploying a tree
where those files are OLDER than production's.

`main` was deployed to production on 2026-09-21 (version `2ac6eba8`, replacing
`52e5abaa`) and verified after: apex 200 serving the waitlist, `/app` still 302ing off
the apex, the app's own title on workers.dev, and the landing ticker rendering real
figures (37,185 / 1,121) rather than placeholders.

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

### Cloudflare Workers Builds — the CI deploy, and why it kept failing

There is a **Workers Builds** pipeline connected to this repo, configured entirely
dashboard-side (Workers & Pages -> the Worker -> Settings -> Build). Nothing in the
source tree references it, which is why it is easy to forget it exists at all.

**THE CONNECTION LIVES ON THE WORKER NAMED `employsi`, WHICH IS NOT THE WORKER IT
DEPLOYS TO.** Confirmed 2026-09-21. Three similarly-named Workers are in play and
the build sits on the one you would not guess:

| | |
| --- | --- |
| Build settings + build log | **`employsi`** — the connected Worker |
| Where the deploy lands | **`employsi`** too — the connection overrides `--name`, see below |
| NOT where it lands | `employsi-preview`, despite the `--name` in the deploy script |
| Never touched by CI | `benridgwell-globe-gazer-hr` — production |

So **CI currently publishes to `employsi`**, and that is the arrangement as of
2026-09-21 — deliberately left alone rather than half-moved at the end of a long
night. `employsi-preview` remains the target for MANUAL preview deploys, where
`--name` works normally because there is no connection to override it.

**This cost an evening.** Every build field was edited on `employsi-preview` ->
Settings -> Build, which is a real page with real fields that saves happily and
has nothing to do with the running pipeline. The builds kept going out with the
old values, which read as settings silently failing to persist — a much more
alarming problem than the real one. **If a build field appears not to stick,
check which Worker's settings page you are on before anything else.**

It was connected to production until 2026-09-21. Moving it off means a
misconfigured build field can no longer be the thing that publishes the live site.

**BUT THE ATTACHMENT IS NOT WHAT MAKES IT SAFE, AND IT IS TEMPTING TO THINK IT
IS.** Wrangler publishes to the `name` in the resolved config — `.output/server/
wrangler.json`, which inherits `benridgwell-globe-gazer-hr` from the root
`wrangler.jsonc` — no matter which Worker the build is attached to. A bare
`npx wrangler deploy` in that deploy field would publish PRODUCTION from a build
that lives under the preview Worker, and the dashboard would show a green build
on `employsi-preview` while employsi.com.au changed underneath you. The
`--name employsi-preview` in `deploy:preview` is still the only thing choosing
the target. The attachment limits the blast radius of the *connection*; the flag
limits the blast radius of the *deploy*.

**EVERYTHING IN THE PARAGRAPH ABOVE IS WRONG. THE CONNECTED WORKER WINS.**
It is kept because it is the conclusion anyone reasoning from how wrangler
behaves in a shell will reach, and it needs contradicting with the measurement
rather than quietly deleting. Workers Builds overrides the deploy target with
the Worker the build is attached to, whatever the deploy command asks for.
Measured 2026-09-21 on the first green build:

| | |
| --- | --- |
| Deploy command | `npm run deploy:preview` -> `… npx wrangler deploy --name employsi-preview` |
| `wrangler.jsonc` name | `benridgwell-globe-gazer-hr`, unchanged on `main` |
| Connected Worker | `employsi` |
| **Where it landed** | **`employsi`** — version `c8adc711`, replacing `966ce664` of 2026-08-06 |

`employsi-preview` did not move. Production did not move. The flag was ignored.

So in Workers Builds **the connection IS the target**, and three things follow:

- The blast radius is set by which Worker the repo is connected to and by
  nothing else. No deploy command can widen it, and no `--name` can redirect it.
- Production is unreachable from CI while the connection is not on
  `benridgwell-globe-gazer-hr`. That is a stronger guarantee than the one this
  file used to claim — but it comes from the connection, not from the repo, so
  it cannot be verified by reading the source tree.
- **To change where CI deploys, move the connection.** Reconnect the repo on the
  Worker you want written. Editing `--name` does nothing at all.

**THE DASHBOARD WILL ASK YOU TO BREAK THIS. DISMISS IT.** Because the repo's
`name` and the connected Worker disagree, Workers Builds shows a banner offering
to "keep settings consistent" — and on Wrangler v3.109.0+ to open a PR doing it:

    // wrangler.jsonc
    "name": "employsi",

Taking it would point every bare `npx wrangler deploy` in this repo at the
`employsi` Worker. The documented production deploy would then succeed, print
green, and leave employsi.com.au untouched, while writing over the `employsi`
Worker that this file says not to deploy over without asking. The mismatch the
banner wants to remove is the thing keeping CI off the live site. Close it with
the ✕, and reject the PR if one is opened.

It also does not fix a failing build: the `Missing entry-point` error is a
missing build step, and renaming a Worker does not create `.output/`.

**A build step must run before the deploy, and the failure when it doesn't looks
like a config error in this repo.** Measured 2026-09-21: the pipeline ran
`bun install --frozen-lockfile` and then went straight to `npx wrangler deploy`,
which failed with

    ✘ [ERROR] Missing entry-point to Worker script or to assets directory

and suggested adding `main` or `assets` to `wrangler.jsonc`. **Do not add them.**
The root `wrangler.jsonc` deliberately carries only `name` + bindings; `main` and
`assets` live in the nitro-generated `.output/server/wrangler.json`, which a bare
`wrangler deploy` finds only through the redirect the build also writes:

```
.wrangler/deploy/config.json -> {"configPath":"../../.output/server/wrangler.json"}
```

Both paths are gitignored, so with no build step neither exists, wrangler falls
back to the root config, and the error is a correct description of the file it was
left with. It works locally purely because a previous `npm run build` left
`.output/` behind. **The error is about a missing BUILD, not a missing key.**

The settings that make it work, under **Workers & Pages -> `employsi` ->
Settings -> Build** — the connected Worker, not the one being deployed to:

| Field | Value |
| --- | --- |
| Build command | **leave EMPTY** |
| Deploy command | `npm run deploy:preview` |
| Build variable | `VITE_MAPBOX_TOKEN` — see below |

**`deploy:preview` BUILDS ITS OWN OUTPUT** — it is `npm run build && npx wrangler
deploy --name employsi-preview`, one script, so the pipeline needs exactly one
field set and cannot be half-configured. That is deliberate. The build-command
field was measured failing to take effect twice on 2026-09-21 — the first CI run
and a manual retry both went straight from `bun install` to the deploy command
and died on the same missing entry point. Whatever the reason, a repo that only
needs one field set cannot lose to it.

It also closes the dangerous half-state. With the build and deploy commands in
separate fields, "build set + deploy still a bare `npx wrangler deploy`" publishes
PRODUCTION; that combination cannot be reached when one script does both.

If the build-command field is ever set to `npm run build` as well, nothing breaks
— vite just runs twice and the build takes a minute longer. Leave it empty.

**Verify where a build landed, because a green build says nothing about which
Worker it wrote** — that is exactly how the `--name` assumption survived so long.
Check the connected Worker gained a version and that production did not:

```bash
npx wrangler versions list --name employsi | head   # a NEW version, from the build
npx wrangler versions list | head                   # production UNCHANGED
```

Read **versions**, not the script's `modified_on`. Attaching the build connection
bumped `employsi-preview`'s `modified_on` to 05:03:24 on 2026-09-21 with no
version and no deployment behind it, which reads exactly like a successful build.
A version id cannot be produced by a settings change.

The `npx` in `deploy:preview` is load-bearing: **wrangler is not a dependency of
this repo** and there is no `node_modules/.bin/wrangler`, so a bare `wrangler …`
inside an npm script dies with `wrangler: not found` in CI even though it works in
a shell where it has been npx'd before. Every wrangler invocation here goes through
`npx`.

`VITE_MAPBOX_TOKEN` must be a **build** variable, not a Worker secret: it is
inlined by vite and a secret is not visible to the build. `vite.config.ts` throws
without it, so the second CI failure after fixing the first is this one.

**`deploy:preview` IS NAMED FOR WHAT IT DOES LOCALLY, NOT IN CI.** Run from a
shell it deploys to `employsi-preview`, as the name says. Run by Workers Builds
it deploys to the connected Worker — today `employsi` — because the connection
overrides the flag. Same script, two targets, decided by where it runs.

What the script still buys, now that `--name` is known not to steer CI: the build
step is inside it, so the pipeline needs one dashboard field rather than two and
cannot be half-configured. There is no `deploy:prod` script; production deploys
stay typed out by hand, and that is the point.

**`Workers Builds: employsi` IS RED ON EVERY FEATURE BRANCH AND GREEN ON EVERY
`main` COMMIT.** It is a required-looking check on every PR, it fails there, and
it is not the PR's fault. Measured 2026-09-21 across fourteen commits: every
branch head red, every `main` commit green, with no exception since the pipeline
settled at `73d43b4`.

The proof is a pair of commits rather than a pattern. `b2f84eb` (branch, RED) and
`490f512` (its merge on `main`, GREEN) resolve to the **same tree**,
`14ab9555…` — byte-identical content, opposite outcomes. Whatever the build
dislikes, it cannot be in the tree, so it cannot be in any diff.

```bash
git rev-parse b2f84eb^{tree} 490f512^{tree}   # identical
```

So do not go looking for it in the source, do not "fix" it with another push, and
do not hold a PR on it. Read the checks that DO read the diff — `roster wiring`
and `portal scheduling` — and merge. The cause was recorded here as
dashboard-side and unverifiable without Cloudflare API credentials; it has since
been read straight off a build log, and the next paragraph has it.

**AND HERE IS WHY THE BRANCH BUILDS FAIL** — measured 2026-09-21, and it turns
what was an unexplained pattern above into a settled one. A branch build's log
says:

    Executing user deploy command: npx wrangler deploy

That is the BARE command, not the configured `npm run deploy:preview`, and no
build command runs before it. So `.output/` and the `.wrangler/deploy/config.json`
redirect never exist, wrangler falls back to the root `wrangler.jsonc` — which
carries only `name` + bindings — and dies with

    ✘ [ERROR] Missing entry-point to Worker script or to assets directory

every single time. **The configured Build fields apply to the production branch
and a branch build runs defaults instead.** Two builds a minute apart on
2026-09-21 show it from both sides:

| commit | branch | build | deploy command | result |
| --- | --- | --- | --- | --- |
| `3224175` | `main` | `47318a7f` | `npm run deploy:preview` | 12:38:18 SUCCESS |
| `aa84412` | feature | `8d9a777d` | `npx wrangler deploy` | 12:39:36 FAILURE |

**SO A BRANCH BUILD'S LOG IS NOT EVIDENCE THAT THE SETTINGS CHANGED.** It reads
exactly like the field has been reset — this file briefly claimed precisely that,
from this log, and was wrong. Before concluding anything about the dashboard
fields from a red build, check which BRANCH it was for.

**AND IT IS STILL WORTH KNOWING, because the failure is one setting away from
being dangerous.** A bare `npx wrangler deploy` that DID find a build would
resolve to a config named `benridgwell-globe-gazer-hr`. The error message even
suggests the change that would get it there — adding `main`/`assets` to
`wrangler.jsonc` — and adding a build command would do it too. Both are refused
above, and this is the second reason why. Whether the connection would still
override that target is an inference from one measurement, on the one question
this file has already been wrong about once and kept the wrong version on
purpose. Not a thing to bet the live site on.

Nothing in the repo needs changing, and neither do the dashboard fields on
`employsi`: `package.json` still carries `deploy:preview` as
`npm run build && npx wrangler deploy --name employsi-preview`, and `main`'s own
builds succeed.

**NONE OF THIS AFFECTS THE PREVIEW.** `.github/workflows/deploy-preview.yml` is
a separate pipeline on GitHub Actions, where `--name` is honoured, and it
deployed employsi-preview successfully at 12:37 the same day (version
`1e83de7c`), verified afterwards: `/app` served the app's title, production's
version ids were byte-identical before and after.

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

**A scheduled handler gets 15 minutes only for work it AWAITS.** Work handed to
`ctx.waitUntil` gets 30 s after the handler returns (Workers limits page, read
2026-09-24), and every scraper branch returns straight away with its work in
`waitUntil` — so each has 30 s, not 15 min. That fits the shard's measured
history ("waitUntil() tasks did not complete" at 25 and 45 per run, SHARD = 17
the size that finishes). The career-pathways tick (`52 23 * * *`) is the one
branch that awaits, because its 90-day read took 28 s from a local run. It also
has `/run-careerpaths?token=…&dry=1`, which builds and reports without writing.

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
`last_seen >= date('now','-1 day')`, and taken-down ads age out on their own.

**IT DEDUPES ACROSS RUNS, NOT ACROSS BOARDS, and this file said the opposite until
2026-09-24.** `source` is the FIRST field of the key, so the same role on SEEK and on
Adzuna is two keys and two rows, and every count over the table is a `COUNT(*)` over
rows. `jobKey` in `jobArchive.ts` says what it does in one line — "a stable key so the
same ad from the same source dedupes across runs" — and the sentence here claiming a
role on two boards collapses to one row was simply wrong. It had been copied into the
analyst's own "why?" explanation before it was caught, which is what a wrong line in
this file costs: a user-facing claim about method that has the method backwards.

So a volume figure OVER-COUNTS a role advertised on several boards, by however many
boards carry it. That is a real limit of every count the product shows, it is stated in
`LIMITS` in `analystChat.ts` where a user can reach it, and it is why comparisons
between two places are sounder than a raw level — the over-count is roughly consistent
between them.

**Two rows that differ only because a parser bug dropped the location are two different
keys** — a parser fix can therefore double-count until the stale variants age out.

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
