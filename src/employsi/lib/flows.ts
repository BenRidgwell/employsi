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

// ── The talent-flow VIEW (design: "Talent Flows 3D") ─────────────────────────
//
// The map view shows one focus company, the companies it hires from and loses
// people to as pins, and a panel listing them. It has three modes (inflow,
// outflow, net) and a skill search. buildFlowView() is exactly what that
// design reads, built from one import's rows, with the rules above:
//
//   * Only a company whose own staff were sampled can be the focus. The
//     source reads CURRENT employees of each seed, so its inflow is measured
//     only for seeds. A non-seed "focus" would show the few people who passed
//     through it on the way to a seed, which is not its inflow.
//   * Outflow is only measured to another SEED. A move out of the focus shows
//     up only when that person is now employed by a sampled company, so a
//     non-seed peer's outflow would be the handful who later reached a seed.
//     Those peers get `out: null`, and net is computed only where both
//     sides are measured.
//   * A peer is a company ON THE MAP (a roster id) with at least
//     FLOW_MIN_MOVES in one direction. Everything else is summed into
//     `other`, which says how many companies and moves it holds, so the
//     totals the panel prints stay whole.
//   * One period, the one the delivery was exported over. The design's
//     scrubbable 2006–2026 timeline is not drawn from this: the sample is
//     today's employees, so earlier windows shrink for that reason alone
//     (docs/talent-flows-plan.md, rule 11).
//   * The caption says what the numbers are: moves among N sampled profiles,
//     not "people who joined".

export interface FlowPeer {
  companyId: string;
  name: string;
  in: number; // moves from this company into the focus; 0 when under the floor
  out: number | null; // null = not measured (the peer is not a sampled company)
}

export interface FlowView {
  focus: { companyId: string; name: string };
  skill: string | null;
  source: string;
  method: string;
  countKind: CountKind;
  delivered: string;
  period: { start: string; end: string };
  sampleProfiles: number | null;
  sampledCompanies: string[]; // company ids whose current staff are the sample
  peers: FlowPeer[]; // on the map, >= the floor in one direction; biggest first
  other: {
    in: { companies: number; moves: number };
    out: { companies: number; moves: number };
  };
  totals: { in: number; out: number }; // everything, including `other`
  caption: string;
}

/** A row as read for the view: flows or flow_skills (the skill is filtered in SQL). */
export type ViewRow = FlowRow;

function monthLabel(iso: string): string {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/**
 * The view for one focus company from one import. `rows` are that import's
 * rows touching the focus (flow_skills rows for one skill when `skill` is
 * given); `sampled` is the set of company ids with a sample in the import
 * (flow_sample, or flow_skill_sample for a skill view), and `sampleProfiles`
 * is the focus's own sample size.
 *
 * Null when the focus was not sampled or nothing measured touches it: the
 * view then says there is no flow data for that company, rather than drawing
 * a partial one.
 */
export function buildFlowView(
  focusId: string,
  imp: FlowImport,
  rows: ViewRow[],
  sampled: Set<string>,
  sampleProfiles: number | null,
  skill: string | null = null,
  minMoves: number = FLOW_MIN_MOVES,
): FlowView | null {
  if (!sampled.has(focusId)) return null;
  const touching = rows.filter((r) => r.from_id === focusId || r.to_id === focusId);
  const kind = KIND_PREFERENCE.find((k) => touching.some((r) => r.count_kind === k));
  if (!kind) return null;
  const used = touching.filter((r) => r.count_kind === kind && r.from_id !== r.to_id);
  if (!used.length) return null;
  const start = used.reduce(
    (m, r) => (r.period_start < m ? r.period_start : m),
    used[0].period_start,
  );
  const end = used.reduce((m, r) => (r.period_end > m ? r.period_end : m), used[0].period_end);

  // Sum each direction per counterpart, merging refs that resolve to one
  // roster company (as summariseCompanyFlows does).
  type Acc = { id: string | null; name: string; moves: number };
  const inBy = new Map<string, Acc>();
  const outBy = new Map<string, Acc>();
  let focusName = "";
  for (const r of used) {
    const inbound = r.to_id === focusId;
    if (inbound && !focusName) focusName = r.to_name;
    if (!inbound && !focusName) focusName = r.from_name;
    const otherId = inbound ? r.from_id : r.to_id;
    const key = otherId ? `id:${otherId}` : inbound ? r.from_ref : r.to_ref;
    const map = inbound ? inBy : outBy;
    const cur = map.get(key) ?? { id: otherId, name: inbound ? r.from_name : r.to_name, moves: 0 };
    cur.moves += r.moves;
    map.set(key, cur);
  }

  const totals = { in: 0, out: 0 };
  for (const a of inBy.values()) totals.in += a.moves;
  // Outflow total: only to sampled companies, the only outflow measured.
  for (const a of outBy.values()) if (a.id && sampled.has(a.id)) totals.out += a.moves;

  const peers = new Map<string, FlowPeer>();
  for (const a of inBy.values()) {
    if (a.id && a.moves >= minMoves)
      peers.set(a.id, { companyId: a.id, name: a.name, in: a.moves, out: null });
  }
  for (const a of outBy.values()) {
    if (!a.id || !sampled.has(a.id) || a.moves < minMoves) continue;
    const p = peers.get(a.id) ?? { companyId: a.id, name: a.name, in: 0, out: null };
    p.out = a.moves;
    peers.set(a.id, p);
  }
  // A sampled peer that made the list on one side has a MEASURED other side,
  // even when it is small: report it, but only if it clears the floor too,
  // otherwise it stays at 0/null so no number under the floor is printed.
  const list = [...peers.values()].sort(
    (a, b) =>
      Math.max(b.in, b.out ?? 0) - Math.max(a.in, a.out ?? 0) || a.name.localeCompare(b.name),
  );
  const shown = new Set(list.map((p) => p.companyId));
  const other = { in: { companies: 0, moves: 0 }, out: { companies: 0, moves: 0 } };
  for (const a of inBy.values()) {
    if (a.id && shown.has(a.id) && (peers.get(a.id)!.in || 0) > 0) continue;
    other.in.companies += 1;
    other.in.moves += a.moves;
  }
  for (const a of outBy.values()) {
    if (!a.id || !sampled.has(a.id)) continue;
    if (shown.has(a.id) && peers.get(a.id)!.out !== null) continue;
    other.out.companies += 1;
    other.out.moves += a.moves;
  }

  const n = sampleProfiles ? sampleProfiles.toLocaleString("en-AU") : null;
  const who = n ? `${n} sampled ${focusName} profiles` : `sampled ${focusName} profiles`;
  const caption =
    `Moves among ${who}${skill ? ` into roles matching ${skill}` : ""}, ` +
    `${monthLabel(start)} – ${monthLabel(end)}. Companies with fewer than ${minMoves} moves, ` +
    `or not on the map, are grouped as other. Outflow is only measured to companies whose own ` +
    `staff were sampled.`;

  return {
    focus: { companyId: focusId, name: focusName },
    skill,
    source: imp.source,
    method: imp.method,
    countKind: kind,
    delivered: imp.delivered,
    period: { start, end },
    sampleProfiles: kind === "sampled" ? sampleProfiles : null,
    sampledCompanies: [...sampled].sort(),
    peers: list,
    other,
    totals,
    caption,
  };
}
