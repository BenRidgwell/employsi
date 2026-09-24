# Talent flows — format and build

**Status (2026-09-24): the source-independent half is built, not deployed, and
holds no data.**

| Piece | File | State |
| --- | --- | --- |
| D1 tables | `workers/jobs-cron/migrations/0002_talent_flows.sql` | Written, **not applied** |
| Loader | `scripts/flows-to-d1.py` | Built; dry run by default; tested offline on the synthetic fixture only |
| Display rules | `src/employsi/lib/flows.ts` | Built; asserted by `scripts/check-flows.ts` in `skills-check.yml` |
| Server read | `src/employsi/lib/flowsFn.ts` | Built; returns null until tables exist and hold an import |
| Card section | `components/panels/TalentFlow.tsx`, Hiring tab | Built; renders nothing without data. Not seen rendered |
| Map arcs | — | Not started |
| **Source: Bright Data** (chosen) | `scripts/brightdata-talent-flows.py` + `talent_flows.positions_from_brightdata` | Built; tested end to end against a **fake** Bright Data MCP server only. Filter field names not yet confirmed against the live dataset |
| Source: LinkedIn sample (parked) | `scripts/collect-talent-flows.py` + `scripts/talent_flows.py` | Built; tested against a fake MCP server only. Parked: it needs a personal LinkedIn account |

### The Bright Data source

