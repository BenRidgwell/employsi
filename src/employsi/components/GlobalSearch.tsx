import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "../state/store";
import { GLOBAL_HUB_LABEL } from "../data/geo";
import { ALL_SKILLS } from "../data/skillsTaxonomy";
import {
  popularSkills as popularSkillsForLayer,
  demandLevel,
  type DemandTone,
} from "../lib/skillHeat";
import { describeSkills } from "../lib/describeSkills";
import {
  buildSkillCard,
  eventFor,
  eventIndex,
  eventPosition,
  monthLabel,
  SKILL_ICONS,
  TIMELINE_LABEL,
  TIMELINE_SPAN,
} from "../lib/skillCard";
import { LABOUR_EVENTS } from "../data/labourEvents";
import { getSkillPay, formatPay } from "../lib/analystFn";
import { COMPANIES } from "../data/companies";
import { cityForCompany } from "../data/mapboxGeo";
import { SearchAuth } from "./SearchAuth";
import { IconClose } from "./ActionIcons";

/**
 * The centred skill search, built from `Employsi Skill Search.html`.
 *
 * The design puts five things in one pill — search icon, input, clear, a Search
 * submit, and the account control — then hangs three states off it: live
 * suggestions with a follow control, a result card for the chosen skill, and
 * popular chips when the field is empty.
 *
 * The account control moving INTO the pill is the design's call, and it is
 * followed: TopBar now renders its account button only on the local layer,
 * where this pill isn't shown, so there is exactly one sign-in entry point at
 * any time rather than two.
 *
 * The result card is the part with real data behind it — see skillCard.ts for
 * what each figure is and which of the design's cells had no honest source.
 */

// How many popular-skill chips to show, and how deep to rank before drawing
// them. A pool much wider than the handful shown is what makes the selection
// vary without ever offering a skill nobody is hiring for.
const CHIP_COUNT = 6;
const CHIP_POOL = 24;

type Result =
  | { kind: "company"; id: string; label: string; sub: string }
  | { kind: "city"; id: string; label: string }
  | { kind: "skill"; id: string; label: string; sub: string; tone: DemandTone };

