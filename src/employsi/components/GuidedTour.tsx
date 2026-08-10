import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppStore } from "../state/store";
import { CITY_LABEL, GLOBAL_HUB_LABEL } from "../data/geo";
import { REGION_LABEL } from "../data/mapboxWorldGeo";

/**
 * The guided help layer, from `Employsi Guided Help — Local Tour.dc.html`.
 *
 * The "Need help?" button used to open a static list of sentences. This is the
 * design's replacement: a hub of short walkthroughs, each of which SPOTLIGHTS a
 * real control and explains it in place. The difference matters because the old
 * copy could describe a control that had moved; a spotlight cannot, because it
 * is positioned from the element's own bounding box at the moment it is shown.
 *
 * WHAT ANCHORS A STEP. Steps name a `data-tour` hook, not a CSS class. Classes
 * here are styling handles that get renamed as the design moves on — anchoring
 * to them would make a restyle silently break the tour, and a tour whose
 * spotlight lands on nothing is worse than no tour, because the copy still
 * asserts something is there. `data-tour` exists only for this, so it does not
 * move unless someone means to move it.
 *
 * THE PLACE IS READ FROM THE APP, not written into the copy. The mocks say
 * "Perth" and "WORLD VIEW" throughout; hardcoding either would be wrong in the
 * 51 other cities and on the regional layer, so every string that names a place
 * takes it from the store via `TourCtx`.
 *
 * TWO SETS, THREE LAYERS. `LOCAL_TOURS` serves a city; `WORLD_TOURS` serves the
 * globe AND a region, because every control it names exists on both. They are
 * not interchangeable in the other direction: two local steps spotlight the city
 * banner and an employer pin, and neither exists once you step out of a city, so
 * reusing that set out there would frame empty space and describe it anyway.
 */

/**
 * Where the tooltip sits relative to the spotlit element.
 *
 * `top` and `top-end` sit at the same height and differ only in which edge they
 * align to. That distinction exists because of the city banner: it runs almost
 * the full width of the window, so aligning the card to its LEFT edge put it
 * underneath the vertical rail, which floats over that corner. `top-end` aligns
 * the card's right edge to the element's instead, which lands it in open map.
 */
type Place = "right" | "top" | "top-end" | "bottom";

/** Which map layer the user is on — the tour set follows it. */
export type TourLayer = "local" | "domestic" | "global";

/**
 * What a step knows about where the user is.
 *
 * Copy takes this rather than baking a place name in. The world tour is shared
 * by the global AND domestic layers, and several of its lines would be wrong on
 * one of them if written for the other — "the globe view is active" is false
 * when you are looking at a region. `scope` is the place in words, `layer` is
 * for the handful of lines that genuinely differ.
 */
export interface TourCtx {
  scope: string;
  layer: TourLayer;
}

interface TourStep {
  /** `data-tour` value of the element to spotlight. */
  anchor: string;
  place: Place;
  /** Breathing room around the element, in px. */
  pad: number;
  /** Spotlight corner radius — 999 for pills, ~18 for cards. */
  radius: number;
  title: string;
  body: (ctx: TourCtx) => string;
}

interface TourDef {
  /** Shown in the tooltip footer, upper-cased. */
  label: string;
  /** Hub row: what this walkthrough is. */
  hubTitle: string;
  /** Hub row: how long it takes. */
  hubMeta: string;
  icon: "pin" | "card" | "globe" | "chart";
  steps: TourStep[];
}

