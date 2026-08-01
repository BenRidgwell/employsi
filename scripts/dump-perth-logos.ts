// Perth roster + resolved logo URL, for scripts/audit-logos.py.
import { CITY_COMPANIES } from "../src/employsi/data/mapboxGeo";
import { COMPANIES } from "../src/employsi/data/companies";
import { logoFor } from "../src/employsi/lib/companyLogo";

const byId = new Map(COMPANIES.map((c) => [c.id, c]));
const seen = new Set<string>();
const out: { id: string; name: string; domain: string; url: string }[] = [];
for (const c of CITY_COMPANIES.perth || []) {
  if (seen.has(c.id)) continue;
  seen.add(c.id);
  const full = byId.get(c.id);
  const domain = full?.domain || "";
  out.push({ id: c.id, name: full?.name || c.id, domain, url: logoFor(c.id, domain, 128) });
}
console.log(JSON.stringify(out));
