import { useEffect, useRef, useState } from "react";

/**
 * The intro animation that covers the app while it boots, from
 * `App_Intro_Animation.html`.
 *
 * WHY THE HANDOFF IS NOT ON A TIMER
 * The design choreographs the whole thing on fixed delays — the veil lifts at
 * 2280ms whatever else is happening. That is right for a design file, which has
 * nothing behind it, and wrong here: the brief is a loader that plays "whilst
 * the screen/data loads in the background", and a veil that lifts on a timer
 * would hand off to a half-built map just as often as to a ready one.
 *
 * So the BUILD-UP keeps the design's timings exactly (stem, arms, lockup,
 * wordmark, rule, caption — all on their original delays), and only the last
 * two steps, the handoff and the veil, are driven by state instead. They fire
 * when both of these are true:
 *
 *   • the build-up has finished, so the animation is never cut off mid-stroke;
 *   • the app says it is ready.
 *
 * CEILING
 * `ready` is a best-effort signal, so it is never allowed to trap anyone: after
 * MAX_HOLD the veil lifts regardless. A user looking at a slightly unfinished
 * map can still use the app; a user looking at a permanent splash screen cannot.
 * That is the whole reason this is a ceiling and not a condition.
 */

/** When the design's build-up finishes and the handoff becomes possible. */
const BUILD_MS = 2200;
/** Hard ceiling — the veil always lifts by here, ready or not. */
const MAX_HOLD = 6000;

export function IntroLoader({ ready }: { ready: boolean }) {
  const [built, setBuilt] = useState(false);
  const [out, setOut] = useState(false);
  const [gone, setGone] = useState(false);
  // Reduced motion: the design is a 2.7s piece of motion, which is exactly what
  // this preference asks us not to play. The veil still covers the boot — it
  // just appears and leaves without the choreography.
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const build = window.setTimeout(() => setBuilt(true), reduced.current ? 0 : BUILD_MS);
    const ceiling = window.setTimeout(() => setOut(true), MAX_HOLD);
    return () => {
      window.clearTimeout(build);
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
      <div className="introgrid" />
      <div className="introglow" />
      <div className="introhaze" />

      <div className={`introstage${out ? " is-out" : ""}`}>
        <div className="introlockup">
          {/* The four rects of the employsi mark, drawn individually so each
              can animate: the stem grows up, then the three arms extend. */}
          <svg viewBox="0 0 120 120" width="62" height="62" className="intromark">
            <rect x="24" y="24" width="15" height="72" rx="7.5" fill="#1c1c1e" className="i-stem" />
            <rect
              x="24"
              y="24"
              width="40"
              height="15"
              rx="7.5"
              fill="#8e8e93"
              className="i-arm i-arm1"
            />
            <rect
              x="24"
              y="52.5"
              width="55"
              height="15"
              rx="7.5"
              fill="#48484a"
              className="i-arm i-arm2"
            />
            <rect
              x="24"
              y="81"
              width="72"
              height="15"
              rx="7.5"
              fill="#1c1c1e"
              className="i-arm i-arm3"
            />
          </svg>
          <span className="introword">employsi</span>
        </div>

        <div className="introfoot">
          <span className="introrule" />
          <span className="introcaption">
            <svg viewBox="0 0 24 24" width="13" height="13" className="introglobe">
              <circle cx="12" cy="12" r="9" />
              <ellipse cx="12" cy="12" rx="4" ry="9" />
              <path d="M3.6 9h16.8" />
              <path d="M3.6 15h16.8" />
            </svg>
            Explore the world of work
          </span>
        </div>
      </div>
    </div>
  );
}