const LOCAL_TOURS: Record<string, TourDef> = {
  orient: {
    label: "Local view",
    hubTitle: "Get oriented in local view",
    hubMeta: "5 steps · 40 seconds",
    icon: "pin",
    steps: [
      {
        anchor: "banner",
        place: "top-end",
        pad: 8,
        radius: 999,
        title: "Where you are",
        body: (ctx) =>
          `The banner names the city you have dropped into and sizes the market: employers tracked, roles open now, and total workforce for ${ctx.scope}.`,
      },
      {
        anchor: "marker",
        place: "right",
        pad: 10,
        radius: 18,
        title: "Every pin is an employer",
        body: () =>
          "Pins sit on the buildings employers actually occupy. Click one for its card: live vacancies, pay, skills in demand and recent news.",
      },
      {
        anchor: "rail",
        place: "right",
        pad: 8,
        radius: 26,
        title: "Zoom out or change layer",
        body: () =>
          "The location layer is active. Step back up to the region or the world from the same tray — the map re-reads for that scope.",
      },
      {
        anchor: "search",
        place: "bottom",
        pad: 6,
        radius: 999,
        title: "Filter the city by skill",
        body: (ctx) =>
          `Search a skill and the map shades ${ctx.scope} by which employers are hiring for it.`,
      },
      {
        anchor: "help",
        place: "bottom",
        pad: 8,
        radius: 999,
        title: "Help follows you",
        body: () =>
          "These walkthroughs change with the screen. In the city view you get the local tours; step out and you get the ones for that layer.",
      },
    ],
  },
  employers: {
    label: "Employer pins",
    hubTitle: "Read an employer pin",
    hubMeta: "2 steps · on this screen",
    icon: "card",
    steps: [
      {
        anchor: "marker",
        place: "right",
        pad: 10,
        radius: 18,
        title: "Open an employer",
        body: () =>
          "Click a pin for the company card: open roles, top skills, what the ads disclose about pay, and the areas they are hiring into.",
      },
      {
        anchor: "banner",
        place: "top-end",
        pad: 8,
        radius: 999,
        title: "Counts stay in sync",
        body: () =>
          "Filter or search and these figures re-count for exactly what is left on the map.",
      },
    ],
  },
  city: {
    label: "Change scope",
    hubTitle: "Switch city or zoom out",
    hubMeta: "2 steps · on this screen",
    icon: "globe",
    steps: [
      {
        anchor: "rail",
        place: "right",
        pad: 8,
        radius: 26,
        title: "Pick a different layer",
        body: () =>
          "Location is the city layer. The globe steps back to the world view, and the building steps to the region.",
      },
      {
        anchor: "search",
        place: "bottom",
        pad: 6,
        radius: 999,
        title: "Or jump by name",
        body: () =>
          "Search a company and Employsi flies straight to its office, in whichever city it sits.",
      },
    ],
  },
};

/**
 * From `Employsi Guided Help — Global Tour.dc.html`. ONE SET SERVES THE GLOBAL
 * AND DOMESTIC LAYERS, as asked — every control it names (search, the rail, the
 * ticker, the utility cluster) is present on both, which is exactly why the
 * local set could not be reused: two of ITS steps name a city banner and an
 * employer pin, neither of which exists out here.
 */
const WORLD_TOURS: Record<string, TourDef> = {
  orient: {
    label: "Get oriented",
    hubTitle: "Get oriented in Employsi",
    hubMeta: "5 steps · 40 seconds",
    icon: "globe",
    steps: [
      {
        anchor: "search",
        place: "bottom",
        pad: 6,
        radius: 999,
        title: "Start with a search",
        body: () =>
          "Every advertised role is a collection of skills in demand. Type a skill by name, or describe it in your own words — Employsi resolves it to the closest tracked skill and takes you there.",
      },
      {
        anchor: "rail",
        place: "right",
        pad: 8,
        radius: 26,
        title: "Change what you are looking at",
        body: () =>
          "Global, regional, city and company views live in this tray. Whatever you pick here sets the scope of every panel on screen.",
      },
      {
        anchor: "ticker",
        place: "top",
        pad: 8,
        radius: 20,
        title: "Read the live demand ticker",
        body: () =>
          "Each entry is a skill: the sparkline is the recent trend, then median advertised base pay, then the change in demand.",
      },
      {
        anchor: "utility",
        place: "bottom",
        pad: 8,
        radius: 22,
        title: "Alerts and analysts",
        body: () =>
          "Notifications flag movement on skills you follow. The message icon opens a feedback board where you can submit ideas and raise issues.",
      },
      {
        anchor: "help",
        place: "bottom",
        pad: 8,
        radius: 999,
        title: "Help follows you",
        body: () =>
          "This panel is contextual — open it on any screen and the walkthroughs change to match what you are looking at.",
      },
    ],
  },
  ticker: {
    label: "Read the ticker",
    hubTitle: "Read the demand ticker",
    hubMeta: "2 steps · on this screen",
    icon: "chart",
    steps: [
      {
        anchor: "ticker",
        place: "top",
        pad: 8,
        radius: 20,
        title: "Every figure on the bar",
        body: () =>
          "A live sparkline, the median advertised base pay, and the change in demand against the previous period — for one skill.",
      },
      {
        anchor: "rail",
        place: "right",
        pad: 8,
        radius: 26,
        title: "The ticker follows your scope",
        body: () => "Drop into a region or a city and the same bar re-reads for that market only.",
      },
    ],
  },
  hubs: {
    label: "Explore a market",
    hubTitle: "Explore a market hub",
    hubMeta: "2 steps · on this screen",
    icon: "pin",
    steps: [
      {
        anchor: "rail",
        place: "right",
        pad: 8,
        radius: 26,
        title: "Pick a layer",
        body: (ctx) =>
          ctx.layer === "global"
            ? "The globe view is active. Hubs glow by the metric you have selected — click one to drop into its region."
            : `The regional view is active, showing ${ctx.scope}. Each city glows by the metric you have selected — click one to drop into it, or step back out to the globe.`,
      },
      {
        anchor: "search",
        place: "bottom",
        pad: 6,
        radius: 999,
        title: "Or jump straight there",
        body: () =>
          "Search a company or skill in the header to land on its market without navigating the map.",
      },
    ],
  },
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TIP_W = 340;
/** Keep the card off the viewport edge, per the design's clamp. */
const MARGIN = 20;

/** On screen and big enough to be worth framing. */
function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return (
    r.width > 0 &&
    r.height > 0 &&
    r.top >= 0 &&
    r.left >= 0 &&
    r.bottom <= window.innerHeight &&
    r.right <= window.innerWidth
  );
}

