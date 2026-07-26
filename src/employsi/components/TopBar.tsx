import { useMemo, type CSSProperties } from "react";
import { BrandMark } from "./BrandMark";
import { AccountButton } from "./AccountButton";
import { useAppStore, isFilterActive, isSearchActive, type FilterState } from "../state/store";
import { COMPANIES, SECTOR_GROUPS, EXCHANGES } from "../data/companies";
import { cityForCompany } from "../data/mapboxGeo";
import { popularSkills as popularSkillsForLayer } from "../lib/skillHeat";
import { GLOBAL_HUB_LABEL } from "../data/geo";
import { ALL_SKILLS } from "../data/skillsTaxonomy";
import { describeSkills } from "../lib/describeSkills";

const SECTORS = SECTOR_GROUPS;
// Short chip labels so the sector selection reads as a compact mosaic rather
// than a stack of full-width rows.
const SECTOR_SHORT: Record<string, string> = {
  "Energy & Natural Resources": "Natural Resources",
  "Financial Services": "Financial",
  "Technology, Media and Telecommunications": "Tech & Media",
  "Consumer and Retail": "Consumer & Retail",
  "Industrial Manufacturing": "Industrial",
  "Healthcare and Life Sciences": "Healthcare",
  "Infrastructure and Government": "Infra & Gov",
};

function SearchIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.6" y2="16.6" />
    </svg>
  );
}

// Position of the thumb along [min,max] as a CSS custom property, so the
// slider's purple fill always stops exactly at the thumb.
function fillStyle(value: number, min: number, max: number): CSSProperties {
  const pct = ((value - min) / (max - min)) * 100;
  return { "--fill": `${pct}%` } as CSSProperties;
}

function FilterIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </svg>
  );
}