`brightdata-talent-flows.py` drives Bright Data's official MCP server
([`@brightdata/mcp`](https://github.com/brightdata/brightdata-mcp), pinned to
2.11.3, `GROUPS=social`) over stdio. It calls one tool, `search_dataset`,
against Bright Data's stored LinkedIn people-profiles dataset
(`gd_l1viktl72bvl7bjuj0`):

```json
{"operator": "and", "filters": [
  {"name": "current_company_company_id", "operator": "=", "value": "<slug>"},
  {"name": "country_code", "operator": "=", "value": "AU"}]}
```

Each hit is a whole stored profile with its work history, so finding people
and reading their histories is one step. No LinkedIn account is involved.

Facts it depends on (read 2026-09-24):

- **Record shape.** Measured on Bright Data's published sample record: each
  `experience` entry has `company`, `company_id` (the LinkedIn slug, so it
  lines up with the `li:` refs and `company_slugs`), `url`, `title`, and
  `start_date`/`end_date` as `"Feb 2014"`, `"2018"` or `"Present"`. An entry
  whose url is `/school/` is dropped. That sample is **one** profile, so any
  other shape is refused and counted, not guessed.
- **Cost.** The free tier is 5,000 requests a month. One `search_dataset` call
  is one request and returns at most 10 profiles. `--max-requests` (default
  50) caps a run. Set a spend cap in Bright Data's control panel as well.
- **Errors.** Any tool error stops the run (exit 3), with no retry. The
  real server passes Bright Data's message through, but an MCP server can
  mask it, and a quota error read as transient would be retried on a metered
  API. The `search_after` cursor is saved per seed, so the next run resumes.
- **The filter field names are unconfirmed.** `current_company_company_id` and
  `country_code` come from the published schema and sample, not the live
  dataset's metadata. `--fields` runs `list_dataset_fields` and says whether
  each is filterable. If an experience-level company field is listed, it can
  reach **former** employees (`--filter-field`). Until then a seed's "lost to"
  side only shows when the destination is also seeded.

What is kept: the MCP tool has no field selection, so each hit arrives
complete, with name, profile url and photo. The script reads `id` and
`experience` only, then drops the hit. It stores a salted hash of the id and
the moves in `~/.employsi/brightdata-talent-flows.sqlite`. `--inspect` prints
only the work-history entries. Only counts leave the machine.

```bash
pip install "mcp>=1.28,<3"                       # plus Node 18+ for npx
export BRIGHTDATA_API_TOKEN=...
python scripts/brightdata-talent-flows.py --fields             # 1 request
python scripts/brightdata-talent-flows.py --inspect bhp        # 1 request, stores nothing
python scripts/brightdata-talent-flows.py --seed bhp=bhp --max-requests 5
python scripts/brightdata-talent-flows.py --stats
python scripts/brightdata-talent-flows.py --export out/
python scripts/flows-to-d1.py out/                             # dry run; --write to load
```

### The LinkedIn-sample source (parked)

`collect-talent-flows.py` runs **on your machine**, driving
[`stickerdaniel/linkedin-mcp-server`](https://github.com/stickerdaniel/linkedin-mcp-server)
(pinned to 4.24.4) in your own signed-in LinkedIn session. For each seed
company it lists some current employees, reads each one's experience page, turns
the dated history into employer-to-employer moves, and keeps only those moves,
under a salted hash of the profile name, in `~/.employsi/talent-flows.sqlite`.
The page text, the name, the profile url and the job titles are dropped as soon
as the profile is parsed. `--export` writes this document's canonical files and
`flows-to-d1.py` loads them. Only counts ever leave the machine.

What it will and won't do:

- **It stops on the first sign of push-back.** A rate-limit section error, a
  checkpoint, a sign-in wall, or three failures in a row ends the run (exit 3).
  Nothing is retried. It uses no proxy and no second account, and it doesn't
  randomise its timing. By default it reads 40 profiles a run, 60s apart. That
  is a courtesy pace, not a measured safe limit.
- **Calibrate before collecting.** `--inspect <username>` prints one real
  profile's raw text beside what the parser made of it, and stores nothing. The
  parser rules come from LinkedIn's documented layout, not a captured page.
  `--stats` warns once more than 20% of profiles parse to nothing.
- **What the numbers mean.** They are moves among sampled profiles, not
  workforce totals (`count_kind = sampled`). The sample is whoever LinkedIn
  lists first on each company's People tab. A "lost to" flow is only seen when
  the destination is also a seed. The window ends 3 months before collection
  because profiles are updated late. That lag is an assumption, not a
  measurement. At ~40 profiles a run, most pairs stay under the 10-move minimum
  for a long time, and the card will say so rather than show them.
- **Risks the code can't remove.** LinkedIn's User Agreement prohibits
  automated access, and a restricted account is the usual result. The people
  read have not been asked, and the Privacy Act applies to collecting their
  information even briefly. Hashing and discarding reduce what is held. They
  don't settle that question.

```bash
pip install "mcp>=1.28,<3"
uvx mcp-server-linkedin@4.24.4 --login                 # sign in once, by hand
python scripts/collect-talent-flows.py --inspect <a-username>
python scripts/collect-talent-flows.py --seed bhp=bhp --seed wds=woodside-energy
python scripts/collect-talent-flows.py --stats
python scripts/collect-talent-flows.py --export out/
python scripts/flows-to-d1.py out/                     # dry run; --write to load
```

Changes from the first draft, found while building:

- `flows` carries `from_name`/`to_name`, so off-roster companies can be listed
  without a lookup, and a new `flow_sample` table holds per-company sample sizes
  for a sampled source (`count_kind = sampled`, `scope = sampled profiles`).
- Two vendor ids that resolve to one roster company are **merged before the
  minimum is applied**. The minimum applies to the company, not to however the
  vendor split it.
- Name matching refuses a name that belongs to more than one roster company.
  "Rio Tinto" is both `rio` and `london-rio`, so it goes to the unmatched
  report instead of being picked.

The rest of this document is the original plan. The open questions at the end
are still open.

## What the feature is

Company-to-company movement of people, shown as counts, from a **licensed**
source. Employsi never holds a record of an individual: a person-level vendor
file is aggregated in memory by the loader and only the counts reach D1.

Not in scope: scraping profiles, LinkedIn or otherwise. See the conversation
that produced this plan for why (discovery, volume, LinkedIn's user agreement,
the Privacy Act).

## The two sources this is designed against

They have different shapes, and the plan does not paper over that: each source
is loaded as itself and never merged with the other.

| | LinkedIn Talent Insights | Revelio Labs Transitions |
| --- | --- | --- |
| What you get | A **company report**: for one base company, the companies it hired from and lost people to | **One row per person per move**: `user_id`, `prev_rcid`, `new_rcid`, `prev_enddate`, `new_startdate`, seniority, role, country, estimated salary |
| Window | Trailing **12 months** as of the export date. Fixed | Monthly, history from 2008, updated weekly. Any window |
| Coverage of pairs | Only pairs touching the **base company**, and only its **top N** | Every pair in the file |
| What counts as a move | Company-to-company only when the **gap between positions is under 6 months**. So a base company's total departures exceed the sum of its "lost to" rows | Every observed transition |
| Bias correction | LinkedIn's own member base; none exposed | Sampling weights exist in Revelio's methodology (profiles over-represent white-collar roles). Whether the transitions file carries a weight column is **unconfirmed** |
| Recent months | Not documented | Under-reported (profiles update late); Revelio nowcasts recent flows |
| Export | CSV per report tab (also XLS/PDF) | Flat files (Inflows / Outflows) |
| Identity of companies | Display names | `rcid` (stable Revelio company id) plus a name |

Sources: [Talent flow tab](https://www.linkedin.com/help/talent-insights/answer/a186107),
[Talent Insights export](https://www.linkedin.com/help/talent-insights/answer/a191025),
[Revelio data dictionary](https://www.data-dictionary.reveliolabs.com/data.html),
[Revelio methodology](https://www.data-dictionary.reveliolabs.com/methodology.html).
None of these have been checked against a real export. The first real file
decides the adapter; the canonical format below should not need to move.

## 1. The canonical interchange format

What every adapter produces and the loader consumes. One CSV (or JSON Lines
with the same keys) per import. **Already aggregated** — this file never has a
person in it.

```
from_ref,from_name,to_ref,to_name,period_start,period_end,moves,count_kind
revelio:123456,BHP,revelio:654321,Rio Tinto,2026-01-01,2026-01-31,14,weighted
revelio:123456,BHP,revelio:777777,Fortescue,2026-01-01,2026-01-31,6,weighted
```

| Column | Meaning |
| --- | --- |
| `from_ref`, `to_ref` | The **vendor's** company identity, prefixed with the vendor: `revelio:<rcid>`, `lti:<name as exported>`. Never an Employsi id — matching is the loader's job, and keeping the vendor's id means a re-match never needs the file again |
| `from_name`, `to_name` | The vendor's display name, verbatim, for the unmatched report and for eyeballing |
| `period_start`, `period_end` | Inclusive ISO dates. A move is counted in the period it **started** at the new company (Revelio `new_startdate`). Talent Insights rows carry the 12-month window ending on the export date |
| `moves` | People who moved from → to in the period. A number, possibly non-integer when `count_kind` is `weighted` |
| `count_kind` | `observed` (people seen) · `weighted` (vendor's representation weights applied) · `nowcast` (vendor's estimate for months not yet reported). **Never mixed in one comparison** |

Plus a sidecar header describing the import as a whole (one per file):

```json
{
  "source": "revelio",
  "product": "Transitions",
  "delivered": "2026-10-01",
  "method": "company-to-company, any gap",
  "scope": "all pairs",
  "base_company_ref": null,
  "top_n": null,
  "filters": { "country": "Australia" },
  "notes": "free text: anything the vendor said about this delivery"
}
```

`scope` is `all pairs` (Revelio) or `base company` (Talent Insights, with
`base_company_ref` and `top_n` set). It is what lets the app say "top 25 shown
by source" instead of implying a list is complete.

### Adapters

- **`revelio`**: reads Inflows/Outflows, groups by `(prev_rcid, new_rcid,
  month of new_startdate)`, counts rows (and sums weights, if a weight column
  exists), and **discards `user_id` before anything is written**. The
  per-person file stays wherever it was delivered. Employsi never stores it.
- **`lti`**: reads one Talent flow tab CSV per base company. "Hired from X"
  becomes an `X → base` row, "lost to Y" becomes a `base → Y` row, and every row
  is `observed` over the report's 12 months.

## 2. D1 schema

Two tables, a new migration in `workers/jobs-cron/migrations/`, in the same
database as `jobs` (`employsi-jobs-archive`).

```sql
-- One row per file loaded. Everything about HOW the numbers were measured
-- lives here, so no flow row can be read without its method.
CREATE TABLE IF NOT EXISTS flow_import (
  import_id     TEXT PRIMARY KEY,  -- source|delivered|sha256 of the file, first 12
  source        TEXT NOT NULL,     -- revelio | lti
  product       TEXT,
  delivered     TEXT NOT NULL,     -- YYYY-MM-DD, the vendor's date
  loaded_at     TEXT NOT NULL,
  method        TEXT NOT NULL,     -- e.g. "company-to-company, gap < 6 months"
  scope         TEXT NOT NULL,     -- all pairs | base company
  base_ref      TEXT,              -- set when scope = base company
  top_n         INTEGER,           -- set when the vendor truncated the list
  filters       TEXT,              -- JSON, as delivered
  notes         TEXT,
  superseded_by TEXT               -- a newer delivery of the same scope replaces this one
);

-- The counts. company ids are NULL when the vendor company is not on the
-- roster; those rows still count toward "moves to companies outside the map".
CREATE TABLE IF NOT EXISTS flows (
  import_id     TEXT NOT NULL REFERENCES flow_import(import_id),
  from_ref      TEXT NOT NULL,
  to_ref        TEXT NOT NULL,
  from_id       TEXT,              -- app company id (same id as jobs.company_id)
  to_id         TEXT,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  moves         REAL NOT NULL,
  count_kind    TEXT NOT NULL,     -- observed | weighted | nowcast
  PRIMARY KEY (import_id, from_ref, to_ref, period_start, count_kind)
);
CREATE INDEX IF NOT EXISTS idx_flows_from ON flows (from_id);
CREATE INDEX IF NOT EXISTS idx_flows_to   ON flows (to_id);

-- Vendor company -> app company. Kept separate so a matching fix is one row,
-- not a reload.
CREATE TABLE IF NOT EXISTS flow_company_map (
  ref        TEXT PRIMARY KEY,     -- revelio:<rcid> | lti:<name>
  company_id TEXT,                 -- NULL = confirmed NOT on the roster
  method     TEXT NOT NULL,        -- exact | linkedin-slug | manual
  checked_at TEXT NOT NULL
);
```

Things deliberately **not** in the schema: names of people, `user_id`, per-person
dates, roles or salaries. If a later feature wants moves by role or seniority,
it becomes another grouping column on `flows`, still aggregated, and the
small-number rule below applies to each cell.

## 3. Loader — `scripts/flows-to-d1.py`

Same shape as the other `*-to-d1.py` scripts: runs locally or in Actions,
writes through the D1 HTTP API, exits non-zero on a degraded run.

1. Read the vendor file with the adapter, producing the canonical format.
   `--emit-canonical out.csv` stops here so a delivery can be inspected first.
2. Match every `ref` to an app company id: `flow_company_map` first, then an
   exact normalised-name match against the roster, then the confirmed LinkedIn
   slugs in `company_slugs`. **No fuzzy match writes an id.** Candidates are
   printed for a human to confirm into `flow_company_map` with `method=manual`.
3. Print the unmatched report: every vendor company with no id, sorted by
   moves, so the big misses are at the top.
4. Write `flow_import` then `flows`. `--dry-run` prints the rows and writes
   nothing, and is the default until the first delivery has been reviewed.

## 4. What the app reads — `src/employsi/lib/flowsFn.ts`

```ts
type FlowSide = {
  companyId: string | null; // null = off-roster, shown by name only
  name: string;
  moves: number;
};

type CompanyFlows = {
  companyId: string;
  source: "revelio" | "lti";
  method: string;          // shown verbatim under the numbers
  countKind: "observed" | "weighted";
  period: { start: string; end: string }; // the span actually drawn
  gainedFrom: FlowSide[];  // sorted by moves, suppressed rows removed
  lostTo: FlowSide[];
  suppressed: { pairs: number; moves: number }; // rolled up, never itemised
  truncatedBySource: number | null;             // top_n when the vendor capped it
};

// Map layer: arcs between two roster companies only.
type FlowArc = {
  fromId: string;
  toId: string;
  moves: number;     // from -> to
  reverse: number;   // to -> from, same source and period
};
```

One source per response. If both sources cover a company, the card shows a
source switch, not a sum.

## 5. What a user sees

- **Company card**: a "Talent flow" section listing the top companies it gained
  people from and lost people to, then "N moves to or from companies not on the
  map" and "M smaller flows not shown". Under it, the period, the source and the
  method line.
- **Map arcs**: drawn only between two roster companies. Width by moves,
  direction by a gradient or animated dash. Clicking an arc shows both
  directions and the net.
- **Where on the four layers**: see open question 3.
- **Before any real import is loaded**: nothing. The section and the layer are
  not rendered. No placeholder arcs, no "coming soon" numbers.

## 6. The rules, and what `scripts/check-flows.ts` asserts

Each one is a bug shape this repo has hit before on the job archive.

1. **Small numbers are suppressed.** A pair under `FLOW_MIN_MOVES` (proposed
   10) is never returned by `flowsFn`. It is rolled into `suppressed`. It keeps
   a thin flow from being read as a trend and from pointing at one person.
2. **No mixing.** A response never combines two `import_id`s with different
   `source`, `method` or `count_kind`. A change figure (for example "+40% on
   last year") exists only between two periods from the **same source,
   method and count kind**. This is the rule from CLAUDE.md about never
   comparing two days measured different ways.
3. **The recent end is incomplete.** Revelio's latest months are
   under-reported. A window ends at the last complete month the delivery
   supports, like `coverageDay` in `analystFn`. Nowcast rows are only shown
   labelled as estimates, never summed with observed rows.
4. **The start is only as early as the coverage.** A company whose vendor
   coverage begins mid-window is not given a series from before it.
   This is the `feedStart` idea applied to vendor data.
5. **Truncation is visible.** When `top_n` is set, the card says so, and
   nothing computes a total from a truncated list.
6. **Talent Insights' two counts don't reconcile, and that is not a bug.**
   Its "lost to" rows only count moves with a gap under 6 months. The
   departures total and the sum of rows are never shown as if they should
   match.
7. **Report the period drawn, never the one asked for.**

The check script runs against a small synthetic fixture checked into
`scripts/fixtures/`, clearly labelled synthetic, and never loaded into D1.

## 7. Build order, once this is agreed

1. Migration and loader with `--dry-run` and `--emit-canonical`, tested on the
   synthetic fixture. Nothing is written to D1.
2. `flowsFn.ts` and `check-flows.ts`, wired into `skills-check.yml`.
3. Company card section, behind "renders nothing without data".
4. Map arcs.
5. First real delivery: the adapter is adjusted to the real columns, then a
   `--dry-run` and the unmatched report are reviewed, and only then is D1
   written.

Nothing is deployed at any step until the user asks for it. The preview Worker
shares production D1, so loading a real import makes it visible on the preview
and on production at the same time. That is a reason to keep step 5 last.

## Open questions — these change the design

1. **Which vendor first?** Talent Insights is cheaper to trial and
   LinkedIn-native, but only gives base-company top-N lists over a fixed 12
   months. Revelio gives every pair and monthly history, and the loader has to
   handle a person-level file (aggregated and then discarded). The schema
   covers both. The adapter written first is the one for the file in hand.
2. **Threshold.** 10 moves is a common disclosure floor. Is it the right one
   for a public site, and should it be higher for pairs outside Australia,
   where the roster is thinner?
3. **Which layers show arcs?** Company pins exist on the local layer, but most
   interesting flows cross cities (Perth miners to Brisbane miners). Options:
   (a) local only, within a city; (b) domestic, with arcs between
   **cities** as the sum of their companies' flows, and company arcs on the
   local layer; (c) global, with country-to-country arcs. (b) is the proposal.
4. **Off-roster companies.** Should "gained from" list names of companies
   Employsi doesn't map (without a link), or only roll them into one "other"
   line? Listing them is more informative. Rolling them up keeps the card to
   companies the user can click.
5. **Breakdowns.** By role family or seniority (Revelio has both) would make
   this far more useful to HR buyers, and each breakdown cell falls under the
   threshold more often. In v1 or later?
6. **Refresh cadence.** Talent Insights is a manual export, and Revelio
   deliveries are weekly. Is a load a manual command, or a scheduled Action
   reading from a bucket the vendor delivers to?
