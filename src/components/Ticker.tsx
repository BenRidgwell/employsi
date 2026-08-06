import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Activity } from "lucide-react";

/**
 * The "skills in demand" ticker — a floating pill over a transparent bar.
 *
 * This replaced a 92px white bar containing an iframe to a 318KB static page.
 * Rendering it in React instead means one source of truth for the data, no
 * second document to keep in step, and no iframe to fight for scroll.
 *
 * THE FIGURES ARE PLACEHOLDERS AND THE CODE SHOULD SAY SO. Salaries and deltas
 * are generated here, not read from the archive — the handoff is explicit that
 * they are to be wired to D1 before launch. They are shaped like the real
 * thing, which is exactly why the seeding is written out in the open rather
 * than hidden behind a helper that could later be mistaken for a data source.
 */

// [skill, median advertised base salary USD]
const SEED: [string, number][] = [
  ["Prompt engineering", 172000],
  ["Kubernetes", 168000],
  ["TypeScript", 152000],
  ["Data modelling", 141000],
  ["Rust", 178000],
  ["Figma", 124000],
  ["Salesforce admin", 98000],
  ["Python", 148000],
  ["Terraform", 161000],
  ["Clinical coding", 76000],
  ["React", 145000],
  ["FP&A", 132000],
  ["Go", 165000],
  ["Technical writing", 104000],
  ["Snowflake", 158000],
  ["CNC machining", 68000],
];

// The three ranges the window button cycles. The multiplier scales the same
// underlying delta rather than modelling three series: a longer window shows a
// larger move, which is the shape the real data will have.
const WINDOWS = [
  { label: "· LAST 24 HOURS", short: "24h", mult: 1 },
  { label: "· LAST 7 DAYS", short: "7d", mult: 2.1 },
  { label: "· LAST 30 DAYS", short: "30d", mult: 3.4 },
] as const;

const UP = { fg: "#2f8f63", tint: "#e8f3ec" };
const DOWN = { fg: "#c4463b", tint: "#f7ebe9" };
const FLAT = { fg: "#8e8e93", tint: "#f4f4f5" };

interface Row {
  name: string;
  pay: number;
  hist: number[];
  delta: number;
  flash: boolean;
}

function seedRows(): Row[] {
  return SEED.map(([name, pay], i) => {
    const hist: number[] = [];
    for (let j = 0; j < 14; j++) {
      let v = 40 + ((i * 17) % 30);
      v += Math.sin(i + j * 0.8) * 6;
      hist.push(v);
    }
    return { name, pay, hist, delta: +(Math.sin(i * 2.3) * 9).toFixed(1), flash: false };
  });
}

/** 14 history points → a 48x18 path. Normalised so a flat series sits mid-box. */
function sparkPath(hist: number[]): string {
  const min = Math.min(...hist);
  const max = Math.max(...hist);
  const span = max - min || 1;
  return hist
    .map((v, i) => {
      const x = (i / (hist.length - 1)) * 46 + 1;
      const y = 16 - ((v - min) / span) * 14;
      return `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function toneFor(delta: number) {
  if (delta >= 0.15) return UP;
  if (delta <= -0.15) return DOWN;
  return FLAT;
}

function Lane({ rows, mult }: { rows: Row[]; mult: number }) {
  return (
    <>
      {rows.map((r, i) => {
        const shown = r.delta * mult;
        const tone = toneFor(shown);
        // 0deg up, 180deg down, 90deg flat — one arrow, rotated, so the
        // transition between states is a turn rather than a swap.
        const rot = shown >= 0.15 ? 0 : shown <= -0.15 ? 180 : 90;
        return (
          <div
            key={`${r.name}-${i}`}
            className="flex items-center gap-2.5 border-r border-[#f0f0f2] px-[18px]"
          >
            <span className="whitespace-nowrap text-[13px] font-medium tracking-[-0.006em] text-[#1c1c1e]">
              {r.name}
            </span>
            <svg viewBox="0 0 48 18" width={48} height={18} aria-hidden>
              <path
                d={sparkPath(r.hist)}
                fill="none"
                stroke={tone.fg}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.85}
              />
            </svg>
            <span className="font-mono text-[12px] tabular-nums tracking-[-0.01em] text-[#6c6c72]">
              ${Math.round(r.pay / 1000)}k
            </span>
            <span
              className="inline-flex h-[21px] items-center gap-1 rounded-[7px] px-[7px]"
              style={{
                color: tone.fg,
                background: r.flash ? tone.tint : "rgba(244,244,245,0)",
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
                {Math.abs(shown).toFixed(1)}%
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
  const [rows, setRows] = useState<Row[]>(seedRows);
  const [win, setWin] = useState(0);
  const [paused, setPaused] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (paused) return;
    const tick = setInterval(() => {
      setRows((prev) => {
        const next = prev.map((r) => ({ ...r, flash: false }));
        for (let k = 0; k < 3; k++) {
          const i = Math.floor(Math.random() * next.length);
          const step = (Math.random() - 0.48) * 5;
          const r = next[i];
          r.delta = +Math.max(-14, Math.min(16, r.delta + step)).toFixed(1);
          r.hist = [...r.hist.slice(1), r.hist[r.hist.length - 1] + step * 1.6];
          r.flash = true;
        }
        return next;
      });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(
        () => setRows((prev) => prev.map((r) => (r.flash ? { ...r, flash: false } : r))),
        800,
      );
    }, 2000);
    return () => {
      clearInterval(tick);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [paused]);

  const w = WINDOWS[win];
  const seconds = 90;

  return (
    <>
      <div
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-50 flex h-[92px] items-center px-6 transition-transform duration-300 ease-out ${
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
          <div className="flex h-[34px] flex-none items-center gap-2 rounded-[15px] bg-[#1c1c1e] px-3 text-white">
            <span
              className="h-[7px] w-[7px] rounded-full bg-white"
              style={{ animation: "emp-pulse 1.8s ease-in-out infinite" }}
            />
            <span className="font-mono text-[11px] uppercase tracking-[.14em]">
              Skills in demand
            </span>
            <span className="font-mono text-[11px] tracking-[.08em] text-[#b4b4ba]">{w.label}</span>
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
            <div
              className="flex w-max"
              style={{
                animation: `emp-ticker ${seconds}s linear infinite`,
                animationPlayState: paused ? "paused" : undefined,
              }}
            >
              {/* Rendered twice: the keyframe runs 0 → −50%, so the second copy
                  is what makes the wrap seamless rather than a jump. */}
              <Lane rows={rows} mult={w.mult} />
              <Lane rows={rows} mult={w.mult} />
            </div>
          </div>

          <div className="ml-1 flex flex-none items-center gap-0.5 border-l border-[#ededf0] pl-2">
            <button
              type="button"
              onClick={() => setWin((v) => (v + 1) % WINDOWS.length)}
              className="h-[34px] rounded-[10px] px-[9px] font-mono text-[11px] uppercase tracking-[.1em] text-[#48484a] transition hover:bg-[#f4f4f5] hover:text-ink active:scale-[.96]"
              aria-label="Change time window"
            >
              {w.short}
            </button>
            <button
              type="button"
              onClick={() => setPaused((v) => !v)}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-[#48484a] transition hover:bg-[#f4f4f5] hover:text-ink active:scale-[.96]"
              aria-label={paused ? "Resume updates" : "Pause updates"}
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
