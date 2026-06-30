import { ArrowDown, ArrowUp } from "lucide-react";

type Item = {
  label: string;
  value: string;
  delta: number; // percent
  kind: "skill" | "company";
};

const items: Item[] = [
  { label: "AI Research", value: "Demand", delta: 18.4, kind: "skill" },
  { label: "BHP", value: "Headcount", delta: 2.1, kind: "company" },
  { label: "Rust", value: "Demand", delta: 12.7, kind: "skill" },
  { label: "Rio Tinto", value: "Headcount", delta: -1.4, kind: "company" },
  { label: "Prompt Engineering", value: "Demand", delta: 24.9, kind: "skill" },
  { label: "Fortescue", value: "Headcount", delta: 4.6, kind: "company" },
  { label: "Solidity", value: "Demand", delta: -8.3, kind: "skill" },
  { label: "South32", value: "Headcount", delta: -0.7, kind: "company" },
  { label: "Data Engineering", value: "Demand", delta: 9.2, kind: "skill" },
  { label: "BHP · Iron Ore", value: "Hiring", delta: 3.8, kind: "company" },
  { label: "Kubernetes", value: "Demand", delta: 5.1, kind: "skill" },
  { label: "Rio Tinto · Copper", value: "Hiring", delta: 6.2, kind: "company" },
  { label: "QA Automation", value: "Demand", delta: -3.6, kind: "skill" },
  { label: "Fortescue · Energy", value: "Hiring", delta: 11.4, kind: "company" },
  { label: "Product Design", value: "Demand", delta: -1.8, kind: "skill" },
  { label: "South32 · Aluminium", value: "Hiring", delta: -2.2, kind: "company" },
];

function Cell({ item }: { item: Item }) {
  const up = item.delta >= 0;
  return (
    <span className="inline-flex items-center gap-3 px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          item.kind === "skill" ? "bg-ink" : "bg-ink-3"
        }`}
      />
      <span className="text-ink">{item.label}</span>
      <span className="text-ink-4">{item.value}</span>
      <span
        className={`inline-flex items-center gap-0.5 ${
          up ? "text-ink" : "text-ink-2"
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
            Live signal
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
