import { useMemo, type CSSProperties } from 'react';
import { BrandMark } from './BrandMark';
import { AccountButton } from './AccountButton';
import { useAppStore, isFilterActive, isSearchActive, type FilterState } from '../state/store';
import { COMPANIES, SECTOR_GROUPS, EXCHANGES } from '../data/companies';
import { CITY_COMPANIES } from '../data/mapboxGeo';

const SECTORS = SECTOR_GROUPS;
// Short chip labels so the sector selection reads as a compact mosaic rather
// than a stack of full-width rows.
const SECTOR_SHORT: Record<string, string> = {
  'Energy & Natural Resources': 'Natural Resources',
  'Financial Services': 'Financial',
  'Technology, Media and Telecommunications': 'Tech & Media',
  'Consumer and Retail': 'Consumer & Retail',
  'Industrial Manufacturing': 'Industrial',
  'Healthcare and Life Sciences': 'Healthcare',
  'Infrastructure and Government': 'Infra & Gov',
};

function topSkills(): string[] {
  const counts: Record<string, number> = {};
  COMPANIES.forEach((c) => c.skills.forEach((sk) => { counts[sk] = (counts[sk] || 0) + 1; }));
  return Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
    .slice(0, 8);
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.6" y2="16.6" />
    </svg>
  );
}

// Position of the thumb along [min,max] as a CSS custom property, so the
// slider's purple fill always stops exactly at the thumb.
function fillStyle(value: number, min: number, max: number): CSSProperties {
  const pct = ((value - min) / (max - min)) * 100;
  return { '--fill': `${pct}%` } as CSSProperties;
}

function FilterIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </svg>
  );
}

function HeatIcon() {
  // A four-cell heat grid at graded intensity — reads as a choropleth / heat map
  // far more directly than the old flame did.
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="3" y="3" width="7.6" height="7.6" rx="1.6" opacity="0.34" />
      <rect x="13.4" y="3" width="7.6" height="7.6" rx="1.6" opacity="0.95" />
      <rect x="3" y="13.4" width="7.6" height="7.6" rx="1.6" opacity="0.7" />
      <rect x="13.4" y="13.4" width="7.6" height="7.6" rx="1.6" opacity="0.48" />
    </svg>
  );
}

const HEAT_LABEL: Record<string, string> = { salary: 'Salary', growth: 'Growth', turnover: 'Turnover' };