export function TopBar() {
  const searchOpen = useAppStore((s) => s.searchOpen);
  const toggleSearch = useAppStore((s) => s.toggleSearch);
  const filterOpen = useAppStore((s) => s.filterOpen);
  const toggleFilter = useAppStore((s) => s.toggleFilter);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const clearSearch = useAppStore((s) => s.clearSearch);
  const activeSectors = useAppStore((s) => s.activeSectors);
  const toggleSector = useAppStore((s) => s.toggleSector);
  const listingType = useAppStore((s) => s.listingType);
  const setListingType = useAppStore((s) => s.setListingType);
  const activeExchanges = useAppStore((s) => s.activeExchanges);
  const toggleExchange = useAppStore((s) => s.toggleExchange);
  const toggleSkillQuery = useAppStore((s) => s.toggleSkillQuery);
  const minSalary = useAppStore((s) => s.minSalary);
  const minHeadcount = useAppStore((s) => s.minHeadcount);
  const minGrowth = useAppStore((s) => s.minGrowth);
  const maxAttrition = useAppStore((s) => s.maxAttrition);
  const setMinSalary = useAppStore((s) => s.setMinSalary);
  const setMinHeadcount = useAppStore((s) => s.setMinHeadcount);
  const clearFilters = useAppStore((s) => s.clearFilters);
  const globalOut = useAppStore((s) => s.globalOut);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  // The centred search header replaces the top-right search on BOTH the global
  // and domestic overviews (both are zoomedOut); only the local city view keeps
  // the top-right search button.
  const showGlobalSearch = zoomedOut;
  void globalOut;

  const filterState: FilterState = {
    searchQuery,
    activeSectors,
    listingType,
    activeExchanges,
    minSalary,
    minHeadcount,
    minGrowth,
    maxAttrition,
  };
  const filterActive = isFilterActive(filterState);
  const searchActive = isSearchActive(filterState);

  // Local search: every company mapped on the current city's map is searchable
  // by name, ticker, skill or role. Selecting one opens its card and the map
  // pans to it (the [selectedId] effect in PerthMapbox frames the building).
  const localCity = useAppStore((s) => s.localCity);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const skillIndex = useAppStore((s) => s.skillIndex);
  const select = useAppStore((s) => s.select);
  const zoomInCity = useAppStore((s) => s.zoomInCity);

  // Popular-skill chips, ranked by real demand for the current layer — on the
  // local view that's the companies in this city (shared helper keeps the
  // global/domestic centred search in sync).
  const skills = useMemo(
    () => popularSkillsForLayer(skillIndex, { zoomedOut, globalOut, domesticRegion, localCity }, 8),
    [skillIndex, zoomedOut, globalOut, domesticRegion, localCity],
  );

  // Full search — the same skills + companies + cities the desktop GlobalSearch
  // offers, so the mobile bottom-bar search (which uses this flyout on every
  // layer) has parity with dev instead of only finding local-city companies.
  type SResult =
    | { kind: "company"; id: string; label: string; sub: string }
    | { kind: "city"; id: string; label: string; sub: string }
    | { kind: "skill"; id: string; label: string; sub: string };
  const searchResults = useMemo<SResult[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const companies: SResult[] = COMPANIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q),
    )
      .slice(0, 6)
      .map((c) => ({ kind: "company", id: c.id, label: c.name, sub: c.ticker }));
    const cities: SResult[] = Object.entries(GLOBAL_HUB_LABEL)
      .filter(([, label]) => label.toLowerCase().includes(q))
      .slice(0, 6)
      .map(([id, label]) => ({ kind: "city", id, label, sub: "City" }));
    const direct = ALL_SKILLS.filter((sk) => sk.toLowerCase().includes(q));
    const described = describeSkills(searchQuery).filter((sk) => !direct.includes(sk));
    const skillRes: SResult[] = [...direct, ...described]
      .slice(0, 7)
      .map((sk) => ({ kind: "skill", id: sk, label: sk, sub: "Skill" }));
    return [...skillRes, ...companies, ...cities];
  }, [searchQuery]);

  const goSearchResult = (r: SResult) => {
    if (r.kind === "skill") {
      toggleSkillQuery(r.id);
      return; // keep the flyout for further picks; the map recolours behind it
    }
    if (r.kind === "company") {
      zoomInCity(cityForCompany(r.id));
      select(r.id);
    } else {
      zoomInCity(r.id);
    }
    setSearchQuery("");
    if (searchOpen) toggleSearch();
  };

  return (
    <div className="topbar">
      <div className="brand">
        <BrandMark />
        <div className="bwrap">
          <span className="logo">employsi</span>
        </div>
      </div>
      <div className="controls">
        <AccountButton />
        {/* The search group is always in the DOM so the mobile bottom bar can
            open its flyout on every layer. On desktop zoomed-out views the
            centred GlobalSearch is used instead, so the top-right button is
            hidden there via the `gshidden` class (CSS, desktop only). */}
        <div className={`cgroup searchwrap ${showGlobalSearch ? "gshidden" : ""}`}>
          <span className="seglbl">Search</span>
          <button
            className={`searchbtn ${searchOpen ? "on" : ""} ${searchActive ? "active" : ""}`}
            onClick={toggleSearch}
          >
            <SearchIcon />
            <span>Search</span>
            {searchActive && <span className="sdot green" />}
          </button>
          {searchOpen && <div className="sfscrim" onClick={toggleSearch} />}
          <div className={`searchflyout ${searchOpen ? "open" : ""}`}>
            <input
              className="sfinput"
              placeholder="Search a job, skill, or company"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus={searchOpen}
            />
            {searchQuery.trim() && (
              <div className="sfresults">
                {searchResults.length > 0 ? (
                  searchResults.map((r) => (
                    <button
                      key={`${r.kind}-${r.id}`}
                      className="sfresult"
                      onClick={() => goSearchResult(r)}
                    >
                      <span className={`sfresultkind ${r.kind}`}>
                        {r.kind === "company" ? "Co." : r.kind === "city" ? "City" : "Skill"}
                      </span>
                      <span className="sfresultname">{r.label}</span>
                      {r.sub && <span className="sfresultticker">{r.sub}</span>}
                    </button>
                  ))
                ) : (
                  <div className="sfresultempty">
                    No skills, companies or cities match “{searchQuery.trim()}”
                  </div>
                )}
              </div>
            )}
            <div className="sflabel">Popular skills</div>
            <div className="sfchips">
              {skills.map((sk) => (
                <button
                  key={sk}
                  className={`sfchip ${searchQuery.trim().toLowerCase() === sk.toLowerCase() ? "on" : ""}`}
                  onClick={() => toggleSkillQuery(sk)}
                >
                  {sk}
                </button>
              ))}
            </div>
            {searchActive && (
              <button className="sfclear" onClick={clearSearch}>
                Clear search
              </button>
            )}
          </div>
        </div>
        <div className="cgroup searchwrap">
          <span className="seglbl">Filter</span>
          <button
            className={`searchbtn ${filterOpen ? "on" : ""} ${filterActive ? "active" : ""}`}
            onClick={toggleFilter}
          >
            <FilterIcon />
            <span>Filter</span>
            {filterActive && <span className="sdot green" />}
          </button>
          {filterOpen && <div className="sfscrim" onClick={toggleFilter} />}
          <div className={`searchflyout ${filterOpen ? "open" : ""}`}>
            <div className="sflabel">Sector</div>
            <div className="sfchips sfmosaic">
              {SECTORS.map((cat) => (
                <button
                  key={cat}
                  className={`sfchip sfchipsm ${activeSectors.includes(cat) ? "on" : ""}`}
                  onClick={() => toggleSector(cat)}
                >
                  {SECTOR_SHORT[cat] || cat}
                </button>
              ))}
            </div>
            <div className="sflabel">Listing</div>
            <div className="sfchips">
              <button
                className={`sfchip sfchipsm ${listingType === "public" ? "on" : ""}`}
                onClick={() => setListingType("public")}
              >
                Public
              </button>
              <button
                className={`sfchip sfchipsm ${listingType === "private" ? "on" : ""}`}
                onClick={() => setListingType("private")}
              >
                Private
              </button>
            </div>
            {listingType === "public" && (
              <div className="sfsub">
                <div className="sflabel sfsublabel">Stock exchange</div>
                <div className="sfchips sfmosaic">
                  {EXCHANGES.map((ex) => (
                    <button
                      key={ex}
                      className={`sfchip sfchipsm ${activeExchanges.includes(ex) ? "on" : ""}`}
                      onClick={() => toggleExchange(ex)}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="sfrangerow">
              <span>Salary</span>
              <b>${minSalary}K+</b>
            </div>
            <input
              type="range"
              className="sfrange"
              style={fillStyle(minSalary, 130, 160)}
              min={130}
              max={160}
              step={1}
              value={minSalary}
              onChange={(e) => setMinSalary(Number(e.target.value))}
            />
            <div className="sfrangerow">
              <span>Headcount</span>
              <b>{minHeadcount > 0 ? minHeadcount.toLocaleString("en-US") + "+" : "Any"}</b>
            </div>
            <input
              type="range"
              className="sfrange"
              style={fillStyle(minHeadcount, 0, 12000)}
              min={0}
              max={12000}
              step={250}
              value={minHeadcount}
              onChange={(e) => setMinHeadcount(Number(e.target.value))}
            />
            <button className="sfclear" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
