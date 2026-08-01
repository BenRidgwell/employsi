import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAppStore } from "../../state/store";
import { notifyMarket } from "../../lib/marketInterestFn";
import { etaFor } from "../../lib/markets";

/**
 * What an end user gets for clicking a market employsi has not released yet.
 *
 * The alternative — an inert grey dot — reads as "there is nothing here", which
 * is the opposite of true: those markets are collected, archived and mapped by
 * the same pipeline as the live ones and are waiting on the work to finish.
 * This card says that, names the place, and gives the person something to do
 * with the answer.
 *
 * Built to the supplied Coming Soon Region design: a 392px card over a blurred
 * scrim, with the construction-site illustration on top (an unloading gantry
 * filling the last bar of a chart) and the copy and actions beneath.
 *
 * ── What is real here ──────────────────────────────────────────────────────
 * The date. The design ships a hard-coded "Q4 2026" and there is no roadmap
 * behind it, so the eyebrow renders only for a market with an entry in
 * MARKET_ETA (see lib/markets.ts) — and today none have one, so it renders
 * nowhere. It is not printed dateless either: "ROADMAP" alone says nothing.
 *
 * "Notify me when it's live" writes a row to D1 against the signed-in account,
 * so the list is real and can actually be mailed when the market opens. Signed
 * out, it opens sign-in instead of pretending to have registered an address it
 * does not have. The design's progress bar and "DATA SOURCES CONNECTED" percent
 * are deliberately NOT carried over: there is no measurement behind either.
 */
export function ComingSoonPane() {
  const comingSoon = useAppStore((s) => s.comingSoon);
  const close = useAppStore((s) => s.closeComingSoon);
  const account = useAppStore((s) => s.account);
  const openAuth = useAppStore((s) => s.openAuth);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const notify = useMutation({
    mutationFn: (place: string) => notifyMarket({ data: { place, label: place } }),
    onSuccess: (r) => {
      if (r.ok) setDone(true);
      else setError(r.error || "Couldn't save that.");
    },
    onError: () => setError("Couldn't save that — try again shortly."),
  });

  // Reset per place: the card is a singleton, so without this the "You're on
  // the list" state from one market would greet you on the next one you open.
  useEffect(() => {
    setDone(false);
    setError("");
  }, [comingSoon?.id]);

  // Escape closes it, matching every other card in the app.
  useEffect(() => {
    if (!comingSoon) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [comingSoon, close]);

  if (!comingSoon) return null;
  const eta = etaFor(comingSoon.id);

  return (
    <>
      <div className="csscrim" onClick={close} />
      <div
        className="cscard"
        role="dialog"
        aria-modal="true"
        aria-label={`${comingSoon.place} is coming soon`}
      >
        {/* The illustration. Decorative — it carries no figure, so it is hidden
            from assistive tech rather than described. */}
        <div className="csart" aria-hidden>
          <div className="csgrid" />
          <div className="cssurvey" />

          <div className="csrail" />
          <div className="cspost" />
          <div className="cstrolley">
            <div className="cshead" />
            <div className="cscable" />
            <div className="cspayload" />
          </div>

          <div className="csbars">
            <div className="csbar" style={{ height: "34%" }} />
            <div className="csbar" style={{ height: "56%" }} />
            <div className="csbar" style={{ height: "78%" }} />
            <div className="csbarslot">
              <div className="csfill">
                <div className="csdust" />
              </div>
            </div>
          </div>

          <div className="cshazard" />
          <div className="cshazardline" />

          <div className="cschip">
            <span className="csdot" />
            <span className="cschiptext">BUILDING</span>
          </div>
        </div>

        <div className="csbody">
          <div className="cscopy">
            {/* The eyebrow only earns its place when it carries a date. On its
                own, "ROADMAP" is a label with no information in it. */}
            {eta ? <span className="cseyebrow">ROADMAP · {eta}</span> : null}
            <h2 className="cstitle">Hang tight, {comingSoon.place} is being built right now.</h2>
            <p className="cssub">
              We&rsquo;re busy wiring up employer feeds, uncovering regional employment data, and
              building the cities.
            </p>
          </div>

          {error ? <p className="cserr">{error}</p> : null}

          <div className="csactions">
            {done ? (
              <button className="csbtn csbtnprimary" disabled>
                You&rsquo;re on the list
              </button>
            ) : (
              <button
                className="csbtn csbtnprimary"
                disabled={notify.isPending}
                onClick={() => {
                  setError("");
                  // No account means no address to notify, so this sends them
                  // to sign in rather than storing a row that can never be used.
                  if (!account) {
                    close();
                    openAuth();
                    return;
                  }
                  notify.mutate(comingSoon.id);
                }}
              >
                {notify.isPending ? "Saving…" : "Notify me when it's live"}
              </button>
            )}
            <button className="csbtn csbtnsecondary" onClick={close}>
              Go back
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
