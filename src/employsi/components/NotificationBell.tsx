import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "../state/store";
import { getAlerts, type AlertRow } from "../lib/alertsFn";
import { IconClose } from "./ActionIcons";
import { COMPANIES, type Company } from "../data/companies";
import { SKILL_PARENT } from "../data/skillsTaxonomy";
import { logoFor } from "../lib/companyLogo";
import { SKILL_ICONS, skillIcon } from "../lib/skillCard";

/** Module-level, as in PerthMapbox and TalentFlowPane: COMPANIES is static and
 *  a .find() per row per render is 1,500 comparisons forty times over. */
const COMPANY_BY_ID: Record<string, Company> = Object.fromEntries(COMPANIES.map((c) => [c.id, c]));

/**
 * The company a row is about, as its round logo.
 *
 * Same badge ladder as the map pin and the company card (lib/companyLogo.ts),
 * so an employer is recognised the same way wherever it appears rather than by
 * whatever this panel could look up on its own.
 *
 * THE FALLBACK IS NOT OPTIONAL — same reasoning as SearchAuth's FollowedCompany
 * and CompanyPanel's CompanyLogo. A logo verified months ago can stop
 * resolving, and a broken image here is an empty circle against a headline that
 * never repeats the company name in full. The initials the row already carries
 * are exactly what stood here before, so the failure mode is the old design
 * rather than a hole.
 *
 * `alt` is empty and the name is not announced: the row's first line already
 * says the company, and a screen reader should not hear it twice.
 */
function AlertBadge({ company, initials }: { company: Company | undefined; initials: string }) {
  const [failed, setFailed] = useState(false);
  if (!company || failed) return <span className="nbinitials">{initials}</span>;
  return (
    <span className="nbinitials nbbadgeimgwrap">
      <img
        className="nbbadgeimg"
        src={logoFor(company.id, company.domain, 64)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

/**
 * The skill a row is about, as its glyph in a small circle.
 *
 * Every alert is a company AND a skill — alertsFn raises them from followed
 * COMPANIES and names the skill that moved — so the row has two subjects and
 * the badge can only carry one. The company takes the badge (it is the row's
 * title line); the skill takes this, inline with the headline that names it.
 *
 * Same glyph the skill's own search card shows (skillIcon / SKILL_ICONS in
 * lib/skillCard.ts), resolved through SKILL_PARENT so a speciality with no
 * glyph of its own inherits its parent's rather than falling all the way back
 * to the generic briefcase.
 */
function SkillGlyph({ skill }: { skill: string }) {
  const paths = SKILL_ICONS[skillIcon(skill, SKILL_PARENT[skill] ?? null)] ?? [];
  if (!paths.length) return null;
  return (
    <span className="nbskillglyph" title={skill}>
      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" aria-hidden>
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}

/**
 * The notification bell, from `Notification_Bell`.
 *
 * It watches the companies a person follows and speaks only when a hiring
 * signal moves outside that company's own baseline — see lib/alertsFn.ts for
 * the rule and, more importantly, for the coverage gate that stops it speaking
 * before the archive can support the comparison.
 *
 * ── THE ACCOUNT ────────────────────────────────────────────────────────────
 * The bell is an account feature twice over: the follows it watches live
 * against an account, and there is nothing to show without them. That used to
 * need handling — clicking it signed out opened sign-in instead of a panel.
 * The app is signed-in-only now (getAppAccess), so the bell always opens its
 * panel; the only account-shaped case left is the moment before the session
 * query lands, when the alerts query has not run and the panel is empty.
 *
 * ── THE BADGE ──────────────────────────────────────────────────────────────
 * Counts UNREAD alerts, and "read" is per browser. The design rings the bell
 * once on a new signal and never repeats; that is honoured by ringing only
 * when the unread count RISES, tracked against the previous render rather than
 * on every poll.
 */

const READ_KEY = "employsi.alerts.read";

/**
 * Alerts the person has swiped away.
 *
 * KEYED ON THE OCCURRENCE, NOT THE ALERT. An alert's id is
 * `company:skill:kind` with no date in it, so the same id comes back every
 * time that signal fires — dismissing by id alone would silence a company's
 * IT & Systems spike for good, and a genuinely new spike next month would
 * never be shown. The row's `at` (the day the window ends) is appended, so a
 * swipe dismisses THIS week's instance and a later one arrives as normal.
 *
 * Pruned on every write to the ids currently in play, so the store cannot grow
 * without bound as weeks roll past.
 */
const DISMISS_KEY = "employsi.alerts.dismissed";

/** The storage key for one row: the alert, scoped to the week it fired. */
function occKey(r: { id: string; at: string }): string {
  return `${r.id}@${r.at}`;
}

function loadDismissed(): Record<string, true> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const v = raw ? (JSON.parse(raw) as Record<string, true>) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** How far a row must travel before letting go dismisses it. */
const SWIPE_PX = 88;

function loadRead(): Record<string, true> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    const v = raw ? (JSON.parse(raw) as Record<string, true>) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const PILL: Record<string, string> = {
  spike: "spike",
  cooling: "cooling",
  "new skill": "new",
};

type Tab = "all" | "spikes" | "new";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "spikes", label: "Movement" },
  { key: "new", label: "New skills" },
];

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" aria-hidden>
      <g strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="nbglyph">
        <path d="M18.2 16.4V10.6a6.2 6.2 0 1 0-12.4 0v5.8L4.2 19h15.6Z" />
        <path d="M12 3.4V2.2" />
        <path className="nbclapper" d="M9.6 19a2.4 2.4 0 0 0 4.8 0" />
      </g>
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" aria-hidden>
      <g strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18.6 15.2A9.3 9.3 0 0 1 18 12V9.6a6 6 0 0 0-7.4-5.8" />
        <path d="M6 8.6V12a9 9 0 0 1-1.6 5.2h11.3" />
        <path d="M9.8 20.2a2.4 2.4 0 0 0 4.4 0" />
        <line x1="3.4" y1="3.4" x2="20.6" y2="20.6" />
      </g>
    </svg>
  );
}

