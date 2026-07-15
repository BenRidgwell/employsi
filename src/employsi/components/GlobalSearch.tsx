import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { SKILL_DEMAND, GLOBAL_HUB_LABEL } from '../data/geo';
import { COMPANIES } from '../data/companies';
import { cityForCompany } from '../data/mapboxGeo';

const SKILLS = Object.keys(SKILL_DEMAND);

type Result =
  | { kind: 'company'; id: string; label: string; sub: string }
  | { kind: 'city'; id: string; label: string };

// Centered search bar shown on the global view (replaces the top-right search
// button there). Typing a company or city and selecting it (click, or Enter
// for the top match) navigates to the local layer — opening the company's
// card, or simply arriving at the chosen city. With an empty query it falls
// back to the popular-skills chips, which drive the demand heatmap as before.
export function GlobalSearch() {
  const globalOut = useAppStore((s) => s.globalOut);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const toggleSkillQuery = useAppStore((s) => s.toggleSkillQuery);
  const zoomInCity = useAppStore((s) => s.zoomInCity);
  const select = useAppStore((s) => s.select);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const q = searchQuery.trim().toLowerCase();

  const results = useMemo<Result[]>(() => {
    if (!q) return [];
    const companies: Result[] = COMPANIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q),
    )
      .slice(0, 6)
      .map((c) => ({ kind: 'company' as const, id: c.id, label: c.name, sub: c.ticker }));
    const cities: Result[] = Object.entries(GLOBAL_HUB_LABEL)
      .filter(([, label]) => label.toLowerCase().includes(q))
      .slice(0, 6)
      .map(([id, label]) => ({ kind: 'city' as const, id, label }));
    return [...companies, ...cities];
  }, [q]);

  // Show over the global AND domestic overviews (both are zoomedOut) — never
  // stranded above a local city map, where the top-right search takes over.
  if (!zoomedOut) return null;
  void globalOut;

  const goToResult = (r: Result) => {
    if (r.kind === 'company') {
      zoomInCity(cityForCompany(r.id));
      select(r.id);
    } else {
      zoomInCity(r.id);
    }
    setSearchQuery('');
    setActiveIndex(0);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      goToResult(results[Math.min(activeIndex, results.length - 1)]);
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      inputRef.current?.blur();
    }
  };

  return (
    <div className="gsearch">
      <div className="gsearchhd">Explore the world of work today</div>
      <div className={`gsearchbar ${focused ? 'on' : ''}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.6" y2="16.6" />
        </svg>
        <input
          ref={inputRef}
          className="gsearchinput"
          placeholder="Search a company, skill or city"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setActiveIndex(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 160)}
          onKeyDown={onKeyDown}
        />
        {searchQuery && (
          <button className="gsearchclear" onClick={() => setSearchQuery('')} aria-label="Clear">✕</button>
        )}
      </div>
      {focused && q && (
        <div className="gsearchresults">
          {results.length > 0 ? (
            results.map((r, i) => (
              <button
                key={`${r.kind}-${r.id}`}
                className={`gsresult ${i === activeIndex ? 'on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => goToResult(r)}
              >
                <span className={`gsrkind ${r.kind}`}>{r.kind === 'company' ? 'Co.' : 'City'}</span>
                <span className="gsrlabel">{r.label}</span>
                {r.kind === 'company' && <span className="gsrsub">{r.sub}</span>}
              </button>
            ))
          ) : (
            <div className="gsrempty">No companies or cities match “{searchQuery.trim()}”</div>
          )}
        </div>
      )}
      {focused && !q && (
        <div className="gsearchchips">
          <span className="gsearchlbl">Popular skills</span>
          {SKILLS.map((sk) => (
            <button
              key={sk}
              className={`gschip ${q === sk.toLowerCase() ? 'on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggleSkillQuery(sk)}
            >
              {sk}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