/**
 * The element a step spotlights.
 *
 * AN ANCHOR CAN MATCH SEVERAL ELEMENTS, AND ONLY ONE OF THEM IS ON SCREEN. The
 * app carries two search entry points — a centred bar on desktop and a top-right
 * button for the mobile flyout — and the mobile one stays in the DOM at every
 * width, hidden on desktop by `.gshidden`. Taking the FIRST match spotlighted
 * that hidden button: it measures zero, so the step silently lost its spotlight
 * and the card drifted to the middle of the screen. So every match is
 * considered and the first VISIBLE one wins, which also picks the right search
 * on a phone without a second anchor name.
 *
 * `marker` is the same rule with a different query: map pins are created and
 * destroyed by Mapbox as the camera moves, so the tour asks for whichever pin is
 * currently on screen rather than holding a reference to one that may have been
 * recycled.
 */
function anchorRect(anchor: string, pad: number): Rect | null {
  if (typeof document === "undefined") return null;
  const q = anchor === "marker" ? ".mapboxgl-marker .mk" : `[data-tour="${anchor}"]`;
  const all = Array.from(document.querySelectorAll(q));
  // Fall back to the first match so a step still positions its card against
  // something when nothing is fully in view, rather than jumping to centre.
  const el = all.find(isVisible) ?? all[0] ?? null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
}

function HubIcon({ kind }: { kind: TourDef["icon"] }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 17,
    height: 17,
    fill: "none",
    stroke: "currentColor",
    "aria-hidden": true,
  } as const;
  if (kind === "pin") {
    return (
      <svg {...common}>
        <path d="M12 21c4-5 6-8 6-10.5A6 6 0 0 0 6 10.5C6 13 8 16 12 21Z" />
        <circle cx="12" cy="10.5" r="2.2" />
      </svg>
    );
  }
  if (kind === "card") {
    return (
      <svg {...common}>
        <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" />
        <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
      </svg>
    );
  }
  if (kind === "chart") {
    return (
      <svg {...common}>
        <polyline points="4,15 9,10 13,13.5 20,6" />
        <path d="M4 19.5h16" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="4" ry="8.5" />
      <line x1="3.6" y1="12" x2="20.4" y2="12" />
    </svg>
  );
}

