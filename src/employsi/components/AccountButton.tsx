import { useAppStore } from "../state/store";
import { SignInOptions } from "./SignInOptions";
import { signOut as authSignOut } from "../lib/authClient";
import { COMPANIES } from "../data/companies";
import { cityForCompany } from "../data/mapboxGeo";

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

export function AccountButton() {
  const account = useAppStore((s) => s.account);
  const authOpen = useAppStore((s) => s.authOpen);
  const pendingFollowId = useAppStore((s) => s.pendingFollowId);
  const openAuth = useAppStore((s) => s.openAuth);
  const closeAuth = useAppStore((s) => s.closeAuth);
  const signOut = useAppStore((s) => s.signOut);
  const followedIds = useAppStore((s) => s.followedIds);
  const requestFollow = useAppStore((s) => s.requestFollow);
  const select = useAppStore((s) => s.select);
  const selectedId = useAppStore((s) => s.selectedId);
  const compareOpen = useAppStore((s) => s.compareOpen);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const localCity = useAppStore((s) => s.localCity);
  const zoomInCity = useAppStore((s) => s.zoomInCity);

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

  const saved = COMPANIES.filter((c) => followedIds.includes(c.id));
  const pending = pendingFollowId ? COMPANIES.find((c) => c.id === pendingFollowId) : undefined;

  return (
    <div className={`cgroup searchwrap acctwrap ${selectedId || compareOpen ? "behindcard" : ""}`}>
      <span className="seglbl">Account</span>
      <button
        className={`searchbtn acctbtn ${authOpen ? "on" : ""}`}
        onClick={() => (authOpen ? closeAuth() : openAuth())}
      >
        {account ? (
          <>
            <span className="acctav">{initialsOf(account.name)}</span>
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
      <div className={`searchflyout acctflyout ${authOpen ? "open" : ""}`}>
        {account ? (
          <>
            <div className="accthead">
              <span className="acctavlg">{initialsOf(account.name)}</span>
              <div className="acctmeta">
                <div className="acctname">{account.name}</div>
                <div className="acctemail">{account.email}</div>
              </div>
            </div>
            <div className="sflabel">Saved companies ({saved.length})</div>
            {saved.length > 0 ? (
              <div className="acctsaved">
                {saved.map((c) => (
                  <div className="acctrow" key={c.id}>
                    <button className="acctrowmain" onClick={() => openCompany(c.id)}>
                      <span className="acctrowname">{c.name}</span>
                      <span className="acctrowsec">{c.sector}</span>
                    </button>
                    <button
                      className="acctunfollow"
                      aria-label={`Unfollow ${c.name}`}
                      onClick={() => requestFollow(c.id)}
                    >
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
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="acctempty">
                No saved companies yet — tap <b>Follow</b> on any company card to keep track of it
                here.
              </div>
            )}
            <button
              className="sfclear"
              onClick={() => {
                // Revoke server-side before clearing locally, or the cookie
                // survives and the next load signs the person straight back in.
                void authSignOut().finally(() => signOut());
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            {pending && (
              <div className="acctnote">
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
