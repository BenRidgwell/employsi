// Generate src/employsi/data/localLogos.ts from whatever is in public/logos/.
//
// WHY A GENERATOR AND NOT A DIRECTORY READ
// The app is a static build served from a Worker; nothing in it can list a
// directory at runtime. So the folder has to be turned into a map at build
// time, and that map has to be committed alongside the images. Dropping a file
// in and forgetting this step is the one failure mode here, which is why the
// README says to commit both and why the generated file names the command.
//
// WHAT IT VALIDATES
//  * the filename is a real roster id — a typo'd id would produce a map entry
//    nothing ever looks up, which is silent and would read as "the logo didn't
//    work" rather than "the file is misnamed".
//  * no company has two files. Picking one by extension order would mean the
//    live badge depends on something invisible; erroring means you know.
//
// Run: bun run scripts/gen-local-logos.ts
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMPANIES } from "../src/employsi/data/companies";

const DIR = join(import.meta.dir ?? ".", "..", "public", "logos");
const OUT = join(import.meta.dir ?? ".", "..", "src", "employsi", "data", "localLogos.ts");
const EXT = /\.(png|jpg|jpeg|svg|webp)$/i;

const ids = new Set((COMPANIES as { id: string }[]).map((c) => c.id));
const byId = new Map<string, string>();
const unknown: string[] = [];
const dupes: string[] = [];

for (const file of readdirSync(DIR).sort()) {
  if (!EXT.test(file)) continue;
  const id = file.replace(EXT, "");
  if (!ids.has(id)) {
    unknown.push(file);
    continue;
  }
  if (byId.has(id)) {
    dupes.push(`${byId.get(id)} and ${file}`);
    continue;
  }
  byId.set(id, file);
}

if (unknown.length) {
  console.error(
    `✗ Not a roster id, so nothing would ever read these:\n   ${unknown.join("\n   ")}`,
  );
  console.error("  See public/logos/README.md for how to look an id up.");
}
if (dupes.length) {
  console.error(`✗ Two files for one company:\n   ${dupes.join("\n   ")}`);
}
if (unknown.length || dupes.length) process.exit(1);

// The empty case is written as `{}` on one line rather than a blank body,
// because prettier (enforced through ESLint) rejects the blank one and this
// file is NOT in the generated-file ignore list — it is small and normally
// formatted, so linting it is a free check on the generator's own output.
const body = byId.size
  ? "{\n" + [...byId].map(([id, f]) => `  ${JSON.stringify(id)}: "/logos/${f}",`).join("\n") + "\n}"
  : "{}";

writeFileSync(
  OUT,
  `// GENERATED — do not edit by hand.
// Run: bun run scripts/gen-local-logos.ts
//
// Roster id -> a logo file committed under public/logos/. These are checked in
// rather than linked, so unlike every other badge source they cannot stop
// resolving when somebody else's server changes. companyLogo.ts reads this
// first, which makes dropping a file in the folder the way to override a wrong
// or low-quality badge without editing any data file.
export const LOCAL_LOGO: Record<string, string> = ${body};
`,
);

console.log(
  `Wrote ${byId.size} logo${byId.size === 1 ? "" : "s"} to src/employsi/data/localLogos.ts`,
);
