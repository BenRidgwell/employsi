// Which roster companies are still plotted on a GENERATED pin rather than their
// real registered office — the worklist for scripts/geocode-au.py.
//
// Emits address-gaps.csv: city, type, company_id, company_name, sector, and an
// empty registered_address column to fill in. Filled rows go into
// scripts/au-addresses.csv, which geocode-au.py reads; anything that does not
// geocode to the street the address named is rejected rather than written.
//
// The CSV itself is NOT committed. It is a snapshot of a moving number — every
// geocoding tranche shrinks it — so a checked-in copy would be wrong within a
// day. Regenerate it instead:  bun run scripts/address-gaps.ts
//
// CAVEAT worth knowing before filling anything in: a company hand-placed in
// CITY_COMPANIES with a geocoded coordinate (BHP, Rio Tinto, South32, Woodside,
// Santos, Chevron and the other Perth majors) is listed here even though it is
// already correctly plotted, because this check reads the lookup tables and not
// those inline entries. Verify against the map before sourcing an address for
// one of the big resource names.
import { CITY_COMPANIES } from "../src/employsi/data/mapboxGeo";
import { PERTH_REAL_COORDS } from "../src/employsi/data/perthRealCoords";
import { AU_REAL_COORDS } from "../src/employsi/data/auRealCoords";
import { COMPANIES } from "../src/employsi/data/companies";
import { writeFileSync } from "node:fs";

const real = new Set([...Object.keys(PERTH_REAL_COORDS), ...Object.keys(AU_REAL_COORDS)]);
const AU = ["sydney", "melbourne", "brisbane", "adelaide", "perth", "canberra", "darwin", "hobart"];
const nameOf = (id: string) => COMPANIES.find((c) => c.id === id)?.name ?? id;
const sectorOf = (id: string) => COMPANIES.find((c) => c.id === id)?.sector ?? "";
const kind = (id: string) =>
  id.startsWith("aps-")
    ? "Federal agency"
    : /^(perth|sa|vic|qld|nt|tas|nsw)-gov-/.test(id)
      ? "State agency"
      : id.startsWith("priv-")
        ? "Private company"
        : "Listed company";

const rows: string[] = ["city,type,company_id,company_name,sector,registered_address"];
const summary: Record<string, Record<string, number>> = {};
for (const city of AU) {
  const fanned = (CITY_COMPANIES[city] || []).filter((c) => !real.has(c.id));
  summary[city] = {};
  for (const c of fanned) {
    const k = kind(c.id);
    summary[city][k] = (summary[city][k] ?? 0) + 1;
    const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    rows.push([city, k, c.id, nameOf(c.id), sectorOf(c.id), ""].map(q).join(","));
  }
}
writeFileSync(new URL("../address-gaps.csv", import.meta.url).pathname, rows.join("\n") + "\n");
const kinds = ["Listed company", "Private company", "Federal agency", "State agency"];
console.log("city        " + kinds.map((k) => k.padStart(17)).join("") + "     total");
let g = 0;
for (const city of AU) {
  const t = kinds.reduce((s, k) => s + (summary[city][k] ?? 0), 0);
  g += t;
  if (!t) continue;
  console.log(
    city.padEnd(12) +
      kinds.map((k) => String(summary[city][k] ?? 0).padStart(17)).join("") +
      String(t).padStart(10),
  );
}
console.log("\ntotal needing verification: " + g + "   (rows written: " + (rows.length - 1) + ")");
