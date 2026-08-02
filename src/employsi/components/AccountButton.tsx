import { useState } from "react";
import { useAppStore } from "../state/store";
import { isReleasedCompany } from "../lib/markets";
import { SignInOptions } from "./SignInOptions";
import { signOut as authSignOut } from "../lib/authClient";
import { Avatar } from "./Avatar";
import { COMPANIES } from "../data/companies";
import { cityForCompany } from "../data/mapboxGeo";

/**
 * The account popout, built from `Account_Popouts.html`.
 *
 * The design ships BOTH states as one 352px card:
 *
 *   signed out — a title and one line of reason, the provider buttons, and the
 *                fine print about what we read from the profile
 *   signed in  — avatar / name / email, two counters, a small menu, and a
 *                footer with "Sign out"
 *
 * WHAT THE COUNTERS DO, AND WHY
 * The design draws Companies and Skills as BUTTONS with hover states but shows
 * no list. The shipped card had a saved-companies list you could open or
 * unfollow from, and silently dropping it to match a static mock would remove
 * working behaviour to gain a picture. So the counters are what the design says
 * they are — buttons — and pressing one discloses that list inside the card.
 * The design's shape is kept and nothing is lost.
 *
 * Both menu rows are live: Alerts opens the bell's panel (which is why its
 * `open` state moved into the store — see state/store.ts), Settings opens the
 * settings card. Neither is decoration.
 */

const IconBell = () => (
  <svg
    viewBox="0 0 24 24"
    width={17}
    height={17}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

const IconSliders = () => (
  <svg
    viewBox="0 0 24 24"
    width={17}
    height={17}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <line x1="21" y1="6" x2="14" y2="6" />
    <line x1="10" y1="6" x2="3" y2="6" />
    <line x1="21" y1="12" x2="12" y2="12" />
    <line x1="8" y1="12" x2="3" y2="12" />
    <line x1="21" y1="18" x2="16" y2="18" />
    <line x1="12" y1="18" x2="3" y2="18" />
    <circle cx="12" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="14" cy="18" r="2" />
  </svg>
);

const PersonIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
);

