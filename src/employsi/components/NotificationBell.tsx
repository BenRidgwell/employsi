import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "../state/store";
import { getAlerts, type AlertRow } from "../lib/alertsFn";

/**
 * The notification bell, from `Notification_Bell`.
 *
 * It watches the companies a person follows and speaks only when a hiring
 * signal moves outside that company's own baseline — see lib/alertsFn.ts for
 * the rule and, more importantly, for the coverage gate that stops it speaking
 * before the archive can support the comparison.
 *
 * ── SIGNED OUT ─────────────────────────────────────────────────────────────
 * The bell is an account feature twice over: the follows it watches live
 * against an account, and there is nothing to show without them. Clicking it
 * signed out opens sign-in rather than a panel explaining an empty state —
 * the same move the Follow button already makes.
 *
 * ── THE BADGE ──────────────────────────────────────────────────────────────
 * Counts UNREAD alerts, and "read" is per browser. The design rings the bell
 * once on a new signal and never repeats; that is honoured by ringing only
 * when the unread count RISES, tracked against the previous render rather than
 * on every poll.
 */

const READ_KEY = "employsi.alerts.read";

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

function weekLabel(iso: string): string {
  const t = Date.parse(iso + "T00:00:00Z");
  if (Number.isNaN(t)) return "";
  return new Date(t)
    .toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" })
    .toLowerCase();
}

export function NotificationBell() {
  const account = useAppStore((s) => s.account);
  const openAuth = useAppStore((s) => s.openAuth);
  // Panel visibility lives in the store: the account card's "Alerts" row opens
  // this same panel, and two controls cannot each own one panel's state.
  const open = useAppStore((s) => s.alertsOpen);
  const toggleAlerts = useAppStore((s) => s.toggleAlerts);
  const closeAlerts = useAppStore((s) => s.closeAlerts);
  const [tab, setTab] = useState<Tab>("all");
  const [read, setRead] = useState<Record<string, true>>({});
  const [muted, setMuted] = useState(false);
  const [ringing, setRinging] = useState(false);
  const prevUnread = useRef(0);

  useEffect(() => {
    setRead(loadRead());
  }, []);

  const persist = (next: Record<string, true>) => {
    setRead(next);
    try {
      localStorage.setItem(READ_KEY, JSON.stringify(next));
    } catch {
      /* private mode — the badge just won't survive a reload */
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

  const rows: AlertRow[] = useMemo(() => data?.rows ?? [], [data]);
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

  const onBell = () => {
    // Signed out: the whole feature is the follows, so send them to sign in.
    if (!account) {
      openAuth();
      return;
    }
    toggleAlerts();
  };

  return (
    <div className="nbwrap">
      <button
        type="button"
        className={`dockbtn nbbtn${open ? " on" : ""}${ringing ? " ringing" : ""}`}
        onClick={onBell}
        aria-label={
          account ? `Alerts, ${unread ? `${unread} new` : "all clear"}` : "Sign in for alerts"
        }
        aria-expanded={open}
      >
        <span className="nbicon">
          <BellIcon />
          {!!unread && !open && <span className="nbbadge">{unread > 9 ? "9+" : unread}</span>}
        </span>
        <span className="docktip">
          {account ? `Alerts · ${unread ? `${unread} new` : "all clear"}` : "Sign in for alerts"}
        </span>
      </button>

      {open && (
        <>
          <div className="nbscrim" onClick={closeAlerts} />
          <div className="nbpanel" role="dialog" aria-label="Alerts">
            <div className="nbhd">
              <div className="nbhdtext">
                <span className="nbtitle">Alerts</span>
                <span className="nbsub">
                  {data?.companies ?? 0} {data?.companies === 1 ? "company" : "companies"}
                  {rows.length && rows[0].at ? ` · week of ${weekLabel(rows[0].at)}` : ""}
                </span>
              </div>
              <div className="nbhdbtns">
                <button
                  type="button"
                  className="nbsmall"
                  onClick={() =>
                    persist(Object.fromEntries(rows.map((r) => [r.id, true as const])))
                  }
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
                return (
                  <button
                    key={r.id}
                    type="button"
                    className="nbrow"
                    onClick={() => persist({ ...read, [r.id]: true })}
                  >
                    <span className="nbinitials">{r.initials}</span>
                    <span className="nbbody">
                      <span className="nbtop">
                        <span className="nbco">{r.company}</span>
                        <span className={`nbpill ${PILL[r.kind] ?? "spike"}`}>{r.kind}</span>
                        <span className="nbwhen">{r.week} ads</span>
                        {!read[r.id] && <span className="nbdot" />}
                      </span>
                      <span className="nbheadline">{r.headline}</span>
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

            <div className="nbfoot">
              <span className="nbfootnote">
                {data?.days ? `Archive holds ${data.days} days of collection` : ""}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
