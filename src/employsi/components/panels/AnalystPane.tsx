import { useEffect, useMemo, useRef, useState } from "react";
import { MobileSheetHandle } from "../MobileSheetHandle";
import { useMobileSheet } from "../../hooks/useMobileSheet";
import { useAppStore } from "../../state/store";
import { SECTOR_SHORT } from "../../data/companies";
import { CITY_CONTINENT } from "../../data/geo";
import { CITY_COUNTRY } from "../../data/mapboxWorldGeo";
import { answerQuestion } from "../../lib/analystAnswer";
import type { AnalystAnswer, AnalystScope } from "../../lib/analystFn";
import { PROMPT_TOPICS } from "../../lib/analystIntent";
import {
  type ResolvedScope,
  scopeForCompany,
  scopeForCity,
  scopeForCountry,
  scopeForRegion,
  WORLD_SCOPE,
} from "../../lib/analystScope";
import { describeQuery, followUpsFor, resolveTurn, type AnalystQuery } from "../../lib/analystTurn";
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
 *
 * The prompt row follows the design's later revision: four topics, each opening
 * a menu of three questions above the row, with the thread blurred back while
 * the menu is open. Every one of the twelve was put through detectIntent before
 * being listed — all classify to a real intent, so no menu entry can lead to "I
 * didn't understand that". See PROMPT_TOPICS in lib/analystIntent.ts.
 */

interface Msg {
  id: number;
  role: "user" | "analyst";
  text: string;
  answer?: AnalystAnswer;
  /** "Nursing · Sydney" — set only when this turn inherited something. */
  context?: string;
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

/**
 * The chip row's scopes. Built by lib/analystScope.ts, which also resolves the
 * scope a QUESTION names, so a chip and a sentence can never disagree about
 * what "Perth" covers.
 */
type ScopeOption = ResolvedScope;

/** Two scopes are the same scope when they point at the same rows. */
const sameScope = (a: AnalystScope, b: AnalystScope) => a.kind === b.kind && a.id === b.id;

function AnalystIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" aria-hidden>
      {/* The design's 5.2s idle: a slow nod and a tie sway, with a halo ring on
          the tile behind (see .anavatar::after). Long and small enough to read
          as alive rather than as something demanding attention. */}
      <circle className="anhead" cx="12" cy="5.6" r="2.9" />
      <path d="M9.5 9 12 12.2 14.5 9" />
      <path d="M9.5 9 6.4 10.3A4.4 4.4 0 0 0 3.8 14.4V20h6.1" />
      <path d="M14.5 9l3.1 1.3a4.4 4.4 0 0 1 2.6 4.1V20h-6.1" />
      <path
        className="antie"
        d="M10.6 12.9h2.8l-.7 3.1.9 3.9h-3.2l.9-3.9Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function AnalystPane() {
  const open = useAppStore((s) => s.analystOpen);
  const closeAnalyst = useAppStore((s) => s.closeAnalyst);
  const sheet = useMobileSheet({ open, onClose: closeAnalyst });
  const selectedId = useAppStore((s) => s.selectedId);
  const localCity = useAppStore((s) => s.localCity);
  const domesticRegion = useAppStore((s) => s.domesticRegion);

