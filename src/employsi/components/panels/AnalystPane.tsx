import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../state/store";
import { COMPANIES, SECTOR_SHORT } from "../../data/companies";
import { CITY_LABEL, GLOBAL_HUB_LABEL, CITY_CONTINENT } from "../../data/geo";
import { CITY_COUNTRY, COUNTRIES, COUNTRY_MEMBERS, REGION_HUBS } from "../../data/mapboxWorldGeo";
import { cityForCompany } from "../../data/mapboxGeo";
import { answerQuestion } from "../../lib/analystAnswer";
import type { AnalystAnswer, AnalystScope } from "../../lib/analystFn";
import { SUGGESTED_PROMPTS } from "../../lib/analystIntent";
import { ALL_SECTORS, companyIdsForSector, sectorsInScope } from "../../lib/analystSector";
import { IconClose } from "../ActionIcons";
import { AnalystChartView } from "./AnalystChart";

/**
 * "Ask an analyst", built from `ask an analyst.dc.html`.
 *
 * The design's promise is in its own subtitle — "answers grounded in live
 * employsi vacancy data" — so this is not a chatbot with a model behind it. A
 * question is classified into an intent, the intent is run as a real query over
 * either the D1 ad archive or the national vacancy series, and the answer comes
 * back with the figures and the agency they came from. Ask it the same question
 * twice and you get the same numbers, because they are measurements.
 *
 * Departures from the mock, all for the same reason — it had no data behind it:
 *
 *  • Its scope chips are hardcoded (Wesfarmers / Australia / Asia Pacific /
 *    Perth). Here they are derived from where the user actually is: the open
 *    company, the current city, that city's country and region, plus Worldwide.
 *    Picking a scope re-runs the query against those rows.
 *  • Its four canned answers include applicants-per-role and fill rates. That is
 *    application-funnel data employsi has never collected, so that intent
 *    answers with the contest signals the archive does hold and says plainly
 *    what it cannot tell you.
 *  • Its 750ms "thinking" delay is a prop; here the pause is however long the
 *    query actually takes.
 */

interface Msg {
  id: number;
  role: "user" | "analyst";
  text: string;
  answer?: AnalystAnswer;
}

const OPENER =
  "Ask me about job openings — how many are live, which way demand is moving, what the ads disclose about pay, or which skills employers are asking for. Every answer is a query over employsi's vacancy data, and I'll show you the source.";

// Scope icons, from the design's SCOPES table.
const SCOPE_PATHS: Record<string, string[]> = {
  company: [
    "M9 7V5.5A2.5 2.5 0 0 1 11.5 3h1A2.5 2.5 0 0 1 15 5.5V7",
    "M5.5 7h13A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-8A2.5 2.5 0 0 1 5.5 7",
    "M3 12.5h18",
  ],
  city: [
    "M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z",
    "M12 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8",
  ],
  country: ["M3 9.5 12 4l9 5.5", "M6.5 11v6", "M12 11v6", "M17.5 11v6", "M4 20h16"],
  region: [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
    "M3 12h18",
    "M12 3c3.2 3.6 3.2 14.4 0 18",
    "M12 3c-3.2 3.6-3.2 14.4 0 18",
  ],
  world: [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
    "M3 12h18",
    "M12 3c3.2 3.6 3.2 14.4 0 18",
    "M12 3c-3.2 3.6-3.2 14.4 0 18",
  ],
};

interface ScopeOption extends AnalystScope {
  /** Archive hub keys this scope covers. */
  hubs: string[];
  /** ISO country, when the scope sits in exactly one — fixes salary currency. */
  country?: string;
}

function AnalystIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" aria-hidden>
      <circle cx="12" cy="5.6" r="2.9" />
      <path d="M9.5 9 12 12.2 14.5 9" />
      <path d="M9.5 9 6.4 10.3A4.4 4.4 0 0 0 3.8 14.4V20h6.1" />
      <path d="M14.5 9l3.1 1.3a4.4 4.4 0 0 1 2.6 4.1V20h-6.1" />
      <path d="M10.6 12.9h2.8l-.7 3.1.9 3.9h-3.2l.9-3.9Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AnalystPane() {
  const open = useAppStore((s) => s.analystOpen);
  const closeAnalyst = useAppStore((s) => s.closeAnalyst);
  const selectedId = useAppStore((s) => s.selectedId);
  const localCity = useAppStore((s) => s.localCity);
  const domesticRegion = useAppStore((s) => s.domesticRegion);

  // Scopes follow the user rather than being a fixed list: whatever company is
  // open, the city they're in, its country, its region, and everything.
  const scopes = useMemo<ScopeOption[]>(() => {
    const out: ScopeOption[] = [];
    const company = selectedId ? COMPANIES.find((c) => c.id === selectedId) : undefined;
    if (company) {
      out.push({
        kind: "company",
        id: company.id,
        label: company.name,
        hubs: [cityForCompany(company.id, localCity)],
        country: CITY_COUNTRY[cityForCompany(company.id, localCity)],
      });
    }
    const city = localCity;
    if (city) {
      out.push({
        kind: "city",
        id: city,
        label: GLOBAL_HUB_LABEL[city] || CITY_LABEL[city] || city,
        hubs: [city],
        country: CITY_COUNTRY[city],
      });
      const cc = CITY_COUNTRY[city];
      if (cc && COUNTRIES[cc]) {
        out.push({
          kind: "country",
          id: cc,
          label: COUNTRIES[cc].label,
          // The country's own label appears as a hub on some rows, so include it.
          hubs: [...(COUNTRY_MEMBERS[cc] ?? [city]), COUNTRIES[cc].label],
          country: cc,
        });
      }
    }
    const region = domesticRegion || CITY_CONTINENT[city];
    if (region && REGION_HUBS[region]) {
      out.push({
        kind: "region",
        id: region,
        label: region.charAt(0).toUpperCase() + region.slice(1),
        hubs: REGION_HUBS[region],
      });
    }
    out.push({ kind: "world", id: "", label: "Worldwide", hubs: [] });
    // De-duplicate by label, keeping the most specific (earliest) entry.
    const seen = new Set<string>();
    return out.filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true)));
  }, [selectedId, localCity, domesticRegion]);

  const [scopeIdx, setScopeIdx] = useState(0);
  const scope = scopes[Math.min(scopeIdx, scopes.length - 1)];

  // Sector narrowing, within whatever scope is selected. Only sectors that
  // actually have employers in this scope are offered — a chip that can only
  // ever answer "nothing here" is worse than no chip. A company scope is
  // already one employer, so the row is hidden there entirely.
  const [sector, setSector] = useState<string>(ALL_SECTORS);
  const sectorOptions = useMemo(
    () => (scope.kind === "company" ? [] : sectorsInScope(scope.hubs)),
    [scope],
  );
  // Keep the selection valid when the scope changes under it.
  const activeSector = sectorOptions.includes(sector) ? sector : ALL_SECTORS;
  const sectorIds = useMemo(
    () =>
      activeSector === ALL_SECTORS ? undefined : companyIdsForSector(activeSector, scope.hubs),
    [activeSector, scope],
  );

  const [thread, setThread] = useState<Msg[]>([{ id: 0, role: "analyst", text: OPENER }]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const nextId = useRef(1);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest exchange in view as the thread grows.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, thinking]);

  const ask = async (raw: string) => {
    const question = raw.trim();
    if (!question || thinking) return;
    setThread((t) => [...t, { id: nextId.current++, role: "user", text: question }]);
    setDraft("");
    setThinking(true);
    try {
      const answer = await answerQuestion(
        question,
        scope,
        scope.hubs,
        scope.country,
        activeSector === ALL_SECTORS ? undefined : activeSector,
        sectorIds,
      );
      setThread((t) => [
        ...t,
        { id: nextId.current++, role: "analyst", text: answer.text, answer },
      ]);
    } catch {
      setThread((t) => [
        ...t,
        {
          id: nextId.current++,
          role: "analyst",
          text: "That query didn't come back. Nothing here is cached or guessed, so I'd rather tell you it failed than show you a number I can't stand behind — try again in a moment.",
        },
      ]);
    } finally {
      setThinking(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="panescrim" onClick={closeAnalyst} />
      <div className="analystpane">
        <div className="anhd">
          <span className="anavatar">
            <AnalystIcon />
          </span>
          <div className="anhdtext">
            <span className="antitle">Ask an analyst</span>
            <span className="ansub">Answers grounded in live employsi vacancy data</span>
          </div>
          <button className="anx" onClick={closeAnalyst} aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="anscopes">
          <span className="anscopelbl">Scope</span>
          {scopes.map((s, i) => (
            <button
              key={s.kind + s.id}
              type="button"
              className={`anscope${i === scopeIdx ? " on" : ""}`}
              aria-pressed={i === scopeIdx}
              onClick={() => setScopeIdx(i)}
            >
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor">
                {(SCOPE_PATHS[s.kind] ?? []).map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
              {s.label}
            </button>
          ))}
        </div>

        {sectorOptions.length > 0 && (
          <div className="anscopes ansectors">
            <span className="anscopelbl">Sector</span>
            {[ALL_SECTORS, ...sectorOptions].map((s) => (
              <button
                key={s}
                type="button"
                className={`anscope${s === activeSector ? " on" : ""}`}
                aria-pressed={s === activeSector}
                onClick={() => setSector(s)}
              >
                {SECTOR_SHORT[s] || s}
              </button>
            ))}
          </div>
        )}

        <div className="anbody" ref={bodyRef}>
          {thread.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="anrow anrow-user">
                <div className="anuser">{m.text}</div>
              </div>
            ) : (
              <div key={m.id} className="anrow">
                <div className="ananswer">
                  <span className="antail" />
                  <span className="antext">{m.text}</span>

                  {/* The chart sits directly under the sentence that states the
                      finding and above the figures, which is the design's own
                      order: read the claim, see the shape, then the numbers. */}
                  {m.answer?.chart && (
                    <AnalystChartView
                      chart={m.answer.chart}
                      title={m.text}
                      source={m.answer.source}
                    />
                  )}

                  {!!m.answer?.stats?.length && (
                    <div className="anstats">
                      {m.answer.stats.map((st) => (
                        <div key={st.k} className="anstat">
                          <span className="anstatv">
                            {st.v}
                            {st.d && (
                              <span className={`anstatd${st.down ? " down" : ""}`}>{st.d}</span>
                            )}
                          </span>
                          <span className="anstatk">{st.k}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!!m.answer?.bars?.length && (
                    <div className="anbars">
                      {m.answer.bars.map((b) => (
                        <div key={b.name} className="anbar">
                          <span className="anbarname">{b.name}</span>
                          <span className="anbartrack">
                            <span className="anbarfill" style={{ width: `${b.pct}%` }} />
                          </span>
                          <span className={`anbarv${b.down ? " down" : ""}`}>{b.v}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {m.answer?.source && (
                    <div className="ansource">
                      <svg
                        viewBox="0 0 24 24"
                        width={13}
                        height={13}
                        fill="none"
                        stroke="currentColor"
                        aria-hidden
                      >
                        <path d="M6 4h9l4 4v12H6z" />
                        <path d="M15 4v4h4" />
                      </svg>
                      <span>{m.answer.source}</span>
                    </div>
                  )}
                </div>
              </div>
            ),
          )}

          {thinking && (
            <div className="anrow">
              <div className="anthinking">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>

        <div className="anprompts">
          {SUGGESTED_PROMPTS.map((p) => (
            <button key={p} type="button" className="anprompt" onClick={() => ask(p)}>
              {p}
            </button>
          ))}
        </div>

        <div className="ancompose">
          <input
            className="aninput"
            placeholder="Ask about vacancies, salaries or hiring velocity"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                ask(draft);
              }
            }}
            aria-label="Ask the analyst a question"
          />
          <button
            type="button"
            className="ansend"
            onClick={() => ask(draft)}
            disabled={!draft.trim() || thinking}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor">
              <g className="ai-send">
                <line x1="5" y1="19" x2="19" y2="5" />
                <polyline points="10 5 19 5 19 14" />
              </g>
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
