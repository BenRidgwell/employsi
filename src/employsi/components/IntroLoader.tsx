import { useEffect, useRef, useState } from "react";
import { CardLoader } from "./panels/CardLoader";

/**
 * The loading screen that covers the app while it boots.
 *
 * WHAT IT SHOWS: the cards' own loader (panels/CardLoader) — the employsi
 * mark sweeping its bars, with the stage caption under it — so the app opens
 * on the same animation What's Trending and the other cards use while their
 * data arrives. It replaced the skyline intro (`employsi-loader.html`) on
 * 2026-09-28, keeping that intro's timing exactly: the same DWELL_MS floor,
 * MAX_HOLD ceiling and fade, so only the picture changed. The component itself
 * is reused rather than copied, so the two cannot drift apart.
 *
 * WHY THE HANDOFF IS NOT ON A TIMER
 * The brief is a loader that plays "whilst the screen/data loads in the
 * background", so the veil lifts when the app says it is ready rather than at a
 * fixed moment — a timer would hand off to a half-built map as often as to a
 * ready one. DWELL_MS below is only a floor that stops the veil flashing past
 * on a warm load.
 *
 * CEILING
 * `ready` is a best-effort signal, so it is never allowed to trap anyone: after
 * MAX_HOLD the veil lifts regardless. A user looking at a slightly unfinished
 * map can still use the app; a user looking at a permanent splash screen cannot.
 */

/**
 * The floor on how long the veil stays up: 3800ms, the skyline intro's own
 * value, kept when its picture was replaced so the length of the opening did
 * not change with it. A veil that appears and leaves inside 300ms on a warm
 * load reads as a glitch rather than as a loading screen.
 */
const DWELL_MS = 3800;
const MAX_HOLD = 6000;

export function IntroLoader({ ready }: { ready: boolean }) {
  const [built, setBuilt] = useState(false);
  const [out, setOut] = useState(false);
  const [gone, setGone] = useState(false);
  // Reduced motion: the loader is a loop, which is exactly what this
  // preference asks us not to play, so the dwell is dropped and the veil
  // covers the boot and leaves as soon as the app is ready.
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dwell = window.setTimeout(() => setBuilt(true), reducedRef.current ? 0 : DWELL_MS);
    const ceiling = window.setTimeout(() => setOut(true), MAX_HOLD);
    return () => {
      window.clearTimeout(dwell);
      window.clearTimeout(ceiling);
    };
  }, []);

  useEffect(() => {
    if (built && ready) setOut(true);
  }, [built, ready]);

  // Unmount only after the fade has finished, so the DOM does not carry a
  // full-screen invisible overlay that would eat every click on the map.
  useEffect(() => {
    if (!out) return;
    const t = window.setTimeout(() => setGone(true), 520);
    return () => window.clearTimeout(t);
  }, [out]);

  if (gone) return null;

  return (
    <div className={`introveil${out ? " is-out" : ""}`} aria-hidden="true">
      <CardLoader />
    </div>
  );
}