export function TopBar() {
  const searchOpen = useAppStore((s) => s.searchOpen);
  const toggleSearch = useAppStore((s) => s.toggleSearch);
  const filterOpen = useAppStore((s) => s.filterOpen);
  const toggleFilter = useAppStore((s) => s.toggleFilter);
  const heatOpen = useAppStore((s) => s.heatOpen);
  const toggleHeatPanel = useAppStore((s) => s.toggleHeatPanel);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const clearSearch = useAppStore((s) => s.clearSearch);
  const activeSectors = useAppStore((s) => s.activeSectors);
  const toggleSector = useAppStore((s) => s.toggleSector);
  const activeExchanges = useAppStore((s) => s.activeExchanges);
  const toggleExchange = useAppStore((s) => s.toggleExchange);
  const toggleSkillQuery = useAppStore((s) => s.toggleSkillQuery);
  const minSalary = useAppStore((s) => s.minSalary);
  const minHeadcount = useAppStore((s) => s.minHeadcount);
  const minGrowth = useAppStore((s) => s.minGrowth);
  const maxAttrition = useAppStore((s) => s.maxAttrition);
  const setMinSalary = useAppStore((s) => s.setMinSalary);
  const setMinHeadcount = useAppStore((s) => s.setMinHeadcount);
  const setMinGrowth = useAppStore((s) => s.setMinGrowth);
  const setMaxAttrition = useAppStore((s) => s.setMaxAttrition);
  const clearFilters = useAppStore((s) => s.clearFilters);
  const heat = useAppStore((s) => s.heat);
  const setHeat = useAppStore((s) => s.setHeat);
  const globalOut = useAppStore((s) => s.globalOut);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  // The centred search header replaces the top-right search on BOTH the global
  // and domestic overviews (both are zoomedOut); only the local city view keeps
  // the top-right search button.
  const showGlobalSearch = zoomedOut;
  void globalOut;

  const filterState: FilterState = { searchQuery, activeSectors, activeExchanges, minSalary, minHeadcount, minGrowth, maxAttrition };
  const filterActive = isFilterActive(filterState);
  const searchActive = isSearchActive(filterState);
  const skills = useMemo(() => topSkills(), []);
  const activeSkill = skills.find((sk) => sk.toLowerCase() === searchQuery.trim().toLowerCase());

  // Local search: every company mapped on the current city's map is searchable
  // by name, ticker, skill or role. Selecting one opens its card and the map
  // pans to it (the [selectedId] effect in PerthMapbox frames the building).
  const localCity = useAppStore((s) => s.localCity);
  const select = useAppStore((s) => s.select);
  const localCompanyResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const ids = new Set((CITY_COMPANIES[localCity] || []).map((c) => c.id));
    return COMPANIES.filter(
      (c) =>
        ids.has(c.id) &&
        (c.name.toLowerCase().includes(q) ||
          c.ticker.toLowerCase().includes(q) ||
          c.skills.some((sk) => sk.toLowerCase().includes(q)) ||
          c.roles.some((r) => r.title.toLowerCase().includes(q))),
    ).slice(0, 8);
  }, [searchQuery, localCity]);

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
        {!showGlobalSearch && (
        <div className="cgroup searchwrap">
          <span className="seglbl">Search</span>
          <button className={`searchbtn ${searchOpen ? 'on' : ''} ${searchActive ? 'active' : ''}`} onClick={toggleSearch}>
            <SearchIcon />
            <span>Search</span>
            {searchActive && <span className="sdot green" />}
          </button>
          {searchOpen && <div className="sfscrim" onClick={toggleSearch} />}
          <div className={`searchflyout ${searchOpen ? 'open' : ''}`}>
            <input
              className="sfinput"
              placeholder="Search a job, skill, or company"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus={searchOpen}
            />
            {searchQuery.trim() && (
              <div className="sfresults">
                {localCompanyResults.length > 0 ? (
                  localCompanyResults.map((c) => (
                    <button key={c.id} className="sfresult" onClick={() => select(c.id)}>
                      <span className="sfresultname">{c.name}</span>
                      <span className="sfresultticker">{c.ticker}</span>
                    </button>
                  ))
                ) : (
                  <div className="sfresultempty">No companies here match “{searchQuery.trim()}”</div>
                )}
              </div>
            )}
            <div className="sflabel">Popular skills</div>
            <div className="sfchips">
              {skills.map((sk) => (
                <button
                  key={sk}
                  className={`sfchip ${searchQuery.trim().toLowerCase() === sk.toLowerCase() ? 'on' : ''}`}
                  onClick={() => toggleSkillQuery(sk)}
                >
                  {sk}
                </button>
              ))}
            </div>
            {searchActive && (
              <button className="sfclear" onClick={clearSearch}>Clear search</button>
            )}
          </div>
        </div>
        )}
        <div className="cgroup searchwrap">
          <span className="seglbl">Filter</span>
          <button className={`searchbtn ${filterOpen ? 'on' : ''} ${filterActive ? 'active' : ''}`} onClick={toggleFilter}>
            <FilterIcon />
            <span>Filter</span>
            {filterActive && <span className="sdot green" />}
          </button>
          {filterOpen && <div className="sfscrim" onClick={toggleFilter} />}
          <div className={`searchflyout ${filterOpen ? 'open' : ''}`}>
            <div className="sflabel">Sector</div>
            <div className="sfchips sfmosaic">
              {SECTORS.map((cat) => (
                <button key={cat} className={`sfchip sfchipsm ${activeSectors.includes(cat) ? 'on' : ''}`} onClick={() => toggleSector(cat)}>
                  {SECTOR_SHORT[cat] || cat}
                </button>
              ))}
            </div>
            <div className="sflabel">Stock exchange</div>
            <div className="sfchips sfmosaic">
              {EXCHANGES.map((ex) => (
                <button key={ex} className={`sfchip sfchipsm ${activeExchanges.includes(ex) ? 'on' : ''}`} onClick={() => toggleExchange(ex)}>
                  {ex}
                </button>
              ))}
            </div>
            <div className="sfrangerow">
              <span>Salary</span>
              <b>${minSalary}K+</b>
            </div>
            <input type="range" className="sfrange" style={fillStyle(minSalary, 130, 160)} min={130} max={160} step={1} value={minSalary} onChange={(e) => setMinSalary(Number(e.target.value))} />
            <div className="sfrangerow">
              <span>Headcount</span>
              <b>{minHeadcount > 0 ? minHeadcount.toLocaleString('en-US') + '+' : 'Any'}</b>
            </div>
            <input type="range" className="sfrange" style={fillStyle(minHeadcount, 0, 12000)} min={0} max={12000} step={250} value={minHeadcount} onChange={(e) => setMinHeadcount(Number(e.target.value))} />
            <div className="sfrangerow">
              <span>New starters</span>
              <b>{minGrowth > 0 ? '+' + minGrowth.toFixed(1) + '%+' : 'Any'}</b>
            </div>
            <input type="range" className="sfrange" style={fillStyle(minGrowth, 0, 15)} min={0} max={15} step={0.5} value={minGrowth} onChange={(e) => setMinGrowth(Number(e.target.value))} />
            <div className="sfrangerow">
              <span>Attrition</span>
              <b>{maxAttrition < 16 ? '≤' + maxAttrition.toFixed(1) + '%' : 'Any'}</b>
            </div>
            {/* Reversed so, like the other sliders, "Any" (no cap) sits at the
                far left and dragging right tightens the attrition cap. The
                stored value still runs 8..16; only the slider axis is flipped
                via value = 24 - maxAttrition. */}
            <input type="range" className="sfrange" style={fillStyle(24 - maxAttrition, 8, 16)} min={8} max={16} step={0.5} value={24 - maxAttrition} onChange={(e) => setMaxAttrition(24 - Number(e.target.value))} />
            <button className="sfclear" onClick={clearFilters}>Clear filters</button>
          </div>
        </div>
        <div className="cgroup searchwrap">
          <span className="seglbl">Heat map</span>
          <button className={`searchbtn ${heatOpen ? 'on' : ''} ${activeSkill ? 'active' : ''}`} onClick={toggleHeatPanel}>
            <HeatIcon />
            <span>{HEAT_LABEL[heat]}</span>
            {activeSkill && <span className="sdot green" />}
          </button>
          {heatOpen && <div className="sfscrim" onClick={toggleHeatPanel} />}
          <div className={`searchflyout ${heatOpen ? 'open' : ''}`}>
            <div className="sflabel">Colour the map by</div>
            {/* Metric and skill are mutually exclusive: picking a metric clears
                any active skill, and a metric reads as unselected while a skill
                is chosen (the map is showing skill demand, not the metric). */}
            <div className="seg style hmseg">
              <button className={`hbtn ${heat === 'salary' && !activeSkill ? 'hon' : ''}`} onClick={() => { setHeat('salary'); clearSearch(); }}>Salary</button>
              <button className={`hbtn ${heat === 'growth' && !activeSkill ? 'hon' : ''}`} onClick={() => { setHeat('growth'); clearSearch(); }}>Growth</button>
              <button className={`hbtn ${heat === 'turnover' && !activeSkill ? 'hon' : ''}`} onClick={() => { setHeat('turnover'); clearSearch(); }}>Turnover</button>
            </div>
            <div className="sflabel">Skill demand</div>
            <div className="sfchips">
              {skills.map((sk) => (
                <button
                  key={sk}
                  className={`sfchip ${searchQuery.trim().toLowerCase() === sk.toLowerCase() ? 'on' : ''}`}
                  onClick={() => toggleSkillQuery(sk)}
                >
                  {sk}
                </button>
              ))}
            </div>
            {activeSkill && (
              <button className="sfclear" onClick={clearSearch}>Clear skill</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
