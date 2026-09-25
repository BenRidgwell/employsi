import { useAppStore } from "../state/store";

/**
 * The Supply / Demand switch, ported from the Supply_Demand_Switch design.
 *
 * IT DRIVES ONE THING: `marketMode` in the store, which today reaches only the
 * top two buttons of the action rail. Everything else in the app is the demand
 * reading of the market regardless of where this sits. See the note on
 * `marketMode` for why that is deliberate rather than half-finished.
 *
 * WHAT WAS TAKEN FROM THE DESIGN, verbatim: the 104×30 track segments, the 3px
 * padding, the pill radius, the ink thumb, both 280ms cubic-bezier(.2,0,0,1)
 * transitions (the thumb's translate and the icon's scale), the 200ms colour
 * fade on the label, the two icons and the arrow knocked out of the Demand
 * circle by a mask, and the tablist/tab roles with left/right arrow keys.
 *
 * WHAT WAS NOT: the design's inline styles, which are written here as the
 * classes the rest of this codebase uses, against the same tokens the design
 * itself declares — `--surface-sunken`, `--neutral-900`, `--text-secondary` and
 * `--font-sans` are all this product's own, so nothing is re-specified as a
 * literal. Its `thumbStyle: "light"` and `sheen` props are not here either:
 * both default to off in the design, and an unused variant of a control nobody
 * can act on yet is code with no way to be right or wrong.
 */

/** One track segment. The thumb is the same width, and the translate that moves
 *  it is exactly this — see the CSS. */
const SEG_W = 104;

function IconSupply() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx={12} cy={12} r={10} />
      <path d="M16 8 8 16" />
      <path d="M8 10v6h6" />
    </svg>
  );
}

function IconDemand() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* The design's inverse of the Supply glyph: a filled disc with the
          out-arrow cut out of it, rather than a second outlined circle. The
          mask id is global to the document, so it is spelled out rather than
          generated — this control is rendered once. */}
      <defs>
        <mask id="sd-demand-mask">
          <rect width={24} height={24} fill="#fff" stroke="none" />
          <path d="M8 16 16 8" stroke="#000" />
          <path d="M10 8h6v6" stroke="#000" />
        </mask>
      </defs>
      <circle
        cx={12}
        cy={12}
        r={11}
        fill="currentColor"
        stroke="none"
        mask="url(#sd-demand-mask)"
      />
    </svg>
  );
}

export function SupplyDemandSwitch() {
  const mode = useAppStore((s) => s.marketMode);
  const setMode = useAppStore((s) => s.setMarketMode);

  return (
    <div
      className="sdsw"
      role="tablist"
      aria-label="Supply or demand"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setMode("supply");
        if (e.key === "ArrowRight") setMode("demand");
      }}
    >
      <span
        className="sdswthumb"
        style={{ transform: `translateX(${mode === "demand" ? SEG_W : 0}px)` }}
        aria-hidden
      />
      {(["supply", "demand"] as const).map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          className="sdswbtn"
          aria-selected={mode === id}
          onClick={() => setMode(id)}
        >
          {id === "supply" ? <IconSupply /> : <IconDemand />}
          <span>{id === "supply" ? "Supply" : "Demand"}</span>
        </button>
      ))}
    </div>
  );
}
