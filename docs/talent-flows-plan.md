# Talent flows — format and build

**Status (2026-09-25): built; on the preview Worker, not production. Production D1
holds one live import** (`brightdata|2026-09-25|e4a23482ff8b`: two seeds, BHP
9,696 and Fortescue 5,568 usable profiles, 5,775 pairs, 8,045 moves over
2020-11..2025-10; each earlier load is marked superseded). Nothing shows it yet: the reader
(`flowsFn.ts`, `TalentFlow.tsx`) is on this branch only, not on `main`, and
`deploy-preview.yml` is manual. The rows go live on whichever Worker is next
deployed from a tree that has the reader, preview included (it shares
production D1).

| Piece | File | State |
| --- | --- | --- |
| D1 tables | `workers/jobs-cron/migrations/0002_talent_flows.sql` | **Applied to production D1 2026-09-25** (`wrangler d1 execute --remote --file`) |
| Loader | `scripts/flows-to-d1.py` | Built; dry run by default. **First real load 2026-09-25**: 103 of 1,064 companies matched (68 by LinkedIn slug, 34 exact name, 1 seed), 248 of 1,484 moves with both ends on the roster; D1 totals checked against the file. Unmatched include Thiess, Programmed, Mader Group, OZ Minerals: not on the roster, or needing a manual `flow_company_map` row |
| Display rules | `src/employsi/lib/flows.ts` | Built; asserted by `scripts/check-flows.ts` in `skills-check.yml` |
| Server read | `src/employsi/lib/flowsFn.ts` | Built; returns null until tables exist and hold an import |
| Card section | `components/panels/TalentFlow.tsx`, Hiring tab | Built; renders nothing without data. Not seen rendered |
| Map arcs | — | Not started |
| **Source: Bright Data** (chosen) | `scripts/brightdata-talent-flows.py` + `talent_flows.positions_from_brightdata` | Built; tested end to end against a **fake** Bright Data MCP server. Filters confirmed live 2026-09-24. **7 of 10 real profiles parse to nothing** — see below |
| Collection state | `workers/jobs-cron/migrations/0003_talent_flows_collect.sql` | **Applied to production D1 2026-09-25.** Holds 15,640 BHP profiles (of 21,359) and all 7,928 Fortescue profiles. Counts by month plus a bare list of hashed ids; no person's name, url, title or history |
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
  **WHETHER `search_dataset` IS INSIDE THAT FREE TIER IS UNVERIFIED, and the
  code says it probably is not.** Read 2026-09-25 in `@brightdata/mcp`
  2.11.3's `server.js`: the free tier's tools (`pro_mode_tools`) are
  `search_engine`, `scrape_as_markdown`, their batch forms and `discover`,
  and its 5,000-request message is tied to the `mcp_unlocker` zone.
  `search_dataset` is not among them. It is enabled only through
  `GROUPS=social`, and it calls `api.brightdata.com/datasets/search/<id>`,
  the Dataset API, which Bright Data sells per record (published LinkedIn
  dataset price $250 per 100K, i.e. $2.50 per 1,000). Records returned so
  far: ~15,720 (about 14,050 on 2026-09-25 alone), so between $0 and roughly
  $39 at that rate. Neither end is measured: the API token cannot read the
  balance (`customer/balance` answers "Your API key lacks the required
  permissions"). Check Bright Data's control panel under Billing before
  collecting more; the scheduled finishing run was paused for it.
- **Errors.** Any tool error stops the run (exit 3), with no retry. The
  real server passes Bright Data's message through, but an MCP server can
  mask it, and a quota error read as transient would be retried on a metered
  API. The `search_after` cursor is saved per seed, so the next run resumes.
- **The filters work, measured live 2026-09-24.** `list_dataset_fields`
  lists both `current_company_company_id` and `country_code` (text), and a
  `search_dataset` on `bhp` + `AU` returned `total_hits: 21360`.
- **Former employees cannot be reached.** The only experience fields
  listed are the arrays `experience` and `volunteer_experience`; no
  sub-field is advertised. Filtering on `experience.company_id` was tried
  once and refused: `HTTP 500: unsupported filters: experience.company_id`.
  So a seed's "lost to" side only shows when the destination is also seeded.
- **Most profiles have no dates at all.** `--inspect bhp --n 10` (one
  request, 10 profiles): 7 profiles had a single `experience` entry that
  `positions_from_brightdata` refused as `no_start_date`, so they parsed to
  nothing. The other 3 parsed into 10 positions and 5 moves, and their
  entries matched the published sample's shape. A second run (the default
  sort returns the same 10) printed the refused entries' fields: they carry
  `company`, `company_id`, `company_logo_url`, `description_html`, `title`,
  `url` and **no `start_date` or `end_date` key**, and no `location`. So the
  data is missing and the parser is right to refuse them: no date is hiding
  under another name. One such entry also appeared inside a dated history,
  as an undated duplicate of an employer the same profile lists with dates,
  and was dropped harmlessly. A name-only entry (no `url`, no `company_id`)
  parses, and is matched by name.
  On this sample ~30% of profiles are usable, far past the 20% empty rate
  at which `--stats` warns, so expect that warning on every run and read
  the per-profile cost as roughly 3x the plan's assumption. Ten profiles in
  one sort order is a small sample; `--stats` after the first real run is
  the better measure.
