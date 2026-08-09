import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Activity } from "lucide-react";
import {
  getLiveSkillTrends,
  TREND_WINDOWS,
  type LiveSkillTrend,
} from "@/employsi/lib/jobHistoryFn";
import { fmtPay } from "@/employsi/lib/salaryParse";

/**
 * The "skills in demand" ticker on the landing page — a floating pill over a
 * transparent bar.
 *
 * WHAT CHANGED, AND WHY THE SHELL DIDN'T
 * This used to be a second, entirely fabricated ticker: sixteen hand-written
 * skills with hand-written salaries, deltas produced by a random walk every two
 * seconds, and three "windows" that multiplied one delta by 1 / 2.1 / 3.4. The
 * file said so in a comment and left the seeding in the open, which is the only
 * reason it was defensible at all.
 *
 * It now reads the SAME server function the app's ticker does
 * (getLiveSkillTrends → the D1 job archive), so the two cannot disagree: one
 * measurement, rendered twice. What is deliberately NOT shared is the markup.
 * The app's ticker is styled from `.ticker` in employsi/global.css, a 10k-line
 * stylesheet scoped to the map app and imported only by employsi/App.tsx;
 * pulling it into the landing route to reuse the component would drag the whole
 * app's cascade onto a marketing page to gain a strip. So the presentation here
 * stays the landing page's own Tailwind, and only the data layer is shared.
 *
 * Three consequences of using real figures, all inherited from the app:
 *
 *  1. The three windows are measured INDEPENDENTLY, each against its own prior
 *     window (24h vs the day before, 7d vs the week before, 30d vs the month
 *     before). Switching re-reads rather than rescaling.
 *  2. A window whose prior half predates the archive's collection start reports
 *     NOTHING rather than a figure — the server returns [] and the strip says
 *     why. The window control is disabled when no window has data, because
 *     there is nothing to switch to.
 *  3. A skill whose live ads mostly do not state a salary shows no pay figure,
 *     and a series too short or too flat to be honest shows no sparkline.
 *     Rows render without them rather than with an invented one.
 *
 * The pause button therefore stops the marquee, not a value churn — there is no
 * longer a churn to stop.
 */

const UP = { fg: "#2f8f63", tint: "#e8f3ec" };
const DOWN = { fg: "#c4463b", tint: "#f7ebe9" };
const FLAT = { fg: "#8e8e93", tint: "#f4f4f5" };

function toneFor(delta: number) {
  if (delta >= 0.15) return UP;
  if (delta <= -0.15) return DOWN;
  return FLAT;
}

/**
 * Daily live-vacancy counts → a 48x18 path.
 *
 * Returns null when there is nothing honest to draw: no series, fewer than two
 * points, or a dead-flat line. The row then renders without a sparkline. The
 * previous version took a guaranteed 14-point synthetic series and could always
 * draw something; a real series cannot, and a placeholder shape would be
 * actively misleading because the shape IS the information.
 */
