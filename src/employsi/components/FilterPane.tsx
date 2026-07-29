import type { CSSProperties } from "react";
import { useAppStore } from "../state/store";
import { SECTOR_GROUPS, SECTOR_SHORT, EXCHANGES } from "../data/companies";
import { IconClose } from "./ActionIcons";

/**
 * The Filter panel, built from `Employsi Action Banner.html`.
 *
 * The design puts Filter in the left rail rather than the header, and gives it
 * this panel: sector chips, listing chips, two sliders and a clear button. The
 * panel renders at the app root rather than inside the rail, because the rail is
 * hidden below 680px while the mobile tab bar still has a Filter button — as a
 * rail child the panel would have been unreachable on phones. It
 * is wired to the same store fields the header flyout used, so every filter
 * behaves exactly as before — this is a relocation and a restyle, not a change
 * to what filtering does.
 *
 * Two things the design's mock does not have, kept because they are real
 * functionality: the stock-exchange sub-list (shown under Listing when Public
 * is selected), and the salary slider's real 130–160k range.
 */

// Short chip labels, matching the design's seven sector chips one-for-one.
// Track fill stops exactly at the thumb.
function fill(value: number, min: number, max: number): CSSProperties {
  return { "--fill": `${((value - min) / (max - min)) * 100}%` } as CSSProperties;
}

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

  if (!filterOpen) return null;

  return (
    <>
      {/* Click-away, matching the pointerdown-outside listener in the design. */}
      <div className="fpscrim" onClick={toggleFilter} />
      <div className="filterpane">
        <div className="fphd">
          <span className="fptitle">Filter</span>
          <button type="button" className="fpx" onClick={toggleFilter} aria-label="Close filter">
            <IconClose />
          </button>
        </div>

        <span className="fplbl">Sector</span>
        <div className="fpchips">
          {SECTOR_GROUPS.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`fpchip${activeSectors.includes(cat) ? " on" : ""}`}
              aria-pressed={activeSectors.includes(cat)}
              onClick={() => toggleSector(cat)}
            >
              {SECTOR_SHORT[cat] || cat}
            </button>
          ))}
        </div>

        <span className="fplbl">Listing</span>
        <div className="fpchips">
          {(["public", "private"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`fpchip fpchipwide${listingType === t ? " on" : ""}`}
              aria-pressed={listingType === t}
              onClick={() => setListingType(t)}
            >
              {t === "public" ? "Public" : "Private"}
            </button>
          ))}
        </div>

        {listingType === "public" && (
          <>
            <span className="fplbl">Stock exchange</span>
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
          </>
        )}

        <div className="fpslider">
          <div className="fpsliderhd">
            <span className="fplbl">Salary</span>
            <span className="fpvalue">${minSalary}k+</span>
          </div>
          <input
            type="range"
            className="fprange"
            style={fill(minSalary, 130, 160)}
            min={130}
            max={160}
            step={1}
            value={minSalary}
            onChange={(e) => setMinSalary(Number(e.target.value))}
            aria-label="Minimum salary"
          />
        </div>

        <div className="fpslider">
          <div className="fpsliderhd">
            <span className="fplbl">Headcount</span>
            <span className="fpvalue">
              {minHeadcount > 0 ? minHeadcount.toLocaleString("en-US") + "+" : "Any"}
            </span>
          </div>
          <input
            type="range"
            className="fprange"
            style={fill(minHeadcount, 0, 12000)}
            min={0}
            max={12000}
            step={250}
            value={minHeadcount}
            onChange={(e) => setMinHeadcount(Number(e.target.value))}
            aria-label="Minimum headcount"
          />
        </div>

        <button type="button" className="fpclear" onClick={clearFilters}>
          Clear filters
        </button>
      </div>
    </>
  );
}