- **First collection, 2026-09-24: `--seed bhp=bhp --max-requests 5`.**
  50 profiles (of 21,360), 27 gave nothing: 25 had an undated entry as
  above, 13 entries in 5 profiles had no company name (`no_employer`; shape
  not yet seen, and `--inspect` only reaches the first 10 in sort order),
  and 2 had no experience at all. The 23 that parsed gave 32 moves across
  31 employer pairs, at most 2 moves per pair. 15 moves were into BHP and 1
  out of it, as expected when seeding by current employer. Moves run from
  2005 to 2025, and only 4 fall in the default 24-month export window. So
  one seed gives almost nothing inside the window: a pair needs 10 moves
  there to be shown, and at this rate that means thousands of profiles per
  seed, not hundreds.
- **Second collection, 2026-09-25: 100 requests, 970 BHP profiles.**
  473 usable (49%; refusals: 585 `no_start_date`, 182 `no_employer`,
  33 `school`). 788 moves in all; exported with `--window-months 60`
  (2021-07 to 2026-06): 262 moves over 234 pairs, 153 of them into BHP
  from 126 employers. **No pair reaches the 10-move minimum.** Rio Tinto →
  BHP has 8, then Bunnings 5, OZ Minerals 4, Thiess 4, Mader Group 3,
  Monadelphous 3; 114 of the 126 sources have 1. That is 970 of 21,358
  profiles (4.5%). Scaling linearly to the full seed (~2,100 requests),
  about the top 20 sources would clear 10 over 60 months. That is an
  extrapolation from a sample in Bright Data's default order, not a
  measurement. The other 109 moves are earlier moves between non-seed
  employers in the same histories.
- **A saved cursor does not survive a dataset refresh.** On 2026-09-25
  the cursor saved the day before failed twice (`HTTP 500: Response
  Error`, once after 30 s, once in 207 ms) while a fresh search worked,
  and `total_hits` had moved from 21,360 to 21,358. `--restart` drops a
  seed's cursor and reads from the top. Profiles already counted are
  skipped by key: the 50 from the day before came back in the same order
  and were skipped, so a restart costs only the requests spent re-reading.
  Read a large seed in one run where possible.
- **Rate limit.** On 2026-09-25 Bright Data accepted 164 `search_dataset`
  requests between 00:41 and 00:55 UTC, then answered `HTTP 429: Too Many
  Requests`. The pace was the same throughout (~24 a minute), so the cap
  is a count per window, not a burst limit. The window is not documented;
  the MCP server's own `RATE_LIMIT` is unset, so the 429 is Bright Data's.