  // Scopes follow the user rather than being a fixed list: whatever company is
  // open, the city they're in, its country, its region, and everything.
  const scopes = useMemo<ScopeOption[]>(() => {
    const out: (ScopeOption | null)[] = [];
    if (selectedId) out.push(scopeForCompany(selectedId, localCity));
    const city = localCity;
    if (city) {
      out.push(scopeForCity(city));
      const cc = CITY_COUNTRY[city];
      if (cc) out.push(scopeForCountry(cc));
    }
    out.push(scopeForRegion(domesticRegion || CITY_CONTINENT[city]));
    out.push(WORLD_SCOPE);
    // De-duplicate by label, keeping the most specific (earliest) entry.
    const seen = new Set<string>();
    return out
      .filter((s): s is ScopeOption => !!s)
      .filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true)));
  }, [selectedId, localCity, domesticRegion]);

  /**
   * The scope the ANALYSIS is on, which is not always a chip.
   *
   * Held by value rather than as an index into `scopes`, because a question can
   * move the analysis somewhere the chip row does not offer — "what about
   * Canada?" while the chips read Perth / Australia / Asia. An index cannot
   * represent that, and clamping one (the previous behaviour) would silently
   * answer about a different place than the user asked for.
   */
  const [activeScope, setActiveScope] = useState<ScopeOption | null>(null);
  const scope = activeScope ?? scopes[0];
  /**
   * The last resolved question, so the next one can be a follow-up.
   *
   * This is the entire memory of the feature. Null means the next sentence is
   * read on its own — the behaviour before follow-ups existed.
   */
  const [carried, setCarried] = useState<AnalystQuery | null>(null);

  // A scope reached by asking still needs a chip, or the row would show one
  // place highlighted while the answer came from another.
  const chips = useMemo<ScopeOption[]>(
    () => (scopes.some((s) => sameScope(s, scope)) ? scopes : [scope, ...scopes]),
    [scopes, scope],
  );

  // Moving the map out from under the pane invalidates a scope that came from a
  // question — the chips rebuild around the new place, and an analysis still
  // pinned to the old one would be answering about somewhere the user has left.
  useEffect(() => {
    setActiveScope(null);
    setCarried(null);
  }, [selectedId, localCity, domesticRegion]);

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
  /** Which prompt topic's menu is open, if any. */
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest exchange in view as the thread grows.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, thinking]);

  // Click away or press Escape to close the topic menu. Pointerdown rather than
  // click so the menu is gone before whatever was pressed underneath reacts.
  useEffect(() => {
    if (!openTopic) return;
    const away = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpenTopic(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenTopic(null);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [openTopic]);

  // A closed pane must not reopen with a menu hanging over the thread.
  useEffect(() => {
    if (!open) setOpenTopic(null);
  }, [open]);

  /**
   * Drop the conversation and everything it was carrying.
   *
   * The scope goes back to the chip row rather than staying wherever the last
   * question moved it — a cleared thread that still answers about Canada has
   * not really been cleared.
   */
  /**
   * Pivots worth offering after the current answer, drawn from the same chip
   * list so a suggestion can only ever name a scope that exists. Empty until a
   * question has been asked — there is nothing to follow up on before that.
   */
  const followUps = useMemo(
    () => (carried ? followUpsFor(carried, chips, localCity) : []),
    [carried, chips, localCity],
  );

  const startOver = () => {
    setThread([{ id: nextId.current++, role: "analyst", text: OPENER }]);
    setCarried(null);
    setActiveScope(null);
    setOpenTopic(null);
  };

  const ask = async (raw: string) => {
    const question = raw.trim();
    if (!question || thinking) return;
    setThread((t) => [...t, { id: nextId.current++, role: "user", text: question }]);
    setDraft("");
    setThinking(true);
    // Merge this sentence with the conversation BEFORE querying: a follow-up
    // carries no intent of its own, so asking the archive about the raw text
    // would answer the fallback instead of the question being followed up on.
    const turn = resolveTurn(question, carried, scope, localCity);
    // A question that named a place moves the chip too. Leaving the chip behind
    // would show one place while the numbers came from another.
    if (!sameScope(turn.query.scope, scope)) setActiveScope(turn.query.scope);
    setCarried(turn.query);
    try {
      const answer = await answerQuestion(
        question,
        turn.query.scope,
        turn.query.scope.hubs,
        turn.query.scope.country,
        activeSector === ALL_SECTORS ? undefined : activeSector,
        sectorIds,
        { intent: turn.query.intent, skill: turn.query.skill, wantsAreas: turn.query.wantsAreas },
      );
      setThread((t) => [
        ...t,
        {
          id: nextId.current++,
          role: "analyst",
          text: answer.text,
          answer,
          // Only when something was carried: labelling every answer with its own
          // scope is noise, but an answer that quietly changed subject has to
          // say what it is about. See TurnResult.inherited.
          context: turn.inherited.length ? describeQuery(turn.query) : undefined,
        },
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

  // `visible`, not `open`: the pane must stay mounted while it slides back
  // down. It is identical to `open` above 680px.
  if (!sheet.visible) return null;

  return (
    <>
      {/* On a phone the scrim appears only at FULL — at peek the map is still
          the subject. Desktop has no detents, so it always gets the scrim. */}
      {(!sheet.enabled || sheet.detent === "full") && (
        <div className="panescrim" onClick={closeAnalyst} />
      )}
      <div className="analystpane" {...sheet.sheetProps}>
        {sheet.enabled && (
          <MobileSheetHandle
            dragProps={sheet.dragProps}
            detent={sheet.detent}
            onToggle={sheet.toggleDetent}
          />
        )}
        <div className="anhd" {...sheet.dragProps}>
          <span className="anavatar">
            <AnalystIcon />
          </span>
          <div className="anhdtext">
            <span className="antitle">Ask an analyst</span>
            <span className="ansub">Answers grounded in live employsi vacancy data</span>
          </div>
          {/* Clearing the thread is the only way to drop a carried analysis on
              purpose. Without it the conversation can only be escaped by asking
              a question that happens to name every dimension, which is not
              something a user should have to work out. Hidden until there is
              something to clear. */}
          {thread.length > 1 && (
            <button className="anreset" onClick={startOver} type="button">
              Start over
            </button>
          )}
          <button className="anx" onClick={closeAnalyst} aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="anscopes">
          <span className="anscopelbl">Scope</span>
          {chips.map((s) => (
            <button
              key={s.kind + s.id}
              type="button"
              // Highlighted by identity, not by index: the active scope can be
              // one the question introduced rather than one of the derived
              // chips, and an index cannot point at that.
              className={`anscope${sameScope(s, scope) ? " on" : ""}`}
              aria-pressed={sameScope(s, scope)}
              onClick={() => {
                setActiveScope(s);
                // Picking a scope by hand re-bases the conversation on it, so
                // the next "what about nursing?" is asked about THIS place.
                setCarried((q) => (q ? { ...q, scope: s } : q));
              }}
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

        <div className={`anbody${openTopic ? " dimmed" : ""}`} ref={bodyRef}>
          {thread.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="anrow anrow-user">
                <div className="anuser">{m.text}</div>
              </div>
            ) : (
              <div key={m.id} className="anrow">
                <div className="ananswer">
                  <span className="antail" />
                  {/* What this answer is ABOUT, shown only when the turn
                      inherited it rather than saying it. A follow-up like "what
                      about Sydney?" is answered from context the sentence does
                      not contain, and hidden context steering real figures is
                      exactly what analystIntent.ts's "predictable rule"
                      principle is there to prevent. */}
                  {m.context && <span className="ancontext">{m.context}</span>}
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

                {/* Offered on the NEWEST answer only. A follow-up applies to
                    the analysis as it stands now, so chips under an older turn
                    would pivot from somewhere the conversation has already
                    left. */}
                {m.id === thread[thread.length - 1]?.id && followUps.length > 0 && !thinking && (
                  <div className="anfollow">
                    {followUps.map((f) => (
                      <button
                        key={f.question}
                        type="button"
                        className="anfollowq"
                        title={f.question}
                        onClick={() => ask(f.question)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
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

        <div className="anprompts" ref={menuRef}>
          {openTopic && (
            <div className="anmenu" role="menu">
              <span className="anmenulbl">{openTopic}</span>
              {(PROMPT_TOPICS.find((t) => t.label === openTopic)?.questions ?? []).map((q) => (
                <button
                  key={q}
                  type="button"
                  className="anmenuq"
                  role="menuitem"
                  onClick={() => {
                    setOpenTopic(null);
                    ask(q);
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          {PROMPT_TOPICS.map((t) => (
            <button
              key={t.label}
              type="button"
              className={`anprompt${openTopic === t.label ? " on" : ""}`}
              aria-expanded={openTopic === t.label}
              aria-haspopup="menu"
              onClick={() => setOpenTopic((v) => (v === t.label ? null : t.label))}
            >
              {t.label}
              <svg
                viewBox="0 0 24 24"
                width={12}
                height={12}
                fill="none"
                stroke="currentColor"
                aria-hidden
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
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
