/**
 * Invariants for the talent-flow card (summariseCompanyFlows in
 * src/employsi/lib/flows.ts).
 *
 * Same class of bug as the other check-*.ts scripts: every way this can go
 * wrong still renders a tidy list of companies with plausible numbers. A
 * nowcast summed into measured moves, a flow of three people itemised, a
 * period label naming the window requested rather than the one summed — none
 * of them would look broken on the card.
 *
 * The rows below are SYNTHETIC. They exist to exercise the rules, and match
 * nothing in D1.
 *
 * Run: bun run scripts/check-flows.ts
 */
import {
  FLOW_MIN_MOVES,
  buildFlowView,
  hasVisibleFlows,
  summariseCompanyFlows,
  type CountKind,
  type FlowImport,
  type FlowRow,
} from "../src/employsi/lib/flows";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const IMP: FlowImport = {
  import_id: "synthetic|2026-01-15|000000000000",
  source: "synthetic",
  method: "company-to-company, any gap",
  scope: "all pairs",
  delivered: "2026-01-15",
  top_n: null,
};

function row(
  from: string | null,
  to: string | null,
  moves: number,
  opts: { start?: string; end?: string; kind?: CountKind; fromRef?: string; toRef?: string } = {},
): FlowRow {
  return {
    from_ref: opts.fromRef ?? `synthetic:${from ?? "off"}`,
    from_name: from ?? "Off-roster Pty Ltd",
    to_ref: opts.toRef ?? `synthetic:${to ?? "off"}`,
    to_name: to ?? "Off-roster Pty Ltd",
    from_id: from,
    to_id: to,
    period_start: opts.start ?? "2025-01-01",
    period_end: opts.end ?? "2025-12-31",
    moves,
    count_kind: opts.kind ?? "observed",
  };
}

// ── suppression ─────────────────────────────────────────────────────────────
{
  const f = summariseCompanyFlows("bhp", IMP, [
    row("rio", "bhp", 40),
    row("wds", "bhp", FLOW_MIN_MOVES - 1),
    row("bhp", "fmg", FLOW_MIN_MOVES),
    row("bhp", "wds", 3),
  ])!;
  check(
    "suppression: a pair under the floor is never itemised",
    !f.gainedFrom.some((s) => s.companyId === "wds") &&
      !f.lostTo.some((s) => s.companyId === "wds"),
    f,
  );
  check(
    "suppression: exactly the floor is shown",
    f.lostTo.some((s) => s.companyId === "fmg"),
    f.lostTo,
  );
  check(
    "suppression: held-back pairs and moves are counted",
    f.suppressed.pairs === 2 && f.suppressed.moves === FLOW_MIN_MOVES - 1 + 3,
    f.suppressed,
  );
}

// ── no mixing ───────────────────────────────────────────────────────────────
{
  const f = summariseCompanyFlows("bhp", IMP, [
    row("rio", "bhp", 20, { kind: "observed" }),
    row("rio", "bhp", 500, { kind: "nowcast" }),
    row("wds", "bhp", 30, { kind: "weighted" }),
  ])!;
  check("mixing: one count kind per summary", f.countKind === "weighted", f.countKind);
  check(
    "mixing: observed rows are not summed into a weighted summary",
    f.gainedFrom.length === 1 && f.gainedFrom[0].moves === 30,
    f.gainedFrom,
  );
  const onlyNowcast = summariseCompanyFlows("bhp", IMP, [
    row("rio", "bhp", 500, { kind: "nowcast" }),
  ]);
  check("mixing: an estimate alone is never drawn as measured", onlyNowcast === null, onlyNowcast);
}

// ── the period drawn ────────────────────────────────────────────────────────
{
  // Monthly rows over 18 months: the card sums the trailing 12 and says so.
  const monthly: FlowRow[] = [];
  for (let i = 0; i < 18; i++) {
    const y = 2024 + Math.floor((6 + i) / 12);
    const m = ((6 + i) % 12) + 1;
    const mm = String(m).padStart(2, "0");
    monthly.push(row("rio", "bhp", 2, { start: `${y}-${mm}-01`, end: `${y}-${mm}-28` }));
  }
  const f = summariseCompanyFlows("bhp", IMP, monthly)!;
  check(
    "period: monthly delivery summed over the trailing 12 months only",
    f.gainedFrom[0]?.moves === 24,
    f.gainedFrom,
  );
  check(
    "period: reported span is the one summed",
    f.period.start === "2025-01-01" && f.period.end === "2025-12-28",
    f.period,
  );
  const single = summariseCompanyFlows("bhp", IMP, [
    row("rio", "bhp", 12, { start: "2024-07-01", end: "2026-06-30" }),
  ])!;
  check(
    "period: a single-period delivery passes through whole",
    single.period.start === "2024-07-01" && single.period.end === "2026-06-30",
    single.period,
  );
}