export function NotificationBell() {
  const account = useAppStore((s) => s.account);
  // Panel visibility lives in the store: the account card's "Alerts" row opens
  // this same panel, and two controls cannot each own one panel's state.
  const open = useAppStore((s) => s.alertsOpen);
  const toggleAlerts = useAppStore((s) => s.toggleAlerts);
  const closeAlerts = useAppStore((s) => s.closeAlerts);
  const [tab, setTab] = useState<Tab>("all");
  const [read, setRead] = useState<Record<string, true>>({});
  /**
   * Read alerts collapsed back open by hand, for this session only.
   *
   * A READ ALERT RENDERS MINIMISED — that is the rule, and "Mark all read"
   * minimising the whole list is what falls out of it. It is derived from
   * `read` rather than held as its own "collapsed" flag on purpose: a separate
   * flag has to be reset when new alerts arrive, and forgetting that would
   * deliver tomorrow's unread alerts already collapsed, which is the one thing
   * a notification panel must not do.
   *
   * Not persisted. `read` survives a reload because a badge that re-lights
   * overnight is wrong; whether a row happened to be expanded is not worth
   * carrying, and starting minimised is the correct state for something read.
   */
  const [expanded, setExpanded] = useState<Record<string, true>>({});
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  /**
   * The row being swiped, and how far.
   *
   * One at a time — a pointer gesture is singular — so this is a single slot
   * rather than a map keyed by row.
   */
  const [drag, setDrag] = useState<{ key: string; dx: number } | null>(null);
  /** Gesture bookkeeping that must not re-render on every pointermove. */
  const gesture = useRef<{ key: string; x0: number; y0: number; axis: "" | "x" | "y" } | null>(
    null,
  );
  /** Set when a gesture turned into a drag, so the click it ends with is not
   *  treated as a tap on the row. */
  const swiped = useRef(false);
  const [muted, setMuted] = useState(false);
  const [ringing, setRinging] = useState(false);
  const prevUnread = useRef(0);

  useEffect(() => {
    setRead(loadRead());
    setDismissed(loadDismissed());
  }, []);

  const persist = (next: Record<string, true>) => {
    setRead(next);
    try {
      localStorage.setItem(READ_KEY, JSON.stringify(next));
    } catch {
      /* private mode — the badge just won't survive a reload */
    }
  };

  /**
   * Swipe a row away, and remember it.
   *
   * Pruned to the occurrences the server still sends, so last month's keys do
   * not accumulate. `all` is every row the API returned, not the visible tab's,
   * or switching tabs would drop the others' dismissals.
   */
  const dismiss = (key: string, all: AlertRow[]) => {
    const live = new Set(all.map(occKey));
    const next: Record<string, true> = { [key]: true };
    for (const k of Object.keys(dismissed)) if (live.has(k)) next[k] = true;
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* private mode — it comes back on the next load, which is the honest
         failure: nothing was stored, so nothing is hidden. */
    }
  };

  // Only asked for when signed in: the handler answers `signedOut` for everyone
  // else, and there is no reason to make that round trip on every load.
  const { data } = useQuery({
    queryKey: ["alerts", account?.email ?? ""],
    enabled: !!account,
    staleTime: 15 * 60 * 1000,
    queryFn: () => getAlerts(),
  });

  /** Everything the server sent, before dismissals — what `dismiss` prunes against. */
  const allRows: AlertRow[] = useMemo(() => data?.rows ?? [], [data]);
  /**
   * The rows the panel works from.
   *
   * Dismissals are filtered HERE rather than at render, so the unread badge,
   * the tab counts and "Mark all read" all agree with what is on screen — a
   * swiped-away alert must not keep the bell lit.
   */
  const rows: AlertRow[] = useMemo(
    () => allRows.filter((r) => !dismissed[occKey(r)]),
    [allRows, dismissed],
  );
  const unread = useMemo(() => rows.filter((r) => !read[r.id]).length, [rows, read]);

  // Ring once when the unread count RISES, never on a re-poll that returns the
  // same set, and never while muted.
  useEffect(() => {
    if (!muted && unread > prevUnread.current && !open) {
      setRinging(true);
      const t = setTimeout(() => setRinging(false), 800);
      prevUnread.current = unread;
      return () => clearTimeout(t);
    }
    prevUnread.current = unread;
  }, [unread, muted, open]);

  const visible = useMemo(
    () => (tab === "all" ? rows : rows.filter((r) => r.tab === tab)),
    [rows, tab],
  );
  const counts = useMemo(
    () => ({
      all: rows.length,
      spikes: rows.filter((r) => r.tab === "spikes").length,
      new: rows.filter((r) => r.tab === "new").length,
    }),
    [rows],
  );

  // The app is signed-in-only, so the bell always opens its panel. It used to
  // send a signed-out visitor to the sign-in sheet and label itself "Sign in for
  // alerts"; there is no such visitor now. Before the session query lands the
  // label reads as the empty state, which is what it is — the alerts query is
  // keyed on the account and has not run yet.
  const label = `Alerts${unread ? `, ${unread} new` : account ? ", all clear" : ""}`;

  return (
    <div className="nbwrap">
      <button
        type="button"
        className={`dockbtn nbbtn${open ? " on" : ""}${ringing ? " ringing" : ""}`}
        onClick={toggleAlerts}
        aria-label={label}
        aria-expanded={open}
      >
        <span className="nbicon">
          <BellIcon />
          {!!unread && !open && <span className="nbbadge">{unread > 9 ? "9+" : unread}</span>}
        </span>
        <span className="docktip">
          {`Alerts${unread ? ` · ${unread} new` : account ? " · all clear" : ""}`}
        </span>
      </button>

      {open && (
        <>
          <div className="nbscrim" onClick={closeAlerts} />
          <div className="nbpanel" role="dialog" aria-label="Alerts">
            <div className="nbhd">
              <span className="nbtitle">Alerts</span>
              <div className="nbhdbtns">
                {/* Marks every alert across all three tabs read, which
                    collapses them all — the panel STAYS OPEN. Also drops any
                    rows the person had re-expanded, so "all read" really does
                    leave the list uniformly minimised rather than mostly. */}
                <button
                  type="button"
                  className="nbsmall"
                  onClick={() => {
                    setExpanded({});
                    persist(Object.fromEntries(rows.map((r) => [r.id, true as const])));
                  }}
                >
                  Mark all read
                </button>
                <button
                  type="button"
                  className={`nbsmall nbmute${muted ? " on" : ""}`}
                  onClick={() => setMuted((v) => !v)}
                  aria-pressed={muted}
                >
                  <MuteIcon />
                  {muted ? "Muted" : "Mute"}
                </button>
                {/* This panel had no close button at all — it could only be
                    dismissed by clicking the scrim. Every other card that opens
                    over the map carries one, and a panel that looks like them
                    and cannot be closed like them is the worse kind of
                    inconsistency. */}
                <button
                  type="button"
                  className="paneclose"
                  onClick={closeAlerts}
                  aria-label="Close alerts"
                >
                  <IconClose />
                </button>
              </div>
            </div>

            <div className="nbtabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`nbtab${tab === t.key ? " on" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  <span className="nbtabn">{counts[t.key]}</span>
                </button>
              ))}
            </div>

            <div className="nblist">
              {visible.map((r) => {
                // Both bars are scaled to the larger of the pair, so the two
                // read as a comparison rather than two separate meters.
                const max = Math.max(r.week, r.month, 1);
                // Read => minimised, unless the person has opened it again.
                const isRead = !!read[r.id];
                const shut = isRead && !expanded[r.id];
                const key = occKey(r);
                const dx = drag?.key === key ? drag.dx : 0;
                // Past the threshold, letting go deletes. The strip says so:
                // it deepens and the label sharpens, so the commit point is
                // felt before the finger lifts rather than discovered after.
                const armed = Math.abs(dx) >= SWIPE_PX;
                return (
                  <div className="nbrowwrap" key={r.id}>
                    {/* The delete strip, revealed by the row sliding off it.
                        Rendered only while a swipe is in progress — a red
                        panel sitting permanently behind every row would show
                        at the edges on any sub-pixel rounding, and this list
                        is mostly read at rest.

                        `side` follows the direction of travel, because the
                        space that opens up is on the side the row came from. */}
                    {!!dx && (
                      <div
                        className={`nbswipe${armed ? " armed" : ""}`}
                        data-side={dx < 0 ? "right" : "left"}
                        aria-hidden
                        style={{ width: `${Math.min(Math.abs(dx), 240)}px` }}
                      >
                        <span className="nbswipelbl">
                          <svg
                            viewBox="0 0 24 24"
                            width="15"
                            height="15"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.9}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
                          </svg>
                          {/* THE WORD APPEARS WITH THE COMMIT POINT. Measured: the
                              icon-and-word group needs 84px of strip, and the
                              dismiss threshold is 88px — so once letting go would
                              delete, "Delete" always fits. Below that it would be
                              clipped mid-word ("Del"), which reads as a rendering
                              fault rather than a label, so only the bin shows. */}
                          {armed && "Delete"}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      className={`nbrow${shut ? " shut" : ""}${dx ? " swiping" : ""}`}
                      aria-expanded={!shut}
                      // NO OPACITY FADE. The row used to fade as it travelled,
                      // which was right when there was nothing behind it; over
                      // the red strip a translucent row just muddies both. It
                      // slides off at full opacity and the strip does the
                      // talking.
                      style={dx ? { transform: `translateX(${dx}px)` } : undefined}
                      // SWIPE TO DISMISS. Pointer events rather than touch ones,
                      // so a mouse drag works the same way — the gesture is not
                      // only for phones, and there is no second code path.
                      //
                      // The axis is decided once, at 6px, and a vertical gesture
                      // is then left alone: .nblist scrolls, and stealing a
                      // downward drag would make the list unscrollable on touch.
                      // `touch-action: pan-y` on the row tells the browser the
                      // same thing, so it keeps handling the scroll itself.
                      onPointerDown={(e) => {
                        if (e.pointerType === "mouse" && e.button !== 0) return;
                        gesture.current = { key, x0: e.clientX, y0: e.clientY, axis: "" };
                        swiped.current = false;
                      }}
                      onPointerMove={(e) => {
                        const g = gesture.current;
                        if (!g || g.key !== key) return;
                        const mx = e.clientX - g.x0;
                        const my = e.clientY - g.y0;
                        if (!g.axis) {
                          if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
                          g.axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
                          if (g.axis === "x") e.currentTarget.setPointerCapture(e.pointerId);
                        }
                        if (g.axis !== "x") return;
                        swiped.current = true;
                        setDrag({ key, dx: mx });
                      }}
                      onPointerUp={() => {
                        const g = gesture.current;
                        gesture.current = null;
                        const far = Math.abs(drag?.key === key ? drag.dx : 0) >= SWIPE_PX;
                        setDrag(null);
                        if (g?.axis === "x" && far) dismiss(key, allRows);
                      }}
                      // A cancelled gesture (the browser took over, the pointer
                      // left the window) springs back rather than dismissing.
                      onPointerCancel={() => {
                        gesture.current = null;
                        setDrag(null);
                      }}
                      // The keyboard's way to the same thing. A swipe-only
                      // dismiss would be unreachable without a pointer, and this
                      // list is otherwise fully keyboard-operable.
                      onKeyDown={(e) => {
                        if (e.key !== "Delete" && e.key !== "Backspace") return;
                        e.preventDefault();
                        dismiss(key, allRows);
                      }}
                      // Unread: reading it is what collapses it. Read: the click
                      // is the way back in, and out again — otherwise marking
                      // something read would hide its figures for good.
                      //
                      // A drag ends in a click, so a swipe that fell short of the
                      // threshold would otherwise also toggle the row on its way
                      // back. `swiped` is set the moment a gesture commits to the
                      // horizontal axis, and cleared here.
                      onClick={() => {
                        if (swiped.current) {
                          swiped.current = false;
                          return;
                        }
                        if (isRead) {
                          setExpanded((prev) => {
                            const next = { ...prev };
                            if (next[r.id]) delete next[r.id];
                            else next[r.id] = true;
                            return next;
                          });
                        } else {
                          persist({ ...read, [r.id]: true });
                        }
                      }}
                    >
                      <AlertBadge company={COMPANY_BY_ID[r.companyId]} initials={r.initials} />
                      <span className="nbbody">
                        <span className="nbtop">
                          <span className="nbco">{r.company}</span>
                          <span className={`nbpill ${PILL[r.kind] ?? "spike"}`}>{r.kind}</span>
                          <span className="nbwhen">{r.week} ads</span>
                          {!read[r.id] && <span className="nbdot" />}
                        </span>
                        <span className="nbheadlinerow">
                          <SkillGlyph skill={r.skill} />
                          <span className="nbheadline">{r.headline}</span>
                        </span>
                        <span className="nbbars">
                          <span className="nbbar">
                            <span className="nbbarlbl">This wk</span>
                            <span className="nbbartrack">
                              <span
                                className="nbbarfill"
                                style={{ width: `${Math.round((r.week / max) * 100)}%` }}
                              />
                            </span>
                            <span className="nbbarv">{r.week}</span>
                          </span>
                          <span className="nbbar">
                            <span className="nbbarlbl">Mo avg</span>
                            <span className="nbbartrack">
                              <span
                                className="nbbarfill muted"
                                style={{ width: `${Math.round((r.month / max) * 100)}%` }}
                              />
                            </span>
                            <span className="nbbarv muted">{r.month}</span>
                          </span>
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}

              {/* The notice is the honest empty state: it says whether there is
                  nothing to report, nothing followed, or not yet enough history
                  to compare against — three different things that would
                  otherwise all render as a blank panel. */}
              {!visible.length && data?.notice && <p className="nbnotice">{data.notice}</p>}
              {!visible.length && !data?.notice && (
                <p className="nbnotice">Nothing to report on this tab.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