function FollowGlyph({ on: _on }: { on: boolean }) {
  // Both glyphs are stacked and cross-faded by CSS off the button's own `.on`
  // class, per the design, so the control doesn't resize as it flips.
  return (
    <span className="gsfollowicon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="gsfplus" aria-hidden>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="gsfcheck" aria-hidden>
        <polyline points="5 12.8 10 17.5 19 6.8" />
      </svg>
    </span>
  );
}

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
  const select = useAppStore((s) => s.select);
  const followedSkills = useAppStore((s) => s.followedSkills);
  const requestFollowSkill = useAppStore((s) => s.requestFollowSkill);
  // The card's timeline scrubs the SAME month index the heat map colours by, so
  // moving it recolours the map underneath rather than the two disagreeing.
  const heatMonth = useAppStore((s) => s.heatMonth);
  const setHeatMonth = useAppStore((s) => s.setHeatMonth);

  // The design shows a small handful of skills under the bar, not a ranked
  // list. So a wide pool is ranked by real demand as before, and CHIP_COUNT of
  // them are drawn at random — the suggestions stay genuinely in-demand, but
  // two visits don't offer the same six. Re-drawn only when the pool itself
  // changes (a new layer or a freshly loaded index), never mid-look.
  const popularSkills = useMemo(() => {
    const pool = popularSkillsForLayer(
      skillIndex,
      { zoomedOut, globalOut, domesticRegion, localCity },
      CHIP_POOL,
    );
    const draw = [...pool];
    for (let i = draw.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [draw[i], draw[j]] = [draw[j], draw[i]];
    }
    return draw.slice(0, CHIP_COUNT);
  }, [skillIndex, zoomedOut, globalOut, domesticRegion, localCity]);

  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // The skill whose card is showing. Set by submitting or picking a suggestion;
  // cleared by editing the query, exactly as the design's `picked`/`searched`.
  const [carded, setCarded] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const q = searchQuery.trim().toLowerCase();

  const results = useMemo<Result[]>(() => {
    if (!q) return [];
    const companies: Result[] = COMPANIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q),
    )
      .slice(0, 6)
      .map((c) => ({ kind: "company" as const, id: c.id, label: c.name, sub: c.ticker }));
    const cities: Result[] = Object.entries(GLOBAL_HUB_LABEL)
      .filter(([, label]) => label.toLowerCase().includes(q))
      .slice(0, 6)
      .map(([id, label]) => ({ kind: "city" as const, id, label }));
    // Direct name matches first, then skills inferred from the description via
    // the O*NET ontology ("workforce planning" → Human Resources), deduped.
    const direct = ALL_SKILLS.filter((sk) => sk.toLowerCase().includes(q));
    const described = describeSkills(searchQuery).filter((sk) => !direct.includes(sk));
    const skills: Result[] = [...direct, ...described].slice(0, 7).map((sk) => {
      const badge = demandLevel(sk, globalOut, skillIndex);
      return { kind: "skill" as const, id: sk, label: sk, sub: badge.label, tone: badge.tone };
    });
    return [...skills, ...companies, ...cities];
  }, [q, searchQuery, skillIndex, globalOut]);

  const topSkill = results.find((r) => r.kind === "skill") as
    Extract<Result, { kind: "skill" }> | undefined;
  const cardSkill = carded ?? (searched ? (topSkill?.id ?? null) : null);

  const card = useMemo(
    () => (cardSkill ? buildSkillCard(cardSkill, heatMonth) : null),
    [cardSkill, heatMonth],
  );
  const event = useMemo(() => eventFor(heatMonth), [heatMonth]);
  const monthPct = (heatMonth / TIMELINE_SPAN) * 100;
  // The line, its fill and the percentage in the summary all take the trend's
  // colour, so they read as one statement.
  const trendClass =
    card?.change == null || Math.abs(card.change) < 0.35 ? "flat" : card.change > 0 ? "up" : "down";
  // Unique so two cards can never share a gradient definition.
  const sparkGradId = `gsspark-${(cardSkill ?? "none").replace(/[^a-z0-9]/gi, "")}`;

  // Advertised pay for the carded skill, from the live archive. Its own query so
  // the card renders immediately and the salary cell fills in when it lands.
  const { data: pay } = useQuery({
    queryKey: ["skillPay", cardSkill],
    queryFn: () => getSkillPay({ data: { skill: cardSkill as string } }),
    enabled: !!cardSkill,
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  // Editing the query invalidates any card that was showing — but picking a
  // skill ALSO changes the query, because toggleSkillQuery writes the skill's
  // name into it. Without the first check that made the card close the instant
  // it opened, from the suggestions and from Search alike; the card only clears
  // when the query stops matching the skill it belongs to.
  useEffect(() => {
    if (carded && searchQuery.trim().toLowerCase() === carded.toLowerCase()) return;
    setCarded(null);
    setSearched(false);
  }, [searchQuery, carded]);

  if (!zoomedOut) return null;

  const goToResult = (r: Result) => {
    if (r.kind === "skill") {
      // Colour the map by real demand AND open the card for it.
      toggleSkillQuery(r.id);
      setCarded(r.id);
      setSearched(true);
      setActiveIndex(0);
      inputRef.current?.blur();
      return;
    }
    if (r.kind === "company") {
      zoomInCity(cityForCompany(r.id));
      select(r.id);
    } else {
      zoomInCity(r.id);
    }
    setSearchQuery("");
    setActiveIndex(0);
    inputRef.current?.blur();
  };

  const submit = () => {
    // Nothing typed yet: the design keeps this button ink rather than greying
    // it out, so give it something to do — put the cursor in the field, which
    // also opens the popular-skill chips.
    if (!q) {
      inputRef.current?.focus();
      return;
    }
    if (topSkill) {
      toggleSkillQuery(topSkill.id);
      setCarded(topSkill.id);
    }
    setSearched(true);
    setFocused(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setSearchQuery("");
      inputRef.current?.blur();
      return;
    }
    if (!results.length) {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      goToResult(results[Math.min(activeIndex, results.length - 1)]);
    }
  };

  const showSuggest = focused && !!q && !cardSkill;
  // Chips show on an empty focused field, and stay up while a skill is
  // selected so the chosen one can carry its selected state and the rest stay
  // one click away.
  const skillActive = !!cardSkill && q === cardSkill.toLowerCase();
  const showChips = (focused && !q && !cardSkill) || skillActive;
  const noMatch = searched && !cardSkill && !!q;

  return (
    <div className="gsearch">
      <div className="gsearchhd">Explore the world of work today</div>

      <div className={`gsearchbar ${focused ? "on" : ""}`}>
        {/* The magnifier tightens and its handle shifts on focus, per the design. */}
        <svg
          className="gsicon"
          viewBox="0 0 24 24"
          width={19}
          height={19}
          fill="none"
          stroke="currentColor"
          aria-hidden
        >
          <circle className="gsiconlens" cx="11" cy="11" r="6.4" />
          <line className="gsiconhandle" x1="15.8" y1="15.8" x2="20" y2="20" />
        </svg>
        <input
          ref={inputRef}
          className="gsearchinput"
          placeholder="Search a skill by name, or describe it in your own words"
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
          <button
            className="gsearchclear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
          >
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        )}
        <button className="gsearchgo" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Search
        </button>
        <SearchAuth />
      </div>

      {showSuggest && (
        <div className="gsearchresults">
          {results.length > 0 ? (
            results.map((r, i) => {
              if (r.kind === "skill") {
                const followed = followedSkills.includes(r.id);
                return (
                  <div
                    key={`skill-${r.id}`}
                    className={`gsresult gsresult-skill ${i === activeIndex ? "on" : ""}`}
                    onMouseEnter={() => setActiveIndex(i)}
                  >
                    <button
                      className="gsrmain"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => goToResult(r)}
                    >
                      <span className="gsrlabel">{r.label}</span>
                      <span className={`gsrlevel dmd-${r.tone}`}>
                        {r.sub.replace(" demand", "")}
                      </span>
                    </button>
                    <button
                      className={`gsrfollow ${followed ? "on" : ""}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestFollowSkill(r.id);
                      }}
                    >
                      <FollowGlyph on={followed} />
                      {followed ? "Following" : "Follow"}
                    </button>
                  </div>
                );
              }
              return (
                <button
                  key={`${r.kind}-${r.id}`}
                  className={`gsresult ${i === activeIndex ? "on" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => goToResult(r)}
                >
                  <span className={`gsrkind ${r.kind}`}>
                    {r.kind === "company" ? "Co." : "City"}
                  </span>
                  <span className="gsrlabel">{r.label}</span>
                  {r.kind === "company" && <span className="gsrsub">{r.sub}</span>}
                </button>
              );
            })
          ) : (
            <div className="gsrempty">
              No skills, companies or cities match “{searchQuery.trim()}”
            </div>
          )}
        </div>
      )}

      {card && (
        <div className="gscard">
          <div className="gscardhd">
            <span className="gscardname">
              <svg
                className="gscardicon"
                viewBox="0 0 24 24"
                width={22}
                height={22}
                fill="none"
                stroke="currentColor"
                aria-hidden
              >
                {(SKILL_ICONS[card.icon] ?? []).map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
              <span className="gscardtitle">{card.skill}</span>
            </span>
            <div className="gscardactions">
              <span className={`gscardlevel dmd-${card.tone}`}>
                <i />
                {card.levelLabel}
              </span>
              <button
                className={`gsrfollow gscardfollow ${followedSkills.includes(card.skill) ? "on" : ""}`}
                onClick={() => requestFollowSkill(card.skill)}
              >
                <FollowGlyph on={followedSkills.includes(card.skill)} />
                {followedSkills.includes(card.skill) ? "Following" : "Follow"}
              </button>
              {/* The design's card fills a page and never needs dismissing; in
                  the corner it sits over the map, so it does. */}
              <button
                className="gscardx"
                onClick={() => {
                  setCarded(null);
                  setSearched(false);
                  setSearchQuery("");
                }}
                aria-label="Close skill detail"
              >
                <IconClose />
              </button>
            </div>
          </div>

          {/* Demand scale. The marker sits at the skill's real percentile among
              all skills IN THE SCRUBBED MONTH, not today's ranking. */}
          <div className="gsscale">
            <div className="gsscaletrack">
              <span className="gszone lo" />
              <span className="gszone mid" />
              <span className="gszone hi" />
              <span
                className="gsmarker"
                style={{ left: `${Math.max(3, Math.min(97, card.percentile))}%` }}
              />
            </div>
            <div className="gsscalekeys">
              <span className="gskey lo">Low</span>
              <span className="gskey mid">Moderate</span>
              <span className="gskey hi">High</span>
            </div>
          </div>

          <div className="gsstats">
            <div className="gsstat">
              <span className="gsstatk">Open roles</span>
              <span className="gsstatv">
                {card.openRoles === null ? "—" : card.openRoles.toLocaleString("en-US")}
              </span>
            </div>
            <div className="gsstat">
              <span className="gsstatk">Median salary</span>
              {/* Advertised pay comes from the live ad archive, so it only has a
                  value at the present end of the timeline. */}
              <span className="gsstatv">{card.atPresent && pay ? formatPay(pay) : "—"}</span>
            </div>
          </div>

          <div className="gscardtrend">
            {card.spark && (
              <svg
                className={`gsspark ${trendClass}`}
                viewBox="0 0 240 64"
                width={240}
                height={64}
                fill="none"
                preserveAspectRatio="none"
                aria-hidden
              >
                <defs>
                  <linearGradient id={sparkGradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="currentColor" stopOpacity="0.2" />
                    <stop offset="0.55" stopColor="currentColor" stopOpacity="0.07" />
                    <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {card.sparkArea && <path d={card.sparkArea} fill={`url(#${sparkGradId})`} />}
                <path
                  d={card.spark}
                  stroke="currentColor"
                  strokeWidth={1.4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            )}
            <p className="gscardsummary">
              {card.summaryLead}
              {card.summaryPct && (
                <span className={`gscardpct ${trendClass}`}>{card.summaryPct}</span>
              )}
              {card.summaryTail}
            </p>
          </div>

          {/* Timeline. Scrubs the same month index the heat map colours by, so
              the card and the map are always showing the same month. */}
          <div className="gstimeline">
            <div className="gstimehd">
              <span className="gstimelbl">{TIMELINE_LABEL}</span>
              <span className="gstimemonth">{card.monthLabel}</span>
            </div>
            <div className="gstimetrackwrap">
              <div className="gstimetrack">
                <div className="gstimefill" style={{ width: `${monthPct}%` }} />
                {LABOUR_EVENTS.map((e) => {
                  const pos = eventPosition(e);
                  if (pos === null) return null;
                  return (
                    <span
                      key={e.title}
                      className={`gstimetick${eventIndex(e) <= heatMonth ? " past" : ""}`}
                      style={{ left: `${pos * 100}%` }}
                      title={`${monthLabel(card.month)}`}
                    />
                  );
                })}
                <span className="gstimeknob" style={{ left: `${monthPct}%` }} />
              </div>
              <input
                type="range"
                className="gstimerange"
                min={0}
                max={TIMELINE_SPAN}
                step={1}
                value={heatMonth}
                onChange={(e) => setHeatMonth(Number(e.target.value))}
                aria-label="Timeline month"
              />
            </div>
            {event && (
              <div className="gsevent">
                <span className="gseventdate">
                  {monthLabel(`${event.year}-${String(event.month + 1).padStart(2, "0")}`)}
                </span>
                <div className="gseventbody">
                  <span className="gseventtitle">{event.title}</span>
                  <span className="gseventnote">{event.note}</span>
                </div>
              </div>
            )}
          </div>

          {card.related.length > 0 && (
            <div className="gsrelated">
              <span className="gsrelatedlbl">Related</span>
              {card.related.map((r) => (
                <button
                  key={r}
                  className="gsrelchip"
                  onClick={() => {
                    toggleSkillQuery(r);
                    setCarded(r);
                    setSearched(true);
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {noMatch && !card && (
        <div className="gsnomatch">
          Nothing indexed for that yet. Try a nearby skill, or describe the work differently.
        </div>
      )}

      {showChips && (
        <div className="gsearchchips">
          {popularSkills.map((sk) => (
            <button
              key={sk}
              className={`gschip${sk.toLowerCase() === q ? " on" : ""}`}
              aria-pressed={sk.toLowerCase() === q}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                // No setSearchQuery here: toggleSkillQuery writes the name
                // itself, and pre-setting it made the toggle read the skill as
                // already active and switch it straight back off.
                toggleSkillQuery(sk);
                setCarded(sk);
                setSearched(true);
              }}
            >
              {sk}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
