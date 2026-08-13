import { useMemo } from "react";
import { useAppStore } from "../state/store";
import { useGlobalSearch } from "../hooks/useGlobalSearch";
import { popularSkills as popularSkillsForLayer } from "../lib/skillHeat";

// The persistent mobile search field, under the wordmark.
//
// On desktop, search is the centred GlobalSearch pill. On phones it used to be
// a bottom-tab sheet, which cost a tap before you could type and spent one of
// only four tab slots on a text box. The design promotes it to a permanent
// field and gives the slot to Analyst instead.
//
// The RESULTS are rendered here rather than by reusing TopBar's
// `.searchflyout`: that flyout is anchored inside `.controls`, so dropping it
// under this field would mean pinning it with a hard-coded viewport offset
// that the header's own height has to keep agreeing with. What actually
// matters — which skills, companies and cities match, the market gate over
// them, and what selecting one does — is shared through useGlobalSearch, so
// this is a second presentation of one search, not a second search.
//
// The design only draws the collapsed field, so the expanded state is ours.
// It keeps the popular-skill chips the phone already had: they are how you
// find anything without knowing its name, and the design removing the search
// TAB is not the same as asking for that to go.

export function MobileSearch() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const clearSearch = useAppStore((s) => s.clearSearch);
  const searchOpen = useAppStore((s) => s.searchOpen);
  const toggleSearch = useAppStore((s) => s.toggleSearch);
  const toggleSkillQuery = useAppStore((s) => s.toggleSkillQuery);

  const skillIndex = useAppStore((s) => s.skillIndex);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const localCity = useAppStore((s) => s.localCity);
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

  const { results, go } = useGlobalSearch();

  const open = () => {
    if (!searchOpen) toggleSearch();
  };
  const close = () => {
    if (searchOpen) toggleSearch();
  };

  const typed = searchQuery.trim();

  return (
    <>
      {searchOpen && <div className="msscrim" onClick={close} />}
      <div className={`msearch ${searchOpen ? "on" : ""}`}>
        <svg
          viewBox="0 0 24 24"
          width="17"
          height="17"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.6" y2="16.6" />
        </svg>
        <input
          className="msearchin"
          type="text"
          placeholder="Search a skill, or describe it"
          value={searchQuery}
          aria-label="Search a skill, or describe it"
          onChange={(e) => {
            setSearchQuery(e.target.value);
            open();
          }}
          onFocus={open}
        />
        <button
          type="button"
          className="msearchgo"
          onClick={searchOpen ? close : open}
          aria-label={searchOpen ? "Hide search results" : "Show search results"}
          aria-expanded={searchOpen}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {searchOpen ? (
              <path d="m6 6 12 12M18 6 6 18" />
            ) : (
              <path d="M5 12h13m-5.5-5.5 6 5.5-6 5.5" />
            )}
          </svg>
        </button>

        {searchOpen && (
          <div className="msresults">
            {typed &&
              (results.length > 0 ? (
                results.map((r) => (
                  <button
                    key={`${r.kind}-${r.id}`}
                    className="msresult"
                    onClick={() => {
                      if (go(r)) close();
                    }}
                  >
                    <span className={`sfresultkind ${r.kind}`}>
                      {r.kind === "company" ? "Co." : r.kind === "city" ? "City" : "Skill"}
                    </span>
                    <span className="msresultname">{r.label}</span>
                    {r.sub && <span className="msresultsub">{r.sub}</span>}
                  </button>
                ))
              ) : (
                <div className="msempty">No skills, companies or cities match “{typed}”</div>
              ))}
            <div className="mslabel">Popular skills</div>
            <div className="mschips">
              {skills.map((sk) => (
                <button
                  key={sk}
                  className={`mschip ${typed.toLowerCase() === sk.toLowerCase() ? "on" : ""}`}
                  onClick={() => toggleSkillQuery(sk)}
                >
                  {sk}
                </button>
              ))}
            </div>
            {typed && (
              <button className="msclear" onClick={clearSearch}>
                Clear search
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
