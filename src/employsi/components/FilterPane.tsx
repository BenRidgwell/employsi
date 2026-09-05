import { useMemo, type CSSProperties } from "react";
import {
  Building2,
  Cpu,
  Factory,
  HeartPulse,
  Landmark,
  Pickaxe,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import { useAppStore, matchesFilters, type FilterState } from "../state/store";
import { COMPANIES, SECTOR_GROUPS, SECTOR_SHORT, EXCHANGES } from "../data/companies";
import { CITY_COMPANIES } from "../data/mapboxGeo";
import { REGION_HUBS, REGION_LABEL, cityLabel } from "../data/mapboxWorldGeo";
import { isReleasedCompany } from "../lib/markets";

/**
 * The Filter panel, built from `Filter_Popout.html`.
 *
 * The design's card: a header carrying the active-filter count, "Clear all" and
 * a round close; then eyebrowed sections for Sector (chips with counts),
 * Listing (a segmented control), two stepped sliders and a switch; then a
 * footer stating how many filters are on beside the primary apply button.
 *
 * FOUR PLACES THIS DIFFERS FROM THE MOCK, EACH FOR A REASON
 *
 *  1. The counts are REAL. The mock hard-codes seven sector counts and derives a
 *     result total by multiplying invented factors together. Here every number
 *     comes from COMPANIES through the app's own `matchesFilters`, and each
 *     sector chip shows a proper FACET count — how many companies that sector
 *     would give you with the OTHER filters still applied — which is what makes
 *     the number worth reading while you narrow down.
 *
 *  2. "Show N roles" is "Show N companies". This filter hides and shows company
 *     markers; it has never filtered roles. Counting roles here would put a
 *     number on the button that the button does not produce.
 *
 *  3. Stock exchange stays. It is a real drill-down under Public that the mock
 *     has no room for, and dropping working behaviour to match a picture is not
 *     a trade worth making. It uses the same chip style as Sector.
 *
 *  4. THERE IS NO "Hiring now only" ROW. It existed as a disabled switch marked
 *     Coming soon until 2026-09-05, when it was removed on request. Nothing was
 *     lost: it had no state behind it and never filtered anything.
 *
 *     If it comes back, the reason it was never wired is still true. This panel
 *     filters client-side over the static roster, and whether a company
 *     advertised in the last 30 days lives in D1 — fetched only when a card
 *     opens. Making it work means the panel has to reach the archive, which is
 *     a different shape of component, not a missing boolean.
 *
 * The apply button closes the panel: filters are applied live as they change
 * (they always have been), so there is nothing to defer — it is a "done".
 */

/** Track fill stops exactly at the thumb. */
function fill(value: number, min: number, max: number): CSSProperties {
  return { "--fill": `${((value - min) / (max - min)) * 100}%` } as CSSProperties;
}

/**
 * One Lucide glyph per sector group, exactly the seven the design names —
 * pickaxe, landmark, cpu, shopping-bag, factory, heart-pulse, building-2, in
 * that order.
 *
 * The design draws them as CSS masks over a remote unpkg URL. These are the
 * same icons as React components from the `lucide-react` already in
 * package.json: no third-party request at render time, no mask support to worry
 * about, and `currentColor` inherits the selected/unselected foreground the
 * same way the mask did.
 *
 * Keyed on the FULL group name, which is what COMPANIES stores and what
 * SECTOR_GROUPS iterates; SECTOR_SHORT supplies the label beneath.
 */
const SECTOR_ICON: Record<string, LucideIcon> = {
  "Energy & Natural Resources": Pickaxe,
  "Financial Services": Landmark,
  "Technology, Media and Telecommunications": Cpu,
  "Consumer and Retail": ShoppingBag,
  "Industrial Manufacturing": Factory,
  "Healthcare and Life Sciences": HeartPulse,
  "Infrastructure and Government": Building2,
};

const SALARY_MIN = 130;
const SALARY_MAX = 160;
const HEAD_MAX = 12000;

export function FilterPane() {
  const filterOpen = useAppStore((s) => s.filterOpen);
  const toggleFilter = useAppStore((s) => s.toggleFilter);
  const activeSectors = useAppStore((s) => s.activeSectors);
  const toggleSector = useAppStore((s) => s.toggleSector);
  const listingType = useAppStore((s) => s.listingType);
  const setListingType = useAppStore((s) => s.setListingType);
  const activeExchanges = useAppStore((s) => s.activeExchanges);
  const toggleExchange = useAppStore((s) => s.toggleExchange);
  const minSalary = useAppStore((s) => s.minSalary);
  const minHeadcount = useAppStore((s) => s.minHeadcount);
  const setMinSalary = useAppStore((s) => s.setMinSalary);
  const setMinHeadcount = useAppStore((s) => s.setMinHeadcount);
  const clearFilters = useAppStore((s) => s.clearFilters);
  const minGrowth = useAppStore((s) => s.minGrowth);
  const maxAttrition = useAppStore((s) => s.maxAttrition);
  const seesAllMarkets = useAppStore((s) => s.role) === "admin";

  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const localCity = useAppStore((s) => s.localCity);

  /**
   * The companies in view at the CURRENT LAYER, or null when the layer is the
   * whole world and no narrowing applies.
   *
   * Every number in this card counts markers the user can actually see. A chip
   * reading "Energy & Natural Resources 212" while Perth shows 31 of them is
   * not a filter preview, it is a fact about a different screen — and the
   * counts exist to tell you what clicking will do here.
   *
   * The scope is taken from the same two maps the map components use, not from
   * a definition invented here: PerthMapbox draws CITY_COMPANIES[city], and the
   * domestic views walk REGION_HUBS[region]. Note that region 'australia'
   * includes Auckland and Wellington, which is why it is labelled Australia &
   * New Zealand — the count and the label agree because both come from the same
   * hub list.
   */
  const scopeIds = useMemo(() => {
    if (!zoomedOut) return new Set((CITY_COMPANIES[localCity] || []).map((c) => c.id));
    if (!globalOut) {
      const ids = new Set<string>();
      for (const hub of REGION_HUBS[domesticRegion] || []) {
        for (const c of CITY_COMPANIES[hub] || []) ids.add(c.id);
      }
      return ids;
    }
    return null;
  }, [zoomedOut, globalOut, domesticRegion, localCity]);

  /** What the counts are counting, for the header. */
  const scopeLabel = !zoomedOut
    ? cityLabel(localCity)
    : !globalOut
      ? REGION_LABEL[domesticRegion] || domesticRegion
      : "Worldwide";

  // The companies this account can see at all, narrowed to the layer. Counting
  // against anything wider would advertise markets the person cannot open.
  const universe = useMemo(
    () =>
      COMPANIES.filter(
        (c) =>
          (seesAllMarkets || isReleasedCompany(c.id)) && (scopeIds === null || scopeIds.has(c.id)),
      ),
    [seesAllMarkets, scopeIds],
  );

  const base: FilterState = useMemo(
    () => ({
      searchQuery: "",
      activeSectors,
      listingType,
      activeExchanges,
      minSalary,
      minHeadcount,
      minGrowth,
      maxAttrition,
    }),
    [activeSectors, listingType, activeExchanges, minSalary, minHeadcount, minGrowth, maxAttrition],
  );

  /** How many companies the current filter set actually shows. */
  const results = useMemo(
    () => universe.filter((c) => matchesFilters(c, base)).length,
    [universe, base],
  );

  /**
   * Facet counts: for each sector, how many companies you would get with that
   * sector selected and every OTHER filter left as it is. Computed with
   * activeSectors emptied so a chip's number does not collapse to zero the
   * moment a different sector is chosen.
   */
  const sectorCounts = useMemo(() => {
    const withoutSector: FilterState = { ...base, activeSectors: [] };
    const pool = universe.filter((c) => matchesFilters(c, withoutSector));
    const out: Record<string, number> = {};
    for (const cat of SECTOR_GROUPS) {
      out[cat] = pool.filter((c) =>
        matchesFilters(c, { ...withoutSector, activeSectors: [cat] }),
      ).length;
    }
    return out;
  }, [universe, base]);

  const activeCount =
    activeSectors.length +
    (listingType ? 1 : 0) +
    activeExchanges.length +
    (minSalary > SALARY_MIN ? 1 : 0) +
    (minHeadcount > 0 ? 1 : 0) +
    (minGrowth > 0 ? 1 : 0) +
    (maxAttrition < 16 ? 1 : 0);

  if (!filterOpen) return null;

  const listings: { key: "all" | "public" | "private"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "public", label: "Public" },
    { key: "private", label: "Private" },
  ];
  const current = listingType ?? "all";

  return (
    <>
      {/* Click-away, matching the pointerdown-outside listener in the design. */}
      <div className="fpscrim" onClick={toggleFilter} />
      <div className="filterpane">
        <div className="fphd">
          <div className="fphdleft">
            <span className="fptitle">Filter</span>
            {/* Names what every count below is counting. Without it the numbers
                change as you zoom and there is nothing on the card explaining
                why. */}
            <span className="fpscope">{scopeLabel}</span>
          </div>
          <button type="button" className="fpx" onClick={toggleFilter} aria-label="Close filter">
            <svg
              viewBox="0 0 24 24"
              width={17}
              height={17}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="fpbody">
          <section className="fpsec">
            <div className="fpsechd">
              <span className="fpeyebrow">Sector</span>
            </div>
            {/* Four across, seven items, so the last row is short — the design
                is drawn that way rather than balanced. */}
            <div className="fpsectors">
              {SECTOR_GROUPS.map((cat) => {
                const on = activeSectors.includes(cat);
                const Icon = SECTOR_ICON[cat];
                const label = SECTOR_SHORT[cat] || cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`fpsector${on ? " on" : ""}`}
                    aria-pressed={on}
                    // The visible label is the SHORT one, so the full group name
                    // has to reach a screen reader some other way — an icon
                    // button reading "Tech & media 4" otherwise loses which
                    // classification it belongs to.
                    title={cat}
                    aria-label={`${cat}, ${sectorCounts[cat] ?? 0} companies`}
                    onClick={() => toggleSector(cat)}
                  >
                    <span className="fpsecticon">
                      <Icon size={21} strokeWidth={1.75} aria-hidden />
                      <span className="fpsectn">{sectorCounts[cat] ?? 0}</span>
                    </span>
                    <span className="fpsectlabel">{label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="fpsec fpsecrow">
            <span className="fpeyebrow">Listing</span>
            <div className="fpseg">
              {listings.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  className={`fpsegbtn${current === l.key ? " on" : ""}`}
                  aria-pressed={current === l.key}
                  onClick={() => {
                    // setListingType toggles off when re-selected, so "All" is
                    // expressed by clearing whatever is currently set.
                    if (l.key === "all") {
                      if (listingType) setListingType(listingType);
                    } else if (listingType !== l.key) {
                      setListingType(l.key);
                    }
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </section>

          {listingType === "public" && (
            <section className="fpsec">
              <div className="fpsechd">
                <span className="fpeyebrow">Stock exchange</span>
                <span className="fpsummary">
                  {activeExchanges.length
                    ? `${activeExchanges.length} of ${EXCHANGES.length}`
                    : "All exchanges"}
                </span>
              </div>
              <div className="fpchips">
                {EXCHANGES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className={`fpchip${activeExchanges.includes(ex) ? " on" : ""}`}
                    aria-pressed={activeExchanges.includes(ex)}
                    onClick={() => toggleExchange(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="fpsec">
            <div className="fpsechd">
              <span className="fpeyebrow">Salary floor</span>
              <span className={`fpvalue${minSalary > SALARY_MIN ? " on" : ""}`}>
                {minSalary > SALARY_MIN ? `$${minSalary}k+` : "Any"}
              </span>
            </div>
            {/* The design draws rail, fill and thumb itself over a pointer-drag
                div. A real range input is kept and made transparent on top of
                those, so the control keeps its keyboard and screen-reader
                behaviour while looking exactly like the drawing. */}
            <div className="fptrack" style={fill(minSalary, SALARY_MIN, SALARY_MAX)}>
              <span className="fprail" />
              <span className="fpfill" />
              <span className="fpthumb" />
              <input
                type="range"
                className="fprange"
                min={SALARY_MIN}
                max={SALARY_MAX}
                step={1}
                value={minSalary}
                onChange={(e) => setMinSalary(Number(e.target.value))}
                aria-label="Minimum salary"
              />
            </div>
            <div className="fpends">
              <span>Any</span>
              <span>${SALARY_MAX}k+</span>
            </div>
          </section>

          <section className="fpsec">
            <div className="fpsechd">
              <span className="fpeyebrow">Headcount</span>
              <span className={`fpvalue${minHeadcount > 0 ? " on" : ""}`}>
                {minHeadcount > 0 ? minHeadcount.toLocaleString("en-US") + "+" : "Any"}
              </span>
            </div>
            <div className="fptrack" style={fill(minHeadcount, 0, HEAD_MAX)}>
              <span className="fprail" />
              <span className="fpfill" />
              <span className="fpthumb" />
              <input
                type="range"
                className="fprange"
                min={0}
                max={HEAD_MAX}
                step={250}
                value={minHeadcount}
                onChange={(e) => setMinHeadcount(Number(e.target.value))}
                aria-label="Minimum headcount"
              />
            </div>
            <div className="fpends">
              <span>Any</span>
              <span>{HEAD_MAX.toLocaleString("en-US")}+</span>
            </div>
          </section>
        </div>

        <div className="fpfoot">
          <span className="fpnote">
            {activeCount
              ? `${activeCount} ${activeCount === 1 ? "filter" : "filters"} applied`
              : "No filters applied"}
          </span>
          {/* MOVED HERE FROM THE HEADER, which the design gives to the title,
              the scope and the close button alone. Clearing is a real action
              and the design has nowhere else for it; the footer's left slot is
              already about the filter state, so it reads with the count rather
              than competing with the primary button. */}
          {activeCount > 0 && (
            <button type="button" className="fpghost" onClick={clearFilters}>
              Clear all
            </button>
          )}
          <button type="button" className="fpapply" onClick={toggleFilter}>
            Show {results.toLocaleString("en-US")} {results === 1 ? "company" : "companies"}
          </button>
        </div>
      </div>
    </>
  );
}
