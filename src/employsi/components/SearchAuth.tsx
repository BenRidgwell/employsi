import { useState, type FormEvent } from "react";
import { useAppStore } from "../state/store";
import { COMPANIES } from "../data/companies";
import { cityForCompany } from "../data/mapboxGeo";

/**
 * The account control inside the search pill, from `Employsi Skill Search.html`.
 *
 * The design puts sign-in at the right-hand end of the search bar as a 34px
 * avatar button with a 288px panel below it: a Create account / Sign in
 * segmented control, the fields for whichever is chosen, one primary action and
 * a line to switch between them.
 *
 * It is wired to the store's existing auth, which is also what gates following:
 * tapping Follow while signed out sets `authOpen` and remembers what was
 * tapped, so opening THIS panel is what completes that flow, and the followed
 * company or skill is saved the moment the account exists. Using the store's
 * flag rather than local state is what makes that work.
 *
 * The design has no signed-in state — its mock is always logged out. Signed in,
 * the button becomes the account's initials and the panel becomes what the user
 * then needs: what they follow, and a way out.
 */

const emailOk = (v: string) => /.+@.+\..+/.test(v.trim());

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U"
  );
}

export function SearchAuth() {
  const account = useAppStore((s) => s.account);
  const authOpen = useAppStore((s) => s.authOpen);
  const openAuth = useAppStore((s) => s.openAuth);
  const closeAuth = useAppStore((s) => s.closeAuth);
  const signUp = useAppStore((s) => s.signUp);
  const signIn = useAppStore((s) => s.signIn);
  const signOut = useAppStore((s) => s.signOut);
  const followedIds = useAppStore((s) => s.followedIds);
  const followedSkills = useAppStore((s) => s.followedSkills);
  const select = useAppStore((s) => s.select);
  const zoomInCity = useAppStore((s) => s.zoomInCity);
  const toggleSkillQuery = useAppStore((s) => s.toggleSkillQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);

  const [mode, setMode] = useState<"create" | "signin">("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");

  const isCreate = mode === "create";
  const valid = isCreate
    ? name.trim().length >= 2 && emailOk(email) && pw.length >= 4
    : emailOk(email) && pw.length >= 4;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    if (isCreate) signUp(name, email);
    else signIn(email);
    setName("");
    setEmail("");
    setPw("");
  };

  const saved = COMPANIES.filter((c) => followedIds.includes(c.id));

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
          <span className="gsauthinitials">{initialsOf(account.name)}</span>
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
                    {saved.slice(0, 5).map((c) => (
                      <button
                        key={c.id}
                        className="gsauthsavedrow"
                        onClick={() => {
                          zoomInCity(cityForCompany(c.id));
                          select(c.id);
                          closeAuth();
                        }}
                      >
                        {c.name}
                      </button>
                    ))}
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
                <button className="gsauthcta gsauthout" onClick={signOut}>
                  Sign out
                </button>
              </>
            ) : (
              <form onSubmit={submit}>
                <div className="gsauthtabs">
                  <button
                    type="button"
                    className={`gsauthtab${isCreate ? " on" : ""}`}
                    onClick={() => setMode("create")}
                  >
                    Create account
                  </button>
                  <button
                    type="button"
                    className={`gsauthtab${!isCreate ? " on" : ""}`}
                    onClick={() => setMode("signin")}
                  >
                    Sign in
                  </button>
                </div>
                <div className="gsauthfields">
                  {isCreate && (
                    <input
                      className="gsauthinput"
                      placeholder="Full name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                    />
                  )}
                  <input
                    className="gsauthinput"
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                  <input
                    className="gsauthinput"
                    type="password"
                    placeholder="Password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    autoComplete={isCreate ? "new-password" : "current-password"}
                  />
                </div>
                <button type="submit" className="gsauthcta" disabled={!valid}>
                  {isCreate ? "Create account" : "Sign in"}
                </button>
                <div className="gsauthswitch">
                  {isCreate ? "Already have an account?" : "New to employsi?"}
                  <button type="button" onClick={() => setMode(isCreate ? "signin" : "create")}>
                    {isCreate ? "Sign in" : "Create account"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
