/**
 * The compare view's model, from `Employsi Compare View.html`.
 *
 * The design compares one employer against a peer and a benchmark, through a
 * chosen skill lens: head-to-head metric bars, an indexed vacancy trend, a
 * percentile marker, a skill-mix grid and three written takeaways.
 *
 * Two of the design's cells are built on data we do not have, and are omitted
 * rather than filled:
 *
 *   - **Time to hire.** `Company.timeToFill` is generated from a hash of the
 *     company id, not measured. It is dropped from the metric list.
 *   - **The benchmark's own vacancy line.** The trend chart's dashed benchmark
 *     needs a daily vacancy series per sector; the D1 archive stores listings
 *     per company and only began on 2026-07-20, so a sector-wide daily line
 *     would be an average of a handful of days. The two employer lines are
 *     drawn from their real archives and the dashed line is omitted.
 *
 * The percentile IS computed — but against the employers this map actually
 * tracks, not "all employers", and it says so in its own caption. A narrow,
 * named population is a real answer; an implied national one would not be.
 *
 * Peers are drawn from the same country as the subject. Median salary is held
 * in each company's local currency, so a cross-border median comparison would
 * be comparing numbers in different units.
 */

import { COMPANIES, type Company } from "../data/companies";
import { CITY_COUNTRY } from "../data/mapboxWorldGeo";
import { cityForCompany } from "../data/mapboxGeo";
import type { SkillIndex } from "./skillsFn";
import type { RolePoint } from "./openRolesFn";

export interface CompareMetric {
  name: string;
  aLabel: string;
  bLabel: string;
  gap: string;
  /** "up" reads as the subject leading, "down" trailing, "flat" level. */
  tone: "up" | "down" | "flat";
  aPct: string;
  bPct: string;
  benchPct: string | null;
  /** Signed metrics (headcount YoY) draw from a zero line, not from the left. */
  signed: boolean;
  zeroPct: string;
  aFrom: string;
  aWide: string;
  bFrom: string;
  bWide: string;
}

export interface CompareTrendLine {
  path: string;
  delta: string;
  up: boolean;
}

export interface CompareTrend {
  a: CompareTrendLine | null;
  b: CompareTrendLine | null;
  area: string;
  axis: string[];
  /** Set when neither employer has enough archive to draw. */
  note: string | null;
}

export interface CompareMixRow {
  name: string;
  aLabel: string;
  bLabel: string;
  aPct: string;
  bPct: string;
  benchPct: string;
}

export interface CompareTakeaway {
  tag: string;
  tone: "up" | "down" | "flat";
  text: string;
}

export interface CompareCard {
  a: Company;
  b: Company | null;
  peers: { id: string; name: string; sel: boolean }[];
  benchLabel: string;
  benchmarks: { key: string; name: string; sel: boolean }[];
  lens: string;
  skillLens: string[];
  metrics: CompareMetric[];
  trend: CompareTrend;
  percentile: { aPct: string; bPct: string | null; aLabel: string; note: string } | null;
  mix: CompareMixRow[];
  takeaways: CompareTakeaway[];
}

const VB_W = 420;
const PEERS_SHOWN = 4;
const LENS_SHOWN = 5;
const MIX_ROWS = 6;
/** Below this many days an indexed trend is noise, not a trend. */
const MIN_TREND_DAYS = 14;

export type BenchKey = "sector" | "country" | "all";

function ord(n: number): string {
  const m = n % 100;
  if (m >= 11 && m <= 13) return `${n}th`;
  return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
}

function signed(v: number, unit = "%"): string {
  return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(unit === "pp" ? 1 : 0) + unit;
}

function countryOf(c: Company): string {
  return CITY_COUNTRY[cityForCompany(c.id)] ?? "";
}

/** Peers: same country (so salary is in one currency), nearest in size. */
export function peersFor(a: Company): Company[] {
  const home = countryOf(a);
  const sameSector = COMPANIES.filter(
    (c) => c.id !== a.id && countryOf(c) === home && c.sector === a.sector,
  );
  const pool = sameSector.length
    ? sameSector
    : COMPANIES.filter((c) => c.id !== a.id && countryOf(c) === home && c.group === a.group);
  return pool
    .slice()
    .sort((x, y) => Math.abs(x.headcount - a.headcount) - Math.abs(y.headcount - a.headcount))
    .slice(0, PEERS_SHOWN);
}

