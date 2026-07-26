/**
 * The action-banner icon set, taken from `Employsi Action Banner.html`.
 *
 * Every icon animates on hover and while selected. In the design each moving
 * part carries an inline transform driven by two custom properties the button
 * sets — `--m` (1 while hovered) and `--sel` (1 while selected) — combined as
 * `max(--m, --sel)`. That combination is named `--a` in global.css, and the
 * per-part transforms live there keyed off the classes below, so the markup
 * stays readable and the motion values sit next to the rest of the button CSS.
 *
 * The class names describe the MOTION, not the shape, because several icons
 * share the same gesture: `ai-lift` rises, `ai-drop` sinks, `ai-slide-*` shifts
 * sideways, `ai-flat` squashes horizontally, `ai-spin` rotates, `ai-shrink`
 * scales down. Staggered parts add `ai-d1`/`ai-d2` for the design's 40–100ms
 * delays.
 */

const BOX = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor" } as const;

export function IconTrending() {
  return (
    <svg {...BOX} width={20} height={20} aria-hidden>
      <g className="ai-lift">
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline className="ai-arrowtip ai-d1" points="15 7 21 7 21 13" />
      </g>
    </svg>
  );
}

/** Daily brief. Not in the design's rail — see ActionRail for why it stays —
 *  so it keeps its own document glyph, given the set's staggered-line gesture
 *  so it reads as one family with Filter rather than as a leftover. */
export function IconBrief() {
  return (
    <svg {...BOX} width={20} height={20} aria-hidden>
      <path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h12a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5z" />
      <line className="ai-slide-r" x1="8" y1="9" x2="16" y2="9" />
      <line className="ai-slide-r ai-d1" x1="8" y1="12.5" x2="14" y2="12.5" />
      <line className="ai-slide-r ai-d2" x1="8" y1="16" x2="12" y2="16" />
    </svg>
  );
}

export function IconGlobal() {
  return (
    <svg {...BOX} width={20} height={20} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      {/* The meridian flattens as the globe "turns" toward the viewer. */}
      <ellipse className="ai-flat" cx="12" cy="12" rx="4.4" ry="9" />
    </svg>
  );
}

export function IconDomestic() {
  return (
    <svg {...BOX} width={20} height={20} aria-hidden>
      <polyline className="ai-lift" points="3 9.5 12 4 21 9.5" />
      <line className="ai-drop" x1="6.5" y1="11" x2="6.5" y2="17" />
      <line className="ai-drop ai-d1" x1="12" y1="11" x2="12" y2="17" />
      <line className="ai-drop ai-d2" x1="17.5" y1="11" x2="17.5" y2="17" />
      <line x1="4" y1="20" x2="20" y2="20" />
    </svg>
  );
}

export function IconLocal() {
  return (
    <svg {...BOX} width={20} height={20} aria-hidden>
      {/* The pin lifts off its shadow, which shrinks and fades as it rises. */}
      <ellipse className="ai-shadow" cx="12" cy="20.5" rx="3.4" ry="1.3" />
      <g className="ai-lift-lg">
        <path d="M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2.4" />
      </g>
    </svg>
  );
}

export function IconCompany() {
  return (
    <svg {...BOX} width={20} height={20} aria-hidden>
      <path className="ai-lift" d="M9 7V5.5A2.5 2.5 0 0 1 11.5 3h1A2.5 2.5 0 0 1 15 5.5V7" />
      <rect x="3" y="7" width="18" height="13" rx="2.5" />
      <line className="ai-narrow ai-d1" x1="3" y1="12.5" x2="21" y2="12.5" />
    </svg>
  );
}

/** Ask an analyst: the design's figure-at-a-lectern, which straightens up. */
export function IconAnalyst() {
  return (
    <svg {...BOX} width={20} height={20} aria-hidden>
      <circle className="ai-lift-sm" cx="12" cy="5.6" r="2.9" />
      <path className="ai-lift-half" d="M9.5 9 12 12.2 14.5 9" />
      <path d="M9.5 9 6.4 10.3A4.4 4.4 0 0 0 3.8 14.4V20h6.1" />
      <path d="M14.5 9l3.1 1.3a4.4 4.4 0 0 1 2.6 4.1V20h-6.1" />
      <path className="ai-dot ai-lift-sm ai-d1b" d="M10.6 12.9h2.8l-.7 3.1.9 3.9h-3.2l.9-3.9Z" />
    </svg>
  );
}

export function IconFilter() {
  return (
    <svg {...BOX} width={20} height={20} aria-hidden>
      <line x1="3.5" y1="7" x2="20.5" y2="7" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" />
      <line x1="3.5" y1="17" x2="20.5" y2="17" />
      {/* Knobs slide along their rails. Filled with the BUTTON's background
          rather than a hard white, so they still read as cut-outs once the
          button is selected and turns to ink. */}
      <circle className="ai-knob ai-slide-r5" cx="9" cy="7" r="2.2" />
      <circle className="ai-knob ai-slide-l5 ai-d1" cx="15.5" cy="12" r="2.2" />
      <circle className="ai-knob ai-slide-r5 ai-d2" cx="7.5" cy="17" r="2.2" />
    </svg>
  );
}

export function IconFeedback() {
  return (
    <svg {...BOX} width={20} height={20} aria-hidden>
      <path d="M21 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 4V5.5A2.5 2.5 0 0 1 6.5 3h12A2.5 2.5 0 0 1 21 5.5Z" />
      <circle className="ai-dot ai-lift" cx="8.5" cy="10" r="1.05" />
      <circle className="ai-dot ai-lift ai-d1b" cx="12.5" cy="10" r="1.05" />
      <circle className="ai-dot ai-lift ai-d2b" cx="16.5" cy="10" r="1.05" />
    </svg>
  );
}

export function IconHelp() {
  return (
    <svg {...BOX} width={20} height={20} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path className="ai-lift-sm" d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4" />
      <line className="ai-drop" x1="12" y1="17.4" x2="12" y2="17.4" />
    </svg>
  );
}

export function IconSettings() {
  return (
    <svg {...BOX} width={20} height={20} aria-hidden>
      <g className="ai-spin">
        <path d="M19.14 12.94a7.6 7.6 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.6 7.6 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.38.3.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.48 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64Z" />
      </g>
      <circle className="ai-shrink" cx="12" cy="12" r="3" />
    </svg>
  );
}

/** The close glyph used by every panel header: an X whose strokes rotate a
 *  quarter turn on hover, per the design. */
export function IconClose() {
  return (
    <svg {...BOX} width={14} height={14} aria-hidden>
      <line className="ai-quarter" x1="6" y1="6" x2="18" y2="18" />
      <line className="ai-quarter" x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