function sparkPath(hist: number[] | undefined): string | null {
  if (!hist || hist.length < 2) return null;
  const min = Math.min(...hist);
  const max = Math.max(...hist);
  if (max === min) return null;
  return hist
    .map((v, i) => {
      const x = (i / (hist.length - 1)) * 46 + 1;
      // SVG y grows downward, so a higher count sits nearer the top.
      const y = 16 - ((v - min) / (max - min)) * 14;
      return `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

// Enough placeholder widths to fill the pill at any viewport width.
const SKELETON = [72, 108, 88, 124, 96, 80, 116, 92];
// Stable reference, so the empty state does not churn `items` identity and
// re-trigger the flash effect on every render.
const EMPTY: LiveSkillTrend[] = [];

function Lane({
  rows,
  sparkDays,
  flashed,
}: {
  rows: LiveSkillTrend[];
  sparkDays: number;
  flashed: ReadonlySet<string>;
}) {
  return (
    <>
      {rows.map((r, i) => {
        const tone = toneFor(r.v);
        // 0deg up, 180deg down, 90deg flat — one arrow, rotated, so the
        // transition between states is a turn rather than a swap.
        const rot = r.v >= 0.15 ? 0 : r.v <= -0.15 ? 180 : 90;
        const path = sparkPath(r.spark ? r.spark.slice(-sparkDays) : undefined);
        return (
          <div
            key={`${r.name}-${i}`}
            className="flex items-center gap-2 border-r border-[#f0f0f2] px-3 sm:gap-2.5 sm:px-[18px]"
          >
            <span className="whitespace-nowrap text-[12px] font-medium tracking-[-0.006em] text-[#1c1c1e] sm:text-[13px]">
              {r.name}
            </span>
            {/* Dropped on phones: 48px of sparkline per row against a lane barely
                wider than one row leaves no room for the figures beside it, and
                the shape is the least legible part at that size. */}
            {path && (
              <svg
                className="hidden sm:block"
                viewBox="0 0 48 18"
                width={48}
                height={18}
                aria-hidden
              >
                <path
                  d={path}
                  fill="none"
                  stroke={tone.fg}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.85}
                />
              </svg>
            )}
            {r.pay !== undefined && (
              <span
                className="font-mono text-[12px] tabular-nums tracking-[-0.01em] text-[#6c6c72]"
                title="Median annual salary advertised across the live Australian vacancies demanding this skill"
              >
                {fmtPay(r.pay)}
              </span>
            )}
            <span
              className="inline-flex h-[21px] items-center gap-1 rounded-[7px] px-[7px]"
              style={{
                color: tone.fg,
                background: flashed.has(r.name) ? tone.tint : "rgba(244,244,245,0)",
                transition: "background 700ms ease-out",
              }}
            >
              <svg
                width={11}
                height={11}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: `rotate(${rot}deg)`,
                  transition: "transform 260ms cubic-bezier(.32,.72,0,1)",
                }}
                aria-hidden
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
              <span className="font-mono text-[12px] tabular-nums">
                {Math.abs(r.v).toFixed(1)}%
              </span>
              {/* Names what the percentage measures. Without it the figure sits
                  beside a dollar amount and reads as a change in PAY, which is
                  the one thing it is not — it is the change in how many
                  vacancies demand the skill. */}
              <span className="font-mono text-[10px] uppercase tracking-[.08em] opacity-70">
                Demand
              </span>
            </span>
          </div>
        );
      })}
    </>
  );
}

export function Ticker() {
  const [expanded, setExpanded] = useState(true);
  const [win, setWin] = useState(0);
  const [paused, setPaused] = useState(false);

  // Real market-wide skill-demand movers from the D1 archive, all three windows
  // in one read. Cached hard: the archive only moves on the nightly cron.
  const { data: live } = useQuery({
    queryKey: ["liveSkillTrends"],
    queryFn: () => getLiveSkillTrends(),
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });

  const w = TREND_WINDOWS[win];
  const rows = live?.[w.key];
  // Three distinct states, and conflating any two of them is what let invented
  // figures onto this strip in the first place:
  //   loading    — the read has not returned. A skeleton, not numbers.
  //   no history — the archive is too young for THIS window's comparison, so
  //                the server returned nothing on purpose. Say that.
  //   live       — real movers.
  const loading = !live;
  const items = useMemo(() => (rows && rows.length ? rows : EMPTY), [rows]);
  const noHistory = !loading && items.length === 0;
  // Cycling is only offered when some window has data to cycle TO.
  const anyLive = !!live && TREND_WINDOWS.some((x) => (live[x.key]?.length ?? 0) > 0);

  // Flash the delta chip on rows whose value actually moved. `items` is a
  // stable reference, so this fires on a real data change or a window switch —
  // not on a timer, and not on every render.
  const lastValues = useRef<Record<string, number>>({});
  const [flashed, setFlashed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const changed = new Set<string>();
    for (const t of items) {
      const before = lastValues.current[t.name];
      if (before !== undefined && Math.abs(before - t.v) >= 0.05) changed.add(t.name);
      lastValues.current[t.name] = t.v;
    }
    if (!changed.size) return;
    setFlashed(changed);
    const id = setTimeout(() => setFlashed(new Set()), 800);
    return () => clearTimeout(id);
  }, [items]);

  // The 30-day window draws the full month; the shorter windows draw the tail
  // of the same daily series.
  const sparkDays = w.days >= 30 ? 30 : 14;
  const seconds = 90;

  return (
    <>
      <div
        // px-2 on phones: the desktop inset costs 48px of a 390px screen, and
        // every pixel of it comes straight out of the marquee. The app's own
        // ticker goes further and drops to a full-bleed strip at this size.
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-50 flex h-[92px] items-center px-2 transition-transform duration-300 ease-out sm:px-6 ${
          expanded ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ background: "transparent" }}
      >
        <div
          className="pointer-events-auto flex h-11 w-full items-center rounded-[22px] border border-[#ededf0] p-[5px]"
          style={{
            background: "linear-gradient(#ffffff, #fbfbfc)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,.9), inset 0 -1px 0 rgba(28,28,30,.04), 0 1px 2px rgba(28,28,30,.06), 0 12px 28px -12px rgba(28,28,30,.22)",
          }}
        >
          {/* THE CHIP HAS TO YIELD ON A PHONE.
              Measured at 390px wide: this label was 290px and the controls 122px
              inside a 342px pill, so the marquee — the only part carrying any
              actual data — was squeezed to exactly 0px. All a phone showed was
              the words "Skills in demand · last 24 hours" and nothing else.
              So below `sm` the window suffix goes, the type steps down, and the
              padding tightens; the app's own ticker does the same thing in
              global.css for the same reason. */}
          <div className="flex h-[34px] flex-none items-center gap-1 rounded-[15px] bg-[#1c1c1e] px-2 text-white sm:gap-2 sm:px-3">
            <span
              className="h-[6px] w-[6px] shrink-0 rounded-full bg-white sm:h-[7px] sm:w-[7px]"
              style={{ animation: "emp-pulse 1.8s ease-in-out infinite" }}
            />
            <span className="whitespace-nowrap font-mono text-[8px] uppercase tracking-[.06em] sm:text-[11px] sm:tracking-[.14em]">
              Skills in demand
            </span>
            {/* The window is still legible from the control button's label. */}
            <span className="hidden whitespace-nowrap font-mono text-[11px] tracking-[.08em] text-[#b4b4ba] sm:inline">
              {w.label.toUpperCase()}
            </span>
          </div>

          <div
            className="emp-lane relative flex min-w-0 flex-1 items-center overflow-hidden"
            style={{
              maskImage:
                "linear-gradient(90deg, transparent 0, #000 40px, #000 calc(100% - 56px), transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(90deg, transparent 0, #000 40px, #000 calc(100% - 56px), transparent 100%)",
            }}
          >
            {loading ? (
              <div className="flex w-max items-center" aria-hidden>
                {[...SKELETON, ...SKELETON].map((width, i) => (
                  <div key={i} className="border-r border-[#f0f0f2] px-[18px]">
                    <span
                      className="block h-[11px] animate-pulse rounded-full bg-[#ededf0]"
                      style={{ width }}
                    />
                  </div>
                ))}
              </div>
            ) : noHistory ? (
              <span className="truncate px-[18px] text-[13px] text-[#8e8e93]">
                Not enough archive history yet to measure change over{" "}
                {w.label.replace("· Last ", "the last ").toLowerCase()}.
              </span>
            ) : (
              <div
                className="flex w-max"
                style={{
                  animation: `emp-ticker ${seconds}s linear infinite`,
                  animationPlayState: paused ? "paused" : undefined,
                }}
              >
                {/* Rendered twice: the keyframe runs 0 → −50%, so the second
                    copy is what makes the wrap seamless rather than a jump. */}
                <Lane rows={items} sparkDays={sparkDays} flashed={flashed} />
                <Lane rows={items} sparkDays={sparkDays} flashed={flashed} />
              </div>
            )}
          </div>

          {/* Two of the three controls are desktop-only, for the width. Minimize
              is the one that stays, and it is the right one to keep: it is also
              what lets a visitor stop the marquee moving, which a scrolling
              strip owes them (WCAG 2.2.2 is satisfied by pause, stop OR hide —
              minimize hides it outright). */}
          <div className="ml-1 flex flex-none items-center gap-0.5 border-l border-[#ededf0] pl-1 sm:pl-2">
            <button
              type="button"
              onClick={() => setWin((v) => (v + 1) % TREND_WINDOWS.length)}
              disabled={!anyLive}
              className="hidden h-[34px] rounded-[10px] px-[9px] font-mono text-[11px] uppercase tracking-[.1em] text-[#48484a] transition hover:bg-[#f4f4f5] hover:text-ink active:scale-[.96] disabled:pointer-events-none disabled:opacity-40 sm:block"
              title={
                anyLive
                  ? `Showing ${w.label.replace("· ", "").toLowerCase()} — click to change`
                  : "Comparison windows unlock once the job archive has history"
              }
              aria-label="Change time window"
            >
              {w.short}
            </button>
            <button
              type="button"
              onClick={() => setPaused((v) => !v)}
              className="hidden h-[34px] w-[34px] items-center justify-center rounded-[10px] text-[#48484a] transition hover:bg-[#f4f4f5] hover:text-ink active:scale-[.96] sm:flex"
              aria-label={paused ? "Resume ticker" : "Pause ticker"}
              aria-pressed={paused}
            >
              <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
                <path
                  d="M6.6 3.6v10.8M11.4 3.6v10.8"
                  stroke="currentColor"
                  strokeWidth={1.9}
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-[#8e8e93] transition hover:bg-[#f4f4f5] hover:text-ink active:scale-[.96]"
              aria-label="Minimize ticker"
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </div>

      <button
        onClick={() => setExpanded(true)}
        className={`fixed left-1/2 z-50 -translate-x-1/2 rounded-full border border-hairline bg-background px-4 py-2 text-sm font-medium text-ink shadow-lg transition-all duration-300 ease-out hover:bg-surface ${
          expanded
            ? "pointer-events-none bottom-0 translate-y-full opacity-0"
            : "pointer-events-auto bottom-4 translate-y-0 opacity-100"
        }`}
        aria-label="Show ticker"
      >
        <span className="flex items-center gap-2">
          <Activity size={14} className="text-emerald-500" />
          Live trends
          <ChevronUp size={14} />
        </span>
      </button>
    </>
  );
}
