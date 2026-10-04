import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOnboarding } from "../lib/onboardingFn";
import { useAppStore } from "../state/store";

/**
 * Open the first-run welcome card, once, for an account that has never seen it.
 *
 * The server owns the answer (lib/onboardingFn.ts) because "first login" is a
 * fact about the ACCOUNT, not the browser — see the note there for why
 * localStorage gets this wrong in both directions.
 *
 * GATED ON THE SESSION BEING KNOWN, not merely on `account` being null. The
 * session arrives a few hundred milliseconds after boot, so asking before then
 * would send an unauthenticated request, get "no" and cache it for the rest of
 * the load — the welcome card would never appear for the very people it is for.
 *
 * ASKED ONCE PER LOAD. `staleTime: Infinity` and no retry: this is a one-shot
 * greeting, and re-asking after the card has been dismissed could only produce
 * a stale "yes" and reopen it.
 */
export function useWelcome(): void {
  const account = useAppStore((s) => s.account);
  const sessionKnown = useAppStore((s) => s.sessionKnown);
  const setWelcomeOpen = useAppStore((s) => s.setWelcomeOpen);

  const { data } = useQuery({
    queryKey: ["onboarding", account?.id ?? ""],
    queryFn: () => getOnboarding(),
    enabled: sessionKnown && !!account,
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    // Only ever opens it. Closing is the card's own job, so a late refetch
    // cannot reopen a card the person has already answered.
    if (data?.welcome) setWelcomeOpen(true);
  }, [data, setWelcomeOpen]);
}
