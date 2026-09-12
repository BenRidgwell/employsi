import { useEffect, useRef, useState } from "react";

/**
 * The intro animation that covers the app while it boots, from
 * `employsi-loader.html`.
 *
 * WHY THE HANDOFF IS NOT ON A TIMER
 * The brief is a loader that plays "whilst the screen/data loads in the
 * background", so the veil lifts when the app says it is ready rather than at a
 * fixed moment — a timer would hand off to a half-built map as often as to a
 * ready one.
 *
 * There is no build-up to protect any more. The previous design drew itself on
 * over 2.2s of choreography and the handoff had to wait for the last stroke;
 * this one is a standing composition with two loops in it, the sweep and the
 * pan, so DWELL_MS below is only a floor that stops the veil flashing past on a
 * warm load.
 *
 * CEILING
 * `ready` is a best-effort signal, so it is never allowed to trap anyone: after
 * MAX_HOLD the veil lifts regardless. A user looking at a slightly unfinished
 * map can still use the app; a user looking at a permanent splash screen cannot.
 *
 * WHAT THIS CARRIES THAT THE DESIGN FILE DOES NOT, and why:
 *
 *  • The skyline is a file, not a data: URI. The design builds it in the page
 *    with buildSkyline() and inlines ~140KB into the document on every load.
 *    The drawing is deterministic, so scripts/gen-intro-skyline.js runs the
 *    same function once and writes public/assets/intro-skyline.svg — 11KB over
 *    the wire, and cached after the first load.
 *  • The skyline is anchored to its GROUND LINE rather than its sky. See
 *    .introsky in global.css.
 *  • A reduced-motion branch, and a breakpoint for phones. The design is one
 *    desktop canvas and carries neither.
 */

/**
 * The floor on how long the veil stays up.
 *
 * Nothing is being protected from being cut off any more — the composition is
 * standing, not drawn on — so this is purely about not flashing. A veil that
 * appears and leaves inside 300ms on a warm load reads as a glitch rather than
 * as a loading screen, and the sweep below it would not complete one pass.
 *
 * 1900ms is one full sweep (see em-sweep), so the bar always finishes a stroke
 * rather than stopping halfway across. Down from 3000, which was the previous
 * design's build-up plus its dwell and has nothing to measure here.
 */
const DWELL_MS = 1900;
const MAX_HOLD = 6000;

export function IntroLoader({ ready }: { ready: boolean }) {
  const [built, setBuilt] = useState(false);
  const [out, setOut] = useState(false);
  const [gone, setGone] = useState(false);
  // Reduced motion: the sweep and the 52s pan are both loops, which is exactly
  // what this preference asks us not to play. Both are stopped in CSS; this
  // state also drops the dwell, so the veil covers the boot and leaves as soon
  // as the app is ready rather than holding a still picture for a sweep that is
  // not running.
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
      <div className="introstage">
        <div className="introlockup">
          {/* The four rects of the employsi mark. Flat here — the previous
              design drew them on individually and this one does not, so they
              carry the design's opacities instead of its animation. */}
          <svg
            viewBox="24 24 72 72"
            width="77"
            height="77"
            fill="currentColor"
            className="intromark"
            aria-hidden="true"
          >
            <rect x="24" y="24" width="15" height="72" rx="7.5" />
            <rect x="24" y="24" width="40" height="15" rx="7.5" opacity=".45" />
            <rect x="24" y="52.5" width="55" height="15" rx="7.5" opacity=".72" />
            <rect x="24" y="81" width="72" height="15" rx="7.5" />
          </svg>
          <span className="introword">employsi</span>
        </div>

        {/* An indeterminate sweep, not a progress bar: nothing here knows how
            far along the boot is, and a bar that filled would be claiming it
            did. */}
        <div className="introbar">
          <span className="introbarfill" />
        </div>

        <div className="introcaption">Explore the world of work.</div>
      </div>

      {/* The skyline across the bottom third, panning slowly. Its top is masked
          away rather than cut, so the buildings dissolve into the page. */}
      <div className="introband">
        <img className="introsky" src="/assets/intro-skyline.svg" alt="" draggable={false} />
      </div>
    </div>
  );
}
