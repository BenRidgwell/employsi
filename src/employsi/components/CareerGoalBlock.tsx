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

const RUNGS = [1, 2, 3, 4, 5, 6] as const;

/**
 * The six-stage ladder, with the goal marked.
 *
 * Bars rise left to right; the stages BELOW the goal are solid, the goal
 * itself is the dashed outline, and anything above it is faint. The dashed
 * step is the design's point: the goal is where the person is heading, not
 * somewhere they have been, so it reads as an outline waiting to be filled.
 *
 * Heights are percentages of the strip, so the whole thing scales with the
 * panel — this renders at 288px inside the search rail's account panel and at
 * 352px inside the phone account card, from one rule.
 *
 * ONLY DRAWN ON THE CORE TRACK. A specialist track is a sideways move rather
 * than stage N of six, so a six-step ladder with one marked would be inventing
 * a progression that the pathways data does not claim (see `onCore`).
 *
 * Decorative: the stage is written underneath in words, so announcing six
 * empty spans would only repeat it.
 */
function GoalLadder({ rung }: { rung: number }) {
  return (
    <span className="cgladder" aria-hidden>
      {RUNGS.map((s) => (
        <span
          key={s}
          className={`cgstep${s === rung ? " goal" : s < rung ? " done" : " ahead"}`}
          style={{ height: `${26 + (s - 1) * 14.8}%` }}
        />
      ))}
    </span>
  );
}

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
 * figure. Pressing the card opens the map on it.
 *
 * THE ✕ SITS IN THE SECTION HEADER, not beside the card. It used to be a tall
 * button in the same row, which took a fixed slice of width off a card that
 * has to work at 288px — and put "remove this goal" at the same visual weight
 * as the goal. In the header it is the section's own control, and the card
 * gets the full width the ladder and chips need.
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
      <div className="accgoalhd">
        <span className="accgoallbl">Career goal</span>
        {careerGoal && (
          <button
            type="button"
            className="accgoalx"
            aria-label="Remove career goal"
            onClick={() => requestCareerGoal(null)}
          >
            <XMark />
          </button>
        )}
      </div>

      {!careerGoal ? (
        <div className="accgoalnone">
          Set a goal on the career pathways map and it will show here.
        </div>
      ) : goal ? (
        <button
          type="button"
          className="cgcard"
          onClick={() => {
            onLeave();
            openCareerAt(careerGoal);
          }}
        >
          {goal.onCore && <GoalLadder rung={goal.rung} />}
          <span className="cgstage">
            {goal.onCore ? `Goal · Stage ${goal.rung}` : "Goal · Specialist"}
          </span>
          <span className="cgtitle">{goal.title}</span>
          <span className="cglevel">{goal.levelLabel}</span>
          <span className="cgchips">
            {/* Pay is suppressed below 8 advertised salaries; say that rather
                than print a dash beside "median pay". */}
            {goal.payLabel === "—" ? (
              <span className="cgchip">Pay not published</span>
            ) : (
              <span className="cgchip">
                <b>{goal.payLabel}</b> median pay
              </span>
            )}
            <span className="cgchip live">
              <b>{goal.ads.toLocaleString("en-AU")}</b> live ads
            </span>
          </span>
          <span className="cgpath">
            {goal.familyLabel} pathway <span aria-hidden>→</span>
          </span>
        </button>
      ) : (
        <div className="accgoalnone">
          {goalQ.isPending
            ? "Loading your goal…"
            : "Too few roles are advertised to show this goal right now."}
        </div>
      )}
    </div>
  );
}