- **Third collection, 2026-09-25 02:02–02:25 UTC: 557 requests, 5,560
  profiles**, resumed on a new machine from `--pull-d1` (1,600 keys + cursor).
  The cursor, saved at ~00:55, was still good: no `--restart`, no repeats.
  The first attempt crashed on its first profile: `--sync-d1` adds a
  `synced` column to `people` by migration, and the collect path's
  positional insert then supplied 7 values for 8 columns. One request was
  spent and nothing written; the insert now names its columns.
  Totals, all 7,160 BHP profiles (33.5% of 21,358): 4,169 usable (58%).
  Exported with `--window-months 60` (2021-07 to 2026-06): 1,544 moves over
  1,203 pairs; 890 into BHP from 568 employers, 457 of them with 1 move.
  **Five pairs reach 10**, all into BHP: Rio Tinto 43, OZ Minerals 40,
  Fortescue 13, Thiess 11, Programmed 10; then Monadelphous 9, Mader Group 8,
  Anglo American 7, Mineral Resources 7. Linear scaling from the first 970
  (about 20 sources over 10 at the full seed) still looks right.
  Two things the display would get wrong as it stands:
  - **OZ Minerals → BHP is mostly an acquisition, not hiring.** BHP completed
    its takeover on 2 May 2023; 22 of the 34 locally counted moves from then
    on are dated 2023-05, against about one every few months from 2015 to
    2020 and none in 2023-01..04. **Excluded since 2026-09-25**, see rule 8
    below: all 40 in the 60-month window are after completion, so the pair
    leaves the export entirely (1,504 moves over 1,202 pairs remain; Rio
    Tinto 43, Fortescue 13, Thiess 11 and Programmed 10 still reach 10).
  - **"Freelance" was a source with 6 moves**, "Self-employed" with 3, and
    one employer named "-" became the ref `name:`, which made
    `flows-to-d1.py` refuse the whole file. **Excluded since 2026-09-25**,
    see rule 9 below: 20 moves over 14 pairs, leaving 1,484 moves over
    1,189 pairs. The loader now reads the export as written.
  The 62 moves out of BHP (45 pairs) are all boomerangs: everyone sampled is
  a current BHP employee, so every exit seen is followed by a return.
- **Fourth collection, 2026-09-25 03:36–03:44 UTC: 233 requests, 2,330
  profiles**, no repeats. D1 now holds 9,490 of 21,358 (44%), 5,697 usable.
  60-month export: 1,848 moves over 1,448 pairs; 1,057 into BHP from 682
  employers, 545 of them with 1. **Seven pairs reach 10**, all into BHP:
  Rio Tinto 54, Programmed 16, Fortescue 15, Thiess 12, Monadelphous 11,
  Anglo American 10, Mineral Resources 10. Excluded: OZ Minerals → BHP 59
  (acquisition), Freelance 14, Self-employed 11, Independent Consultant 1,
  `name:` 1. Loaded as `brightdata|2026-09-25|d1b30763ccbe`, superseding the
  first load; D1 totals checked against the file. 110 of 1,254 companies
  matched (the two new exact-name matches, Chrysos and Vicinity Centres,
  checked by hand).
- **Three sources added to the roster, 2026-09-25**, as the largest
  unmatched sources of BHP hires: Programmed (16 moves), Thiess (12) and
  Mader Group (8). None was on the map, nor was a parent company.
  - Mader Group (ASX: MAD) is a Perth city-roster row, `perth-mad`,
    illustrative like every city-roster company. `auJobsTargets.ts` got the
    matching entry by hand, because `gen-asx200.py` no longer parses the
    prettier-formatted file it once wrote.
  - Thiess (`priv-thiess`, Brisbane) and Programmed (`priv-programmed`,
    Melbourne) are private, in a new `OUTSIDE_TOP150` list in
    `topPrivateCompanies.ts`: they are not in the AFR/IBISWorld workbook, so
    no revenue is sourced and every figure is `illustrative`. Programmed's
    head office is 727 Collins Street, Melbourne, per its own contact page;
    the Burswood office a search finds first is a WA branch.
  - Each head office came from the company's own page (Mader: its ASX change
    of address, effective 30 June 2026). They were geocoded with
    `geocode-au.py --only`, which left every other coordinate alone.
  - Seven `flow_company_map` rows, `method=manual`: `li:thiess`,
    `li:programmed`, `li:mader-group`, and four Programmed division pages
    (`li:programmed-lng`, `li:programmedoffshore`, `name:programmed skilled
    workforce`, `name:programmed professional`). Company ids are stamped
    into `flows` at load time, so they take effect on the next load. A dry
    run of the loaded export then matched 117 companies (from 110) and 360
    moves with both ends on the roster (from 312).
