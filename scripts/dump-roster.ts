// Dumps the roster as JSON for the Python generators.
//
// WHY THIS EXISTS. scripts/gen-wgea-workforce.py has to match every roster
// company against the WGEA register, and the roster is assembled in TypeScript
// from eight files (companies.ts pushes in the listed, private, government and
// university rosters). Re-deriving that in Python would be a second
// implementation of the roster, free to drift from the first — the exact bug
// class check-roster.ts exists to catch. So the TypeScript stays the one
// source and the generator reads what it prints.
//
// `au` is whether the company is plotted in an Australian city. WGEA is an
// Australian register created by the Workplace Gender Equality Act 2012, so a
// New Zealand company must never be matched against it: Fletcher Building and
// Xero are not in it, but their Australian subsidiaries can be, and attributing
// a subsidiary's headcount to the parent would be wrong in the way that is
// hardest to see — a real number, from a real filing, for another company.
//
// Run: bun run scripts/dump-roster.ts > roster.json
import { COMPANIES } from "../src/employsi/data/companies";
import { CITY_COMPANIES } from "../src/employsi/data/mapboxGeo";

const AU_CITIES = [
  "sydney",
  "melbourne",
  "brisbane",
  "perth",
  "adelaide",
  "canberra",
  "darwin",
  "hobart",
];
const NZ_CITIES = ["auckland", "wellington", "christchurch"];

const cityOf = new Map<string, string>();
for (const [city, entries] of Object.entries(CITY_COMPANIES))
  for (const e of entries as { id: string }[]) if (!cityOf.has(e.id)) cityOf.set(e.id, city);

console.log(
  JSON.stringify(
    COMPANIES.map((c) => {
      const city = cityOf.get(c.id) ?? "";
      return {
        id: c.id,
        name: c.name,
        city,
        au: AU_CITIES.includes(city),
        nz: NZ_CITIES.includes(city),
      };
    }),
  ),
);
