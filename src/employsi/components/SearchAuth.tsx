import { useState } from "react";
import { useAppStore } from "../state/store";
import { isReleasedCompany } from "../lib/markets";
import { Avatar } from "./Avatar";
import { COMPANIES, type Company } from "../data/companies";
import { searchCityFor } from "../data/mapboxGeo";
import { logoFor } from "../lib/companyLogo";
import { SignInOptions } from "./SignInOptions";
import { signOut as authSignOut } from "../lib/authClient";

/**
 * The account control inside the search pill, from `Employsi Skill Search.html`.
 *
 * The design puts sign-in at the right-hand end of the search bar as a 34px
 * avatar button with a 288px panel below it: a Create account / Sign in
 * segmented control, the fields for whichever is chosen, one primary action and
 * a line to switch between them.
 *
 * Sign-in is Google or LinkedIn (see SignInOptions) — the email/password form
 * that used to sit here accepted any password and created no user, so it is
 * gone rather than restyled.
 *
 * It is wired to the store's auth, which is also what gates following:
 * tapping Follow while signed out sets `authOpen` and remembers what was
 * tapped, so opening THIS panel is what completes that flow, and the followed
 * company or skill is saved the moment the account exists. Using the store's
 * flag rather than local state is what makes that work.
 *
 * The design has no signed-in state — its mock is always logged out. Signed in,
 * the button becomes the account's initials and the panel becomes what the user
 * then needs: what they follow, and a way out.
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
        aria-label={account ? `Account: ${account.name}` : "Sign in"}
        aria-expanded={authOpen}
      >
        {account ? (
          <Avatar name={account.name} image={account.image} className="gsauthinitials" />
        ) : (
          <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor">
            <circle cx="12" cy="8.6" r="3.6" />
            <path d="M5.4 19.4a6.8 6.8 0 0 1 13.2 0" />
          </svg>
        )}
        {!account && <span className="gsauthtip">Sign in</span>}
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
              <SignInOptions />
            )}
          </div>
        </>
      )}
    </div>
  );
}
