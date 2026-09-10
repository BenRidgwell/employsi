import { useEffect, useRef, useState } from "react";

/**
 * The intro animation that covers the app while it boots, from
 * `App_Intro_Animation_4.html`.
 *
 * WHY THE HANDOFF IS NOT ON A TIMER
 * The design choreographs the whole thing on fixed delays — the veil lifts at
 * 2280ms whatever else is happening. That is right for a design file, which has
 * nothing behind it, and wrong here: the brief is a loader that plays "whilst
 * the screen/data loads in the background", and a veil that lifts on a timer
 * would hand off to a half-built map just as often as to a ready one.
 *
 * So the BUILD-UP keeps the design's timings exactly (stem, arms, lockup,
 * wordmark, rule, caption, band — all on their original delays), and only the
 * last two steps, the handoff and the veil, are driven by state instead. They
 * fire when both of these are true:
 *
 *   • the build-up has finished, so the animation is never cut off mid-stroke;
 *   • the app says it is ready.
 *
 * The design multiplies every delay by a `speed` prop defaulting to 2.4, which
 * is its preview control — at that setting the build-up alone runs 5.3s. The
 * delays here are the unmultiplied ones (speed = 1), which is the choreography
 * the design describes and the only version that fits inside a loading screen.
 *
 * CEILING
 * `ready` is a best-effort signal, so it is never allowed to trap anyone: after
 * MAX_HOLD the veil lifts regardless. A user looking at a slightly unfinished
 * map can still use the app; a user looking at a permanent splash screen cannot.
 * That is the whole reason this is a ceiling and not a condition.
 *
 * WHAT THE DESIGN FILE CARRIES THAT THIS DOES NOT
 * Two pieces of it are scaffolding for the design canvas rather than product:
 * a mocked app shell (sidebar, top bar, shimmering tiles) that stands in for
 * "the app is behind the veil", and a "Replay intro" button wired to the
 * canvas's own replay(). Here the real app is behind the veil, so drawing a
 * fake one over it would be a second, wrong app; and there is nothing to replay.
 *
 * Its stylesheet and logic also still carry a parallax city built out of divs
 * (cityFar/cityMid/cityNear/traffic, and the city-drift, city-window and
 * city-traffic keyframes) and the previous version's grid and two-layer globe.
 * None of it is referenced by the markup any more — it is superseded by the
 * footage band — so none of it is built here either.
 */

/**
 * When the build-up finishes and the handoff becomes possible.
 *
 * The design's own handoff, unchanged. It was briefly 2600 under the previous
 * design, where the band did not finish arriving until 2020ms and needed the
 * extra time to be seen at all. This one brings the band in at 200ms, so the
 * composition is complete and dwelling long before here and the 400ms that
 * bought is no longer worth charging to every app open.
 */
const BUILD_MS = 2200;
/** Hard ceiling — the veil always lifts by here, ready or not. */
const MAX_HOLD = 6000;

export function IntroLoader({ ready }: { ready: boolean }) {
  const [built, setBuilt] = useState(false);
  const [out, setOut] = useState(false);
  const [gone, setGone] = useState(false);
  // Reduced motion: the design is 2.7s of motion over a looping clip, which is
  // exactly what this preference asks us not to play. The veil still covers the
  // boot — it just appears and leaves without the choreography, and without the
  // footage, which no CSS rule can hold still.
  const [reduced, setReduced] = useState(false);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setReduced(reducedRef.current);
    const build = window.setTimeout(() => setBuilt(true), reducedRef.current ? 0 : BUILD_MS);
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
      {/* The skyline across the bottom 56%. No gradient over its top edge, and
          that is deliberate rather than an omission: the footage is a city
          against a blown-out white sky, so it dissolves into the page on its
          own and a fade would only grey the buildings' tops. The previous
          design needed one because its band was a street scene, opaque to its
          top edge. */}
      {!reduced && (
        <div className="introband">
          <video
            autoPlay
            muted
            loop
            playsInline
            /* Explicit rather than left to the autoplay heuristics: this file
               has under a second to arrive before the band is on screen, so
               there is no version of "later" that is any use. */
            preload="auto"
            /* Not focusable and not announced: it is texture behind a splash
               screen, and the veil is already aria-hidden. */
            tabIndex={-1}
          >
            {/* TWO ENCODES, and the WebM is not an optimisation — H.264 is
                patent-encumbered and a Chromium built without the proprietary
                codecs cannot decode it at all. It does not fail loudly: the
                element reports MEDIA_ERR_SRC_NOT_SUPPORTED and the band renders
                empty, which is indistinguishable from the video simply not
                having arrived. Measured on the Chromium in this repo's own
                tooling, where canPlayType('video/mp4; codecs="avc1.42E01E"')
                answers "". VP9 is listed first so anything that can take it
                does; the MP4 is what Safari uses.

                Both are the source's native 1280x720, uncropped — unlike the
                street-scene band two designs ago, this one is not safe to crop:
                at phone aspect ratios the 56% band is TALLER than it is wide
                relative to the footage, so cover() uses the full frame height,
                and the 78% anchor draws on the middle of the frame too. 333KB
                and 248KB against the supplied file's 3.9MB, which is almost
                all bitrate: 7345 kb/s for a slow drift. The encodes are
                greyscale, because CSS applies grayscale(1) anyway and the
                chroma planes were being carried for nothing, and the muted
                audio track is dropped. */}
            <source src="/assets/intro-band.webm" type="video/webm" />
            <source src="/assets/intro-band.mp4" type="video/mp4" />
          </video>
        </div>
      )}

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
            {/* A pale sphere with one band of land scrolling across it, a
                static highlight and a shaded limb. Lighter and calmer than the
                previous design's globe, which had two land layers at different
                rates plus a bob and a breathing shine. */}
            <span className="introglobe">
              <span className="ig-land" />
              <span className="ig-shine" />
              <span className="ig-edge" />
            </span>
            Explore the world of work
          </span>
        </div>
      </div>
    </div>
  );
}
