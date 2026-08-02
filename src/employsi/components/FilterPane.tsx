import { useMemo, type CSSProperties } from "react";
import { useAppStore, matchesFilters, type FilterState } from "../state/store";
import { COMPANIES, SECTOR_GROUPS, SECTOR_SHORT, EXCHANGES } from "../data/companies";
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
 *  4. "Hiring now only" is marked Coming soon, using the same treatment as the
 *     settings card. The filter runs client-side over the static roster; whether
 *     a company advertised in the last 30 days lives in D1 and is only fetched
 *     when a card opens. A switch that silently did nothing would be worse than
 *     one that says it is not ready.
 *
 * The apply button closes the panel: filters are applied live as they change
 * (they always have been), so there is nothing to defer — it is a "done".
 */

/** Track fill stops exactly at the thumb. */
function fill(value: number, min: number, max: number): CSSProperties {
  return { "--fill": `${((value - min) / (max - min)) * 100}%` } as CSSProperties;
}

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

  // The companies this account can see at all. Counting against anything wider
  // would advertise markets the person cannot open.
  const universe = useMemo(
    () => COMPANIES.filter((c) => seesAllMarkets || isReleasedCompany(c.id)),
    [seesAllMarkets],
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
            {activeCount > 0 && <span className="fpcount">{activeCount}</span>}
          </div>
          <div className="fphdright">
            {activeCount > 0 && (
              <button type="button" className="fpghost" onClick={clearFilters}>
                Clear all
              </button>
            )}
            <button type="button" className="fpx" onClick={toggleFilter} aria-label="Close filter">
              <svg
                viewBox="0 0 24 24"
                width={15}
                height={15}
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
        </div>

        <div className="fpbody">
          <section className="fpsec">
            <div className="fpsechd">
              <span className="fpeyebrow">Sector</span>
              <span className="fpsummary">
                {activeSectors.length
                  ? `${activeSectors.length} of ${SECTOR_GROUPS.length}`
                  : "All sectors"}
              </span>
            </div>
            <div className="fpchips">
              {SECTOR_GROUPS.map((cat) => {
                const on = activeSectors.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`fpchip${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggleSector(cat)}
                  >
                    {SECTOR_SHORT[cat] || cat}
                    <span className="fpchipn">{sectorCounts[cat] ?? 0}</span>
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
            <input
              type="range"
              className="fprange"
              style={fill(minSalary, SALARY_MIN, SALARY_MAX)}
              min={SALARY_MIN}
              max={SALARY_MAX}
              step={1}
              value={minSalary}
              onChange={(e) => setMinSalary(Number(e.target.value))}
              aria-label="Minimum salary"
            />
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
            <input
              type="range"
              className="fprange"
              style={fill(minHeadcount, 0, HEAD_MAX)}
              min={0}
              max={HEAD_MAX}
              step={250}
              value={minHeadcount}
              onChange={(e) => setMinHeadcount(Number(e.target.value))}
              aria-label="Minimum headcount"
            />
            <div className="fpends">
              <span>Any</span>
              <span>{HEAD_MAX.toLocaleString("en-US")}+</span>
            </div>
          </section>

          <section className="fpsec fpsecrow fpmuted">
            <div className="fpswitchtext">
              <span className="fpswitchtitle">
                Hiring now only
                <span className="stsoon">Coming soon</span>
              </span>
              <span className="fpswitchsub">Companies advertising in the last 30 days.</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={false}
              aria-label="Toggle hiring now only"
              className="stswitch"
              disabled
            >
              <span className="stswitchknob" />
            </button>
          </section>
        </div>

        <div className="fpfoot">
          <span className="fpnote">
            {activeCount
              ? `${activeCount} ${activeCount === 1 ? "filter" : "filters"} active`
              : "No filters applied"}
          </span>
          <button type="button" className="fpapply" onClick={toggleFilter}>
            Show {results.toLocaleString("en-US")} {results === 1 ? "company" : "companies"}
          </button>
        </div>
      </div>
    </>
  );
}
