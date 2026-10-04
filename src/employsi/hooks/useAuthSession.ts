import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSession, claimLocalFollows, setCareerGoal } from "../lib/followsFn";
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
  const markSessionKnown = useAppStore((s) => s.markSessionKnown);
  const setAuthProviders = useAppStore((s) => s.setAuthProviders);
  const setPersona = useAppStore((s) => s.setPersona);
  const setFollows = useAppStore((s) => s.setFollows);
  const setRole = useAppStore((s) => s.setRole);
  const setCareerGoalLocal = useAppStore((s) => s.setCareerGoalLocal);
  const clearPendingCareerGoal = useAppStore((s) => s.clearPendingCareerGoal);
  const qc = useQueryClient();
  const claimed = useRef(false);

  const { data, isError } = useQuery({
    queryKey: ["session"],
    queryFn: () => getSession(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // A FAILED SESSION READ STILL HAS TO SETTLE sessionKnown. `retry: false` means
  // one network error leaves `data` undefined for the rest of the load, and the
  // effect below returns early on it — so nothing would ever call setSession and
  // every surface waiting on the session would wait forever. That was harmless
  // while a missing account rendered a sign-in prompt; now that the app is
  // signed-in-only those surfaces show "Loading your account…" instead, and the
  // failure would read as a hang.
  //
  // It settles the FLAG ONLY, and deliberately not through setSession(null):
  // that also clears the account, the role and the career goal, so a failed
  // REFETCH — this query goes stale after five minutes — would sign a working
  // session out of the UI over one dropped request. markSessionKnown leaves
  // whatever is already there alone.
  useEffect(() => {
    if (isError) markSessionKnown();
  }, [isError, markSessionKnown]);

  useEffect(() => {
    if (!data) return;
    setAuthProviders(data.providers);
    setPersona(data.persona);
    setSession(data.user);
    // After setSession, which resets the role on sign-out. `data.role` is the
    // EFFECTIVE role: an admin viewing as a user is reported as "user" here, so
    // the whole client behaves as one (lib/persona.ts).
    setRole(data.role);
    if (!data.user) return;

    // THE GOAL. A goal set while signed out was the thing the visitor came to
    // sign in for, so it wins over whatever the account held — the same as a
    // pending follow. It is written first and shown optimistically; the
    // session query is refreshed after so the next read agrees.
    const pendingGoal = useAppStore.getState().pendingCareerGoal;
    if (pendingGoal) {
      clearPendingCareerGoal();
      setCareerGoalLocal(pendingGoal.id);
      void setCareerGoal({ data: { id: pendingGoal.id } })
        .then(() => qc.invalidateQueries({ queryKey: ["session"] }))
        .catch(() => undefined);
    } else {
      setCareerGoalLocal(data.careerGoal);
    }

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
  }, [
    data,
    setSession,
    setAuthProviders,
    setPersona,
    setFollows,
    setRole,
    setCareerGoalLocal,
    clearPendingCareerGoal,
    qc,
  ]);
}
