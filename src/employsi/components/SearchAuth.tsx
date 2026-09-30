import { useState } from "react";
import { useAppStore } from "../state/store";
import { isReleasedCompany } from "../lib/markets";
import { Avatar } from "./Avatar";
import { COMPANIES, type Company } from "../data/companies";
import { searchCityFor } from "../data/mapboxGeo";
import { logoFor } from "../lib/companyLogo";
import { signOut as authSignOut } from "../lib/authClient";
import { CareerGoalBlock } from "./CareerGoalBlock";
import { PersonaSwitch } from "./PersonaSwitch";

/**
 * The account control inside the search pill, from `Employsi Skill Search.html`.
 *
 * The design puts it at the right-hand end of the search bar as a 34px avatar
 * button with a 288px panel below it.
 *
 * IT IS NO LONGER A SIGN-IN CONTROL. The design's panel was a Create account /
 * Sign in segmented control with the fields for whichever was chosen, and this
 * component carried it (as Google / LinkedIn buttons — the email+password form
 * accepted any password and created no user, so it was removed rather than
 * restyled). The app is signed-in-only as of 2026-09-30 (see getAppAccess), so
 * nobody who can render this panel needs to sign in, and the whole branch is
 * retired: the button is always the account's avatar and the panel is always
 * what a signed-in user needs — their career goal, what they follow, and a way
 * out.
 *
 * The one accountless state left is the few hundred milliseconds before the
 * session query answers, and the panel says it is loading. That is NOT the same
 * as signed out, which is why the store carries `sessionKnown` separately — see
 * the note on it in state/store.ts.
 *
 * `authOpen` survives the change and still lives in the store rather than in
 * local state, because other surfaces open this panel (the mobile menu's
 * Account row, the account card's Alerts row).
 */

/** Two full rows of five in the 288px panel. Anything beyond is counted, not
 *  hidden — see the comment at the call site. */
const FOLLOW_LOGOS_SHOWN = 10;

/**
 * A followed company, as a round logo button.
 *
 * The badge URL is resolved by lib/companyLogo.ts, the same ladder the map pin
 * and the company card use, so a company is recognisable in the same way
 * wherever it appears rather than by whatever this panel could look up on its
 * own.
 *
 * The onError fallback is not optional. A logo file verified months ago can
 * stop resolving, and at this size a broken image is an empty circle with no
 * name next to it any more — which is worse than the ticker, and much worse
 * than the text row this replaced. Same reasoning as CompanyPanel's
 * `CompanyLogo`; the difference is only that here the ticker is the ONLY
 * remaining label, so it is the thing being clicked rather than a caption.
 */