function benchPopulation(a: Company, key: BenchKey): Company[] {
  const home = countryOf(a);
  if (key === "sector") return COMPANIES.filter((c) => c.sector === a.sector);
  if (key === "country") return COMPANIES.filter((c) => countryOf(c) === home);
  return COMPANIES.slice();
}

function benchName(a: Company, key: BenchKey): string {
  if (key === "sector") return a.sector;
  if (key === "country") return (countryOf(a) || "market").toUpperCase();
  return "All tracked";
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}

interface MetricDef {
  key: string;
  name: string;
  of: (c: Company) => number | null;
  fmt: (v: number) => string;
  higherIsBetter: boolean;
  signed?: boolean;
  /** Gap expressed in points rather than percent. */
  pp?: boolean;
}

const METRICS: MetricDef[] = [
  {
    key: "openRoles",
    name: "Open roles",
    of: (c) => c.openRoles,
    fmt: (v) => Math.round(v).toLocaleString("en-AU"),
    higherIsBetter: true,
  },
  {
    key: "salary",
    name: "Median salary",
    of: (c) => c.salaryNum,
    fmt: (v) => "$" + Math.round(v / 1000) + "k",
    higherIsBetter: true,
  },
  {
    key: "headcount",
    name: "Headcount",
    of: (c) => c.headcount,
    fmt: (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : String(Math.round(v))),
    higherIsBetter: true,
  },
  {
    key: "growth",
    name: "Headcount growth · YoY",
    of: (c) => c.growth,
    fmt: (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + "%",
    higherIsBetter: true,
    signed: true,
    pp: true,
  },
];

function plotIndexed(vals: number[], lo: number, hi: number): string {
  const span = hi - lo || 1;
  return vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * (VB_W - 6) + 3;
      const y = 128 - ((v - lo) / span) * 104;
      return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    })
    .join(" ");
}

/** Rebase a series to 100 at its first point, so two employers of very
 *  different size can be read on one axis. */
function indexed(pts: RolePoint[]): number[] {
  if (pts.length < 2 || !pts[0].c) return [];
  return pts.map((p) => (p.c / pts[0].c) * 100);
}

