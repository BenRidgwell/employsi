import { useMemo, type CSSProperties } from 'react';
import { BrandMark } from './BrandMark';
import { AccountButton } from './AccountButton';
import { useAppStore, isFilterActive, isSearchActive, type FilterState } from '../state/store';
import { COMPANIES } from '../data/companies';

const SECTORS = ['Energy & Natural Resources', 'Financial Services'];

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
  // The centred global search bar only replaces the top-right search on the
  // actual global overlay; local/domestic (and any stranded state) keep it.
  const showGlobalSearch = globalOut && zoomedOut;

  const filterState: FilterState = { searchQuery, activeSectors, minSalary, minHeadcount, minGrowth, maxAttrition };
  const filterActive = isFilterActive(filterState);
  const searchActive = isSearchActive(filterState);
  const skills = useMemo(() => topSkills(), []);

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
            {searchActive && <span className="sdot" />}
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
            {filterActive && <span className="sdot" />}
          </button>
          {filterOpen && <div className="sfscrim" onClick={toggleFilter} />}
          <div className={`searchflyout ${filterOpen ? 'open' : ''}`}>
            <div className="sflabel">Sector</div>
            <div className="sfchips">
              {SECTORS.map((cat) => (
                <button key={cat} className={`sfchip ${activeSectors.includes(cat) ? 'on' : ''}`} onClick={() => toggleSector(cat)}>
                  {cat}
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
            <input type="range" className="sfrange" style={fillStyle(maxAttrition, 8, 16)} min={8} max={16} step={0.5} value={maxAttrition} onChange={(e) => setMaxAttrition(Number(e.target.value))} />
            <button className="sfclear" onClick={clearFilters}>Clear filters</button>
          </div>
        </div>
        <div className="cgroup">
          <span className="seglbl">Heat map</span>
          <div className="seg style">
            <button className={`hbtn ${heat === 'salary' ? 'hon' : ''}`} onClick={() => setHeat('salary')}>Salary</button>
            <button className={`hbtn ${heat === 'growth' ? 'hon' : ''}`} onClick={() => setHeat('growth')}>Growth</button>
            <button className={`hbtn ${heat === 'turnover' ? 'hon' : ''}`} onClick={() => setHeat('turnover')}>Turnover</button>
          </div>
        </div>
      </div>
    </div>
  );
}
