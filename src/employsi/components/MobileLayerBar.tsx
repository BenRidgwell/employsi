import { useAppStore } from "../state/store";

// The layer picker as a horizontal segmented control, directly under the
// search field. Phones only — CSS hides it above 680px, where ActionRail's
// vertical `.railtray` is the same control in the same role.
//
// The two are deliberately one behaviour in two shapes: the layer, the
// navigation (`goTo`) and the company-layer entry point are read from and
// written to the same store here as there, so a phone and a desktop cannot
// disagree about which layer is current. Only the geometry differs — a tray
// down the left has nowhere to go at 390px.

const svg = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Icon paths lifted verbatim from the design's LAYERS table. */
const LAYERS = [
  {
    key: "global",
    label: "Global",
    d: [
      "M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0",
      "M3 12h18",
      "M12 3c3.2 3.6 3.2 14.4 0 18",
      "M12 3c-3.2 3.6-3.2 14.4 0 18",
    ],
  },
  {
    key: "domestic",
    label: "Domestic",
    d: ["M3 9.5 12 4l9 5.5", "M6.5 11v6", "M12 11v6", "M17.5 11v6", "M4 20h16"],
  },
  {
    key: "local",
    label: "Local",
    d: [
      "M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z",
      "M14.4 10a2.4 2.4 0 1 0-4.8 0 2.4 2.4 0 0 0 4.8 0",
    ],
  },
  {
    key: "company",
    label: "Company",
    d: [
      "M9 7V5.5A2.5 2.5 0 0 1 11.5 3h1A2.5 2.5 0 0 1 15 5.5V7",
      "M3 9.5A2.5 2.5 0 0 1 5.5 7h13A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z",
      "M3 12.5h18",
    ],
  },
] as const;

export function MobileLayerBar() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  const selectedId = useAppStore((s) => s.selectedId);
  const setZoomLevel = useAppStore((s) => s.setZoomLevel);
  const closePanel = useAppStore((s) => s.closePanel);
  const openCompanyLayer = useAppStore((s) => s.openCompanyLayer);

  // Same rule as ActionRail, kept verbatim so the two indicators cannot
  // disagree: an open company card is the deepest layer and wins; otherwise
  // zoomedOut/globalOut pick the map tier.
  const companyOpen = selectedId != null;
  const layer = companyOpen ? "company" : !zoomedOut ? "local" : globalOut ? "global" : "domestic";

  const goTo = (n: 0 | 1 | 2) => {
    if (companyOpen) closePanel();
    setZoomLevel(n);
  };

  const pick = (key: (typeof LAYERS)[number]["key"]) => {
    if (key === "company") return openCompanyLayer();
    goTo(key === "global" ? 2 : key === "domestic" ? 1 : 0);
  };

  return (
    // Same reason as MobileSearch's `data-tour="search"`: the tour's "Change
    // what you are looking at" step anchors on `rail`, which only exists on
    // ActionRail's tray — hidden at this width. This bar IS the layer tray on
    // a phone, so it is what that step should be pointing at.
    <div className="mlayerbar" role="group" aria-label="Map layer" data-tour="rail">
      {LAYERS.map((l) => (
        <button
          key={l.key}
          type="button"
          className={`mlayer ${layer === l.key ? "on" : ""}`}
          onClick={() => pick(l.key)}
          aria-pressed={layer === l.key}
        >
          <svg {...svg} width="15" height="15">
            {l.d.map((p) => (
              <path key={p} d={p} />
            ))}
          </svg>
          {l.label}
        </button>
      ))}
    </div>
  );
}
