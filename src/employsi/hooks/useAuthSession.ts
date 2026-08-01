import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSession, claimLocalFollows } from "../lib/followsFn";
import { useAppStore } from "../state/store";

/**
 * Bring the server's view of the session into the store, once per load.
 *
 * The session is an httpOnly cookie, so the client cannot read it — the only
 * way to know who is signed in is to ask. That also means this is the single
 * place identity enters the app: nothing else may set `account`.
 *
 * THE CLAIM. A visitor who used the app before accounts existed has follows in
 * localStorage and no user to hang them on. On the first load where a session
 * is present and local follows exist, they are handed to the server, merged
 * into the account (additively — see claimLocalFollows), and cleared locally.
 * Done once per session by the ref guard, because React 19 in strict mode runs
 * effects twice and a second claim would be a wasted round trip.
 */
export function useAuthSession(): void {
  const setSession = useAppStore((s) => s.setSession);
  const setAuthProviders = useAppStore((s) => s.setAuthProviders);
  const setFollows = useAppStore((s) => s.setFollows);
  const setRole = useAppStore((s) => s.setRole);
  const qc = useQueryClient();
  const claimed = useRef(false);

  const { data } = useQuery({
    queryKey: ["session"],
    queryFn: () => getSession(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    setAuthProviders(data.providers);
    setSession(data.user);
    // After setSession, which resets the role on sign-out.
    setRole(data.role);
    if (!data.user) return;

    // Whatever this browser held before there was an account to hold it.
    const local = useAppStore.getState();
    const pendingCompanies = local.followedIds;
    const pendingSkills = local.followedSkills;
    const hasLocal = pendingCompanies.length > 0 || pendingSkills.length > 0;

    if (hasLocal && !claimed.current) {
      claimed.current = true;
      void claimLocalFollows({ data: { companies: pendingCompanies, skills: pendingSkills } })
        .then(() => qc.invalidateQueries({ queryKey: ["session"] }))
        .catch(() => {
          // A failed claim must not lose the local copy — leave it in place so
          // the next load tries again.
          claimed.current = false;
        });
      return;
    }
    // No local leftovers (or they have been handed over): the account's own
    // set is now the truth.
    setFollows(data.followedIds, data.followedSkills);
  }, [data, setSession, setAuthProviders, setFollows, setRole, qc]);
}
