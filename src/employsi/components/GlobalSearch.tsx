import { useState } from 'react';
import { useAppStore } from '../state/store';
import { SKILL_DEMAND } from '../data/geo';

const SKILLS = Object.keys(SKILL_DEMAND);

// Centered search bar shown on the global view (replaces the top-right search
// button there). Typing / picking a skill drives the demand heatmap.
export function GlobalSearch() {
  const globalOut = useAppStore((s) => s.globalOut);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const toggleSkillQuery = useAppStore((s) => s.toggleSkillQuery);
  const [focused, setFocused] = useState(false);

  // Only show over the global overlay — never stranded above a local city map.
  if (!globalOut || !zoomedOut) return null;
  const q = searchQuery.trim().toLowerCase();

  return (
    <div className="gsearch">
      <div className="gsearchhd">Explore what's popular with businesses today</div>
      <div className={`gsearchbar ${focused ? 'on' : ''}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.6" y2="16.6" />
        </svg>
        <input
          className="gsearchinput"
          placeholder="Search a skill, occupation or company"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 160)}
        />
        {searchQuery && (
          <button className="gsearchclear" onClick={() => setSearchQuery('')} aria-label="Clear">✕</button>
        )}
      </div>
      {focused && (
        <div className="gsearchchips">
          <span className="gsearchlbl">Popular skills</span>
          {SKILLS.map((sk) => (
            <button key={sk} className={`gschip ${q === sk.toLowerCase() ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => toggleSkillQuery(sk)}>
              {sk}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
