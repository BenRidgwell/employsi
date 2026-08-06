# Company logos

Drop a logo file in this folder and the app will use it for that company's
badge — on the map marker, the company card and the compare card — ahead of
every other source.

## Naming

**The filename must be the company's roster id**, plus an extension:

```
public/logos/perth-aa.png
public/logos/priv-hbf.svg
public/logos/sydney-gyg.png
```

`.png`, `.jpg`, `.jpeg`, `.svg` and `.webp` are all accepted. If a company has
two files with different extensions, the generator errors rather than picking
one, so you always know which file is live.

## Finding a company's roster id

```bash
bun -e 'import { COMPANIES } from "./src/employsi/data/companies";
  for (const c of COMPANIES) if (c.name.toLowerCase().includes("alcoa")) console.log(c.id, c.name);'
```

Ids follow three shapes: `<ticker>` or `<city>-<ticker>` for listed companies
(`bhp`, `perth-aa`, `sydney-gyg`), `priv-<slug>` for the private roster
(`priv-hbf`), and `<state>-gov-<slug>` for government agencies.

## After adding files

```bash
bun run scripts/gen-local-logos.ts
```

That rewrites `src/employsi/data/localLogos.ts` from whatever is in this
folder. Commit both the image and the regenerated file — the map is what the
app reads at runtime; it cannot list this directory itself.

## Why a file here beats the other sources

`src/employsi/lib/companyLogo.ts` resolves a badge in this order:

1. **this folder** — a file you put here deliberately
2. `PRIVATE_LOGO_URL` / `WA_GOV_LOGO_URL` — logos supplied in earlier workbooks
3. the WA whole-of-government crest, for agencies that use it
4. Google's favicon service, on a corrected or roster-derived domain

So dropping a file here is how you override a wrong or ugly badge without
touching any of the data files. It is also the only source that cannot break
later: everything below it is a link to somebody else's server.

## Quality

Square-ish, at least 128px on the short side, and a mark that reads on a light
background — the badge sits on white. A white-on-transparent logo will look
empty, which is the specific reason several WA agency logos were left out of
`waGovLogos.ts`.