- **Fifth collection, 2026-09-25 04:55:50–05:18:29 UTC: 600 requests,
  6,000 profiles**, no repeats (`total_hits` now 21,359; the saved cursor
  held across that change). D1 holds 15,490 of 21,359 (73%), 9,605 usable.
  60-month export: 3,282 moves over 2,420 pairs; 1,869 into BHP from 1,064
  employers, 837 with 1. **18 pairs reach 10**, 17 into BHP: Rio Tinto 93,
  Fortescue 31, Programmed 26, Monadelphous 21, Downer 20, Thiess 19, Anglo
  American 16, Mineral Resources 16, Mader Group 15, Linkforce 12, Macmahon
  12, Aurizon 11, WesTrac 11, Glencore 10, South32 10, Water Corporation 10,
  WorkPac 10; and BHP → Rio Tinto 15 (people who left and came back).
  Excluded: OZ Minerals 99, Freelance 19, Self-employed 16, Independent
  Consultant 1, empty names 2. Loaded as `…f81c88d04168`; D1 totals checked,
  the three roster additions carry their ids, and the ten new exact-name
  matches were checked by hand.
  Two things this run found and did not fix:
  - **BHP's own pages counted as sources of BHP hires**: e.g. "BHP
    Billiton Nickel West Pty Ltd" (8), BHP Mitsubishi Alliance, Olympic Dam,
    and `name:bhp`, which exact-name mapped to `bhp` and so made a BHP → BHP
    row. **Fixed the same day, see rule 10**: 36 moves dropped as internal,
    18 counted under BHP; moves into BHP 1,869 → 1,848, and the self-pair
    row is gone. Reloaded as `…28373d8b91d8` (2,395 pairs, 3,246 moves).
  - Junk names still getting through, 1–2 moves each: "Various Companies"
    (two LinkedIn pages), "personal", "Dance Training Sabbatical".
- **Sixth collection, 2026-09-25 06:31–06:34 UTC: 15 requests, 150
  profiles, then `HTTP 500: ETIMEDOUT`** on the 16th, after 60 s. Not a 429
  and not the stale-cursor `Response Error`; the 15 that did answer came
  at ~7 a minute against the usual ~24, so Bright Data was slow at the
  time. Synced: D1 holds 15,640 of 21,359. Not reloaded for 150 profiles.
- **How far back the histories go, and where they stop** (measured
  2026-09-25 over the 14,040 profiles held on this machine, 18,646 moves
  dated to a month, 607 to a year only). The earliest move is 1968-06, the
  median 2016-03; 90% are from 2007 on and 75% from 2011 on. 16.4% fall in
  the 60-month window, 2.9% in 24 months.
  **The latest move is 2025-10, and the months before it thin out.** Moves a
  month run ~50–60 through 2023, ~40 in 2024, ~25 by mid-2025, 13 in
  2025-10, then nothing. That is the dataset's collection date plus people
  updating profiles late, not a hiring slump. So the export window, which
  ends at today minus `LAG_MONTHS` (3), is **ending past the data**: 2026-06
  was drawn with its last eight months empty and 2025 under-counted. The
  3-month lag was recorded as an assumption, and this measurement shows it
  is wrong for this source. The window should end at the last month the
  data covers (the `coverageDay` rule from CLAUDE.md applied to months),
  and report the span actually drawn. **Changed the same day**: see rule 11.
  The 60-month BHP export moved from 2021-07..2026-06 to 2020-11..2025-10,
  taking the moves in it from 3,246 to 3,946 and the pairs reaching 10 from
  18 to 23. Loaded as `…1cb45fe529d3` (2,943 pairs, 9,696 usable profiles,
  including the 150 from 06:31).