function FollowedCompany({ company, onPick }: { company: Company; onPick: () => void }) {
  const [failed, setFailed] = useState(false);
  const short = company.pill || company.ticker;
  return (
    <button
      type="button"
      className="gsauthlogo"
      onClick={onPick}
      // The circle carries no visible name, so the accessible name has to come
      // from here — `alt` on the image would disappear with it on failure.
      aria-label={company.name}
    >
      {failed ? (
        <span className="gsauthlogotxt">{short}</span>
      ) : (
        <img
          className="gsauthlogoimg"
          src={logoFor(company.id, company.domain, 128)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      <span className="gsauthlogotip">{company.name}</span>
    </button>
  );
}

export function SearchAuth() {
  const account = useAppStore((s) => s.account);
  const authOpen = useAppStore((s) => s.authOpen);
  const openAuth = useAppStore((s) => s.openAuth);
  const closeAuth = useAppStore((s) => s.closeAuth);
  const signOut = useAppStore((s) => s.signOut);
  const followedIds = useAppStore((s) => s.followedIds);
  const seesAllMarkets = useAppStore((s) => s.role) === "admin";
  const followedSkills = useAppStore((s) => s.followedSkills);
  const select = useAppStore((s) => s.select);
  const zoomInCity = useAppStore((s) => s.zoomInCity);
  const toggleSkillQuery = useAppStore((s) => s.toggleSkillQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);

  // A follow made before a market was gated -- or before the gate existed --
  // would otherwise keep offering a card the product refuses to fill. The
  // follow itself is left in place rather than deleted: the market is expected
  // to be released, and the follow should still be there when it is.
  const saved = COMPANIES.filter(
    (c) => followedIds.includes(c.id) && (seesAllMarkets || isReleasedCompany(c.id)),
  );

  return (
    <div className="gsauth">
      <button
        type="button"
        className={`gsauthbtn${authOpen ? " on" : ""}${account ? " signedin" : ""}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (authOpen ? closeAuth() : openAuth())}
        aria-label={account ? `Account: ${account.name}` : "Your account"}
        aria-expanded={authOpen}
      >
        {account ? (
          <Avatar name={account.name} image={account.image} className="gsauthinitials" />
        ) : (
          // Before the session lands. The generic person glyph stands in for the
          // avatar rather than advertising sign-in, and the tooltip that read
          // "Sign in" beside it is gone.
          <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor">
            <circle cx="12" cy="8.6" r="3.6" />
            <path d="M5.4 19.4a6.8 6.8 0 0 1 13.2 0" />
          </svg>
        )}
      </button>

      {authOpen && (
        <>
          {/* Click-away, matching the design's pointerdown-outside listener. */}
          <div className="gsauthscrim" onClick={closeAuth} />
          <div className="gsauthpanel">
            {account ? (
              <>
                <div className="gsauthwho">
                  <span className="gsauthname">{account.name}</span>
                  <span className="gsauthemail">{account.email}</span>
                </div>
                <CareerGoalBlock onLeave={closeAuth} />
                {saved.length > 0 && (
                  <div className="gsauthsaved">
                    <span className="gsauthsavedlbl">Companies you follow</span>
                    {/* Round logos rather than a list of names: at this size a
                        follow is recognised faster than it is read, and ten of
                        them fit in the space three names took.

                        The overflow is COUNTED, not dropped. The list this
                        replaced sliced to five and said nothing about the rest,
                        so someone following eight companies saw five and had no
                        way to know. */}
                    <div className="gsauthlogos">
                      {saved.slice(0, FOLLOW_LOGOS_SHOWN).map((c) => (
                        <FollowedCompany
                          key={c.id}
                          company={c}
                          onPick={() => {
                            zoomInCity(searchCityFor(c.id));
                            select(c.id);
                            closeAuth();
                          }}
                        />
                      ))}
                      {saved.length > FOLLOW_LOGOS_SHOWN && (
                        <span
                          className="gsauthlogo gsauthlogomore"
                          title={`${saved.length - FOLLOW_LOGOS_SHOWN} more followed ${
                            saved.length - FOLLOW_LOGOS_SHOWN === 1 ? "company" : "companies"
                          }`}
                        >
                          +{saved.length - FOLLOW_LOGOS_SHOWN}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {followedSkills.length > 0 && (
                  <div className="gsauthsaved">
                    <span className="gsauthsavedlbl">Skills you follow</span>
                    {followedSkills.slice(0, 5).map((sk) => (
                      <button
                        key={sk}
                        className="gsauthsavedrow"
                        onClick={() => {
                          setSearchQuery(sk);
                          toggleSkillQuery(sk);
                          closeAuth();
                        }}
                      >
                        {sk}
                      </button>
                    ))}
                  </div>
                )}
                {!saved.length && !followedSkills.length && (
                  <p className="gsauthhint">
                    Follow a skill or a company and it will be saved here.
                  </p>
                )}
                <PersonaSwitch />
                <button
                  className="gsauthcta gsauthout"
                  onClick={() => {
                    // Revoke the session server-side FIRST; clearing the store
                    // alone would leave a valid cookie behind, so the next load
                    // would silently sign the person back in.
                    void authSignOut().finally(() => signOut());
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              // The session query has not answered yet. There is no signed-out
              // branch any more: the route gate (getAppAccess) means anyone
              // rendering this panel is signed in, so the Create account / Sign
              // in control that used to live here has nobody to serve. Saying
              // "loading" is honest about the only state left.
              <p className="gsauthhint">Loading your account…</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
