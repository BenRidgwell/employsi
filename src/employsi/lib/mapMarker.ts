/**
 * Map marker markup, from `Employsi Map Markers.html`.
 *
 * The design draws three shapes on one grammar — a teardrop pin for a country,
 * a circle on a stick for a city, a logo disc on a stick for a company — each
 * over a small ground shadow, each lifting off it on hover and while selected,
 * and each captioned by the same block: name, a delta pill coloured to the
 * move, and a count beneath.
 *
 * Building the DOM here rather than in each map component is what keeps the
 * three consistent: WorldMapbox draws countries and cities, PerthMapbox draws
 * companies, and neither can drift from the shape the other uses.
 *
 * Hover and selection are driven by the same `--m` / `--sel` pair the action
 * rail uses, so the motion values live in CSS next to everything else.
 */

export type MarkerShape = "country" | "city" | "company";

export interface MarkerLabel {
  /** Full name under the marker. */
  name: string;
  /** Code inside the pin (2 letters for a country, 3 for a city). */
  code?: string;
  /** Logo URL for a company marker. */
  logo?: string;
  /** Fallback text when a logo fails to load. */
  logoAlt?: string;
  /** Percentage change; null or undefined hides the delta pill. */
  delta?: number | null;
  /** Figure under the delta, already formatted (e.g. "1,204 roles"). */
  count?: string | null;
  selected?: boolean;
  /** Dimmed and inert — no demand for the searched skill. */
  faded?: boolean;
}

const NS = "http://www.w3.org/2000/svg";

function deltaPill(delta: number): HTMLElement {
  // Under half a point either way is noise on a monthly series, so it reads as
  // flat — grey, arrow level — rather than as a move too small to mean anything.
  const flat = Math.abs(delta) < 0.5;
  const dir = flat ? "flat" : delta > 0 ? "up" : "down";
  const pill = document.createElement("span");
  pill.className = `mkdelta ${dir}`;

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  const line = document.createElementNS(NS, "line");
  line.setAttribute("x1", "6");
  line.setAttribute("y1", "10");
  line.setAttribute("x2", "6");
  line.setAttribute("y2", "2");
  const poly = document.createElementNS(NS, "polyline");
  poly.setAttribute("points", "2.5 5.5 6 2 9.5 5.5");
  svg.appendChild(line);
  svg.appendChild(poly);
  pill.appendChild(svg);

  const value = document.createElement("span");
  value.textContent = `${flat ? "±" : delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}%`;
  pill.appendChild(value);
  pill.title = "Change in this skill's job-ad demand vs the previous month";
  return pill;
}

/**
 * How far below the element's top edge the marker's foot sits — the teardrop's
 * point, or the bottom of the stalk. Mapbox is given `anchor: "top"` plus the
 * negative of this as the offset, which puts that foot exactly on the lng/lat
 * while leaving the caption hanging below it.
 */
export const MARKER_FOOT: Record<MarkerShape, number> = {
  country: 48,
  city: 50,
  // The company disc runs smaller than the design's — a local city plots far
  // more of them, far closer together, than the overview layers ever do.
  company: 42,
};

/**
 * Builds one marker's visual tree.
 *
 * The returned element is NOT the Mapbox marker element: Mapbox rewrites the
 * root marker's `style.opacity` every frame for its globe-occlusion fade, which
 * would clobber any fade of ours. Callers wrap this in a bare `.mkpin` element,
 * hand THAT to Mapbox, and apply their own opacity here.
 */
export function buildMarker(shape: MarkerShape, label: MarkerLabel): HTMLElement {
  const root = document.createElement("div");
  root.className = `mk mk-${shape}${label.selected ? " on" : ""}${label.faded ? " miss" : ""}`;

  const stage = document.createElement("span");
  stage.className = "mkstage";

  // Attention ring, shown on hover (and while selected, for a company).
  const ring = document.createElement("span");
  ring.className = "mkring";
  stage.appendChild(ring);

  // Skill-demand glow, behind everything else in the stage. Only the company
  // markers carry it (it's painted from that company's live demand for the
  // searched skill); the design has no such element, but dropping it would
  // lose the local layer's whole "who is hiring this" signal.
  if (shape === "company") {
    const glow = document.createElement("span");
    glow.className = "mkglow";
    stage.appendChild(glow);
  }

  // Ground shadow — it shrinks as the marker lifts, which is what sells the
  // lift as height rather than as a size change.
  const shadow = document.createElement("span");
  shadow.className = "mkshadow";
  stage.appendChild(shadow);

  const body = document.createElement("span");
  body.className = "mkbody";
  if (shape === "company") {
    if (label.logo) {
      const img = document.createElement("img");
      img.className = "mklogo";
      img.alt = "";
      img.src = label.logo;
      img.addEventListener("error", () => {
        img.remove();
        const tk = document.createElement("span");
        tk.className = "mkcode";
        tk.textContent = label.logoAlt ?? "";
        body.appendChild(tk);
      });
      body.appendChild(img);
    } else {
      const tk = document.createElement("span");
      tk.className = "mkcode";
      tk.textContent = label.logoAlt ?? "";
      body.appendChild(tk);
    }
  } else {
    const code = document.createElement("span");
    code.className = "mkcode";
    code.textContent = label.code ?? "";
    body.appendChild(code);
  }
  stage.appendChild(body);

  // Cities and companies stand on a stalk; the country teardrop has its own point.
  if (shape !== "country") {
    const stalk = document.createElement("span");
    stalk.className = "mkstalk";
    stage.appendChild(stalk);
  }
  root.appendChild(stage);

  const caption = document.createElement("span");
  caption.className = "mkcaption";
  const name = document.createElement("span");
  name.className = "mkname";
  name.textContent = label.name;
  caption.appendChild(name);
  if (label.faded) {
    // An em dash, not a figure, and not a zero. The marker is faded because
    // nothing in the archive answers this skill here, and "0" would assert
    // that the skill is measured and unwanted — a different, stronger claim
    // than the one we can make. The dash says "no reading", which is what the
    // design shows for this state.
    const none = document.createElement("span");
    none.className = "mkcount mknone";
    none.textContent = "—";
    caption.appendChild(none);
  } else {
    if (typeof label.delta === "number") caption.appendChild(deltaPill(label.delta));
    if (label.count) {
      const count = document.createElement("span");
      count.className = "mkcount";
      count.textContent = label.count;
      caption.appendChild(count);
    }
  }
  root.appendChild(caption);

  return root;
}
