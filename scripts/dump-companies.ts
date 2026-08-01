// Emits id / name / domain for every rostered company as JSON, for the Python
// scrapers. Same reason as dump-tickers.ts: COMPANIES is assembled at runtime
// from several roster files, so TypeScript is the only correct reading of it.
import { COMPANIES } from "../src/employsi/data/companies";

console.log(
  JSON.stringify(
    COMPANIES.map((c) => ({ id: c.id, name: c.name, domain: c.domain || "" })),
  ),
);