// ── truncation, samples, absence ───────────────────────────────────────────
{
  const f = summariseCompanyFlows("bhp", { ...IMP, top_n: 25, scope: "base company" }, [
    row("rio", "bhp", 40),
  ])!;
  check("truncation: the vendor's top-N is carried to the card", f.truncatedBySource === 25, f);

  const s = summariseCompanyFlows(
    "bhp",
    { ...IMP, scope: "sampled profiles" },
    [row("rio", "bhp", 11, { kind: "sampled" })],
    380,
  )!;
  check("sample: sample size carried for a sampled source", s.sampleProfiles === 380, s);
  const o = summariseCompanyFlows("bhp", IMP, [row("rio", "bhp", 11)], 380)!;
  check("sample: never attached to a measured source", o.sampleProfiles === null, o);

  check(
    "absence: no rows for the company means no section",
    summariseCompanyFlows("bhp", IMP, [row("rio", "wds", 50)]) === null,
  );
  const allSmall = summariseCompanyFlows("bhp", IMP, [row("rio", "bhp", 2)]);
  check(
    "absence: everything suppressed still reports what was held back",
    allSmall !== null && !hasVisibleFlows(allSmall) && allSmall.suppressed.moves === 2,
    allSmall,
  );
}

// ── identity ───────────────────────────────────────────────────────────────
{
  const f = summariseCompanyFlows("bhp", IMP, [
    row(null, "bhp", 15, { fromRef: "synthetic:acme" }),
    row("bhp", "bhp", 99, { fromRef: "synthetic:bhp-old", toRef: "synthetic:bhp" }),
    row("rio", "bhp", 6, { fromRef: "synthetic:rio-a" }),
    row("rio", "bhp", 6, { fromRef: "synthetic:rio-b" }),
  ])!;
  check(
    "identity: an off-roster company is listed by name with no link",
    f.gainedFrom.some((s) => s.companyId === null && s.moves === 15),
    f.gainedFrom,
  );
  check(
    "identity: two refs for the same company are not a move to itself",
    !f.gainedFrom.some((s) => s.companyId === "bhp") &&
      !f.lostTo.some((s) => s.companyId === "bhp"),
    f,
  );
  check(
    "identity: two vendor refs for one roster company merge before the floor",
    f.gainedFrom.some((s) => s.companyId === "rio" && s.moves === 12) && f.suppressed.pairs === 0,
    f,
  );
}

// ── the talent-flow view (design "Talent Flows 3D") ─────────────────────────
{
  const S: FlowImport = { ...IMP, source: "sampled", scope: "sampled profiles" };
  const r = (from: string | null, to: string | null, moves: number, ref?: string) =>
    row(from, to, moves, { kind: "sampled", fromRef: ref, toRef: undefined });
  const rows = [
    r("rio", "bhp", 40),
    r("fmg", "bhp", 12),
    r("mnd", "bhp", 11), // on the map, not sampled
    r("mnd", "bhp", 3, "synthetic:mnd-2"), // a second ref for the same company
    r(null, "bhp", 30, "synthetic:thiess"), // off the map
    r("s32", "bhp", 4), // under the floor
    r("bhp", "rio", 25),
    r("bhp", "fmg", 6), // sampled destination, under the floor
    r("bhp", "mnd", 50), // non-sampled destination: not measured
  ];
  const sampled = new Set(["bhp", "rio", "fmg"]);
  const v = buildFlowView("bhp", S, rows, sampled, 9696)!;
  const peer = (id: string) => v.peers.find((p) => p.companyId === id);
  check(
    "view: a company whose staff were not sampled cannot be the focus",
    buildFlowView("mnd", S, rows, sampled, null) === null,
  );
  check(
    "view: inflow is itemised from on-map companies at or over the floor",
    peer("rio")?.in === 40 && peer("fmg")?.in === 12 && peer("mnd")?.in === 14,
    v.peers,
  );
  check(
    "view: under the floor or off the map goes to other, whole",
    !peer("s32") && v.other.in.moves === 34 && v.other.in.companies === 2,
    v.other,
  );
  check(
    "view: outflow is only measured to sampled companies",
    peer("rio")?.out === 25 && peer("mnd")?.out === null && v.totals.out === 31,
    v,
  );
  check(
    "view: a sampled destination under the floor is not printed",
    peer("fmg")?.out === null && v.other.out.moves === 6,
    v,
  );
  check(
    "view: totals include what other holds",
    v.totals.in === 100 && v.peers.reduce((a, p) => a + p.in, 0) + v.other.in.moves === v.totals.in,
    v.totals,
  );
  check(
    "view: the caption says sampled moves, the period and the rules",
    /Moves among 9,696 sampled/.test(v.caption) &&
      /Jan 2025 – Dec 2025/.test(v.caption) &&
      /fewer than 10 moves/.test(v.caption),
    v.caption,
  );
  check("view: biggest peer first", v.peers[0]?.companyId === "rio", v.peers);
  const sv = buildFlowView("bhp", S, rows.slice(0, 2), sampled, 5000, "Geology")!;
  check(
    "view: a skill view says which skill and its own sample",
    sv.skill === "Geology" &&
      /into roles matching Geology/.test(sv.caption) &&
      sv.sampleProfiles === 5000,
    sv,
  );
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall talent-flow card checks passed");
