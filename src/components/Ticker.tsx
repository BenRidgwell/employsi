import { useState } from "react";
import { ChevronDown, ChevronUp, Activity } from "lucide-react";

export function Ticker() {
  const [expanded, setExpanded] = useState(true);

  return (
    <>
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 h-[92px] overflow-hidden border-t border-hairline bg-background/80 backdrop-blur transition-transform duration-300 ease-out ${
          expanded
            ? "translate-y-0 pointer-events-auto"
            : "translate-y-full pointer-events-none"
        }`}
      >
        <button
          onClick={() => setExpanded(false)}
          className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-ink-4 transition hover:bg-surface-2 hover:text-ink"
          aria-label="Minimize ticker"
        >
          <ChevronDown size={14} strokeWidth={2.5} />
        </button>
        <iframe
          src="/skills-ticker.html"
          title="Skills in demand ticker"
          className="-mt-[24px] h-[140px] w-full border-0"
          style={{ background: "transparent" }}
        />
      </div>

      <button
        onClick={() => setExpanded(true)}
        className={`fixed left-1/2 z-50 -translate-x-1/2 rounded-full border border-hairline bg-background/90 px-4 py-2 text-sm font-medium text-ink shadow-lg backdrop-blur transition-all duration-300 ease-out hover:bg-surface ${
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