export function GuidedTour({ layer, onClose }: { layer: TourLayer; onClose: () => void }) {
  const localCity = useAppStore((s) => s.localCity);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const toggleAnalyst = useAppStore((s) => s.toggleAnalyst);
  const city = GLOBAL_HUB_LABEL[localCity] || CITY_LABEL[localCity] || localCity;
  const region = REGION_LABEL[domesticRegion] || domesticRegion;

  // The set follows the layer: the local walkthroughs name a city banner and an
  // employer pin, which do not exist once you step out of a city.
  const tours = layer === "local" ? LOCAL_TOURS : WORLD_TOURS;
  const scope = layer === "local" ? city : layer === "domestic" ? region : "the world";
  const ctx: TourCtx = { scope, layer };
  // What the hub's eyebrow says it is helping with. "WORLD VIEW" would be wrong
  // on the domestic layer, which is a region rather than the globe.
  const eyebrow =
    layer === "local"
      ? `HELP · ${city.toUpperCase()} LOCAL VIEW`
      : layer === "domestic"
        ? `HELP · ${region.toUpperCase()} VIEW`
        : "HELP · WORLD VIEW";

  const [tour, setTour] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [tipH, setTipH] = useState(210);

  const def = tour ? tours[tour] : null;
  const s = def?.steps[step];

  // Re-measure on every step, and while the window moves under the tour. The
  // rect is read fresh rather than cached: the map keeps animating (the auto-
  // rotate never stops), so a pin's position at the moment the step opened is
  // not where it is a second later.
  useLayoutEffect(() => {
    if (!s) return;
    const measure = () => setRect(anchorRect(s.anchor, s.pad));
    measure();
    const id = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [s]);

  useLayoutEffect(() => {
    const h = tipRef.current?.getBoundingClientRect().height;
    if (h && Math.abs(h - tipH) > 1) setTipH(h);
  }, [s, tipH]);

  const stop = useCallback(() => {
    setTour(null);
    setStep(0);
  }, []);

  const go = useCallback(
    (d: number) => {
      if (!def) return;
      const n = step + d;
      if (n < 0) return;
      if (n >= def.steps.length) {
        stop();
        setDone(true);
        window.setTimeout(() => setDone(false), 3200);
        return;
      }
      setStep(n);
    },
    [def, step, stop],
  );

  // Escape backs out one level: out of a running tour to the hub's caller,
  // rather than closing everything, so a mis-click does not lose the hub.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (tour) stop();
        else onClose();
      } else if (tour && (e.key === "ArrowRight" || e.key === "Enter")) {
        go(1);
      } else if (tour && e.key === "ArrowLeft") {
        go(-1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tour, stop, onClose, go]);

  // ── Running tour ─────────────────────────────────────────────────────────
  if (def && s) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // No anchor on screen: centre the card rather than spotlighting nothing.
    const r = rect ?? { x: vw / 2 - 200, y: vh / 2 - 60, w: 400, h: 120 };
    let left: number;
    let top: number;
    if (s.place === "right") {
      left = r.x + r.w + 18;
      top = r.y;
    } else if (s.place === "top") {
      left = r.x;
      top = r.y - 18 - tipH;
    } else if (s.place === "top-end") {
      // Same height as `top`, right edge aligned instead of left — see Place.
      left = r.x + r.w - TIP_W;
      top = r.y - 18 - tipH;
    } else {
      left = r.x + r.w - TIP_W;
      top = r.y + r.h + 16;
    }
    left = Math.max(MARGIN, Math.min(left, vw - TIP_W - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - tipH - MARGIN));

    const left_ = def.steps.length - step - 1;
    const stepsLeft = left_ === 0 ? "Last step" : `${left_} step${left_ === 1 ? "" : "s"} left`;

    return (
      <div className="gtlayer">
        {rect && (
          <div
            className="gtspot"
            onClick={() => go(1)}
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              borderRadius: s.radius,
            }}
          />
        )}
        <div className="gttip" ref={tipRef} style={{ left, top }}>
          <div className="gttiphd">
            <span className="gtprogress">
              <span className="gtdots">
                {def.steps.map((_, i) => (
                  <span
                    key={i}
                    className={`gtdot${i === step ? " on" : i < step ? " past" : ""}`}
                  />
                ))}
              </span>
              <span className="gtleft">{stepsLeft}</span>
            </span>
            <button type="button" className="gtx" onClick={stop} aria-label="End tour">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div className="gttitle">{s.title}</div>
          <div className="gtbody">{s.body(ctx)}</div>
          <div className="gttipft">
            <span className="gtlabel">{def.label.toUpperCase()}</span>
            <div className="gtnav">
              <button
                type="button"
                className={`gtback${step === 0 ? " off" : ""}`}
                onClick={() => go(-1)}
                disabled={step === 0}
              >
                Back
              </button>
              <button type="button" className="gtnext" onClick={() => go(1)}>
                {step === def.steps.length - 1 ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Completion toast ─────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="gtdone">
        <span className="gtdoneicon">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor">
            <polyline points="5,12.5 10,17.5 19,7" />
          </svg>
        </span>
        <span className="gtdonetext">
          <span className="gtdonetitle">Tour complete</span>
          <span className="gtdonesub">Reopen it any time from the help button.</span>
        </span>
      </div>
    );
  }

  // ── Hub ──────────────────────────────────────────────────────────────────
  return (
    <div className="dockpanel gthub">
      <div className="gthubhd">
        <div className="gthubhdtext">
          <span className="gteyebrow">{eyebrow}</span>
          <span className="gthubtitle">Need help?</span>
          <span className="gthubsub">
            {layer === "local"
              ? "Guided walkthroughs for the city layer you are in."
              : "Guided walkthroughs for what is on screen right now."}
          </span>
        </div>
        <button type="button" className="gtx" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>

      <div className="gthublist">
        {Object.entries(tours).map(([key, t]) => (
          <button
            key={key}
            type="button"
            className="gthubrow"
            onClick={() => {
              setTour(key);
              setStep(0);
            }}
          >
            <span className="gthubicon">
              <HubIcon kind={t.icon} />
            </span>
            <span className="gthubrowtext">
              <span className="gthubrowtitle">{t.hubTitle}</span>
              <span className="gthubrowmeta">{t.hubMeta}</span>
            </span>
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              className="gthubchev"
              aria-hidden
            >
              <polyline points="9,5 16,12 9,19" />
            </svg>
          </button>
        ))}
      </div>

      <div className="gthubft">
        <span className="gthubftlbl">Still stuck?</span>
        <button
          type="button"
          className="gthubask"
          onClick={() => {
            onClose();
            toggleAnalyst();
          }}
        >
          Ask an analyst
        </button>
      </div>
    </div>
  );
}