- **Fortescue, the second seed, 2026-09-25 07:21–07:51 UTC: `--seed
  fmg=fortescue`, 793 requests, all 7,928 AU profiles** (`total_hits` 7,928),
  no 429 and no repeats. That is the largest allowance yet: the window
  opened ~2 h after the last 429 (05:18), with 16 requests spent at 06:31.
  5,568 usable (70%, against BHP's 62%). Same method as BHP, with its
  lessons applied before loading:
  - its own pages (8 refs, ~20 moves: "Fortescue Metals Group", `name:fmg`,
    Cloudbreak, Christmas Creek, Iron Bridge) added to `SAME_EMPLOYER`;
    agency and contractor labels (WorkPac, Chandler Macleod, Civeo,
    Wirlu-Murra) left as sources, as for BHP;
  - no acquisition-shaped spike in any source's months;
  - a second seed brought more "no employer" labels, added to
    `NOT_EMPLOYERS` by exact name (see the comment there);
  - the window still ends at 2025-10: the same Bright Data snapshot.
  Export of both seeds: 8,045 moves over 5,775 pairs, 49 at 10 or more.
  Into Fortescue: 2,069 from 975 employers, 24 at 10+: BHP 155, Rio Tinto
  127, Mineral Resources 42, Roy Hill 25, South32 22, Brunel 21, Mader
  Group 20. **The second seed opened BHP's "lost to" side**: BHP → Fortescue
  155, Fortescue → BHP 39. Loaded as `…e4a23482ff8b`; totals checked, the
  16 new exact-name matches checked by hand. If `search_dataset` is billed
  per record (see Cost), this seed was ~7,930 records, ≤ ~$20 at the
  published rate.
- **The rate limit is not a fixed count per window.** 00:41–00:55 UTC: 164
  accepted, then 429. 02:02:14–02:25:38 UTC: 557 accepted (at the same ~24 a
  minute), then 429 on the 558th. So the cap had reset within 67 minutes of
  the first 429, and the second allowance was 3.4x the first. 03:36:05–03:44:50
  UTC: 233 accepted, 429 on the 234th, again after a 70-minute gap. So three
  allowances of 164, 557 and 233, the last two each after about 70 minutes, and
  none of them a fixed number: neither a flat count per hour nor per rolling
  hour fits (the hour before 03:44 held only these 233). A budget over a
  longer rolling span, including requests from before 00:41 that were not
  timed, fits but is not shown. What is measured: resuming about 70 minutes
  after a 429 has worked both times it was tried. Resume no sooner than that,
  and never retry one. 04:55:50–05:18:29 UTC, after a 71-minute gap: 600
  accepted, 429 on the 601st. So far: 164, 557, 233, 600. Requests used this
  month: ~1,664 of the 5,000 free (270 before today, then 1 + 557 + 233 + 600
  in this session), plus 15 more at 06:31 before a timeout. The full
  seed needs ~575 more.
- **Collection state lives in D1** (`0003`), so a collection outlives the
  machine it ran on. `--sync-d1` pushes what this machine has counted,
  `--pull-d1` brings the cursors and counted keys to a new machine, and
  `--export --from-d1` exports everything synced. D1 holds:
  - move counts per company pair per month, summed per sync batch;
  - per-batch profile counts and refusal reasons;
  - the seed cursors;
  - `flow_collect_seen`: the HMAC key of each profile counted, **alone**.
    No batch, seed or date is stored with it, so a key cannot be joined to
    the moves it contributed.

  No name, profile url, photo, title or per-person history is stored
  anywhere, locally or in D1. The HMAC salt is kept out of D1, in
  `BRIGHTDATA_FLOWS_SALT`; without it a key cannot be recomputed from a
  profile id, and with a different one every profile would count again.
  A sync needs 20 new profiles (`MIN_BATCH`), because a batch of one would
  be one person's history. Every insert is `OR IGNORE` under a batch id
  derived from the batch's keys, so a sync that dies half way can be
  re-run. Tested offline on a copy of the real state (forced re-sync wrote
  nothing twice; the D1 export was byte-identical to the local one), then
  run live: 1,600 keys, 1,232 month-pair rows, and the D1 export matched.
- **The MCP server writes to the Bright Data account.** On first start
  `@brightdata/mcp@2.11.3` created two zones, `mcp_unlocker` and
  `mcp_browser`, on the account the token belongs to ("Required zone … not
  found, creating it"). Later starts reuse them. This script uses neither
  (it calls only `search_dataset` / `list_dataset_fields`), but they exist.

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
python scripts/brightdata-talent-flows.py --inspect bhp --n 10 # still 1 request, 10 profiles summarised
python scripts/brightdata-talent-flows.py --seed bhp=bhp --max-requests 5
python scripts/brightdata-talent-flows.py --stats
python scripts/brightdata-talent-flows.py --sync-d1                    # counts + keys to D1
python scripts/brightdata-talent-flows.py --pull-d1                    # on a new machine, before collecting
python scripts/brightdata-talent-flows.py --export out/ --from-d1
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
8. **An acquisition is not a flow of talent.** When one company buys
   another, everyone moves from the acquired name to the buyer's in the same
   month without changing job, and a profile shows that as a move. Left in,
   it is a large, plausible, false source of hires: OZ Minerals was BHP's
   second-largest at 40 moves. `ACQUISITIONS` in `scripts/talent_flows.py`
   lists (acquired, acquirer, completion month, evidence); `aggregate()`
   drops moves between the two, in either direction, from the completion
   month on, open-ended because profiles are updated late (the OZ Minerals
   trickle ran to 2024-04). Earlier moves stay: they were hires. Both
   collectors' exports report what was dropped in
   `filters.excluded.acquisition_transfers` and say so in `notes`. Each entry
   needs a primary source for its date, and a measurement of the pair's
   months showing the spike, in the comment beside it.
   The raw counts in `flow_collect_moves` keep these moves, so a rule can be
   corrected without collecting again. What it cannot reach: a name-matched
   ref (`name:oz minerals bhp`, 1 move) and vendor files that arrive already
   aggregated over a window, where a transfer cannot be told from a hire by
   month. A vendor delivery needs the vendor's own handling, or the pair
   withheld. Asserted in `scripts/test_talent_flows.py` (`test_acquisition`),
   not in `check-flows.ts`: it happens before anything reaches the app.
9. **A way of working is not an employer.** "Freelance", "Self-employed",
   "Independent Consultant" and a name that normalises to nothing are
   `NOT_EMPLOYERS` in `scripts/talent_flows.py`, matched on the normalised
   name whatever the ref (Independent Consultant arrived as a LinkedIn
   page). `aggregate()` drops every move to or from one and reports them in
   `filters.excluded.not_employers`. The spell still separates the jobs
   either side of it: X -> Freelance -> BHP is two dropped moves, never an
   invented X -> BHP. That is also why this is done in `aggregate()` and not
   in the parser: the profiles already collected survive only as pair counts
   in D1, and refusing the entry at parse time would treat new profiles
   differently from them. Exact names only, so a named business such as
   "Freelance copywriter/online editor" stays. Asserted in
   `test_not_employers`.

10. **A company's own pages are the company.** A profile that lists "BHP
   Billiton Nickel West" and then "BHP" has not changed employer.
   `SAME_EMPLOYER` in `scripts/talent_flows.py` maps an employer's ref to the
   refs that are its own subsidiaries, operations and old names (22 for BHP,
   each by exact ref). `aggregate()` counts each alias under the employer:
   a move between two of its pages is dropped as internal, and a hire from
   elsewhere into one of them is a hire into the employer. Agency labels
   ("BHP (Contracting through Chandler Macleod)") are left alone, because the
   employer of record was the agency. So is BHP Billiton Mitsui Coal, whose
   2022 sale to Stanmore makes it BHP or not depending on the date. Both
   are reported in `filters.excluded.same_employer` and
   `.merged_into_employer`. Asserted in `test_same_employer`.
   Still open: two different refs can resolve to ONE roster id through
   `flow_company_map` (`li:pwc` and `li:pwc-australia` both map to
   `priv-pwc-australia`, one move). That is the roster having one PwC, not
   the flow being internal, and it is left as it is.

11. **A window ends where the data does.** `coverage_end()` in
   `scripts/talent_flows.py`: the latest month holding moves, with the two
   before it holding moves too (so one stray profile cannot move it), no
   later than today minus `--lag-months`, which is now a cap and not the
   end. Bright Data's profiles stop at 2025-10, so a window drawn to
   today − 3 months ran eight empty months past them. Both exports put
   `window_end`, `window_end_cap` and the last six months' counts
   (`moves_per_month_to_end`) in `filters`, and say in `notes` when the end
   falls short of the cap. The last months are still thin (14 moves in
   2025-10 against ~26 before it) because people update profiles late. No
   threshold is set for "too thin to count", because none has been
   measured; the counts are shown instead. Asserted in `test_window_end`.

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
