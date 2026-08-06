import { useState } from "react";
import { X } from "lucide-react";

export function Ticker() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 h-[92px] overflow-hidden border-t border-hairline bg-background/80 backdrop-blur">
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-ink-4 transition hover:bg-surface-2 hover:text-ink"
        aria-label="Dismiss ticker"
      >
        <X size={14} strokeWidth={2.5} />
      </button>
      <iframe
        src="/skills-ticker.html"
        title="Skills in demand ticker"
        className="-mt-[24px] h-[140px] w-full border-0"
        style={{ background: "transparent" }}
      />
    </div>
  );
}
