import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { GLOBAL_HUB_LABEL } from '../data/geo';
import { ALL_SKILLS } from '../data/skillsTaxonomy';
import { popularSkills as popularSkillsForLayer, demandLevel, type DemandTone } from '../lib/skillHeat';
import { describeSkills } from '../lib/describeSkills';
import { COMPANIES } from '../data/companies';
import { cityForCompany } from '../data/mapboxGeo';

type Result =
  | { kind: 'company'; id: string; label: string; sub: string }
  | { kind: 'city'; id: string; label: string }
  | { kind: 'skill'; id: string; label: string; sub: string; tone: DemandTone };

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
  const skillIndex = useAppStore((s) => s.skillIndex);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const localCity = useAppStore((s) => s.localCity);
  const zoomInCity = useAppStore((s) => s.zoomInCity);

  // Popular skills, ranked by real live demand and scoped to the current layer
  // (global = worldwide, domestic = this region's cities). Shared helper so the
  // top-bar (local) search stays in sync.
  const popularSkills = useMemo(
    () => popularSkillsForLayer(skillIndex, { zoomedOut, globalOut, domesticRegion, localCity }),
    [skillIndex, zoomedOut, globalOut, domesticRegion, localCity],
  );
  const select = useAppStore((s) => s.select);
  const followedSkills = useAppStore((s) => s.followedSkills);
  const requestFollowSkill = useAppStore((s) => s.requestFollowSkill);
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
    // Direct name matches first, then skills inferred from the description via
    // the O*NET ontology ("workforce planning" → Human Resources), deduped.
    const direct = ALL_SKILLS.filter((sk) => sk.toLowerCase().includes(q));
    const described = describeSkills(searchQuery).filter((sk) => !direct.includes(sk));
    const skills: Result[] = [...direct, ...described].slice(0, 7).map((sk) => {
      // Demand level (Low / Moderate / High), contextual to the layer the
      // search was made on: domestic → AU IVI, global → live company index.
      const badge = demandLevel(sk, globalOut, skillIndex);
      return { kind: 'skill' as const, id: sk, label: sk, sub: badge.label, tone: badge.tone };
    });
    return [...skills, ...companies, ...cities];
  }, [q, searchQuery, skillIndex, globalOut]);

  // Show over the global AND domestic overviews (both are zoomedOut) — never
  // stranded above a local city map, where the top-right search takes over.
  if (!zoomedOut) return null;
  void globalOut;

  const goToResult = (r: Result) => {
    if (r.kind === 'skill') {
      // Colour the map by real demand for this skill instead of navigating.
      toggleSkillQuery(r.id);
      setActiveIndex(0);
      inputRef.current?.blur();
      return;
    }
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
          placeholder="Select or describe a skill"
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
            results.map((r, i) => {
              // Skill rows carry a follow control (like a company card's Follow
              // button) alongside the main select action, so they can't be a
              // single <button> — a nested button is invalid. Render a row with
              // an inner select button + a follow button.
              if (r.kind === 'skill') {
                const followed = followedSkills.includes(r.id);
                return (
                  <div key={`skill-${r.id}`} className={`gsresult gsresult-skill ${i === activeIndex ? 'on' : ''}`} onMouseEnter={() => setActiveIndex(i)}>
                    <button className="gsrmain" onMouseDown={(e) => e.preventDefault()} onClick={() => goToResult(r)}>
                      <span className="gsrkind skill">Skill</span>
                      <span className="gsrlabel">{r.label}</span>
                      <span className={`gsrsub dmd-${r.tone}`}>{r.sub}</span>
                    </button>
                    <button
                      className={`gsrfollow ${followed ? 'on' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestFollowSkill(r.id);
                      }}
                      aria-label={followed ? 'Following skill' : 'Follow skill'}
                      title={followed ? 'Following' : 'Follow this skill'}
                    >
                      {followed ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12.5l4.2 4.2L19 7" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              }
              return (
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
              );
            })
          ) : (
            <div className="gsrempty">No skills, companies or cities match “{searchQuery.trim()}”</div>
          )}
        </div>
      )}
      {focused && !q && (
        <div className="gsearchchips">
          <span className="gsearchlbl">Popular skills</span>
          {popularSkills.map((sk) => (
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
