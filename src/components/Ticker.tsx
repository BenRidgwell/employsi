import { ArrowDown, ArrowUp } from "lucide-react";

type Item = {
  label: string;
  delta: number; // percent
};

const items: Item[] = [
  { label: "AI Research", delta: 18.4 },
  { label: "Rust", delta: 12.7 },
  { label: "Prompt Engineering", delta: 24.9 },
  { label: "Solidity", delta: -8.3 },
  { label: "Data Engineering", delta: 9.2 },
  { label: "Kubernetes", delta: 5.1 },
  { label: "QA Automation", delta: -3.6 },
  { label: "Product Design", delta: -1.8 },
  { label: "Machine Learning", delta: 15.3 },
  { label: "Cybersecurity", delta: 7.8 },
  { label: "Generative AI", delta: 31.2 },
  { label: "Cloud Architecture", delta: 11.5 },
  { label: "Python", delta: 6.4 },
  { label: "React", delta: 4.1 },
  { label: "Go", delta: -2.5 },
];

function Cell({ item }: { item: Item }) {
  const up = item.delta >= 0;
  return (
    <span className="inline-flex items-center gap-3 px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink" />
      <span className="text-ink">{item.label}</span>
      <span className="text-ink-4">Demand</span>
      <span
        className={`inline-flex items-center gap-0.5 ${
          up ? "text-emerald-500" : "text-red-500"
        }`}
      >
        {up ? <ArrowUp size={11} strokeWidth={2.5} /> : <ArrowDown size={11} strokeWidth={2.5} />}
        {up ? "+" : ""}
        {item.delta.toFixed(1)}%
      </span>
    </span>
  );
}

export function Ticker() {
  const loop = [...items, ...items];
  return (
    <div className="sticky top-0 z-40 border-b border-hairline bg-background">
      <div className="flex items-center">
        <div className="hidden shrink-0 items-center gap-2 border-r border-hairline px-4 py-2.5 sm:flex">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink" />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
            Live trends
          </span>
        </div>
        <div className="relative flex-1 overflow-hidden">
          <div className="flex w-max animate-ticker">
            {loop.map((it, i) => (
              <Cell key={i} item={it} />
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-background to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent" />
        </div>
      </div>
    </div>
  );
}