function shortDay(iso: string): string {
  const t = Date.parse(iso + "T00:00:00Z");
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export interface CompareInputs {
  a: Company;
  b: Company | null;
  bench: BenchKey;
  lens: string | null;
  index: SkillIndex | null;
  aTrend: RolePoint[];
  bTrend: RolePoint[];
}

export function buildCompareCard(input: CompareInputs): CompareCard {
  const { a, b, bench, index } = input;
  const peers = peersFor(a);
  const pop = benchPopulation(a, bench);
  const benchLabel = benchName(a, bench);

  // ── skill lens ──────────────────────────────────────────────────────────
  // The skills these two actually advertise, most-advertised first — not a
  // fixed list, so the lens is always something at least one of them hires.
  const skillTotals: Record<string, number> = {};
  if (index) {
    for (const [name, agg] of Object.entries(index.skills)) {
      const n = (agg.byCompany[a.id] || 0) + (b ? agg.byCompany[b.id] || 0 : 0);
      if (n > 0) skillTotals[name] = n;
    }
  }
  const skillLens = Object.entries(skillTotals)
    .sort((x, y) => y[1] - x[1])
    .slice(0, LENS_SHOWN)
    .map(([name]) => name);
  const lens = input.lens && skillLens.includes(input.lens) ? input.lens : (skillLens[0] ?? "");

  // ── head-to-head metrics ────────────────────────────────────────────────
  const metrics: CompareMetric[] = [];
  for (const m of METRICS) {
    const av = m.of(a);
    const bv = b ? m.of(b) : null;
    if (av == null || bv == null) continue;
    const kv = mean(pop.map((c) => m.of(c) ?? 0).filter((v) => v !== 0));
    const rel = m.pp ? av - bv : bv ? ((av - bv) / Math.abs(bv)) * 100 : 0;
    const flat = Math.abs(rel) < (m.pp ? 0.2 : 0.5);
    const good = m.higherIsBetter ? rel > 0 : rel < 0;
    const scale = Math.max(av, bv, kv) * 1.18 || 1;
    const lo = Math.min(0, av, bv, kv);
    const hi = Math.max(av, bv, kv);
    const dspan = (hi - lo) * 1.12 || 1;
    const dpos = (v: number) => ((v - lo) / dspan) * 100;
    metrics.push({
      name: m.name,
      aLabel: m.fmt(av),
      bLabel: m.fmt(bv),
      gap: signed(rel, m.pp ? "pp" : "%"),
      tone: flat ? "flat" : good ? "up" : "down",
      aPct: Math.max(2, (av / scale) * 100).toFixed(1) + "%",
      bPct: Math.max(2, (bv / scale) * 100).toFixed(1) + "%",
      benchPct: kv ? Math.min(98, (kv / scale) * 100).toFixed(1) + "%" : null,
      signed: !!m.signed,
      zeroPct: dpos(0).toFixed(1) + "%",
      aFrom: Math.min(dpos(0), dpos(av)).toFixed(1) + "%",
      aWide: Math.abs(dpos(av) - dpos(0)).toFixed(1) + "%",
      bFrom: Math.min(dpos(0), dpos(bv)).toFixed(1) + "%",
      bWide: Math.abs(dpos(bv) - dpos(0)).toFixed(1) + "%",
    });
  }

  // ── indexed vacancy trend ───────────────────────────────────────────────
  const aS = input.aTrend.length >= MIN_TREND_DAYS ? indexed(input.aTrend) : [];
  const bS = input.bTrend.length >= MIN_TREND_DAYS ? indexed(input.bTrend) : [];
  const all = aS.concat(bS);
  const lo = all.length ? Math.min(...all) - 1.5 : 0;
  const hi = all.length ? Math.max(...all) + 1.5 : 1;
  const lineOf = (s: number[]): CompareTrendLine | null => {
    if (s.length < 2) return null;
    const chg = s[s.length - 1] - s[0];
    return {
      path: plotIndexed(s, lo, hi),
      delta: (chg >= 0 ? "+" : "−") + Math.abs(chg).toFixed(1) + "%",
      up: chg >= 0,
    };
  };
  const longest = input.aTrend.length >= input.bTrend.length ? input.aTrend : input.bTrend;
  const axis =
    longest.length >= 2
      ? [0, 1, 2, 3].map((i) => shortDay(longest[Math.round((i / 3) * (longest.length - 1))].d))
      : [];
  const trend: CompareTrend = {
    a: lineOf(aS),
    b: lineOf(bS),
    area:
      aS.length >= 2
        ? "M0 142 L" +
          aS
            .map(
              (v, i) =>
                ((i / (aS.length - 1)) * (VB_W - 6) + 3).toFixed(1) +
                " " +
                (128 - ((v - lo) / (hi - lo || 1)) * 104).toFixed(1),
            )
            .join(" L") +
          ` L${VB_W} 142 Z`
        : "",
    axis,
    note:
      aS.length < 2 && bS.length < 2
        ? "Not enough vacancy history yet — the archive records forward from the first time an employer is queried, so this fills in over the coming weeks."
        : null,
  };

  // ── percentile for the lens skill ───────────────────────────────────────
  let percentile: CompareCard["percentile"] = null;
  if (index && lens) {
    const byCo = index.skills[lens]?.byCompany ?? {};
    const ranked = pop
      .map((c) => byCo[c.id] || 0)
      .filter((n) => n > 0)
      .sort((x, y) => x - y);
    const pctOf = (n: number) =>
      ranked.length < 2
        ? null
        : Math.round((ranked.filter((v) => v < n).length / ranked.length) * 100);
    const aP = pctOf(byCo[a.id] || 0);
    const bP = b ? pctOf(byCo[b.id] || 0) : null;
    if (aP != null) {
      percentile = {
        aPct: `${aP}%`,
        bPct: bP != null ? `${bP}%` : null,
        aLabel: `${a.ticker} ${ord(aP)}`,
        note:
          `${a.name} sits in the ${ord(aP)} percentile for ${lens} demand among the ` +
          `${ranked.length} ${benchLabel} employers this map tracks` +
          (bP != null ? ` — ${b?.name} is ${ord(bP)}.` : ".") +
          " A ranking against every employer in the market would need a vacancy census we don't hold.",
      };
    }
  }

  // ── skill mix ───────────────────────────────────────────────────────────
  const mix: CompareMixRow[] = [];
  if (index && b) {
    const share = (co: Company): Record<string, number> => {
      const out: Record<string, number> = {};
      let total = 0;
      for (const [name, agg] of Object.entries(index.skills)) {
        const n = agg.byCompany[co.id] || 0;
        if (n > 0) {
          out[name] = n;
          total += n;
        }
      }
      for (const k of Object.keys(out)) out[k] = (out[k] / (total || 1)) * 100;
      return out;
    };
    const aSh = share(a);
    const bSh = share(b);
    // Benchmark mix: the same share, taken over the whole population at once.
    const kRaw: Record<string, number> = {};
    let kTotal = 0;
    for (const [name, agg] of Object.entries(index.skills)) {
      let n = 0;
      for (const c of pop) n += agg.byCompany[c.id] || 0;
      if (n > 0) {
        kRaw[name] = n;
        kTotal += n;
      }
    }
    const names = Object.keys({ ...aSh, ...bSh })
      .sort((x, y) => (aSh[y] || 0) + (bSh[y] || 0) - ((aSh[x] || 0) + (bSh[x] || 0)))
      .slice(0, MIX_ROWS);
    for (const name of names) {
      const av = aSh[name] || 0;
      const bv = bSh[name] || 0;
      const kv = ((kRaw[name] || 0) / (kTotal || 1)) * 100;
      const scale = Math.max(av, bv, kv) * 1.2 || 1;
      mix.push({
        name,
        aLabel: `${av.toFixed(0)}%`,
        bLabel: `${bv.toFixed(0)}%`,
        aPct: ((av / scale) * 100).toFixed(1) + "%",
        bPct: ((bv / scale) * 100).toFixed(1) + "%",
        benchPct: ((kv / scale) * 100).toFixed(1) + "%",
      });
    }
  }

  // ── takeaways ───────────────────────────────────────────────────────────
  // Written from the metrics that resolved, so a takeaway never asserts a
  // comparison that was suppressed above.
  const takeaways: CompareTakeaway[] = [];
  if (b) {
    const sal = metrics.find((m) => m.name === "Median salary");
    if (sal && sal.tone !== "flat") {
      takeaways.push({
        tag: sal.tone === "up" ? "LEAD" : "GAP",
        tone: sal.tone,
        text: `${a.name} advertises a median of ${sal.aLabel} against ${b.name}'s ${sal.bLabel} — ${sal.gap} at the median.`,
      });
    }
    const roles = metrics.find((m) => m.name === "Open roles");
    if (roles) {
      const diff = b.openRoles - a.openRoles;
      takeaways.push({
        tag: diff > 0 ? "GAP" : "LEAD",
        tone: diff > 0 ? "down" : "up",
        text:
          diff > 0
            ? `${b.name} has ${diff.toLocaleString("en-AU")} more live roles, so ${a.name} is competing for the same people from a smaller footprint.`
            : `${a.name} has ${Math.abs(diff).toLocaleString("en-AU")} more live roles than ${b.name} right now.`,
      });
    }
    if (percentile && lens) {
      takeaways.push({
        tag: "WATCH",
        tone: "flat",
        text: `${lens} sits at the ${ord(parseInt(percentile.aPct))} percentile for ${a.name} against ${benchLabel}${percentile.bPct ? `, versus ${ord(parseInt(percentile.bPct))} for ${b.name}` : ""}.`,
      });
    }
  }

  return {
    a,
    b,
    peers: peers.map((p) => ({ id: p.id, name: p.name, sel: p.id === b?.id })),
    benchLabel,
    benchmarks: (["sector", "country", "all"] as BenchKey[]).map((k) => ({
      key: k,
      name: k === "sector" ? "Sector" : k === "country" ? "Country" : "All",
      sel: k === bench,
    })),
    lens,
    skillLens,
    metrics,
    trend,
    percentile,
    mix,
    takeaways,
  };
}
