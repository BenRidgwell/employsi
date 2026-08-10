import { useMemo } from "react";
import { isReleasedCompany, isReleasedPlace } from "../lib/markets";
import { BrandMark } from "./BrandMark";
import { AccountButton } from "./AccountButton";
import { HelpDock } from "./HelpDock";
import { useAppStore, isSearchActive, type FilterState } from "../state/store";
import { COMPANIES } from "../data/companies";
import { searchCityFor } from "../data/mapboxGeo";
import { popularSkills as popularSkillsForLayer } from "../lib/skillHeat";
import { GLOBAL_HUB_LABEL } from "../data/geo";
import { ALL_SKILLS } from "../data/skillsTaxonomy";
import { describeSkills } from "../lib/describeSkills";
import { useOntologyReady } from "../hooks/useOntologyReady";

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

export function TopBar() {
  const searchOpen = useAppStore((s) => s.searchOpen);
  const toggleSearch = useAppStore((s) => s.toggleSearch);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const seesAllMarkets = useAppStore((s) => s.role) === "admin";
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const clearSearch = useAppStore((s) => s.clearSearch);
  const activeSectors = useAppStore((s) => s.activeSectors);
  const listingType = useAppStore((s) => s.listingType);
  const activeExchanges = useAppStore((s) => s.activeExchanges);
  const toggleSkillQuery = useAppStore((s) => s.toggleSkillQuery);
  const minSalary = useAppStore((s) => s.minSalary);
  const minHeadcount = useAppStore((s) => s.minHeadcount);
  const minGrowth = useAppStore((s) => s.minGrowth);
  const maxAttrition = useAppStore((s) => s.maxAttrition);
  const globalOut = useAppStore((s) => s.globalOut);
  const zoomedOut = useAppStore((s) => s.zoomedOut);

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
  const demandMode = useAppStore((s) => s.demandMode);
  const skills = useMemo(
    () =>
      popularSkillsForLayer(
        skillIndex,
        { zoomedOut, globalOut, domesticRegion, localCity },
        8,
        demandMode,
      ),
    [skillIndex, zoomedOut, globalOut, domesticRegion, localCity, demandMode],
  );

  // Full search — the same skills + companies + cities the desktop GlobalSearch
  // offers, so the mobile bottom-bar search (which uses this flyout on every
  // layer) has parity with dev instead of only finding local-city companies.
  type SResult =
    | { kind: "company"; id: string; label: string; sub: string }
    | { kind: "city"; id: string; label: string; sub: string }
    | { kind: "skill"; id: string; label: string; sub: string };
  const ontologyReady = useOntologyReady();

  const searchResults = useMemo<SResult[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    // Same market filter as GlobalSearch — this is the second search surface,
    // and gating one of two doors is not gating the door.
    const companies: SResult[] = COMPANIES.filter(
      (c) =>
        (c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)) &&
        (seesAllMarkets || isReleasedCompany(c.id)),
    )
      .slice(0, 6)
      .map((c) => ({ kind: "company", id: c.id, label: c.name, sub: c.ticker }));
    const cities: SResult[] = Object.entries(GLOBAL_HUB_LABEL)
      .filter(
        ([id, label]) => label.toLowerCase().includes(q) && (seesAllMarkets || isReleasedPlace(id)),
      )
      .slice(0, 6)
      .map(([id, label]) => ({ kind: "city", id, label, sub: "City" }));
    const direct = ALL_SKILLS.filter((sk) => sk.toLowerCase().includes(q));
    // Gated on the flag rather than relying on describeSkills' own empty
    // return, so the memo genuinely depends on it — the dependency is a
    // re-run trigger for when the ontology chunk lands, not decoration.
    const described = ontologyReady
      ? describeSkills(searchQuery).filter((sk) => !direct.includes(sk))
      : [];
    const skillRes: SResult[] = [...direct, ...described]
      .slice(0, 7)
      .map((sk) => ({ kind: "skill", id: sk, label: sk, sub: "Skill" }));
    return [...skillRes, ...companies, ...cities];
  }, [searchQuery, seesAllMarkets, ontologyReady]);

  const goSearchResult = (r: SResult) => {
    if (r.kind === "skill") {
      toggleSkillQuery(r.id);
      return; // keep the flyout for further picks; the map recolours behind it
    }
    if (r.kind === "company") {
      // Head office from the globe; the nearest office in the region otherwise
      // — same rule as the main search bar (see searchCityFor).
      zoomInCity(searchCityFor(r.id, globalOut ? {} : { region: domesticRegion, near: localCity }));
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
        {/* Feedback / Help / Settings sit at the header's right edge, per the
            action-banner design. In the control row rather than free-floating
            so they cannot overlap the account control beside them. */}
        <HelpDock />
        {/* On desktop the account control lives INSIDE the centred search pill
            (SearchAuth), on every layer — so this one is hidden there by CSS.
            It stays mounted because the phone layout hides the centred pill
            entirely, and this is what hosts the auth panel the mobile "More"
            sheet opens. Exactly one visible sign-in entry point at any width. */}
        <AccountButton />
        {/* The search group is always in the DOM so the mobile bottom bar can
            open its flyout. On desktop the centred GlobalSearch is the search
            on every layer, so the top-right button is always hidden there via
            the `gshidden` class (CSS, desktop only). */}
        <div className="cgroup searchwrap gshidden">
          <span className="seglbl">Search</span>
          <button
            className={`searchbtn ${searchOpen ? "on" : ""} ${searchActive ? "active" : ""}`}
            onClick={toggleSearch}
            /* The tour anchors the BUTTON, not the group around it: `.gshidden`
               hides this button on desktop but leaves the wrapper laid out, so
               a wrapper anchor measured non-zero and won the "first visible"
               race while rendering nothing the user can see. */
            data-tour="search"
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
      </div>
    </div>
  );
}
