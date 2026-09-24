// Talent flows: the rules that turn stored counts into what a card may show.
//
// Pure, with no framework or D1 import, so scripts/check-flows.ts can assert
// every rule without a Worker. flowsFn.ts is the thin D1 reader in front of it.
// Design and the reasoning behind each rule: docs/talent-flows-plan.md.
//
// The table holds COUNTS ONLY (workers/jobs-cron/migrations/0002_talent_flows.sql).
// Everything here is about not letting a count say more than it measured:
//
//   1. A pair under FLOW_MIN_MOVES is never itemised. It is rolled into
//      `suppressed`, so a thin flow is not read as a trend and cannot point at
//      one person.
//   2. One import, one count kind. Estimates (`nowcast`) are never summed
//      with measured moves, and nothing here combines two deliveries.
//   3. The period reported is the span of the rows actually summed, never the
//      one asked for.
//   4. A list the vendor truncated says so, and no total is derived from it.
//   5. A sampled source carries its sample size, so the card says "among N
//      profiles" instead of implying a workforce total.

/** Below this many moves a pair is not shown. See the plan's open question 2. */
export const FLOW_MIN_MOVES = 10;

/** Monthly deliveries are summed over at most this many trailing months. */
export const FLOW_WINDOW_MONTHS = 12;

export type CountKind = "observed" | "weighted" | "sampled" | "nowcast";

/** Measured kinds, most informative first. `nowcast` is deliberately absent:
 *  it is an estimate and never drawn as if measured. */
const KIND_PREFERENCE: CountKind[] = ["weighted", "observed", "sampled"];

export interface FlowImport {
  import_id: string;
  source: string;
  method: string;
  scope: string; // all pairs | base company | sampled profiles
  delivered: string;
  top_n: number | null;
}

export interface FlowRow {
  from_ref: string;
  from_name: string;
  to_ref: string;
  to_name: string;
  from_id: string | null;
  to_id: string | null;
  period_start: string; // YYYY-MM-DD
  period_end: string;
  moves: number;
  count_kind: CountKind;
}

export interface FlowSide {
  companyId: string | null; // null = not on the map; shown by name, no link
  name: string;
  moves: number;
}

export interface CompanyFlows {
  companyId: string;
  source: string;
  method: string;
  scope: string;
  delivered: string;
  countKind: CountKind;
  period: { start: string; end: string }; // the span actually summed
  gainedFrom: FlowSide[]; // biggest first, suppressed rows removed
  lostTo: FlowSide[];
  suppressed: { pairs: number; moves: number };
  truncatedBySource: number | null; // the vendor's top-N, when it capped the list
  sampleProfiles: number | null; // profiles this company's numbers rest on
}

function monthIndex(isoDate: string): number {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return y * 12 + (m - 1);
}

/**
 * What one company's card shows from one import. `rows` must all belong to
 * that import (flowsFn selects them so); `sampleProfiles` is flow_sample's
 * figure for this company, when the source is a sample.
 *
 * Null when the import has nothing measured about this company — the card
 * then renders no section at all, rather than an empty one.
 */
export function summariseCompanyFlows(
  companyId: string,
  imp: FlowImport,
  rows: FlowRow[],
  sampleProfiles: number | null = null,
  minMoves: number = FLOW_MIN_MOVES,
): CompanyFlows | null {
  const touching = rows.filter((r) => r.from_id === companyId || r.to_id === companyId);
  const kind = KIND_PREFERENCE.find((k) => touching.some((r) => r.count_kind === k));
  if (!kind) return null;
  let used = touching.filter((r) => r.count_kind === kind && r.from_ref !== r.to_ref);

  // Monthly deliveries: the trailing FLOW_WINDOW_MONTHS, ending at the last
  // month the delivery holds. A single-period delivery (a 12-month report, a
  // sample window) passes through whole — its period is what it is.
  const lastEnd = used.reduce((m, r) => (r.period_end > m ? r.period_end : m), "");
  const floor = monthIndex(lastEnd) - (FLOW_WINDOW_MONTHS - 1);
  const periods = new Set(used.map((r) => `${r.period_start}|${r.period_end}`));
  if (periods.size > 1) used = used.filter((r) => monthIndex(r.period_start) >= floor);
  if (!used.length) return null;

  const start = used.reduce(
    (m, r) => (r.period_start < m ? r.period_start : m),
    used[0].period_start,
  );
  const end = used.reduce((m, r) => (r.period_end > m ? r.period_end : m), used[0].period_end);

  const suppressed = { pairs: 0, moves: 0 };
  const side = (dir: "in" | "out"): FlowSide[] => {
    const by = new Map<string, FlowSide>();
    for (const r of used) {
      const mine = dir === "in" ? r.to_id === companyId : r.from_id === companyId;
      if (!mine) continue;
      const ref = dir === "in" ? r.from_ref : r.to_ref;
      const other = dir === "in" ? r.from_id : r.to_id;
      if (other === companyId) continue; // two refs for one company: not a move
      const name = dir === "in" ? r.from_name : r.to_name;
      // Merge by roster company where there is one: a vendor can know one
      // employer under two ids ("BHP", "BHP Group"), and the floor applies to
      // the company, not to how the vendor happened to split it. Off-roster
      // companies have nothing better than the vendor's ref.
      const key = other ? `id:${other}` : ref;
      const cur = by.get(key) ?? { companyId: other, name, moves: 0 };
      cur.moves += r.moves;
      by.set(key, cur);
    }
    const out: FlowSide[] = [];
    for (const s of by.values()) {
      if (s.moves < minMoves) {
        suppressed.pairs += 1;
        suppressed.moves += s.moves;
      } else {
        out.push(s);
      }
    }
    return out.sort((a, b) => b.moves - a.moves || a.name.localeCompare(b.name));
  };
  const gainedFrom = side("in");
  const lostTo = side("out");

  return {
    companyId,
    source: imp.source,
    method: imp.method,
    scope: imp.scope,
    delivered: imp.delivered,
    countKind: kind,
    period: { start, end },
    gainedFrom,
    lostTo,
    suppressed,
    truncatedBySource: imp.top_n ?? null,
    sampleProfiles: kind === "sampled" ? sampleProfiles : null,
  };
}

/** True when there is something to draw. A summary where every pair was
 *  suppressed still exists — the card says how much was held back — but a
 *  caller deciding whether to show a map arc should use this. */
export function hasVisibleFlows(f: CompanyFlows | null): boolean {
  return !!f && (f.gainedFrom.length > 0 || f.lostTo.length > 0);
}
