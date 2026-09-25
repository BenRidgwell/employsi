import { useEffect, useState } from "react";

/**
 * The holding frame shown over the company card and the news column while
 * their data is still arriving — from `Employsi Loading Animation.html`.
 *
 * The mark's three bars sweep out in sequence, a 1.6s loop with no bounce,
 * over a translucent wash of the surface beneath. Two tones: `light` for the
 * white card, `dark` for the ink news column, which is the design's own pair.
 *
 * The stage label cycles so a slow fetch reads as progress rather than a stall.
 * It is deliberately describing what the app is DOING, not claiming a
 * percentage — there is no meaningful denominator across four independent
 * fetches, and a fake progress bar would be the dishonest version of this.
 *
 * A card whose fetch is not about vacancies passes its own `stages`, so the
 * captions still say what is actually happening (Talent flows does).
 */

const STAGES = [
  "Fetching live vacancies",
  "Matching skills",
  "Indexing benchmarks",
  "Almost there",
];

export function CardLoader({
  tone = "light",
  stages = STAGES,
}: {
  tone?: "light" | "dark";
  stages?: readonly string[];
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % stages.length), 1900);
    return () => clearInterval(t);
  }, [stages.length]);

  return (
    <div className={`ccload ccload-${tone}`} aria-live="polite" aria-busy="true">
      <svg viewBox="0 0 120 120" width="46" height="46" className="ccloadmark" aria-hidden>
        <rect className="ccloadstem" x="24" y="24" width="15" height="72" rx="7.5" />
        <rect className="ccloadbar b1" x="24" y="24" width="40" height="15" rx="7.5" />
        <rect className="ccloadbar b2" x="24" y="52.5" width="55" height="15" rx="7.5" />
        <rect className="ccloadbar b3" x="24" y="81" width="72" height="15" rx="7.5" />
      </svg>
      <span className="ccloadstage">{stages[i % stages.length]}</span>
    </div>
  );
}
