import { useEffect, useRef } from "react";
import { useAppStore } from "../state/store";
import { track } from "../lib/analytics";

/**
 * How much each main feature is used, and how the app's time splits between
 * the supply and the demand side.
 *
 * WHAT IS RECORDED, AND WHY IN TWO EVENTS RATHER THAN ONE
 *   panel_open   fired when a feature opens. This is the "times opened" count.
 *   panel_close  fired when it closes, carrying how long it was open.
 *
 * One event on close carrying both would have been simpler, and is wrong: a
 * person who opens a panel and then closes the TAB never fires a close, so the
 * open would vanish too and the count would under-report by exactly the
 * sessions that ended abruptly — which is most of them. Splitting it means
 * opens are complete and durations are best-effort, which is the honest
 * division. The console says so where it shows them.
 *
 * ONLY ONE PANEL IS OPEN AT A TIME. The store's `solo` helper enforces it, so
 * a single "what is open now" slot is enough and a map of timers would be
 * machinery for a state that cannot happen.
 *
 * THE MODE SPLIT is measured the same way: the clock starts when the app
 * settles on supply or demand and the elapsed time is banked when it changes,
 * on unmount, and when the tab is hidden. Without the hidden case a tab left
 * open on the demand side for a weekend would report a weekend of demand; the
 * server also clamps every duration, which is the backstop rather than the fix.
 */

/** Store flag → the id the console groups by. Order is the display order. */
const FEATURES: {
  flag: "trendingOpen" | "analystOpen" | "flowsOpen" | "careerOpen";
  id: string;
}[] = [
  { flag: "trendingOpen", id: "trending" },
  { flag: "analystOpen", id: "analyst" },
  { flag: "flowsOpen", id: "flows" },
  { flag: "careerOpen", id: "career" },
];

/** Shorter than this is a mis-click or a bounce, not a use. */
const MIN_MS = 1500;

export function useFeatureTracking(): void {
  const trendingOpen = useAppStore((s) => s.trendingOpen);
  const analystOpen = useAppStore((s) => s.analystOpen);
  const flowsOpen = useAppStore((s) => s.flowsOpen);
  const careerOpen = useAppStore((s) => s.careerOpen);
  const marketMode = useAppStore((s) => s.marketMode);

  // The feature currently open and when it opened. A ref, not state: this
  // changes on every open and must not re-render anything.
  const openFeature = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    const flags: Record<string, boolean> = {
      trendingOpen,
      analystOpen,
      flowsOpen,
      careerOpen,
    };
    const now = FEATURES.find((f) => flags[f.flag])?.id ?? null;
    const prev = openFeature.current;
    if (prev?.id === now) return;

    if (prev) {
      const ms = Date.now() - prev.at;
      // A duration below the floor is dropped rather than recorded as a tiny
      // one: it would pull the average down while describing a click that
      // never became a use.
      if (ms >= MIN_MS) track("panel_close", prev.id, ms);
    }
    openFeature.current = now ? { id: now, at: Date.now() } : null;
    if (now) track("panel_open", now);
  }, [trendingOpen, analystOpen, flowsOpen, careerOpen]);

  // ── The supply / demand split ────────────────────────────────────────────
  const mode = useRef<{ which: string; at: number } | null>(null);

  useEffect(() => {
    const bank = () => {
      const m = mode.current;
      if (!m) return;
      const ms = Date.now() - m.at;
      mode.current = { which: m.which, at: Date.now() };
      if (ms >= MIN_MS) track("mode_use", m.which, ms);
    };

    // Switching sides banks the side being left, then starts the new clock.
    if (mode.current && mode.current.which !== marketMode) bank();
    mode.current = { which: marketMode, at: Date.now() };

    // Hidden counts as stopped. A tab behind another window is not time spent
    // reading the demand side, and without this the figure is mostly a measure
    // of who leaves tabs open.
    const onHide = () => {
      if (document.visibilityState === "hidden") bank();
      else mode.current = { which: marketMode, at: Date.now() };
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      bank();
    };
  }, [marketMode]);

  // The open panel's time is banked on unmount too, so navigating away from the
  // app does not silently drop whatever was open.
  useEffect(() => {
    return () => {
      const p = openFeature.current;
      if (!p) return;
      const ms = Date.now() - p.at;
      if (ms >= MIN_MS) track("panel_close", p.id, ms);
      openFeature.current = null;
    };
  }, []);
}
