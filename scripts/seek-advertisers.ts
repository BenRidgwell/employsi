// Offline dump of every SEEK advertiser the pipeline pulls, per company.
//
// Same argument as scripts/roster.ts: read the data by RUNNING the modules, not
// by regexing their source. The regex this replaces had already failed once in
// exactly the way that is hardest to notice — Prettier reformatted
// seekAdvertisers.ts to double quotes, the single-quote pattern matched zero
// entries, and scripts/seek-to-d1.py reported four consecutive successful runs
// while archiving nothing (scripts/test_rosters.py tells the story).
//
// The new half makes source-regexing worse still: seekTradingNames.ts holds an
// ARRAY per company and composes it with seekAdvertisers.ts in a function, so
// what a company actually resolves to does not exist as a literal anywhere in
// the source. Importing seekAdvertisersFor is the only way the Python driver
// and the Worker can be guaranteed to walk the same advertisers.
//
// Writes {companyId: [{advertiserId, name}, ...]} on stdout.
// Run: bun run scripts/seek-advertisers.ts
import { SEEK_ADVERTISERS } from "../src/employsi/data/seekAdvertisers";
import { SEEK_TRADING_NAMES, seekAdvertisersFor } from "../src/employsi/data/seekTradingNames";

// --generated-only dumps just the generated exact-name map, one entry per
// company, which is what scripts/gen-seek-advertisers.py merges into. It has to
// read the file it rewrites, and it must not see the hand-written trading names
// or it would fold them into its own output and destroy them on the next run.
if (process.argv.includes("--generated-only")) {
  process.stdout.write(JSON.stringify(SEEK_ADVERTISERS));
} else {
  const ids = new Set([...Object.keys(SEEK_ADVERTISERS), ...Object.keys(SEEK_TRADING_NAMES)]);
  const out: Record<string, { advertiserId: string; name: string }[]> = {};
  for (const id of [...ids].sort()) out[id] = seekAdvertisersFor(id);
  process.stdout.write(JSON.stringify(out));
}
