// Does each roster company still EXIST, and is its domain still ITS domain?
//
// WHY THIS EXISTS
// The roster is a static list. Nothing in this codebase notices when a company
// on it is acquired, renamed or delisted, because the only evidence would be an
// absence: the feeds stop returning its ads, the card shows no vacancies, and
// that is indistinguishable from an employer who simply is not hiring. Every
// other check here (check-roster.ts especially) verifies that a company is
// WIRED correctly. None of them can tell whether it is still a company.
//
// Marathon Oil sat on the Houston roster for two years after ConocoPhillips
// bought it in November 2024. It had no archive rows, no follows, no views —
// and none of that was suspicious, because plenty of live companies have none
// either. What exposed it was its BADGE: marathonoil.com redirects to
// conocophillips.com, so the logo audit kept fetching the acquirer's mark for
// it. That is the signal this script generalises.
//
// TWO SIGNALS, BOTH CHEAP
//
//   1. THE REDIRECT. A company's own domain redirecting to a DIFFERENT
//      registrable domain is what an acquisition looks like from outside.
//      Marathon -> ConocoPhillips is the clean case.
//   2. THE NAME ON THE PAGE. A domain that answers but whose <title> names a
//      different company is either a wrong domain (the failure PRIVATE_DOMAIN
//      exists to fix) or a rebrand nobody recorded.
//
// And optionally a third, --logos, which is the one that actually caught
// Marathon: two companies resolving to the SAME badge image. That is how the
// eighteen domain-parking icons surfaced on 2026-09-24, and how Woolworths
// South Africa's logo was found on Woolworths Australia's card before that.
//
// THIS IS NOT A CI GATE, AND MUST NOT BECOME ONE.
// It talks to a few hundred third-party hosts, so its result depends on their
// WAFs, their rate limits and this machine's exit IP. It exits 0 on findings by
// design. A blocked fetch is reported as inconclusive and never as a failure,
// because "Cloudflare refused us today" and "this company no longer exists" are
// the same HTTP status and only one of them is worth acting on. Run it by hand,
// or on a schedule that files a report for a human — never as a required check.
// (See the note in .github/workflows/portal-ticks-check.yml for what a
// path-filtered required check does to a PR; a flaky one is worse.)
//
// Run:
//   bun run scripts/check-company-live.ts --country au
//   bun run scripts/check-company-live.ts --city houston --logos
//   bun run scripts/check-company-live.ts --ids houston-mro,sydney-aub
//   bun run scripts/check-company-live.ts --country us --json /tmp/live.json
//   bun run scripts/check-company-live.ts --country au --strict    # exit 1
import { COMPANIES, type Company } from "../src/employsi/data/companies";
import { CITY_COMPANIES } from "../src/employsi/data/mapboxGeo";
import { CITY_COUNTRY } from "../src/employsi/data/cityCountry";
import { PRIVATE_DOMAIN } from "../src/employsi/data/privateLogos";
import { logoFor } from "../src/employsi/lib/companyLogo";

// ── options ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opt = (name: string, fallback = ""): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name: string) => argv.includes(`--${name}`);

