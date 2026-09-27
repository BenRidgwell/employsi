import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "../state/store";
import { getCareerGoal } from "../lib/careerPathwaysFn";

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

/**
 * The signed-in account's career goal, as the profile shows it — in both
 * account panels (SearchAuth on desktop, AccountButton on phones), which is
 * why it is one component.
 *
 * The goal is the role set with "Set as goal?" on the Career pathways map.
 * Only its id is stored (followsFn's `kind 'goal'` row); the title, stage,
 * median pay and live ads are read from tonight's pathways data every time
 * this shows, so the figures are current rather than the day it was set. A
 * rung too thin to publish this window says so instead of showing an old
 * figure. Pressing the goal opens the map on it; the ✕ clears it.
 */
export function CareerGoalBlock({ onLeave }: { onLeave: () => void }) {
  const account = useAppStore((s) => s.account);
  const careerGoal = useAppStore((s) => s.careerGoal);
  const requestCareerGoal = useAppStore((s) => s.requestCareerGoal);
  const openCareerAt = useAppStore((s) => s.openCareerAt);

  const goalQ = useQuery({
    queryKey: ["careerGoal", careerGoal],
    queryFn: () => getCareerGoal({ data: { id: careerGoal! } }),
    enabled: !!account && !!careerGoal,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const goal = goalQ.data;

  return (
    <div className="accgoal">
      <span className="accgoallbl">Career goal</span>
      {careerGoal ? (
        <div className="accitem">
          <button
            type="button"
            className="accitemmain accgoalmain"
            onClick={() => {
              onLeave();
              openCareerAt(careerGoal);
            }}
          >
            {goal ? (
              <>
                <span className="accgoalstage">{goal.stageOf}</span>
                <span className="accitemname accgoaltitle">{goal.title}</span>
                <span className="accgoalfigs">
                  {/* Pay is suppressed below 8 advertised salaries; say that
                      rather than print a dash beside "median pay". */}
                  {goal.payLabel === "—" ? (
                    <span>Pay not published</span>
                  ) : (
                    <span>
                      <b>{goal.payLabel}</b> median pay
                    </span>
                  )}
                  <span>
                    <b>{goal.ads.toLocaleString("en-AU")}</b> live ads
                  </span>
                </span>
                <span className="accgoalview">
                  {goal.familyLabel} pathway <span aria-hidden>→</span>
                </span>
              </>
            ) : goalQ.isPending ? (
              <span className="accitemsub">Loading your goal…</span>
            ) : (
              <span className="accitemsub">
                Too few roles are advertised to show this goal right now.
              </span>
            )}
          </button>
          <button
            className="accitemx"
            aria-label="Remove career goal"
            onClick={() => requestCareerGoal(null)}
          >
            <XMark />
          </button>
        </div>
      ) : (
        <div className="accgoalnone">
          Set a goal on the career pathways map and it will show here.
        </div>
      )}
    </div>
  );
}