const XMark = () => (
  <svg
    viewBox="0 0 24 24"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export function AccountButton() {
  const account = useAppStore((s) => s.account);
  const authOpen = useAppStore((s) => s.authOpen);
  const pendingFollowId = useAppStore((s) => s.pendingFollowId);
  const openAuth = useAppStore((s) => s.openAuth);
  const closeAuth = useAppStore((s) => s.closeAuth);
  const signOut = useAppStore((s) => s.signOut);
  const followedIds = useAppStore((s) => s.followedIds);
  const followedSkills = useAppStore((s) => s.followedSkills);
  const seesAllMarkets = useAppStore((s) => s.role) === "admin";
  const requestFollow = useAppStore((s) => s.requestFollow);
  const requestFollowSkill = useAppStore((s) => s.requestFollowSkill);
  const select = useAppStore((s) => s.select);
  const selectedId = useAppStore((s) => s.selectedId);
  const compareOpen = useAppStore((s) => s.compareOpen);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const localCity = useAppStore((s) => s.localCity);
  const zoomInCity = useAppStore((s) => s.zoomInCity);
  const openAlerts = useAppStore((s) => s.openAlerts);
  const toggleSettings = useAppStore((s) => s.toggleSettings);

  /** Which counter is expanded, if any. Null is the design's default state. */
  const [openList, setOpenList] = useState<"companies" | "skills" | null>(null);

  // Opening a saved company should land the user on the local city that plots
  // it. Fly there whenever we're zoomed out OR currently in a different city
  // (e.g. a company-less finance hub) — otherwise the card would open while the
  // map is stranded on the wrong city.
  const openCompany = (id: string) => {
    const target = cityForCompany(id, localCity);
    if (zoomedOut || target !== localCity) zoomInCity(target);
    select(id);
    closeAuth();
  };

  // A follow made before a market was gated -- or before the gate existed --
  // would otherwise keep offering a card the product refuses to fill. The
  // follow itself is left in place rather than deleted: the market is expected
  // to be released, and the follow should still be there when it is.
  const saved = COMPANIES.filter(
    (c) => followedIds.includes(c.id) && (seesAllMarkets || isReleasedCompany(c.id)),
  );
  const pending = pendingFollowId ? COMPANIES.find((c) => c.id === pendingFollowId) : undefined;
  const isEmpty = saved.length === 0 && followedSkills.length === 0;

  const stats: { key: "companies" | "skills"; label: string; value: number }[] = [
    { key: "companies", label: "Companies", value: saved.length },
    { key: "skills", label: "Skills", value: followedSkills.length },
  ];

  return (
    <div className={`cgroup searchwrap acctwrap ${selectedId || compareOpen ? "behindcard" : ""}`}>
      <span className="seglbl">Account</span>
      <button
        className={`searchbtn acctbtn ${authOpen ? "on" : ""}`}
        onClick={() => (authOpen ? closeAuth() : openAuth())}
      >
        {account ? (
          <>
            <Avatar name={account.name} image={account.image} className="acctav" />
            <span>{account.name.split(" ")[0]}</span>
          </>
        ) : (
          <>
            <PersonIcon />
            <span>Sign in</span>
          </>
        )}
      </button>
      {authOpen && <div className="sfscrim" onClick={closeAuth} />}
      <div className={`accard ${authOpen ? "open" : ""}`}>
        {account ? (
          <>
            <div className="acchead">
              <Avatar name={account.name} image={account.image} className="accav" />
              <span className="accwho">
                <span className="accname">{account.name}</span>
                <span className="accemail">{account.email}</span>
              </span>
            </div>

            <div className="accstats">
              {stats.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`accstat${openList === s.key ? " on" : ""}`}
                  aria-expanded={openList === s.key}
                  onClick={() => setOpenList((v) => (v === s.key ? null : s.key))}
                >
                  <span className="accstatv">{s.value}</span>
                  <span className="accstatl">{s.label}</span>
                </button>
              ))}
            </div>

            {isEmpty && (
              <div className="accempty">Follow a skill or a company and it will be saved here.</div>
            )}

            {openList === "companies" && !!saved.length && (
              <div className="acclist">
                {saved.map((c) => (
                  <div className="accitem" key={c.id}>
                    <button className="accitemmain" onClick={() => openCompany(c.id)}>
                      <span className="accitemname">{c.name}</span>
                      <span className="accitemsub">{c.sector}</span>
                    </button>
                    <button
                      className="accitemx"
                      aria-label={`Unfollow ${c.name}`}
                      onClick={() => requestFollow(c.id)}
                    >
                      <XMark />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {openList === "skills" && !!followedSkills.length && (
              <div className="acclist">
                {followedSkills.map((sk) => (
                  <div className="accitem" key={sk}>
                    <span className="accitemmain accitemflat">
                      <span className="accitemname">{sk}</span>
                    </span>
                    <button
                      className="accitemx"
                      aria-label={`Unfollow ${sk}`}
                      onClick={() => requestFollowSkill(sk)}
                    >
                      <XMark />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="accmenu">
              <button
                type="button"
                className="accmenurow"
                onClick={() => {
                  closeAuth();
                  openAlerts();
                }}
              >
                <IconBell />
                <span className="accmenulbl">Alerts</span>
              </button>
              <button
                type="button"
                className="accmenurow"
                onClick={() => {
                  closeAuth();
                  toggleSettings();
                }}
              >
                <IconSliders />
                <span className="accmenulbl">Settings</span>
              </button>
            </div>

            <div className="accfoot">
              <button
                type="button"
                className="accsignout"
                onClick={() => {
                  // Revoke server-side before clearing locally, or the cookie
                  // survives and the next load signs the person straight back in.
                  void authSignOut().finally(() => signOut());
                }}
              >
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="acchead accheadout">
              <span className="accwho">
                <span className="acctitle">Save what you follow</span>
                <span className="accsub">
                  Sign in to keep your companies, skills and regions across devices.
                </span>
              </span>
            </div>
            {pending && (
              <div className="accpending">
                Sign in to save <b>{pending.name}</b> to your favourites.
              </div>
            )}
            <SignInOptions />
          </>
        )}
      </div>
    </div>
  );
}