const WANT_COUNTRY = opt("country").toLowerCase();
const WANT_CITY = opt("city").toLowerCase();
const WANT_IDS = new Set(
  opt("ids")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const LIMIT = Number(opt("limit", "0")) || 0;
const CONCURRENCY = Math.max(1, Number(opt("concurrency", "8")) || 8);
const JSON_OUT = opt("json");
const WITH_LOGOS = flag("logos");
const STRICT = flag("strict");

// Chrome's own headers. The difference is not cosmetic: hcf.com.au answers
// `Accept: */*` and refuses `Accept: image/*`, so a check fetching with a
// library's defaults sees a site that a browser cannot load, and vice versa.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const IMG_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

/**
 * FETCHING GOES THROUGH curl, NOT fetch(), and that is not a style choice.
 * Measured 2026-09-24: marathonoil.com — the company this script exists to
 * catch — closes the socket under Bun's fetch and redirects cleanly under
 * curl, so the one case that proves the check would have been filed as
 * "blocked" and never reported. Several other hosts in this roster behave the
 * same way. curl is also what every audit that found these problems used, so
 * a result here matches what a person re-running the measurement by hand will
 * see.
 */
interface Fetched {
  status: number;
  finalUrl: string;
  body: string;
  bytes: Uint8Array | null;
  error: string;
}

async function curlGet(url: string, accept: string, binary = false): Promise<Fetched> {
  const out = `${TMP}/${Math.random().toString(36).slice(2)}.bin`;
  const proc = Bun.spawn(
    [
      "curl",
      "-sL",
      "-m",
      "25",
      "--retry",
      "1",
      "--retry-delay",
      "2",
      "-A",
      UA,
      "-H",
      `Accept: ${accept}`,
      "-H",
      "Accept-Language: en-AU,en;q=0.9",
      "-o",
      out,
      "-w",
      "%{http_code}\t%{url_effective}",
      url,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const meta = await new Response(proc.stdout).text();
  await proc.exited;
  const [codeRaw, finalUrl = ""] = meta.trim().split("\t");
  const status = Number(codeRaw) || 0;
  const file = Bun.file(out);
  let body = "";
  let bytes: Uint8Array | null = null;
  try {
    if (await file.exists()) {
      if (binary) bytes = new Uint8Array(await file.arrayBuffer());
      else body = (await file.text()).slice(0, 200_000);
    }
  } catch {
    /* unreadable body is the same as no body */
  }
  try {
    await Bun.$`rm -f ${out}`.quiet();
  } catch {
    /* best effort */
  }
  return { status, finalUrl, body, bytes, error: status ? "" : "no connection" };
}

const TMP = `/tmp/check-company-live-${process.pid}`;

// ── name and domain normalising ─────────────────────────────────────────────

/**
 * Multi-label public suffixes this roster actually uses. A registrable domain
 * has to be compared at the right level or every .com.au company reads as
 * having "moved" to its own parent.
 */
const MULTI_SUFFIX = new Set([
  "com.au",
  "net.au",
  "org.au",
  "gov.au",
  "edu.au",
  "asn.au",
  "id.au",
  "co.nz",
  "net.nz",
  "org.nz",
  "govt.nz",
  "ac.nz",
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "me.uk",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "com.hk",
  "org.hk",
  "gov.hk",
  "co.jp",
  "or.jp",
  "ne.jp",
  "go.jp",
  "ac.jp",
  "co.kr",
  "or.kr",
  "go.kr",
  "com.sg",
  "gov.sg",
  "edu.sg",
  "com.my",
  "com.ph",
  "co.za",
  "org.za",
  "gov.za",
  "co.in",
  "net.in",
  "gov.ae",
  "co.ae",
  "ac.ae",
  "com.br",
  "com.mx",
  "co.il",
  "com.tr",
]);

function registrable(host: string): string {
  const h = host
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_SUFFIX.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "for",
  "group",
  "holdings",
  "holding",
  "company",
  "companies",
  "limited",
  "ltd",
  "ltda",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "plc",
  "llc",
  "lp",
  "nv",
  "sa",
  "se",
  "ag",
  "spa",
  "pty",
  "co",
  "international",
  "global",
  "worldwide",
  "australia",
  "australian",
  "new",
  "zealand",
  "bank",
  "financial",
  "services",
  "technologies",
  "technology",
  "industries",
  "systems",
  "solutions",
  "trust",
  "reit",
  "fund",
  "energy",
  "resources",
  "mining",
]);

/** Lowercase, strip accents and punctuation, drop corporate furniture. */
function tokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Does `text` name this company? Deliberately generous — a false "yes" costs
 * nothing (the row is simply not reported) while a false "no" adds noise to a
 * report a human has to read. One distinctive token is enough: "Wesfarmers"
 * alone identifies Wesfarmers, and plenty of sites title themselves with a
 * tagline rather than a legal name.
 */
function namesCompany(text: string, companyName: string): boolean {
  const hay = " " + tokens(text).join(" ") + " ";
  const want = tokens(companyName);
  if (!want.length) return false;
  return want.some((t) => hay.includes(` ${t} `));
}

// ── the roster under test ───────────────────────────────────────────────────

interface Row {
  id: string;
  name: string;
  city: string;
  country: string;
  host: string;
}

function roster(): Row[] {
  const byId = new Map<string, Company>();
  for (const c of COMPANIES) if (!byId.has(c.id)) byId.set(c.id, c);
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const [city, list] of Object.entries(CITY_COMPANIES)) {
    const country = (CITY_COUNTRY[city] ?? "??").toLowerCase();
    if (WANT_CITY && city.toLowerCase() !== WANT_CITY) continue;
    if (WANT_COUNTRY && country !== WANT_COUNTRY) continue;
    for (const e of list) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (WANT_IDS.size && !WANT_IDS.has(e.id)) continue;
      const c = byId.get(e.id);
      // The host the app itself would use: an override if one is recorded,
      // otherwise whatever deriveDomain() built from the name.
      const host = (PRIVATE_DOMAIN[e.id] || c?.domain || "").trim();
      if (!host) continue;
      rows.push({ id: e.id, name: c?.name ?? e.id, city, country, host });
    }
  }
  if (WANT_IDS.size) {
    // --ids is exact, and a typo in it should say so rather than pass silently.
    for (const id of WANT_IDS) if (!rows.some((r) => r.id === id)) rows.push(missing(id));
  }
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

function missing(id: string): Row {
  return { id, name: `(no such company: ${id})`, city: "", country: "", host: "" };
}

// ── fetching ────────────────────────────────────────────────────────────────

type Verdict =
  "OK" | "MOVED" | "MISMATCH" | "FOR_SALE" | "NO_NAME" | "GONE" | "BLOCKED" | "SKIPPED";

interface Result extends Row {
  verdict: Verdict;
  status: number | string;
  finalHost: string;
  title: string;
  note: string;
}

const BLOCKED_STATUS = new Set([401, 403, 405, 406, 408, 429, 500, 502, 503, 504]);

async function probe(row: Row): Promise<Result> {
  const base: Result = { ...row, verdict: "OK", status: 0, finalHost: "", title: "", note: "" };
  if (!row.host) return { ...base, verdict: "SKIPPED", note: "no domain on the record" };

  const res = await curlGet(`https://${row.host}/`, PAGE_ACCEPT);
  if (!res.status) {
    // A connect/TLS/DNS failure from THIS machine is not evidence about the
    // company. Several real sites in this roster refuse this sandbox outright.
    return { ...base, verdict: "BLOCKED", status: "conn", note: "no connection" };
  }

  const finalHost = (() => {
    try {
      return new URL(res.finalUrl).hostname;
    } catch {
      return "";
    }
  })();
  const out: Result = { ...base, status: res.status, finalHost };

  if (res.status === 404 || res.status === 410) {
    return { ...out, verdict: "GONE", note: "the host answered but the site is not there" };
  }
  if (BLOCKED_STATUS.has(res.status) || res.status < 200 || res.status >= 300) {
    return { ...out, verdict: "BLOCKED", note: `HTTP ${res.status}` };
  }

  const html = res.body;
  const title = (/<title[^>]*>([^<]{0,300})/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const siteName =
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{0,120})/i.exec(html)?.[1] ?? "";
  out.title = title || siteName;

  const from = registrable(row.host);
  const to = registrable(finalHost);
  if (to && from !== to) {
    // The Marathon signal. Report it even when the destination names the
    // company, because a consolidated brand site is still worth recording —
    // but say which case it is.
    const named = namesCompany(`${title} ${siteName}`, row.name);
    const sale = looksForSale(`${title} ${siteName} ${to}`);
    return {
      ...out,
      verdict: sale ? "FOR_SALE" : "MOVED",
      note: sale
        ? `redirects to ${to}, a domain listing ("${sale}") — the badge is a broker's logo`
        : named
          ? `redirects to ${to}, which still names it — likely a brand consolidation`
          : `redirects to ${to}, which does NOT name it — acquisition or wrong domain`,
    };
  }

  const sale = looksForSale(`${title} ${siteName}`);
  if (sale && !namesCompany(`${title} ${siteName}`, row.name)) {
    return {
      ...out,
      verdict: "FOR_SALE",
      note: `the page is a domain listing ("${sale}") — the badge is a broker's logo`,
    };
  }

  if (namesCompany(`${title} ${siteName}`, row.name)) return { ...out, verdict: "OK" };

  // The page answered under its own domain but never says who it is. Check
  // whether it names some OTHER company on the roster, which turns a weak
  // signal into a strong one.
  const other = otherCompanyNamed(`${title} ${siteName}`, row.id);
  if (other) {
    return { ...out, verdict: "MISMATCH", note: `the page names ${other} instead` };
  }
  return {
    ...out,
    verdict: "NO_NAME",
    note: title ? `title is "${title.slice(0, 70)}"` : "no title at all",
  };
}

/** Index of every roster name, so a page can be matched against the whole set. */
const ALL_NAMES: [string, string][] = COMPANIES.map((c) => [c.id, c.name]);

/**
 * A domain that is FOR SALE, which is this codebase's most expensive failure
 * and its most repeated one. deriveDomain() builds `name + ".com"`, and a .com
 * spelled out of a large company's legal name is on the market precisely
 * because the name is valuable — so the badge quietly becomes a domain
 * broker's logo, sharp and confident and wrong. Eighteen cards were in that
 * state on 2026-09-24, including Mitsubishi UFJ and Sumitomo Mitsui. The
 * wording below is taken from the listings actually hit.
 */
const FOR_SALE = [
  "for sale",
  "is for sale",
  "buy this domain",
  "domain is available",
  "premium domain",
  "domain broker",
  "parked",
  "this domain",
  "make an offer",
  "spaceship.com",
  "sedo",
  "afternic",
  "dan.com",
  "hugedomains",
  "godaddy",
  "namecheap",
  "startupdomains",
];

function looksForSale(text: string): string {
  const t = text.toLowerCase();
  return FOR_SALE.find((p) => t.includes(p)) ?? "";
}

function otherCompanyNamed(text: string, selfId: string): string {
  const hay = " " + tokens(text).join(" ") + " ";
  for (const [id, name] of ALL_NAMES) {
    if (id === selfId) continue;
    const want = tokens(name);
    // Two distinctive tokens, so "Energy Australia" does not match every
    // energy company with an Australian page.
    if (want.length >= 2 && want.every((t) => hay.includes(` ${t} `))) return name;
  }
  return "";
}

// ── the logo-collision pass (--logos) ───────────────────────────────────────

/**
 * Fetch each company's resolved badge and report two companies sharing one
 * image. This is the check that has found the most: the domain-parking icons,
 * Woolworths South Africa on Woolworths Australia's card, and Marathon Oil
 * drawing ConocoPhillips' mark. Companies whose names share a token are
 * ignored, because a group and its subsidiary SHOULD share a logo.
 */
async function logoCollisions(rows: Row[]): Promise<string[]> {
  const byHash = new Map<string, Row[]>();
  await pool(rows, CONCURRENCY, async (row) => {
    const c = COMPANIES.find((x) => x.id === row.id);
    const url = logoFor(row.id, c?.domain ?? "", 128);
    if (url.startsWith("/")) return; // a committed file, deliberately chosen
    const res = await curlGet(url, IMG_ACCEPT, true);
    if (res.status !== 200 || !res.bytes || res.bytes.byteLength < 64) return;
    const hash = await crypto.subtle.digest("SHA-1", res.bytes);
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const key = hex.slice(0, 16);
    (byHash.get(key) ?? byHash.set(key, []).get(key)!).push(row);
  });
  const out: string[] = [];
  for (const [hash, group] of byHash) {
    if (group.length < 2) continue;
    const related = group.every((g) =>
      tokens(g.name).some((t) => tokens(group[0].name).includes(t)),
    );
    if (related) continue;
    out.push(`${hash.slice(0, 8)}  ${group.map((g) => `${g.name} (${g.host})`).join("  |  ")}`);
  }
  return out;
}

// ── runner ──────────────────────────────────────────────────────────────────

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

const LABEL: Record<Verdict, string> = {
  OK: "ok    ",
  MOVED: "MOVED ",
  MISMATCH: "WRONG ",
  FOR_SALE: "PARKED",
  NO_NAME: "unsure",
  GONE: "GONE  ",
  BLOCKED: "blocked",
  SKIPPED: "skip  ",
};

async function main() {
  await Bun.$`mkdir -p ${TMP}`.quiet();
  const rows = roster();
  if (!rows.length) {
    console.log("No companies matched. Use --country / --city / --ids.");
    process.exit(0);
  }
  console.log(
    `Checking ${rows.length} companies` +
      (WANT_COUNTRY ? ` in ${WANT_COUNTRY.toUpperCase()}` : "") +
      (WANT_CITY ? ` in ${WANT_CITY}` : "") +
      ` at concurrency ${CONCURRENCY}…\n`,
  );

  const results: Result[] = [];
  await pool(rows, CONCURRENCY, async (row) => {
    results.push(await probe(row));
  });
  results.sort((a, b) => a.name.localeCompare(b.name));

  const findings = results.filter(
    (r) =>
      r.verdict === "MOVED" ||
      r.verdict === "MISMATCH" ||
      r.verdict === "FOR_SALE" ||
      r.verdict === "GONE",
  );
  const unsure = results.filter((r) => r.verdict === "NO_NAME");
  const blocked = results.filter((r) => r.verdict === "BLOCKED");

  if (findings.length) {
    console.log("FINDINGS — each of these is a company whose domain no longer describes it:\n");
    for (const r of findings) {
      console.log(`  ${LABEL[r.verdict]} ${r.name}`);
      console.log(`         ${r.id} · ${r.host} · ${r.note}`);
    }
    console.log("");
  }

  if (unsure.length) {
    console.log(`Answered but never named themselves (${unsure.length}) — usually a tagline,`);
    console.log("sometimes a wrong domain. Worth a skim, not a fix list:\n");
    for (const r of unsure.slice(0, 40)) console.log(`  ${r.name} — ${r.host} — ${r.note}`);
    if (unsure.length > 40) console.log(`  …and ${unsure.length - 40} more`);
    console.log("");
  }

  if (WITH_LOGOS) {
    console.log("Fetching badges for the collision pass…");
    const collisions = await logoCollisions(rows);
    if (collisions.length) {
      console.log("\nTWO COMPANIES SHARING ONE BADGE — at least one of them is wrong:\n");
      for (const c of collisions) console.log("  " + c);
    } else {
      console.log("  no unrelated companies share a badge.");
    }
    console.log("");
  }

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    "Summary: " +
      Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(" · "),
  );
  console.log(
    `\n${blocked.length} host(s) refused this machine and are reported as inconclusive, not as` +
      "\nfindings — a WAF and a dead company return the same status, and only one is real.",
  );

  if (JSON_OUT) {
    await Bun.write(JSON_OUT, JSON.stringify(results, null, 1));
    console.log(`\nFull results written to ${JSON_OUT}`);
  }

  await Bun.$`rm -rf ${TMP}`.quiet();

  // Exit 0 unless asked otherwise. See the header: this must never gate a build.
  if (STRICT && findings.length) process.exit(1);
}

await main();
