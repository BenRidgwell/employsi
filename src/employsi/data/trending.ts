// What's Trending — the shapes the pane's rows are built from.
//
// This file used to also carry hand-written figures: a MOST_VIEWED snapshot
// reading "BHP · 18% of views" and a TREND_SECTIONS board of movers with
// placeholder deltas ("Autonomous Haulage +34.0%"). Both were the fallback for
// a pane that had nothing measured to show.
//
// The pane now leads with priced skills read from the archive, so an invented
// percentage below them would be indistinguishable from the measured ones —
// which is the failure mode this codebase guards hardest against. The seeds are
// gone and the pane renders an empty state instead. Only the row's shape is
// still needed here.

/** A row in the "Most viewed" snapshot, written by useViewTracking → D1. */
export interface ViewedItem {
  kind: "company" | "continent" | "skill";
  label: string;
  sub: string;
  share: string;
  ticker?: string;
  skill?: string;
}
