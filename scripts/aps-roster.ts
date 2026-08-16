// Offline APS agency dump — the federal counterpart of scripts/roster.ts.
//
// WHY THIS EXISTS RATHER THAN A REGEX. aps-to-d1.py used to read canberraGov.ts
// with a regex over the AGENCIES literal, and that regex only accepted a hub
// override in SINGLE quotes:
//
//     (?:,\s*'([^']+)')?\s*\]
//
// Prettier writes the file with DOUBLE quotes, so every entry that carries a hub
// — ["Reserve Bank of Australia", "sydney"] — failed the match outright and was
// dropped. The loader reported 49 agencies where the file declares 56, silently,
// on every run since the hubs were added. The seven lost were exactly the seven
// non-Canberra ones: ASIC, APRA, the RBA, the Bureau of Meteorology, ARPANSA,
// the Australian Space Agency and the AIFS.
//
// This is the same failure scripts/roster.ts was written to end ("drivers that
// regexed the source walked 205 companies and silently skipped 150"), reappearing
// in the one driver that never moved over. Running the TypeScript cannot drift
// from the TypeScript.
//
// Writes a JSON array of {id, name, hub} on stdout.
// Run: bun run scripts/aps-roster.ts
import { APS_GOV_NAMES, APS_GOV_HUB, apsAgencyId } from "../src/employsi/data/canberraGov";

const out = APS_GOV_NAMES.map((name) => {
  const id = apsAgencyId(name);
  return { id, name, hub: APS_GOV_HUB[id] || "canberra" };
});
process.stdout.write(JSON.stringify(out));
